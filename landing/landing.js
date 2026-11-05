// Flatstock landing: live reads from Robinhood Chain (public RPC, read-only) + scroll motion.
(() => {
  const RPC = "https://rpc.mainnet.chain.robinhood.com";
  const EXPLORER = "https://robinhoodchain.blockscout.com";
  const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968";
  const ROUTER = "0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7";
  const RETIRED = ["0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9", "0xD49249D2a5CffBCF35B6560857d1d1C703802e78", "0x68d2622f3bbf6BE80CdfED679489de344410C7Db"];
  const FIRST_ROUND = 4;
  const FROM = "0x" + (101593767).toString(16);
  const SYMBOLS = ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "SPY"]; // asset index order; round 4 uses the first 3, round 5 all 8
  const SEL = { latest: "0x11a8f413", rounds: "0x8c65c81f", votesFor: "0x88d5b112", weight: "0x07ef3559", share: "0xc133a59c" };
  const TOPIC = {
    vote: "0xeba4866100b822f0f391e610e7edfab790b9e8766c0012733c26b2f1858e8dd7",
    closed: "0xc67dda8e11f1aa941c7e74466b1859a07a32f46aaf641d29b83be348424d93cd",
    opened: "0x2504ab621952885384d0731e6d262adbf18caaf7af98e555fcfb7288ca854b4b",
    trade: "0xa942996a1cca4505adf74ec0d064d7675e41d2eb1fb0f92ed5d6bc8be7d1d080",
  };
  const $ = (id) => document.getElementById(id);
  const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
  const words = (hex) => (hex.slice(2).match(/.{64}/g) || []).map((w) => BigInt("0x" + w));

  async function rpc(method, params) {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }
  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  // One event type per request: the RPC limits multi-topic queries over wide block ranges.
  const logs = (address, topic0) => rpc("eth_getLogs", [{ address, topics: [topic0], fromBlock: FROM, toBlock: "latest" }]).catch(() => []);

  // Same mix rule as the app: 50% equal + 50% vote share, 50% cap, zero votes = equal.
  function mixWeights(votes, n, shareBps = 5000n) {
    const total = votes.slice(0, n).reduce((a, b) => a + b, 0n);
    const base = 10000n / BigInt(n), rem = 10000n % BigInt(n);
    const eq = (i) => base + (BigInt(i) < rem ? 1n : 0n);
    if (total === 0n) return Array.from({ length: n }, (_, i) => eq(i));
    const w = []; let vs = 0n, ws = 0n;
    for (let i = 0; i < n; i++) {
      const vw = i === n - 1 ? 10000n - vs : (votes[i] * 10000n) / total;
      if (i !== n - 1) vs += vw;
      w[i] = (eq(i) * (10000n - shareBps) + vw * shareBps) / 10000n; ws += w[i];
    }
    if (ws < 10000n) w[n - 1] += 10000n - ws;
    const capped = w.map(() => false); let excess = 0n;
    for (let i = 0; i < n; i++) if (w[i] > 5000n) { excess += w[i] - 5000n; w[i] = 5000n; capped[i] = true; }
    while (excess > 0n) {
      const idx = w.map((x, i) => (!capped[i] && x < 5000n ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) break;
      const add = excess / BigInt(idx.length), r = excess % BigInt(idx.length); let next = 0n;
      idx.forEach((i, k) => {
        const a = add + (BigInt(k) < r ? 1n : 0n), cap = 5000n - w[i];
        if (a > cap) { w[i] = 5000n; capped[i] = true; next += a - cap; } else w[i] += a;
      });
      excess = next;
    }
    return w;
  }

  async function readRound(id) {
    const [opens, closes, count, total, closed] = words(await call(VOTES, SEL.rounds + pad(id)));
    if (count === 0n) return null;
    const n = Number(count);
    const votes = await Promise.all(Array.from({ length: n }, async (_, i) => (total === 0n ? 0n : words(await call(VOTES, SEL.votesFor + pad(id) + pad(i)))[0])));
    const share = await call(VOTES, SEL.share + pad(id)).then((h) => words(h)[0]).catch(() => 5000n);
    const weights = closed
      ? await Promise.all(Array.from({ length: n }, async (_, i) => words(await call(VOTES, SEL.weight + pad(id) + pad(i)))[0]))
      : mixWeights(votes, n, share);
    return { id, opens: Number(opens), closes: Number(closes), n, total, closed, weights, votes, share: Number(share) };
  }

  const pct = (w) => (Number(w) / 100).toFixed(0) + "%";
  const fmtDate = (s) => new Date(s * 1000).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT";
  function countdown(sec) {
    if (sec <= 0) return "Closing";
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }

  async function load() {
    const latestId = Number(words(await call(VOTES, SEL.latest))[0]);
    const rounds = [];
    for (let id = FIRST_ROUND; id <= latestId; id++) { const r = await readRound(id); if (r) rounds.push(r); }
    const latest = rounds[rounds.length - 1];
    const lastClosed = [...rounds].reverse().find((r) => r.closed);
    const buy = lastClosed || (latest && latest.total > 0n ? latest : null);

    // Hero cards
    if (buy) {
      const ranked = buy.weights.map((w, i) => ({ s: SYMBOLS[i], w })).sort((a, b) => (a.w < b.w ? 1 : -1));
      const shown = ranked.slice(0, 3).map((r) => `${r.s} ${pct(r.w)}`).join(" · ");
      $("h-mix").textContent = ranked.length > 3 ? `${shown} +${ranked.length - 3}` : shown;
      $("h-mix-sub").textContent = lastClosed ? `Round ${buy.id}, final · ${buy.n} stocks` : `Round ${buy.id} preview (live) · ${buy.n} stocks`;
    } else { $("h-mix").textContent = "Equal weights"; $("h-mix-sub").textContent = "Voting is open"; }
    const open = latest && !latest.closed ? latest : null;
    const note = $("round-note");
    if (note && buy && open && buy.id !== open.id) note.textContent = `This week: Round ${buy.id} ${lastClosed ? "final mix" : "preview"} (${buy.n} stocks). Voting now: Round ${open.id}, ${open.n} stocks, for next week.`;
    if (open) {
      $("h-round-label").textContent = `Round ${open.id} closes in`;
      $("h-round-sub").textContent = `Vote for next week · ${fmtDate(open.closes)}`;
      const tick = () => { $("h-count").textContent = countdown(open.closes - Math.floor(Date.now() / 1000)); };
      tick(); setInterval(tick, 1000);
    } else { $("h-round-label").textContent = "Next round"; $("h-count").textContent = "Soon"; }

    // Stats
    const voteLogs = await Promise.all([VOTES, ...RETIRED].map((a) => logs(a, TOPIC.vote)));
    const votes = voteLogs.reduce((s, l) => s + l.length, 0);
    const trades = TOPIC.trade ? (await logs(ROUTER, TOPIC.trade)).length : 0;
    setStat("s-votes", votes); setStat("s-burn", votes); setStat("s-trades", trades); setStat("s-rounds", rounds.length);
    $("h-burn").textContent = String(votes);

    // Rounds list with tx links
    const [opened, closedLogs] = await Promise.all([logs(VOTES, TOPIC.opened), logs(VOTES, TOPIC.closed)]);
    const txFor = (list, id) => (list.find((l) => parseInt(l.topics[1], 16) === id) || {}).transactionHash;
    const list = $("round-list"); list.innerHTML = "";
    [...rounds].reverse().forEach((r) => {
      const li = document.createElement("li");
      const status = r.closed ? "Final" : Math.floor(Date.now() / 1000) >= r.closes ? "Ended" : "Open";
      const links = [txFor(opened, r.id) && `<a href="${EXPLORER}/tx/${txFor(opened, r.id)}" target="_blank" rel="noopener noreferrer">Open tx</a>`,
        txFor(closedLogs, r.id) && `<a href="${EXPLORER}/tx/${txFor(closedLogs, r.id)}" target="_blank" rel="noopener noreferrer">Close tx</a>`,
        `<a href="${EXPLORER}/address/${VOTES}" target="_blank" rel="noopener noreferrer">Contract</a>`].filter(Boolean).join(" · ");
      li.innerHTML = `<h3>Round ${r.id}<small class="${r.closed ? "final" : ""}">${status}</small></h3><div class="bars">${r.weights.map((w, i) => `<div class="bar"><span>${SYMBOLS[i]}</span><i style="--w:${Number(w) / 100}%"></i><span>${(Number(w) / 100).toFixed(2)}%</span></div>`).join("")}</div><p>${r.total} vote${r.total === 1n ? "" : "s"} · ${r.total} $WIF burned · closes ${fmtDate(r.closes)}</p><p>${links}</p>`;
      list.appendChild(li);
    });
    if (!rounds.length) list.innerHTML = '<li class="muted">No rounds found yet.</li>';
  }

  function setStat(id, value) {
    const el = $(id); if (!el) return;
    if (window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const o = { v: 0 }; window.gsap.to(o, { v: value, duration: 1.6, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString("en"); } });
    } else el.textContent = Number(value).toLocaleString("en");
  }

  load().catch(() => {
    ["h-mix", "h-burn", "h-count"].forEach((id) => { $(id).textContent = "n/a"; });
    $("h-mix-sub").textContent = "Live data unavailable";
    $("round-list").innerHTML = '<li class="muted">Could not load rounds from chain right now. See the contract on Blockscout.</li>';
  });

  // Motion: only when libraries loaded and the visitor has not asked for reduced motion.
  window.addEventListener("load", () => {
    const { gsap, ScrollTrigger, Lenis } = window;
    if (!gsap || !ScrollTrigger || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const small = matchMedia("(max-width: 760px)").matches;
    if (Lenis && !small) {
      const lenis = new Lenis({ lerp: 0.1 });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
    }
    document.querySelectorAll(".section-title, .lede, .why-list li, .s-grid article, .faq details, .stat-grid li").forEach((el) => {
      el.setAttribute("data-reveal", "");
      gsap.to(el, { opacity: 1, y: 0, duration: .8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
    });
    // Headline window: the small window expands to full-bleed while the headlines fade.
    const win = $("win");
    if (win) {
      const scale = () => Math.max(innerWidth / win.offsetWidth, innerHeight / win.offsetHeight) * 1.02;
      const tl = gsap.timeline({ scrollTrigger: { trigger: ".window", start: "top top", end: small ? "+=90%" : "+=140%", scrub: 0.6, pin: ".window-pin", invalidateOnRefresh: true } });
      tl.to(win, { scale, borderRadius: 0, ease: "none", duration: 1 }, 0)
        .to(".big, .note", { opacity: 0, ease: "none", duration: .5 }, 0.1)
        .from(".scene-step", { opacity: 0.15, stagger: .25, ease: "none", duration: .3 }, 0.35);
    }
    gsap.from(".fcard", { y: 90, opacity: 0, stagger: .15, duration: 1, ease: "power3.out", scrollTrigger: { trigger: ".fan", start: "top 80%", once: true } });
  });
})();

// Flatstock landing: live reads from Robinhood Chain (public RPC, read-only) + light scroll motion.
(() => {
  const RPC = "https://rpc.mainnet.chain.robinhood.com";
  const EXPLORER = "https://robinhoodchain.blockscout.com";
  const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968";
  const ROUTER = "0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7";
  const RETIRED = ["0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9", "0xD49249D2a5CffBCF35B6560857d1d1C703802e78", "0x68d2622f3bbf6BE80CdfED679489de344410C7Db"];
  const FIRST_ROUND = 4;
  const FROM = "0x" + (101593767).toString(16);
  // Asset index order: round 4 uses the first 3, round 5 all 8.
  const SYMBOLS = ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "SPY"];
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
  const plural = (n, one, many) => (Number(n) === 1 ? one : many);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function rpc(method, params) {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }
  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  // One event type per request: the RPC limits multi-topic queries over wide block ranges.
  const logs = (address, topic0) => rpc("eth_getLogs", [{ address, topics: [topic0], fromBlock: FROM, toBlock: "latest" }]).catch(() => null);

  // Same mix rule as the app: (100 - share)% equal + share% vote share, 50% cap, zero votes = equal.
  function mixWeights(votes, n, shareBps) {
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

  // Dots on a line: dot size = weight. Entries with weight null are shown as hollow "not in this round" dots.
  function renderDots(el, entries) {
    if (!el) return;
    const max = Math.max(...entries.map((e) => (e.w === null ? 0 : e.w)), 1);
    const lead = entries.reduce((best, e, i) => (e.w !== null && (best < 0 || e.w > entries[best].w) ? i : best), -1);
    el.style.setProperty("--n", entries.length);
    el.innerHTML = `<div class="dl-dots">${entries.map((e, i) => {
      const s = e.w === null ? 0.3 : 0.34 + 0.66 * Math.sqrt(e.w / max);
      return `<span class="dl-cell"><span class="dl-dot ${e.w === null ? "ghost" : i === lead ? "lead" : ""}" style="--s:${s.toFixed(3)}"></span></span>`;
    }).join("")}</div><div class="dl-rail"></div><div class="dl-labels">${entries.map((e) => `<span class="dl-label ${e.w === null ? "ghost" : ""}"><b>${e.s}</b>${e.w === null ? "" : `<small>${e.w < 10 ? e.w.toFixed(1) : e.w.toFixed(0)}%</small>`}</span>`).join("")}</div>`;
  }

  const fmtDate = (s) => new Date(s * 1000).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT";
  function countdown(sec) {
    if (sec <= 0) return "Closing";
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }

  // Placeholder dots before data arrives (equal ghost dots).
  renderDots($("hero-dots"), SYMBOLS.map((s) => ({ s, w: null })));

  async function load() {
    const latestId = Number(words(await call(VOTES, SEL.latest))[0]);
    const rounds = [];
    for (let id = FIRST_ROUND; id <= latestId; id++) { const r = await readRound(id); if (r) rounds.push(r); }
    const latest = rounds[rounds.length - 1];
    const lastClosed = [...rounds].reverse().find((r) => r.closed);
    const buy = lastClosed || (latest && latest.total > 0n ? latest : null);
    const nowSec = () => Math.floor(Date.now() / 1000);
    const open = latest && !latest.closed && nowSec() < latest.closes ? latest : null;

    // Hero mix: the mix you can buy (final of last closed round, or the live preview), other stocks hollow.
    const entries = SYMBOLS.map((s, i) => ({ s, w: buy && i < buy.n ? Number(buy.weights[i]) / 100 : null }));
    if (buy) {
      renderDots($("hero-dots"), entries);
      $("hero-cap").textContent = lastClosed ? `This week's mix · Round ${buy.id} final · ${buy.n} stocks. Hollow dots join in round ${open && open.n === 8 ? open.id : 5}.` : `Preview mix · Round ${buy.id} live · ${buy.n} stocks. Hollow dots join in round 5.`;
    } else {
      $("hero-cap").textContent = "Voting is open: with no votes yet every stock weighs the same.";
    }

    if (open) {
      const tick = () => { $("h-count").textContent = countdown(open.closes - nowSec()); };
      tick(); setInterval(tick, 1000);
      $("h-next").textContent = `Round ${open.id + 1}${open.id === 4 ? " · 8 stocks" : ""}`;
    } else { $("h-count").textContent = "Soon"; }

    // Phone mockup: the same mix, mini.
    if (buy) {
      renderDots($("phone-dots"), buy.weights.map((w, i) => ({ s: SYMBOLS[i], w: Number(w) / 100 })));
      $("p-eyebrow").textContent = lastClosed ? `This week · Round ${buy.id} final` : `Preview · Round ${buy.id} live`;
    }
    if (open) {
      const frac = Math.min(Math.max((nowSec() - open.opens) / Math.max(open.closes - open.opens, 1), 0), 1);
      $("p-fill").style.width = frac * 100 + "%"; $("p-dot").style.left = frac * 100 + "%";
      $("p-cap").textContent = `Round ${open.id} closes ${fmtDate(open.closes)}`;
    }

    // Rounds section: "Round N -> Round N+1" and what's next.
    const cur = latest ? latest.id : 4;
    const nums = document.querySelectorAll(".numerals span");
    if (nums.length === 2) { nums[0].textContent = `Round ${cur}`; nums[1].textContent = `Round ${cur + 1}`; }
    const symbolsOf = (n) => `${n}: ${SYMBOLS.slice(0, n).join(" ")}`;
    if (open && open.id === 4) {
      $("n-when").textContent = "Mon 9 Nov, right after round 4 closes at 15:00 WAT";
      $("n-stocks").textContent = symbolsOf(8);
      $("n-label").textContent = "Opens in";
      const t = () => { $("n-count").textContent = countdown(open.closes - nowSec()); }; t(); setInterval(t, 1000);
    } else if (open) {
      $("n-when").textContent = `Round ${open.id} is open now. It closes ${fmtDate(open.closes)}.`;
      $("n-stocks").textContent = symbolsOf(open.n);
      $("n-label").textContent = "Closes in";
      const t = () => { $("n-count").textContent = countdown(open.closes - nowSec()); }; t(); setInterval(t, 1000);
    } else {
      $("n-when").textContent = "Next Monday at 15:00 WAT"; $("n-stocks").textContent = symbolsOf(8); $("n-count").textContent = "Soon";
    }

    // Stats (with correct plurals)
    const voteLogs = await Promise.all([VOTES, ...RETIRED].map((a) => logs(a, TOPIC.vote)));
    const votesKnown = voteLogs.every((l) => l !== null);
    const votes = voteLogs.reduce((s, l) => s + (l ? l.length : 0), 0);
    const tradeLogs = await logs(ROUTER, TOPIC.trade);
    const trades = tradeLogs ? tradeLogs.length : null;
    // A failed (for example rate-limited) log request shows n/a, never a misleading 0.
    setStat("s-votes", votesKnown ? votes : null); setStat("s-burn", votesKnown ? votes : null); setStat("s-trades", trades); setStat("s-rounds", rounds.length);
    $("s-votes-l").textContent = plural(votes, "vote cast", "votes cast");
    $("s-trades-l").textContent = plural(trades, "trade through the current router", "trades through the current router");
    $("s-rounds-l").textContent = plural(rounds.length, "round on the current contract", "rounds on the current contract");
    $("h-burn").textContent = votesKnown ? `${votes}` : "n/a";

    // Round headline + list (dot lines)
    const note = $("round-note");
    if (note && buy && open && buy.id !== open.id) note.textContent = `This week: Round ${buy.id} ${lastClosed ? "final mix" : "preview"} (${buy.n} stocks). Voting now: Round ${open.id}, ${open.n} stocks, for next week.`;
    const [opened, closedLogs] = (await Promise.all([logs(VOTES, TOPIC.opened), logs(VOTES, TOPIC.closed)])).map((l) => l || []);
    const txFor = (list, id) => (list.find((l) => parseInt(l.topics[1], 16) === id) || {}).transactionHash;
    const list = $("round-list"); list.innerHTML = "";
    [...rounds].reverse().forEach((r) => {
      const li = document.createElement("li");
      const status = r.closed ? "Final" : nowSec() >= r.closes ? "Ended" : "Open";
      const links = [txFor(opened, r.id) && `<a href="${EXPLORER}/tx/${txFor(opened, r.id)}" target="_blank" rel="noopener noreferrer">Open tx</a>`,
        txFor(closedLogs, r.id) && `<a href="${EXPLORER}/tx/${txFor(closedLogs, r.id)}" target="_blank" rel="noopener noreferrer">Close tx</a>`,
        `<a href="${EXPLORER}/address/${VOTES}" target="_blank" rel="noopener noreferrer">Contract</a>`].filter(Boolean).join(" · ");
      li.innerHTML = `<h3>Round ${r.id}<small class="${r.closed ? "final" : ""}">${status}</small></h3><div class="dotline"></div><p>${r.total} ${plural(r.total, "vote", "votes")} · ${r.total} $WIF burned · ${r.n} stocks · closes ${fmtDate(r.closes)}</p><p>${links}</p>`;
      list.appendChild(li);
      renderDots(li.querySelector(".dotline"), r.weights.map((w, i) => ({ s: SYMBOLS[i], w: Number(w) / 100 })));
    });
    if (!rounds.length) list.innerHTML = '<li class="muted">No rounds found yet.</li>';
  }

  function setStat(id, value) {
    const el = $(id); if (!el) return;
    if (value === null) { el.textContent = "n/a"; return; }
    if (window.gsap && !reduceMotion) {
      const o = { v: 0 }; window.gsap.to(o, { v: value, duration: 1.4, ease: "power2.out", onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString("en"); } });
    } else el.textContent = Number(value).toLocaleString("en");
  }

  load().catch(() => {
    ["h-burn", "h-count"].forEach((id) => { $(id).textContent = "n/a"; });
    $("hero-cap").textContent = "Live data is unavailable right now. See the contract on Blockscout.";
    $("round-list").innerHTML = '<li class="muted">Could not load rounds from chain right now. See the contract on Blockscout.</li>';
  });

  // Motion: reveal on scroll, only when GSAP loaded and motion is allowed. No zoom, no scroll hijacking.
  window.addEventListener("load", () => {
    const { gsap, ScrollTrigger } = window;
    if (!gsap || !ScrollTrigger || reduceMotion) { document.querySelectorAll("[data-r]").forEach((el) => { el.style.opacity = 1; el.style.transform = "none"; }); return; }
    gsap.registerPlugin(ScrollTrigger);
    document.querySelectorAll("[data-r]").forEach((el) => {
      gsap.to(el, { opacity: 1, y: 0, duration: .9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    gsap.utils.toArray(".steps li, .why-list li, .s-list li, .stat-grid li").forEach((el) => {
      gsap.from(el, { y: 30, opacity: 0, duration: .8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    gsap.to(".phone", { yPercent: -6, ease: "none", scrollTrigger: { trigger: ".phone-band", start: "top bottom", end: "bottom top", scrub: true } });
  });
})();

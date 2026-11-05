// Flatstock landing: live reads from Robinhood Chain (public RPC, read-only) + light scroll motion.
(() => {
  const RPC = "https://rpc.mainnet.chain.robinhood.com";
  const EXPLORER = "https://robinhoodchain.blockscout.com";
  const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968";
  const ROUTER = "0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7";
  const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const RETIRED = ["0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9", "0xD49249D2a5CffBCF35B6560857d1d1C703802e78", "0x68d2622f3bbf6BE80CdfED679489de344410C7Db"];
  const FIRST_ROUND = 4;
  const FROM = "0x" + (101593767).toString(16);
  // Asset index order: round 4 uses the first 3, round 5 all 8.
  const SYMBOLS = ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "SPY"];
  const NAMES = { AAPL: "Apple", NVDA: "NVIDIA", MSFT: "Microsoft", AMZN: "Amazon", GOOGL: "Alphabet", META: "Meta", TSLA: "Tesla", SPY: "S&P 500 ETF" };
  const FEEDS = {
    AAPL: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", NVDA: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", MSFT: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E",
    AMZN: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", GOOGL: "0xF6f373a037c30F0e5010d854385cA89185AE638b", META: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1",
    TSLA: "0x4A1166a659A55625345e9515b32adECea5547C38", SPY: "0x319724394D3A0e3669269846abE664Cd621f9f6A",
  };
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

  // ---------- Live Chainlink prices and a short history, in ONE Multicall3 request ----------
  const PRICES = {}; // symbol -> { price, history[], change } ; change = latest vs 24h earlier
  const LOOKBACK = 72;
  function encodeAggregate3(calls) {
    const w32 = (hex) => hex.padStart(64, "0");
    const elems = calls.map((c) => {
      const data = c.data.replace(/^0x/, ""); const padded = data.padEnd(Math.ceil(data.length / 64) * 64, "0");
      return w32(c.target.slice(2).toLowerCase()) + w32("1") + w32("60") + w32((data.length / 2).toString(16)) + padded;
    });
    let cur = calls.length * 32; const offsets = [];
    elems.forEach((e) => { offsets.push(w32(cur.toString(16))); cur += e.length / 2; });
    return "0x82ad56cb" + w32("20") + w32(calls.length.toString(16)) + offsets.join("") + elems.join("");
  }
  function decodeAggregate3(hex) {
    const w = hex.slice(2); const word = (i) => BigInt("0x" + w.slice(i * 64, (i + 1) * 64));
    const base = Number(word(0)) / 32; const n = Number(word(base)); const out = [];
    for (let i = 0; i < n; i++) {
      const start = base + 1 + Number(word(base + 1 + i)) / 32;
      const ok = word(start) === 1n; const bytesAt = start + Number(word(start + 1)) / 32;
      const len = Number(word(bytesAt)) * 2; out.push({ ok, data: w.slice((bytesAt + 1) * 64, (bytesAt + 1) * 64 + len) });
    }
    return out;
  }
  const roundWords = (r) => (r.ok && r.data.length >= 320 ? [0, 1, 2, 3, 4].map((i) => BigInt("0x" + r.data.slice(i * 64, (i + 1) * 64))) : null);
  async function loadPrices() {
    try {
      const res = await call(MULTICALL3, encodeAggregate3(SYMBOLS.map((s) => ({ target: FEEDS[s], data: "0xfeaf968c" }))));
      const latest = decodeAggregate3(res).map(roundWords);
      const past = [];
      SYMBOLS.forEach((s, si) => { if (latest[si]) for (let k = 1; k <= LOOKBACK; k++) past.push({ si, id: latest[si][0] - BigInt(k) }); });
      const hist = decodeAggregate3(await call(MULTICALL3, encodeAggregate3(past.map((p) => ({ target: FEEDS[SYMBOLS[p.si]], data: "0x9a6fc8f5" + p.id.toString(16).padStart(64, "0") })))));
      const series = SYMBOLS.map(() => []);
      past.forEach((p, i) => { const w = roundWords(hist[i]); if (w) { const v = Number(w[1]) / 1e8; if (v > 0) series[p.si].push({ t: Number(w[3]), v }); } });
      SYMBOLS.forEach((s, si) => {
        if (!latest[si]) return;
        const price = Number(latest[si][1]) / 1e8; const at = Number(latest[si][3]);
        const earlier = series[si].sort((x, y) => x.t - y.t);
        const inWindow = earlier.filter((p) => p.t >= at - 86400); const before = earlier.filter((p) => p.t < at - 86400);
        const anchor = before.length ? before[before.length - 1].v : (inWindow[0] ? inWindow[0].v : null);
        PRICES[s] = { price, history: [...inWindow.map((p) => p.v), price], change: anchor ? (price / anchor - 1) * 100 : null };
      });
    } catch { /* prices stay unavailable; the mix still shows weights */ }
    document.querySelectorAll("[data-mix]").forEach((el) => { if (el._redraw) el._redraw(); });
  }
  const fmtPrice = (v) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
  function spark(values, up) {
    if (!values || values.length < 2) return "";
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => `${(2 + (i / (values.length - 1)) * 76).toFixed(1)},${(21 - ((v - min) / span) * 18).toFixed(1)}`);
    const last = pts[pts.length - 1].split(",");
    return `<svg class="spark ${up ? "up" : "down"}" viewBox="0 0 80 24" aria-hidden="true"><polyline points="${pts.join(" ")}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6"/></svg>`;
  }

  // ---------- Mix rule (same as the app) ----------
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

  // ---------- Mix visuals: treemap tiles (hero), allocation bar + weights (rounds, phone) ----------
  // Colours: ink -> greens, largest weight first (same ramp as the app). Light text on the first three, ink text on the rest.
  const COLORS = ["#07110c", "#1e4f37", "#2f6b4b", "#6fa687", "#9cc5af", "#2bd67b", "#5ee09b", "#a5ebc9"];
  const LIGHT_TEXT = [true, true, true, false, false, false, false, false];
  const rankOf = (entries) => { const live = entries.filter((e) => e.w !== null).sort((a, b) => b.w - a.w || SYMBOLS.indexOf(a.s) - SYMBOLS.indexOf(b.s)); return new Map(live.map((e, r) => [e.s, r])); };
  const chg = (p) => (!p || p.change === null ? "" : `${p.change >= 0 ? "+" : "\u2212"}${Math.abs(p.change).toFixed(2)}%`);

  function squarify(items, W, H) {
    const total = items.reduce((s, i) => s + i.v, 0); const out = []; let x = 0, y = 0, w = W, h = H;
    let rest = items.map((i) => ({ ...i, a: (i.v / total) * W * H }));
    const worst = (row, side) => { const s = row.reduce((t, r) => t + r.a, 0); const mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
    while (rest.length) {
      const side = Math.min(w, h); const row = [rest[0]]; let i = 1;
      while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
      const s = row.reduce((t, r) => t + r.a, 0);
      if (w >= h) { const cw = s / h; let cy = y; row.forEach((r) => { const rh = r.a / cw; out.push({ ...r, rx: x, ry: cy, rw: cw, rh }); cy += rh; }); x += cw; w -= cw; }
      else { const rh = s / w; let cx = x; row.forEach((r) => { const rw = r.a / rh; out.push({ ...r, rx: cx, ry: y, rw, rh }); cx += rw; }); y += rh; h -= rh; }
      rest = rest.slice(row.length);
    }
    return out;
  }

  // Treemap: live stocks as tiles sized by weight; stocks not in the live mix yet as dashed "Round 5" tiles below.
  // entries: { s, w (percent, null = not in the live mix) }
  function renderTreemap(el, entries) {
    if (!el) return;
    el.setAttribute("data-mix", ""); el._redraw = () => renderTreemap(el, entries);
    const W = el.clientWidth || 340; const H = W < 560 ? Math.round(W * 0.95) : Math.round(Math.min(W * 0.46, 340));
    const live = entries.filter((e) => e.w !== null && e.w > 0).sort((a, b) => b.w - a.w || SYMBOLS.indexOf(a.s) - SYMBOLS.indexOf(b.s));
    const ghosts = entries.filter((e) => e.w === null);
    const ranks = rankOf(entries); const GAP = 3;
    const rects = live.length ? squarify(live.map((e) => ({ ...e, v: e.w })), W, H) : [];
    const tile = (r) => {
      const p = PRICES[r.s]; const rank = ranks.get(r.s) || 0; const big = r.w >= 20;
      const sub = p ? `$${fmtPrice(p.price)}${chg(p) ? ` \u00b7 ${chg(p)}` : ""}` : "";
      return `<div class="tile ${LIGHT_TEXT[Math.min(rank, 7)] ? "lt" : ""}" style="left:${r.rx + GAP / 2}px;top:${r.ry + GAP / 2}px;width:${Math.max(r.rw - GAP, 0)}px;height:${Math.max(r.rh - GAP, 0)}px;background:${COLORS[Math.min(rank, 7)]}" title="${NAMES[r.s]}"><b class="mono">${r.s}</b><span class="tw ${big ? "big" : ""}">${r.w.toFixed(r.w < 10 ? 1 : 1)}%</span>${sub ? `<small class="mono">${sub}</small>` : ""}</div>`;
    };
    const ghost = (e) => { const p = PRICES[e.s]; return `<div class="gtile" title="${NAMES[e.s]}"><b class="mono">${e.s}</b><span>Round 5</span>${p ? `<small class="mono">$${fmtPrice(p.price)}${chg(p) ? ` \u00b7 ${chg(p)}` : ""}</small>` : ""}</div>`; };
    el.innerHTML = (live.length ? `<div class="tm" style="height:${H}px">${rects.map(tile).join("")}</div>` : "") + (ghosts.length ? `<div class="ghosts">${ghosts.map(ghost).join("")}</div>` : "");
  }

  // Allocation bar (no labels on the bar) with one row per stock underneath: key, ticker, name, weight.
  function renderBarRows(el, entries) {
    if (!el) return;
    const live = entries.filter((e) => e.w !== null && e.w > 0).sort((a, b) => b.w - a.w || SYMBOLS.indexOf(a.s) - SYMBOLS.indexOf(b.s));
    const ranks = rankOf(entries);
    el.innerHTML = `<div class="abar" role="img" aria-label="Allocation by weight">${live.map((e) => `<span style="flex-grow:${e.w};background:${COLORS[Math.min(ranks.get(e.s), 7)]}"></span>`).join("")}</div><ul class="mrows">${live.map((e) => `<li><i style="background:${COLORS[Math.min(ranks.get(e.s), 7)]}"></i><b class="mono">${e.s}</b><span class="nm">${NAMES[e.s]}</span><em class="mono">${e.w.toFixed(2)}%</em></li>`).join("")}</ul>`;
  }
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => document.querySelectorAll("[data-mix]").forEach((el) => { if (el._redraw) el._redraw(); }), 150); });

  const fmtDate = (s) => new Date(s * 1000).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " WAT";
  function countdown(sec) {
    if (sec <= 0) return "Closing";
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }

  void loadPrices();

  async function load() {
    const latestId = Number(words(await call(VOTES, SEL.latest))[0]);
    const rounds = [];
    for (let id = FIRST_ROUND; id <= latestId; id++) { const r = await readRound(id); if (r) rounds.push(r); }
    const latest = rounds[rounds.length - 1];
    const lastClosed = [...rounds].reverse().find((r) => r.closed);
    const buy = lastClosed || (latest && latest.total > 0n ? latest : null);
    const nowSec = () => Math.floor(Date.now() / 1000);
    const open = latest && !latest.closed && nowSec() < latest.closes ? latest : null;

    // Hero mix: the mix you can buy; stocks that join in round 5 are shown dashed with their ticker.
    const entries = SYMBOLS.map((s, i) => ({ s, w: buy && i < buy.n ? Number(buy.weights[i]) / 100 : null }));
    if (buy) {
      renderTreemap($("hero-dots"), entries);
      $("hero-cap").textContent = lastClosed ? `This week's mix · Round ${buy.id} final · ${buy.n} stocks. Tile size = weight. Price · 24h change from Chainlink. Dashed tiles join in round ${open && open.n === 8 ? open.id : 5}.` : `Preview mix · Round ${buy.id} live · ${buy.n} stocks. Tile size = weight. Price · 24h change from Chainlink. Dashed tiles join in round 5.`;
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
      renderBarRows($("phone-dots"), buy.weights.map((w, i) => ({ s: SYMBOLS[i], w: Number(w) / 100 })));
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

    // Stats (with correct plurals; a failed request shows n/a, never a misleading 0)
    const voteLogs = await Promise.all([VOTES, ...RETIRED].map((a) => logs(a, TOPIC.vote)));
    const votesKnown = voteLogs.every((l) => l !== null);
    const votes = voteLogs.reduce((s, l) => s + (l ? l.length : 0), 0);
    const tradeLogs = await logs(ROUTER, TOPIC.trade);
    const trades = tradeLogs ? tradeLogs.length : null;
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
      li.innerHTML = `<h3>Round ${r.id}<small class="${r.closed ? "final" : ""}">${status}</small></h3><div class="mixbar"></div><p>${r.total} ${plural(r.total, "vote", "votes")} · ${r.total} $WIF burned · ${r.n} stocks · closes ${fmtDate(r.closes)}</p><p>${links}</p>`;
      list.appendChild(li);
      renderBarRows(li.querySelector(".mixbar"), r.weights.map((w, i) => ({ s: SYMBOLS[i], w: Number(w) / 100 })));
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

# Stock expansion study (read-only)

Snapshot: 2026-11-05T14:49:59.880Z UTC, US market session `REGULAR`, sequencer operator status `OPERATIONAL`.
Script: `web/relayer/stock-study.mjs` (no transactions). Raw data: `research/stock-study.json`.

## Method
1. Token and feed list: the oracle-health endpoint of our relayer API (`/api/stock-token/oracle-health`) returns every Stock Token with a Chainlink feed (58 feeds: 35 equity/ETF, 23 crypto). Token addresses cross-checked against Robinhood's Token Contracts directory (docs.robinhood.com/chain/contracts, about 200 Stock Tokens; only 35 have a Chainlink feed).
2. Pool check: Uniswap QuoterV2 `quoteExactInput` for USDG → token at fee tiers 0.01%, 0.05%, 0.3%, 1%.
3. Fill vs Chainlink: price paid per token for 1, 10, 50 and 100 USDG, as basis points (bps) from the Chainlink answer. The app's guard rejects anything over 200 bps. The table shows, per stock, the fee tier whose worst deviation across the four sizes is smallest.

## Results (29 of 35 feed-backed stocks have a USDG pool)
| Stock | Best pool fee | Chainlink ($) | 1 USDG (bps) | 10 USDG | 50 USDG | 100 USDG | Verdict |
|---|---|---|---|---|---|---|---|
| AAPL **proposed** | 0.05% | 352.84 | +9 | +9 | +9 | +10 | PASS |
| AMD | 0.30% | 431.77 | +47 | +47 | +48 | +50 | PASS |
| AMZN **proposed** | 0.30% | 266.56 | +7 | +7 | +7 | +7 | PASS |
| ASML | 1.00% | 1421.75 | +183 | +189 | +218 | +244 | FAIL (over 2% at some size) |
| BABA | 0.30% | 107.66 | +17 | +18 | +18 | +19 | PASS |
| CLSK | n/a | n/a | n/a | n/a | n/a | n/a | no USDG pool |
| COIN | 0.05% | 143.87 | +11 | +13 | +19 | +27 | PASS |
| CRCL | 0.30% | 70.07 | +25 | +25 | +25 | +25 | PASS |
| CRWV | n/a | n/a | n/a | n/a | n/a | n/a | no USDG pool |
| DELL | 1.00% | 340.03 | +20 | +20 | +23 | +27 | PASS |
| EWY | n/a | n/a | n/a | n/a | n/a | n/a | no USDG pool |
| GME | 0.05% | 24.63 | +9 | +9 | +10 | +10 | PASS |
| GOOGL **proposed** | 0.05% | 288.68 | -11 | -11 | -12 | -11 | PASS |
| INTC | 0.30% | 54.09 | +49 | +49 | +51 | +52 | PASS |
| IONQ | 1.00% | 27.02 | +7156 | +156011 | +820053 | +1650106 | FAIL (over 2% at some size) |
| META **proposed** | 0.30% | 616.39 | +22 | +22 | +22 | +22 | PASS |
| MSFT **proposed** | 0.30% | 549.55 | +5 | +5 | +5 | +5 | PASS |
| MSTR | 0.30% | 135.99 | +55 | +56 | +62 | +69 | PASS |
| MU | 0.30% | 725.37 | +16 | +16 | +16 | +16 | PASS |
| NBIS | n/a | n/a | n/a | n/a | n/a | n/a | no USDG pool |
| NVDA **proposed** | 0.05% | 190.87 | +6 | +6 | +6 | +6 | PASS |
| ORCL | n/a | n/a | n/a | n/a | n/a | n/a | no USDG pool |
| PLTR | 0.30% | 158.90 | +43 | +43 | +46 | +49 | PASS |
| QQQ | 0.30% | 673.17 | +4 | +5 | +9 | +15 | PASS |
| RGTI | n/a | n/a | n/a | n/a | n/a | n/a | no USDG pool |
| RKLB | 1.00% | 47.67 | +5454 | +137743 | +728717 | +1467434 | FAIL (over 2% at some size) |
| SGOV | 0.05% | 101.41 | +1 | +1 | +1 | +1 | PASS |
| SLV | 0.30% | 47.12 | +20 | +20 | +21 | +21 | PASS |
| SNDK | 1.00% | 904.58 | +84 | +123 | +227 | +344 | FAIL (over 2% at some size) |
| SPCX | 0.30% | 128.04 | -4 | -4 | -4 | -4 | PASS |
| SPY **proposed** | 0.05% | 759.17 | -5 | -5 | -5 | -5 | PASS |
| TSLA **proposed** | 0.30% | 351.58 | +24 | +24 | +24 | +25 | PASS |
| TSM | 1.00% | 374.87 | +156 | +156 | +158 | +160 | WATCH (within 2% but thin margin) |
| USAR | 0.30% | 7.55 | +10 | +15 | +37 | +64 | PASS |
| USO | 0.30% | 147.28 | +25 | +25 | +25 | +25 | PASS |

Notes:
- `PASS` means within 1% of Chainlink at every tested size. IONQ and RKLB pools are almost empty: the 1 USDG quote looks plausible but 10 USDG is off by thousands of times. A single-size 1 USDG check is not enough, so the guard must keep quoting the exact leg amount (it does).
- Chainlink's feed value is the token price already adjusted by the token's multiplier (dividends, splits), per Robinhood's docs, so it compares directly with the pool price.
- Quote deviations include the pool fee, so 0.3% pools start about 30 bps off by construction.
- This is one snapshot during the regular session. Outside US market hours quotes and feeds drift; re-run before opening round 5.

## Proposed round 5 list (8 stocks, appended so round 4's indexes 0-2 stay valid)
| Index | Stock | Pool fee | Why |
|---|---|---|---|
| 0 | AAPL | 0.05% | existing, within 10 bps to 100 USDG |
| 1 | NVDA | 0.05% | existing, within 6 bps |
| 2 | MSFT | 0.3% | existing, within 5 bps |
| 3 | AMZN | 0.3% | within 7 bps, only one pool |
| 4 | GOOGL | 0.05% | within 12 bps |
| 5 | META | 0.3% | within 22 bps |
| 6 | TSLA | 0.3% | 0.3% pool stable at 24 bps (the 0.05% pool drifts to 31 at 100 USDG) |
| 7 | SPY | 0.05% | S&P 500 ETF, within 5 bps, deepest pool |

Runners-up that pass: MU, QQQ, SPCX, GME, BABA, COIN, DELL, CRCL, USO, SLV, SGOV.
Excluded: no USDG pool (CLSK, CRWV, EWY, NBIS, ORCL, RGTI); over 2% at some size (ASML, SNDK, IONQ, RKLB; TSM and DELL sit in a 1% pool, within 2% at every size but with less headroom); not proposed although they pass (40 to 70 bps off at best, so less headroom under the 2% guard): AMD, INTC, PLTR, MSTR, USAR.

## What changing the list touches
- Contract: `FlatstockVotes` allows 2 to 8 assets per round, so `openRound(5, 8, closesAt)` works. No contract change.
- Web: extend `assets` in `web/src/config.ts` in this order; rounds with `assetCount` 3 keep using indexes 0-2.
- Relayer: buy legs already accept up to 8; the sell allow-list (`stockTokenAddresses` in `web/relayer/server.ts`) needs the 5 new tokens.
- Landing: the rounds list and symbols are hard-coded for 3; extend to 8.
- Cost: an 8-leg gasless buy costs the relayer roughly 2.5x a 3-leg buy (gas scales with legs).

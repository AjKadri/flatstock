# Monday 9 Nov: close round 4, open round 5 (draft, needs your approval for every transaction)

Read with `ROUND4-CLOSE.md` (the close itself). Nothing here is run without your yes.

## Facts
- Round 4 `closesAt` = 1794232800 = Mon 9 Nov 15:00 WAT = 14:00 UTC.
- Round 5 `closesAt` = **1794837600** = Mon 16 Nov 15:00 WAT = 14:00 UTC (checked with `date -r`).
- Weekly rhythm after that: rounds close every Monday 15:00 WAT (round 6 would be 1795442400, Mon 23 Nov).
- `openRound` is owner-only. The owner is `0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4`, the relayer wallet, so the key is the one your shell already has as `M1_RELAYER_PRIVATE_KEY` (I never read or print it).
- `closeRound(4)` is permissionless and reverts before 15:00:00 WAT.

## Two things that need a decision from you
1. **The US market opens at 15:30 WAT (09:30 ET), 30 minutes after the 15:00 close.** A study run at 15:00 sees pre-open conditions: Chainlink feeds can be stale or paused and pool prices can drift from a stale feed, so good stocks can fail for the wrong reason. Recommended: close round 4 at 15:00, run the study at about **15:35**, open round 5 right after (about 15:40). Buying keeps working in the gap (it uses round 4's final mix), only voting waits about 40 minutes. If you want a strictly back-to-back open at 15:00, we run the study on Friday evening in market hours and open at 15:00 on that list.
2. **The app maps on-chain index to stock by a fixed order** (`assets` in `web/src/config.ts`: AAPL, NVDA, MSFT, AMZN, GOOGL, META, TSLA, SPY). If a stock must be dropped, the order on chain must still match the app, so:
   - dropping from the **end** of the list (SPY, then TSLA, ...) needs only `assetCount` smaller, no deploy;
   - dropping a stock in the **middle** changes every later index, so I must change the config (and landing symbols) and you must push and wait for Vercel **before** the open transaction. Otherwise votes would be mislabelled.
   Tell me which you prefer. My suggestion: drop from the end only, and swap by deploy if a middle stock truly fails.

## Steps (assuming the recommended timing)
1. **Friday 6 Nov evening (market hours), read-only:** `node web/relayer/stock-study.mjs > research/stock-study.json`. I show you the table.
2. **Mon 9 Nov 15:00:30 WAT: close round 4.** Same steps as `ROUND4-CLOSE.md` section B (bot or `cast`). I confirm `rounds(4).closed = true` and read the final weights.
3. **Mon 9 Nov about 15:35 WAT: re-run the study** (same command). I drop any stock that fails (over 2% at any size, or no pool) keeping the remaining order, and **show you the final list, `assetCount` and the exact command before anything is sent**.
4. **Choose the vote share** (see the table in my report): 50% (round 4's value) or 75%.
5. **Open round 5 (needs your yes).** Dry run first, then send:
   ```bash
   cast estimate 0x4BB945800d588E6B4DB287b3fCe9C13f7825A968 'openRound(uint256,uint8,uint64,uint16)' 5 8 1794837600 5000 --from 0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4 --rpc-url https://rpc.mainnet.chain.robinhood.com
   cast send 0x4BB945800d588E6B4DB287b3fCe9C13f7825A968 'openRound(uint256,uint8,uint64,uint16)' 5 8 1794837600 5000 --rpc-url https://rpc.mainnet.chain.robinhood.com --private-key "$M1_RELAYER_PRIVATE_KEY" --json
   ```
   Replace `8` with the final `assetCount` and `5000` with `7500` if you pick 75%. Use the 4-argument form so the vote share is explicit. The relayer wallet pays about 0.0000016 ETH (75,363 gas estimated read-only on 5 Nov), from the same balance that sponsors gas.
6. **Verify (read-only, I run it):** `rounds(5)` shows 8 assets and `closesAt` 1794837600; `voteShareBps(5)` matches; the app header reads "This week: Round 4 final mix (3 stocks). Voting now: Round 5, 8 stocks, for next week."; I record both transactions in `CHECKS.md`.
7. **Round 5 close (Mon 16 Nov 15:00 WAT):** same as step 2, then open round 6 with `closesAt` 1795442400 after the same study.

## Pre-flight (before Monday)
- The new app, landing and relayer are deployed (new tokens in the relayer sell allow-list).
- Relayer ETH above 0.0003 with room: an 8-leg gasless buy costs about 0.0000223 ETH at the live gas price.
- Vercel env unchanged (`VITE_VOTES_ADDRESS`, `VITE_META_*`).

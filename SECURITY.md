# Flatstock security review

Reviewed 6 Nov 2026 by reading the code. No mainnet transaction was sent for this review. The two Medium findings that could be fixed in the relayer (F1, F3) were fixed the same day; see below. This is a self-review by the author's coding agent, **not an independent audit**. Flatstock is hackathon software: use small amounts.

Scope: `src/FlatstockRouter.sol`, `src/FlatstockLock.sol`, `src/FlatstockVotes.sol`, `src/FlatstockEIP712.sol`, `web/relayer/server.ts` (and its sponsorship guard), and the app's signing code in `web/src/lib/chain.ts`.

## Summary

- Nobody, including the operator, can take, freeze or redirect a user's funds through the three contracts. Funds move only on the owner's own signature or transaction, and always go to the signer's own wallet.
- There are no proxies and no upgrade path. The three contracts contain no `delegatecall` and no `selfdestruct`. They are immutable.
- **Router and Lock have no owner** and no admin function. **Votes has one immutable owner (the relayer hot wallet); it can only open rounds.**
- Approvals are exact. The app approves 1 $WIF (vote), 10 $WIF (lock), or the exact USDG / Stock Token amount of the action in progress.
- Signed actions use EIP-712 with chain ID and contract address in the domain, a per-user nonce that is consumed on use, and a deadline. Signatures with a high `s` value are rejected.
- No High or Critical issue was found. The findings below are Medium, Low and Info, with mitigations. F1 and F3 are **fixed** (relayer only, no contract change); F2 remains as a bounded Medium.

## What the contracts can and cannot do

| Question | Answer | Where |
| --- | --- | --- |
| Can the operator take user funds? | No. There is no function that moves a user's tokens except through that user's own call or signature. | all three |
| Can contracts be changed? | No. No proxy, no `delegatecall`, no `selfdestruct`, immutables only. | all three |
| Who owns what? | Router: nobody. Lock: nobody. Votes: `owner` (immutable) = relayer wallet `0x6956…75F4`. | source |
| What can the Votes owner do? | Only `openRound` (two overloads). It cannot touch votes, weights, balances or the burn. `closeRound` is open to anyone after the close time. | `FlatstockVotes.sol` |
| Can the Lock owner... | There is none. `unlock(amount)` only returns the caller's own balance. State is updated before the transfer. | `FlatstockLock.sol` |
| Can signatures be replayed? | No. Each signed action carries a nonce read from the contract and incremented before any external call, plus a deadline. The domain binds the chain ID and the contract address, so a signature cannot be used on another chain or contract. | `FlatstockEIP712.sol`, Router, Votes |
| Where do bought and sold tokens go? | The swap recipient is always the signer (`user`) or `msg.sender`. | Router |
| Are approvals exact? | Yes. The app approves the exact amount and the Router approves the swap router for the exact leg amount. | app, Router |

## Findings

Severity is for this product at its current scale. "Mitigated" says what limits the damage today.

### F1 · Medium · FIXED · The 2% Chainlink check was enforced by the app, not the relayer

The contract enforces only that each leg's `amountOutMinimum` is non-zero and that the legs sum to the signed amount. The 2% bound against Chainlink was computed **only in the app**; the relayer checked the signature and that the minimum was positive. A modified website could have asked a user to sign a poor minimum, which the relayer would have paid gas to submit.

- **Fix (`web/relayer/price-guard.ts`, wired into `relayBuy` and `relaySell`):** before it relays any `buyMixBySig` or `sellBySig`, the relayer reads each leg's Chainlink feed and rejects the action if the signed `amountOutMinimum` is more than 2% below the Chainlink-implied output. Integer maths, rounded in the user's favour. For a sell the check runs before the permit transaction, so no gas is spent on a refused sell.
- **Fails closed:** unknown token (no feed), feed price zero or negative, feed update older than 24 hours or in the future, unreadable feed, QuickNode oracle health not `OK`/`MARKET_CLOSED`, stale or paused, or the health service unavailable. The user sees a plain message such as "NVDA: the minimum you signed (…) is more than 2% below the Chainlink price (at least … expected), so this buy was not relayed. Nothing was spent."
- **App change that goes with it:** the app now signs `max(quote − 2%, Chainlink-implied − 2%)`, using the same integer maths (imported from the relayer module), so a normal plan is never refused. This can only make the signed minimum stricter.
- **Side effect:** this also closes the "buy legs are not allow-listed" point in F7. A buy leg for a token with no Flatstock feed is now refused.
- **Direct wallet transactions are unaffected.** Someone who sends a trade from their own wallet pays their own gas and the relayer is not involved; the contract still requires a non-zero minimum.
- **Tests:** `relayer/price-guard.test.ts` (10 unit tests: good leg passes, exactly 2% passes, 3% and 2.01% below are rejected for buy and sell, stale / future / zero / negative price, unknown token, unreadable feed, paused or unhealthy oracle, multi-leg with one bad leg, and a check that the relayer's feed table equals `web/src/config.ts`). `relayer/price-guard.fork.test.ts` runs on a local anvil fork against the **real** Chainlink feeds, Stock Tokens and Uniswap quoter for AAPL, NVDA and MSFT: a leg 1.5% below Chainlink passes, a leg 3% below is rejected (buy and sell), a feed more than 24h old rejects a perfect leg, and the implied output is within 5% of the live pool quote (a check on decimals). Run: `bash web/relayer/run-fork-test.sh`.

### F2 · Medium · Relayer drain by many wallets

The daily cap (3 per wallet) is per wallet, and a wallet needs only 10 $WIF locked, which the owner gets back on unlock. A person with many wallets could use many sponsored actions and spend the relayer's ETH.

- Mitigated by: each action costs the abuser real $WIF and a signature; the relayer pauses automatically when its balance drops below 0.0003 ETH; there is a kill switch; the relayer holds only gas ETH; losing it costs gas money, not user funds.
- Possible later hardening: a global daily cap, and a minimum lock age (can be added in the relayer without any contract change).

### F3 · Medium · FIXED (relayer) · Open RPC proxy, no rate limiting or body limit

`POST /api/rpc` forwarded any JSON-RPC call to the paid QuickNode endpoint with no rate limit and no size limit, and the `Origin` check is a browser/CORS control only (requests with no `Origin` header, such as curl, are accepted by design).

- **Fix (`web/relayer/rpc-policy.ts`, `rate-limit.ts`, `server.ts`):**
  - **Method allow-list:** `eth_call`, `eth_getLogs`, `eth_blockNumber`, `eth_chainId`, `net_version`, `eth_getTransactionReceipt`, `eth_getTransactionByHash`, `eth_getBalance`, `eth_getCode`, `eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_estimateGas`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getTransactionCount`. Everything else is refused, including `eth_sendRawTransaction`, `eth_sendTransaction`, `eth_sign`, `eth_getStorageAt`, `debug_*`, `trace_*`, `admin_*`, subscriptions and filters. Nothing the app needs sends a transaction through the proxy: the wallet sends its own.
  - **`eth_getLogs`:** the filter must name Flatstock contracts only (the current and retired vote contracts, the router, the old buy router), may not use `blockHash`, may not start before block 101,593,767 (the app's first block) or at `earliest`, and may span at most 25 million blocks (the app reads from its first block to the latest, about 6 million today).
  - **`eth_call` / `eth_estimateGas`:** at most two params, so no state-override sets.
  - **Batches:** at most 20 calls per request; one disallowed call rejects the whole batch.
  - **Body limit:** 512 KB for `/api/rpc` (the app's Multicall price request is about 220 KB), 64 KB for the relay routes; larger gets HTTP 413.
  - **Rate limit:** per client IP, 600 requests a minute (`M3_RPC_RATE_PER_MINUTE`), then HTTP 429 with `Retry-After`. A single page load makes roughly 100 to 150 requests, so this leaves room for a few reloads. The IP is the last `X-Forwarded-For` entry, which Caddy sets.
- **Verified with the real app:** the mix, the live prices and the 24h change load through the new proxy (the Multicall price request passes the body limit); no request was refused by the policy.
- **Tests:** `relayer/rpc-policy.test.ts` (allowed methods, 13 refused methods, batch bounds, `eth_getLogs` address / range / `blockHash` / `earliest` cases, rate limiter) and `relayer/rpc-proxy.test.ts`, which starts the real `server.ts` against a stub upstream and checks: allowed reads and batches are forwarded; `eth_sendRawTransaction` (alone or inside a batch) is refused and **never reaches the upstream**; an unbounded `eth_getLogs` is refused; an oversize body gets 413; a realistic 220 KB price request passes; the 9th request in a minute from one IP gets 429 while another IP is unaffected.
- **Remaining, at the edge:** a Caddy-level connection limit is still sensible but no longer required to protect the quota. The relay routes (`/api/meta/*`) have a body limit and the daily cap but no per-IP rate limit.

### F4 · Low · `sqrtPriceLimitX96` is not part of the signed sell message

`sellBySig` takes `sqrtPriceLimitX96` as a parameter that is **not** covered by the user's `SellStock` signature (the buy message does cover it, inside the legs hash). A malicious submitter could pass a price limit that causes a partial fill. The signed `amountOutMinimum` still has to be met for the whole amount, so a partial fill almost always reverts. In the rare case where it does not, the unspent input stays in the Router, which has no way to return it.

- Mitigated by: the signature is seen only by the relayer before the transaction is mined, and the relayer rejects any sell whose price limit is not zero (`relaySell`). After inclusion the nonce is spent. It would take a malicious operator, and the loss is limited to the unsold remainder of one sell.
- Not fixable without redeploying the Router. Documented here so it is not a surprise.

### F5 · Low · Votes owner is a hot wallet, and it now opens rounds automatically

The relayer key also owns the Votes contract. From round 6 on, the round bot on the VPS signs `openRound` with that key by itself every week (and `closeRound`, which anyone can call). If the key were stolen, an attacker could open rounds with arbitrary IDs, asset counts and vote shares. Because `latestRoundId` only goes up, a bogus high round ID would stay "latest" and the real round would have to use a higher ID. This is a griefing and availability risk; the attacker cannot touch any $WIF, votes or user funds.

- Mitigated by: the key exists only on the server; the wallet holds only gas ETH; the app reads asset lists from its own fixed config, not from the contract.
- The bot itself can only call `closeRound` and `openRound` (one guarded write path, checked by a unit test) and it fails closed on every doubt:
  - it opens a round only when its signer address equals `owner()`, otherwise it only closes;
  - the new round copies the previous round's `assetCount` and `voteShareBps` (so at most 8 assets and at most 10000 bps) and its `closesAt` is the previous one plus 7 days, which must be a Monday 14:00:00 UTC, in the future and no more than 8 days ahead;
  - it simulates every call with `eth_call` first and sends nothing if the simulation fails or any RPC call errors;
  - it skips when the signer holds under 0.00005 ETH or has a transaction pending, and a second run in a row sends nothing;
  - it is off unless `CLOSE_ROUND_ENABLED=1` and `AUTO_OPEN_ENABLED=1` are set in the VPS-only env file.
- These guards limit what the bot does, not what a thief with the key could do by hand: the key can still call `openRound` directly. Possible later hardening: move ownership to a cold wallet or multisig and open each round from there.

### F6 · Low · Permit front-running and signature lifetime

- A Stock Token or USDG permit signature could be used by a third party if they saw it first, which would make the relayer's own permit call revert (griefing the user's sponsored action, no loss of funds). In practice the signature is sent only to the relayer. I believe the chain has no public mempool (Arbitrum-style sequencing), but I did not test that. The buy permit is submitted inside the same transaction as the buy.
- A relayed sell is two transactions (permit, then sell). If the second fails, the permit's allowance stays in place for that exact amount until its 5-minute deadline. The user can sell directly from their own wallet.
- Buy and vote signatures last 15 minutes; sell signatures 5 minutes. A signature the user made but the relayer never submitted can be submitted any time before its deadline. The signed minimum output still applies.

### F7 · Low · Relayer details

- **Admin route:** `POST /api/relay/kill-switch` requires `Authorization: Bearer <token>`. The token is compared with `!==` (not constant time) and there is no attempt limit. The route can only switch relaying on or off; it cannot move funds. The token is on the server only. A long random token and an edge rate limit make guessing impractical.
- **Daily cap in memory:** counters reset when the service restarts, and the check and the increment are not atomic, so parallel requests for one wallet could exceed the cap by a few actions. Bounded by the balance guard.
- **Buy legs:** previously not allow-listed in the relayer. Fixed with F1: a buy leg must be one of the eight Stock Tokens that have a Chainlink feed.
- **Health endpoint** shows the relayer address and ETH balance. Both are public on chain anyway.
- **Kill switch default:** the relayer starts with the kill switch **on** unless `M3_RELAYER_KILL_SWITCH=0` is set (fails closed).

### F8 · Low · Lock contract assumptions

- `lock` credits the requested `amount` rather than the balance actually received, so it assumes $WIF is a plain ERC-20 with no transfer fee. $WIF behaves that way today.
- Unlocking has no cooldown and no fee, so the lock is an eligibility check, not a long-term deposit. Abuse of free gas is bounded by F2's mitigations.
- Users who unlock between signing and relaying cause the sponsored action to revert (`NotLocked`). The relayer's gas estimate fails before it sends, so no gas is spent on that.

### F9 · Info · Frontend and wallets

- Zerion and MetaMask (Blockaid) may flag approvals of $WIF to new contracts. The app now shows the exact amount and the contract before each approval, and a plain-English summary before each signature. A false-positive report is drafted in `WALLET-WARNING-REPORT.md` (local, not committed).
- Free gas covers the vote, buy and sell transactions the relayer submits. Each vote needs its own exact 1 $WIF approval (the vote consumes it), which the user's own wallet sends, so the user pays the gas for that small approval on every vote, even with free gas.

## Source verification status

| Contract | Address | Sourcify | Blockscout |
| --- | --- | --- | --- |
| FlatstockVotes | `0x4BB9…A968` | exact match (3 Nov) | exact match (CHECKS.md) |
| FlatstockRouter | `0x8799…dbe7` | exact match (3 Nov) | recorded as exact in the docs; recheck |
| FlatstockLock | `0x2421…E121` | **exact match, creation and runtime (6 Nov)** | not confirmed; recheck |

The Lock source was published to Sourcify on 6 Nov (no transaction; the source is already in the public repository) with constructor arguments WIF `0x5173…4773` and a 10 WIF minimum. The Blockscout API sits behind a Cloudflare challenge that the command-line tool cannot pass, so the Blockscout column for Router and Lock is unconfirmed: open the Code tab of each address on Blockscout to check it. If a contract shows as unverified there, Blockscout can import it from Sourcify, or use its "Verify & publish" page.

## What is mitigated, in one list

- Funds: no owner or upgrade path on Router or Lock; Votes owner can only open rounds.
- Replay: nonces, deadlines, chain ID and contract address in every signature.
- Slippage: a signed minimum on every leg, the 2% Chainlink guard, oracle freshness and health checks in the app, and the same 2% Chainlink check repeated by the relayer before it pays gas.
- RPC proxy abuse: read-method allow-list, bounded `eth_getLogs`, batch / body limits and a per-IP rate limit.
- Gas abuse: 3 per wallet per day, automatic low-balance pause, kill switch, $5 minimum sponsored buy.
- Key exposure: the relayer key and RPC URL live only in `/etc/flatstock/flatstock.env` on the server; Vercel holds only public `VITE_*` values.

## Not covered

No formal verification, no fuzzing beyond the Foundry tests and mainnet-fork tests in `CHECKS.md`, no review of Uniswap, the Stock Tokens, USDG, $WIF or QuickNode themselves, and no penetration test of the hosting.

## Reporting a problem

Open an issue in the repository or contact the project on X (@flatstockapp).

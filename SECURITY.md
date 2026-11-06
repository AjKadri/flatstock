# Flatstock security review

Reviewed 6 Nov 2026 by reading the code only. No mainnet transaction was sent for this review. This is a self-review by the author's coding agent, **not an independent audit**. Flatstock is hackathon software: use small amounts.

Scope: `src/FlatstockRouter.sol`, `src/FlatstockLock.sol`, `src/FlatstockVotes.sol`, `src/FlatstockEIP712.sol`, `web/relayer/server.ts` (and its sponsorship guard), and the app's signing code in `web/src/lib/chain.ts`.

## Summary

- Nobody, including the operator, can take, freeze or redirect a user's funds through the three contracts. Funds move only on the owner's own signature or transaction, and always go to the signer's own wallet.
- There are no proxies and no upgrade path. The three contracts contain no `delegatecall` and no `selfdestruct`. They are immutable.
- **Router and Lock have no owner** and no admin function. **Votes has one immutable owner (the relayer hot wallet); it can only open rounds.**
- Approvals are exact. The app approves 1 $WIF (vote), 10 $WIF (lock), or the exact USDG / Stock Token amount of the action in progress.
- Signed actions use EIP-712 with chain ID and contract address in the domain, a per-user nonce that is consumed on use, and a deadline. Signatures with a high `s` value are rejected.
- No High or Critical issue was found. The findings below are Medium, Low and Info, with mitigations.

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

### F1 · Medium · The 2% Chainlink check is enforced by the app, not the contract

The contract enforces only that each leg's `amountOutMinimum` is non-zero and that the legs sum to the signed amount. The 2% bound against Chainlink is computed **in the app** when it builds the plan (`buildBuyPlan`, `buildSellPlan`), and the user signs the resulting minimums. The relayer checks the signature and that the minimum is positive; it does **not** re-check the minimum against Chainlink. (An earlier note in the project said the relayer computes it. It does not.)

- Impact: if the website itself were compromised and served a modified app, it could ask a user to sign a plan with a poor minimum. The wallet shows raw typed data, so the user would not easily notice. Funds can only be sent to the user's own wallet, but a bad minimum allows a bad price.
- Mitigated by: the app is static and served from Vercel at a fixed tag (`submission`); the signed minimums are shown in plain English before signing; the contract cannot be pointed anywhere else.
- Possible later hardening (no contract change): have the relayer reject buys and sells whose minimums are more than 2% below its own Chainlink read.

### F2 · Medium · Relayer drain by many wallets

The daily cap (3 per wallet) is per wallet, and a wallet needs only 10 $WIF locked, which the owner gets back on unlock. A person with many wallets could use many sponsored actions and spend the relayer's ETH.

- Mitigated by: each action costs the abuser real $WIF and a signature; the relayer pauses automatically when its balance drops below 0.0003 ETH; there is a kill switch; the relayer holds only gas ETH; losing it costs gas money, not user funds.
- Possible later hardening: a global daily cap, and a minimum lock age (can be added in the relayer without any contract change).

### F3 · Medium · Open RPC proxy, no rate limiting or body limit in the relayer

`POST /api/rpc` forwards any JSON-RPC call to the paid QuickNode endpoint (falling back to the public RPC). The relayer has no rate limit and no request-size limit. Anyone who can reach the server can burn the QuickNode quota or send a very large body. The `Origin` check is a browser/CORS control only: requests with **no** `Origin` header (curl, scripts) are accepted by design.

- Impact: availability and quota, not funds. The relayer's key is never exposed through this route.
- Mitigated by: the key lives only in the server environment; the app falls back to the public RPC in the proxy; the service runs with `NoNewPrivileges` and a read-only filesystem.
- To do at the edge (Caddy or the host), not in the contracts: a request rate limit and a body-size limit on `api.flatstock.ajkadri.dev`.

### F4 · Low · `sqrtPriceLimitX96` is not part of the signed sell message

`sellBySig` takes `sqrtPriceLimitX96` as a parameter that is **not** covered by the user's `SellStock` signature (the buy message does cover it, inside the legs hash). A malicious submitter could pass a price limit that causes a partial fill. The signed `amountOutMinimum` still has to be met for the whole amount, so a partial fill almost always reverts. In the rare case where it does not, the unspent input stays in the Router, which has no way to return it.

- Mitigated by: the signature is seen only by the relayer before the transaction is mined, and the relayer rejects any sell whose price limit is not zero (`relaySell`). After inclusion the nonce is spent. It would take a malicious operator, and the loss is limited to the unsold remainder of one sell.
- Not fixable without redeploying the Router. Documented here so it is not a surprise.

### F5 · Low · Votes owner is a hot wallet

The relayer key also owns the Votes contract. If the key were stolen, an attacker could open rounds with arbitrary IDs, asset counts and vote shares. Because `latestRoundId` only goes up, a bogus high round ID would stay "latest" and the real round would have to use a higher ID. This is a griefing and availability risk; the attacker cannot touch any $WIF, votes or user funds.

- Mitigated by: the key exists only on the server; the wallet holds only gas ETH; the app reads asset lists from its own fixed config, not from the contract.
- Possible later hardening: move ownership to a cold wallet or multisig and open each round from there.

### F6 · Low · Permit front-running and signature lifetime

- A Stock Token or USDG permit signature could be used by a third party if they saw it first, which would make the relayer's own permit call revert (griefing the user's sponsored action, no loss of funds). In practice the signature is sent only to the relayer. I believe the chain has no public mempool (Arbitrum-style sequencing), but I did not test that. The buy permit is submitted inside the same transaction as the buy.
- A relayed sell is two transactions (permit, then sell). If the second fails, the permit's allowance stays in place for that exact amount until its 5-minute deadline. The user can sell directly from their own wallet.
- Buy and vote signatures last 15 minutes; sell signatures 5 minutes. A signature the user made but the relayer never submitted can be submitted any time before its deadline. The signed minimum output still applies.

### F7 · Low · Relayer details

- **Admin route:** `POST /api/relay/kill-switch` requires `Authorization: Bearer <token>`. The token is compared with `!==` (not constant time) and there is no attempt limit. The route can only switch relaying on or off; it cannot move funds. The token is on the server only. A long random token and an edge rate limit make guessing impractical.
- **Daily cap in memory:** counters reset when the service restarts, and the check and the increment are not atomic, so parallel requests for one wallet could exceed the cap by a few actions. Bounded by the balance guard.
- **Buy legs are not allow-listed in the relayer.** A user can sign a buy of any token through the sponsored path (sells are allow-listed). It only affects the signer, and each use counts toward the cap.
- **Health endpoint** shows the relayer address and ETH balance. Both are public on chain anyway.
- **Kill switch default:** the relayer starts with the kill switch **on** unless `M3_RELAYER_KILL_SWITCH=0` is set (fails closed).

### F8 · Low · Lock contract assumptions

- `lock` credits the requested `amount` rather than the balance actually received, so it assumes $WIF is a plain ERC-20 with no transfer fee. $WIF behaves that way today.
- Unlocking has no cooldown and no fee, so the lock is an eligibility check, not a long-term deposit. Abuse of free gas is bounded by F2's mitigations.
- Users who unlock between signing and relaying cause the sponsored action to revert (`NotLocked`). The relayer's gas estimate fails before it sends, so no gas is spent on that.

### F9 · Info · Frontend and wallets

- Zerion and MetaMask (Blockaid) may flag approvals of $WIF to new contracts. The app now shows the exact amount and the contract before each approval, and a plain-English summary before each signature. A false-positive report is drafted in `WALLET-WARNING-REPORT.md` (local, not committed).
- Free gas covers the vote, buy and sell transactions the relayer submits. A vote needs a one-time $WIF approval that the user's own wallet sends, so the user pays the gas for that small approval.

## Source verification status

| Contract | Address | Sourcify | Blockscout |
| --- | --- | --- | --- |
| FlatstockVotes | `0x4BB9…A968` | exact match (verified 3 Nov) | exact match (CHECKS.md) |
| FlatstockRouter | `0x8799…dbe7` | exact match (verified 3 Nov) | exact match as noted in the docs; recheck |
| FlatstockLock | `0x2421…E121` | **not verified** (no record) | not recorded; verify |

I could not query Blockscout from the review environment (it served a bot check), so the Blockscout column comes from `CHECKS.md`. To verify the Lock contract (deployed with WIF `0x5173…4773` and a 10 WIF minimum), run from the repo root:

```bash
forge verify-contract --chain-id 4663 --verifier sourcify \
  0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121 src/FlatstockLock.sol:FlatstockLock \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" 0x5173b8eA6923c2d40267890D45C46a3480954773 10000000000000000000)
```

```bash
forge verify-contract --chain-id 4663 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ \
  0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121 src/FlatstockLock.sol:FlatstockLock \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" 0x5173b8eA6923c2d40267890D45C46a3480954773 10000000000000000000)
```

Both publish the source, which is already in the public repository. If the compile output differs from the deployed bytecode (the Lock was deployed before a rename), the result may be a "partial match".

## What is mitigated, in one list

- Funds: no owner or upgrade path on Router or Lock; Votes owner can only open rounds.
- Replay: nonces, deadlines, chain ID and contract address in every signature.
- Slippage: a signed minimum on every leg, plus the 2% Chainlink guard, oracle freshness and health checks in the app.
- Gas abuse: 3 per wallet per day, automatic low-balance pause, kill switch, $5 minimum sponsored buy.
- Key exposure: the relayer key and RPC URL live only in `/etc/flatstock/flatstock.env` on the server; Vercel holds only public `VITE_*` values.

## Not covered

No formal verification, no fuzzing beyond the Foundry tests and mainnet-fork tests in `CHECKS.md`, no review of Uniswap, the Stock Tokens, USDG, $WIF or QuickNode themselves, and no penetration test of the hosting.

## Reporting a problem

Open an issue in the repository or contact the project on X (@flatstockapp).

# AGENTS.md: staked stock-tipster (World is Flat hackathon)

## Read first
PLAN.md (milestones, scope, checks), RULES.md, SPIKE.md. Build only what PLAN.md section 4 lists for the current tier.

## Stack
- **Contracts:** Solidity + Foundry. Robinhood Chain mainnet (chain ID 4663), Arbitrum Nitro.
- **Bots (keeper + AI tipsters):** TypeScript + viem, run on the user's Ubuntu VPS.
- **Web:** a small TypeScript frontend + viem/wagmi; mobile wallet in-app browsers must work.

## Chain facts
- $WIF: `0x5173b8eA6923c2d40267890D45C46a3480954773`. Read decimals on-chain.
- Explorer: https://robinhoodchain.blockscout.com. Public RPC `https://rpc.mainnet.chain.robinhood.com` is rate-limited; use a provider for bots.
- Feeds: Chainlink stock feeds (see docs.chain.link, Robinhood network). They update 24/5 in US market hours and already include `uiMultiplier`. Settle on "Stock Token value per feed".
- Use `block.timestamp`, never `block.number` (it's the L1 estimate on Nitro).
- No Robinhood Chain sequencer uptime feed exists. Don't fake one; the staleness check is the guard.

## Contract rules (from the spike)
- **Fixed at creation:** asset, direction, start price (fresh round), deadline (must be in US market hours, DST-aware), stake. Immutable after.
- **Settlement:** the caller supplies `roundId`. Require `round.updatedAt >= deadline` and the previous round's `updatedAt < deadline`, answer > 0, `oraclePaused()` false, settle once.
- **Guaranteed exit:** if unsettled by `deadline + W`, the call becomes Unresolved and the stake is fully refundable. No path may strand stake.
- **Reconciliation:** stake = returned + burned (+ pooled, if the second tier adds a winners' pool).

## Hard rules
- **No task is "done" until its PLAN.md acceptance check has been run and the output shown.**
- **Ask the user before any mainnet transaction that spends funds** beyond what they approved for that milestone.
- **Secrets:** env vars only. `.env`, keys and keystores are in `.gitignore` from the first commit. Never print keys.
- **No Robinhood name or logo** in product names, logos, handles or UI copy (brand rule). Don't pick a product name; the user decides.
- **Licence:** the user decides before the repo is public. Don't add one by default.
- Show a "Not available to US persons. Not investment advice." notice wherever Stock Token prices or calls appear.
- Don't build second-tier or "never" items early.
- After the submission tag, no pushes to the judged branch or deployment until judging ends (6 Nov), unless the organisers confirm changes are allowed.

## Tests
`forge test -vv` (unit + mainnet-fork tests with real feeds and real $WIF). Keep the spike's 45 tests passing and add: "later favourable round rejected", "settle twice reverts", "expiry refund always available".

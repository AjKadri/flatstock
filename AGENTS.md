# AGENTS.md: contributor guide for Flatstock

Flatstock lets $WIF holders vote on a weekly mix of Stock Tokens and buy that mix into their own wallet on Robinhood
Chain (4663), with free gas for wallets that lock 10 $WIF. See [README.md](README.md) for the product, contracts and
layout, [SECURITY.md](SECURITY.md) for the threat model, and [CHECKS.md](CHECKS.md) for the mainnet test log.

## Rules that matter
- **Funds and signatures.** Every action runs on the user's own signature (EIP-712, or an EIP-2612 permit for the exact
  amount). No EIP-7702, no "gas paid in $WIF", no admin path that can move user funds.
- **Keep the safety guards:** each swap leg within 2% of Chainlink (app and relayer), oracle freshness and health checks,
  fail closed when a quote or price is missing, relayer cap of 3 sponsored actions per wallet per day, low-ETH pause,
  kill switch, and the read-only RPC allow-list.
- **No secrets in the repo.** Keys and provider URLs (QuickNode, GetBlock) live in the server environment only
  (`deploy/flatstock.env.example` lists the names). The browser gets public `VITE_*` values only. Never commit `.env`.
- **Mainnet transactions** (including opening or closing a round) need the owner's explicit go-ahead each time, and a
  record in CHECKS.md.
- **Branding.** Say "Robinhood Chain". Do not use the Robinhood name or logo in product names, logos or handles. Keep
  the independence footer and the availability notice.

## Layout and commands
- `src/`, `test/`: Solidity (Foundry, 0.8.24). `forge test -vv`.
- `web/`: the app (Vite, React, viem). `npm ci --prefix web`, `npm run dev --prefix web`, `npm run build --prefix web`.
- `web/relayer/`: the relayer. Tests: `cd web && node --test relayer/*.test.ts src/lib/*.test.ts`. Mainnet-fork tests:
  `bash web/relayer/run-fork-test.sh` (needs Foundry's anvil).
- `landing/`: landing page and docs. The docs pages are generated: edit `scripts/gen-docs.py`, then run
  `python3 scripts/gen-docs.py`.
- `docs/runbooks/`: round close and round open steps. `docs/history/`: old plans, not current.

## Style
Small, logical commits with plain messages. Do not rewrite history. A change is done when its check has been run and the
output seen (tests, a transaction hash, or a screenshot).

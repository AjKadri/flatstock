# Flatstock

**Buy US stocks picked by the community, in one tap. Lock 10 $WIF for free gas.**

$WIF holders vote each week on a mix of Stock Tokens. Each vote burns 1 $WIF. When the round closes, anyone can buy
that mix into their own wallet in one transaction. Lock 10 $WIF and the relayer pays the gas. Flatstock is
self-custody: the app and the contracts never hold your Stock Tokens or your USDG.

Built for the World is Flat hackathon on Robinhood Chain (chain ID 4663).

## Live

| | |
| --- | --- |
| Landing page | https://flatstock.ajkadri.dev |
| App | https://app.flatstock.ajkadri.dev |
| Docs | https://flatstock.ajkadri.dev/docs |
| Relayer health | https://api.flatstock.ajkadri.dev/api/health |

## How it works

1. **Vote.** Each wallet gets one vote per round for one of the stocks on the ballot. The vote contract burns exactly
   1 $WIF. The closed round's weights blend the vote share with an equal-weight base (50/50 by default, set per round
   and shown in the app).
2. **Round closes.** Anyone can call `closeRound` after the closing time, and a bot does it every Monday. The final weights are stored on chain. The next round then opens automatically for the following week.
3. **Buy the mix.** The app builds one swap per stock (Uniswap pools on Robinhood Chain) and the router executes them
   in a single transaction. The Stock Tokens go straight to the signer's wallet. Each leg carries a minimum output
   within 2% of the Chainlink price, and the whole buy reverts if any leg falls short.
4. **No gas, if you lock.** Lock 10 $WIF in the lock contract (unlock any time, no fee, no wait). Then your votes,
   buys and sells are signed in your wallet (EIP-712; buys and sells also carry an EIP-2612 permit for the exact amount
   spent) and the relayer submits them and pays the ETH gas, up to 3 sponsored actions per wallet per day. The relayer cannot change
   what you signed. (The 1 $WIF vote approval and the 10 $WIF lock approval are ordinary wallet transactions that you
   pay for.) Without a lock, or if sponsorship is paused, you send the same actions from your wallet and pay your
   own gas.

There is no fee: the fee switch is at 0%. There is no EIP-7702 path and gas is never charged in $WIF.

## Contracts (Robinhood Chain, 4663)

All three are immutable: no proxy, no `delegatecall`, no `selfdestruct`. Source is verified on Sourcify (exact match);
the Blockscout links below are the address pages.

| Contract | Address | Role |
| --- | --- | --- |
| FlatstockVotes | [`0x4BB9…A968`](https://robinhoodchain.blockscout.com/address/0x4BB945800d588E6B4DB287b3fCe9C13f7825A968) | Rounds, one vote per wallet per round, burns 1 $WIF per vote. One owner (the relayer wallet) who can only open rounds. |
| FlatstockRouter | [`0x8799…dbe7`](https://robinhoodchain.blockscout.com/address/0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7) | Buys the mix and sells single stocks through Uniswap, by direct call or by user signature. No owner. |
| FlatstockLock | [`0x2421…E121`](https://robinhoodchain.blockscout.com/address/0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121) | Holds locked $WIF (minimum 10) that qualifies a wallet for free gas. No owner. |

Existing tokens: [$WIF](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773),
[USDG](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168). Earlier vote and buy
contracts from rehearsal rounds are retired; see the [docs](https://flatstock.ajkadri.dev/docs/contracts).

## Tech stack

- **Robinhood Chain** (Arbitrum Nitro, chain 4663) and its **Stock Tokens**: AAPL, NVDA, MSFT, AMZN, GOOGL, META,
  TSLA, SPY.
- **$WIF**: the vote and lock token.
- **Chainlink** stock price feeds: the 2% guard on every swap leg, enforced in the app and again in the relayer.
- **QuickNode Stock Token API**: portfolio balances in USD, corporate actions, oracle health, and transaction finality
  (the app waits for finality before saying "Buy complete"). QuickNode is also the fallback RPC.
- **GetBlock** RPC: the hackathon RPC endpoint and first choice for general chain reads. If it is unavailable or its
  access is withdrawn, the relayer falls back to QuickNode, then to the public RPC.
- **Uniswap** pools for the swaps.
- Foundry (Solidity 0.8.24) for the contracts; Vite, React and viem for the app; a small TypeScript relayer on a VPS.

## Security

Self-review of the contracts, relayer and signing code: [SECURITY.md](SECURITY.md). Summary: nobody, including the
operator, can take, freeze or redirect a user's funds through the contracts; signed actions bind chain, contract, nonce
and deadline; approvals are exact; the relayer re-checks every signed minimum against Chainlink, fails closed on stale
or paused oracles, caps sponsored actions, pauses when its own ETH is low, has a kill switch, and only forwards an
allow-list of read-only RPC methods. One bounded Medium finding (F2, many wallets draining the relayer's gas) is open
and documented. This was a self-review, not an independent audit.

## Evidence

[CHECKS.md](CHECKS.md) is the log of every mainnet transaction and acceptance check, with hashes.

## Repository layout

| Path | What |
| --- | --- |
| `src/` | Solidity contracts (`FlatstockVotes`, `FlatstockRouter`, `FlatstockLock`, `FlatstockEIP712`, plus retired legacy contracts) |
| `test/` | Foundry tests |
| `web/` | The app (Vite, React, viem). `web/src/` is the frontend, `web/src/lib/` its logic |
| `web/relayer/` | The relayer server and its tests: signature relay, price guard, sponsorship guard, RPC proxy and provider failover, round bot (closes each round and opens the next weekly round when enabled) |
| `landing/` | Landing page and the docs site (docs pages are generated by `scripts/gen-docs.py`) |
| `deploy/` | systemd units, Caddyfile template, env example and hosting notes |
| `docs/history/` | Earlier plans, kept for the record |
| `docs/runbooks/` | Round close and round open runbooks |
| `research/` | Hackathon rules and background research |
| `design/` | Brand and screen design work |

## Run it locally

```sh
npm ci --prefix web
npm run dev --prefix web        # the app on :5173; /api is proxied to a local relayer on :8787 (override with DEV_API_TARGET)
npm run build --prefix web      # type-check and production build
```

The browser only ever gets public `VITE_*` settings. Relayer keys and provider URLs live in the server environment
(see `deploy/flatstock.env.example`) and are never committed.

## Run the tests

```sh
forge test -vv                                                              # contracts
cd web && node --test relayer/*.test.ts src/lib/*.test.ts                  # relayer and app logic (fork tests skip themselves)
bash web/relayer/run-fork-test.sh                                          # mainnet-fork tests via a local anvil fork (needs Foundry)
```

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## Independence and availability

Flatstock is independent and not affiliated with Robinhood. "Robinhood Chain" names the network only.

Stock Tokens are not available to US persons. They are restricted in the United States, Canada, the United Kingdom and
Switzerland, and prohibited in Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar and
Venezuela ([Robinhood's list](https://docs.robinhood.com/rhj/restricted-jurisdictions), checked 5 Nov 2026). Nothing here
is investment advice, and you can lose money.

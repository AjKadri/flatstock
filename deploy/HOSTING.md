# Flatstock hosting preparation

This file prepares hosting only. It does not create Vercel projects, change
DNS, copy files to the VPS, or issue certificates.

## DNS records

At the `ajkadri.dev` DNS provider, add these records. Replace the VPS
placeholders with the actual public addresses before saving them.

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| CNAME | `flatstock` | `cname.vercel-dns.com.` | Vercel landing project |
| CNAME | `app.flatstock` | `cname.vercel-dns.com.` | Vercel app project |
| A | `api.flatstock` | `2.29.11.26` | VPS API |
| AAAA | `api.flatstock` | `<VPS_PUBLIC_IPV6>` | VPS API, only if the VPS has IPv6 |

Use the exact CNAME target Vercel shows if its domain screen gives a
project-specific target. Do not create an A record for either Vercel host.

## Connect the GitHub repository to Vercel

Repeat this flow for each project:

1. Open Vercel and choose `Add New...` then `Project`.
2. Choose `Import Git Repository` and select GitHub.
3. Authorize the Vercel GitHub integration for `AjKadri/flatstock`.
4. Select the `flatstock` repository and the `main` branch.
5. Set the project-specific root directory and build settings below.
6. Do not deploy until the API DNS, environment variables, and kill-switch
   state have been checked.

The repository is already available at
`https://github.com/AjKadri/flatstock`.

## Vercel projects

Create two projects from the repository. Keep the current repository and
branch selected. Do not add any private environment variables to Vercel.

### Landing project

- Project name: `flatstock-landing`
- Root directory: `landing`
- Framework preset: Other
- Build command: leave empty
- Output directory: leave empty
- Production domain: `flatstock.ajkadri.dev`

### App project

- Project name: `flatstock-app`
- Root directory: `web`
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm ci`
- Production domain: `app.flatstock.ajkadri.dev`

Add these public app variables in the Vercel project settings:

```text
VITE_RPC_URL=https://api.flatstock.ajkadri.dev/api/rpc
VITE_RELAYER_API=https://api.flatstock.ajkadri.dev/api
VITE_EXPLORER_URL=https://robinhoodchain.blockscout.com
VITE_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
VITE_META_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
VITE_META_ROUTER_ADDRESS=0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7
VITE_VOTE_SHARE_BPS=5000
VITE_STATS_FROM_BLOCK=101593767
```

`VITE_VOTES_ADDRESS` is the read address, and `VITE_META_VOTES_ADDRESS` must
point to the same signature-safe vote deployment. The app reads
`latestRoundId()` from that contract and follows the latest opened round
automatically. `VITE_META_ROUTER_ADDRESS` is the signature-safe trade
deployment. `VITE_ROUND_ID` is only a local fallback for the legacy contract
and is not needed in Vercel.

Do not add `M1_RELAYER_PRIVATE_KEY`, `M3_CLOSE_BOT_PRIVATE_KEY`,
`M3_RELAYER_ADMIN_TOKEN`, `QUICKNODE_RPC_URL`, or `ZEROX_API_KEY` to Vercel.

## VPS preparation

The VPS needs Node.js 20 or newer, Caddy, and a `flatstock` system user. Caddy
continues to own ports 80 and 443 and handles TLS. Copy the repository to
`/opt/flatstock`, then run:

```sh
ssh root@2.29.11.26
apt update
apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
useradd --system --home /opt/flatstock --shell /usr/sbin/nologin flatstock || true
install -d -o flatstock -g flatstock -m 755 /opt/flatstock
git clone https://github.com/AjKadri/flatstock.git /opt/flatstock
chown -R flatstock:flatstock /opt/flatstock
cd /opt/flatstock
sudo install -d -m 700 /etc/flatstock
sudo cp deploy/flatstock.env.example /etc/flatstock/flatstock.env
sudo chown root:root /etc/flatstock/flatstock.env
sudo chmod 600 /etc/flatstock/flatstock.env
npm ci --prefix /opt/flatstock/web
sudo install -m 644 deploy/flatstock-relayer.service /etc/systemd/system/flatstock-relayer.service
sudo install -m 644 deploy/flatstock-close-round.service /etc/systemd/system/flatstock-close-round.service
sudo install -m 644 deploy/flatstock-close-round.timer /etc/systemd/system/flatstock-close-round.timer
sudo systemctl daemon-reload
```

Before starting anything, fill `/etc/flatstock/flatstock.env` with the VPS-only
values. Set `M3_ALLOWED_ORIGIN=https://app.flatstock.ajkadri.dev`. Keep
`CLOSE_ROUND_ENABLED=0` and `AUTO_OPEN_ENABLED=0` until you have approved the weekly automation
(see "Round bot" below). Keep
`M3_RELAYER_KILL_SWITCH=1` until the app and HTTPS API have been checked and
you explicitly confirm signature relaying can resume. Put `QUICKNODE_RPC_URL` only in
this VPS file when available.

Add the prepared site block to the existing `/etc/caddy/Caddyfile`. Do not
replace other applications' site blocks:

```sh
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will obtain and renew the certificate for
`api.flatstock.ajkadri.dev`. The prepared block reverse-proxies to
`127.0.0.1:8788`.

Start the relayer only after TLS and the environment file are verified:

```sh
sudo systemctl enable --now flatstock-relayer
sudo systemctl status flatstock-relayer --no-pager
```

Then test:

```sh
curl -fsS https://api.flatstock.ajkadri.dev/api/health
```

To diagnose QuickNode authentication without revealing the endpoint, run this
on the VPS:

```sh
sudo /opt/flatstock/deploy/check-quicknode-chain.sh
```

It prints only `http_status` and `chain_id`. A healthy chain-4663 response is:

```text
http_status=200
chain_id=0x1237
```

The current VPS check reports `http_status=200` and `chain_id=0x1237`. If the
standard RPC call is unauthorized, it reports the HTTP status and
`chain_id=unavailable`. The script never prints `QUICKNODE_RPC_URL`.

The browser uses `/api/rpc` through this VPS. The proxy prefers
`QUICKNODE_RPC_URL` when it exists and falls back to `RPC_URL`; the QuickNode
endpoint is never sent to the browser. The relayer submits only the new EIP-712
signature-authorized vote and trade calls. `/api/relay` is retired and returns
HTTP 410, so an old EIP-7702 client cannot submit arbitrary delegated batches.

## Round bot (closes and opens the weekly rounds)

`flatstock-close-round.timer` runs `npm run close-round` one minute after boot and then every 5 minutes. Each run
reads `latestRoundId` N and `rounds(N)` and decides from chain state alone:

1. N open and `closesAt` not reached: logs `not-due` and exits.
2. N open and `closesAt` reached: simulates `closeRound(N)` with `eth_call`, sends it, waits for the receipt.
3. N closed and round N+1 does not exist: opens N+1 with N's `assetCount` and `voteShareBps(N)` (the 4-argument
   `openRound`) and `closesAt = N.closesAt + 604800` (more whole weeks if that is already past). Simulated first.
4. Otherwise logs `nothing-to-do` and exits.

Modes (both in `/etc/flatstock/flatstock.env`):

| `CLOSE_ROUND_ENABLED` | `AUTO_OPEN_ENABLED` | Behaviour |
|---|---|---|
| 0 | any | status only, never sends |
| 1 | 0 | closes the current round when due, never opens (the old `VOTE_ROUND_ID` / `CLOSE_ROUND_EXPECTED_CLOSES_AT` pins still apply) |
| 1 | 1 | closes when due, then opens the next weekly round; the pins are ignored and logged |

Guards, all fail closed and each logged as one JSON line (`action`): only `closeRound` and `openRound` can be called;
nothing is sent without a successful simulation; opening happens only when the signer address equals `owner()` (else
`not-owner`, close only); the new round must have 2 to 8 assets, a `closesAt` on a Monday 14:00:00 UTC that is in the
future and at most 8 days ahead, and `voteShareBps` at most 10000 (else `sanity-failed`); a signer balance under
0.00005 ETH gives `low-balance`; a pending transaction from the signer gives `pending-tx`; any RPC error gives
`rpc-error` and nothing is sent. Running the bot twice in a row never sends twice, because the second run sees the
new on-chain state. Tests: `node --test web/relayer/close-round-logic.test.ts` and `bash web/relayer/run-fork-test.sh`
(`close-round.fork.test.ts`, local anvil fork only).

Read the log: `sudo journalctl -u flatstock-close-round.service -n 30 --no-pager`.

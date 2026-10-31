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
VITE_ROUND_ID=3
VITE_VOTES_ADDRESS=<NEW_RULES_VOTE_CONTRACT_ADDRESS>
VITE_VOTE_SHARE_BPS=5000
VITE_STATS_FROM_BLOCK=101593767
```

Do not add `M1_RELAYER_PRIVATE_KEY`, `M3_CLOSE_BOT_PRIVATE_KEY`,
`M3_RELAYER_ADMIN_TOKEN`, `QUICKNODE_RPC_URL`, or `ZEROX_API_KEY` to Vercel.

## VPS preparation

The VPS needs Node.js 20 or newer, Nginx, Certbot, and a `flatstock` system
user. Copy the repository to `/opt/flatstock`, then run:

```sh
sudo install -d -m 700 /etc/flatstock
sudo cp deploy/flatstock.env.example /etc/flatstock/flatstock.env
sudo chown root:root /etc/flatstock/flatstock.env
sudo chmod 600 /etc/flatstock/flatstock.env
npm ci --prefix /opt/flatstock/web
sudo install -m 644 deploy/flatstock-relayer.service /etc/systemd/system/flatstock-relayer.service
sudo install -m 644 deploy/flatstock-close-round.service /etc/systemd/system/flatstock-close-round.service
sudo install -m 644 deploy/flatstock-close-round.timer /etc/systemd/system/flatstock-close-round.timer
sudo install -m 644 deploy/nginx-api.conf.template /etc/nginx/sites-available/flatstock-api
sudo ln -s /etc/nginx/sites-available/flatstock-api /etc/nginx/sites-enabled/flatstock-api
sudo nginx -t
sudo systemctl daemon-reload
```

Before starting anything, fill `/etc/flatstock/flatstock.env` with the VPS-only
values. Keep `CLOSE_ROUND_ENABLED=0` until the specific close transaction is
approved. Keep `M3_RELAYER_KILL_SWITCH=1` until the app and HTTPS API have
been checked.

Issue the API certificate only after DNS resolves to the VPS:

```sh
sudo certbot --nginx -d api.flatstock.ajkadri.dev
```

Then test:

```sh
curl -fsS https://api.flatstock.ajkadri.dev/api/health
```

The browser uses `/api/rpc` through this VPS. The proxy prefers
`QUICKNODE_RPC_URL` when it exists and falls back to `RPC_URL`; the QuickNode
endpoint is never sent to the browser. The relayer submits transactions using
`RPC_URL`.

# VPS deployment preparation

This is a deployment plan only. It does not deploy or change DNS.

## Build locally or on the VPS

```sh
npm ci --prefix web
VITE_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
VITE_ROUND_ID=3 \
npm run build --prefix web
```

The frontend is static in `web/dist`. The relayer runs separately and reads
all secrets from `/etc/flat-index/flat-index.env` through systemd.

`QUICKNODE_RPC_URL` is optional. When set, relayer read calls prefer it and
fall back to `RPC_URL`. Stock Token API proxy routes stay disabled until the
variable is set. The relayer submits transactions through `RPC_URL` so a
QuickNode read outage cannot silently change the transaction provider.

## Ubuntu process manager

1. Create a locked-down `flat-index` user and `/opt/flat-index` checkout.
2. Copy `deploy/flat-index.env.example` to `/etc/flat-index/flat-index.env`.
3. Fill the copied file without printing or committing secrets, then run:

```sh
sudo chown root:root /etc/flat-index/flat-index.env
sudo chmod 600 /etc/flat-index/flat-index.env
sudo install -m 644 deploy/flat-index-relayer.service /etc/systemd/system/flat-index-relayer.service
sudo systemctl daemon-reload
sudo systemctl enable --now flat-index-relayer
sudo systemctl status flat-index-relayer
```

The initial kill switch is on. Flip it only after the app, domain, funding,
daily cap, and mainnet approval process have been checked.

## Subdomain and TLS

Replace `YOUR_SUBDOMAIN` in `deploy/nginx.conf.template`, install it as an
Nginx site, point the chosen DNS record to the VPS, and issue TLS with the
operator's normal certificate process. No domain is assumed here.

The Nginx config serves `web/dist` and proxies `/api/` to the local relayer.
The current temporary phone preview is for testing only and is not a
deployment or a permanent URL.

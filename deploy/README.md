# Flatstock VPS deployment preparation

This is a deployment plan only. It does not deploy or change DNS.

## Build locally or on the VPS

```sh
npm ci --prefix web
VITE_RPC_URL=https://api.flatstock.ajkadri.dev/api/rpc \
VITE_RELAYER_API=https://api.flatstock.ajkadri.dev/api \
VITE_ROUND_ID=3 \
npm run build --prefix web
```

The frontend is static in `web/dist` and belongs on Vercel. The relayer runs
separately and reads all secrets from `/etc/flatstock/flatstock.env` through
systemd.

`QUICKNODE_RPC_URL` is optional. When set, relayer read calls prefer it and
fall back to `RPC_URL`. Stock Token API proxy routes stay disabled until the
variable is set. The relayer submits transactions through `RPC_URL` so a
QuickNode read outage cannot silently change the transaction provider.

## Ubuntu process manager

1. Create a locked-down `flatstock` user and `/opt/flatstock` checkout.
2. Copy `deploy/flatstock.env.example` to `/etc/flatstock/flatstock.env`.
3. Fill the copied file without printing or committing secrets, then run:

```sh
sudo chown root:root /etc/flatstock/flatstock.env
sudo chmod 600 /etc/flatstock/flatstock.env
sudo install -m 644 deploy/flatstock-relayer.service /etc/systemd/system/flatstock-relayer.service
sudo install -m 644 deploy/flatstock-close-round.service /etc/systemd/system/flatstock-close-round.service
sudo install -m 644 deploy/flatstock-close-round.timer /etc/systemd/system/flatstock-close-round.timer
sudo systemctl daemon-reload
sudo systemctl enable --now flatstock-relayer
sudo systemctl status flatstock-relayer
```

The initial kill switch is on. Flip it only after the app, domain, funding,
daily cap, and mainnet approval process have been checked.

The close bot is disabled by default with `CLOSE_ROUND_ENABLED=0`. After the
operator has approved the specific round close, set it to `1` for that run and
enable the timer:

```sh
sudo systemctl enable --now flatstock-close-round.timer
sudo systemctl start flatstock-close-round.service
sudo journalctl -u flatstock-close-round.service -n 50 --no-pager
```

Keep the timer disabled until the round and close transaction have been
explicitly approved. The bot reads through QuickNode when configured, falls
back to `RPC_URL`, and submits the close through `RPC_URL`.

## Subdomain and TLS

Install `deploy/nginx-api.conf.template` as an Nginx site, point
`api.flatstock.ajkadri.dev` to the VPS, and issue TLS with the operator's
normal certificate process.

The Nginx config proxies API traffic to the local relayer.
The current temporary phone preview is for testing only and is not a
deployment or a permanent URL.

# Flatstock VPS deployment preparation

This is a deployment plan only. It does not deploy or change DNS.

## Build locally or on the VPS

```sh
npm ci --prefix web
VITE_RPC_URL=https://api.flatstock.ajkadri.dev/api/rpc \
VITE_RELAYER_API=https://api.flatstock.ajkadri.dev/api \
npm run build --prefix web
```

The frontend is static in `web/dist` and belongs on Vercel. The relayer runs
separately and reads all secrets from `/etc/flatstock/flatstock.env` through
systemd.

`GETBLOCK_RPC_URL` and `QUICKNODE_RPC_URL` are optional. General reads (the `/api/rpc` proxy and the relayer's own
reads) try GetBlock first, then QuickNode, then `RPC_URL` (the public Robinhood Chain RPC), skipping a provider that
fails for 30 seconds. The Stock Token API routes (`/api/stock-token/*`) use QuickNode only and stay disabled until
`QUICKNODE_RPC_URL` is set. Relayed transactions are signed once, then broadcast through the same ordered providers; if a
send errors, the relayer looks the transaction up by hash before reporting failure.

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

The round bot is disabled by default with `CLOSE_ROUND_ENABLED=0` and `AUTO_OPEN_ENABLED=0`. With both off,
running `npm run close-round --prefix /opt/flatstock/web` prints the contract, the latest round, `closesAt` and the
decision without sending anything. With `CLOSE_ROUND_ENABLED=1` it closes a round once its `closesAt` has passed; with
`AUTO_OPEN_ENABLED=1` as well it then opens the next weekly round. It can only call `closeRound` and `openRound`,
and it opens only when its signer is the contract `owner()`. Full behaviour and guards are in `deploy/HOSTING.md`
("Round bot"). To arm it after you have approved the automation:

```sh
sudo systemctl enable --now flatstock-close-round.timer
sudo systemctl start flatstock-close-round.service
sudo journalctl -u flatstock-close-round.service -n 50 --no-pager
```

Keep the timer disabled until you have explicitly approved the automation. The bot reads through QuickNode when configured, falls
back to `RPC_URL`, and submits the close through `RPC_URL`.

## Caddy and TLS

The VPS already owns ports 80 and 443 with Caddy. Add the site block from
`deploy/Caddyfile.template` to the existing Caddyfile. It reverse-proxies
`api.flatstock.ajkadri.dev` to `127.0.0.1:8788`; Caddy obtains and renews TLS.

The relayer defaults to `M3_RELAYER_HOST=127.0.0.1` and
`M3_RELAYER_PORT=8788`. Choose another unused local port if needed, set both
the environment variable and the Caddy upstream to the same port, then run:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

CORS remains enforced by the relayer with
`M3_ALLOWED_ORIGIN=https://app.flatstock.ajkadri.dev`. The current temporary
phone preview is for testing only and is not a deployment or a permanent URL.

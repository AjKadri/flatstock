# Flatstock

Buy the US stocks the community picked, in one tap, with no gas.

Flatstock is a self-custody web app on chain 4663. Stock Tokens go directly to
the connected wallet. The app does not hold user funds.

Locked-WIF users sign the exact vote or trade action and the relayer submits
that signed action. Other wallets use normal wallet transactions and pay ETH
gas. The app has no EIP-7702 delegation path and never charges gas in WIF.

Notice: Not available to US persons. Not investment advice.

## Local development

```sh
npm ci --prefix web
npm run dev --prefix web
```

Copy `.env.example` to `.env` and keep all private keys and service endpoints
local. The browser receives only `VITE_*` public configuration. QuickNode
reads are proxied through the VPS and its endpoint never reaches the browser.

## License

Apache-2.0. See [LICENSE](LICENSE).

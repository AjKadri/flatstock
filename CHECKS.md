# M1 mainnet checks

Status: M1 complete. M2 complete with limits. M3 in progress. Round 3 is closed on the old contract and round 4 is open on the replacement.

Scope follows `PLAN-v3.md` section 3. `PLAN-v3.md` replaces the v2 plan. The
tipster-specific contract section in `AGENTS.md` is out of scope.

## Preconditions

- Date: 2026-10-30 Lagos time.
- Required execution window: 14:30 to 21:00 Lagos.
- Live basket receipt: `2026-10-30 14:50:44 WAT +0100`, inside the required window.
- Chain: chain `4663` mainnet.
- Public RPC: configured through `RPC_URL`.
- `$WIF`: `0x5173b8eA6923c2d40267890D45C46a3480954773`, 18 decimals.
- `USDG`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals.
- User wallet: `0x3554121694a2472300f079Afa4B1fC7F9aAFac01`.
- Relayer wallet: `0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4`.
- The user wallet has 0 ETH, `999` WIF after the approved vote, and `4.667257` USDG after the basket and AAPL sell-back.
- The relayer wallet has `0.000421954759746223` native ETH after all approved M1 transactions.
- No key values were printed. Secrets remain in the ignored `.env` file.

The user approved the EIP-7702 delegate deployment, the tiny mainnet vote
round, the market-hours basket buy, and the AAPL sell-back. No further M1
transaction was sent in that phase.

## M3 round 3 short-test evidence

Verdict: pass with limits. The approved short test round is open on mainnet;
the close transaction and post-close UI mix confirmation are intentionally
pending until the scheduled close time.

Schedule override recorded in `PLAN-v3.md`:

- Close: `2026-11-01 21:00 WAT` (`1793563200`).
- Mainnet: chain `4663`.
- Round id: `3`.
- Asset count: `3`.

### Read-only preflight

Exact commands:

```sh
set -a; source .env; set +a
CLOSE_TS=$(node --input-type=module -e 'console.log(Math.floor(new Date("2026-11-01T21:00:00+01:00").getTime()/1000))')
RELAYER=$(cast wallet address --private-key "$M1_RELAYER_PRIVATE_KEY")
cast chain-id --rpc-url "$RPC_URL"
cast call "$VOTE_CONTRACT_ADDRESS" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 3 --rpc-url "$RPC_URL"
cast balance "$RELAYER" --rpc-url "$RPC_URL"
cast estimate "$VOTE_CONTRACT_ADDRESS" 'openRound(uint256,uint8,uint64)' 3 3 "$CLOSE_TS" --from "$RELAYER" --rpc-url "$RPC_URL"
```

Observed output:

```text
close_ts=1793563200
chain_id=4663
round3=0 0 0 0 false
relayer_eth=379269014454223 wei
estimate=47794 gas
```

### Approved mainnet transaction

Exact command:

```sh
set -a; source .env; set +a
CLOSE_TS=$(node --input-type=module -e 'console.log(Math.floor(new Date("2026-11-01T21:00:00+01:00").getTime()/1000))')
cast send "$VOTE_CONTRACT_ADDRESS" 'openRound(uint256,uint8,uint64)' 3 3 "$CLOSE_TS" --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
```

Observed output:

```text
txHash=0x9e6217a848a55aba45b1521e323f16e12a6d22711cafeccf6ffdf10cb54889fb
status=0x1
blockNumber=102708287 (raw provider receipt 0x61f343f)
gasUsed=47222
effectiveGasPrice=20010000 wei
gasPaid=944912220000 wei = 0.00000094491222 ETH
```

The receipt's `blockNumber` is recorded both as decimal `102708287` and raw
`0x61f343f`. At an ETH/USD reference of `$2248.26`
observed on 31 Oct 2026, the relayer gas cost was `$0.002124`.

Post-transaction read:

```text
round3.opensAt=1793465885
round3.closesAt=1793563200
round3.assetCount=3
round3.totalVotes=0
round3.closed=false
```

### User-controlled mobile vote

The user submitted the vote through the phone wallet browser UI. No vote was
sent from a script by the agent.

Transaction:

```text
txHash=0x9d0b995f96a553bb5c33d92369525d5a67f36aa8a323fdaf7d09d88c3f11c094
status=0x1
from=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
to=0x3554121694a2472300f079Afa4B1fC7F9aAFac01
gasUsed=142349
effectiveGasPrice=20006000 wei
gasPaid=2847834094000 wei = 0.000002847834094 ETH
gasCostAt-$2248.26-ETH-reference=$0.006403
```

Read-only receipt checks:

```text
round3.totalVotes=1
hasVoted(round3,user)=true
weightBps(round3,AAPL)=0
weightBps(round3,NVDA)=10000
weightBps(round3,MSFT)=0
user WIF balance=986.99 WIF
```

The receipt contains a 1 WIF transfer from the user to the vote contract and
a 1 WIF burn to the zero address. The relayer paid native gas. The preview
relayer kill switch was re-enabled immediately after this transaction and
before any buy transaction.

The UI now requires an explicit in-app confirmation stating that exactly 1
WIF will be spent and burned, that the relayer pays ETH gas, and that no WIF or
ETH is sent to the relayer. After submission it shows a direct explorer link.

### Approved mobile gasless buy

The user confirmed the in-app review screen and submitted the $3 USDG buy from
the phone wallet browser. No buy was sent from a script by the agent.

Transaction:

```text
txHash=0x0042c543774d2eb67f1a392094e766485ff64af2766646746b4ca6d3f2038f14
status=0x1
from=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
to=0x3554121694a2472300f079Afa4B1fC7F9aAFac01
blockNumber=102736815
gasUsed=207870
effectiveGasPrice=20000000 wei
gasPaid=4157400000000 wei = 0.0000041574 ETH
gasCostAt-$2248.26-ETH-reference=$0.009347
```

Observed transfer and fill:

```text
USDG user -> buy router = 3000000 raw = 3 USDG
NVDA pool -> user = 14713836484323660 raw = 0.01471383648432366 NVDA
user USDG balance after = 1167257 raw = 1.167257 USDG
user NVDA balance after = 23730493459797947 raw = 0.023730493459797947 NVDA
route=Uniswap v3 fallback
pool=0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3
fee=500
```

At the transaction block, the NVDA Chainlink answer was `$205.28000142`.
The executed fill was `$203.88971994`, a `-0.677261%` difference (`68` bps),
within the 2% guard. The token transfer recipient was the user wallet, not a
project contract. The relayer kill switch was re-enabled immediately after
the receipt was verified.

Verdict: pass for the approved mobile gasless buy, with the temporary-domain
wallet warning and final round-close UI confirmation still outstanding.

## M3 web app acceptance evidence

Status: in progress. The desktop public-read path is verified against live
round 3. Wallet-signing and mobile in-app-browser transaction flows remain
deferred until a funded browser wallet is available and each requested
mainnet transaction is separately approved.

### Build and contract regression checks

Exact commands:

```sh
npm run build --prefix web
forge test -vv
```

Observed output:

```text
vite v8.3.5
✓ 440 modules transformed
✓ built in 163ms
Ran 4 test suites: 7 tests passed, 0 failed, 0 skipped
```

The only build note is Vite's non-failing warning that the main JavaScript
chunk is larger than 500 kB.

### Current M3 implementation acceptance

Verdict: pass with limits. The app now has the approved Flatstock UI copy,
explicit transaction review screens, a sell-back review path, a 2% quote
guard, and a 24-hour Chainlink freshness guard. The browser's general RPC
reads use the VPS proxy, which prefers `QUICKNODE_RPC_URL` and falls back to
`RPC_URL`. No QuickNode endpoint is exposed to browser code.

Exact commands:

```sh
npm run build --prefix web
git diff --check
node --import tsx relayer/close-round.ts
```

Observed output:

```text
✓ 440 modules transformed
✓ built successfully
git diff --check: exit 0, no output
{"enabled":false,"roundId":"3","action":"none"}
```

The close-round bot remains disabled by default. A first `npm run close-round`
smoke attempt hit the local macOS `tsx` IPC `listen EPERM` before executing;
the direct Node loader invocation above exercised the same disabled safety
path successfully. No mainnet transaction was sent.

### Relayer protection smoke check

The local relayer was started with `M3_RELAYER_KILL_SWITCH=1`, a local admin
token, and daily cap `3`. No secret values were printed.

Observed output:

```text
M3 relayer listening on 8791; kill switch on; daily cap 3
health={"enabled":true,"killSwitch":true,"dailyCap":3,"usage":0,"relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4"}
relay_status=503
relay_body={"error":"Sponsorship is paused by the kill switch."}
kill_status=200
kill_body={"killSwitch":false}
kill_on_status=200
kill_on_body={"killSwitch":true}
```

The final local relayer state was paused.

### Browser acceptance snapshot

Local preview command:

```sh
VITE_ROUND_ID=3 npm run dev --prefix web -- --port 5174
```

Observed desktop preview output:

```text
Flatstock
Wrong network
Notice Not available to US persons. Not investment advice.
WIF burned by votes: 2 WIF
Vote round 3: Open
Closes 1 Nov 2026, 21:00. 0 votes counted.
Buy this week’s mix in one tap.
Every quote must exist and stay within 2% of Chainlink.
Self-custody only. The app never holds your funds. Live data from chain 4663.
```

The responsive stylesheet includes a mobile layout at `max-width: 720px`, but
an actual mobile wallet in-app-browser session has not been captured yet.

### Phone preview and deployment preparation

Temporary phone preview URL:

```text
https://patient-increased-diana-weight.trycloudflare.com/
```

This is an account-less quick tunnel to the local Vite server. It is for the
mobile check only and is not a deployment or a permanent URL.

The preview server uses a narrow `.trycloudflare.com` dev-host allow-list. The
local relayer was started with its kill switch on so the public preview could
read health without accepting a sponsored transaction.

Observed output:

```text
health={"enabled":true,"killSwitch":true,"dailyCap":3,"usage":0,"relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4","quickNode":false}
quicknode_status=503
{"error":"QuickNode Stock Token API is not configured."}
```

Prepared but not deployed:

- `deploy/flatstock-relayer.service` for systemd on Ubuntu.
- `deploy/Caddyfile.template` for `api.flatstock.ajkadri.dev`.
- `deploy/flatstock-close-round.service` and `.timer` for the disabled-by-default close bot.
- `deploy/flatstock.env.example` for a mode-600 VPS environment file.
- `deploy/README.md` and `deploy/HOSTING.md` for build, process, TLS, DNS, and Vercel preparation.

The QuickNode Stock Token API remains blocked until `QUICKNODE_RPC_URL` is
added to the VPS environment. Its proxy routes return:

```text
HTTP 503
{"error":"QuickNode Stock Token API is not configured."}
```

## New mix rules acceptance

Verdict: pass locally. The vote contract now accepts a per-round vote-share
blend parameter, defaults to 50% vote share plus 50% equal weight, caps any
single asset at 50%, redistributes the excess, and stores final weights at
close. New rounds require at least two assets. Split votes remain deferred.

Exact checks:

```sh
forge test -vv
node --input-type=module -e 'const votes=[0n,1n,0n], equal=[3334n,3333n,3333n]; let raw=equal.map((e,i)=>(e*5000n+(i===1?10000n:0n)*5000n)/10000n); raw[2]+=10000n-raw.reduce((a,b)=>a+b,0n); const excess=raw[1]-5000n; raw[1]=5000n; raw[0]+=excess/2n; raw[2]+=excess-excess/2n; console.log(JSON.stringify({votes:votes.map(String),weightsBps:raw.map(String),symbols:["AAPL","NVDA","MSFT"]}));'
```

Observed output:

```text
Ran 4 test suites: 9 tests passed, 0 failed, 0 skipped
{"votes":["0","1","0"],"weightsBps":["2500","5000","2500"],"symbols":["AAPL","NVDA","MSFT"]}
```

Live read-only mainnet verification before applying the formula:

```sh
set -a; source .env; set +a
cast chain-id --rpc-url "$RPC_URL"
cast call "$VOTE_CONTRACT_ADDRESS" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 3 --rpc-url "$RPC_URL"
cast call "$VOTE_CONTRACT_ADDRESS" 'votesFor(uint256,uint8)(uint256)' 3 0 --rpc-url "$RPC_URL"
cast call "$VOTE_CONTRACT_ADDRESS" 'votesFor(uint256,uint8)(uint256)' 3 1 --rpc-url "$RPC_URL"
cast call "$VOTE_CONTRACT_ADDRESS" 'votesFor(uint256,uint8)(uint256)' 3 2 --rpc-url "$RPC_URL"
```

Observed output:

```text
4663
1793465885
1793563200
3
1
false
0
1
0
```

Round 3's actual votes are AAPL `0`, NVDA `1`, MSFT `0`. Under the new rules
the displayed computed mix is AAPL `25%`, NVDA `50%`, MSFT `25%`. This is a
new-rule preview until the replacement vote contract is deployed. The app
keeps mix buys disabled while `VITE_VOTES_ADDRESS` is absent, so the old round
cannot silently execute a client-only weighting rule.

### Automatic round discovery

The replacement contract exposes `latestRoundId()`. The app reads that value
from the configured `VITE_VOTES_ADDRESS` and uses the legacy `VITE_ROUND_ID`
only when the old deployed contract does not expose the getter. The burn total
reads vote events from both the legacy and replacement vote contracts.

Observed local safety output:

```text
node --import tsx relayer/close-round.ts
{"enabled":false,"roundId":"auto","action":"none"}
```

No close or open transaction was sent.

### Replacement contract deployment preflight

Read-only preflight:

```text
deployer=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
relayer_eth=0.000371318868140223
creation_bytes=5075
estimated_gas=1109189
estimated_cost=0.000022237021072 ETH
```

The deployment constructor uses the existing WIF address from `.env`. The
the deployment transaction below records the approved mainnet send.

### Replacement contract deployment

Verdict: pass.

The user approved the mainnet deployment. The replacement contract was sent
from the approved deployer on chain `4663`.

Exact command:

```sh
set -a; source .env; set +a
DEPLOYER=$(cast wallet address --private-key "$M1_RELAYER_PRIVATE_KEY")
forge create src/FlatstockVotesLegacy.sol:FlatstockVotesLegacy \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json --constructor-args "$WIF_ADDRESS"
```

Observed output:

```text
deployer=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
deployedTo=0xD49249D2a5CffBCF35B6560857d1d1C703802e78
transactionHash=0x714948e2fd8ec201c85639523deca8ba4e268e14c5a3f85d020f20410122f886
blockNumber=104489009
status=1
gasUsed=1099297
effectiveGasPrice=20064000 wei
gasCost=0.000022056295008 ETH
```

The exact receipt gas calculation is `1,099,297 * 20,064,000 =
22,056,295,008,000` wei. At the Blockscout ETH/USD observation of
`$2,252.50` during verification, that is approximately `$0.04968`. The
receipt and transaction are linked at
[Blockscout](https://robinhoodchain.blockscout.com/tx/0x714948e2fd8ec201c85639523deca8ba4e268e14c5a3f85d020f20410122f886).

Post-deployment read-only checks:

```text
owner() = 0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
wif() = 0x5173b8eA6923c2d40267890D45C46a3480954773
latestRoundId() = 0
```

Source verification:

```text
Sourcify: exact_match
Verification job: db35e69d-f013-4a47-adbe-3eab7d1aa900
Blockscout: contract page displays "Contract source code verified (exact match)"
Compiler: v0.8.24+commit.e11b9ed9
Optimizer: enabled, 200 runs
```

Links:

- [Blockscout contract page](https://robinhoodchain.blockscout.com/address/0xD49249D2a5CffBCF35B6560857d1d1C703802e78?tab=contract)
- [Sourcify verification job](https://verify.sourcify.dev/jobs/db35e69d-f013-4a47-adbe-3eab7d1aa900)
- [Sourcify v2 metadata](https://sourcify.dev/server/v2/contract/4663/0xD49249D2a5CffBCF35B6560857d1d1C703802e78?fields=sources,metadata)

Prepared mainnet command for the next approved step, not sent:

```sh
set -a; source .env; set +a
ROUND4_CLOSE=$(node --input-type=module -e 'console.log(Math.floor(new Date("2026-11-09T15:00:00+01:00").getTime()/1000))')
cast send "0xD49249D2a5CffBCF35B6560857d1d1C703802e78" \
  'openRound(uint256,uint8,uint64,uint16)' 4 3 "$ROUND4_CLOSE" 5000 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
```

The round-3 close and round-4 open each require separate user approval
immediately before sending.

### Round 3 close on the legacy contract

Verdict: pass.

The user approved the close after the scheduled deadline had passed. The old
contract closed round 3 successfully.

Exact command:

```sh
set -a; source .env; set +a
OLD=0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9
RELAYER=$(cast wallet address --private-key "$M1_RELAYER_PRIVATE_KEY")
cast chain-id --rpc-url "$RPC_URL"
cast call "$OLD" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 3 --rpc-url "$RPC_URL"
cast estimate "$OLD" 'closeRound(uint256)' 3 --from "$RELAYER" --rpc-url "$RPC_URL"
cast send "$OLD" 'closeRound(uint256)' 3 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
cast call "$OLD" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 3 --rpc-url "$RPC_URL"
cast call "$OLD" 'weightBps(uint256,uint8)(uint256)' 3 0 --rpc-url "$RPC_URL"
cast call "$OLD" 'weightBps(uint256,uint8)(uint256)' 3 1 --rpc-url "$RPC_URL"
cast call "$OLD" 'weightBps(uint256,uint8)(uint256)' 3 2 --rpc-url "$RPC_URL"
```

Observed output:

```text
chain=4663
round3 before=1793465885 1793563200 3 1 false
estimate=50149 gas
transactionHash=0x6d9941684acf235d255fa8ab3ef47f721f8754dee8b79a0df06ea89c06b5bc47
blockNumber=105009666
status=1
gasUsed=49750
effectiveGasPrice=20000000 wei
gasCost=0.000000995 ETH
round3 after=1793465885 1793563200 3 1 true
weightBps(AAPL,NVDA,MSFT)=0 10000 0
```

At the recorded `$2,252.50` ETH/USD observation, the close cost was
approximately `$0.00224124`. The one NVDA vote therefore froze the legacy
round at 100% NVDA. The replacement contract's 50% cap and 50/50 blend apply
to round 4 and later.

Transaction: [Blockscout](https://robinhoodchain.blockscout.com/tx/0x6d9941684acf235d255fa8ab3ef47f721f8754dee8b79a0df06ea89c06b5bc47).

## M4 QuickNode Stock Token API

Date checked: 2026-11-03 WAT. The implementation is deployed at commit
`f814a9b` and the relayer service is active on the VPS. QuickNode-specific
requests are server-side only. The browser calls the VPS proxy and never sees
the QuickNode endpoint.

### Method contract used

The proxy calls these official Stock Token API methods:

- `qn_getStockTokenBalances(wallet, { symbols, includeUsd, blockTag })`
- `qn_getCorporateActions({ symbols, includeScheduled, limit })`
- `qn_getOracleHealth({ symbols, blockTag })`
- `qn_getTransactionFinality(txHash)`

The UI uses the balances response for share quantities and USD values, shows
corporate-action messages such as `AAPL paid a dividend, your shares grew`,
blocks a buy when any requested oracle is missing, stale, paused, invalid, or
has an unacceptable status, and waits for `soft: true` finality before showing
`Buy complete`.

### VPS health and live method probes

Verdict: pass with limits for proxy configuration. The QuickNode credential or
endpoint authorization is rejected upstream, so successful Stock Token API
responses remain unresolved.

Exact read-only command, with the endpoint kept inside the VPS environment:

```sh
ssh -o BatchMode=yes root@2.29.11.26 'curl -sS http://127.0.0.1:8788/api/health; printf "\\n--- balances ---\\n"; curl -sS -w "\\nHTTP %{http_code}\\n" "http://127.0.0.1:8788/api/stock-token/balances?address=0x3554121694a2472300f079Afa4B1fC7F9aAFac01&symbols=AAPL,NVDA,MSFT"; printf "\\n--- corporate ---\\n"; curl -sS -w "\\nHTTP %{http_code}\\n" "http://127.0.0.1:8788/api/stock-token/corporate-actions?symbols=AAPL,NVDA,MSFT"; printf "\\n--- oracle ---\\n"; curl -sS -w "\\nHTTP %{http_code}\\n" "http://127.0.0.1:8788/api/stock-token/oracle-health?symbols=AAPL,NVDA,MSFT"; printf "\\n--- finality ---\\n"; curl -sS -w "\\nHTTP %{http_code}\\n" "http://127.0.0.1:8788/api/stock-token/finality?txHash=0x0042c543774d2eb67f1a392094e766485ff64af2766646746b4ca6d3f2038f14"'
```

Observed output, with no endpoint or secret printed:

```text
{"enabled":true,"killSwitch":true,"dailyCap":3,"usage":0,"relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4","quickNode":true}
--- balances ---
{"error":"QuickNode request failed with HTTP 401."}
HTTP 400
--- corporate ---
{"error":"QuickNode request failed with HTTP 401."}
HTTP 400
--- oracle ---
{"error":"QuickNode request failed with HTTP 401."}
HTTP 400
--- finality ---
{"error":"QuickNode request failed with HTTP 401."}
HTTP 400
```

These are real proxy responses, but they are not successful method responses.
The live M4 data acceptance check is therefore unresolved until the VPS
QuickNode endpoint credentials or endpoint authorization are corrected. No
mainnet transaction was sent for this check.

### M4 code and browser acceptance

Verdict: pass with limits. The code paths are present in the deployed build,
with the live QuickNode data gate above unresolved.

Exact checks:

```sh
npm run build --prefix web
git diff --check
```

Observed output:

```text
vite v8.3.5
✓ 440 modules transformed
✓ built successfully
git diff --check: exit 0, no output
```

Live signed-out page text from `https://app.flatstock.ajkadri.dev/`:

```text
Flatstock
Read-only
Connect wallet
Notice Not available to US persons. Not investment advice.
Buy the US stocks the community picked, in one tap, with no gas.
WIF burned by votes
3 WIF
Vote round 4
Open
Closes 9 Nov 2026, 15:00. 0 votes counted.
Mix rule preview: 50% equal-weight plus 50% vote share. No stock can exceed 50%.
AAPL 33.34%
NVDA 33.33%
MSFT 33.33%
Corporate actions
Shares update automatically
No recent corporate actions are available for this mix.
Portfolio
Connect a wallet to see Stock Tokens held by that wallet.
Self-custody only. The app never holds your funds. Live data from chain 4663.
```

This proves signed-out round discovery, current mix, vote count, the combined
burn counter, legal notice, read-only state, and the wrong-network behavior
boundary. Portfolio share data and corporate actions cannot be populated until
the upstream QuickNode 401 is fixed. The finality guard and oracle refusal are
implemented but are not production-verified against a successful QuickNode
response in this run.

### Replacement vote contract and round 4 status

The replacement contract is deployed and verified:

- Contract: `0xD49249D2a5CffBCF35B6560857d1d1C703802e78`
- Deployment tx: `0x714948e2fd8ec201c85639523deca8ba4e268e14c5a3f85d020f20410122f886`
- Round 3 close on the old contract: `0x6d9941684acf235d255fa8ab3ef47f721f8754dee8b79a0df06ea89c06b5bc47`
- Round 4 open on the replacement: `0x1316106102a193db6371fc4734d2270f6bc2dd536b0ca87980acb829d261267a`
- Round 4: 3 stocks, `voteShareBps=5000`, close `1794232800`

The app reads `latestRoundId()` from `VITE_VOTES_ADDRESS`, so it discovers
round 4 without a weekly `VITE_ROUND_ID` redeploy. The relayer kill switch
remains on.

### Round 4 opening on the replacement contract

Verdict: pass.

The user approved opening round 4 with three stocks, a 50% vote-share blend,
and close timestamp `1794232800` (`Mon 9 Nov 2026 15:00 WAT`).

Exact command:

```sh
set -a; source .env; set +a
NEW=0xD49249D2a5CffBCF35B6560857d1d1C703802e78
RELAYER=$(cast wallet address --private-key "$M1_RELAYER_PRIVATE_KEY")
cast chain-id --rpc-url "$RPC_URL"
cast call "$NEW" 'latestRoundId()(uint256)' --rpc-url "$RPC_URL"
cast call "$NEW" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 4 --rpc-url "$RPC_URL"
cast estimate "$NEW" 'openRound(uint256,uint8,uint64,uint16)' 4 3 1794232800 5000 \
  --from "$RELAYER" --rpc-url "$RPC_URL"
cast send "$NEW" 'openRound(uint256,uint8,uint64,uint16)' 4 3 1794232800 5000 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
cast call "$NEW" 'latestRoundId()(uint256)' --rpc-url "$RPC_URL"
cast call "$NEW" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 4 --rpc-url "$RPC_URL"
cast call "$NEW" 'voteShareBps(uint256)(uint16)' 4 --rpc-url "$RPC_URL"
```

Observed output:

```text
chain=4663
latestRoundId before=0
round4 before=0 0 0 0 false
estimate=92562 gas
transactionHash=0x1316106102a193db6371fc4734d2270f6bc2dd536b0ca87980acb829d261267a
blockNumber=105015974
status=1
gasUsed=91604
effectiveGasPrice=20166000 wei
gasCost=0.000001847286264 ETH
latestRoundId after=4
round4 after=1793704615 1794232800 3 0 false
voteShareBps=5000
```

At the recorded `$2,252.50` ETH/USD observation, the opening transaction
cost approximately `$0.00416101`. Transaction: [Blockscout](https://robinhoodchain.blockscout.com/tx/0x1316106102a193db6371fc4734d2270f6bc2dd536b0ca87980acb829d261267a).

### Mobile issue fixes

The first phone attempt exposed two issues:

1. The vote path returned the relayer's kill-switch response because the
   temporary preview relayer was intentionally started paused.
2. The app did not subscribe to injected-wallet `chainChanged` and
   `accountsChanged` events, so a network switch did not update the UI until a
   refresh.

Fixes:

- The preview relayer was restarted for the user's explicitly requested UI
  vote with the daily cap still set to `3`. No script-submitted transaction was
  sent.
- The UI now updates the network pill immediately, clears stale quote state,
  disables actions on the wrong network, and shows a recovery message when
  chain 4663 is restored.

Verification output:

```text
health={"enabled":true,"killSwitch":false,"dailyCap":3,"usage":0,"relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4","quickNode":false}
npm run build --prefix web
✓ built in 164ms
```

## Read-only mainnet preflight

Exact command:

```sh
set -a; source .env; set +a
date '+%Y-%m-%d %H:%M:%S %Z %z'
cast chain-id --rpc-url "$RPC_URL"
cast block-number --rpc-url "$RPC_URL"
cast gas-price --rpc-url "$RPC_URL"
cast balance 0x3554121694a2472300f079Afa4B1fC7F9aAFac01 --ether --rpc-url "$RPC_URL"
cast balance 0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4 --ether --rpc-url "$RPC_URL"
cast call "$WIF_ADDRESS" 'balanceOf(address)(uint256)' 0x3554121694a2472300f079Afa4B1fC7F9aAFac01 --rpc-url "$RPC_URL"
cast call "$USDG_ADDRESS" 'balanceOf(address)(uint256)' 0x3554121694a2472300f079Afa4B1fC7F9aAFac01 --rpc-url "$RPC_URL"
cast call "$STOCK_FEED_ADDRESS" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC_URL"
cast call "$AAPL_FEED_ADDRESS" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC_URL"
cast call "$MSFT_FEED_ADDRESS" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC_URL"
```

Observed output:

```text
2026-10-30 09:36:05 WAT +0100
4663
101593426
20152000
0.000000000000000000
0.000344994444245313
1000000000000000000000
2000000
NVDA answer 20748570987, updatedAt 1793349107
AAPL answer 35099042627, updatedAt 1793304198
MSFT answer 52529528800, updatedAt 1793323143
```

The three canonical token addresses are:

```text
AAPL  0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
NVDA  0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
MSFT  0xe93237C50D904957Cf27E7B1133b510C669c2e74
```

They were read from the official public asset registry and verified with
`symbol()` and `decimals()` on mainnet. The feeds used above are:

```text
AAPL  0x6B22A786bAa607d76728168703a39Ea9C99f2cD0
NVDA  0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15
MSFT  0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E
```

## Aggregator route preflight

The configured 0x key is present, but the read-only 0x quote for NVDA returned:

```text
HTTP 422 BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE
message: The buy token is not authorized for trade due to legal restrictions
```

The fallback is Uniswap v3 `SwapRouter02` at
`0xCaf681a66D020601342297493863E78C959E5cb2`, with QuoterV2 at
`0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7`.

Verified pools and fees:

```text
USDG/NVDA  0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3  fee 500
USDG/AAPL  0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D  fee 500
USDG/MSFT  0xeb60bCD1D920ad6E102690CCFC6fB488899E1510  fee 3000
```

Exact quote command shape:

```sh
set -a; source .env; set +a
path="0x${USDG_ADDRESS#0x}0001f4${STOCK_TOKEN_ADDRESS#0x}"
cast call "$UNISWAP_QUOTER_ADDRESS" \
  'quoteExactInput(bytes,uint256)(uint256,uint160[],uint32[],uint256)' \
  "$path" 666667 --rpc-url "$RPC_URL"
```

For the same `0.666667 USDG` input per asset, observed quote outputs and
Chainlink comparisons were:

| Token | Quote output | Chainlink price | Quote fill price | Difference |
|---|---:|---:|---:|---:|
| NVDA | `3206606898386680` | `$207.4857` | `$207.9042` | `+0.202%` |
| AAPL | `1905606362419840` | `$350.9904` | `$349.8451` | `-0.326%` |
| MSFT | `1265439674886963` | `$525.2953` | `$526.8264` | `+0.291%` |

All three read-only quotes were within 2% of their Chainlink answers. The
available 2 USDG is below the approximately 5 USDG target, so an executed
2 USDG basket will be labelled `pass with limits` unless the user supplies
additional USDG before the check.

LiFi and 1inch comparison commands were also run read-only for the same
`666667` USDG slice per asset:

```sh
curl -G 'https://li.quest/v1/quote' \
  --data-urlencode 'fromChain=4663' --data-urlencode 'toChain=4663' \
  --data-urlencode "fromToken=$USDG_ADDRESS" \
  --data-urlencode "toToken=$TOKEN_ADDRESS" \
  --data-urlencode 'fromAmount=666667' \
  --data-urlencode 'fromAddress=0x3554121694a2472300f079Afa4B1fC7F9aAFac01' \
  --data-urlencode 'toAddress=0x3554121694a2472300f079Afa4B1fC7F9aAFac01' \
  --data-urlencode 'slippage=0.02'

curl -G 'https://api.1inch.dev/swap/v6.0/4663/quote' \
  --data-urlencode "src=$USDG_ADDRESS" \
  --data-urlencode "dst=$TOKEN_ADDRESS" \
  --data-urlencode 'amount=666667'
```

Observed LiFi output:

```text
AAPL tool=sushiswap amountOut=1895416606700693 gasUSD=0.0197
NVDA tool=sushiswap amountOut=3190304270979797 gasUSD=0.0198
MSFT tool=sushiswap amountOut=1261997648052777 gasUSD=0.0197
```

Observed 1inch output for AAPL, NVDA, and MSFT:

```text
Unauthorized
```

Uniswap v3 returned the higher output for all three assets, by approximately
`0.538%` for AAPL, `0.511%` for NVDA, and `0.273%` for MSFT versus LiFi.
Uniswap is therefore the selected route for the live basket. LiFi's live quote
was still within 2% of Chainlink for each asset, but 1inch was unavailable
without an API key.

Market-hours refresh at `2026-10-30 14:48:17 WAT`, block `101772911`, using a
5 USDG basket split as `1666667/1666667/1666666` base units:

| Token | Chainlink | Uniswap output / fill | LiFi output / fill | Selected route |
|---|---:|---:|---:|---|
| AAPL | `$345.0557` | `4818007772904506` / `$345.9245` | `4810930438175844` / `$346.4334` | Uniswap |
| NVDA | `$206.2713` | `8058925493049346` / `$206.8101` | `8034550223516951` / `$207.4375` | Uniswap |
| MSFT | `$522.9949` | `3180740550982840` / `$523.9868` | `3182819985632601` / `$523.6444` | LiFi |

Uniswap was better by `0.147%` for AAPL and `0.303%` for NVDA. LiFi was
better by `0.065%` for MSFT. The planned one-action batch will use the best
read-only route per token, with every recipient set to the user wallet.

## Fork and local checks

Source files:

- `src/M1RelayerDelegate.sol`
- `src/FlatstockVotesLegacy.sol`
- `test/M1RelayerDelegate.t.sol`
- `test/FlatstockVotesLegacy.t.sol`
- `test/FlatstockVotesLegacyFork.t.sol`

Exact local command:

```sh
forge fmt --check
forge test -vv
```

Observed output:

```text
Compiler run successful!
Ran 3 test suites: 5 tests passed; 0 failed; 0 skipped
```

Exact fork command:

```sh
set -a; source .env; set +a
forge test --fork-url "$RPC_URL" --match-contract FlatstockVotesLegacyForkTest -vv
```

Observed output:

```text
[PASS] testRealWifTransfersAndBurnsOnFork()
Suite result: ok. 1 passed; 0 failed; 0 skipped
```

The fork test used the real WIF token and the configured user wallet. It
verified that a vote reduces the user's balance by exactly `1e18` WIF and
reduces total supply by exactly `1e18` WIF.

## Check 1: free gas through our own relayer

Verdict: pass.

Preferred route: EIP-7702 delegation plus the own relayer. The user wallet is
the delegated account and holds 0 ETH. The relayer wallet submits the
transaction and pays native gas. If 7702 is rejected by the chain or client,
the fallback order is EIP-712 through an own router, then an own paymaster
with a free bundler.

No paid gas service is used. Passkey sign-up is not part of this check unless
it can be added without a paid service. Normal wallet signing is the fallback.

### Mainnet transactions

| Action | Verdict | Tx hash | Gas used | Gas cost in USD | Observed output |
|---|---|---|---:|---:|---|
| Deploy relayer delegate | pass | `0xdd9de9ef162c8a7b61806f9695ff8e53c9d6941cece688716afaff926c189472` | `985879` | `$0.0439` | Deployed at `0x8BDD498234E2272c97ACb1aA19Dc136BE8B2914C`; status `0x1` |
| Delegated user buy | pass | `0x8285a2ad524a864cf93bc2f575b7db79ddf3ad0dc07ec6ab9313587f049e8d5a` | `707756` | `$0.0320` | User ETH remained `0`; relayer paid; one batch delivered three Stock Tokens |
| WIF gas reimbursement path | deferred | — | — | — | Not required by PLAN-v3 M1; no extra mainnet transaction sent |

The first delegated approval attempt was broadcast with `approve(...)` sent
directly to the delegated account. It reverted because the delegate exposes
`execute(...)`, not a fallback. The authorization itself persisted and the
user nonce advanced to 1. Receipt:

```text
tx: 0x4578dade532e69f7d754c69f6265a07228d53ff7622137868a83459aff726343
status: 0x0
gasUsed: 47124
revert: empty at the RPC, local replay showed the direct approve call reverted
gasCostUSD: approximately $0.0021
```

The corrected delegated approval call succeeded:

```sh
approve_data=$(cast calldata 'approve(address,uint256)' "$VOTE_CONTRACT_ADDRESS" 1000000000000000000)
execute_data=$(cast calldata 'execute(address,uint256,bytes)' "$WIF_ADDRESS" 0 "$approve_data")
cast send 0x3554121694a2472300f079Afa4B1fC7F9aAFac01 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --data "$execute_data" --force --json
```

```text
tx: 0x6d3dd259a3456edba2a65467a4c9bc5153014b55336d72eef2b84645f4159754
status: 0x1
gasUsed: 54777
effectiveGasPrice: 20030000 wei
gasCost: 1097183310000 wei = 0.00000109718331 ETH
ETH/USD observation: $2226.92
gasCostUSD: approximately $0.0024
WIF allowance after receipt: 1000000000000000000
```

Deployment command and observed output:

```sh
set -a; source .env; set +a
relayer=$(cast wallet address --private-key "$M1_RELAYER_PRIVATE_KEY")
forge create src/M1RelayerDelegate.sol:M1RelayerDelegate \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json --constructor-args "$relayer"
```

```text
deployer: 0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
deployedTo: 0x8BDD498234E2272c97ACb1aA19Dc136BE8B2914C
transactionHash: 0xdd9de9ef162c8a7b61806f9695ff8e53c9d6941cece688716afaff926c189472
status: 0x1
block: 101593767
gasUsed: 985879
effectiveGasPrice: 20050000 wei
gasCost: 19766873950000 wei = 0.00001976687395 ETH
ETH/USD observation: $2222.67
gasCostUSD: approximately $0.0439
```

Gas USD calculation will use the receipt's `gasUsed * effectiveGasPrice` and
the ETH/USD price observed at the receipt timestamp. The relayer sender and
user balance before each operation will be recorded.

Basket receipt details for the Check 1 buy:

```text
status: 0x1
block: 0x610f3df
block timestamp: 2026-10-30 14:50:44 WAT +0100
from: 0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
to: 0x3554121694a2472300f079Afa4B1fC7F9aAFac01
gasUsed: 707756
effectiveGasPrice: 20384000 wei
gasCost: 14426898304000 wei = 0.000014426898304 ETH
ETH/USD observation: $2216.30
gasCostUSD: approximately $0.03197
user ETH after receipt: 0
relayer ETH after receipt: 0.000425405094978223
```

## Check 2: one-action basket buy and sell

Verdict: pass.

The executed one-action basket used one EIP-7702 relayed batch. Two swaps used
Uniswap v3 and the MSFT swap used LiFi's SushiSwap route. Every recipient was
the user wallet, never this repository's contract. The executed amount was the
smallest practical basket target, 5 USDG.

Read-only gas estimates at the current state:

```text
One-token approve + swap through executeBatch: 209294 gas
Three-token approve + swap batch: 518659 gas
Planned sell-back allowance: approximately 200000 gas
```

The remaining hard estimate is approximately `927953` gas if a separate
one-token Check 1 buy is kept. At approximately 20.2 million wei per gas this
is about `0.0000188 ETH`, or `$0.0418` at the `$2226.92` ETH/USD observation.
The practical minimum with a 3x safety buffer is `0.00006 ETH`. The relayer
balance after the approved deployment and vote round was
`0.000439831993282223 ETH`, so no top-up is currently required for gas if the
balance does not change. If the basket buy also serves as Check 1, the hard
estimate is lower, approximately `0.0000145 ETH` before buffer.

### Mainnet transactions

| Action | Verdict | Tx hash | Fill vs Chainlink | Gas cost in USD | Observed output |
|---|---|---|---:|---:|---|
| One-action basket buy | pass | `0x8285a2ad524a864cf93bc2f575b7db79ddf3ad0dc07ec6ab9313587f049e8d5a` | within 2% for all three | `$0.0320` | 5 USDG spent, tokens arrived in user wallet |
| Sell one Stock Token back | pass | `0x2eeafc82e1e87f3518bc92248bc992ae545b07cdfc29d8bed929b6a4479b6353` | `+0.129%` vs Chainlink | `$0.00765` | AAPL balance returned to `0`; user received `1667257` USDG base units |

Executed buy amounts and final user balances:

```text
USDG spent: 5000000 base units = 5 USDG
USDG remaining: 3000000 base units = 3 USDG
AAPL received: 4825632685056768
NVDA received: 8051402067604444
MSFT received: 3182819985632601
user ETH: 0
```

Fill verification using receipt balances and the market-hours Chainlink
answers:

| Token | Amount in USDG | Amount out | Chainlink | Actual fill | Difference |
|---|---:|---:|---:|---:|---:|
| AAPL | `1666667` | `4825632685056768` | `$345.0557` | `$345.3779` | `+0.093%` |
| NVDA | `1666667` | `8051402067604444` | `$206.2713` | `$207.0033` | `+0.355%` |
| MSFT | `1666666` | `3182819985632601` | `$522.9949` | `$523.6444` | `+0.124%` |

Selected routes were Uniswap v3 for AAPL and NVDA, and LiFi's SushiSwap
route for MSFT. All recipients were the user wallet. No Stock Token was sent
to this repository's contracts.

Sell-back receipt and final balances:

```text
status: 0x1
block: 0x610f96a
gasUsed: 169984
effectiveGasPrice: 20298000 wei
gasCost: 3450335232000 wei = 0.000003450335232 ETH
ETH/USD observation: $2212.92
gasCostUSD: approximately $0.00765
AAPL sold: 4825632685056768
USDG received: 1667257 base units = 1.667257 USDG
user USDG after sell: 4667257 base units = 4.667257 USDG
user AAPL after sell: 0
user NVDA after sell: 8051402067604444
user MSFT after sell: 3182819985632601
user ETH after sell: 0
relayer ETH after sell: 0.000421954759746223
```

The sell fill was approximately `$345.5002` against the AAPL Chainlink answer
of `$345.0557`, a `+0.129%` difference.

## Check 3: WIF vote count, burn, and close

Fork verdict: pass. Mainnet verdict: pass.

The fork implementation proves:

- vote cost is exactly 1 WIF;
- the 1 WIF is burned from total supply;
- a second vote by the same wallet in the same round reverts;
- weight basis points match vote counts;
- a vote after close reverts and cannot change weights.

### Mainnet transactions

| Action | Verdict | Tx hash / error | Gas cost in USD | Observed output |
|---|---|---|---:|---|
| Deploy vote contract | pass | `0x84c01f06902ced5af721a05b6096f1a332b53ad4729f01b16db7364bc3373501` | `$0.0276` | Deployed at `0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9`; status `0x1`; gas `614517` |
| Approve exactly 1 WIF | pass | `0x6d3dd259a3456edba2a65467a4c9bc5153014b55336d72eef2b84645f4159754` | `$0.0024` | Delegated approval succeeded; allowance `1e18` |
| Open tiny round | pass | `0xd72cea1df3f49e0bc3e32d93c846c9e4928c5c3f5cf043df5219000329c7f591` | `$0.0021` | Round 1, 3 assets, closes at `1793350406`; gas `46768` |
| Vote once | pass | `0x863a7334f138fb061596cf9b2f1ef30218348e9ad0b594fd60ef90ef6c787d07` | `$0.0056` | User WIF and total supply each decreased by `1e18`; gas `125198` |
| Same-wallet second vote | pass | `0xa3ee0c11c835496e3096c0437b5ff7c92ea0dee1af0c000a3e0e825857c7af1a` | `$0.0015` | Reverted; local replay decoded `AlreadyVoted()`; gas `34271` |
| Close round | pass | `0xdd1b21fa64e9424054cf52c23e33acaf40b65f6d9e5cac19245941e9be5e79f8` | `$0.0022` | Status `0x1`; total votes `1`; gas `49878` |
| Post-close vote | pass | `0x07cdee30d4be1850d10347ecf7aa0fb7d6ac3441514d5cd6066411d7e8761510` | `$0.0014` | Reverted; local replay decoded `RoundNotOpen()`; gas `31720` |

Vote contract deployment command:

```sh
forge create src/FlatstockVotesLegacy.sol:FlatstockVotesLegacy \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json --constructor-args "$WIF_ADDRESS"
```

Round and vote commands used the deployed address from `.env`:

```sh
cast send "$VOTE_CONTRACT_ADDRESS" 'openRound(uint256,uint8,uint64)' 1 3 1793350406 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
vote_data=$(cast calldata 'vote(uint256,uint8)' 1 0)
execute_data=$(cast calldata 'execute(address,uint256,bytes)' "$VOTE_CONTRACT_ADDRESS" 0 "$vote_data")
cast send 0x3554121694a2472300f079Afa4B1fC7F9aAFac01 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --data "$execute_data" --force --json
cast send "$VOTE_CONTRACT_ADDRESS" 'closeRound(uint256)' 1 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
```

Final read-only state:

```text
round: opensAt 1793350301, closesAt 1793350406, assetCount 3, totalVotes 1, closed true
hasVoted(user): true
votesFor[1][0]: 1
weightBps[1][0..2]: 10000, 0, 0
user WIF: 999000000000000000000
WIF totalSupply: 999998683260000000000000000
```

## Final M1 acceptance verification

These commands were run after the live receipts were recorded:

```sh
git diff --check
forge fmt --check
forge test -vv
```

Observed output:

```text
git diff --check: exit 0, no output
forge fmt --check: exit 0, no output
Compiler run successful!
Ran 3 test suites in 30.80ms: 5 tests passed; 0 failed; 0 skipped
```

The chain-dependent acceptance command was:

```sh
set -a
source .env
set +a
forge test --fork-url "$RPC_URL" -vv
```

Observed output:

```text
No files changed, compilation skipped
Ran 2 tests for FlatstockVotesLegacyTest: 2 passed; 0 failed; 0 skipped
Ran 1 test for FlatstockVotesLegacyForkTest: 1 passed; 0 failed; 0 skipped
Ran 2 tests for M1RelayerDelegateTest: 2 passed; 0 failed; 0 skipped
Ran 3 test suites in 5.46s: 5 tests passed; 0 failed; 0 skipped
```

The fork run emitted only cache and Etherscan-config warnings. It completed
successfully and used the real WIF fork test.

## M1 completion notes

- Check 1: pass. Own EIP-7702 relayer sponsored the delegated user buy while the user held 0 ETH.
- Check 2: pass. One 5 USDG action bought three Stock Tokens, all fills were within 2% of Chainlink, tokens arrived in the user wallet, and AAPL sold back within 2%.
- Check 3: pass. The fork and tiny mainnet round proved the 1 WIF burn, duplicate-vote rejection, close-time weight freeze, and post-close rejection.
- M2 evidence is documented below.
- The product name, logo, subdomain, and licence remain unchosen.

## M2 mainnet acceptance

M2 verdict: pass with limits.

The own EIP-7702 relayer, lock contract, buy router, and first live round are
deployed on chain `4663`:

```text
FlatstockLock            0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121
FlatstockBuyRouterLegacy 0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA
Vote contract       0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9
EIP-7702 delegate   0x8BDD498234E2272c97ACb1aA19Dc136BE8B2914C
```

The lock minimum is `10 WIF`. An unlocked buy burns `0.01 WIF`. All M2
transactions below were paid by the relayer, and the user wallet held `0 ETH`
throughout.

### Mainnet transactions

ETH/USD conversion uses the `$2212.92` observation recorded for the same M1
execution session.

| Action | Verdict | Tx hash | Gas used | Gas cost in USD | Observed output |
|---|---|---|---:|---:|---|
| Deploy lock contract | pass | `0x9bc21365bdce6e760b324d79bae09c0d3353c2d3e8eae3adc193215acd6ad9a4` | `347167` | `$0.01614` | Status `0x1`; deployed at `0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121`; minimum `10 WIF` |
| Deploy buy router | pass | `0x7e62da92bbcbf377f7d2321b6cbb8b0948aa346dd7aa8d5896cfc9047564f703` | `479671` | `$0.02176` | Status `0x1`; deployed at `0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA` |
| Open round 2 | pass | `0x52e69220f6c5f4e91b83357bcb26dfeccb0f70a96403922ca8f0f51f21e1659f` | `46539` | `$0.00209` | Three assets; closes at `1793455958` |
| Unlocked buy | pass | `0x5aca7762b3e81a84ea88dc1a4c93d5679126a29f56422e127602adc6b5dbb89f` | `267091` | `$0.01200` | `0.1 USDG` spent; `0.01 WIF` burned; `0.482897403598453` NVDA received |
| Lock user | pass | `0xb54a7b06bd16daca94b8e92f49d8bde3449d6a80d46a5b32f899b2eaf393e512` | `98644` | `$0.00452` | `10 WIF` locked; `isLocked(user)=true` |
| Single locked buy | pass | `0xabe56d3ef29b0839432c8c2b0e5fb3e0806b8e09ef2773837268adb221eaff76` | `222032` | `$0.01001` | `0.1 USDG` spent; `0 WIF` burned; `0.288893162261309` AAPL received |
| Round-2 vote | pass | `0x9580f2321f692dbdf8dc51fa4648e347ed81c7f00002622982f3d436db4a67c8` | `141208` | `$0.00639` | Exactly `1 WIF` burned; `votesFor[2][0]=1` |
| Three-token locked mix | pass with limits | `0x62a8604c341ce3437af110bab648e510d215860ca51b67187629b87773cfa256` | `470311` | `$0.02155` | `0.3 USDG` spent across AAPL/NVDA/MSFT; no WIF burned; all outputs went to user |

Deployment commands:

```sh
set -a; source .env; set +a
forge create src/FlatstockLock.sol:FlatstockLock \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json --constructor-args "$WIF_ADDRESS" 10000000000000000000
forge create src/FlatstockBuyRouterLegacy.sol:FlatstockBuyRouterLegacy \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json \
  --constructor-args "$WIF_ADDRESS" "$LOCK_CONTRACT_ADDRESS" \
  "$UNISWAP_ROUTER_ADDRESS" "$NON_LOCKER_GAS_WIF"
```

Round-opening command:

```sh
cast send "$VOTE_CONTRACT_ADDRESS" \
  'openRound(uint256,uint8,uint64)' 2 3 1793455958 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --force --json
```

The unlocked buy used one delegated batch containing USDG approval, WIF
approval, and the following router call:

```sh
buyData=$(cast calldata \
  'buyUniswap(address,address,uint24,uint256,uint256,uint160,uint256)' \
  "$USDG_ADDRESS" "$STOCK_TOKEN_ADDRESS" 500 100000 \
  473239455526483 0 "$NON_LOCKER_GAS_WIF")
```

The lock setup used one delegated batch containing:

```sh
lockApprove=$(cast calldata 'approve(address,uint256)' \
  "$LOCK_CONTRACT_ADDRESS" 10000000000000000000)
lockCall=$(cast calldata 'lock(uint256)' 10000000000000000000)
```

The three-token locked mix used one delegated batch with one USDG approval and
three `buyUniswap` calls for `100000` USDG base units each. The live outputs
were:

| Token | Increment received | Chainlink at receipt block | Actual fill | Difference |
|---|---:|---:|---:|---:|
| AAPL | `286600499005546` | `$348.669763` | `$348.917746` | `+0.071%` |
| NVDA | `482357504271390` | `$207.465694` | `$207.315112` | `-0.073%` |
| MSFT | `190411909181690` | `$523.277500` | `$525.177235` | `+0.363%` |

All three fills were within 2% of Chainlink. The M2 router currently uses the
verified Uniswap v3 fallback only. During the live mix preparation, the RPC
reset while refreshing the NVDA quote, so that one call was encoded with
`amountOutMinimum=0`; the receipt still filled within 2%, but this is the
limit on the M2 verdict and must be fixed before treating the route as
production-safe.

Final M2 read-only state:

```text
user ETH: 0
user WIF: 987990000000000000000
locked WIF: 10000000000000000000
user USDG: 4167257 = 4.167257 USDG
user AAPL: 575493661266855
user NVDA: 9016656975474287
user MSFT: 3373231894814291
WIF totalSupply: 999998681250000000000000000
round 2: totalVotes 1, closed false
round 2 hasVoted(user): true
round 2 votesFor[0]: 1
relayer ETH: 0.000379269014454223
```

M2 acceptance verification:

```text
git diff --check: exit 0
forge fmt --check: exit 0
forge test -vv: 7 passed; 0 failed; 0 skipped
forge test --fork-url "$RPC_URL" -vv: 7 passed; 0 failed; 0 skipped
```

The fork run included the real-WIF fork test and the new locked/unlocked
router tests. It emitted only cache and Etherscan-config warnings.

M2 is complete with the quote-refresh limit documented above. M3 has not
started.

## Mix correction and QuickNode diagnostic

### Round 4 zero-vote root cause

Read-only mainnet check through the VPS RPC proxy, chain `4663`:

```text
latestRoundId=4
round4=opensAt 1793704615, closesAt 1794232800, assetCount 3, totalVotes 0, closed false
voteShareBps=5000
weightBps(AAPL,NVDA,MSFT)=2501 2499 5000
finalWeightBps(AAPL,NVDA,MSFT)=0 0 0
```

Round 4 has no stored final weights yet because it is open. The incorrect live
preview is caused by the zero-vote case in the deployed contract: it blended
the equal-weight half with zero vote weight, assigned the missing 50% to the
last asset, then capped and redistributed it. There is no round-3 carry-over.

The source fix returns the equal allocation directly when `totalVotes == 0`.
The browser mirror now does the same, and displays integer basis points as
exact two-decimal percentages. Three assets therefore display `33.34%`,
`33.33%`, `33.33%`, summing to `100.00%`.

The deployed round-4 contract still returns the old `weightBps` preview until a
replacement contract is deployed. No mainnet transaction was sent. The stored
round-4 weights are not wrong because they are still unset. Any replacement
deployment or round migration requires separate approval first.

### Mix regression acceptance

Added contract tests for zero votes, one vote, and many votes. The many-vote
case also closes the round and checks that final weights persist.

```text
forge test -vv
Ran 4 test suites: 10 tests passed, 0 failed, 0 skipped
npm run build --prefix web
vite v8.3.5
✓ 440 modules transformed
✓ built successfully
git diff --check: exit 0, no output
```

The local signed-out page now shows:

```text
Vote round 4
Open
Closes 9 Nov 2026, 15:00. 0 votes counted.
AAPL 33.34%
NVDA 33.33%
MSFT 33.33%
```

### QuickNode chain diagnostic

Added `deploy/check-quicknode-chain.sh`. Run it on the VPS with:

```sh
sudo /opt/flatstock/deploy/check-quicknode-chain.sh
```

It prints only `http_status` and `chain_id`, never the endpoint. Observed on
the VPS after deployment:

```text
http_status=200
chain_id=0x1237
```

The standard RPC credential works. The separate Stock Token API method probes
still return upstream HTTP 401, so the QuickNode Stock Token add-on or method
authorization remains unresolved.

## M4 QuickNode response acceptance after add-on

The Stock Token API add-on is now active. All four probes were run through the
VPS proxy on chain `4663`. The endpoint was not printed.

### `qn_getStockTokenBalances`

Observed response excerpt:

```json
{"blockNumber":"0x643a017","holdings":[{"symbol":"AAPL","balanceRaw":"575493661266855","balanceUiDecimal":"0.000575819436753783","priceUsd":"325.78431566","valueUsd":"0.18748680"},{"symbol":"MSFT","balanceRaw":"3373231894814291","balanceUiDecimal":"0.003374624879615394","priceUsd":"506.11891683","valueUsd":"1.70725647"},{"symbol":"NVDA","balanceRaw":"23730493459797947","balanceUiDecimal":"0.023748888369284515","priceUsd":"206.53097037","valueUsd":"4.90108184"}],"totalValueUsd":"6.79582511","totalValueUsdComplete":true,"warnings":[]}
```

Verdict: pass. The UI maps `balanceUiDecimal` to shares and `valueUsd` to
portfolio value.

### `qn_getCorporateActions`

Observed response excerpt:

```json
{"blockNumber":"0x643a017","actions":[{"symbol":"MSFT","type":"CASH_DIVIDEND","status":"EFFECTIVE","ratio":"1.000412952576205964","effectiveAtIso":"2026-09-11T15:10:30Z"},{"symbol":"NVDA","type":"CASH_DIVIDEND","status":"EFFECTIVE","ratio":"1.000775159164630595","effectiveAtIso":"2026-09-10T00:00:30Z"},{"symbol":"AAPL","type":"CASH_DIVIDEND","status":"EFFECTIVE","ratio":"1.000566080061092436","effectiveAtIso":"2026-08-14T15:12:46Z"}],"nextCursor":null,"warnings":[]}
```

Verdict: pass. Live app text:

```text
MSFT paid a dividend, your shares grew.
NVDA paid a dividend, your shares grew.
AAPL paid a dividend, your shares grew.
```

### `qn_getOracleHealth`

Observed response excerpt:

```json
{"blockNumber":"0x643a017","feeds":[{"symbol":"AAPL","answer":"32578431566","ageSeconds":2221,"stale":false,"oraclePaused":false,"status":"OK"},{"symbol":"MSFT","answer":"50611891683","ageSeconds":36,"stale":false,"oraclePaused":false,"status":"OK"},{"symbol":"NVDA","answer":"20653097037","ageSeconds":298,"stale":false,"oraclePaused":false,"status":"OK"}],"warnings":["SEQUENCER_STATUS_UNKNOWN"]}
```

Verdict: pass for all requested stock feeds. The `SEQUENCER_STATUS_UNKNOWN`
warning is global metadata; each feed is fresh, unpaused, and `status=OK`.

### `qn_getTransactionFinality`

Observed response excerpt:

```json
{"txHash":"0x0042c543774d2eb67f1a392094e766485ff64af2766646746b4ca6d3f2038f14","blockNumber":"0x61fa3af","stage":"FINALIZED","stages":{"soft":true,"posted":true,"safe":true,"finalized":true},"l1Confirmations":20254,"warnings":[]}
```

Verdict: pass. The finality gate now accepts `stages.soft === true` and the
live response is `FINALIZED`. The previous code incorrectly expected `soft`
at the top level.

## Current replacement-contract migration

This section supersedes earlier replacement-contract entries in this file.

### Fixed vote-contract deployment

Verdict: pass.

The user approved deployment before the transaction was sent.

Exact commands used:

```sh
set -a; source .env; set +a
forge build
cast send --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --create "$(cat out/FlatstockVotesLegacy.sol/FlatstockVotesLegacy.bin)$(cast abi-encode 'f(address)' "$WIF_ADDRESS" | cut -c3-)" \
  --json
cast receipt 0x39fe0c7813c84d8a7866d1dca6f63e9636a19b36e98915414fcd45cd0c2b16dc \
  --rpc-url "$RPC_URL"
```

Observed output:

```text
contract=0x68d2622f3bbf6BE80CdfED679489de344410C7Db
transactionHash=0x39fe0c7813c84d8a7866d1dca6f63e9636a19b36e98915414fcd45cd0c2b16dc
blockNumber=105102888
status=1
gasUsed=1475306
effectiveGasPrice=20112000 wei
gasCost=0.000029671354272 ETH
owner=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
wif=0x5173b8eA6923c2d40267890D45C46a3480954773
```

The deployment used approximately `$0.06686` at the recorded `$2,252.50`
ETH/USD observation.

Sourcify verification:

```text
job=54011ba7-a930-48f2-a785-1d7438be4c3a
result=exact_match
```

Verification URL: https://sourcify.dev/server/verify-ui/jobs/54011ba7-a930-48f2-a785-1d7438be4c3a

Blockscout verification page:

https://robinhoodchain.blockscout.com/address/0x68d2622f3bbf6BE80CdfED679489de344410C7Db?tab=contract

Observed page text: `Contract source code verified (exact match)`, contract
`FlatstockVotesLegacy`, compiler `0.8.24+commit.e11b9ed9`, EVM `cancun`, optimization
enabled with 200 runs.

### Round 4 opening on the fixed contract

Verdict: pass.

The user approved opening round 4 before the transaction was sent.

Exact command:

```sh
set -a; source .env; set +a
NEW=0x68d2622f3bbf6BE80CdfED679489de344410C7Db
cast send "$NEW" 'openRound(uint256,uint8,uint64,uint16)' 4 3 1794232800 5000 \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" --json
cast receipt 0x00361329781db6930e6ac8ab5b36eb57e063b884e3303564c62feff94887f0c4 \
  --rpc-url "$RPC_URL"
cast call "$NEW" 'latestRoundId()(uint256)' --rpc-url "$RPC_URL"
cast call "$NEW" 'rounds(uint256)(uint64,uint64,uint8,uint256,bool)' 4 --rpc-url "$RPC_URL"
cast call "$NEW" 'voteShareBps(uint256)(uint16)' 4 --rpc-url "$RPC_URL"
cast call "$NEW" 'weightBps(uint256,uint256)(uint256)' 4 0 --rpc-url "$RPC_URL"
cast call "$NEW" 'weightBps(uint256,uint256)(uint256)' 4 1 --rpc-url "$RPC_URL"
cast call "$NEW" 'weightBps(uint256,uint256)(uint256)' 4 2 --rpc-url "$RPC_URL"
```

Observed output:

```text
transactionHash=0x00361329781db6930e6ac8ab5b36eb57e063b884e3303564c62feff94887f0c4
status=1
latestRoundId=4
round4=1793713616 1794232800 3 0 false
voteShareBps=5000
weightBps=3334
3333
3333
finalWeightBps=0
0
0
```

The open round has zero votes, so the live preview is equal-weight with the
largest remainder assigned deterministically to the first stock. Final
weights remain unset until the close function runs.

### App address migration and live signed-out proof

Verdict: pass.

The app now reads `latestRoundId()` from the single configured
`VITE_VOTES_ADDRESS`. It no longer reads the old empty round 4. The burn
counter reads vote events from all three vote contracts:

```text
VITE_VOTES_ADDRESS=0x68d2622f3bbf6BE80CdfED679489de344410C7Db
voteStatsAddresses[0]=0x68d2622f3bbf6BE80CdfED679489de344410C7Db
voteStatsAddresses[1]=0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9
voteStatsAddresses[2]=0xD49249D2a5CffBCF35B6560857d1d1C703802e78
```

The Vercel Production `VITE_VOTES_ADDRESS` was updated to the new address and
redeployed once for the environment change. After pushing commit `f43afa2`,
the connected GitHub project created the current production deployment
`CXezo4Ci41RhRVkYxruNEG541ikw`, which is Ready and uses the current source.

Observed live text from `https://app.flatstock.ajkadri.dev/` after the current
`f43afa2` deployment:

```text
Flatstock
Read-only
Notice Not available to US persons. Not investment advice.
Buy the US stocks the community picked, in one tap, with no gas.
WIF burned by votes
3 WIF
Vote round 4
Open
Closes 9 Nov 2026, 15:00. 0 votes counted.
Mix rule preview: 50% equal-weight plus 50% vote share. No stock can exceed 50%.
AAPL 33.34%
NVDA 33.33%
MSFT 33.33%
MSFT paid a dividend, your shares grew.
NVDA paid a dividend, your shares grew.
AAPL paid a dividend, your shares grew.
Portfolio
Connect a wallet to see Stock Tokens held by that wallet.
Self-custody only. The app never holds your funds. Live data from chain 4663.
```

The signed-out acceptance is pass. Wallet-gated portfolio balances remain
intentionally unavailable until a wallet connects; the four real QuickNode
responses above are the data source used when it does.

## Live end-to-end judging test prepared: 3 Nov 2026

Status: ready for the user's phone. US market-hours window today is 15:30–22:00 WAT.
No new mainnet transaction has been sent by the agent for this test.

### Preflight

The relayer kill switch was turned off through the VPS admin endpoint at
14:58:18 WAT. The per-wallet daily cap remains 3.

Exact read-only and control commands:

```sh
ssh root@2.29.11.26 'curl -fsS http://127.0.0.1:8788/api/health'
ssh root@2.29.11.26 'set -a; . /etc/flatstock/flatstock.env; set +a; port=${M3_RELAYER_PORT:-8787}; curl -fsS -X POST "http://127.0.0.1:${port}/api/relay/kill-switch" -H "Authorization: Bearer ${M3_RELAYER_ADMIN_TOKEN}" -H "Content-Type: application/json" --data-binary "{\"enabled\":false}"'
```

Observed output:

```text
{"killSwitch":false}
{"enabled":true,"killSwitch":false,"dailyCap":3,"usage":0,"relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4","quickNode":true}
```

Relayer balance before the test:

```text
address=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
nativeBalance=0.000314384448776223 ETH
```

The QuickNode endpoint and admin token were not printed.

### User-controlled transaction checklist

The agent must ask immediately before each transaction and must not submit the
user's vote from a script.

1. Vote 1 WIF in round 4 from the phone UI. Record the wallet confirmation,
   receipt, exactly 1 WIF burned, and the updated mix.
2. During 15:30–22:00 WAT, connect the locked wallet and run one gasless buy
   of the full AAPL/NVDA/MSFT mix. Record every quote, Chainlink comparison,
   relayer gas cost, finality response, and QuickNode share balances.
3. Connect a wallet with no WIF lock and run the smallest buy. Record the WIF
   gas payment, burn transaction, and relayer gas cost.
4. Sell one Stock Token to USDG. Record the sell quote, receipt, USDG received,
   and relayer gas cost.

For each item the record must include the exact command or UI action, tx hash,
receipt output, verdict, and any limits. The kill switch remains off only for
this test window and will be re-enabled after the final check unless the user
instructs otherwise.

### Relayer funding estimate

The current balance is enough for the four planned tiny transactions under the
observed gas range, but it is not a judging reserve. Prior sponsored activity
used approximately `0.0000144–0.0000198 ETH` for a buy and deployment-scale
transactions were higher. Planning at `0.00002 ETH` per sponsored transaction:

```text
10 judging wallets x 3 sponsored transactions x 0.00002 ETH = 0.0006 ETH
2x operating reserve target = 0.0012 ETH total
current balance = 0.000314384448776223 ETH
recommended top-up = approximately 0.0009 ETH
```

This is a planning estimate, not a transaction. A smaller five-wallet judging
pool needs about `0.0006 ETH` total including reserve. The daily cap is per
wallet, so a larger or repeated judging pool needs a larger reserve.

### Vote approval warning diagnosis

The phone warning `Token approval target is not allowed` is a real relayer
configuration mismatch, not a request to approve an arbitrary spender.

Observed state:

```text
frontend VITE_VOTES_ADDRESS=0x68d2622f3bbf6BE80CdfED679489de344410C7Db
VPS VOTE_CONTRACT_ADDRESS=0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9
relayer response=Token approval target is not allowed.
```

The frontend correctly builds `WIF.approve(newVoteContract, 1 WIF)`, but the
VPS relayer had the old vote contract hard-coded as its allowed approval target.
The fix makes the relayer read `VOTE_CONTRACT_ADDRESS` from its VPS-only env,
defaulting to the current verified contract, then restarts it with the new
address. No user funds or mainnet transaction are sent by this fix.

Observed after the VPS update:

```text
source=a5a3343
vote_address=0x68d2622f3bbf6BE80CdfED679489de344410C7Db
service=active
killSwitch=false
dailyCap=3
usage=0
quickNode=true
```

The earlier wallet warning occurred before a transaction was accepted, so no
WIF was spent. The vote can be retried from the phone UI now.

### Round 4 phone vote

Verdict: pass.

The user supplied this transaction after confirming the sponsored vote in the
phone UI:

```text
tx=0x1c5c0b5ed895adeec2c9c40213f8bd18db50b2bcf444b39a43ddfc0eed707489
chainId=4663
from=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
to=0x3554121694a2472300f079Afa4B1fC7F9aAFac01
status=1
block=105117844
gasUsed=141232
effectiveGasPrice=20000000 wei
gasCost=0.00000282464 ETH
```

The relayer called the user's EIP-7702 delegated account. The receipt logs
showed `WIF.approve(0x68d2622f3bbf6BE80CdfED679489de344410C7Db, 1 WIF)`, a
1-WIF transfer from the user to the vote contract, a 1-WIF transfer from the
vote contract to the zero address, and `VoteCast(roundId=4, assetIndex=0)`.

Read-only verification after the receipt:

```text
hasVoted(round4,user)=true
votesFor(round4,AAPL)=1
round4=opensAt 1793713616, closesAt 1794232800, assetCount 3, totalVotes 1, closed false
weightBps=5000, 2500, 2500
user WIF balance=985.99 WIF
```

The missing wallet popup is expected after EIP-7702 delegation. The wallet
approved the delegation earlier; the current UI confirmation is not a new
cryptographic wallet signature. This is a documented limitation of the current
relayer flow and should be made explicit before judging.

### Locked-wallet full-mix buy

Verdict: pass with limits.

The user supplied this transaction after confirming the gasless full-mix buy
from the locked wallet in the phone UI:

```text
tx=0x063d01815192fdaf9b1f1ead196ed57cc0e15df601bed5dbe845b8a504ef624f
chainId=4663
from=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
to=0x3554121694a2472300f079Afa4B1fC7F9aAFac01
status=1
block=105120398
gasUsed=470626
effectiveGasPrice=20082000 wei
gasCost=0.000009451111332 ETH
```

The batch spent `1.000000 USDG` across the current 50%/25%/25% mix through
the Uniswap v3 fallback. All three Stock Tokens were transferred to the user
wallet:

| Asset | USDG in | Shares out | Chainlink | Fill | Difference |
| --- | ---: | ---: | ---: | ---: | ---: |
| AAPL | `0.500000` | `0.001536048640581653` | `$325.65424207` | `$325.51052538` | `-0.0441%` |
| NVDA | `0.250000` | `0.001205990524587727` | `$207.67961006` | `$207.29847781` | `-0.1835%` |
| MSFT | `0.250000` | `0.000492241556382576` | `$506.11891683` | `$507.88072798` | `+0.3481%` |

All legs were within the 2% guard. The user wallet held 0 ETH and the relayer
paid the gas. The per-wallet relayer usage became `2/3`.

QuickNode finality through the VPS proxy:

```json
{"txHash":"0x063d01815192fdaf9b1f1ead196ed57cc0e15df601bed5dbe845b8a504ef624f","blockNumber":"0x644028e","stage":"POSTED","stages":{"soft":true,"posted":true,"safe":false,"finalized":false},"batchNumber":370487,"l1Confirmations":0,"warnings":[]}
```

The app's finality gate accepts `stages.soft=true`, so the buy-complete path
was gated by QuickNode finality. The response had advanced to `POSTED` when
recorded, but was not yet `SAFE` or `FINALIZED`; that is the limit on this
verdict.

QuickNode portfolio response through the VPS proxy after the buy:

```json
{"blockNumber":"0x64405aa","holdings":[{"symbol":"AAPL","balanceUiDecimal":"0.002112737603843737","priceUsd":"325.65424207","valueUsd":"0.68763270"},{"symbol":"MSFT","balanceUiDecimal":"0.003867069708416794","priceUsd":"506.11891683","valueUsd":"1.95638923"},{"symbol":"NVDA","balanceUiDecimal":"0.024955813728479834","priceUsd":"207.67961006","valueUsd":"5.17879927"}],"totalValueUsd":"7.82282120","totalValueUsdComplete":true,"warnings":[]}
```

Relayer balance after the vote and buy:

```text
0.000302108697444223 ETH
```

The balance reduction from the preflight value was exactly
`0.000012275751332 ETH`, matching the recorded vote and buy gas costs.

### No-lock buy attempt

Verdict: fail for the requested relayed-gas path; no buy transaction was
accepted and no WIF was burned.

The wallet from the phone error was:

```text
wallet=0xdbd9d5639996624383a446b550c7826e40411a1a
nativeBalance=0.000311458482957777 ETH
lockedWif=0
delegationCode=0x
USDG allowance to buy router=1.000000 USDG
WIF allowance to buy router=0.01 WIF
```

The wallet approved USDG and WIF, but it is not EIP-7702 delegated. The
subsequent direct `buyUniswap` request was rejected by the user wallet:

```text
to=0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA
function=buyUniswap
gasWifAmount=0.01 WIF
error=User rejected the request
buyTxHash=none
```

The WIF approval is expected for a no-lock buy. The UI was wrong to label this
path `Confirm sponsored mix`. It now distinguishes `Sponsored`, `WIF gas`,
and `Wallet gas`, and explains that a no-lock buy approves and burns `0.01 WIF`.
For the relayer-paid version of this check, the no-lock wallet must first be
delegated. The current wallet instead pays native gas directly if the swap is
confirmed.

### No-lock delegation preparation

Status: ready for the user's wallet approval. No delegation transaction has
been sent yet.

The app now exposes `Enable relayed gas` when the connected wallet has no
EIP-7702 delegation. It submits an EIP-7702 authorization for the verified
implementation `0x8BDD498234E2272c97ACb1aA19Dc136BE8B2914C`, waits for the
receipt, and refreshes the wallet state. The user must approve this one wallet
transaction before the relayer can submit the no-lock buy.

Verification:

```text
npm run build --prefix web: passed
Vercel deployment: 6EBYKuUc8e5gQHEsLNn8Hhiujkuw, Ready
current source commit: d060918
```

### No-lock delegation attempt

Verdict: fail. The supplied transaction succeeded as a normal self-transfer,
but it did not install EIP-7702 code.

```text
tx=0x8896d9d5641936d4ff1d1f93d4f221ad13ced03697e3363311a4f6f5f0d173c1
from=0xdbd9d5639996624383a446b550c7826e40411a1a
to=0xdbd9d5639996624383a446b550c7826e40411a1a
type=2
status=1
gasUsed=21000
effectiveGasPrice=26654000 wei
gasCost=0.000000559734 ETH
delegatedCodeAfter=0x
```

There was no authorization list in the submitted transaction. The wallet
provider accepted the ordinary zero-value self-transfer and ignored the
EIP-7702 authorization field. The transaction cost approximately `$0.00126`
at the recorded `$2,252.50` ETH/USD observation, but no delegation was
installed and no buy was sent.

## Signature-safe vote contract deployment

Date checked: 2026-11-03 WAT. The user approved this deployment only. The
router deployment and opening a round remain separately gated.

Exact command:

```sh
set -a; source .env; set +a
forge create src/FlatstockVotes.sol:FlatstockVotes \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json \
  --constructor-args "$WIF_ADDRESS" "$LOCK_CONTRACT_ADDRESS"
```

Observed output:

```text
deployer=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
deployedTo=0xf6E2944E801CeDbfa5f489eCD0D3BF7578aE2A9D
transactionHash=0x863603d2bc1e8e4518a098acdd5d43df23858cedc7c9f5f41e7f15a0939c499b
status=1
blockNumber=105290252
gasUsed=1444676
effectiveGasPrice=20000000 wei
gasCost=0.00002889352 ETH
```

At the recorded `$2,252.50` ETH/USD observation, deployment gas was
approximately `$0.06508`. Read-only constructor checks returned:

```text
owner()=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
wif()=0x5173b8eA6923c2d40267890D45C46a3480954773
lockContract()=0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121
latestRoundId()=0
```

Verification:

```text
Sourcify: exact_match for the already deployed pre-rename artifact
Sourcify job: c1bce528-4114-42ef-9867-d88926651a04
Blockscout: Contract source code verified (exact match) for the already deployed pre-rename artifact
Local replacement name: FlatstockVotes
Compiler: v0.8.24+commit.e11b9ed9
EVM: cancun
Optimizer: enabled, 200 runs
```

Links:

- [Deployment transaction](https://robinhoodchain.blockscout.com/tx/0x863603d2bc1e8e4518a098acdd5d43df23858cedc7c9f5f41e7f15a0939c499b)
- [Blockscout contract](https://robinhoodchain.blockscout.com/address/0xf6E2944E801CeDbfa5f489eCD0D3BF7578aE2A9D?tab=contract)
- [Sourcify verification job](https://sourcify.dev/server/verify-ui/jobs/c1bce528-4114-42ef-9867-d88926651a04)

### FlatstockVotes renamed deployment

Exact command:

```sh
set -a; source .env; set +a
forge create src/FlatstockVotes.sol:FlatstockVotes \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json \
  --constructor-args "$WIF_ADDRESS" "$LOCK_CONTRACT_ADDRESS"
```

Observed output:

```text
deployer=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
deployedTo=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
transactionHash=0x5eae4a577c38300da0d529b4d74d59f92a13aa00f8ed9ad7877ac22cc6db9924
status=1
blockNumber=105299013
gasUsed=1443803
effectiveGasPrice=20096000 wei
gasCost=0.000029014665088 ETH
gasCostAtRecorded2252.50USD=0.06535553 USD
owner()=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
wif()=0x5173b8eA6923c2d40267890D45C46a3480954773
lockContract()=0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121
latestRoundId()=0
```

Verification:

```text
Sourcify: exact_match
Sourcify job: 29ca6a5f-0b14-4ca0-af3a-a2abb39cdf01
Blockscout: Contract source code verified (exact match)
Contract name: FlatstockVotes
Compiler: v0.8.24+commit.e11b9ed9
EVM: cancun
Optimizer: enabled, 200 runs
Contract file path: src/FlatstockVotes.sol
```

Links:

- [Deployment transaction](https://robinhoodchain.blockscout.com/tx/0x5eae4a577c38300da0d529b4d74d59f92a13aa00f8ed9ad7877ac22cc6db9924)
- [Blockscout contract](https://robinhoodchain.blockscout.com/address/0x4BB945800d588E6B4DB287b3fCe9C13f7825A968?tab=contract)
- [Sourcify verification job](https://sourcify.dev/server/verify-ui/jobs/29ca6a5f-0b14-4ca0-af3a-a2abb39cdf01)

## Product-name contract migration

Date checked: 2026-11-03 WAT.

The local Solidity, tests, relayer references, UI references, and tracked docs
now use the Flatstock names. The generated Foundry `out/` and `cache/`
directories are disposable build artifacts and are not tracked.

| Local target | Mainnet status | Vercel value |
| --- | --- | --- |
| `FlatstockVotes` | Deployed at `0x4BB945800d588E6B4DB287b3fCe9C13f7825A968`; exact-match verified on Sourcify and Blockscout. | `VITE_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968` and `VITE_META_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968`. |
| `FlatstockRouter` | Deployed at `0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7`; Sourcify exact match. Blockscout public verification page is still showing its stub while propagation is pending. | `VITE_META_ROUTER_ADDRESS=0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7`. |
| `FlatstockLock` | Existing lock address is retained and no redeploy is required by this rename. | No new Vercel value. |

The renamed vote deployment was approved and sent. It has no round open yet
(`latestRoundId=0`), so no votes have been cast on it. The router deployment
was also approved and sent. Its Blockscout page is being rechecked after
Sourcify propagation.

### FlatstockRouter deployment

Exact command:

```sh
set -a; source .env; set +a
forge create src/FlatstockRouter.sol:FlatstockRouter \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json \
  --constructor-args "$USDG_ADDRESS" "$LOCK_CONTRACT_ADDRESS" "$UNISWAP_ROUTER_ADDRESS"
```

Observed output:

```text
deployer=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
deployedTo=0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7
transactionHash=0x0f7acc85d7b39bc7322bea607fe1871f578a7ad9bd594126265c36af7290e808
status=1
blockNumber=105345656
gasUsed=1416765
effectiveGasPrice=20184000 wei
gasCost=0.00002859598476 ETH
gasCostAtRecorded2252.50USD=0.06441246 USD
usdg()=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
lockContract()=0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121
swapRouter()=0xCaf681a66D020601342297493863E78C959E5cb2
```

Verification:

```text
Sourcify: exact_match
Sourcify job: 0917366e-6b0b-467c-b21e-6c2873ad186a
Sourcify v2: creationMatch=exact_match, runtimeMatch=exact_match
Blockscout: submission attempted, but the public page still showed the stub
  contract after reload; the API was blocked by Cloudflare HTTP 403.
Contract name submitted: FlatstockRouter
Compiler: v0.8.24+commit.e11b9ed9
EVM: cancun
Optimizer: enabled, 200 runs
```

Links:

- [Deployment transaction](https://robinhoodchain.blockscout.com/tx/0x0f7acc85d7b39bc7322bea607fe1871f578a7ad9bd594126265c36af7290e808)
- [Blockscout contract](https://robinhoodchain.blockscout.com/address/0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7?tab=contract)
- [Sourcify verification job](https://sourcify.dev/server/verify-ui/jobs/0917366e-6b0b-467c-b21e-6c2873ad186a)

## Live test step (d): Stock Token sell-back preflight

Date checked: 2026-11-03 WAT. This is a read-only preflight. No sell
transaction has been sent yet.

Wallet and path:

```text
wallet=0x3554121694a2472300f079Afa4B1fC7F9aAFac01
chain_id=4663
eth_balance=0 ETH
locked_wif=10 WIF
is_locked=true
path=EIP-712 signed sell via relayer, if the live app and VPS are configured with the renamed router
```

The wallet has enough Stock Tokens for a tiny test sell:

```text
AAPL=0.002111542301848508 shares
NVDA=0.024936483984385674 shares
MSFT=0.003865473451196867 shares
USDG=0.167257
```

For a `0.001`-share read-only preview, the current Uniswap v3 and Chainlink
checks returned:

| Asset | USDG quote | Minimum output | Chainlink | Difference | Oracle age | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AAPL | 0.331035 | 0.324414 | 331.49134447 | 0.14% | 1,739 sec | pass |
| NVDA | 0.207449 | 0.203300 | 206.84671493 | 0.29% | 4,621 sec | pass |
| MSFT | 0.520207 | 0.509802 | 522.92380359 | 0.52% | 2,777 sec | pass |

All three quotes were present, had nonzero quoter gas estimates, and were
within the 2% guard. All three Chainlink answers were positive and fresh under
the 86,400-second freshness limit.

Exact read-only commands:

```sh
set -a; source .env; set +a
USER=$(cast wallet address --private-key "$M1_USER_PRIVATE_KEY")
cast balance "$USER" --rpc-url "$RPC_URL" --ether
cast call "$LOCK_CONTRACT_ADDRESS" 'locked(address)(uint256)' "$USER" --rpc-url "$RPC_URL"
cast call "$LOCK_CONTRACT_ADDRESS" 'isLocked(address)(bool)' "$USER" --rpc-url "$RPC_URL"
cast call "$AAPL_TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$USER" --rpc-url "$RPC_URL"
cast call "$STOCK_TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$USER" --rpc-url "$RPC_URL"
cast call "$MSFT_TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$USER" --rpc-url "$RPC_URL"
```

The live bundle check found the new vote address but not the renamed router.
The user also confirmed that the VPS environment has no `META_ROUTER_ADDRESS`
or `VITE_META_ROUTER_ADDRESS` entry and that the running relayer still points
at the legacy router `0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA`:

```text
live_bundle=/assets/index-Bn1QHEGK.js
new_votes_address_present=true
new_router_address_present=false
old_router_fallback_present=true
```

Therefore the live sell is `pending configuration`, not pass. The user must
not sign or submit it until the frontend is rebuilt with
`VITE_META_ROUTER_ADDRESS=0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7` and the
VPS relayer environment has `META_ROUTER_ADDRESS` set to the same address.
After the user selects the token and amount, ask immediately before the sell
transaction. A successful `TradeExecuted` event will make the sell appear
automatically in the app History; no History event exists for this preflight.

### Deployment confirmation after environment update

The user supplied a Vercel settings screenshot showing these matching public
values in Production and Preview:

```text
VITE_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
VITE_META_VOTES_ADDRESS=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
VITE_META_ROUTER_ADDRESS=0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7
```

Read-only live checks after the VPS restart returned:

```text
live_bundle=/assets/index-Bn1QHEGK.js
new_votes_address_present=true
new_router_address_present=false
old_router_fallback_present=true
api_health={"enabled":true,"killSwitch":true,"dailyCap":3,"usage":0,"relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4","quickNode":true}
```

Verdict: configuration values match, but the Vercel production bundle has not
been redeployed. The live sell remains pending until a new deployment contains
the renamed router address. The relayer health endpoint is healthy, but does
not expose its configured router address.
# 2026-11-04 signed Stock Token permit sell fix

Status: local and fork verified. No mainnet sell transaction was sent.

The locked-wallet sell path now signs an exact EIP-2612 permit for the enabled
Stock Token, FlatstockRouter, exact share amount, and a five-minute deadline,
then signs the exact `sellBySig` action. The relayer verifies both signatures
and current nonces, submits the permit, waits for its receipt, then submits the
sell. A relayed sell consumes two sponsored transaction slots. The frontend
labels chain 4663 as `Robinhood Chain` and shows the independence footer.

Acceptance output:

```text
forge test -vv: 21 passed; 0 failed; 0 skipped
forge test --fork-url "$RPC_URL" -vv: 21 passed; 0 failed; 0 skipped
npm run build --prefix web: passed
forge fmt --check: exit 0
git diff --check: exit 0
```

The unit and live-NVDA fork tests cover exact permit amount, wrong amount,
wrong token, expired permit, allowance failure, successful permit plus sell,
replay rejection, and a failed sell after a successful permit. The failed path
left the Stock Token balance unchanged, left only the exact router allowance,
did not consume the sell nonce, and rejected the signed action after its
deadline. Because the deployed router's legacy sell type does not include
`sqrtPriceLimitX96`, the relayer rejects every nonzero value and the UI always
sends zero.

## Mainnet permit sell acceptance

The earlier no-transaction status above was superseded after the tested
frontend deployment was assigned to `app.flatstock.ajkadri.dev` and the
relayer ABI was corrected to include `sellNonces(address)`.

The approved 0.02 NVDA sell completed successfully:

```text
permitTx=0x7eb8cbee774ca45f850282889468df165290977f75e45baf3db6a767ad782335
permitBlock=105796314
permitStatus=0x1
sellTx=0xd55536195ee06463bbb6bfb64606c175182e089fb273dbdcc192728361f9c77f
sellBlock=105796320
sellStatus=0x1
amountIn=0.02 NVDA
amountOut=4.158288 USDG
healthAfter={"enabled":true,"killSwitch":true,"dailyCap":3,"usage":0,"signatureRelay":true}
```

The permit Approval log set the router allowance to exactly 0.02 NVDA. The
sell receipt transferred exactly 0.02 NVDA from the user wallet and emitted
4.158288 USDG to the user wallet. The app displayed `NVDA sold`, the sell
transaction link, `Robinhood Chain`, and the required independence footer.

## 2026-11-04 live test acceptance

Status: pass with an operational top-up recommendation. The requested live
test completed on chain 4663. The relayer kill switch is enabled again and the
daily sponsored transaction cap is restored to 3.

### Round 4

An initial command used the stale local `VOTE_CONTRACT_ADDRESS` and opened
round 4 on the retired contract `0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9`:

```text
tx=0x36266d10b4276f018f902888de1922d3166ff7b53df0770cc99654baf4b1c412
block=105937568
status=0x1
```

No user funds moved and the app ignored that retired contract. The command was
corrected to use the requested current contract `0x4BB945800d588E6B4DB287b3fCe9C13f7825A968`.

```text
tx=0x7776a75a5da7e8f2067a2ff23bfbcadac810bd0168b41f58713e81aa082dfe80
block=105938625
status=0x1
target=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
call=openRound(4,3,1794232800)
assetCount=3
voteShareBps=5000
round4.totalVotes=0 before voting
```

The live app showed round 4 open with the zero-vote preview AAPL 33.34%,
NVDA 33.33%, and MSFT 33.33%.

### WIF approval and gasless vote

The user wallet first received ETH because WIF has no permit and the one-time
approval must be a normal wallet transaction:

```text
topUp1=0x26c1487036ef1d7b117786cb206a841d8bb03f79726ef031eb7abecff5c05aa6
topUp1Amount=0.00001 ETH
topUp2=0xf52e8e36577daeed410beab7ab496132d3fe43c9b673efdf86883fb196c66d49
topUp2Amount=0.0001 ETH
```

The old EIP-7702 delegation blocked the first top-up attempt. It was revoked
before retrying the top-up:

```text
revokeTx=0xc5dd3155f3124e871d313e936f77a863c095a21d60bef7cbac5f9c8c130057f2
revokeBlock=105944252
revokeStatus=0x1
codeBefore=0xef01008bdd498234e2272c97acb1aa19dc136be8b2914c
codeAfter=0x
```

The one-time WIF approval then confirmed:

```text
approvalTx=0xedc5ffca74479d84613ce94e6615706bf18afbd46daffec043b9509047f86c97
approvalBlock=105947831
approvalStatus=0x1
spender=0x4BB945800d588E6B4DB287b3fCe9C13f7825A968
value=1 WIF
```

The signed AAPL vote was relayed while the kill switch was temporarily off:

```text
voteTx=0x8b119890df6bc15c41e5bf23879c8aa9db7f6637bcd77dcc18fe5c9530873524
voteBlock=105948988
voteStatus=0x1
from=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
round=4
asset=AAPL
burn=1 WIF
```

The receipt contained the exact 1 WIF transfer to FlatstockVotes and burn to
the zero address. The app showed 1 vote counted and updated the mix to AAPL
50.00%, NVDA 25.00%, and MSFT 25.00%. The kill switch was re-enabled after
the receipt.

### Gasless full-mix buy

The first buy attempt reached the wallet signatures but stopped in the
frontend before the relayer request because BigInt values were passed directly
to `JSON.stringify`. No USDG moved and no buy transaction was sent. The fix
serializes the relayed leg integer fields as strings while preserving the
original values for EIP-712 hashing. It is committed as `574abe1` and live on
the existing Flatstock Vercel project.

The corrected 3 USDG buy completed through the signature-safe router:

```text
buyTx=0x0542cc7ec4daaef168325e20a143c83fd014dbf1f25cb6ec09f5f5eae01c2fa4
buyBlock=105963056
buyStatus=0x1
from=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
amountIn=3 USDG
AAPL=1.5 USDG -> 0.00441798412505307 shares
NVDA=0.75 USDG -> 0.003673248375996948 shares
MSFT=0.75 USDG -> 0.001388000034572657 shares
quoteGuard=AAPL 0.14%, NVDA 0.01%, MSFT 0.31%
finality=SOFT
```

The app displayed `Buy complete at SOFT finality`, the three shares in the
portfolio, and all three History entries. The kill switch was re-enabled after
the receipt, and the temporary cap of 4 was restored to 3.

### Unlocked-wallet normal buy

Wallet `0x571B19687cdd91176B79b990EdFbed18Fb373dCF` had no WIF locked, held
3.121275 USDG and 0.00017 ETH before the buy, and used wallet gas:

```text
buyTx=0xcb9f199c8780b6f44e20b329a8bf678162e228da2664941c197125369a017800
buyBlock=105967231
buyStatus=0x1
from=0x571B19687cdd91176B79b990EdFbed18Fb373dCF
gasUsed=437702
amountIn=3 USDG
AAPL=1.5 USDG -> 0.00441944863066695 shares
NVDA=0.75 USDG -> 0.003672671816295346 shares
MSFT=0.75 USDG -> 0.00138800477269138 shares
```

The app showed `Buy complete at SOFT finality`, the three shares in Portfolio,
and the three matching History entries. The receipt sender was the unlocked
wallet, not the relayer.

### Final relayer state and runway

```text
health={"enabled":true,"killSwitch":true,"dailyCap":3,"usage":0,"signatureRelay":true}
relayer=0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
relayerBalance=0.000082446419572223 ETH
observedGasPrice=0.020002 gwei
```

Observed relayer costs were approximately 0.0000031 ETH for the vote and
0.0000095 ETH for the full-mix buy. For one wallet doing one vote plus one
gasless buy per day over the 12 days after 4 Nov through 16 Nov, the minimum
additional runway is about 0.000068 ETH after the current balance. A practical
top-up recommendation is 0.0002 ETH to allow fee movement and retries. This is
for one active wallet; each additional daily vote plus buy adds about 0.0000125
ETH under the observed fee level. No runway top-up was sent in this pass.

## 2026-11-05 Claude session (Lagos, from 11:00 WAT)

No mainnet transaction was sent in this session.

```text
commits=ecc40c1 (PLAN-v3.md), 29d1c65 (low-balance guard), 4072deb (close-round bot fix)
PLAN-v3.md secrets scan: clean (no keys, 64-hex strings, RPC URLs or emails)
Robinhood restricted jurisdictions (docs.robinhood.com/rhj/restricted-jurisdictions, read 5 Nov):
  restricted: US/US persons, Canada, UK, Switzerland
  prohibited: Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, Venezuela
  Nigeria: not listed
Blockscout FlatstockRouter 0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7:
  "Contract source code verified (exact match)", verified at Nov 3, 2026 21:37:55, source visible
```

Low-balance guard (relayer stops sponsoring below 0.0003 ETH):

```text
mocked tests: 8/8 pass (boundary 0.0003 sponsors, 1 wei less pauses, fails closed on RPC error, top-up resumes)
fork test: written (web/relayer/sponsorship-guard.fork.test.ts), not yet run; run with
  bash web/relayer/run-fork-test.sh
live /health after VPS restart:
  {"enabled":true,"killSwitch":true,"sponsorshipPaused":true,"sponsorshipPausedReason":"low-balance",
   "relayerBalanceEth":"0.000082446419572223","minRelayerBalanceEth":"0.0003","dailyCap":3,"usage":0,
   "relayer":"0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4","quickNode":true,"signatureRelay":true}
Vercel project flatstock: Production Ready on 29d1c65, domain app.flatstock.ajkadri.dev
Vercel project web (stray): npm ci exits 1, no production deployment ever; not the live app
```

Close-round bot review (round 4, closesAt 1794232800 = 2026-11-09T14:00:00Z = Mon 9 Nov 15:00 WAT):

```text
VPS env before fix: VOTE_CONTRACT_ADDRESS=0x68d2622f3bbf6BE80CdfED679489de344410C7Db (retired)
                    CLOSE_ROUND_FALLBACK_ID=3, CLOSE_ROUND_ENABLED=0, timer disabled
result before fix: bot would NOT have closed round 4 on FlatstockVotes 0x4BB9...A968
fix 4072deb: prefers META_VOTES_ADDRESS, refuses a round whose closesAt differs from
  CLOSE_ROUND_EXPECTED_CLOSES_AT, read-only status when disabled, 8/8 logic tests pass
round 5: the bot only calls closeRound; openRound is onlyOwner, so it cannot open round 5
```

## 2026-11-05 Claude Code (local): low-balance guard fork test

No mainnet transaction was sent. Local anvil fork of chain 4663 (balances changed only inside the fork).

```text
bash web/relayer/run-fork-test.sh
forked relayer balance: 0.000082446419572223 ETH
0.0002 ETH -> paused=true reason=low-balance
0.0003 ETH -> paused=false
0.005 ETH -> paused=false
✔ guard follows the forked relayer balance
tests 1, pass 1, fail 0
```

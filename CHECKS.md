# M1 mainnet checks

Status: M1 complete. M2 complete with limits. M3 in progress. Round 3 is open.

Scope follows `PLAN-v3.md` section 3. `PLAN-v3.md` replaces the v2 plan. The
tipster-specific contract section in `AGENTS.md` is out of scope.

## Preconditions

- Date: 2026-10-30 Lagos time.
- Required execution window: 14:30 to 21:00 Lagos.
- Live basket receipt: `2026-10-30 14:50:44 WAT +0100`, inside the required window.
- Chain: Robinhood Chain mainnet, chain ID `4663`.
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`.
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
Flat Index
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

- `deploy/flat-index-relayer.service` for systemd on Ubuntu.
- `deploy/nginx.conf.template` for the user-selected subdomain.
- `deploy/flat-index.env.example` for a mode-600 VPS environment file.
- `deploy/README.md` for build, process, and TLS/DNS preparation.

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
- `src/FlatIndexVotes.sol`
- `test/M1RelayerDelegate.t.sol`
- `test/FlatIndexVotes.t.sol`
- `test/FlatIndexVotesFork.t.sol`

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
forge test --fork-url "$RPC_URL" --match-contract FlatIndexVotesForkTest -vv
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
forge create src/FlatIndexVotes.sol:FlatIndexVotes \
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
Ran 2 tests for FlatIndexVotesTest: 2 passed; 0 failed; 0 skipped
Ran 1 test for FlatIndexVotesForkTest: 1 passed; 0 failed; 0 skipped
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
FlatIndexLock       0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121
FlatIndexBuyRouter  0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA
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
forge create src/FlatIndexLock.sol:FlatIndexLock \
  --rpc-url "$RPC_URL" --private-key "$M1_RELAYER_PRIVATE_KEY" \
  --broadcast --json --constructor-args "$WIF_ADDRESS" 10000000000000000000
forge create src/FlatIndexBuyRouter.sol:FlatIndexBuyRouter \
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

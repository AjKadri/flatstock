# M1 mainnet checks

Status: M1 in progress. Mainnet deployment and Check 3 are complete; no user
Stock Token buy has been submitted.

Scope follows `PLAN-v3.md` section 3. `PLAN-v3.md` replaces the v2 plan. The
tipster-specific contract section in `AGENTS.md` is out of scope.

## Preconditions

- Date: 2026-10-30 Lagos time.
- Required execution window: 14:30 to 21:00 Lagos.
- Latest read-only preflight: `2026-10-30 09:36:05 WAT +0100`, before the window.
- Chain: Robinhood Chain mainnet, chain ID `4663`.
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`.
- `$WIF`: `0x5173b8eA6923c2d40267890D45C46a3480954773`, 18 decimals.
- `USDG`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals.
- User wallet: `0x3554121694a2472300f079Afa4B1fC7F9aAFac01`.
- Relayer wallet: `0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4`.
- The user wallet has 0 ETH, 1,000 WIF, and 2 USDG.
- The relayer wallet has `0.000344994444245313` native ETH.
- No key values were printed. Secrets remain in the ignored `.env` file.

The user approved the EIP-7702 delegate deployment and the tiny mainnet vote
round before submission. Other mainnet transactions still require approval.

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
| Optional WIF gas reimbursement path | pending | — | — | — | Same-tx WIF transfer only if tested |

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

Verdict: pending. Buy leg passed; sell-back still requires user approval.

The planned one-action basket uses one EIP-7702 relayed batch with three
USDG approvals and three direct-to-user Uniswap v3 swaps. The recipient for
each swap is the user wallet, never this repository's contract. The live
amount will be the smallest amount supported by the available USDG balance.

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
| Sell one Stock Token back | pending | — | — | — | — |

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

## Current blockers

1. The required market-hours window has not started for Check 2.
2. Each remaining mainnet transaction requires a fresh user approval immediately before submission.
3. The user wallet now has 8 USDG and 0 ETH. The planned live basket uses 5 USDG, leaving approximately 3 USDG unused.
4. EIP-7702 delegate and vote contract deployments are complete.
5. The product name, logo, subdomain, and licence remain unchosen.

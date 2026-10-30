# M1 mainnet checks

Status: pending. No mainnet transaction or wallet signature has been submitted.

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

The user has required that every mainnet transaction receive approval immediately
before submission. The market-hours window had not started at the latest
preflight, so all mainnet rows below remain pending.

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

Verdict: pending.

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
| Deploy relayer delegate | pending | — | — | — | Awaiting user approval and market window |
| Delegated user buy | pending | — | — | — | User ETH must remain 0; relayer pays |
| Optional WIF gas reimbursement path | pending | — | — | — | Same-tx WIF transfer only if tested |

Gas USD calculation will use the receipt's `gasUsed * effectiveGasPrice` and
the ETH/USD price observed at the receipt timestamp. The relayer sender and
user balance before each operation will be recorded.

## Check 2: one-action basket buy and sell

Verdict: pending.

The planned one-action basket uses one EIP-7702 relayed batch with three
USDG approvals and three direct-to-user Uniswap v3 swaps. The recipient for
each swap is the user wallet, never this repository's contract. The live
amount will be the smallest amount supported by the available USDG balance.

### Mainnet transactions

| Action | Verdict | Tx hash | Fill vs Chainlink | Gas cost in USD | Observed output |
|---|---|---|---:|---:|---|
| One-action basket buy | pending | — | — | — | Planned split: AAPL, NVDA, MSFT |
| Sell one Stock Token back | pending | — | — | — | — |

## Check 3: WIF vote count, burn, and close

Fork verdict: pass. Mainnet verdict: pending.

The fork implementation proves:

- vote cost is exactly 1 WIF;
- the 1 WIF is burned from total supply;
- a second vote by the same wallet in the same round reverts;
- weight basis points match vote counts;
- a vote after close reverts and cannot change weights.

### Mainnet transactions

| Action | Verdict | Tx hash / error | Gas cost in USD | Observed output |
|---|---|---|---:|---|
| Deploy vote contract | pending | — | — | Awaiting user approval and market window |
| Approve exactly 1 WIF | pending | — | — | — |
| Open tiny round | pending | — | — | — |
| Vote once | pending | — | — | Must burn exactly 1 WIF |
| Same-wallet second vote | pending | — | — | Must revert |
| Close round | pending | — | — | Weights become fixed |
| Post-close vote | pending | — | — | Must revert |

## Current blockers

1. The required market-hours window has not started.
2. Each mainnet transaction requires a fresh user approval immediately before submission.
3. The user wallet currently has 2 USDG, below the approximately 5 USDG basket target.
4. EIP-7702 delegate and vote contract deployment transactions are not yet submitted.
5. The product name, logo, subdomain, and licence remain unchosen.

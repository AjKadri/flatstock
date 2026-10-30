# M1 mainnet checks

Status: pending. No mainnet transaction has been submitted.

Scope follows `PLAN-v2.md` section 3. The tipster-specific contract section in `AGENTS.md` is out of scope.

## Preconditions

- Date: 2026-10-30 Lagos time.
- Required execution window: 14:30–21:00 Lagos.
- Initial local time observed: `2026-10-30 00:29:40 WAT +0100`, before the window.
- Chain: Robinhood Chain mainnet, chain ID `4663`.
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`.
- `$WIF`: `0x5173b8eA6923c2d40267890D45C46a3480954773`, 18 decimals.
- `USDG`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals.
- NVDA Stock Token: `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, 18 decimals.
- NVDA Chainlink feed: `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, 8 decimals.
- User signer, relayer signer, and 0x API key are present in the local environment. The EIP-7702 implementation is still undeployed. The user account has USDG and `$WIF`; the relayer account has native ETH for sponsorship.

## Read-only preflight

Exact command:

```sh
rpc='https://rpc.mainnet.chain.robinhood.com'
wif='0x5173b8eA6923c2d40267890D45C46a3480954773'
usdg='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
nvda='0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'
feed='0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15'
cast chain-id --rpc-url "$rpc"
cast block-number --rpc-url "$rpc"
cast call "$wif" 'symbol()(string)' --rpc-url "$rpc"
cast call "$wif" 'decimals()(uint8)' --rpc-url "$rpc"
cast call "$usdg" 'symbol()(string)' --rpc-url "$rpc"
cast call "$usdg" 'decimals()(uint8)' --rpc-url "$rpc"
cast call "$nvda" 'symbol()(string)' --rpc-url "$rpc"
cast call "$nvda" 'decimals()(uint8)' --rpc-url "$rpc"
cast call "$feed" 'decimals()(uint8)' --rpc-url "$rpc"
cast call "$feed" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$rpc"
```

Observed output at block `101282322`:

```text
4663
101282322
"WIF"
18
"USDG"
6
"NVDA"
18
8
18446744073709553000 [1.844e19]
20965499010 [2.096e10]
1793313624 [1.793e9]
1793313637 [1.793e9]
18446744073709553000 [1.844e19]
```

## ERC-4337 read-only preflight

Exact command:

```sh
rpc='https://rpc.mainnet.chain.robinhood.com'
ep06='0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
ep07='0x0000000071727De22E5E9d8BAf0edAc6f37da032'
cast rpc eth_supportedEntryPoints --rpc-url "$rpc"
cast codesize "$ep06" --rpc-url "$rpc"
cast codesize "$ep07" --rpc-url "$rpc"
```

Observed output:

```text
Error: server returned an error response: error code -32601: the method eth_supportedEntryPoints does not exist/is not available
23689
16035
```

The direct bytecode checks confirm deployed code at the canonical v0.6 and
v0.7 EntryPoint addresses. The RPC method failure is recorded rather than
treated as proof that the EntryPoints are absent.

## Account and route preflight

Credential presence was checked by variable name only. Private-key values were
not printed. The configured public addresses are:

```text
M1 user:    0x3554121694a2472300f079Afa4B1fC7F9aAFac01
M1 relayer: 0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4
```

Read-only balances observed before the market-hours window:

```text
user ETH:     0
relayer ETH:  344994444245313 wei
user WIF:     1000000000000000000000
user USDG:    2000000
```

The 0x read-only quote attempt for `1 USDG` returned:

```text
HTTP 422 BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE
message: The buy token is not authorized for trade due to legal restrictions
```

The route therefore falls back to Uniswap v3. Read-only on-chain checks found
the verified `SwapRouter02` at
`0xCaf681a66D020601342297493863E78C959E5cb2`, the v3 QuoterV2 at
`0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7`, and the USDG/NVDA 500-fee pool
at `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3`.

Exact read-only quote command:

```sh
set -a; source .env; set +a
quoter='0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7'
path="0x${USDG_ADDRESS#0x}0001f4${STOCK_TOKEN_ADDRESS#0x}"
cast call "$quoter" \
  'quoteExactInput(bytes,uint256)(uint256,uint160[],uint32[],uint256)' \
  "$path" 1000000 --rpc-url "$RPC_URL"
```

Observed output:

```text
amountOut: 4807329051161303
sqrtPriceAfter: 5494650763334067884325841220440472
initializedTicksCrossed: 1
gasEstimate: 109086
```

At the same read-only window, the Chainlink answer was `20854808058` with 8
decimals, or `$208.54808058` per NVDA. The quoted fill is approximately
`$208.0157`, or about `0.255%` below Chainlink before slippage. This is a
preflight quote, not an executed fill.

## Local relayer delegate checks

The own-relayer implementation is in `src/M1RelayerDelegate.sol`. It is not
deployed. Local checks only verify the delegation logic and the on-chain policy
counterexamples in a local EVM.

Exact commands:

```sh
forge fmt --check
forge test -vv
```

Observed output:

```text
Compiler run successful!
Ran 2 tests ...
[PASS] testRelayerExecuteUsesDelegatedUserAsTokenOwner()
[PASS] testWeeklyLimitAndRevocation()
Suite result: ok. 2 passed; 0 failed; 0 skipped
```

These local tests do not satisfy the M1 acceptance check. Mainnet deployment,
delegation, approve, swap, buy, revoke, and receipt evidence remain pending.

## Check 1: self-sponsored gas and `$WIF` gas

Verdict: pending.

Required evidence:

- Sponsorship option used, in the configured preference order.
- Smart-account address and zero ETH balance immediately before the first user operation.
- Approve transaction hash and receipt.
- Swap transaction hash and receipt.
- Relayer or paymaster evidence and measured gas cost per transaction in USD.
- `$WIF` gas transaction hash, or a documented fail with the exact provider response.
- Passkey result, or an explicit normal-wallet fallback label if passkeys required a paid service.

Transaction approvals: ask the user immediately before each mainnet transaction.

### Transactions

| Action | Verdict | Tx hash | Gas measured | Observed output |
|---|---|---|---:|---|
| Self-sponsored approve | pending | — | — | — |
| Self-sponsored swap | pending | — | — | — |
| `$WIF` gas path | pending | — | — | — |

## Check 2: Stock Token buy and sell

Verdict: pending.

Required evidence:

- Aggregator and route used.
- USDG amount and Stock Token amount.
- Smart account address and balance deltas.
- Chainlink answer and scaled price read in the same evidence window.
- Fill price, percentage difference from Chainlink, and sell-back result.

Transaction approvals: ask the user immediately before every buy, approval, and sell transaction.

### Transactions

| Action | Verdict | Tx hash | Fill vs Chainlink | Observed output |
|---|---|---|---:|---|
| USDG approval | pending | — | — | — |
| Buy | pending | — | — | — |
| Sell back to USDG | pending | — | — | — |

## Check 3: limited permission

Verdict: pending.

Required evidence:

- Permission or session configuration: approved router, chosen Stock Token, weekly limit, expiry, and revoke mechanism.
- One keeper buy within the limit succeeds.
- A second buy over the limit fails with the observed revert or provider error.
- A buy after revoke fails with the observed revert or provider error.

Transaction approvals: ask the user immediately before every permission grant, keeper buy, revoke, and other mainnet transaction.

### Transactions

| Action | Verdict | Tx hash / error | Observed output |
|---|---|---|---|
| Grant permission | pending | — | — |
| Keeper buy within limit | pending | — | — |
| Over-limit buy | pending | — | — |
| Revoke permission | pending | — | — |
| Post-revoke buy | pending | — | — |

## Current blockers

1. The required market-hours window has not started.
2. The EIP-7702 implementation still needs a mainnet deployment transaction.
3. No free ZeroDev or Pimlico mainnet configuration has been supplied. The own-relayer path is preferred.
4. 0x rejected the NVDA buy token for legal restrictions, so the configured Uniswap v3 fallback is required.
5. Secrets remain in environment variables and are not printed or committed.


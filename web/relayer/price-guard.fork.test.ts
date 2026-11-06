// Fork test against REAL Chainlink feeds, Stock Tokens and the Uniswap quoter on a local anvil fork.
//   bash relayer/run-fork-test.sh        (starts anvil, runs this and the other fork tests)
// Skipped unless FORK_RPC_URL (a local fork) is set. Nothing is sent to the real chain.
// The block time the guard sees is pinned to just after each feed's last update so the test is the same
// whether the market is open or not; staleness is covered separately by moving time 25h on.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, encodePacked, http, parseAbi, type Address } from "viem";
import { createPriceGuard, impliedOut, PriceGuardError, STOCK_FEEDS } from "./price-guard.ts";

const forkUrl = process.env.FORK_RPC_URL;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as Address;
const FEES: Record<string, number> = { AAPL: 500, NVDA: 500, MSFT: 3000 };
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);
const tokenAbi = parseAbi(["function decimals() view returns (uint8)"]);
const quoterAbi = parseAbi(["function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"]);
const below = (value: bigint, bps: bigint) => (value * (10_000n - bps)) / 10_000n;

test("real feeds: a good leg passes and a 3%-below leg is rejected (buy and sell)", { skip: !forkUrl }, async () => {
  assert.ok(forkUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(forkUrl), "FORK_RPC_URL must be a local anvil fork");
  const real = createPublicClient({ transport: http(forkUrl) });
  for (const symbol of ["AAPL", "NVDA", "MSFT"]) {
    const item = STOCK_FEEDS.find((f) => f.symbol === symbol)!;
    const latest = await real.readContract({ address: item.feed, abi: feedAbi, functionName: "latestRoundData" });
    const [feedDecimals, tokenDecimals] = await Promise.all([
      real.readContract({ address: item.feed, abi: feedAbi, functionName: "decimals" }),
      real.readContract({ address: item.token, abi: tokenAbi, functionName: "decimals" }),
    ]);
    const pinned = (offset: bigint) => ({
      getBlock: async () => ({ timestamp: latest[3] + offset }),
      readContract: real.readContract.bind(real),
    }) as never;
    const guard = createPriceGuard({ client: pinned(60n) });

    const buyIn = 10_000_000n; // 10 USDG
    const buyImplied = impliedOut("buy", buyIn, latest[1], feedDecimals, tokenDecimals);
    const sellIn = buyImplied; // sell the same amount of tokens back
    const sellImplied = impliedOut("sell", sellIn, latest[1], feedDecimals, tokenDecimals);

    // Units sanity: the real Uniswap quote is near the Chainlink-implied output (catches decimal mistakes).
    const quote = await real.simulateContract({
      address: QUOTER, abi: quoterAbi, functionName: "quoteExactInput",
      args: [encodePacked(["address", "uint24", "address"], [USDG, FEES[symbol], item.token]), buyIn],
    });
    const off = Number(quote.result[0] - buyImplied) / Number(buyImplied);
    console.log(`${symbol}: price ${Number(latest[1]) / 10 ** feedDecimals}, implied ${buyImplied}, quote ${quote.result[0]} (${(off * 100).toFixed(2)}% vs Chainlink)`);
    assert.ok(Math.abs(off) < 0.05, `${symbol}: implied output is far from the pool quote; check decimals`);

    await guard.assertBuyLegs([{ token: item.token, amountIn: buyIn, amountOutMinimum: below(buyImplied, 150n) }]); // good
    await assert.rejects(
      guard.assertBuyLegs([{ token: item.token, amountIn: buyIn, amountOutMinimum: below(buyImplied, 300n) }]), // 3% low
      (error: unknown) => error instanceof PriceGuardError && /more than 2% below the Chainlink price/.test(error.message),
    );
    await guard.assertSell(item.token, sellIn, below(sellImplied, 150n));
    await assert.rejects(guard.assertSell(item.token, sellIn, below(sellImplied, 300n)), /more than 2% below/);

    // A feed that has not updated for more than 24h refuses even a perfect leg.
    const stale = createPriceGuard({ client: pinned(25n * 3600n) });
    await assert.rejects(stale.assertBuyLegs([{ token: item.token, amountIn: buyIn, amountOutMinimum: buyImplied }]), /stale or unavailable/);
  }
});

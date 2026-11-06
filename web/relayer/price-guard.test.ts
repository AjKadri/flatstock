import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkMinimum, createPriceGuard, impliedOut, minimumAllowed, PriceGuardError, STOCK_FEEDS, assertOraclesHealthy } from "./price-guard.ts";

// NVDA-like: price $200.00 with 8 feed decimals, 18-decimal token, USDG has 6.
const base = { symbol: "NVDA", price: 200_00000000n, updatedAt: 1_000_000n, feedDecimals: 8, tokenDecimals: 18, now: 1_000_100n };
const buyIn = 100_000_000n; // 100 USDG
const buyImplied = impliedOut("buy", buyIn, base.price, 8, 18); // 0.5 token
const sellIn = 1_000_000_000_000_000_000n; // 1 token
const sellImplied = impliedOut("sell", sellIn, base.price, 8, 18); // 200 USDG
const below = (value: bigint, bps: bigint) => (value * (10_000n - bps)) / 10_000n;

test("implied output maths", () => {
  assert.equal(buyImplied, 500_000_000_000_000_000n);
  assert.equal(sellImplied, 200_000_000n);
});

test("buy: a good leg passes (at the 2% floor and above)", () => {
  for (const out of [buyImplied, below(buyImplied, 100n), minimumAllowed(buyImplied)]) {
    assert.doesNotThrow(() => checkMinimum({ ...base, side: "buy", amountIn: buyIn, amountOutMinimum: out }));
  }
});

test("buy: a leg 3% below Chainlink is rejected with a clear message", () => {
  assert.throws(
    () => checkMinimum({ ...base, side: "buy", amountIn: buyIn, amountOutMinimum: below(buyImplied, 300n) }),
    (error: unknown) => error instanceof PriceGuardError && /more than 2% below the Chainlink price/.test(error.message) && /NVDA/.test(error.message),
  );
  assert.throws(() => checkMinimum({ ...base, side: "buy", amountIn: buyIn, amountOutMinimum: below(buyImplied, 201n) }), PriceGuardError);
});

test("sell: good passes, 3% below is rejected", () => {
  assert.doesNotThrow(() => checkMinimum({ ...base, side: "sell", amountIn: sellIn, amountOutMinimum: below(sellImplied, 150n) }));
  assert.throws(
    () => checkMinimum({ ...base, side: "sell", amountIn: sellIn, amountOutMinimum: below(sellImplied, 300n) }),
    (error: unknown) => error instanceof PriceGuardError && /USDG/.test(error.message),
  );
});

test("fails closed on stale, future-dated, zero or negative prices", () => {
  const ok = { ...base, side: "buy" as const, amountIn: buyIn, amountOutMinimum: buyImplied };
  assert.throws(() => checkMinimum({ ...ok, now: base.updatedAt + 86_401n }), /stale or unavailable/);
  assert.throws(() => checkMinimum({ ...ok, updatedAt: base.now + 1n }), /stale or unavailable/);
  assert.throws(() => checkMinimum({ ...ok, updatedAt: 0n }), /stale or unavailable/);
  assert.throws(() => checkMinimum({ ...ok, price: 0n }), /stale or unavailable/);
  assert.throws(() => checkMinimum({ ...ok, price: -5n }), /stale or unavailable/);
  assert.doesNotThrow(() => checkMinimum({ ...ok, now: base.updatedAt + 86_400n }));
});

test("oracle health: paused, stale or missing feeds are refused", () => {
  const good = { feeds: [{ symbol: "NVDA", status: "OK", stale: false, oraclePaused: false, answer: "1" }] };
  assert.doesNotThrow(() => assertOraclesHealthy(good, ["NVDA"]));
  assert.doesNotThrow(() => assertOraclesHealthy({ feeds: [{ ...good.feeds[0], status: "MARKET_CLOSED" }] }, ["NVDA"]));
  assert.throws(() => assertOraclesHealthy({ feeds: [{ ...good.feeds[0], oraclePaused: true }] }, ["NVDA"]), /paused/);
  assert.throws(() => assertOraclesHealthy({ feeds: [{ ...good.feeds[0], stale: true }] }, ["NVDA"]), PriceGuardError);
  assert.throws(() => assertOraclesHealthy({ feeds: [{ ...good.feeds[0], status: "DEGRADED" }] }, ["NVDA"]), PriceGuardError);
  assert.throws(() => assertOraclesHealthy({ feeds: [] }, ["NVDA"]), PriceGuardError);
});

function fakeClient(answer: bigint, updatedAt: bigint, now: bigint, fail = false) {
  return {
    getBlock: async () => ({ timestamp: now }),
    readContract: async ({ functionName, address }: { functionName: string; address: string }) => {
      if (fail) throw new Error("rpc down");
      if (functionName === "latestRoundData") return [1n, answer, 0n, updatedAt, 1n];
      if (functionName === "decimals") return STOCK_FEEDS.some((f) => f.feed.toLowerCase() === address.toLowerCase()) ? 8 : 18;
      throw new Error("unexpected " + functionName);
    },
  } as never;
}
const NVDA = STOCK_FEEDS[1].token;

test("guard: unknown token has no feed and is refused (closes the open buy-leg allow-list gap)", async () => {
  const guard = createPriceGuard({ client: fakeClient(base.price, base.updatedAt, base.now) });
  await assert.rejects(guard.assertBuyLegs([{ token: "0x0000000000000000000000000000000000000001", amountIn: buyIn, amountOutMinimum: 1n }]), /no Chainlink price feed/);
});

test("guard: unreadable feed and missing health service fail closed", async () => {
  const down = createPriceGuard({ client: fakeClient(base.price, base.updatedAt, base.now, true) });
  await assert.rejects(down.assertSell(NVDA, sellIn, sellImplied), /could not be read/);
  const noHealth = createPriceGuard({ client: fakeClient(base.price, base.updatedAt, base.now), getOracleHealth: async () => { throw new PriceGuardError("health unavailable"); } });
  await assert.rejects(noHealth.assertSell(NVDA, sellIn, sellImplied), /health unavailable/);
});

test("guard: multi-leg buy rejects if any one leg is 3% low", async () => {
  const guard = createPriceGuard({ client: fakeClient(base.price, base.updatedAt, base.now) });
  const good = { token: NVDA, amountIn: buyIn, amountOutMinimum: below(buyImplied, 150n) };
  await guard.assertBuyLegs([good, good]);
  await assert.rejects(guard.assertBuyLegs([good, { ...good, amountOutMinimum: below(buyImplied, 300n) }]), /more than 2% below/);
});

test("relayer feed table matches web/src/config.ts", () => {
  const config = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
  for (const item of STOCK_FEEDS) {
    const block = config.slice(config.indexOf(`symbol: "${item.symbol}"`));
    assert.ok(block.includes(`token: "${item.token}"`) && block.indexOf(`token: "${item.token}"`) < 200, `${item.symbol} token`);
    assert.ok(block.includes(`feed: "${item.feed}"`) && block.indexOf(`feed: "${item.feed}"`) < 300, `${item.symbol} feed`);
  }
});

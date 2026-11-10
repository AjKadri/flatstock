import test from "node:test";
import assert from "node:assert/strict";
import { parseUnits } from "viem";
import { sellAmountFromPercent } from "./sell-amount.ts";

const ONE = 10n ** 18n;

test("percentages of a whole-share balance", () => {
  assert.equal(sellAmountFromPercent(4n * ONE, 25), "1");
  assert.equal(sellAmountFromPercent(4n * ONE, 50), "2");
  assert.equal(sellAmountFromPercent(4n * ONE, 75), "3");
  assert.equal(sellAmountFromPercent(4n * ONE, 100), "4");
});

test("18-decimal balance with many digits: exact, no float rounding", () => {
  const balance = 1234567890123456789n; // 1.234567890123456789
  assert.equal(sellAmountFromPercent(balance, 100), "1.234567890123456789");
  assert.equal(sellAmountFromPercent(balance, 50), "0.617283945061728394"); // 617283945061728394.5 rounds down
  assert.equal(sellAmountFromPercent(balance, 25), "0.308641972530864197"); // 308641972530864197.25 -> down
  assert.equal(sellAmountFromPercent(balance, 75), "0.925925917592592591"); // 925925917592592591.75 -> down, never up
});

test("a percentage never exceeds the balance or the exact percentage", () => {
  for (const balance of [1n, 3n, 7n, 99n, 101n, ONE - 1n, ONE + 1n, 123456789012345678901n]) {
    for (const p of [25, 50, 75, 100] as const) {
      const text = sellAmountFromPercent(balance, p);
      if (text === "") continue;
      const amount = parseUnits(text, 18);
      assert.ok(amount <= balance, `${p}% of ${balance}`);
      assert.ok(amount * 100n <= balance * BigInt(p), `${p}% of ${balance} not rounded up`);
      assert.ok((amount + 1n) * 100n > balance * BigInt(p), `${p}% of ${balance} is the largest unit not above the percentage`);
    }
  }
});

test("Max is exactly the balance, round-tripping through parseUnits", () => {
  for (const balance of [1n, 5n, ONE, ONE + 1n, 987654321098765432109n, 2n ** 100n]) {
    assert.equal(parseUnits(sellAmountFromPercent(balance, 100), 18), balance);
  }
});

test("dust: a balance of 3 wei is sold by Max, but 25% of it is zero so the input stays empty", () => {
  assert.equal(sellAmountFromPercent(3n, 100), "0.000000000000000003");
  assert.equal(sellAmountFromPercent(3n, 25), "");
  assert.equal(sellAmountFromPercent(3n, 50), "0.000000000000000001");
  assert.equal(sellAmountFromPercent(3n, 75), "0.000000000000000002");
  assert.equal(sellAmountFromPercent(1n, 50), "");
});

test("zero or negative balance gives an empty amount", () => {
  assert.equal(sellAmountFromPercent(0n, 100), "");
  assert.equal(sellAmountFromPercent(0n, 25), "");
  assert.equal(sellAmountFromPercent(-5n, 100), "");
});

test("the text never uses exponent notation and has no trailing zeros", () => {
  assert.equal(sellAmountFromPercent(10n ** 12n, 100), "0.000001");
  assert.equal(sellAmountFromPercent(25n * 10n ** 17n, 100), "2.5");
});

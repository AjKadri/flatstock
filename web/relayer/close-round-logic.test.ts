import test from "node:test";
import assert from "node:assert/strict";
import { decideClose } from "./close-round-logic.ts";

const ROUND_4_CLOSES_AT = 1794232800n;
const base = { assetCount: 3, closed: false, closesAt: ROUND_4_CLOSES_AT, expectedClosesAt: ROUND_4_CLOSES_AT };

test("1794232800 is Mon 9 Nov 2026 15:00 WAT (14:00 UTC)", () => {
  assert.equal(new Date(Number(ROUND_4_CLOSES_AT) * 1000).toISOString(), "2026-11-09T14:00:00.000Z");
});

test("not due one second before closesAt", () => {
  assert.equal(decideClose({ ...base, latestTimestamp: ROUND_4_CLOSES_AT - 1n }), "not-due");
});

test("due exactly at closesAt, matching the contract rule block.timestamp >= closesAt", () => {
  assert.equal(decideClose({ ...base, latestTimestamp: ROUND_4_CLOSES_AT }), "due");
  assert.equal(decideClose({ ...base, latestTimestamp: ROUND_4_CLOSES_AT + 300n }), "due");
});

test("refuses a round whose closesAt differs from the approved one", () => {
  assert.equal(decideClose({ ...base, closesAt: ROUND_4_CLOSES_AT + 7n * 86400n, latestTimestamp: ROUND_4_CLOSES_AT + 8n * 86400n }), "expected-mismatch");
});

test("an already closed round is left alone", () => {
  assert.equal(decideClose({ ...base, closed: true, latestTimestamp: ROUND_4_CLOSES_AT + 10n }), "already-closed");
});

test("a missing round is reported, not closed", () => {
  assert.equal(decideClose({ ...base, assetCount: 0, latestTimestamp: ROUND_4_CLOSES_AT + 10n }), "missing");
});

test("without an expected time it still closes only when due", () => {
  assert.equal(decideClose({ assetCount: 3, closed: false, closesAt: ROUND_4_CLOSES_AT, latestTimestamp: ROUND_4_CLOSES_AT - 5n }), "not-due");
});

test("the bot source can only call closeRound: no openRound or other writes", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./close-round.ts", import.meta.url), "utf8");
  assert.ok(!/openRound/.test(source));
  assert.equal((source.match(/functionName:\s*"/g) || []).filter((m) => m).length, 3); // latestRoundId, rounds, closeRound
  assert.equal((source.match(/writeContract\(/g) || []).length, 1);
  assert.ok(/functionName:\s*"closeRound"/.test(source));
});

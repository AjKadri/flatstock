import test from "node:test";
import assert from "node:assert/strict";
import { MAX_AHEAD_SECONDS, WEEK_SECONDS, decideAuto, decideClose, isMonday1400Utc, nextClosesAt, sanityCheckNewRound } from "./close-round-logic.ts";

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

const R5 = 1794837600n; // Mon 16 Nov 2026 14:00 UTC
const R6 = 1795442400n;
const round = (over: Partial<{ assetCount: number; closed: boolean; closesAt: bigint }> = {}) => ({ assetCount: 8, closed: false, closesAt: R5, ...over });

test("auto: open round before closesAt is not-due", () => {
  assert.equal(decideAuto({ round: round(), nextExists: false, latestTimestamp: R5 - 1n }), "not-due");
});

test("auto: open round at or after closesAt is closed", () => {
  assert.equal(decideAuto({ round: round(), nextExists: false, latestTimestamp: R5 }), "close");
  assert.equal(decideAuto({ round: round(), nextExists: false, latestTimestamp: R5 + 3n * 86400n }), "close");
});

test("auto: closed round with no next round opens it", () => {
  assert.equal(decideAuto({ round: round({ closed: true }), nextExists: false, latestTimestamp: R5 + 10n }), "open");
});

test("auto: closed round whose next exists is nothing-to-do (a second run sends nothing)", () => {
  assert.equal(decideAuto({ round: round({ closed: true }), nextExists: true, latestTimestamp: R5 + 10n }), "nothing-to-do");
});

test("auto: a missing round is reported, never acted on", () => {
  assert.equal(decideAuto({ round: round({ assetCount: 0 }), nextExists: false, latestTimestamp: R5 + 10n }), "missing");
});

test("next closesAt is previous + 7 days (round 5 -> round 6 = 1795442400)", () => {
  assert.equal(nextClosesAt(R5, R5 + 10n), R6);
  assert.equal(R6 - R5, WEEK_SECONDS);
});

test("next closesAt adds whole weeks while it would be in the past", () => {
  assert.equal(nextClosesAt(R5, R6 + 5n), R6 + WEEK_SECONDS);
  assert.equal(nextClosesAt(R5, R6), R6 + WEEK_SECONDS); // exactly now is not in the future
  assert.equal(nextClosesAt(R5, R5 + 3n * WEEK_SECONDS + 1n), R5 + 4n * WEEK_SECONDS);
});

test("Monday 14:00:00 UTC check", () => {
  assert.ok(isMonday1400Utc(R5));
  assert.ok(isMonday1400Utc(R6));
  assert.ok(!isMonday1400Utc(R5 + 1n));
  assert.ok(!isMonday1400Utc(R5 + 3600n));
  assert.ok(!isMonday1400Utc(R5 + 86400n)); // Tuesday
});

const sane = { assetCount: 8, closesAt: R6, voteShareBps: 5000, latestTimestamp: R5 + 10n };

test("sanity: the round 6 proposal passes", () => {
  assert.equal(sanityCheckNewRound(sane), null);
});

test("sanity: refuses asset counts outside 2..8", () => {
  assert.match(sanityCheckNewRound({ ...sane, assetCount: 1 })!, /assetCount/);
  assert.match(sanityCheckNewRound({ ...sane, assetCount: 9 })!, /assetCount/);
  assert.equal(sanityCheckNewRound({ ...sane, assetCount: 2 }), null);
});

test("sanity: refuses closesAt that is not a Monday 14:00:00 UTC", () => {
  assert.match(sanityCheckNewRound({ ...sane, closesAt: R6 + 60n })!, /Monday/);
});

test("sanity: refuses closesAt in the past or not in the future", () => {
  assert.match(sanityCheckNewRound({ ...sane, latestTimestamp: R6 })!, /future/);
  assert.match(sanityCheckNewRound({ ...sane, latestTimestamp: R6 + 5n })!, /future/);
});

test("sanity: refuses closesAt more than 8 days ahead", () => {
  const now = R6 - MAX_AHEAD_SECONDS - 1n;
  assert.match(sanityCheckNewRound({ ...sane, latestTimestamp: now })!, /8 days/);
  assert.equal(sanityCheckNewRound({ ...sane, latestTimestamp: R6 - MAX_AHEAD_SECONDS }), null);
});

test("sanity: refuses voteShareBps above 10000", () => {
  assert.match(sanityCheckNewRound({ ...sane, voteShareBps: 10001 })!, /voteShareBps/);
  assert.equal(sanityCheckNewRound({ ...sane, voteShareBps: 10000 }), null);
  assert.equal(sanityCheckNewRound({ ...sane, voteShareBps: 0 }), null);
});

test("the bot source can only write closeRound and openRound, through one guarded path", async () => {
  const { readFileSync } = await import("node:fs");
  const bot = readFileSync(new URL("./close-round-bot.ts", import.meta.url), "utf8");
  const entry = readFileSync(new URL("./close-round.ts", import.meta.url), "utf8");
  assert.equal((bot.match(/writeContract\(/g) || []).length, 1);
  assert.ok(/ALLOWED_WRITES = new Set\(\["closeRound", "openRound"\]\)/.test(bot));
  assert.ok(!/writeContract|sendTransaction|sendRawTransaction/.test(entry));
  // every simulate/send call goes through simulateAndSend, which is typed to the two functions
  assert.ok(/functionName: "closeRound" \| "openRound"/.test(bot));
  assert.equal((bot.match(/simulateAndSend\("/g) || []).length, 2);
});

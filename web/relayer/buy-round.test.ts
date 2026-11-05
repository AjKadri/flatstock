import assert from "node:assert/strict";
import test from "node:test";
import { renormaliseWeights, selectBuyMix } from "../src/lib/rounds-logic.ts";

const round = (roundId: bigint, closed: boolean, totalVotes: bigint, weights: bigint[]) => ({
  roundId, opensAt: 0n, closesAt: 0n, assetCount: 3, totalVotes, closed, isOpen: !closed, weights,
});
const lookup = (rounds: ReturnType<typeof round>[]) => async (id: bigint) => rounds.find((r) => r.roundId === id) ?? null;

test("before any round closes: open round with votes is a labelled preview", async () => {
  const r4 = round(4n, false, 1n, [5000n, 2500n, 2500n]);
  const pick = await selectBuyMix(r4, lookup([r4]), 4n);
  assert.equal(pick?.kind, "preview");
  assert.equal(pick?.round.roundId, 4n);
});

test("before any round closes and no votes: nothing to buy", async () => {
  const r4 = round(4n, false, 0n, [3334n, 3333n, 3333n]);
  assert.equal(await selectBuyMix(r4, lookup([r4]), 4n), null);
});

test("round 4 closed + round 5 open: buys use round 4's final weights, not round 5", async () => {
  const r4 = round(4n, true, 7n, [4000n, 3000n, 3000n]);
  const r5 = round(5n, false, 2n, [2000n, 2000n, 6000n]);
  const pick = await selectBuyMix(r5, lookup([r4, r5]), 4n);
  assert.equal(pick?.kind, "final");
  assert.equal(pick?.round.roundId, 4n);
  assert.deepEqual(pick?.round.weights, [4000n, 3000n, 3000n]);
});

test("closed latest round with no next round open: buys use it", async () => {
  const r4 = round(4n, true, 7n, [4000n, 3000n, 3000n]);
  const pick = await selectBuyMix(r4, lookup([r4]), 4n);
  assert.equal(pick?.round.roundId, 4n);
  assert.equal(pick?.kind, "final");
});

test("round 6 open, 5 unreadable, 4 closed: falls back to the most recent closed round", async () => {
  const r4 = round(4n, true, 7n, [4000n, 3000n, 3000n]);
  const r6 = round(6n, false, 1n, [3334n, 3333n, 3333n]);
  const pick = await selectBuyMix(r6, lookup([r4, r6]), 4n);
  assert.equal(pick?.round.roundId, 4n);
});

test("never reads rounds below the current contract's first round", async () => {
  const seen: bigint[] = [];
  const r5 = round(5n, false, 0n, [3334n, 3333n, 3333n]);
  await selectBuyMix(r5, async (id) => { seen.push(id); return null; }, 4n);
  assert.deepEqual(seen, [4n]);
});

test("adjust: kept stocks keep their relative weights and sum to 100%", () => {
  const community = [5000n, 2500n, 2500n, 0n];
  const out = renormaliseWeights(community, [0, 1]);
  assert.equal(out.reduce((a, b) => a + b, 0n), 10_000n);
  assert.deepEqual(out, [6667n, 3333n, 0n, 0n]); // 2:1 ratio kept
  assert.equal(out[2], 0n);
});

test("adjust: all stocks kept returns the community mix", () => {
  const community = [1625n, 2125n, 625n, 625n, 625n, 625n, 2625n, 1125n];
  assert.deepEqual(renormaliseWeights(community, [0, 1, 2, 3, 4, 5, 6, 7]), community);
});

test("adjust: remainder goes to the largest stock so the total is exactly 100%", () => {
  const community = [3334n, 3333n, 3333n];
  for (const keep of [[0, 1], [1, 2], [0, 2], [0, 1, 2]]) {
    assert.equal(renormaliseWeights(community, keep).reduce((a, b) => a + b, 0n), 10_000n);
  }
});

test("adjust: stocks with zero community weight are ignored", () => {
  assert.deepEqual(renormaliseWeights([0n, 5000n, 5000n], [0, 1, 2]), [0n, 5000n, 5000n]);
});

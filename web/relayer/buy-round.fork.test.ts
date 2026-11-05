// Fork test: buys must use the closed round's final weights while voting continues on the next round.
// Runs only against a LOCAL anvil fork (FORK_RPC_URL), impersonating the owner inside the fork.
// Nothing is sent to the real chain.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, parseEther, type Address } from "viem";
import { selectBuyMix } from "../src/lib/rounds-logic.ts";

const forkUrl = process.env.FORK_RPC_URL;
const VOTES = (process.env.VOTES_ADDRESS || "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968") as Address;
const abi = parseAbi([
  "function owner() view returns (address)",
  "function rounds(uint256) view returns (uint64 opensAt, uint64 closesAt, uint8 assetCount, uint256 totalVotes, bool closed)",
  "function weightBps(uint256 roundId, uint8 assetIndex) view returns (uint256)",
  "function closeRound(uint256 roundId)",
  "function openRound(uint256 roundId, uint8 assetCount, uint64 closesAt)",
  "function latestRoundId() view returns (uint256)",
]);

test("buys use round 4's final weights after round 5 opens", { skip: !forkUrl }, async () => {
  assert.ok(forkUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(forkUrl), "FORK_RPC_URL must be a local anvil fork");
  const pub = createPublicClient({ transport: http(forkUrl) });
  const test_ = createTestClient({ mode: "anvil", transport: http(forkUrl) });
  const owner = await pub.readContract({ address: VOTES, abi, functionName: "owner" });
  await test_.setBalance({ address: owner, value: parseEther("1") });
  await test_.impersonateAccount({ address: owner });
  const wallet = createWalletClient({ account: owner, transport: http(forkUrl) });

  const read = async (id: bigint) => {
    const [opensAt, closesAt, assetCount, totalVotes, closed] = await pub.readContract({ address: VOTES, abi, functionName: "rounds", args: [id] });
    if (assetCount === 0) return null;
    const weights = await Promise.all(Array.from({ length: 3 }, (_, i) => pub.readContract({ address: VOTES, abi, functionName: "weightBps", args: [id, i] })));
    return { roundId: id, opensAt, closesAt, assetCount, totalVotes, closed, isOpen: !closed, weights };
  };

  // Before the close: round 4 open, 1 vote -> labelled preview only.
  const before = await read(4n);
  assert.ok(before && !before.closed);
  const preview = await selectBuyMix(before, read, 4n);
  console.log(`before close: kind=${preview?.kind} round=${preview?.round.roundId} weights=${preview?.round.weights}`);
  assert.equal(preview?.kind, "preview");

  // Close round 4 (after its closesAt) and open round 5 back to back, inside the fork.
  await test_.setNextBlockTimestamp({ timestamp: before.closesAt + 1n });
  await test_.mine({ blocks: 1 });
  await wallet.writeContract({ address: VOTES, abi, functionName: "closeRound", args: [4n], chain: null });
  const now = (await pub.getBlock()).timestamp;
  await wallet.writeContract({ address: VOTES, abi, functionName: "openRound", args: [5n, 3, now + 7n * 86400n], chain: null });
  await test_.mine({ blocks: 1 });

  const latest = await read(5n);
  assert.ok(latest && !latest.closed, "round 5 is open");
  const finalFour = await read(4n);
  assert.ok(finalFour?.closed, "round 4 is closed");
  const pick = await selectBuyMix(latest, read, 4n);
  console.log(`after close+open: kind=${pick?.kind} round=${pick?.round.roundId} weights=${pick?.round.weights} (round 5 live: ${latest.weights})`);
  assert.equal(pick?.kind, "final");
  assert.equal(pick?.round.roundId, 4n);
  assert.deepEqual(pick?.round.weights, finalFour.weights);
  const total = 10_000_000n; // 10 USDG
  const split = pick.round.weights.map((w) => (total * w) / 10_000n);
  console.log(`10 USDG split by round 4 final weights: ${split.map(String)}`);
  assert.equal(split.reduce((a, b) => a + b, 0n) <= total, true);
});

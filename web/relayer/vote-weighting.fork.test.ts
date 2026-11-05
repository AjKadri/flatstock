// Fork test: what an 8-stock round's final mix looks like at 50% vs 75% vote share, with 0, 1 and 10 votes.
// Uses the REAL FlatstockVotes contract on a LOCAL anvil fork (owner impersonated, new rounds 5-12, voters funded
// inside the fork). Prints the table and checks it against the app's JavaScript mix formula.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const forkUrl = process.env.FORK_RPC_URL;
const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968" as Address;
const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773" as Address;
const WHALE = "0x3554121694a2472300f079Afa4B1fC7F9aAFac01" as Address;
const SYMBOLS = ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "SPY"];
const abi = parseAbi([
  "function owner() view returns (address)",
  "function openRound(uint256 roundId, uint8 assetCount, uint64 closesAt, uint16 voteShareBps)",
  "function closeRound(uint256 roundId)", "function vote(uint256 roundId, uint8 assetIndex)",
  "function weightBps(uint256 roundId, uint8 assetIndex) view returns (uint256)",
]);
const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)"]);

// Same rule as web/src/lib/chain.ts calculateMixWeights, with the vote share as a parameter.
function mix(votes: bigint[], n: number, shareBps: bigint): bigint[] {
  const total = votes.reduce((a, b) => a + b, 0n);
  const base = 10000n / BigInt(n), rem = 10000n % BigInt(n);
  const eq = (i: number) => base + (BigInt(i) < rem ? 1n : 0n);
  if (total === 0n) return Array.from({ length: n }, (_, i) => eq(i));
  const w: bigint[] = []; let vs = 0n, ws = 0n;
  for (let i = 0; i < n; i++) {
    const vw = i === n - 1 ? 10000n - vs : (votes[i] * 10000n) / total;
    if (i !== n - 1) vs += vw;
    w[i] = (eq(i) * (10000n - shareBps) + vw * shareBps) / 10000n; ws += w[i];
  }
  if (ws < 10000n) w[n - 1] += 10000n - ws;
  const capped = w.map(() => false); let excess = 0n;
  for (let i = 0; i < n; i++) if (w[i] > 5000n) { excess += w[i] - 5000n; w[i] = 5000n; capped[i] = true; }
  while (excess > 0n) {
    const idx = w.map((x, i) => (!capped[i] && x < 5000n ? i : -1)).filter((i) => i >= 0);
    const add = excess / BigInt(idx.length), r = excess % BigInt(idx.length); let next = 0n;
    idx.forEach((i, k) => { const a = add + (BigInt(k) < r ? 1n : 0n), cap = 5000n - w[i]; if (a > cap) { w[i] = 5000n; capped[i] = true; next += a - cap; } else w[i] += a; });
    excess = next;
  }
  return w;
}

const SCENARIOS: { name: string; votes: number[] }[] = [
  { name: "0 votes", votes: [0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "1 vote (TSLA)", votes: [0, 0, 0, 0, 0, 0, 1, 0] },
  { name: "10 votes, all TSLA", votes: [0, 0, 0, 0, 0, 0, 10, 0] },
  { name: "10 votes spread (TSLA 4, NVDA 3, AAPL 2, SPY 1)", votes: [2, 3, 0, 0, 0, 0, 4, 1] },
];

test("final mixes at 50% and 75% vote share match the contract", { skip: !forkUrl }, async () => {
  assert.ok(forkUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(forkUrl), "FORK_RPC_URL must be a local anvil fork");
  const pub = createPublicClient({ transport: http(forkUrl) });
  const anvil = createTestClient({ mode: "anvil", transport: http(forkUrl) });
  const wallet = createWalletClient({ transport: http(forkUrl) });
  const send = async (from: Address, to: Address, data: Hex) => {
    const hash = await wallet.sendTransaction({ account: from, to, data, chain: null });
    const r = await pub.waitForTransactionReceipt({ hash }); assert.equal(r.status, "success"); return r;
  };
  const owner = await pub.readContract({ address: VOTES, abi, functionName: "owner" });
  for (const a of [owner, WHALE]) { await anvil.setBalance({ address: a, value: parseEther("10") }); await anvil.impersonateAccount({ address: a }); }
  const voters = Array.from({ length: 10 }, () => privateKeyToAccount(generatePrivateKey()).address);
  for (const v of voters) {
    await anvil.setBalance({ address: v, value: parseEther("1") }); await anvil.impersonateAccount({ address: v });
    await send(WHALE, WIF, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [v, parseEther("20")] }));
    await send(v, WIF, encodeFunctionData({ abi: erc20, functionName: "approve", args: [VOTES, parseEther("20")] }));
  }
  const now = (await pub.getBlock()).timestamp;
  const closesAt = now + 3600n;
  let id = 5n;
  const plan: { id: bigint; share: number; scenario: (typeof SCENARIOS)[number] }[] = [];
  for (const share of [5000, 7500]) for (const scenario of SCENARIOS) {
    await send(owner, VOTES, encodeFunctionData({ abi, functionName: "openRound", args: [id, 8, closesAt, share] }));
    let voter = 0;
    for (let asset = 0; asset < 8; asset++) for (let k = 0; k < scenario.votes[asset]; k++) {
      await send(voters[voter++], VOTES, encodeFunctionData({ abi, functionName: "vote", args: [id, asset] }));
    }
    plan.push({ id, share, scenario }); id += 1n;
  }
  await anvil.setNextBlockTimestamp({ timestamp: closesAt + 1n }); await anvil.mine({ blocks: 1 });
  const lines = [`| Scenario | Vote share | ${SYMBOLS.join(" | ")} |`, `|---|---|${SYMBOLS.map(() => "---").join("|")}|`];
  for (const { id: rid, share, scenario } of plan) {
    await send(owner, VOTES, encodeFunctionData({ abi, functionName: "closeRound", args: [rid] }));
    const onchain = await Promise.all(SYMBOLS.map((_, i) => pub.readContract({ address: VOTES, abi, functionName: "weightBps", args: [rid, i] })));
    const js = mix(scenario.votes.map(BigInt), 8, BigInt(share));
    assert.deepEqual(js, onchain, `${scenario.name} @ ${share}: app formula equals contract`);
    assert.equal(onchain.reduce((a, b) => a + b, 0n), 10000n);
    lines.push(`| ${scenario.name} | ${share / 100}% | ${onchain.map((w) => (Number(w) / 100).toFixed(2) + "%").join(" | ")} |`);
  }
  console.log(lines.join("\n"));
});

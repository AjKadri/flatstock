// Fork test for the round bot, on a LOCAL anvil fork of Robinhood Chain (4663). Nothing is sent to the real chain.
// The owner and a stranger are impersonated inside the fork; time is warped past round 5's closesAt (1794837600).
//   bash web/relayer/run-fork-test.sh
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, type Address } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { runBot, votesAbi } from "./close-round-bot.ts";

const forkUrl = process.env.FORK_RPC_URL;
const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968" as Address;
const R5 = 1794837600n;
const R6 = 1795442400n;

test("round bot on a fork: close, open, idempotence, guards", { skip: !forkUrl }, async () => {
  assert.ok(forkUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(forkUrl), "FORK_RPC_URL must be a local anvil fork");
  const pub = createPublicClient({ transport: http(forkUrl) });
  const anvil = createTestClient({ mode: "anvil", transport: http(forkUrl) });
  const wallet = createWalletClient({ transport: http(forkUrl) });
  const read = <T,>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address: VOTES, abi: votesAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const owner = await read<Address>("owner");
  const stranger = privateKeyToAddress(generatePrivateKey());
  for (const a of [owner, stranger]) {
    await anvil.setBalance({ address: a, value: parseEther("1") });
    await anvil.impersonateAccount({ address: a });
  }
  const run = async (opts: { signer?: Address; enabled?: boolean; autoOpen?: boolean; pins?: boolean }) => {
    const logs: Record<string, unknown>[] = [];
    await runBot({
      publicClient: pub, walletClient: wallet, account: opts.signer ?? owner, log: (l) => logs.push(l),
      config: {
        contract: VOTES, enabled: opts.enabled ?? true, autoOpen: opts.autoOpen ?? true,
        pinsPresent: { voteRoundId: Boolean(opts.pins), expectedClosesAt: Boolean(opts.pins) },
      },
    });
    return logs;
  };
  const actions = (logs: Record<string, unknown>[]) => logs.map((l) => l.action);
  const round = async (id: bigint) => {
    const [opensAt, closesAt, assetCount, totalVotes, closed] = await read<readonly [bigint, bigint, number, bigint, boolean]>("rounds", [id]);
    return { opensAt, closesAt, assetCount, totalVotes, closed };
  };
  const nonce = (a: Address) => pub.getTransactionCount({ address: a, blockTag: "latest" });

  // Real chain state today: round 5 open, closes 1794837600.
  assert.equal(await read<bigint>("latestRoundId"), 5n);
  assert.equal((await round(5n)).closesAt, R5);

  // a run before closesAt gives not-due and sends nothing
  const n0 = await nonce(owner);
  const early = await run({});
  console.log("before closesAt:", JSON.stringify(early));
  assert.deepEqual(actions(early), ["not-due"]);
  assert.equal(await nonce(owner), n0);
  assert.equal((await round(5n)).closed, false);

  // status only (both flags off) prints and sends nothing, even once due
  await anvil.setNextBlockTimestamp({ timestamp: R5 + 10n });
  await anvil.mine({ blocks: 1 });
  const statusOnly = await run({ enabled: false, autoOpen: true });
  console.log("status only:", JSON.stringify(statusOnly));
  assert.deepEqual(actions(statusOnly), ["none"]);
  assert.equal(await nonce(owner), n0);

  // anvil forgets a snapshot once it is reverted, so take a fresh one after every revert
  let snap = await anvil.snapshot();
  const reset = async () => {
    await anvil.revert({ id: snap });
    assert.equal((await round(5n)).closed, false, "snapshot revert restored round 5 as open");
    assert.equal((await round(6n)).assetCount, 0, "snapshot revert removed round 6");
    snap = await anvil.snapshot();
  };

  // close-only (CLOSE_ROUND_ENABLED=1, AUTO_OPEN_ENABLED=0): closes round 5, never opens round 6
  const closeOnly = await run({ autoOpen: false });
  console.log("close only:", JSON.stringify(closeOnly));
  assert.deepEqual(actions(closeOnly), ["closed"]);
  assert.equal((await round(5n)).closed, true);
  assert.equal((await round(6n)).assetCount, 0);
  await reset();

  // a non-owner signer closes but does not open
  const sNonce = await nonce(stranger);
  const nonOwner = await run({ signer: stranger });
  console.log("non-owner:", JSON.stringify(nonOwner));
  assert.deepEqual(actions(nonOwner), ["closed", "not-owner"]);
  assert.equal((await round(5n)).closed, true);
  assert.equal((await round(6n)).assetCount, 0);
  assert.equal(await nonce(stranger), sNonce + 1);
  await reset();

  // below 0.00005 ETH: nothing is sent
  await anvil.setBalance({ address: owner, value: parseEther("0.00004") });
  const nLow = await nonce(owner);
  const low = await run({});
  console.log("low balance:", JSON.stringify(low));
  assert.deepEqual(actions(low), ["low-balance"]);
  assert.equal(await nonce(owner), nLow);
  await anvil.setBalance({ address: owner, value: parseEther("1") });

  // a pending transaction from the signer: do nothing this run
  await anvil.setAutomine(false);
  await wallet.sendTransaction({ account: owner, to: stranger, value: 1n, chain: null });
  const pend = await run({});
  console.log("pending tx:", JSON.stringify(pend));
  assert.deepEqual(actions(pend), ["pending-tx"]);
  await anvil.setAutomine(true);
  await anvil.mine({ blocks: 1 });
  await reset();

  // run 1: closes round 5 and opens round 6 (8 assets, closesAt 1795442400, voteShareBps 5000); old pins are ignored and logged
  const run1 = await run({ pins: true });
  console.log("run 1:", JSON.stringify(run1));
  assert.deepEqual(actions(run1), ["pins-ignored", "closed", "opened"]);
  assert.equal((await round(5n)).closed, true);
  const r6 = await round(6n);
  assert.equal(r6.assetCount, 8);
  assert.equal(r6.closesAt, R6);
  assert.equal(r6.closed, false);
  assert.equal(await read<number>("voteShareBps", [6n]), 5000);
  assert.equal(await read<bigint>("latestRoundId"), 6n);

  // run 2 sends nothing
  const nAfter = await nonce(owner);
  const run2 = await run({});
  console.log("run 2:", JSON.stringify(run2));
  assert.deepEqual(actions(run2), ["not-due"]);
  assert.equal(await nonce(owner), nAfter);
  const run3 = await run({});
  assert.deepEqual(actions(run3), ["not-due"]);
  assert.equal(await nonce(owner), nAfter);
});

// Fork test. Needs an anvil fork of Robinhood Chain, for example:
//   anvil --fork-url "$RPC_URL" --port 8545 --chain-id 4663
//   FORK_RPC_URL=http://127.0.0.1:8545 node --test relayer/sponsorship-guard.fork.test.ts
// Skipped unless FORK_RPC_URL is set. It only talks to the local fork.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, createTestClient, formatEther, http, parseEther } from "viem";
import { createSponsorshipGuard, SPONSORSHIP_PAUSED_MESSAGE, SponsorshipPausedError } from "./sponsorship-guard.ts";

const forkUrl = process.env.FORK_RPC_URL;
const relayer = (process.env.RELAYER_ADDRESS || "0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4") as `0x${string}`;

test("guard follows the forked relayer balance", { skip: !forkUrl }, async () => {
  assert.ok(forkUrl);
  assert.ok(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(forkUrl), "FORK_RPC_URL must be a local anvil fork");
  const publicClient = createPublicClient({ transport: http(forkUrl) });
  const testClient = createTestClient({ mode: "anvil", transport: http(forkUrl) });
  const guard = createSponsorshipGuard({
    getBalance: () => publicClient.getBalance({ address: relayer }),
    cacheMs: 0,
  });

  const forked = await publicClient.getBalance({ address: relayer });
  console.log(`forked relayer balance: ${formatEther(forked)} ETH`);

  await testClient.setBalance({ address: relayer, value: parseEther("0.0002") });
  const low = await guard.status();
  console.log(`0.0002 ETH -> paused=${low.paused} reason=${low.reason}`);
  assert.equal(low.paused, true);
  await assert.rejects(guard.assertAvailable(), (error: unknown) => {
    assert.ok(error instanceof SponsorshipPausedError);
    assert.equal(error.message, SPONSORSHIP_PAUSED_MESSAGE);
    return true;
  });

  await testClient.setBalance({ address: relayer, value: parseEther("0.0003") });
  const edge = await guard.status();
  console.log(`0.0003 ETH -> paused=${edge.paused}`);
  assert.equal(edge.paused, false);

  await testClient.setBalance({ address: relayer, value: parseEther("0.005") });
  const topped = await guard.status();
  console.log(`0.005 ETH -> paused=${topped.paused}`);
  assert.equal(topped.paused, false);
});

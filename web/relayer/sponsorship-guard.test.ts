import test from "node:test";
import assert from "node:assert/strict";
import {
  createSponsorshipGuard,
  DEFAULT_MIN_RELAYER_BALANCE_WEI,
  SPONSORSHIP_PAUSED_MESSAGE,
  SponsorshipPausedError,
} from "./sponsorship-guard.ts";

const ETH = 10n ** 18n;
const MIN = 300_000_000_000_000n; // 0.0003 ETH

function fakeChain(initial: bigint) {
  const state = { balance: initial, reads: 0, failing: false, time: 1_000_000 };
  return {
    state,
    getBalance: async () => {
      state.reads += 1;
      if (state.failing) throw new Error("rpc down");
      return state.balance;
    },
    now: () => state.time,
  };
}

test("default threshold is 0.0003 ETH", () => {
  assert.equal(DEFAULT_MIN_RELAYER_BALANCE_WEI, MIN);
});

test("current relayer balance (0.000082446419572223 ETH) is paused", async () => {
  const chain = fakeChain(82_446_419_572_223n);
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now });
  const status = await guard.status();
  assert.equal(status.paused, true);
  assert.equal(status.reason, "low-balance");
  await assert.rejects(guard.assertAvailable(), (error: unknown) => {
    assert.ok(error instanceof SponsorshipPausedError);
    assert.equal(error.message, SPONSORSHIP_PAUSED_MESSAGE);
    return true;
  });
});

test("boundary: 0.0003 ETH sponsors, one wei less pauses", async () => {
  const chain = fakeChain(MIN);
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now, cacheMs: 0 });
  assert.equal((await guard.status()).paused, false);
  chain.state.balance = MIN - 1n;
  assert.equal((await guard.status()).paused, true);
});

test("a 0.005 ETH top-up resumes sponsorship", async () => {
  const chain = fakeChain(82_446_419_572_223n);
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now, cacheMs: 0 });
  assert.equal((await guard.status()).paused, true);
  chain.state.balance += (ETH * 5n) / 1000n;
  const after = await guard.assertAvailable();
  assert.equal(after.paused, false);
  assert.equal(after.balanceWei, 82_446_419_572_223n + (ETH * 5n) / 1000n);
});

test("fails closed when the balance cannot be read", async () => {
  const chain = fakeChain(ETH);
  chain.state.failing = true;
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now });
  const status = await guard.status();
  assert.equal(status.paused, true);
  assert.equal(status.reason, "balance-unavailable");
});

test("a recent good read is trusted briefly if the RPC fails, then fails closed", async () => {
  const chain = fakeChain(ETH);
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now, cacheMs: 10_000, staleMs: 60_000 });
  assert.equal((await guard.status()).paused, false);
  chain.state.failing = true;
  chain.state.time += 30_000; // past cacheMs, inside staleMs
  assert.equal((await guard.status()).paused, false);
  chain.state.time += 60_000; // past staleMs
  const status = await guard.status();
  assert.equal(status.paused, true);
  assert.equal(status.reason, "balance-unavailable");
});

test("reads are cached, and invalidate forces a fresh read", async () => {
  const chain = fakeChain(ETH);
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now, cacheMs: 10_000 });
  await guard.status();
  await guard.status();
  assert.equal(chain.state.reads, 1);
  guard.invalidate();
  await guard.status();
  assert.equal(chain.state.reads, 2);
});

test("concurrent checks share one balance read", async () => {
  const chain = fakeChain(ETH);
  const guard = createSponsorshipGuard({ getBalance: chain.getBalance, now: chain.now });
  await Promise.all([guard.status(), guard.status(), guard.status()]);
  assert.equal(chain.state.reads, 1);
});

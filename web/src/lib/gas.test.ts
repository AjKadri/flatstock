import assert from "node:assert/strict";
import test from "node:test";
import { gasState, SPONSORSHIP_PAUSED_MESSAGE, type GasHealth } from "./gas.ts";

const WIF = 1_000_000_000_000_000_000n;
const base = { enabled: true, killSwitch: false, dailyCap: 3, usage: 1 };
// A mocked /api/health body for each state.
const healthy: GasHealth = { ...base };
const killed: GasHealth = { ...base, killSwitch: true };
const lowEth: GasHealth = { ...base, sponsorshipPaused: true };
const offline: GasHealth = { ...base, enabled: false };
const input = (locked: bigint | undefined, health: GasHealth, extra = {}) => ({ connected: true, locked, lockedLabel: locked ? `${locked / WIF} $WIF` : "", health, signatureWrites: true, ...extra });

test("locked + sponsorship on: Free gas active, free badge, relay on", () => {
  const s = gasState(input(10n * WIF, healthy));
  assert.equal(s.kind, "free");
  assert.equal(s.badge, "Free gas");
  assert.equal(s.status, "Free gas active");
  assert.equal(s.useRelay, true);
});

test("locked + paused (kill switch, low ETH, offline): paused text, pay-gas badge, relay off", () => {
  for (const health of [killed, lowEth, offline, null]) {
    const s = gasState(input(10n * WIF, health));
    assert.equal(s.kind, "paused");
    assert.equal(s.badge, "You pay gas");
    assert.equal(s.status, "Free gas paused, you pay your own gas for now. Your 10 $WIF stays locked.");
    assert.equal(s.useRelay, false);
    assert.equal(s.helper, null, "pause message must not be repeated");
  }
});

test("not locked: unchanged (pay-gas badge, pause message only as the helper line)", () => {
  const on = gasState(input(0n, healthy));
  assert.equal(on.badge, "You pay gas");
  assert.equal(on.status, null);
  assert.equal(on.useRelay, false);
  const paused = gasState(input(0n, killed));
  assert.equal(paused.helper, SPONSORSHIP_PAUSED_MESSAGE);
  assert.equal(paused.title, SPONSORSHIP_PAUSED_MESSAGE);
});

test("badge, status and relay flag always agree", () => {
  for (const health of [healthy, killed, lowEth, offline, null]) {
    for (const locked of [undefined, 0n, 5n * WIF, 10n * WIF, 25n * WIF]) {
      for (const signatureWrites of [true, false]) {
        const s = gasState(input(locked, health, { signatureWrites }));
        assert.equal(s.badge === "Free gas", s.useRelay);
        assert.equal(s.status === "Free gas active", s.useRelay);
      }
    }
  }
});

test("disconnected wallet shows the idle badge", () => {
  const s = gasState({ connected: false, locked: undefined, lockedLabel: "", health: healthy, signatureWrites: true });
  assert.equal(s.badge, "Connect to see gas");
  assert.equal(s.useRelay, false);
});

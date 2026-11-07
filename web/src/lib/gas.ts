// One source of truth for the gas badge and every gas status line (This week, Vote, Portfolio).
// Pure function so the states can be tested with a mocked /api/health.
export type GasHealth = {
  enabled: boolean;
  killSwitch: boolean;
  dailyCap: number;
  usage?: number;
  sponsorshipPaused?: boolean;
} | null;

export const SPONSORSHIP_PAUSED_MESSAGE = "Gas sponsorship paused, you can still buy and pay your own gas.";
const LOCK_MINIMUM = 10n * 1_000_000_000_000_000_000n;

export type GasKind = "idle" | "unlocked" | "partial" | "configuring" | "free" | "paused";

export type GasState = {
  kind: GasKind;
  /** The relayer will pay gas for this wallet's next vote, buy or sell. */
  useRelay: boolean;
  badge: string;
  /** Status line under the Free gas heading, for locked wallets only. */
  status: string | null;
  /** Extra helper line (usage, or the pause message for wallets that are not locked). */
  helper: string | null;
  /** Tooltip on the badge. */
  title: string | undefined;
};

// Sponsorship is on only when the relayer answered and is enabled, with the kill switch off and ETH not low.
export function sponsorshipOn(health: GasHealth) {
  return Boolean(health && health.enabled && !health.killSwitch && !health.sponsorshipPaused);
}

export function gasState(input: { connected: boolean; locked: bigint | undefined; lockedLabel: string; health: GasHealth; signatureWrites: boolean }): GasState {
  const { connected, locked, lockedLabel, health, signatureWrites } = input;
  const on = sponsorshipOn(health);
  const usage = health ? `Free gas: ${health.enabled ? `${health.usage || 0} of ${health.dailyCap} sponsored actions used today` : "offline"}.` : null;
  if (!connected) return { kind: "idle", useRelay: false, badge: "Connect to see gas", status: null, helper: on || !health ? usage : SPONSORSHIP_PAUSED_MESSAGE, title: undefined };
  if (locked === undefined || locked === 0n) {
    return { kind: "unlocked", useRelay: false, badge: "You pay gas", status: null, helper: on ? usage : health ? SPONSORSHIP_PAUSED_MESSAGE : null, title: on || !health ? undefined : SPONSORSHIP_PAUSED_MESSAGE };
  }
  if (locked < LOCK_MINIMUM) {
    return { kind: "partial", useRelay: false, badge: "You pay gas", status: `Only ${lockedLabel} is locked. Free gas needs 10 $WIF, so you pay your own gas.`, helper: usage, title: undefined };
  }
  if (!signatureWrites) {
    return { kind: "configuring", useRelay: false, badge: "You pay gas", status: "Free gas is being configured. Until then this wallet pays its own gas.", helper: null, title: undefined };
  }
  if (!on) {
    const status = `Free gas paused, you pay your own gas for now. Your ${lockedLabel} stays locked.`;
    return { kind: "paused", useRelay: false, badge: "You pay gas", status, helper: null, title: SPONSORSHIP_PAUSED_MESSAGE };
  }
  return { kind: "free", useRelay: true, badge: "Free gas", status: "Free gas active", helper: usage, title: undefined };
}

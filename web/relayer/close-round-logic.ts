// Pure decision logic for the round bot, kept separate so it can be tested.
// closeRound on FlatstockVotes is permissionless and only needs block.timestamp >= closesAt.
// openRound is onlyOwner: the bot opens a round only when its signer is owner() (see close-round.ts).
// The bot can call closeRound and openRound and nothing else.

export const WEEK_SECONDS = 604_800n;
export const MAX_AHEAD_SECONDS = 8n * 86_400n;
export const MIN_BALANCE_WEI = 50_000_000_000_000n; // 0.00005 ETH

export type CloseDecision = "missing" | "already-closed" | "expected-mismatch" | "not-due" | "due";

/** Legacy single-round decision, used when the bot only closes (AUTO_OPEN_ENABLED=0). */
export function decideClose(input: {
  assetCount: number;
  closed: boolean;
  closesAt: bigint;
  latestTimestamp: bigint;
  expectedClosesAt?: bigint;
}): CloseDecision {
  if (input.assetCount === 0) return "missing";
  if (input.closed) return "already-closed";
  // Refuse to act on any round other than the one the operator approved.
  if (input.expectedClosesAt !== undefined && input.closesAt !== input.expectedClosesAt) return "expected-mismatch";
  if (input.latestTimestamp < input.closesAt) return "not-due";
  return "due";
}

export type RoundView = { assetCount: number; closed: boolean; closesAt: bigint };

export type AutoStep = "missing" | "not-due" | "close" | "open" | "nothing-to-do";

/**
 * One step of the weekly rhythm for the latest round N.
 *  - N missing                      -> "missing" (report, never act)
 *  - N open, now < closesAt         -> "not-due"
 *  - N open, now >= closesAt        -> "close"
 *  - N closed, N+1 does not exist   -> "open"
 *  - N closed, N+1 exists           -> "nothing-to-do"
 */
export function decideAuto(input: { round: RoundView; nextExists: boolean; latestTimestamp: bigint }): AutoStep {
  const { round, nextExists, latestTimestamp } = input;
  if (round.assetCount === 0) return "missing";
  if (!round.closed) return latestTimestamp >= round.closesAt ? "close" : "not-due";
  return nextExists ? "nothing-to-do" : "open";
}

/** previous closesAt + 7 days, adding more whole weeks while that is not in the future. */
export function nextClosesAt(previousClosesAt: bigint, latestTimestamp: bigint): bigint {
  let next = previousClosesAt + WEEK_SECONDS;
  while (next <= latestTimestamp) next += WEEK_SECONDS;
  return next;
}

/** Monday 14:00:00 UTC (= Monday 15:00 WAT). */
export function isMonday1400Utc(closesAt: bigint): boolean {
  const d = new Date(Number(closesAt) * 1000);
  return d.getUTCDay() === 1 && d.getUTCHours() === 14 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

/** Returns null when the proposed new round is sane, otherwise the reason it is refused. */
export function sanityCheckNewRound(input: {
  assetCount: number;
  closesAt: bigint;
  voteShareBps: number;
  latestTimestamp: bigint;
}): string | null {
  const { assetCount, closesAt, voteShareBps, latestTimestamp } = input;
  if (!Number.isInteger(assetCount) || assetCount < 2 || assetCount > 8) return `assetCount ${assetCount} outside 2..8`;
  if (!isMonday1400Utc(closesAt)) return `closesAt ${closesAt} is not a Monday 14:00:00 UTC`;
  if (closesAt <= latestTimestamp) return `closesAt ${closesAt} is not in the future`;
  if (closesAt > latestTimestamp + MAX_AHEAD_SECONDS) return `closesAt ${closesAt} is more than 8 days ahead`;
  if (!Number.isInteger(voteShareBps) || voteShareBps < 0 || voteShareBps > 10_000) return `voteShareBps ${voteShareBps} above 10000`;
  return null;
}

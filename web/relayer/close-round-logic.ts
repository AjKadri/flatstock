// Pure decision logic for the close-round bot, kept separate so it can be tested.
// closeRound on FlatstockVotes is permissionless and only needs block.timestamp >= closesAt.
// This bot can only close a round. Opening a round is onlyOwner and is never done here.

export type CloseDecision = "missing" | "already-closed" | "expected-mismatch" | "not-due" | "due";

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

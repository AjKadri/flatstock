// Pure selection logic, kept free of app config so node tests can import it.
import type { RoundState } from "./chain";

export type BuyMix = { round: RoundState; kind: "final" | "preview" };

// Buys use the final mix of the most recent CLOSED round on the current contract.
// Before the first round closes there is no final mix, so the open round's live weights are
// offered as a clearly labelled preview (only if it has votes). Never mixes rounds of different
// contracts: ids below firstRound are ignored.
export async function selectBuyMix(
  latest: RoundState,
  readById: (id: bigint) => Promise<RoundState | null>,
  firstRound: bigint,
): Promise<BuyMix | null> {
  if (latest.closed) return { round: latest, kind: "final" };
  for (let id = latest.roundId - 1n; id >= firstRound; id -= 1n) {
    const earlier = await readById(id);
    if (earlier?.closed) return { round: earlier, kind: "final" };
  }
  return latest.totalVotes > 0n ? { round: latest, kind: "preview" } : null;
}

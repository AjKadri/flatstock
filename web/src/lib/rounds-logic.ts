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

// "Adjust" on the buy screen: keep only the chosen stocks and rescale the community weights so they
// still sum to 100% while keeping their relative sizes. Pure arithmetic, no change to the guard or contracts.
export function renormaliseWeights(weights: bigint[], keep: number[]): bigint[] {
  const out = weights.map(() => 0n);
  const kept = keep.filter((index) => (weights[index] ?? 0n) > 0n);
  const sum = kept.reduce((total, index) => total + weights[index], 0n);
  if (sum === 0n) return out;
  let allocated = 0n;
  let largest = kept[0];
  for (const index of kept) {
    out[index] = (weights[index] * 10_000n) / sum;
    allocated += out[index];
    if (weights[index] > weights[largest]) largest = index;
  }
  out[largest] += 10_000n - allocated;
  return out;
}

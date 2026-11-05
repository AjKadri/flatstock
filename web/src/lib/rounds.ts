// Read-only round data for the "this week's mix" / "vote for next week" split and Past rounds.
// No contract changes: everything comes from rounds(), weightBps() and event logs.
import { parseAbiItem, type Address, type Hex } from "viem";
import {
  addresses,
  assets,
  EXPLORER_URL,
  FIRST_MAIN_ROUND,
  MIX_VOTE_SHARE_BPS,
  retiredVoteContracts,
  STATS_FROM_BLOCK,
  votesAbi,
} from "../config";
import { calculateMixWeights, getLatestTimestamp, publicClient, type RoundState } from "./chain";

const roundOpenedEvent = parseAbiItem(
  "event RoundOpened(uint256 indexed roundId, uint8 assetCount, uint64 opensAt, uint64 closesAt, uint16 voteShareBps)",
);
const roundClosedEvent = parseAbiItem("event RoundClosed(uint256 indexed roundId, uint256 totalVotes)");
const voteCastEvent = parseAbiItem(
  "event VoteCast(uint256 indexed roundId, address indexed voter, uint8 indexed assetIndex)",
);

import { selectBuyMix, type BuyMix } from "./rounds-logic";
export type { BuyMix };

export type PastRound = {
  key: string;
  contract: Address;
  contractLabel: string;
  roundId: bigint;
  status: "open" | "closed" | "ended" | "unknown";
  opensAt: bigint | null;
  closesAt: bigint | null;
  votes: bigint;
  votesByAsset: bigint[];
  weights: bigint[] | null;
  assetCount: number;
  openTx: Hex | null;
  closeTx: Hex | null;
};

export type RoundHistory = {
  main: PastRound[];
  tests: PastRound[];
  totalVotes: bigint;
};

export function txLink(hash: Hex) {
  return `${EXPLORER_URL}/tx/${hash}`;
}
export function addressLink(address: Address) {
  return `${EXPLORER_URL}/address/${address}`;
}

export async function readRoundById(roundId: bigint): Promise<RoundState | null> {
  try {
    const [opensAt, closesAt, assetCount, totalVotes, closed] = (await publicClient.readContract({
      address: addresses.votes,
      abi: votesAbi,
      functionName: "rounds",
      args: [roundId],
    })) as readonly [bigint, bigint, number, bigint, boolean];
    if (assetCount === 0) return null;
    const now = await getLatestTimestamp();
    const votes = await Promise.all(
      assets.map(async (_, index) => {
        if (index >= assetCount || totalVotes === 0n) return 0n;
        return (await publicClient.readContract({
          address: addresses.votes, abi: votesAbi, functionName: "votesFor", args: [roundId, index],
        })) as bigint;
      }),
    );
    const weights = closed
      ? await Promise.all(assets.map(async (_, index) => {
        if (index >= assetCount) return 0n;
        return (await publicClient.readContract({
          address: addresses.votes, abi: votesAbi, functionName: "weightBps", args: [roundId, index],
        })) as bigint;
      }))
      : assets.map((_, index) => index < assetCount
        ? calculateMixWeights(votes, assetCount, MIX_VOTE_SHARE_BPS)[index] || 0n
        : 0n);
    return { roundId, opensAt, closesAt, assetCount, totalVotes, closed, isOpen: !closed && now < closesAt, weights };
  } catch {
    return null;
  }
}

export async function pickBuyMix(latest: RoundState): Promise<BuyMix | null> {
  return selectBuyMix(latest, readRoundById, FIRST_MAIN_ROUND);
}

type LogLike = { args: Record<string, unknown>; transactionHash: Hex | null };

async function logsFor(address: Address, event: typeof roundOpenedEvent | typeof roundClosedEvent | typeof voteCastEvent) {
  try {
    // One event type per request: the RPC limits multi-topic queries over wide block ranges.
    return (await publicClient.getLogs({ address, event, fromBlock: STATS_FROM_BLOCK, toBlock: "latest" } as never)) as unknown as LogLike[];
  } catch {
    return [] as LogLike[];
  }
}

async function summarise(contract: Address, contractLabel: string, isMain: boolean): Promise<PastRound[]> {
  const [opened, closed, voted] = await Promise.all([
    logsFor(contract, roundOpenedEvent),
    logsFor(contract, roundClosedEvent),
    logsFor(contract, voteCastEvent),
  ]);
  const ids = new Set<bigint>();
  for (const log of [...opened, ...closed, ...voted]) ids.add(log.args.roundId as bigint);
  const rounds: PastRound[] = [];
  for (const roundId of [...ids].sort((a, b) => (a < b ? -1 : 1))) {
    const votesByAsset = assets.map(() => 0n);
    let votes = 0n;
    for (const log of voted) {
      if ((log.args.roundId as bigint) !== roundId) continue;
      votes += 1n;
      const index = Number(log.args.assetIndex);
      if (index < votesByAsset.length) votesByAsset[index] += 1n;
    }
    const openLog = opened.find((log) => (log.args.roundId as bigint) === roundId);
    const closeLog = closed.find((log) => (log.args.roundId as bigint) === roundId);
    let state: Awaited<ReturnType<typeof readOnChain>> = null;
    state = await readOnChain(contract, roundId);
    const assetCount = state?.assetCount ?? Number(openLog?.args.assetCount ?? 0);
    const closedNow = Boolean(closeLog) || Boolean(state?.closed);
    const closesAt = state?.closesAt ?? (openLog ? BigInt(openLog.args.closesAt as bigint) : null);
    const ended = closesAt !== null && BigInt(Math.floor(Date.now() / 1000)) >= closesAt;
    let weights: bigint[] | null = null;
    if (isMain && state && assetCount > 0) {
      weights = closedNow
        ? await Promise.all(assets.map(async (_, i) => i < assetCount
          ? (await publicClient.readContract({ address: contract, abi: votesAbi, functionName: "weightBps", args: [roundId, i] })) as bigint
          : 0n))
        : assets.map((_, i) => i < assetCount ? calculateMixWeights(votesByAsset, assetCount, MIX_VOTE_SHARE_BPS)[i] || 0n : 0n);
    }
    rounds.push({
      key: `${contract}-${roundId}`,
      contract,
      contractLabel,
      roundId,
      status: closedNow ? "closed" : state ? (ended ? "ended" : "open") : "unknown",
      opensAt: state?.opensAt ?? (openLog ? BigInt(openLog.args.opensAt as bigint) : null),
      closesAt,
      votes,
      votesByAsset,
      weights,
      assetCount,
      openTx: openLog?.transactionHash ?? null,
      closeTx: closeLog?.transactionHash ?? null,
    });
  }
  return rounds;
}

async function readOnChain(contract: Address, roundId: bigint) {
  try {
    const [opensAt, closesAt, assetCount, , closed] = (await publicClient.readContract({
      address: contract, abi: votesAbi, functionName: "rounds", args: [roundId],
    })) as readonly [bigint, bigint, number, bigint, boolean];
    return assetCount === 0 ? null : { opensAt, closesAt, assetCount, closed };
  } catch {
    return null;
  }
}

export async function readRoundHistory(): Promise<RoundHistory> {
  const [main, ...retired] = await Promise.all([
    summarise(addresses.votes, "Current contract", true),
    ...retiredVoteContracts.map((item) => summarise(item.address, item.label, false)),
  ]);
  const tests = retired.flat().filter((round) => round.votes > 0n || round.status !== "unknown");
  const totalVotes = [...main, ...tests].reduce((sum, round) => sum + round.votes, 0n);
  return { main: main.filter((round) => round.roundId >= FIRST_MAIN_ROUND).reverse(), tests, totalVotes };
}

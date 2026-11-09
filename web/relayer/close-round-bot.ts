// Round bot: closes the current FlatstockVotes round when it is due and, when allowed, opens the next one.
// Every run decides from on-chain state alone, so running it twice in a row never sends twice.
// The only contract writes are closeRound and openRound, and nothing is sent without a successful eth_call simulation.
import { parseAbi, type Account, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import {
  MIN_BALANCE_WEI,
  decideAuto,
  decideClose,
  nextClosesAt,
  sanityCheckNewRound,
  type RoundView,
} from "./close-round-logic.ts";

export const votesAbi = parseAbi([
  "function rounds(uint256) view returns (uint64 opensAt, uint64 closesAt, uint8 assetCount, uint256 totalVotes, bool closed)",
  "function latestRoundId() view returns (uint256)",
  "function owner() view returns (address)",
  "function voteShareBps(uint256) view returns (uint16)",
  "function closeRound(uint256 roundId)",
  "function openRound(uint256 roundId, uint8 assetCount, uint64 closesAt, uint16 voteShareBps)",
]);

const ALLOWED_WRITES = new Set(["closeRound", "openRound"]);

export type BotConfig = {
  contract: Address;
  /** CLOSE_ROUND_ENABLED=1 */
  enabled: boolean;
  /** AUTO_OPEN_ENABLED=1 (only meaningful with enabled) */
  autoOpen: boolean;
  /** Legacy pins, honoured only when autoOpen is off. */
  pinnedRoundId?: bigint;
  fallbackRoundId?: bigint;
  expectedClosesAt?: bigint;
  pinsPresent?: { voteRoundId: boolean; expectedClosesAt: boolean };
};

export type BotDeps = {
  publicClient: PublicClient;
  /** Absent in read-only mode. */
  walletClient?: WalletClient;
  /** The signer: a local account or an address the node signs for (anvil impersonation in tests). */
  account?: Account | Address;
  config: BotConfig;
  log: (line: Record<string, unknown>) => void;
};

type Round = RoundView & { opensAt: bigint; totalVotes: bigint };

const addressOf = (account: Account | Address): Address => (typeof account === "string" ? account : account.address);

async function readRound(publicClient: PublicClient, contract: Address, id: bigint): Promise<Round> {
  const [opensAt, closesAt, assetCount, totalVotes, closed] = (await publicClient.readContract({
    address: contract,
    abi: votesAbi,
    functionName: "rounds",
    args: [id],
  })) as readonly [bigint, bigint, number, bigint, boolean];
  return { opensAt, closesAt, assetCount, totalVotes, closed };
}

export async function runBot(deps: BotDeps): Promise<void> {
  const { publicClient, walletClient, account, config, log } = deps;
  const base: Record<string, unknown> = {
    contract: config.contract,
    mode: !config.enabled ? "status-only" : config.autoOpen ? "auto" : "close-only",
  };
  const emit = (line: Record<string, unknown>) => log({ ...base, ...line });

  try {
    // 1. Which round are we looking at?
    let roundId: bigint;
    const auto = config.enabled && config.autoOpen;
    if (auto) {
      if (config.pinsPresent?.voteRoundId || config.pinsPresent?.expectedClosesAt) {
        const ignored: string[] = [];
        if (config.pinsPresent.voteRoundId) ignored.push("VOTE_ROUND_ID");
        if (config.pinsPresent.expectedClosesAt) ignored.push("CLOSE_ROUND_EXPECTED_CLOSES_AT");
        emit({ action: "pins-ignored", ignored });
      }
      roundId = (await publicClient.readContract({ address: config.contract, abi: votesAbi, functionName: "latestRoundId" })) as bigint;
    } else if (config.pinnedRoundId !== undefined) {
      roundId = config.pinnedRoundId;
    } else {
      try {
        roundId = (await publicClient.readContract({ address: config.contract, abi: votesAbi, functionName: "latestRoundId" })) as bigint;
      } catch {
        roundId = config.fallbackRoundId ?? 3n; // the legacy contract has no latestRoundId getter
      }
    }

    const round = await readRound(publicClient, config.contract, roundId);
    const latest = await publicClient.getBlock({ blockTag: "latest" });
    const now = latest.timestamp;
    const roundReport = {
      roundId: roundId.toString(),
      opensAt: round.opensAt.toString(),
      closesAt: round.closesAt.toString(),
      closesAtIso: round.closesAt ? new Date(Number(round.closesAt) * 1000).toISOString() : null,
      assetCount: round.assetCount,
      totalVotes: round.totalVotes.toString(),
      closed: round.closed,
      latest: now.toString(),
    };

    // 2. Status only: never sends.
    if (!config.enabled) {
      const decision = decideClose({ ...round, latestTimestamp: now, expectedClosesAt: config.expectedClosesAt });
      emit({ ...roundReport, decision, action: "none" });
      return;
    }

    if (!auto) {
      // Close-only mode keeps the operator pins from before.
      const decision = decideClose({ ...round, latestTimestamp: now, expectedClosesAt: config.expectedClosesAt });
      if (decision !== "due") {
        emit({ ...roundReport, decision, action: decision });
        return;
      }
      await closeStep(roundId, roundReport);
      return;
    }

    // 3. Auto mode.
    const nextExists = round.closed ? (await readRound(publicClient, config.contract, roundId + 1n)).assetCount !== 0 : false;
    const step = decideAuto({ round, nextExists, latestTimestamp: now });
    if (step === "missing" || step === "not-due" || step === "nothing-to-do") {
      emit({ ...roundReport, action: step });
      return;
    }
    if (step === "close") {
      const closed = await closeStep(roundId, roundReport);
      if (!closed) return;
      // Continue to the opening in the same run; state is re-read from the chain.
      await openStep(roundId);
      return;
    }
    await openStep(roundId);
  } catch (error) {
    // Any RPC (or other) error: do nothing this run.
    emit({ action: "rpc-error", error: error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown error" });
  }

  // ---- steps (hoisted function declarations close over deps) ----

  /** Shared pre-send guards. Returns false (after logging) when sending must not happen this run. */
  async function canSend(extra: Record<string, unknown>): Promise<Address | null> {
    if (!walletClient || !account) {
      emit({ ...extra, action: "no-key" });
      return null;
    }
    const signer = addressOf(account);
    const balance = await publicClient.getBalance({ address: signer });
    if (balance < MIN_BALANCE_WEI) {
      emit({ ...extra, action: "low-balance", balanceWei: balance.toString(), minWei: MIN_BALANCE_WEI.toString() });
      return null;
    }
    const [pending, mined] = await Promise.all([
      publicClient.getTransactionCount({ address: signer, blockTag: "pending" }),
      publicClient.getTransactionCount({ address: signer, blockTag: "latest" }),
    ]);
    if (pending !== mined) {
      emit({ ...extra, action: "pending-tx", pendingNonce: pending, latestNonce: mined });
      return null;
    }
    return signer;
  }

  /** The single write path. Simulates first; refuses any function except closeRound and openRound. */
  async function simulateAndSend(functionName: "closeRound" | "openRound", args: readonly unknown[], signer: Address): Promise<{ hash: Hex; status: string } | { error: string }> {
    if (!ALLOWED_WRITES.has(functionName)) throw new Error(`refusing to call ${functionName}`);
    try {
      await publicClient.simulateContract({ address: config.contract, abi: votesAbi, functionName, args: args as never, account: account as never });
    } catch (error) {
      return { error: `simulation failed: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown"}` };
    }
    const hash = await walletClient!.writeContract({ address: config.contract, abi: votesAbi, functionName, args: args as never, account: account as never, chain: walletClient!.chain ?? null });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    void signer;
    return { hash, status: receipt.status };
  }

  async function closeStep(roundId: bigint, roundReport: Record<string, unknown>): Promise<boolean> {
    const signer = await canSend({ ...roundReport, step: "close" });
    if (!signer) return false;
    const sent = await simulateAndSend("closeRound", [roundId], signer);
    if ("error" in sent) {
      emit({ ...roundReport, step: "close", action: "simulation-failed", error: sent.error });
      return false;
    }
    emit({ ...roundReport, step: "close", action: "closed", hash: sent.hash, status: sent.status });
    return sent.status === "success";
  }

  async function openStep(previousId: bigint): Promise<void> {
    // Re-read: the previous round must be closed and the next must not exist.
    const prev = await readRound(publicClient, config.contract, previousId);
    const nextId = previousId + 1n;
    const next = await readRound(publicClient, config.contract, nextId);
    const latest = await publicClient.getBlock({ blockTag: "latest" });
    const now = latest.timestamp;
    const report = { step: "open", previousRoundId: previousId.toString(), roundId: nextId.toString() };
    if (!prev.closed || next.assetCount !== 0) {
      emit({ ...report, action: "nothing-to-do" });
      return;
    }
    const signer = account ? addressOf(account) : undefined;
    if (!signer || !walletClient) {
      emit({ ...report, action: "no-key" });
      return;
    }
    const owner = (await publicClient.readContract({ address: config.contract, abi: votesAbi, functionName: "owner" })) as Address;
    if (owner.toLowerCase() !== signer.toLowerCase()) {
      emit({ ...report, action: "not-owner", signer, owner });
      return;
    }
    const voteShareBps = Number(await publicClient.readContract({ address: config.contract, abi: votesAbi, functionName: "voteShareBps", args: [previousId] }));
    const closesAt = nextClosesAt(prev.closesAt, now);
    const proposal = { assetCount: prev.assetCount, closesAt: closesAt.toString(), closesAtIso: new Date(Number(closesAt) * 1000).toISOString(), voteShareBps };
    const refused = sanityCheckNewRound({ assetCount: prev.assetCount, closesAt, voteShareBps, latestTimestamp: now });
    if (refused) {
      emit({ ...report, ...proposal, action: "sanity-failed", reason: refused });
      return;
    }
    const ok = await canSend({ ...report, ...proposal });
    if (!ok) return;
    const sent = await simulateAndSend("openRound", [nextId, prev.assetCount, closesAt, voteShareBps], ok);
    if ("error" in sent) {
      emit({ ...report, ...proposal, action: "simulation-failed", error: sent.error });
      return;
    }
    emit({ ...report, ...proposal, action: "opened", hash: sent.hash, status: sent.status });
  }
}

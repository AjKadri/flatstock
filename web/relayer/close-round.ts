import { createPublicClient, createWalletClient, fallback, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { decideClose } from "./close-round-logic.ts";

const publicRpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const quickNodeRpcUrl = process.env.QUICKNODE_RPC_URL?.trim();
// Same variable the relayer uses for the current vote contract. VOTE_CONTRACT_ADDRESS is only a
// fallback: on the VPS it still holds the retired contract, so META_VOTES_ADDRESS must win.
const contractAddress = (process.env.META_VOTES_ADDRESS || process.env.VOTE_CONTRACT_ADDRESS || "") as Address;
const configuredRoundId = process.env.VOTE_ROUND_ID || process.env.VITE_ROUND_ID;
const fallbackRoundId = BigInt(process.env.CLOSE_ROUND_FALLBACK_ID || "3");
// If set, the bot refuses to touch a round whose on-chain closesAt differs (round 4: 1794232800).
const expectedClosesAt = process.env.CLOSE_ROUND_EXPECTED_CLOSES_AT
  ? BigInt(process.env.CLOSE_ROUND_EXPECTED_CLOSES_AT)
  : undefined;
const enabled = process.env.CLOSE_ROUND_ENABLED === "1";
const privateKeyRaw = process.env.M3_CLOSE_BOT_PRIVATE_KEY || process.env.M1_RELAYER_PRIVATE_KEY;

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [quickNodeRpcUrl || publicRpcUrl] } },
});

const readTransport = quickNodeRpcUrl
  ? fallback([http(quickNodeRpcUrl), http(publicRpcUrl)])
  : http(publicRpcUrl);
const publicClient = createPublicClient({ chain, transport: readTransport });
const votesAbi = parseAbi([
  "function rounds(uint256) view returns (uint64 opensAt, uint64 closesAt, uint8 assetCount, uint256 totalVotes, bool closed)",
  "function latestRoundId() view returns (uint256)",
  "function closeRound(uint256 roundId)",
]);

async function main() {
  if (!isAddress(contractAddress)) {
    throw new Error("META_VOTES_ADDRESS (or VOTE_CONTRACT_ADDRESS) is not set to a valid address.");
  }
  let roundId = configuredRoundId ? BigInt(configuredRoundId) : fallbackRoundId;
  if (!configuredRoundId) {
    try {
      roundId = await publicClient.readContract({
        address: contractAddress,
        abi: votesAbi,
        functionName: "latestRoundId",
      }) as bigint;
    } catch {
      // The legacy contract has no latestRoundId getter.
    }
  }
  const [opensAt, closesAt, assetCount, totalVotes, closed] = (await publicClient.readContract({
    address: contractAddress,
    abi: votesAbi,
    functionName: "rounds",
    args: [roundId],
  })) as readonly [bigint, bigint, number, bigint, boolean];
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  const decision = decideClose({
    assetCount,
    closed,
    closesAt,
    latestTimestamp: latest.timestamp,
    expectedClosesAt,
  });
  const report = {
    enabled,
    contract: contractAddress,
    roundId: roundId.toString(),
    opensAt: opensAt.toString(),
    closesAt: closesAt.toString(),
    closesAtIso: new Date(Number(closesAt) * 1000).toISOString(),
    expectedClosesAt: expectedClosesAt?.toString() ?? null,
    latest: latest.timestamp.toString(),
    totalVotes: totalVotes.toString(),
    closed,
    decision,
  };

  // Disabled: read-only status report, never sends a transaction.
  if (!enabled) {
    console.log(JSON.stringify({ ...report, action: "none" }));
    return;
  }
  if (decision === "missing") throw new Error(`Round ${roundId} does not exist on ${contractAddress}.`);
  if (decision === "expected-mismatch") {
    throw new Error(`Round ${roundId} closes at ${closesAt}, expected ${expectedClosesAt}. Refusing to close.`);
  }
  if (decision === "already-closed" || decision === "not-due") {
    console.log(JSON.stringify({ ...report, action: decision }));
    return;
  }
  if (!privateKeyRaw) throw new Error("M3_CLOSE_BOT_PRIVATE_KEY or M1_RELAYER_PRIVATE_KEY is required when closing is enabled.");

  const account = privateKeyToAccount(`0x${privateKeyRaw.replace(/^0x/, "")}` as Hex);
  const walletClient = createWalletClient({ account, chain, transport: http(publicRpcUrl) });
  const hash = await walletClient.writeContract({
    account,
    address: contractAddress,
    abi: votesAbi,
    functionName: "closeRound",
    args: [roundId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(JSON.stringify({ ...report, action: "closed", hash, status: receipt.status }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Close-round bot failed.");
  process.exitCode = 1;
});

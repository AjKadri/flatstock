import { createPublicClient, createWalletClient, fallback, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const publicRpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const quickNodeRpcUrl = process.env.QUICKNODE_RPC_URL?.trim();
const contractAddress = (process.env.VOTE_CONTRACT_ADDRESS || "0x68d2622f3bbf6BE80CdfED679489de344410C7Db") as Address;
const configuredRoundId = process.env.VOTE_ROUND_ID || process.env.VITE_ROUND_ID;
const fallbackRoundId = BigInt(process.env.CLOSE_ROUND_FALLBACK_ID || "3");
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
  if (!enabled) {
    console.log(JSON.stringify({ enabled: false, roundId: configuredRoundId || "auto", action: "none" }));
    return;
  }
  if (!privateKeyRaw) throw new Error("M3_CLOSE_BOT_PRIVATE_KEY or M1_RELAYER_PRIVATE_KEY is required when closing is enabled.");

  const account = privateKeyToAccount(`0x${privateKeyRaw.replace(/^0x/, "")}` as Hex);
  const walletClient = createWalletClient({ account, chain, transport: http(publicRpcUrl) });
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
  if (assetCount === 0) throw new Error(`Round ${roundId} does not exist.`);
  if (closed) {
    console.log(JSON.stringify({ enabled: true, roundId: roundId.toString(), action: "already-closed", totalVotes: totalVotes.toString() }));
    return;
  }
  if (latest.timestamp < closesAt) {
    console.log(JSON.stringify({ enabled: true, roundId: roundId.toString(), action: "not-due", opensAt: opensAt.toString(), closesAt: closesAt.toString(), latest: latest.timestamp.toString() }));
    return;
  }

  const hash = await walletClient.writeContract({
    account,
    address: contractAddress,
    abi: votesAbi,
    functionName: "closeRound",
    args: [roundId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(JSON.stringify({ enabled: true, roundId: roundId.toString(), action: "closed", hash, status: receipt.status, totalVotes: totalVotes.toString() }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Close-round bot failed.");
  process.exitCode = 1;
});

// Entry point for the round bot (systemd timer, every 5 minutes). See close-round-bot.ts for the behaviour.
//   CLOSE_ROUND_ENABLED=0                      status only, never sends
//   CLOSE_ROUND_ENABLED=1, AUTO_OPEN_ENABLED=0 closes the current round when due (legacy pins honoured)
//   CLOSE_ROUND_ENABLED=1, AUTO_OPEN_ENABLED=1 closes when due, then opens the next weekly round
import { createPublicClient, createWalletClient, defineChain, fallback, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runBot } from "./close-round-bot.ts";

const publicRpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const quickNodeRpcUrl = process.env.QUICKNODE_RPC_URL?.trim();
// Same variable the relayer uses for the current vote contract. VOTE_CONTRACT_ADDRESS is only a
// fallback: on the VPS it may still hold a retired contract, so META_VOTES_ADDRESS must win.
const contractAddress = (process.env.META_VOTES_ADDRESS || process.env.VOTE_CONTRACT_ADDRESS || "") as Address;
const configuredRoundId = process.env.VOTE_ROUND_ID || process.env.VITE_ROUND_ID;
const expectedClosesAtRaw = process.env.CLOSE_ROUND_EXPECTED_CLOSES_AT;
const enabled = process.env.CLOSE_ROUND_ENABLED === "1";
const autoOpen = process.env.AUTO_OPEN_ENABLED === "1";
const privateKeyRaw = process.env.M3_CLOSE_BOT_PRIVATE_KEY || process.env.M1_RELAYER_PRIVATE_KEY;

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [quickNodeRpcUrl || publicRpcUrl] } },
});
const readTransport = quickNodeRpcUrl ? fallback([http(quickNodeRpcUrl), http(publicRpcUrl)]) : http(publicRpcUrl);
const publicClient = createPublicClient({ chain, transport: readTransport });

async function main() {
  if (!isAddress(contractAddress)) {
    throw new Error("META_VOTES_ADDRESS (or VOTE_CONTRACT_ADDRESS) is not set to a valid address.");
  }
  const account = enabled && privateKeyRaw ? privateKeyToAccount(`0x${privateKeyRaw.replace(/^0x/, "")}` as Hex) : undefined;
  const walletClient = account ? createWalletClient({ account, chain, transport: http(publicRpcUrl) }) : undefined;
  await runBot({
    publicClient,
    walletClient,
    account,
    log: (line) => console.log(JSON.stringify(line)),
    config: {
      contract: contractAddress,
      enabled,
      autoOpen,
      pinnedRoundId: configuredRoundId ? BigInt(configuredRoundId) : undefined,
      fallbackRoundId: BigInt(process.env.CLOSE_ROUND_FALLBACK_ID || "3"),
      expectedClosesAt: expectedClosesAtRaw ? BigInt(expectedClosesAtRaw) : undefined,
      pinsPresent: { voteRoundId: Boolean(configuredRoundId), expectedClosesAt: Boolean(expectedClosesAtRaw) },
    },
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Round bot failed.");
  process.exitCode = 1;
});

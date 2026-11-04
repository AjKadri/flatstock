import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const rpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const zeroDelegate = "0x0000000000000000000000000000000000000000" as const;
const userKey = process.env.M1_USER_PRIVATE_KEY;
const relayerKey = process.env.M1_RELAYER_PRIVATE_KEY;
if (!userKey || !relayerKey) throw new Error("M1_USER_PRIVATE_KEY and M1_RELAYER_PRIVATE_KEY are required.");
if (process.env.REVOKE_7702_APPROVED !== "1") {
  throw new Error("Set REVOKE_7702_APPROVED=1 only after confirming the revocation transaction.");
}

const user = privateKeyToAccount((userKey.startsWith("0x") ? userKey : `0x${userKey}`) as Hex);
const relayer = privateKeyToAccount((relayerKey.startsWith("0x") ? relayerKey : `0x${relayerKey}`) as Hex);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account: relayer, chain, transport: http(rpcUrl) });

const before = await publicClient.getCode({ address: user.address });
const nonce = await publicClient.getTransactionCount({ address: user.address, blockTag: "pending" });
const authorization = await user.signAuthorization({
  contractAddress: zeroDelegate,
  chainId: chain.id,
  nonce,
});
const hash = await walletClient.sendTransaction({
  account: relayer,
  to: relayer.address,
  value: 0n,
  authorizationList: [authorization],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const after = await publicClient.getCode({ address: user.address });
console.log(JSON.stringify({
  user: user.address,
  relayer: relayer.address,
  nonce,
  delegate: zeroDelegate,
  txHash: hash,
  status: receipt.status,
  gasUsed: receipt.gasUsed.toString(),
  effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
  codeBefore: before,
  codeAfter: after,
}));

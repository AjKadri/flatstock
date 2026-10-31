import http from "node:http";
import { createPublicClient, createWalletClient, decodeFunctionData, http as viemHttp, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const port = Number(process.env.M3_RELAYER_PORT || 8787);
const rpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

const addresses = {
  wif: "0x5173b8eA6923c2d40267890D45C46a3480954773" as Address,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  votes: "0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9" as Address,
  lock: "0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121" as Address,
  buyRouter: "0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA" as Address,
};

const relayerKeyRaw = process.env.M1_RELAYER_PRIVATE_KEY;
const relayerKey = relayerKeyRaw
  ? (`0x${relayerKeyRaw.replace(/^0x/, "")}` as Hex)
  : undefined;
const implementation = process.env.M1_7702_IMPLEMENTATION_ADDRESS?.toLowerCase();
const dailyCap = Number(process.env.M3_DAILY_SPONSORED_TX_CAP || 3);
const initialKillSwitch = process.env.M3_RELAYER_KILL_SWITCH === "1";
const adminToken = process.env.M3_RELAYER_ADMIN_TOKEN;

if (!relayerKey) throw new Error("M1_RELAYER_PRIVATE_KEY is required in the environment.");
if (!implementation) throw new Error("M1_7702_IMPLEMENTATION_ADDRESS is required in the environment.");

const account = privateKeyToAccount(relayerKey);
const publicClient = createPublicClient({ chain, transport: viemHttp(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: viemHttp(rpcUrl) });
const delegateAbi = parseAbi(["function executeBatch((address target, uint256 value, bytes data)[] calls)"]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const lockAbi = parseAbi(["function lock(uint256 amount)", "function unlock(uint256 amount)"]);
const votesAbi = parseAbi(["function vote(uint256 roundId, uint8 assetIndex)"]);
const routerAbi = parseAbi(["function buyUniswap(address sellToken, address buyToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96, uint256 gasWifAmount)"]);
const allowedTargets = new Set([addresses.wif.toLowerCase(), addresses.usdg.toLowerCase(), addresses.votes.toLowerCase(), addresses.lock.toLowerCase(), addresses.buyRouter.toLowerCase()]);
const usage = new Map<string, { day: string; count: number }>();
let killSwitch = initialKillSwitch;

function dayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(body));
}

async function body(request: http.IncomingMessage) {
  let data = "";
  for await (const chunk of request) data += chunk;
  return JSON.parse(data || "{}");
}

function fail(message: string): never {
  throw new Error(message);
}

function validateBatch(data: Hex) {
  const decoded = decodeFunctionData({ abi: delegateAbi, data });
  if (decoded.functionName !== "executeBatch") fail("Only executeBatch is accepted.");
  const calls = decoded.args[0] as readonly { target: Address; value: bigint; data: Hex }[];
  if (calls.length === 0 || calls.length > 8) fail("Invalid batch length.");
  for (const call of calls) {
    const target = call.target.toLowerCase();
    if (call.value !== 0n || !allowedTargets.has(target)) fail("Batch target is not allowed.");
    if (target === addresses.buyRouter.toLowerCase()) {
      const nested = decodeFunctionData({ abi: routerAbi, data: call.data });
      const args = nested.args as readonly [Address, Address, number, bigint, bigint, bigint, bigint];
      if (nested.functionName !== "buyUniswap" || args[4] <= 0n) fail("Buy quote is missing a minimum output.");
    } else if (target === addresses.wif.toLowerCase() || target === addresses.usdg.toLowerCase()) {
      const nested = decodeFunctionData({ abi: erc20Abi, data: call.data });
      const spender = (nested.args as readonly [Address, bigint])[0].toLowerCase();
      if (![addresses.votes, addresses.lock, addresses.buyRouter].map((value) => value.toLowerCase()).includes(spender)) fail("Token approval target is not allowed.");
    } else if (target === addresses.lock.toLowerCase()) {
      const nested = decodeFunctionData({ abi: lockAbi, data: call.data });
      if (nested.functionName !== "lock" && nested.functionName !== "unlock") fail("Lock call is not allowed.");
    } else if (target === addresses.votes.toLowerCase()) {
      const nested = decodeFunctionData({ abi: votesAbi, data: call.data });
      if (nested.functionName !== "vote") fail("Vote call is not allowed.");
    }
  }
}

async function relay(request: http.IncomingMessage, response: http.ServerResponse) {
  if (killSwitch) return json(response, 503, { error: "Sponsorship is paused by the kill switch." });
  const payload = await body(request) as { wallet?: string; data?: Hex };
  if (!payload.wallet || !isAddress(payload.wallet) || !payload.data?.startsWith("0x")) return json(response, 400, { error: "wallet and data are required." });
  const wallet = payload.wallet as Address;
  const code = await publicClient.getCode({ address: wallet });
  const expectedCode = `0xef0100${implementation!.replace(/^0x/, "")}`;
  if (code?.toLowerCase() !== expectedCode) return json(response, 403, { error: "This wallet has no approved sponsored delegation." });
  validateBatch(payload.data);
  const today = dayKey();
  const current = usage.get(wallet.toLowerCase());
  const entry = current?.day === today ? current : { day: today, count: 0 };
  if (entry.count >= dailyCap) return json(response, 429, { error: "Daily sponsored transaction cap reached." });
  entry.count += 1;
  usage.set(wallet.toLowerCase(), entry);
  const hash = await walletClient.sendTransaction({ to: wallet, data: payload.data });
  return json(response, 200, { txHash: hash, day: today, usage: entry.count, dailyCap });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return json(response, 204, {});
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      const current = usage.get(request.headers["x-wallet"]?.toString().toLowerCase() || "");
      return json(response, 200, { enabled: true, killSwitch, dailyCap, usage: current?.day === dayKey() ? current.count : 0, relayer: account.address });
    }
    if (request.method === "POST" && request.url === "/api/relay") return await relay(request, response);
    if (request.method === "POST" && request.url === "/api/relay/kill-switch") {
      if (!adminToken || request.headers.authorization !== `Bearer ${adminToken}`) return json(response, 401, { error: "Admin authorization required." });
      const payload = await body(request) as { enabled?: boolean };
      killSwitch = Boolean(payload.enabled);
      return json(response, 200, { killSwitch });
    }
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : "Relay request failed." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`M3 relayer listening on ${port}; kill switch ${killSwitch ? "on" : "off"}; daily cap ${dailyCap}`);
});

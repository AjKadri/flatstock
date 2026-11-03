import http from "node:http";
import { createPublicClient, createWalletClient, decodeFunctionData, fallback, http as viemHttp, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const host = process.env.M3_RELAYER_HOST || "127.0.0.1";
const port = Number(process.env.M3_RELAYER_PORT || 8787);
const publicRpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const quickNodeRpcUrl = process.env.QUICKNODE_RPC_URL?.trim();

const chain = defineChain({
  id: 4663,
  name: "Chain 4663",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [quickNodeRpcUrl || publicRpcUrl] } },
});

const voteContractAddress = (process.env.VOTE_CONTRACT_ADDRESS || "0x68d2622f3bbf6BE80CdfED679489de344410C7Db") as Address;

const addresses = {
  wif: "0x5173b8eA6923c2d40267890D45C46a3480954773" as Address,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  votes: voteContractAddress,
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
const allowedOrigin = process.env.M3_ALLOWED_ORIGIN || "https://app.flatstock.ajkadri.dev";

if (!relayerKey) throw new Error("M1_RELAYER_PRIVATE_KEY is required in the environment.");
if (!implementation) throw new Error("M1_7702_IMPLEMENTATION_ADDRESS is required in the environment.");

const account = privateKeyToAccount(relayerKey);
const readTransport = quickNodeRpcUrl
  ? fallback([viemHttp(quickNodeRpcUrl), viemHttp(publicRpcUrl)])
  : viemHttp(publicRpcUrl);
const publicClient = createPublicClient({ chain, transport: readTransport });
const walletClient = createWalletClient({ account, chain, transport: viemHttp(publicRpcUrl) });
const delegateAbi = parseAbi(["function executeBatch((address target, uint256 value, bytes data)[] calls)"]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const lockAbi = parseAbi(["function lock(uint256 amount)", "function unlock(uint256 amount)"]);
const votesAbi = parseAbi(["function vote(uint256 roundId, uint8 assetIndex)"]);
const routerAbi = parseAbi(["function buyUniswap(address sellToken, address buyToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96, uint256 gasWifAmount)"]);
const allowedTargets = new Set([addresses.wif.toLowerCase(), addresses.usdg.toLowerCase(), addresses.votes.toLowerCase(), addresses.lock.toLowerCase(), addresses.buyRouter.toLowerCase()]);
const usage = new Map<string, { day: string; count: number }>();
let killSwitch = initialKillSwitch;

type RpcResponse = { result?: unknown; error?: { code?: number; message?: string } };

async function quickNodeCall(method: string, params: unknown[]) {
  if (!quickNodeRpcUrl) throw new Error("QuickNode Stock Token API is not configured.");
  const response = await fetch(quickNodeRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json() as RpcResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `QuickNode request failed with HTTP ${response.status}.`);
  }
  return payload.result;
}

function csv(value: string | null) {
  return value ? value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : undefined;
}

function dayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
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

async function proxyRpc(request: http.IncomingMessage, response: http.ServerResponse) {
  const payload = await body(request);
  const upstreams = [quickNodeRpcUrl, publicRpcUrl].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  let lastError = "RPC proxy failed.";
  for (const upstream of upstreams) {
    try {
      const upstreamResponse = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await upstreamResponse.text();
      const result = JSON.parse(raw) as unknown;
      const hasRpcError = Array.isArray(result)
        ? result.some((item) => typeof item === "object" && item !== null && "error" in item)
        : typeof result === "object" && result !== null && "error" in result;
      if (!upstreamResponse.ok || hasRpcError) {
        lastError = `Upstream returned HTTP ${upstreamResponse.status}.`;
        continue;
      }
      return json(response, 200, result);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  return json(response, 502, { error: lastError });
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
  const origin = request.headers.origin;
  if (origin === allowedOrigin) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type,authorization,x-wallet");
    response.setHeader("vary", "Origin");
  } else if (origin) {
    return json(response, 403, { error: "Origin is not allowed." });
  }
  if (request.method === "OPTIONS") return json(response, 204, {});
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      const current = usage.get(request.headers["x-wallet"]?.toString().toLowerCase() || "");
      return json(response, 200, {
        enabled: true,
        killSwitch,
        dailyCap,
        usage: current?.day === dayKey() ? current.count : 0,
        relayer: account.address,
        quickNode: Boolean(quickNodeRpcUrl),
      });
    }
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "POST" && requestUrl.pathname === "/api/rpc") return await proxyRpc(request, response);
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/balances") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const wallet = requestUrl.searchParams.get("address");
      if (!wallet || !isAddress(wallet)) return json(response, 400, { error: "A valid address is required." });
      const symbols = csv(requestUrl.searchParams.get("symbols"));
      const result = await quickNodeCall("qn_getStockTokenBalances", [wallet, {
        ...(symbols ? { symbols } : {}),
        includeUsd: true,
        blockTag: "latest",
      }]);
      return json(response, 200, result);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/corporate-actions") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const symbols = csv(requestUrl.searchParams.get("symbols"));
      const result = await quickNodeCall("qn_getCorporateActions", [{
        ...(symbols ? { symbols } : {}),
        includeScheduled: true,
        limit: 50,
      }]);
      return json(response, 200, result);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/oracle-health") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const symbols = csv(requestUrl.searchParams.get("symbols"));
      const result = await quickNodeCall("qn_getOracleHealth", [{
        ...(symbols ? { symbols } : {}),
        blockTag: "latest",
      }]);
      return json(response, 200, result);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/finality") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const txHash = requestUrl.searchParams.get("txHash");
      if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json(response, 400, { error: "A valid transaction hash is required." });
      const result = await quickNodeCall("qn_getTransactionFinality", [txHash]);
      return json(response, 200, result);
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/relay") return await relay(request, response);
    if (request.method === "POST" && requestUrl.pathname === "/api/relay/kill-switch") {
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

server.listen(port, host, () => {
  console.log(`M3 relayer listening on ${host}:${port}; kill switch ${killSwitch ? "on" : "off"}; daily cap ${dailyCap}`);
});

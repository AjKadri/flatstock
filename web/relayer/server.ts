import http from "node:http";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  fallback,
  formatEther,
  http as viemHttp,
  isAddress,
  keccak256,
  parseAbi,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import {
  createSponsorshipGuard,
  DEFAULT_MIN_RELAYER_BALANCE_WEI,
  SPONSORSHIP_PAUSED_MESSAGE,
  SponsorshipPausedError,
} from "./sponsorship-guard.ts";
import { createPriceGuard, PriceGuardError, type OracleHealth } from "./price-guard.ts";
import { checkRpcPayload, RpcPolicyError } from "./rpc-policy.ts";
import { createRateLimiter } from "./rate-limit.ts";

const host = process.env.M3_RELAYER_HOST || "127.0.0.1";
const port = Number(process.env.M3_RELAYER_PORT || 8787);
const publicRpcUrl = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const quickNodeRpcUrl = process.env.QUICKNODE_RPC_URL?.trim();
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [quickNodeRpcUrl || publicRpcUrl] } },
});

const metaVotesAddress = (process.env.META_VOTES_ADDRESS || process.env.VOTE_CONTRACT_ADDRESS || "") as Address;
const metaRouterAddress = (process.env.META_ROUTER_ADDRESS || "") as Address;
const relayerKeyRaw = process.env.M1_RELAYER_PRIVATE_KEY;
const relayerKey = relayerKeyRaw
  ? (`0x${relayerKeyRaw.replace(/^0x/, "")}` as Hex)
  : undefined;
const dailyCap = Number(process.env.M3_DAILY_SPONSORED_TX_CAP || 3);
const initialKillSwitch = process.env.M3_RELAYER_KILL_SWITCH !== "0";
const adminToken = process.env.M3_RELAYER_ADMIN_TOKEN;
const allowedOrigin = process.env.M3_ALLOWED_ORIGIN || "https://app.flatstock.ajkadri.dev";

if (!relayerKey) throw new Error("M1_RELAYER_PRIVATE_KEY is required in the environment.");

const account = privateKeyToAccount(relayerKey);
const readTransport = quickNodeRpcUrl
  ? fallback([viemHttp(quickNodeRpcUrl), viemHttp(publicRpcUrl)])
  : viemHttp(publicRpcUrl);
const publicClient = createPublicClient({ chain, transport: readTransport });
const walletClient = createWalletClient({ account, chain, transport: readTransport });
// Stop sponsoring when the relayer's own ETH is below this (default 0.0003 ETH).
const minRelayerBalanceWei = process.env.M3_MIN_RELAYER_BALANCE_WEI
  ? BigInt(process.env.M3_MIN_RELAYER_BALANCE_WEI)
  : DEFAULT_MIN_RELAYER_BALANCE_WEI;
// Re-checks every signed buy / sell minimum against Chainlink before the relayer pays gas (fails closed).
const priceGuard = createPriceGuard({
  client: publicClient,
  getOracleHealth: async (symbols) => {
    if (!quickNodeRpcUrl) throw new PriceGuardError("The oracle health service is not configured, so this action was not relayed.");
    try {
      return await quickNodeCall("qn_getOracleHealth", [{ symbols, blockTag: "latest" }]) as OracleHealth;
    } catch {
      throw new PriceGuardError("The oracle health check is unavailable, so this action was not relayed. Try again later.");
    }
  },
});
// Limits for POST /api/rpc (per client IP; Caddy sets X-Forwarded-For).
const RPC_RATE_PER_MINUTE = Number(process.env.M3_RPC_RATE_PER_MINUTE || 600);
const RPC_BODY_LIMIT = 512 * 1024; // the price request is ~220 KB of hex; nothing legitimate is larger
const RELAY_BODY_LIMIT = 64 * 1024;
const MIN_LOG_BLOCK = BigInt(process.env.M3_RPC_MIN_LOG_BLOCK || "101593767"); // same as the app's VITE_STATS_FROM_BLOCK
const rpcLimiter = createRateLimiter({ limit: RPC_RATE_PER_MINUTE, windowMs: 60_000 });
const sponsorshipGuard = createSponsorshipGuard({
  getBalance: () => publicClient.getBalance({ address: account.address }),
  minBalanceWei: minRelayerBalanceWei,
});
const votesAbi = parseAbi([
  "function voteBySig(address voter, uint256 roundId, uint8 assetIndex, uint256 nonce, uint256 deadline, bytes signature)",
]);
const routerAbi = parseAbi([
  "function buyMixBySig(address user, (address token, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)[] legs, uint256 amountIn, uint256 nonce, uint256 deadline, (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) permitData, bytes signature) returns (uint256[] amountsOut)",
  "function sellBySig(address user, address sellToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96, uint256 nonce, uint256 deadline, bytes signature) returns (uint256 amountOut)",
  "function sellNonces(address user) view returns (uint256)",
]);
const permitAbi = parseAbi([
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function name() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
]);

const usage = new Map<string, { day: string; count: number }>();
let killSwitch = initialKillSwitch;
type RpcResponse = { result?: unknown; error?: { code?: number; message?: string } };

const metaLegComponents = [
  { name: "token", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "amountIn", type: "uint256" },
  { name: "amountOutMinimum", type: "uint256" },
  { name: "sqrtPriceLimitX96", type: "uint160" },
] as const;
const voteTypes = {
  Vote: [
    { name: "voter", type: "address" },
    { name: "roundId", type: "uint256" },
    { name: "assetIndex", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const buyTypes = {
  BuyMix: [
    { name: "user", type: "address" },
    { name: "legsHash", type: "bytes32" },
    { name: "amountIn", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const sellTypes = {
  SellStock: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const permitWindowSeconds = 5n * 60n;
// Stock Tokens enabled for sponsored sells. Same order as the app's asset list (round 5 has 8).
const stockTokenAddresses = new Set([
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", // AAPL
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", // NVDA
  "0xe93237c50d904957cf27e7b1133b510c669c2e74", // MSFT
  "0x12f190a9f9d7d37a250758b26824b97ce941bf54", // AMZN
  "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", // GOOGL
  "0xc0d6457c16cc70d6790dd43521c899c87ce02f35", // META
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d", // TSLA
  "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", // SPY (S&P 500 ETF)
]);
// Smallest buy the relayer will sponsor (USDG has 6 decimals). The app enforces the same minimum.
const MIN_SPONSORED_BUY = 5_000_000n;

async function quickNodeCall(method: string, params: unknown[]) {
  if (!quickNodeRpcUrl) throw new Error("QuickNode Stock Token API is not configured.");
  const response = await fetch(quickNodeRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json() as RpcResponse;
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `QuickNode request failed with HTTP ${response.status}.`);
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

async function body(request: http.IncomingMessage, maxBytes = RELAY_BODY_LIMIT) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > maxBytes) throw new RpcPolicyError("Request body is too large.", 413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += piece.length;
    if (size > maxBytes) throw new RpcPolicyError("Request body is too large.", 413);
    chunks.push(piece);
  }
  const data = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(data || "{}");
  } catch {
    throw new RpcPolicyError("Request body is not valid JSON.");
  }
}

// Client IP for rate limiting: the server listens on loopback behind Caddy, which appends the real client
// address to X-Forwarded-For, so the last entry is the one our proxy saw.
function clientIp(request: http.IncomingMessage) {
  const forwarded = request.headers["x-forwarded-for"]?.toString().split(",").map((item) => item.trim()).filter(Boolean);
  return forwarded?.[forwarded.length - 1] || request.socket.remoteAddress || "unknown";
}

function fail(message: string): never {
  throw new Error(message);
}

function requireAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) fail(`${label} must be a valid address.`);
  return value as Address;
}

function requireHex(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) fail(`${label} must be hex.`);
  return value as Hex;
}

function requireBytes32(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail(`${label} must be bytes32.`);
  return value as Hex;
}

function requireConfigured(address: Address, label: string): asserts address is Address {
  if (!address || !isAddress(address)) fail(`${label} is not configured.`);
}

async function requireBudget(user: Address, requestedTransactions = 1) {
  if (killSwitch) fail("Signature relay is paused by the kill switch.");
  await sponsorshipGuard.assertAvailable();
  const today = dayKey();
  const current = usage.get(user.toLowerCase());
  const entry = current?.day === today ? current : { day: today, count: 0 };
  if (entry.count + requestedTransactions > dailyCap) fail("Daily sponsored transaction cap reached.");
  return { today, entry };
}

function recordSponsoredTransaction(user: Address, today: string) {
  const current = usage.get(user.toLowerCase());
  const count = current?.day === today ? current.count : 0;
  usage.set(user.toLowerCase(), { day: today, count: count + 1 });
  sponsorshipGuard.invalidate();
}

async function relayVote(payload: Record<string, unknown>) {
  requireConfigured(metaVotesAddress, "META_VOTES_ADDRESS");
  const voter = requireAddress(payload.voter, "voter");
  const roundId = BigInt(String(payload.roundId));
  const assetIndex = Number(payload.assetIndex);
  const nonce = BigInt(String(payload.nonce));
  const deadline = BigInt(String(payload.deadline));
  const signature = requireHex(payload.signature, "signature");
  const { today } = await requireBudget(voter);
  const valid = await verifyTypedData({
    address: voter,
    domain: { name: "Flatstock Votes", version: "1", chainId: 4663, verifyingContract: metaVotesAddress },
    types: voteTypes,
    primaryType: "Vote",
    message: { voter, roundId, assetIndex, nonce, deadline },
    signature,
  });
  if (!valid) fail("Vote signature is invalid.");
  const txHash = await walletClient.writeContract({
    address: metaVotesAddress,
    abi: votesAbi,
    functionName: "voteBySig",
    args: [voter, roundId, assetIndex, nonce, deadline, signature],
  });
  recordSponsoredTransaction(voter, today);
  return { txHash, day: today, usage: usage.get(voter.toLowerCase())?.count || 0, dailyCap };
}

function parseLegs(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) fail("Buy plan must contain 1 to 8 legs.");
  const legs = value.map((item) => {
    if (!item || typeof item !== "object") fail("Invalid buy leg.");
    const raw = item as Record<string, unknown>;
    const token = requireAddress(raw.token, "buy leg token");
    const fee = Number(raw.fee);
    const amountIn = BigInt(String(raw.amountIn));
    const amountOutMinimum = BigInt(String(raw.amountOutMinimum));
    const sqrtPriceLimitX96 = BigInt(String(raw.sqrtPriceLimitX96 || "0"));
    if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000 || amountIn <= 0n || amountOutMinimum <= 0n) fail("Invalid buy leg guard.");
    return { token, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96 };
  });
  return legs;
}

async function relayBuy(payload: Record<string, unknown>) {
  requireConfigured(metaRouterAddress, "META_ROUTER_ADDRESS");
  const user = requireAddress(payload.user, "user");
  const legs = parseLegs(payload.legs);
  const amountIn = BigInt(String(payload.amountIn));
  const nonce = BigInt(String(payload.nonce));
  const deadline = BigInt(String(payload.deadline));
  const signature = requireHex(payload.signature, "signature");
  const total = legs.reduce((sum, leg) => sum + leg.amountIn, 0n);
  if (total !== amountIn) fail("Buy amount does not match the signed legs.");
  if (amountIn < MIN_SPONSORED_BUY) fail("Minimum buy is 5 USDG.");
  const legsHash = keccak256(encodeAbiParameters([{ type: "tuple[]", components: metaLegComponents }], [legs]));
  const { today } = await requireBudget(user);
  const valid = await verifyTypedData({
    address: user,
    domain: { name: "Flatstock Trades", version: "1", chainId: 4663, verifyingContract: metaRouterAddress },
    types: buyTypes,
    primaryType: "BuyMix",
    message: { user, legsHash, amountIn, nonce, deadline },
    signature,
  });
  if (!valid) fail("Buy signature is invalid.");
  await priceGuard.assertBuyLegs(legs); // each signed minimum within 2% of Chainlink, or refuse
  const rawPermit = (payload.permit || {}) as Record<string, unknown>;
  const permit = {
    value: BigInt(String(rawPermit.value || "0")),
    deadline: BigInt(String(rawPermit.deadline || "0")),
    v: Number(rawPermit.v || 0),
    r: (rawPermit.r || "0x0000000000000000000000000000000000000000000000000000000000000000") as Hex,
    s: (rawPermit.s || "0x0000000000000000000000000000000000000000000000000000000000000000") as Hex,
  };
  const txHash = await walletClient.writeContract({
    address: metaRouterAddress,
    abi: routerAbi,
    functionName: "buyMixBySig",
    args: [user, legs, amountIn, nonce, deadline, permit, signature],
  });
  recordSponsoredTransaction(user, today);
  return { txHash, day: today, usage: usage.get(user.toLowerCase())?.count || 0, dailyCap };
}

async function relaySell(payload: Record<string, unknown>) {
  requireConfigured(metaRouterAddress, "META_ROUTER_ADDRESS");
  const user = requireAddress(payload.user, "user");
  const sellToken = requireAddress(payload.sellToken, "sellToken");
  const fee = Number(payload.fee);
  const amountIn = BigInt(String(payload.amountIn));
  const amountOutMinimum = BigInt(String(payload.amountOutMinimum));
  const sqrtPriceLimitX96 = BigInt(String(payload.sqrtPriceLimitX96 || "0"));
  const nonce = BigInt(String(payload.nonce));
  const deadline = BigInt(String(payload.deadline));
  const signature = requireHex(payload.signature, "signature");
  if (!Number.isInteger(fee) || amountIn <= 0n || amountOutMinimum <= 0n) fail("Invalid sell guard.");
  if (sqrtPriceLimitX96 !== 0n) fail("Sell price limit must be zero for the deployed signature format.");
  if (!stockTokenAddresses.has(sellToken.toLowerCase())) fail("Sell token is not an enabled Stock Token.");
  if (!payload.permit || typeof payload.permit !== "object") fail("An exact Stock Token permit is required for a relayed sell.");
  const rawPermit = payload.permit as Record<string, unknown>;
  const permitValue = BigInt(String(rawPermit.value));
  const permitNonce = BigInt(String(rawPermit.nonce));
  const permitDeadline = BigInt(String(rawPermit.deadline));
  const permitV = Number(rawPermit.v);
  const permitR = requireBytes32(rawPermit.r, "permit.r");
  const permitS = requireBytes32(rawPermit.s, "permit.s");
  if (permitValue !== amountIn || permitDeadline !== deadline) fail("Sell permit must match the exact sell amount and deadline.");
  if (!Number.isInteger(permitV) || (permitV !== 27 && permitV !== 28)) fail("Invalid permit signature.");
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  if (deadline <= latest.timestamp || deadline > latest.timestamp + permitWindowSeconds) fail("Sell permit deadline must be within 5 minutes.");
  const { today } = await requireBudget(user, 2);
  const [sellNonceOnChain, permitNonceOnChain, tokenName] = await Promise.all([
    publicClient.readContract({ address: metaRouterAddress, abi: routerAbi, functionName: "sellNonces", args: [user] }) as Promise<bigint>,
    publicClient.readContract({ address: sellToken, abi: permitAbi, functionName: "nonces", args: [user] }) as Promise<bigint>,
    publicClient.readContract({ address: sellToken, abi: permitAbi, functionName: "name" }) as Promise<string>,
  ]);
  if (nonce !== sellNonceOnChain) fail("Sell nonce is stale.");
  if (permitNonce !== permitNonceOnChain) fail("Stock Token permit nonce is stale.");
  const valid = await verifyTypedData({
    address: user,
    domain: { name: "Flatstock Trades", version: "1", chainId: 4663, verifyingContract: metaRouterAddress },
    types: sellTypes,
    primaryType: "SellStock",
    message: { user, token: sellToken, fee, amountIn, amountOutMinimum, nonce, deadline },
    signature,
  });
  if (!valid) fail("Sell signature is invalid.");
  const permitSignature = `0x${permitR.slice(2)}${permitS.slice(2)}${permitV.toString(16).padStart(2, "0")}` as Hex;
  const permitValid = await verifyTypedData({
    address: user,
    domain: { name: tokenName, version: "1", chainId: 4663, verifyingContract: sellToken },
    types: permitTypes,
    primaryType: "Permit",
    message: { owner: user, spender: metaRouterAddress, value: permitValue, nonce: permitNonce, deadline: permitDeadline },
    signature: permitSignature,
  });
  if (!permitValid) fail("Stock Token permit signature is invalid.");
  await priceGuard.assertSell(sellToken, amountIn, amountOutMinimum); // before any gas is spent on the permit

  const permitTxHash = await walletClient.writeContract({
    address: sellToken,
    abi: permitAbi,
    functionName: "permit",
    args: [user, metaRouterAddress, permitValue, permitDeadline, permitV, permitR, permitS],
  });
  recordSponsoredTransaction(user, today);
  const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitTxHash });
  if (permitReceipt.status !== "success") fail("Stock Token permit transaction reverted.");

  const txHash = await walletClient.writeContract({
    address: metaRouterAddress,
    abi: routerAbi,
    functionName: "sellBySig",
    args: [user, sellToken, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96, nonce, deadline, signature],
  });
  recordSponsoredTransaction(user, today);
  const sellReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (sellReceipt.status !== "success") fail("Sell transaction reverted after the exact permit was accepted.");
  return { txHash, permitTxHash, day: today, usage: usage.get(user.toLowerCase())?.count || 0, dailyCap };
}

let latestBlockCache: { value: bigint; at: number } | null = null;
async function latestBlockNumber() {
  if (latestBlockCache && Date.now() - latestBlockCache.at < 2_000) return latestBlockCache.value;
  const value = await publicClient.getBlockNumber();
  latestBlockCache = { value, at: Date.now() };
  return value;
}

async function proxyRpc(request: http.IncomingMessage, response: http.ServerResponse) {
  const wait = rpcLimiter.take(clientIp(request));
  if (wait > 0) {
    response.setHeader("retry-after", String(wait));
    return json(response, 429, { error: "Too many requests. Try again in a moment." });
  }
  const payload = await body(request, RPC_BODY_LIMIT);
  await checkRpcPayload(payload, latestBlockNumber, MIN_LOG_BLOCK);
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
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      const current = usage.get(request.headers["x-wallet"]?.toString().toLowerCase() || "");
      const sponsorship = await sponsorshipGuard.status();
      return json(response, 200, {
        enabled: true,
        killSwitch,
        sponsorshipPaused: sponsorship.paused,
        sponsorshipPausedReason: sponsorship.reason,
        relayerBalanceEth: sponsorship.balanceWei === null ? null : formatEther(sponsorship.balanceWei),
        minRelayerBalanceEth: formatEther(sponsorship.minBalanceWei),
        dailyCap,
        usage: current?.day === dayKey() ? current.count : 0,
        relayer: account.address,
        quickNode: Boolean(quickNodeRpcUrl),
        signatureRelay: Boolean(metaVotesAddress && metaRouterAddress),
      });
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/rpc") return await proxyRpc(request, response);
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/balances") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const wallet = requestUrl.searchParams.get("address");
      if (!wallet || !isAddress(wallet)) return json(response, 400, { error: "A valid address is required." });
      const symbols = csv(requestUrl.searchParams.get("symbols"));
      return json(response, 200, await quickNodeCall("qn_getStockTokenBalances", [wallet, { ...(symbols ? { symbols } : {}), includeUsd: true, blockTag: "latest" }]));
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/corporate-actions") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const symbols = csv(requestUrl.searchParams.get("symbols"));
      return json(response, 200, await quickNodeCall("qn_getCorporateActions", [{ ...(symbols ? { symbols } : {}), includeScheduled: true, limit: 50 }]));
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/oracle-health") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const symbols = csv(requestUrl.searchParams.get("symbols"));
      return json(response, 200, await quickNodeCall("qn_getOracleHealth", [{ ...(symbols ? { symbols } : {}), blockTag: "latest" }]));
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/stock-token/finality") {
      if (!quickNodeRpcUrl) return json(response, 503, { error: "QuickNode Stock Token API is not configured." });
      const txHash = requestUrl.searchParams.get("txHash");
      if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return json(response, 400, { error: "A valid transaction hash is required." });
      return json(response, 200, await quickNodeCall("qn_getTransactionFinality", [txHash]));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/relay") {
      return json(response, 410, { error: "The legacy EIP-7702 relay was removed. Sign the exact action instead." });
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/meta/vote") return json(response, 200, await relayVote(await body(request)));
    if (request.method === "POST" && requestUrl.pathname === "/api/meta/buy") return json(response, 200, await relayBuy(await body(request)));
    if (request.method === "POST" && requestUrl.pathname === "/api/meta/sell") return json(response, 200, await relaySell(await body(request)));
    if (request.method === "POST" && requestUrl.pathname === "/api/relay/kill-switch") {
      if (!adminToken || request.headers.authorization !== `Bearer ${adminToken}`) return json(response, 401, { error: "Admin authorization required." });
      const payload = await body(request) as { enabled?: boolean };
      killSwitch = Boolean(payload.enabled);
      return json(response, 200, { killSwitch });
    }
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof RpcPolicyError) return json(response, error.status, { error: error.message });
    if (error instanceof SponsorshipPausedError) {
      return json(response, 503, { error: SPONSORSHIP_PAUSED_MESSAGE, code: "SPONSORSHIP_PAUSED", reason: error.status.reason });
    }
    return json(response, 400, { error: error instanceof Error ? error.message : "Relay request failed." });
  }
});

server.listen(port, host, () => {
  console.log(`Signature relayer listening on ${host}:${port}; kill switch ${killSwitch ? "on" : "off"}; daily cap ${dailyCap}; min relayer balance ${formatEther(minRelayerBalanceWei)} ETH`);
});

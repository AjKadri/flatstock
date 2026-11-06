// What POST /api/rpc will forward. The app only needs a handful of read methods; everything else
// (eth_sendRawTransaction, debug_*, trace_*, admin_*, personal_*, eth_sign*, subscriptions, state overrides)
// is refused so the proxy cannot be used to spend the paid RPC quota on anything else or to send transactions.

export const ALLOWED_RPC_METHODS = new Set([
  "eth_call",
  "eth_getLogs",
  "eth_blockNumber",
  "eth_chainId",
  "net_version",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBalance",
  "eth_getCode",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTransactionCount",
]);

// Contracts whose logs the app reads: current and retired vote contracts, the router and the old buy router.
export const LOG_ADDRESSES = new Set([
  "0x4bb945800d588e6b4db287b3fce9c13f7825a968", // FlatstockVotes
  "0xedb1fc3e26a53a2cc023e131a2d6c4b6f526b8e9", // retired vote contract 1
  "0xd49249d2a5cffbcf35b6560857d1d1c703802e78", // retired vote contract 2
  "0x68d2622f3bbf6be80cdfed679489de344410c7db", // retired vote contract 3
  "0x8799a2ef390de8b0ef97919c7e040c44ddfadbe7", // FlatstockRouter
  "0x5b08a91f8c8666c85e636bbe61aed3b059b61ffa", // legacy buy router
]);

export const MAX_BATCH = 20; // calls in one JSON-RPC batch
export const MAX_PARAMS = 3;
export const MAX_LOG_BLOCK_RANGE = 25_000_000n; // blocks per eth_getLogs (the app reads from its start block to latest)
export const MAX_LOG_TOPICS = 4;

export class RpcPolicyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const HEX_QUANTITY = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const BLOCK_TAGS = new Set(["latest", "safe", "finalized", "pending", "earliest"]);

function reject(message: string): never {
  throw new RpcPolicyError(message);
}

function parseBlock(value: unknown, label: string): bigint | "latest" {
  if (value === undefined || value === null || value === "latest" || value === "pending" || value === "safe" || value === "finalized") return "latest";
  if (typeof value === "string" && HEX_QUANTITY.test(value)) return BigInt(value);
  return reject(`eth_getLogs ${label} must be a hex block number or "latest".`);
}

// Checks one JSON-RPC call. `latestBlock` is only needed for eth_getLogs (to bound "latest").
export function checkCall(call: unknown, latestBlock: () => Promise<bigint>, minLogBlock: bigint): Promise<void> | void {
  if (!call || typeof call !== "object" || Array.isArray(call)) return reject("Each RPC call must be a JSON object.");
  const { method, params } = call as { method?: unknown; params?: unknown };
  if (typeof method !== "string" || !ALLOWED_RPC_METHODS.has(method)) return reject(`RPC method not allowed: ${typeof method === "string" ? method.slice(0, 64) : "invalid"}.`);
  if (params !== undefined && (!Array.isArray(params) || params.length > MAX_PARAMS)) return reject("RPC params must be an array of at most 3 items.");
  const list = (params ?? []) as unknown[];
  if (method === "eth_call" || method === "eth_estimateGas") {
    if (list.length > 2) return reject(`${method} does not accept state overrides.`);
    if (!list[0] || typeof list[0] !== "object") return reject(`${method} needs a transaction object.`);
  }
  if (method !== "eth_getLogs") return;
  const filter = list[0];
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return reject("eth_getLogs needs a filter object.");
  const { address, fromBlock, toBlock, topics, blockHash } = filter as Record<string, unknown>;
  if (blockHash !== undefined) return reject("eth_getLogs by blockHash is not allowed.");
  const addresses = typeof address === "string" ? [address] : Array.isArray(address) ? address : null;
  if (!addresses || addresses.length === 0 || addresses.length > 8) return reject("eth_getLogs needs one or more Flatstock contract addresses.");
  for (const item of addresses) {
    if (typeof item !== "string" || !LOG_ADDRESSES.has(item.toLowerCase())) return reject("eth_getLogs is only allowed for Flatstock contracts.");
  }
  if (topics !== undefined && (!Array.isArray(topics) || topics.length > MAX_LOG_TOPICS)) return reject("eth_getLogs topics are invalid.");
  if (fromBlock === "earliest") return reject("eth_getLogs cannot start at the earliest block.");
  const from = parseBlock(fromBlock, "fromBlock");
  const to = parseBlock(toBlock, "toBlock");
  return (async () => {
    const latest = from === "latest" || to === "latest" ? await latestBlock() : 0n;
    const start = from === "latest" ? latest : from;
    const end = to === "latest" ? latest : to;
    if (start < minLogBlock) reject("eth_getLogs starts before Flatstock's first block.");
    if (end < start) reject("eth_getLogs block range is reversed.");
    if (end - start > MAX_LOG_BLOCK_RANGE) reject("eth_getLogs block range is too large.");
  })();
}

// Validates a whole request body (single call or batch).
export async function checkRpcPayload(payload: unknown, latestBlock: () => Promise<bigint>, minLogBlock: bigint): Promise<void> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return reject("Empty RPC batch.");
    if (payload.length > MAX_BATCH) return reject(`RPC batch is too large (max ${MAX_BATCH}).`);
    for (const call of payload) await checkCall(call, latestBlock, minLogBlock);
    return;
  }
  await checkCall(payload, latestBlock, minLogBlock);
}

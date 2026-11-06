import assert from "node:assert/strict";
import test from "node:test";
import { checkRpcPayload, MAX_BATCH, RpcPolicyError } from "./rpc-policy.ts";
import { createRateLimiter } from "./rate-limit.ts";

const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968";
const MIN = 101_593_767n;
const latest = async () => 107_600_000n;
const call = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });
const ok = (payload: unknown) => checkRpcPayload(payload, latest, MIN);
const bad = (payload: unknown, pattern: RegExp) => assert.rejects(ok(payload), (e: unknown) => e instanceof RpcPolicyError && pattern.test(e.message));

test("allows the read methods the app uses", async () => {
  for (const m of ["eth_blockNumber", "eth_chainId", "eth_getTransactionReceipt", "eth_getBalance", "eth_getBlockByNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getCode", "net_version", "eth_estimateGas"]) {
    await ok(call(m, m === "eth_estimateGas" ? [{ to: VOTES }] : []));
  }
  await ok(call("eth_call", [{ to: VOTES, data: "0x" }, "latest"]));
});

test("rejects sending and every other method", async () => {
  for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign", "debug_traceTransaction", "trace_call", "admin_peers", "eth_subscribe", "eth_newFilter", "eth_getStorageAt", "eth_accounts", "anvil_setBalance", "qn_getStockTokenBalances"]) {
    await bad(call(m, ["0x00"]), /method not allowed/);
  }
  await bad({ jsonrpc: "2.0", id: 1, params: [] }, /method not allowed/);
  await bad(call("eth_call", [{ to: VOTES }, "latest", { "0x00": { balance: "0x1" } }]), /state overrides/);
  await bad("eth_call", /JSON object/);
});

test("batches: bounded, and one bad call rejects the batch", async () => {
  await ok(Array.from({ length: MAX_BATCH }, () => call("eth_blockNumber")));
  await bad(Array.from({ length: MAX_BATCH + 1 }, () => call("eth_blockNumber")), /too large/);
  await bad([], /Empty/);
  await bad([call("eth_blockNumber"), call("eth_sendRawTransaction", ["0x"])], /not allowed/);
});

test("eth_getLogs: only Flatstock contracts and a bounded range", async () => {
  await ok(call("eth_getLogs", [{ address: VOTES, fromBlock: "0x" + MIN.toString(16), toBlock: "latest", topics: ["0x00"] }]));
  await ok(call("eth_getLogs", [{ address: [VOTES.toLowerCase()], fromBlock: "0x" + (107_000_000n).toString(16), toBlock: "0x" + (107_500_000n).toString(16) }]));
  await bad(call("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0x2" }]), /contract addresses/); // no address = whole chain
  await bad(call("eth_getLogs", [{ address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", fromBlock: "0x" + MIN.toString(16) }]), /only allowed for Flatstock/);
  await bad(call("eth_getLogs", [{ address: VOTES, fromBlock: "0x1", toBlock: "latest" }]), /before Flatstock/);
  await bad(call("eth_getLogs", [{ address: VOTES, fromBlock: "earliest", toBlock: "latest" }]), /earliest/);
  await bad(call("eth_getLogs", [{ address: VOTES, fromBlock: "0x" + MIN.toString(16), toBlock: "0x" + (MIN + 26_000_000n).toString(16) }]), /too large/);
  await bad(call("eth_getLogs", [{ address: VOTES, fromBlock: "0x" + (107_500_000n).toString(16), toBlock: "0x" + (107_000_000n).toString(16) }]), /reversed/);
  await bad(call("eth_getLogs", [{ address: VOTES, blockHash: "0x" + "00".repeat(32) }]), /blockHash/);
  await bad(call("eth_getLogs", [{ address: VOTES, fromBlock: "banana" }]), /hex block number/);
});

test("rate limiter: allows the limit, then 429-style waits, then resets", () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
  assert.deepEqual([limiter.take("a"), limiter.take("a"), limiter.take("a")], [0, 0, 0]);
  assert.ok(limiter.take("a") > 0);
  assert.equal(limiter.take("b"), 0); // other client unaffected
  t = 60_001;
  assert.equal(limiter.take("a"), 0);
});

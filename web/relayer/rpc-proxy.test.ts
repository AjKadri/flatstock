// End-to-end test of the real server: starts relayer/server.ts against a stub upstream RPC, with a throwaway
// key, and checks what POST /api/rpc forwards or refuses. No network, no real chain.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

const VOTES = "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968";
const seen: { method?: string }[] = [];
let upstream: http.Server;
let child: ChildProcess;
let base = "";

before(async () => {
  upstream = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(data);
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of calls) seen.push({ method: c.method });
      const answer = (c: { id: unknown; method: string }) => ({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_blockNumber" ? "0x" + (107_600_000).toString(16) : "0x1" });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["relayer/server.ts"], {
    env: {
      PATH: process.env.PATH,
      M1_RELAYER_PRIVATE_KEY: "0x" + "11".repeat(32), // throwaway key, never funded
      RPC_URL: `http://127.0.0.1:${upstreamPort}`,
      M3_RELAYER_PORT: String(port),
      M3_RPC_RATE_PER_MINUTE: "8",
    },
    stdio: "pipe",
  });
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(base + "/api/health", { signal: AbortSignal.timeout(300) }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
after(() => { child?.kill(); upstream?.close(); });

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  fetch(base + "/api/rpc", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
const call = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });

test("forwards allowed reads (single and batch)", async () => {
  const single = await post(call("eth_chainId"), { "x-forwarded-for": "10.0.0.1" });
  assert.equal(single.status, 200);
  const batch = await post([call("eth_blockNumber"), call("eth_chainId")], { "x-forwarded-for": "10.0.0.1" });
  assert.equal(batch.status, 200);
  assert.equal(((await batch.json()) as unknown[]).length, 2);
});

test("refuses eth_sendRawTransaction and never forwards it", async () => {
  const before = seen.length;
  const r = await post(call("eth_sendRawTransaction", ["0xdeadbeef"]), { "x-forwarded-for": "10.0.0.2" });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /not allowed/);
  const b = await post([call("eth_blockNumber"), call("eth_sendRawTransaction", ["0x00"])], { "x-forwarded-for": "10.0.0.2" });
  assert.equal(b.status, 400);
  assert.equal(seen.length, before, "nothing reached the upstream RPC");
  assert.ok(!seen.some((s) => s.method === "eth_sendRawTransaction"));
});

test("bounds eth_getLogs (contract list and range) and batch size", async () => {
  const headers = { "x-forwarded-for": "10.0.0.3" };
  assert.equal((await post(call("eth_getLogs", [{ address: VOTES, fromBlock: "0x" + (101_593_767).toString(16), toBlock: "latest" }]), headers)).status, 200);
  assert.equal((await post(call("eth_getLogs", [{ fromBlock: "0x1", toBlock: "latest" }]), headers)).status, 400);
  assert.equal((await post(Array.from({ length: 21 }, () => call("eth_blockNumber")), headers)).status, 400);
});

test("body limit: oversized requests get 413", async () => {
  const big = JSON.stringify(call("eth_call", [{ to: VOTES, data: "0x" + "00".repeat(300 * 1024) }, "latest"]));
  const r = await post(big, { "x-forwarded-for": "10.0.0.4" });
  assert.equal(r.status, 413);
  assert.equal((await post("{not json", { "x-forwarded-for": "10.0.0.4" })).status, 400);
});

test("a realistic price request (~220 KB multicall) still passes the body limit", async () => {
  const data = "0x" + "ab".repeat(110 * 1024);
  const r = await post(call("eth_call", [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11", data }, "latest"]), { "x-forwarded-for": "10.0.0.5" });
  assert.equal(r.status, 200);
});

test("per-IP rate limit returns 429 with Retry-After; other IPs are unaffected", async () => {
  const headers = { "x-forwarded-for": "10.0.0.9" };
  const codes: number[] = [];
  for (let i = 0; i < 10; i += 1) codes.push((await post(call("eth_chainId"), headers)).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(200));
  assert.deepEqual(codes.slice(8), [429, 429]);
  const limited = await post(call("eth_chainId"), headers);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal((await post(call("eth_chainId"), { "x-forwarded-for": "10.0.0.10" })).status, 200);
});

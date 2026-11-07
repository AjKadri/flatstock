// Failover between GetBlock, QuickNode and the public RPC. Unit tests use a fake fetch; the end-to-end test starts
// the real server with GETBLOCK_RPC_URL pointing at a dead port and checks reads still work and /api/health says so.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { buildProviders, createProviderPool, ProvidersFailedError } from "./rpc-providers.ts";

const GB = "https://getblock.invalid/secret-key-gb";
const QN = "https://quicknode.invalid/secret-key-qn";
const PUB = "https://public.invalid";
const providers = buildProviders({ GETBLOCK_RPC_URL: GB, QUICKNODE_RPC_URL: QN }, PUB);
import { isProviderAuthError } from "./rpc-providers.ts";
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const payload = { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] };

function fakeFetch(behaviour: Record<string, "ok" | "down" | "401" | "403" | "404" | "429" | "500" | "hang" | "rpcerror" | "badkey" | "badkeyrpc">) {
  const calls: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const mode = behaviour[url];
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "401") return new Response("unauthorized", { status: 401 });
    if (mode === "403") return new Response("forbidden", { status: 403 });
    if (mode === "404") return new Response("not found", { status: 404 });
    if (mode === "badkey") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Invalid API key" } }), { status: 200 });
    if (mode === "badkeyrpc") return new Response(JSON.stringify([{ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "request rejected" } }]), { status: 200 });
    if (mode === "429") return new Response("rate limited", { status: 429 });
    if (mode === "500") return new Response("oops", { status: 500 });
    if (mode === "rpcerror") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } }), { status: 200 });
    if (mode === "hang") return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout"))));
    return ok("0x1237");
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("order is GetBlock, QuickNode, public; absent ones are left out", () => {
  assert.deepEqual(providers.map((p) => p.name), ["getblock", "quicknode", "public"]);
  assert.deepEqual(buildProviders({ QUICKNODE_RPC_URL: QN }, PUB).map((p) => p.name), ["quicknode", "public"]);
  assert.deepEqual(buildProviders({}, PUB).map((p) => p.name), ["public"]);
});

test("general reads go to GetBlock first", async () => {
  const { impl, calls } = fakeFetch({ [GB]: "ok", [QN]: "ok", [PUB]: "ok" });
  const out = await createProviderPool({ providers, fetchImpl: impl }).forward(payload);
  assert.equal(out.provider, "getblock");
  assert.deepEqual(calls, [GB]);
});

test("GetBlock down (network error, 429, 500, timeout) falls back to QuickNode", async () => {
  for (const mode of ["down", "429", "500", "hang"] as const) {
    const { impl, calls } = fakeFetch({ [GB]: mode, [QN]: "ok", [PUB]: "ok" });
    const out = await createProviderPool({ providers, fetchImpl: impl, timeoutMs: 50 }).forward(payload);
    assert.equal(out.provider, "quicknode", mode);
    assert.deepEqual(calls, [GB, QN], mode);
  }
});

test("the reverse: QuickNode down, GetBlock serves; both down, public serves; all down fails with no URL in the message", async () => {
  let { impl } = fakeFetch({ [GB]: "ok", [QN]: "down", [PUB]: "ok" });
  assert.equal((await createProviderPool({ providers, fetchImpl: impl }).forward(payload)).provider, "getblock");
  ({ impl } = fakeFetch({ [GB]: "down", [QN]: "429", [PUB]: "ok" }));
  assert.equal((await createProviderPool({ providers, fetchImpl: impl }).forward(payload)).provider, "public");
  ({ impl } = fakeFetch({ [GB]: "down", [QN]: "down", [PUB]: "500" }));
  await assert.rejects(createProviderPool({ providers, fetchImpl: impl }).forward(payload), (e: unknown) => {
    assert.ok(e instanceof ProvidersFailedError);
    assert.doesNotMatch(e.message, /secret-key|invalid|https?:/);
    return true;
  });
});

test("a failed provider is skipped during its cool-down, then tried again", async () => {
  let t = 1_000;
  const behaviour: Record<string, "ok" | "down"> = { [GB]: "down", [QN]: "ok", [PUB]: "ok" };
  const { impl, calls } = fakeFetch(behaviour);
  const pool = createProviderPool({ providers, fetchImpl: impl, cooldownMs: 30_000, now: () => t });
  await pool.forward(payload); // GetBlock fails, QuickNode serves
  calls.length = 0;
  await pool.forward(payload); // GetBlock is cooling down: not even tried first
  assert.deepEqual(calls, [QN]);
  behaviour[GB] = "ok";
  t += 31_000;
  calls.length = 0;
  assert.equal((await pool.forward(payload)).provider, "getblock");
});

test("health reports each provider and is false when GetBlock is down or not configured", async () => {
  const { impl } = fakeFetch({ [GB]: "down", [QN]: "ok", [PUB]: "ok" });
  const health = await createProviderPool({ providers, fetchImpl: impl }).health();
  assert.deepEqual(health, { getblock: false, quicknode: true, public: true });
  const none = await createProviderPool({ providers: buildProviders({}, PUB), fetchImpl: impl }).health();
  assert.equal(none.getblock, false);
});

test("end to end: real server with a dead GetBlock URL still serves reads and reports getblock:false", async () => {
  const stub = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const c = JSON.parse(data);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: c.id, result: c.method === "eth_chainId" ? "0x1237" : "0x1" }));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubPort = (stub.address() as AddressInfo).port;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(process.execPath, ["relayer/server.ts"], {
    env: {
      PATH: process.env.PATH,
      M1_RELAYER_PRIVATE_KEY: "0x" + "11".repeat(32), // throwaway key, never funded
      GETBLOCK_RPC_URL: "http://127.0.0.1:9/dead", // bad URL: nothing listens on port 9
      QUICKNODE_RPC_URL: `http://127.0.0.1:${stubPort}`,
      RPC_URL: `http://127.0.0.1:${stubPort}`,
      M3_RELAYER_PORT: String(port),
    },
    stdio: "pipe",
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(base + "/api/health", { signal: AbortSignal.timeout(300) }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const rpc = await fetch(base + "/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(rpc.status, 200);
    assert.equal(((await rpc.json()) as { result: string }).result, "0x1237");
    const health = (await (await fetch(base + "/api/health")).json()) as { getblock: boolean; quickNode: boolean; rpcProviders: Record<string, boolean> };
    assert.equal(health.getblock, false);
    assert.equal(health.rpcProviders.quicknode, true);
    assert.doesNotMatch(JSON.stringify(health), /127\.0\.0\.1:9|dead/, "health must not leak provider URLs");
  } finally {
    child.kill();
    stub.close();
  }
});

test("a revoked or rotated GetBlock URL (401, 403, 404, or an RPC 'invalid key' error) falls back to QuickNode", async () => {
  for (const mode of ["401", "403", "404", "badkey", "badkeyrpc"] as const) {
    const { impl, calls } = fakeFetch({ [GB]: mode, [QN]: "ok", [PUB]: "ok" });
    const pool = createProviderPool({ providers, fetchImpl: impl });
    assert.equal((await pool.forward(payload)).provider, "quicknode", mode);
    calls.length = 0;
    await pool.forward(payload); // GetBlock is now skipped for the cool-down
    assert.deepEqual(calls, [QN], mode);
    assert.equal((await pool.health()).getblock, false, mode);
  }
});

test("ordinary RPC errors (revert, bad params) are not mistaken for auth failures", () => {
  assert.equal(isProviderAuthError({ error: { code: 3, message: "execution reverted" } }), false);
  assert.equal(isProviderAuthError({ error: { code: -32602, message: "invalid argument 0: hex string without 0x prefix" } }), false);
  assert.equal(isProviderAuthError({ error: { code: -32000, message: "nonce too low" } }), false);
  assert.equal(isProviderAuthError({ result: "0x1" }), false);
  assert.equal(isProviderAuthError({ error: { code: -32000, message: "API key is invalid" } }), true);
});

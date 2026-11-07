// A relayed write must not report a false failure. Provider A accepts the broadcast then times out; provider B
// answers "already known". The sender must return the tx hash (it is on chain), never an error, and never sign twice.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after } from "node:test";
import { createPublicClient, createWalletClient, defineChain, fallback, http as viemHttp, keccak256, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRelayedSender } from "./safe-send.ts";

const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:1"] } } });
const account = privateKeyToAccount(("0x" + "22".repeat(32)) as Hex); // throwaway key
const abi = parseAbi(["function voteBySig(address voter, uint256 roundId, uint8 assetIndex, uint256 nonce, uint256 deadline, bytes signature)"]);
const args = [account.address, 4n, 1, 0n, 9_999_999_999n, "0x1234"] as const;

type World = { broadcasts: Hex[]; landed: Set<string> };
const servers: http.Server[] = [];

// A stub node. `send` decides what eth_sendRawTransaction does; every other call is answered like a healthy node.
async function node(world: World, send: "accept-then-hang" | "already-known" | "reject", knowsLanded: boolean) {
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const call = JSON.parse(data) as { id: number; method: string; params: unknown[] };
      const reply = (result: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result })); };
      const error = (code: number, message: string) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code, message } })); };
      switch (call.method) {
        case "eth_chainId": return reply("0x1237");
        case "eth_getTransactionCount": return reply("0x7");
        case "eth_estimateGas": return reply("0x30d40");
        case "eth_gasPrice": return reply("0x3b9aca00");
        case "eth_maxPriorityFeePerGas": return reply("0x0");
        case "eth_getBlockByNumber": return reply({ number: "0x10", hash: "0x" + "00".repeat(32), baseFeePerGas: "0x3b9aca00", timestamp: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] });
        case "eth_getTransactionByHash": return reply(knowsLanded && world.landed.has(String(call.params[0])) ? { hash: call.params[0] } : null);
        case "eth_getTransactionReceipt": return reply(null);
        case "eth_sendRawTransaction": {
          const raw = String(call.params[0]) as Hex;
          if (send === "accept-then-hang") { world.broadcasts.push(raw); world.landed.add(keccak256(raw)); return; /* never answers: the caller times out */ }
          if (send === "already-known") { world.broadcasts.push(raw); return error(-32000, "already known"); }
          world.broadcasts.push(raw);
          return error(-32000, "insufficient funds for gas * price + value");
        }
        default: return reply("0x0");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

function sender(urls: string[]) {
  const transport = fallback(urls.map((url) => viemHttp(url, { timeout: 300, retryCount: 0 })), { retryCount: 0 });
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  return createRelayedSender({ walletClient, publicClient, attempts: 4, delayMs: 20 });
}
const vote = { address: "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968" as const, abi, functionName: "voteBySig", args };

test("provider A broadcasts then times out, provider B says 'already known': the tx hash comes back, not an error", async () => {
  const world: World = { broadcasts: [], landed: new Set() };
  const a = await node(world, "accept-then-hang", true);
  const b = await node(world, "already-known", true);
  const hash = await sender([a, b]).writeContract(vote);
  assert.equal(world.broadcasts.length, 2, "the same signed bytes went to both providers");
  assert.equal(world.broadcasts[0], world.broadcasts[1], "never re-signed");
  assert.equal(hash, keccak256(world.broadcasts[0]));
});

test("a tx that really did not land still reports the original error, after one signing only", async () => {
  const world: World = { broadcasts: [], landed: new Set() };
  const a = await node(world, "reject", false);
  const b = await node(world, "reject", false);
  await assert.rejects(sender([a, b]).writeContract(vote), /insufficient funds/);
  assert.equal(world.broadcasts.length, 2);
  assert.equal(world.broadcasts[0], world.broadcasts[1], "both providers saw the same single signed tx");
});

test("a lone provider that has seen the tx returns the hash of the signed bytes", async () => {
  const world: World = { broadcasts: [], landed: new Set() };
  const a = await node(world, "already-known", true);
  // The node knows a tx once it has seen it broadcast.
  const originalPush = world.broadcasts.push.bind(world.broadcasts);
  world.broadcasts.push = ((...items: Hex[]) => { for (const i of items) world.landed.add(keccak256(i)); return originalPush(...items); }) as typeof world.broadcasts.push;
  const hash = await sender([a]).writeContract(vote);
  assert.equal(hash, keccak256(world.broadcasts[0]));
});

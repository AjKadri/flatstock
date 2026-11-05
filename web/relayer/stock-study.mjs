// Read-only study: every Stock Token with a Chainlink feed and a USDG Uniswap pool.
// Quotes 1, 10, 50 and 100 USDG per fee tier and compares the fill with the Chainlink price.
// Run from web/ so viem resolves:  node web/relayer/stock-study.mjs > research/stock-study.json
// Sends no transactions.
import { createPublicClient, http, encodePacked, encodeFunctionData, decodeFunctionResult, parseAbi, formatUnits } from "viem";

const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const API = process.env.ORACLE_API || "https://api.flatstock.ajkadri.dev/api/stock-token/oracle-health";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7";
const FEES = [100, 500, 3000, 10000];
const SIZES = [1, 10, 50, 100]; // USDG
const quoterAbi = parseAbi(["function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"]);
const erc20 = parseAbi(["function decimals() view returns (uint8)"]);
const client = createPublicClient({ transport: http(RPC) });

async function quote(token, fee, amountIn) {
  try {
    const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInput", args: [encodePacked(["address", "uint24", "address"], [USDG, fee, token]), amountIn] });
    const { data: out } = await client.call({ to: QUOTER, data });
    if (!out) return null;
    const [amountOut, , , gas] = decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInput", data: out });
    return amountOut > 0n ? { amountOut, gas } : null;
  } catch { return null; }
}

const oracle = await (await fetch(API)).json();
const feeds = oracle.feeds.filter((f) => f.kind === "EQUITY");
const rows = [];
let next = 0;
async function worker() {
  while (next < feeds.length) {
    const f = feeds[next++];
    const dec = await client.readContract({ address: f.token, abi: erc20, functionName: "decimals" }).catch(() => 18);
    const chainlink = Number(f.answer) / 10 ** f.decimals;
    const tiers = [];
    for (const fee of FEES) {
      const q1 = await quote(f.token, fee, 1_000_000n);
      if (!q1) continue;
      const depth = {};
      for (const size of SIZES) {
        const q = size === 1 ? q1 : await quote(f.token, fee, BigInt(size) * 1_000_000n);
        if (!q) { depth[size] = null; continue; }
        const price = size / Number(formatUnits(q.amountOut, dec));
        depth[size] = { price, diffBps: Math.round((price / chainlink - 1) * 10000) };
      }
      tiers.push({ fee, depth, diff1Bps: depth[1].diffBps, price1: depth[1].price });
    }
    // best tier = smallest absolute 1 USDG deviation
    tiers.sort((a, b) => Math.abs(a.diff1Bps) - Math.abs(b.diff1Bps));
    rows.push({ symbol: f.symbol, token: f.token, feed: f.feed, chainlink, ageSeconds: f.ageSeconds, status: f.status, heartbeat: f.heartbeatSeconds, pool: tiers.length > 0, best: tiers[0] || null, tiers });
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
console.log(JSON.stringify({ at: new Date().toISOString(), session: oracle.session, sequencer: oracle.sequencer?.operatorStatus, rows }, null, 1));

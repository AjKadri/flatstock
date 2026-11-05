// Live Chainlink prices and a short price history per stock, read-only.
// History = the last few feed rounds (getRoundData stepping back from the latest round).
// Everything is read with two Multicall3 requests (allowFailure), so a missing old round never
// surfaces as an RPC error and the RPC proxy and public RPC are not flooded with single calls.
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { assets, chain, RPC_URL } from "../config";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const client = createPublicClient({ chain, transport: http(RPC_URL) });
const HISTORY_POINTS = 20;
const CACHE_KEY = "flatstock-prices-v2";
const CACHE_MS = 10 * 60 * 1000;

export type StockPrice = {
  symbol: string;
  price: number | null;
  updatedAt: number | null;
  history: number[]; // oldest -> newest
  changePct: number | null; // newest vs oldest in the history window
};
export type PriceMap = Record<string, StockPrice>;

type Round = readonly [bigint, bigint, bigint, bigint, bigint];

async function loadFresh(): Promise<PriceMap> {
  const empty = (symbol: string): StockPrice => ({ symbol, price: null, updatedAt: null, history: [], changePct: null });
  const out: PriceMap = Object.fromEntries(assets.map((asset) => [asset.symbol, empty(asset.symbol)]));

  // Request 1: decimals and latest round for every feed.
  const first = await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: true,
    contracts: assets.flatMap((asset) => [
      { address: asset.feed, abi: feedAbi, functionName: "decimals" } as const,
      { address: asset.feed, abi: feedAbi, functionName: "latestRoundData" } as const,
    ]),
  });
  const base = assets.map((asset, i) => {
    const decimals = first[i * 2];
    const latest = first[i * 2 + 1];
    if (decimals.status !== "success" || latest.status !== "success") return null;
    const round = latest.result as unknown as Round;
    const scale = 10 ** Number(decimals.result);
    return { asset, scale, latestId: round[0], price: Number(round[1]) / scale, updatedAt: Number(round[3]) };
  });
  base.forEach((entry) => {
    if (entry) out[entry.asset.symbol] = { symbol: entry.asset.symbol, price: entry.price, updatedAt: entry.updatedAt, history: [entry.price], changePct: null };
  });

  // Request 2: the previous rounds of every feed (failures allowed).
  const wanted = base.flatMap((entry) => entry
    ? Array.from({ length: HISTORY_POINTS - 1 }, (_, k) => ({ entry, id: entry.latestId - BigInt(k + 1) }))
    : []);
  try {
    const past = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: wanted.map(({ entry, id }) => ({ address: entry.asset.feed, abi: feedAbi, functionName: "getRoundData", args: [id] } as const)),
    });
    const bySymbol: Record<string, number[]> = {};
    wanted.forEach(({ entry }, i) => {
      const result = past[i];
      if (result.status !== "success") return;
      const value = Number((result.result as unknown as Round)[1]) / entry.scale;
      if (value > 0) (bySymbol[entry.asset.symbol] ??= []).push(value);
    });
    base.forEach((entry) => {
      if (!entry) return;
      const history = [...(bySymbol[entry.asset.symbol] ?? []).reverse(), entry.price];
      const first = history[0];
      out[entry.asset.symbol] = { ...out[entry.asset.symbol], history, changePct: first ? (entry.price / first - 1) * 100 : null };
    });
  } catch {
    // Prices still show without a chart.
  }
  return out;
}

export async function readPrices(force = false): Promise<PriceMap> {
  if (!force) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null") as { at: number; data: PriceMap } | null;
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
    } catch { /* storage unavailable */ }
  }
  const data = await loadFresh();
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return data;
}

export function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return value >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 0 }) : value.toFixed(2);
}

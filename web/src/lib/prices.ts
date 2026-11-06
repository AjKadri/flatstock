// Live Chainlink prices, a 24h sparkline and the 24h change per stock, read-only.
// The 24h window = the feed's recent rounds (getRoundData stepping back from the latest round) that fall
// within 24 hours of the latest update. Everything is read with two Multicall3 requests (allowFailure), so
// a missing old round never surfaces as an RPC error and the RPC proxy is not flooded with single calls.
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { assets, chain, RPC_URL } from "../config";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const client = createPublicClient({ chain, transport: http(RPC_URL) });
const LOOKBACK_ROUNDS = 72; // how many earlier rounds to read; the 24h window is cut from these
const WINDOW_SECONDS = 24 * 60 * 60;
const STALE_SECONDS = 3 * 60 * 60;
const CACHE_KEY = "flatstock-prices-v4";
const CACHE_MS = 10 * 60 * 1000;

export type StockPrice = {
  symbol: string;
  price: number | null;
  updatedAt: number | null;
  history: number[]; // oldest -> newest, within 24h of the latest update
  changePct: number | null; // latest vs the price at or before 24h earlier (or the oldest round we could read)
  stale: boolean; // feed has not updated for 3h+ (markets shut): the change is "since last close"
};
export type PriceMap = Record<string, StockPrice>;

type Round = readonly [bigint, bigint, bigint, bigint, bigint];

async function loadFresh(): Promise<PriceMap> {
  const empty = (symbol: string): StockPrice => ({ symbol, price: null, updatedAt: null, history: [], changePct: null, stale: false });
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
    if (entry) out[entry.asset.symbol] = { symbol: entry.asset.symbol, price: entry.price, updatedAt: entry.updatedAt, history: [entry.price], changePct: null, stale: false };
  });

  // Request 2: the earlier rounds of every feed (failures allowed).
  const wanted = base.flatMap((entry) => entry
    ? Array.from({ length: LOOKBACK_ROUNDS }, (_, k) => ({ entry, id: entry.latestId - BigInt(k + 1) }))
    : []);
  try {
    const past = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      contracts: wanted.map(({ entry, id }) => ({ address: entry.asset.feed, abi: feedAbi, functionName: "getRoundData", args: [id] } as const)),
    });
    const rounds: Record<string, { t: number; v: number }[]> = {};
    wanted.forEach(({ entry }, i) => {
      const result = past[i];
      if (result.status !== "success") return;
      const round = result.result as unknown as Round;
      const v = Number(round[1]) / entry.scale;
      if (v > 0) (rounds[entry.asset.symbol] ??= []).push({ t: Number(round[3]), v });
    });
    base.forEach((entry) => {
      if (!entry) return;
      const earlier = (rounds[entry.asset.symbol] ?? []).sort((a, b) => a.t - b.t); // oldest first
      // Live feed: compare with the last round at or before now-24h. Markets shut (no update for 3h+):
      // compare with the last round at or before (last update - 24h) and call it "since last close",
      // so a stale round never makes the 24h window look empty or flat.
      const nowSec = Math.floor(Date.now() / 1000);
      const stale = nowSec - entry.updatedAt > STALE_SECONDS;
      const cutoff = (stale ? entry.updatedAt : nowSec) - WINDOW_SECONDS;
      const inWindow = earlier.filter((point) => point.t >= cutoff);
      // The price 24h earlier: the last round at or before the cutoff, otherwise the oldest round we have.
      const before = earlier.filter((point) => point.t < cutoff);
      const anchor = before.length ? before[before.length - 1].v : (inWindow[0]?.v ?? null);
      const history = [...inWindow.map((point) => point.v), entry.price];
      out[entry.asset.symbol] = { ...out[entry.asset.symbol], history, changePct: anchor ? (entry.price / anchor - 1) * 100 : null, stale };
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

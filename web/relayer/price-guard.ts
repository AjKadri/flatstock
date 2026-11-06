// Relayer-side price guard. Before the relayer pays gas for a signed buy or sell it re-checks each leg's signed
// amountOutMinimum against the Chainlink price on chain. A minimum that is more than 2% below the
// Chainlink-implied output is refused, so a tampered app cannot get a user to sign a bad price and have the
// relayer submit it. Fails closed: unknown token, stale / non-positive / future-dated feed, paused or
// unhealthy oracle, or an unreadable feed all refuse the action.
import { formatUnits, parseAbi, type Address, type PublicClient } from "viem";

export const MAX_SLIPPAGE_BPS = 200n; // same 2% as the app
export const ORACLE_MAX_AGE_SECONDS = 86_400n; // same freshness limit as the app
const USDG_DECIMALS = 6;

// Same tokens and feeds as web/src/config.ts (a test keeps the two in step).
export const STOCK_FEEDS = [
  { symbol: "AAPL", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  { symbol: "NVDA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  { symbol: "MSFT", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  { symbol: "AMZN", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  { symbol: "GOOGL", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" },
  { symbol: "META", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" },
  { symbol: "TSLA", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  { symbol: "SPY", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A" },
] as const;

const feedByToken = new Map<string, (typeof STOCK_FEEDS)[number]>(STOCK_FEEDS.map((item) => [item.token.toLowerCase(), item]));

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const tokenAbi = parseAbi(["function decimals() view returns (uint8)"]);

export class PriceGuardError extends Error {}

export type OracleHealth = { feeds?: { symbol?: string; status?: string; stale?: boolean; oraclePaused?: boolean; answer?: unknown }[] };

// Chainlink-implied output, in integer maths (no floats).
// Buy: USDG (6 dec) in -> stock tokens out. Sell: stock tokens in -> USDG (6 dec) out.
export function impliedOut(side: "buy" | "sell", amountIn: bigint, price: bigint, feedDecimals: number, tokenDecimals: number): bigint {
  if (side === "buy") return (amountIn * 10n ** BigInt(feedDecimals) * 10n ** BigInt(tokenDecimals)) / (price * 10n ** BigInt(USDG_DECIMALS));
  return (amountIn * price * 10n ** BigInt(USDG_DECIMALS)) / (10n ** BigInt(tokenDecimals) * 10n ** BigInt(feedDecimals));
}

// The lowest signed minimum the relayer accepts: Chainlink-implied output less 2%.
export function minimumAllowed(implied: bigint): bigint {
  return (implied * (10_000n - MAX_SLIPPAGE_BPS) + 9_999n) / 10_000n; // rounded up
}

export type PriceInputs = {
  symbol: string;
  side: "buy" | "sell";
  amountIn: bigint;
  amountOutMinimum: bigint;
  price: bigint; // feed answer
  updatedAt: bigint; // feed updatedAt
  feedDecimals: number;
  tokenDecimals: number;
  now: bigint; // latest block timestamp
};

// Pure check used by the relayer and by the tests. Throws PriceGuardError with a plain-English message.
export function checkMinimum(input: PriceInputs): void {
  const { symbol, side, price, updatedAt, now } = input;
  if (price <= 0n || updatedAt === 0n || updatedAt > now || now - updatedAt > ORACLE_MAX_AGE_SECONDS) {
    throw new PriceGuardError(`${symbol}: the Chainlink price is stale or unavailable, so this ${side} was not relayed. Try again later.`);
  }
  const implied = impliedOut(side, input.amountIn, price, input.feedDecimals, input.tokenDecimals);
  if (implied <= 0n) throw new PriceGuardError(`${symbol}: the amount is too small to price against Chainlink, so this ${side} was not relayed.`);
  const floor = minimumAllowed(implied);
  if (input.amountOutMinimum < floor) {
    const outDecimals = side === "buy" ? input.tokenDecimals : USDG_DECIMALS;
    const outSymbol = side === "buy" ? symbol : "USDG";
    const show = (value: bigint) => Number(formatUnits(value, outDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 });
    throw new PriceGuardError(
      `${symbol}: the minimum you signed (${show(input.amountOutMinimum)} ${outSymbol}) is more than 2% below the Chainlink price `
      + `(at least ${show(floor)} ${outSymbol} expected), so this ${side} was not relayed. Nothing was spent. Refresh and sign again, or send it from your own wallet.`,
    );
  }
}

export function assertOraclesHealthy(health: OracleHealth, symbols: string[]) {
  const bySymbol = new Map((health.feeds || []).map((feed) => [feed.symbol?.toUpperCase(), feed]));
  for (const symbol of symbols) {
    const feed = bySymbol.get(symbol.toUpperCase());
    const ok = feed && (feed.status === "OK" || feed.status === "MARKET_CLOSED") && feed.stale !== true && feed.oraclePaused !== true && Boolean(feed.answer);
    if (!ok) throw new PriceGuardError(`${symbol}: the oracle is ${feed?.status || "unavailable"} or paused, so this action was not relayed. Try again later.`);
  }
}

type GuardDeps = {
  client: Pick<PublicClient, "readContract" | "getBlock">;
  // Returns QuickNode's oracle health for the symbols. Leave undefined to skip the paused/unhealthy check
  // (used in tests); the relayer always passes it.
  getOracleHealth?: (symbols: string[]) => Promise<OracleHealth>;
};

export function createPriceGuard({ client, getOracleHealth }: GuardDeps) {
  const decimalsCache = new Map<string, number>();
  async function decimalsOf(address: Address, abi: typeof feedAbi | typeof tokenAbi): Promise<number> {
    const key = address.toLowerCase();
    const cached = decimalsCache.get(key);
    if (cached !== undefined) return cached;
    const value = Number(await client.readContract({ address, abi, functionName: "decimals" } as never));
    decimalsCache.set(key, value);
    return value;
  }

  async function check(side: "buy" | "sell", items: { token: Address; amountIn: bigint; amountOutMinimum: bigint }[]) {
    const entries = items.map((item) => {
      const info = feedByToken.get(item.token.toLowerCase());
      if (!info) throw new PriceGuardError("This token has no Chainlink price feed in Flatstock, so this action was not relayed.");
      return { ...item, info };
    });
    if (getOracleHealth) assertOraclesHealthy(await getOracleHealth(Array.from(new Set(entries.map((entry) => entry.info.symbol)))), entries.map((entry) => entry.info.symbol));
    const block = await client.getBlock({ blockTag: "latest" });
    for (const entry of entries) {
      let latest: readonly [bigint, bigint, bigint, bigint, bigint];
      let feedDecimals: number;
      let tokenDecimals: number;
      try {
        [latest, feedDecimals, tokenDecimals] = await Promise.all([
          client.readContract({ address: entry.info.feed, abi: feedAbi, functionName: "latestRoundData" }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
          decimalsOf(entry.info.feed, feedAbi),
          decimalsOf(entry.token, tokenAbi),
        ]);
      } catch {
        throw new PriceGuardError(`${entry.info.symbol}: the Chainlink price could not be read, so this ${side} was not relayed. Try again later.`);
      }
      checkMinimum({
        symbol: entry.info.symbol,
        side,
        amountIn: entry.amountIn,
        amountOutMinimum: entry.amountOutMinimum,
        price: latest[1],
        updatedAt: latest[3],
        feedDecimals,
        tokenDecimals,
        now: block.timestamp,
      });
    }
  }

  return {
    assertBuyLegs: (legs: { token: Address; amountIn: bigint; amountOutMinimum: bigint }[]) => check("buy", legs),
    assertSell: (token: Address, amountIn: bigint, amountOutMinimum: bigint) => check("sell", [{ token, amountIn, amountOutMinimum }]),
  };
}

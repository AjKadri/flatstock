import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  formatEther,
  formatUnits,
  http,
  keccak256,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { impliedOut, minimumAllowed } from "../../relayer/price-guard";
import {
  addresses,
  assets,
  chain,
  EXPLORER_URL,
  erc20Abi,
  feedAbi,
  LEGAL_NOTICE,
  RESTRICTED_JURISDICTIONS_TEXT,
  RESTRICTED_JURISDICTIONS_URL,
  legacyBuyRouterAddress,
  lockAbi,
  MAX_SLIPPAGE_BPS,
  MIX_MAX_WEIGHT_BPS,
  MIX_RULES_ENABLED,
  MIX_VOTE_SHARE_BPS,
  metaRouterAddress,
  metaVotesAddress,
  permitAbi,
  ORACLE_MAX_AGE_SECONDS,
  quoterAbi,
  RELAYER_API,
  routerAbi,
  FALLBACK_ROUND_ID,
  STATS_FROM_BLOCK,
  voteStatsAddresses,
  voteCastEvent,
  tradeExecutedEvent,
  mixBoughtEvent,
  SIGNATURE_SAFE_WRITES_ENABLED,
  votesAbi,
} from "../config";

export const publicClient = createPublicClient({ chain, transport: http() });

export type ConnectedWallet = ReturnType<typeof createWalletClient>;
export type RoundState = {
  roundId: bigint;
  opensAt: bigint;
  closesAt: bigint;
  assetCount: number;
  totalVotes: bigint;
  closed: boolean;
  isOpen: boolean;
  weights: bigint[];
};

export type Holding = {
  symbol: string;
  balance: bigint;
  shares?: string;
  price: number | null;
  value: number | null;
};

export type OracleFeedHealth = {
  symbol?: string;
  status?: string;
  stale?: boolean;
  oraclePaused?: boolean | null;
  answer?: string | null;
  ageSeconds?: number | null;
};

export type OracleHealth = {
  feeds?: OracleFeedHealth[];
  warnings?: string[];
};

export type CorporateAction = {
  symbol?: string;
  type?: string;
  status?: string;
  ratio?: string;
  effectiveAt?: number;
  effectiveAtIso?: string;
};

export type TransactionFinality = {
  txHash?: Hex;
  stage?: string;
  soft?: boolean;
  posted?: boolean;
  safe?: boolean;
  finalized?: boolean;
  stages?: {
    soft?: boolean;
    posted?: boolean;
    safe?: boolean;
    finalized?: boolean;
  };
  warnings?: string[];
};

export type BuyLeg = {
  symbol: string;
  token: Address;
  fee: number;
  amountIn: bigint;
  quoteOut: bigint;
  minOut: bigint;
  chainlinkPrice: number;
  quotePrice: number;
  differenceBps: number;
};

export type SellLeg = {
  symbol: string;
  token: Address;
  fee: number;
  amountIn: bigint;
  quoteOut: bigint;
  minOut: bigint;
  chainlinkPrice: number;
  quotePrice: number;
  differenceBps: number;
};

export type BatchCall = { target: Address; value: bigint; data: Hex };

export type HistoryItem = {
  kind: "vote" | "buy" | "sell";
  date: string;
  title: string;
  amount: string;
  hash: Hex;
  link: string;
};

export type MetaLeg = {
  token: Address;
  fee: number;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96: bigint;
};

export type MetaPermit = {
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
};

const metaLegComponents = [
  { name: "token", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "amountIn", type: "uint256" },
  { name: "amountOutMinimum", type: "uint256" },
  { name: "sqrtPriceLimitX96", type: "uint160" },
] as const;

export function getWalletClient() {
  if (!window.ethereum) throw new Error("No injected wallet was found.");
  return createWalletClient({ chain, transport: custom(window.ethereum) });
}

export async function connectWallet() {
  const wallet = getWalletClient();
  const [account] = await wallet.requestAddresses();
  return { wallet, account };
}

export async function getLatestTimestamp() {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return block.timestamp;
}

export async function readRound(): Promise<RoundState> {
  let roundId = FALLBACK_ROUND_ID;
  try {
    roundId = await publicClient.readContract({
      address: addresses.votes,
      abi: votesAbi,
      functionName: "latestRoundId",
    }) as bigint;
  } catch {
    // The legacy deployed vote contract has no latestRoundId getter.
  }
  const [opensAt, closesAt, assetCount, totalVotes, closed] =
    (await publicClient.readContract({
      address: addresses.votes,
      abi: votesAbi,
      functionName: "rounds",
      args: [roundId],
    })) as readonly [bigint, bigint, number, bigint, boolean];
  const now = await getLatestTimestamp();
  const votes = await Promise.all(
    assets.map(async (_, index) => {
      if (index >= assetCount || totalVotes === 0n) return 0n;
      return (await publicClient.readContract({
        address: addresses.votes,
        abi: votesAbi,
        functionName: "votesFor",
        args: [roundId, index],
      })) as bigint;
    }),
  );
  // Each round stores its own vote share (round 4: 50%). Fall back to the configured default if unreadable.
  const voteShare = await publicClient.readContract({
    address: addresses.votes, abi: votesAbi, functionName: "voteShareBps", args: [roundId],
  }).then((value) => BigInt(value as number)).catch(() => MIX_VOTE_SHARE_BPS);
  const weights = closed
    ? await Promise.all(assets.map(async (_, index) => {
      if (index >= assetCount) return 0n;
      return await publicClient.readContract({
        address: addresses.votes,
        abi: votesAbi,
        functionName: "weightBps",
        args: [roundId, index],
      }) as bigint;
    }))
    : assets.map((_, index) => index < assetCount
      ? calculateMixWeights(votes, assetCount, voteShare)[index] || 0n
      : 0n);
  return {
    roundId,
    opensAt,
    closesAt,
    assetCount,
    totalVotes,
    closed,
    isOpen: !closed && now < closesAt,
    weights,
  };
}

export function calculateMixWeights(
  votes: bigint[],
  assetCount: number,
  voteShareBps = MIX_VOTE_SHARE_BPS,
): bigint[] {
  if (assetCount <= 0) return [];
  if (assetCount === 1) return [10_000n];
  const count = BigInt(assetCount);
  const totalVotes = votes.slice(0, assetCount).reduce((sum, value) => sum + value, 0n);
  const equalBase = 10_000n / count;
  const equalRemainder = 10_000n % count;
  if (totalVotes === 0n) {
    return Array.from({ length: assetCount }, (_, index) =>
      equalBase + (BigInt(index) < equalRemainder ? 1n : 0n),
    );
  }
  const equalShare = 10_000n - voteShareBps;
  const weights = Array.from({ length: assetCount }, () => 0n);
  let voteSum = 0n;
  let weightSum = 0n;
  for (let index = 0; index < assetCount; index += 1) {
    const equalWeight = equalBase + (BigInt(index) < equalRemainder ? 1n : 0n);
    let voteWeight = 0n;
    if (totalVotes !== 0n) {
      voteWeight = index === assetCount - 1
        ? 10_000n - voteSum
        : (votes[index] || 0n) * 10_000n / totalVotes;
      if (index !== assetCount - 1) voteSum += voteWeight;
    }
    weights[index] = (equalWeight * equalShare + voteWeight * voteShareBps) / 10_000n;
    weightSum += weights[index];
  }
  if (weightSum < 10_000n) weights[assetCount - 1] += 10_000n - weightSum;

  const capped = Array.from({ length: assetCount }, () => false);
  let excess = 0n;
  for (let index = 0; index < assetCount; index += 1) {
    if (weights[index] > MIX_MAX_WEIGHT_BPS) {
      excess += weights[index] - MIX_MAX_WEIGHT_BPS;
      weights[index] = MIX_MAX_WEIGHT_BPS;
      capped[index] = true;
    }
  }
  while (excess !== 0n) {
    const eligible = weights.reduce((sum, weight, index) => sum + (!capped[index] && weight < MIX_MAX_WEIGHT_BPS ? 1 : 0), 0);
    if (eligible === 0) throw new Error("Mix weights cannot satisfy the 50% cap.");
    const base = excess / BigInt(eligible);
    const remainder = excess % BigInt(eligible);
    let seen = 0;
    let nextExcess = 0n;
    for (let index = 0; index < assetCount; index += 1) {
      if (capped[index] || weights[index] >= MIX_MAX_WEIGHT_BPS) continue;
      const addition = base + (BigInt(seen) < remainder ? 1n : 0n);
      seen += 1;
      const capacity = MIX_MAX_WEIGHT_BPS - weights[index];
      if (addition > capacity) {
        weights[index] = MIX_MAX_WEIGHT_BPS;
        capped[index] = true;
        nextExcess += addition - capacity;
      } else {
        weights[index] += addition;
      }
    }
    excess = nextExcess;
  }
  return weights;
}

export function formatWeightBps(weight: bigint): string {
  const whole = weight / 100n;
  const hundredths = (weight % 100n).toString().padStart(2, "0");
  return `${whole}.${hundredths}%`;
}

export async function readVoteBurned() {
  const counts = await Promise.all(voteStatsAddresses.map(async (address) => {
    try {
      const logs = await publicClient.getLogs({
        address,
        event: voteCastEvent,
        fromBlock: STATS_FROM_BLOCK,
        toBlock: "latest",
      });
      return BigInt(logs.length);
    } catch {
      return 0n;
    }
  }));
  return counts.reduce((sum, count) => sum + count, 0n);
}

function symbolForToken(token: Address) {
  if (token.toLowerCase() === addresses.usdg.toLowerCase()) return "USDG";
  return assets.find((asset) => asset.token.toLowerCase() === token.toLowerCase())?.symbol || token.slice(0, 8);
}

function formatHistoryAmount(token: Address, amount: bigint) {
  return `${formatUnits(amount, token.toLowerCase() === addresses.usdg.toLowerCase() ? 6 : 18)} ${symbolForToken(token)}`;
}

export async function readHistory(account: Address): Promise<HistoryItem[]> {
  type RawHistory = HistoryItem & { blockNumber: bigint };
  const rows: RawHistory[] = [];
  const voteLogs = await Promise.all(voteStatsAddresses.map(async (address) => {
    try {
      return await publicClient.getLogs({
        address,
        event: voteCastEvent,
        fromBlock: STATS_FROM_BLOCK,
        toBlock: "latest",
      });
    } catch {
      return [];
    }
  }));
  for (const logs of voteLogs) {
    for (const log of logs) {
      if (!log.args.voter || log.args.voter.toLowerCase() !== account.toLowerCase() || log.blockNumber === null || !log.transactionHash) continue;
      rows.push({
        kind: "vote",
        date: "",
        title: `Voted for ${assets[Number(log.args.assetIndex || 0)]?.symbol || "stock"}`,
        amount: "1 WIF burned",
        hash: log.transactionHash,
        link: `${EXPLORER_URL}/tx/${log.transactionHash}`,
        blockNumber: log.blockNumber,
      });
    }
  }

  const tradeLogs: Array<{ logs: readonly any[]; legacy: boolean }> = [];
  if (metaRouterAddress) {
    try {
      tradeLogs.push({
        logs: await publicClient.getLogs({
          address: metaRouterAddress,
          event: tradeExecutedEvent,
          fromBlock: STATS_FROM_BLOCK,
          toBlock: "latest",
        }),
        legacy: false,
      });
    } catch {
      // The history section remains useful if the new router has no events yet.
    }
  }
  try {
    tradeLogs.push({
      logs: await publicClient.getLogs({
        address: legacyBuyRouterAddress,
        event: mixBoughtEvent,
        fromBlock: STATS_FROM_BLOCK,
        toBlock: "latest",
      }),
      legacy: true,
    });
  } catch {
    // A provider can reject a wide historical range. The rest of history still loads.
  }

  for (const group of tradeLogs) {
    for (const log of group.logs) {
      if (log.blockNumber === null || !log.transactionHash) continue;
      const args = log.args as Record<string, unknown>;
      const accountArg = args.account as Address | undefined;
      if (!accountArg || accountArg.toLowerCase() !== account.toLowerCase()) continue;
      const sellToken = args.sellToken as Address;
      const buyToken = args.buyToken as Address;
      const amountIn = args.amountIn as bigint;
      const amountOut = args.amountOut as bigint;
      const isBuy = group.legacy
        ? sellToken.toLowerCase() === addresses.usdg.toLowerCase()
        : Number(args.kind) === 0;
      rows.push({
        kind: isBuy ? "buy" : "sell",
        date: "",
        title: isBuy ? `Bought ${symbolForToken(buyToken)}` : `Sold ${symbolForToken(sellToken)}`,
        amount: isBuy
          ? `${formatHistoryAmount(sellToken, amountIn)} -> ${formatHistoryAmount(buyToken, amountOut)}`
          : `${formatHistoryAmount(sellToken, amountIn)} -> ${formatHistoryAmount(buyToken, amountOut)}`,
        hash: log.transactionHash,
        link: `${EXPLORER_URL}/tx/${log.transactionHash}`,
        blockNumber: log.blockNumber,
      });
    }
  }

  const uniqueBlocks = [...new Set(rows.map((row) => row.blockNumber.toString()))];
  const blockDates = new Map<string, string>();
  await Promise.all(uniqueBlocks.map(async (blockNumber) => {
    const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumber) });
    blockDates.set(blockNumber, formatDate(block.timestamp));
  }));
  return rows
    .sort((left, right) => (left.blockNumber > right.blockNumber ? -1 : left.blockNumber < right.blockNumber ? 1 : 0))
    .map(({ blockNumber, ...row }) => ({ ...row, date: blockDates.get(blockNumber.toString()) || "Unknown date" }));
}

export async function readHoldings(account: Address): Promise<Holding[]> {
  const quickNodeHoldings = await readQuickNodeHoldings(account);
  if (quickNodeHoldings) return quickNodeHoldings;
  return Promise.all(
    assets.map(async (asset) => {
      const [balance, decimals, feedDecimals, latest] = await Promise.all([
        publicClient.readContract({
          address: asset.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: asset.token,
          abi: erc20Abi,
          functionName: "decimals",
        }) as Promise<number>,
        publicClient.readContract({
          address: asset.feed,
          abi: feedAbi,
          functionName: "decimals",
        }) as Promise<number>,
        publicClient.readContract({
          address: asset.feed,
          abi: feedAbi,
          functionName: "latestRoundData",
        }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      ]);
      const answer = latest[1] > 0n ? Number(latest[1]) / 10 ** feedDecimals : null;
      const quantity = Number(formatUnits(balance, decimals));
      return {
        symbol: asset.symbol,
        balance,
        price: answer,
        value: answer === null ? null : quantity * answer,
      };
    }),
  );
}

async function readQuickNodeHoldings(account: Address): Promise<Holding[] | null> {
  try {
    const symbols = assets.map((asset) => asset.symbol).join(",");
    const response = await fetch(
      `${RELAYER_API}/stock-token/balances?address=${account}&symbols=${symbols}`,
    );
    if (!response.ok) return null;
    const payload = await response.json() as {
      holdings?: Array<{
        symbol?: string;
        balanceRaw?: string;
        balanceUiDecimal?: string;
        priceUsd?: string | null;
        valueUsd?: string | null;
      }>;
    };
    if (!Array.isArray(payload.holdings)) return null;
    const bySymbol = new Map(payload.holdings.map((holding) => [holding.symbol?.toUpperCase(), holding]));
    return assets.map((asset) => {
      const holding = bySymbol.get(asset.symbol);
      const price = holding?.priceUsd == null ? null : Number(holding.priceUsd);
      return {
        symbol: asset.symbol,
        balance: holding?.balanceRaw ? BigInt(holding.balanceRaw) : 0n,
        shares: holding?.balanceUiDecimal || "0",
        price,
        value: holding?.valueUsd == null ? null : Number(holding.valueUsd),
      };
    });
  } catch {
    return null;
  }
}

export async function readOracleHealth(symbols: string[]): Promise<OracleHealth> {
  const response = await fetch(
    `${RELAYER_API}/stock-token/oracle-health?symbols=${encodeURIComponent(symbols.join(","))}`,
  );
  const payload = await response.json() as OracleHealth & { error?: string };
  if (!response.ok) throw new Error(payload.error || "QuickNode oracle health is unavailable.");
  return payload;
}

export async function readCorporateActions(symbols: string[]): Promise<CorporateAction[]> {
  try {
    const response = await fetch(
      `${RELAYER_API}/stock-token/corporate-actions?symbols=${encodeURIComponent(symbols.join(","))}`,
    );
    if (!response.ok) return [];
    const payload = await response.json() as { actions?: CorporateAction[] };
    return Array.isArray(payload.actions) ? payload.actions : [];
  } catch {
    return [];
  }
}

export async function waitForTransactionFinality(hash: Hex): Promise<TransactionFinality> {
  let lastError = "Transaction finality was not confirmed.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(
        `${RELAYER_API}/stock-token/finality?txHash=${hash}`,
      );
      const payload = await response.json() as TransactionFinality & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Finality service unavailable.");
      const softConfirmed = payload.soft === true || payload.stages?.soft === true;
      if (softConfirmed && payload.stage && payload.stage !== "REORGED") return payload;
      lastError = `Finality stage is ${payload.stage || "unknown"}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error(`Buy submitted, but finality was not confirmed. ${lastError}`);
}

export function assertHealthyOracles(health: OracleHealth, symbols: string[]) {
  const bySymbol = new Map((health.feeds || []).map((feed) => [feed.symbol?.toUpperCase(), feed]));
  for (const symbol of symbols) {
    const feed = bySymbol.get(symbol.toUpperCase());
    const status = feed?.status;
    const acceptableStatus = status === "OK" || status === "MARKET_CLOSED";
    if (!feed || !acceptableStatus || feed.stale === true || feed.oraclePaused === true || !feed.answer) {
      throw new Error(`${symbol}: QuickNode oracle health is ${status || "unavailable"}. Buy refused.`);
    }
  }
}

export async function readWalletState(account: Address) {
  const [eth, wif, usdg, locked] = await Promise.all([
    publicClient.getBalance({ address: account }),
    publicClient.readContract({
      address: addresses.wif,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: addresses.usdg,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: addresses.lock,
      abi: lockAbi,
      functionName: "locked",
      args: [account],
    }) as Promise<bigint>,
  ]);
  return { eth, wif, usdg, locked };
}

export async function readAllowance(token: Address, owner: Address, spender: Address) {
  return await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  }) as bigint;
}

// The minimum the user signs: 2% below the quote, but never more than 2% below the Chainlink-implied output.
// The relayer refuses any signed minimum lower than that Chainlink floor (relayer/price-guard.ts), and the
// app uses the same integer maths so a normal plan is never refused.
function signedMinimum(
  side: "buy" | "sell",
  amountIn: bigint,
  quoteOut: bigint,
  price: bigint,
  feedDecimals: number,
  tokenDecimals: number,
  symbol: string,
  differenceBps: number,
) {
  const floor = minimumAllowed(impliedOut(side, amountIn, price, feedDecimals, tokenDecimals));
  const fromQuote = (quoteOut * (10_000n - MAX_SLIPPAGE_BPS)) / 10_000n;
  const minOut = fromQuote > floor ? fromQuote : floor;
  if (minOut <= 0n || minOut > quoteOut) throw new Error(`${symbol}: quote is ${differenceBps / 100}% from Chainlink.`);
  return minOut;
}

export async function buildBuyPlan(amountText: string, round: RoundState): Promise<BuyLeg[]> {
  if (!MIX_RULES_ENABLED) throw new Error("The new vote contract is not configured for mix buys yet.");
  // Buys use the final mix of the most recent closed round. Before any round has closed the app
  // passes the open round as a labelled preview, which still needs at least one vote.
  if (!round.closed && round.totalVotes === 0n) throw new Error("No votes yet, so there is no mix to buy. Vote first.");
  const total = parseUnits(amountText, 6);
  if (total <= 0n) throw new Error("Enter a positive USDG amount.");
  const active = assets.filter((_, index) => index < round.assetCount && round.weights[index] > 0n);
  if (active.length === 0) throw new Error("This round has no weighted assets.");
  const oracleHealth = await readOracleHealth(active.map((asset) => asset.symbol));
  assertHealthyOracles(oracleHealth, active.map((asset) => asset.symbol));
  let allocated = 0n;
  const legs: BuyLeg[] = [];
  const now = await getLatestTimestamp();
  for (const [position, asset] of active.entries()) {
    const index = assets.indexOf(asset);
    const amountIn = position === active.length - 1
      ? total - allocated
      : (total * round.weights[index]) / 10_000n;
    allocated += amountIn;
    if (amountIn <= 0n) continue;
    const path = encodePacked(["address", "uint24", "address"], [addresses.usdg, asset.fee, asset.token]);
    const result = (await publicClient.readContract({
      address: addresses.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    })) as readonly [bigint, bigint[], number[], bigint];
    const quoteOut = result[0];
    const [feedDecimals, latest, tokenDecimals] = await Promise.all([
      publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: "decimals" }) as Promise<number>,
      publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: "latestRoundData" }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      publicClient.readContract({ address: asset.token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    ]);
    if (quoteOut <= 0n || result[3] === 0n) throw new Error(`${asset.symbol}: missing quote.`);
    if (latest[1] <= 0n || latest[3] === 0n || latest[3] > now || now - latest[3] > ORACLE_MAX_AGE_SECONDS) {
      throw new Error(`${asset.symbol}: Chainlink price is stale or unavailable.`);
    }
    const chainlinkPrice = Number(latest[1]) / 10 ** feedDecimals;
    const quotePrice = Number(formatUnits(amountIn, 6)) / Number(formatUnits(quoteOut, tokenDecimals));
    const differenceBps = Math.round(Math.abs(quotePrice / chainlinkPrice - 1) * 10_000);
    if (differenceBps > Number(MAX_SLIPPAGE_BPS)) {
      throw new Error(`${asset.symbol}: quote is ${differenceBps / 100}% from Chainlink.`);
    }
    const minOut = signedMinimum("buy", amountIn, quoteOut, latest[1], feedDecimals, tokenDecimals, asset.symbol, differenceBps);
    legs.push({
      symbol: asset.symbol,
      token: asset.token,
      fee: asset.fee,
      amountIn,
      quoteOut,
      minOut,
      chainlinkPrice,
      quotePrice,
      differenceBps,
    });
  }
  return legs;
}

export async function buildSellPlan(
  symbol: string,
  amountText: string,
  account: Address,
): Promise<SellLeg> {
  const asset = assets.find((candidate) => candidate.symbol === symbol);
  if (!asset) throw new Error("Unknown Stock Token.");
  const [tokenDecimals, feedDecimals, balance, latest, now] = await Promise.all([
    publicClient.readContract({ address: asset.token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: "decimals" }) as Promise<number>,
    publicClient.readContract({ address: asset.token, abi: erc20Abi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
    publicClient.readContract({ address: asset.feed, abi: feedAbi, functionName: "latestRoundData" }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
    getLatestTimestamp(),
  ]);
  const amountIn = parseUnits(amountText, tokenDecimals);
  if (amountIn <= 0n) throw new Error("Enter a positive Stock Token amount.");
  if (amountIn > balance) throw new Error(`${symbol}: amount exceeds this wallet's balance.`);
  if (latest[1] <= 0n || latest[3] === 0n || latest[3] > now || now - latest[3] > ORACLE_MAX_AGE_SECONDS) {
    throw new Error(`${symbol}: Chainlink price is stale or unavailable.`);
  }
  const path = encodePacked(["address", "uint24", "address"], [asset.token, asset.fee, addresses.usdg]);
  const result = (await publicClient.readContract({
    address: addresses.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInput",
    args: [path, amountIn],
  })) as readonly [bigint, bigint[], number[], bigint];
  const quoteOut = result[0];
  if (quoteOut <= 0n || result[3] === 0n) throw new Error(`${symbol}: missing quote.`);
  const chainlinkPrice = Number(latest[1]) / 10 ** feedDecimals;
  const quotePrice = Number(formatUnits(quoteOut, 6)) / Number(formatUnits(amountIn, tokenDecimals));
  const differenceBps = Math.round(Math.abs(quotePrice / chainlinkPrice - 1) * 10_000);
  if (differenceBps > Number(MAX_SLIPPAGE_BPS)) {
    throw new Error(`${symbol}: quote is ${differenceBps / 100}% from Chainlink.`);
  }
  const minOut = signedMinimum("sell", amountIn, quoteOut, latest[1], feedDecimals, tokenDecimals, symbol, differenceBps);
  return {
    symbol,
    token: asset.token,
    fee: asset.fee,
    amountIn,
    quoteOut,
    minOut,
    chainlinkPrice,
    quotePrice,
    differenceBps,
  };
}

export function buildApprove(token: Address, spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

export function buildBuyCall(leg: BuyLeg): Hex {
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "buyUniswap",
    args: [addresses.usdg, leg.token, leg.fee, leg.amountIn, leg.minOut, 0n],
  });
}

export function buildSellCall(leg: SellLeg): Hex {
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "sellUniswap",
    args: [leg.token, addresses.usdg, leg.fee, leg.amountIn, leg.minOut, 0n],
  });
}

export function buildBuyMixCall(legs: BuyLeg[]): Hex {
  const metaLegs = legs.map((leg) => ({
    token: leg.token,
    fee: leg.fee,
    amountIn: leg.amountIn,
    amountOutMinimum: leg.minOut,
    sqrtPriceLimitX96: 0n,
  }));
  const total = legs.reduce((sum, leg) => sum + leg.amountIn, 0n);
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "buyMix",
    args: [metaLegs, total],
  });
}

export function buildMetaLegs(legs: BuyLeg[]): MetaLeg[] {
  return legs.map((leg) => ({
    token: leg.token,
    fee: leg.fee,
    amountIn: leg.amountIn,
    amountOutMinimum: leg.minOut,
    sqrtPriceLimitX96: 0n,
  }));
}

export function hashMetaLegs(legs: MetaLeg[]): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "tuple[]", components: metaLegComponents }],
    [legs],
  ));
}

// A slow person or a slow chain is never a failure: wait up to 15 minutes for the receipt, and tell the
// caller as soon as the wallet has returned a hash so the UI can show "waiting for confirmation".
const RECEIPT_TIMEOUT_MS = 15 * 60 * 1000;
export function waitForReceipt(hash: Hex) {
  return publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS, pollingInterval: 2_000 });
}

export async function sendDirect(
  wallet: ConnectedWallet,
  account: Address,
  target: Address,
  data: Hex,
  onSent?: (hash: Hex) => void,
) {
  const hash = await wallet.sendTransaction({ account, to: target, data, chain });
  onSent?.(hash);
  const receipt = await waitForReceipt(hash);
  if (receipt.status !== "success") throw new Error("The transaction was mined but reverted. Nothing was spent except gas.");
  return hash;
}

// The vote this wallet cast in a round, from the VoteCast event (null if none can be found).
export async function readMyVote(roundId: bigint, voter: Address): Promise<{ assetIndex: number; hash: Hex } | null> {
  try {
    const logs = await publicClient.getLogs({
      address: addresses.votes,
      event: voteCastEvent,
      args: { roundId },
      fromBlock: STATS_FROM_BLOCK,
      toBlock: "latest",
    });
    const mine = logs.find((log) => log.args.voter?.toLowerCase() === voter.toLowerCase() && log.transactionHash);
    if (!mine || mine.transactionHash === null) return null;
    return { assetIndex: Number(mine.args.assetIndex ?? 0), hash: mine.transactionHash };
  } catch {
    return null;
  }
}

export async function readPermitNonce(account: Address) {
  return await publicClient.readContract({
    address: addresses.usdg,
    abi: permitAbi,
    functionName: "nonces",
    args: [account],
  }) as bigint;
}

async function readPermitTokenDetails(token: Address, account: Address) {
  const [name, nonce] = await Promise.all([
    publicClient.readContract({ address: token, abi: permitAbi, functionName: "name" }) as Promise<string>,
    publicClient.readContract({ address: token, abi: permitAbi, functionName: "nonces", args: [account] }) as Promise<bigint>,
  ]);
  return { name, nonce };
}

export async function signMetaVote(
  wallet: ConnectedWallet,
  account: Address,
  roundId: bigint,
  assetIndex: number,
  onSent?: (hash: Hex) => void,
) {
  if (!metaVotesAddress || !SIGNATURE_SAFE_WRITES_ENABLED) throw new Error("Signature-safe vote contract is not configured.");
  const nonce = await publicClient.readContract({
    address: metaVotesAddress,
    abi: votesAbi,
    functionName: "voteNonces",
    args: [account],
  }) as bigint;
  const deadline = (await getLatestTimestamp()) + 15n * 60n;
  const signature = await wallet.signTypedData({
    account,
    domain: { name: "Flatstock Votes", version: "1", chainId: chain.id, verifyingContract: metaVotesAddress },
    types: { Vote: [
      { name: "voter", type: "address" },
      { name: "roundId", type: "uint256" },
      { name: "assetIndex", type: "uint8" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Vote",
    message: { voter: account, roundId, assetIndex, nonce, deadline },
  });
  const response = await fetch(`${RELAYER_API}/meta/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voter: account, roundId: roundId.toString(), assetIndex, nonce: nonce.toString(), deadline: deadline.toString(), signature }),
  });
  const payload = await response.json() as { txHash?: Hex; error?: string };
  if (!response.ok || !payload.txHash) throw new Error(payload.error || "The signature relay rejected this vote.");
  onSent?.(payload.txHash);
  await waitForReceipt(payload.txHash);
  return payload.txHash;
}

export async function signMetaBuy(
  wallet: ConnectedWallet,
  account: Address,
  legs: BuyLeg[],
) {
  if (!metaRouterAddress || !SIGNATURE_SAFE_WRITES_ENABLED) throw new Error("Signature-safe trade contract is not configured.");
  const metaLegs = buildMetaLegs(legs);
  const amountIn = legs.reduce((sum, leg) => sum + leg.amountIn, 0n);
  const nonce = await publicClient.readContract({ address: metaRouterAddress, abi: routerAbi, functionName: "buyNonces", args: [account] }) as bigint;
  const deadline = (await getLatestTimestamp()) + 15n * 60n;
  const permitNonce = await readPermitNonce(account);
  const permitDeadline = deadline;
  const permitSignature = await wallet.signTypedData({
    account,
    domain: { name: "Global Dollar", version: "1", chainId: chain.id, verifyingContract: addresses.usdg },
    types: { Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Permit",
    message: { owner: account, spender: metaRouterAddress, value: amountIn, nonce: permitNonce, deadline: permitDeadline },
  });
  const { v, r, s } = splitSignature(permitSignature);
  const actionSignature = await wallet.signTypedData({
    account,
    domain: { name: "Flatstock Trades", version: "1", chainId: chain.id, verifyingContract: metaRouterAddress },
    types: { BuyMix: [
      { name: "user", type: "address" },
      { name: "legsHash", type: "bytes32" },
      { name: "amountIn", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "BuyMix",
    message: { user: account, legsHash: hashMetaLegs(metaLegs), amountIn, nonce, deadline },
  });
  const relayLegs = metaLegs.map((leg) => ({
    token: leg.token,
    fee: leg.fee,
    amountIn: leg.amountIn.toString(),
    amountOutMinimum: leg.amountOutMinimum.toString(),
    sqrtPriceLimitX96: leg.sqrtPriceLimitX96.toString(),
  }));
  const response = await fetch(`${RELAYER_API}/meta/buy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: account, legs: relayLegs, amountIn: amountIn.toString(), nonce: nonce.toString(), deadline: deadline.toString(), permit: { value: amountIn.toString(), deadline: permitDeadline.toString(), v, r, s }, signature: actionSignature }),
  });
  const payload = await response.json() as { txHash?: Hex; error?: string };
  if (!response.ok || !payload.txHash) throw new Error(payload.error || "The signature relay rejected this buy.");
  await waitForReceipt(payload.txHash);
  return payload.txHash;
}

export async function signMetaSell(wallet: ConnectedWallet, account: Address, leg: SellLeg) {
  if (!metaRouterAddress || !SIGNATURE_SAFE_WRITES_ENABLED) throw new Error("Signature-safe trade contract is not configured.");
  const [nonce, permit] = await Promise.all([
    publicClient.readContract({ address: metaRouterAddress, abi: routerAbi, functionName: "sellNonces", args: [account] }) as Promise<bigint>,
    readPermitTokenDetails(leg.token, account),
  ]);
  const deadline = (await getLatestTimestamp()) + 5n * 60n;
  const permitSignature = await wallet.signTypedData({
    account,
    domain: { name: permit.name, version: "1", chainId: chain.id, verifyingContract: leg.token },
    types: { Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Permit",
    message: { owner: account, spender: metaRouterAddress, value: leg.amountIn, nonce: permit.nonce, deadline },
  });
  const signature = await wallet.signTypedData({
    account,
    domain: { name: "Flatstock Trades", version: "1", chainId: chain.id, verifyingContract: metaRouterAddress },
    types: { SellStock: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "SellStock",
    message: { user: account, token: leg.token, fee: leg.fee, amountIn: leg.amountIn, amountOutMinimum: leg.minOut, nonce, deadline },
  });
  const permitParts = splitSignature(permitSignature);
  const response = await fetch(`${RELAYER_API}/meta/sell`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: account,
      sellToken: leg.token,
      fee: leg.fee,
      amountIn: leg.amountIn.toString(),
      amountOutMinimum: leg.minOut.toString(),
      sqrtPriceLimitX96: "0",
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      permit: {
        value: leg.amountIn.toString(),
        nonce: permit.nonce.toString(),
        deadline: deadline.toString(),
        ...permitParts,
      },
      signature,
    }),
  });
  const payload = await response.json() as { txHash?: Hex; error?: string };
  if (!response.ok || !payload.txHash) throw new Error(payload.error || "The signature relay rejected this sell.");
  await waitForReceipt(payload.txHash);
  return payload.txHash;
}

function splitSignature(signature: Hex) {
  return {
    r: `0x${signature.slice(2, 66)}` as Hex,
    s: `0x${signature.slice(66, 130)}` as Hex,
    v: Number.parseInt(signature.slice(130, 132), 16),
  };
}

export function formatWif(value: bigint) {
  return `${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 3 })} WIF`;
}

export function formatUsdg(value: bigint) {
  return `${Number(formatUnits(value, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDG`;
}

export function formatEth(value: bigint) {
  return `${Number(formatEther(value)).toFixed(5)} ETH`;
}

export function formatDate(timestamp: bigint) {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(Number(timestamp) * 1000);
}

export { LEGAL_NOTICE, RESTRICTED_JURISDICTIONS_TEXT, RESTRICTED_JURISDICTIONS_URL };

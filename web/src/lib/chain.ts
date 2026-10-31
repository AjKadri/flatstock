import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  encodePacked,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  addresses,
  assets,
  chain,
  delegateAbi,
  erc20Abi,
  feedAbi,
  LEGAL_NOTICE,
  lockAbi,
  MAX_SLIPPAGE_BPS,
  NON_LOCKER_GAS_WIF,
  ORACLE_MAX_AGE_SECONDS,
  quoterAbi,
  RELAYER_API,
  routerAbi,
  ROUND_ID,
  STATS_FROM_BLOCK,
  voteCastEvent,
  votesAbi,
} from "../config";

export const publicClient = createPublicClient({ chain, transport: http() });

export type ConnectedWallet = ReturnType<typeof createWalletClient>;
export type RoundState = {
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
  const [opensAt, closesAt, assetCount, totalVotes, closed] =
    (await publicClient.readContract({
      address: addresses.votes,
      abi: votesAbi,
      functionName: "rounds",
      args: [ROUND_ID],
    })) as readonly [bigint, bigint, number, bigint, boolean];
  const now = await getLatestTimestamp();
  const weights = await Promise.all(
    assets.map(async (_, index) => {
      if (index >= assetCount || totalVotes === 0n) return 0n;
      return (await publicClient.readContract({
        address: addresses.votes,
        abi: votesAbi,
        functionName: "weightBps",
        args: [ROUND_ID, index],
      })) as bigint;
    }),
  );
  return {
    opensAt,
    closesAt,
    assetCount,
    totalVotes,
    closed,
    isOpen: !closed && now < closesAt,
    weights,
  };
}

export async function readVoteBurned() {
  try {
    const logs = await publicClient.getLogs({
      address: addresses.votes,
      event: voteCastEvent,
      fromBlock: STATS_FROM_BLOCK,
      toBlock: "latest",
    });
    return BigInt(logs.length);
  } catch {
    const round = await readRound();
    return round.totalVotes;
  }
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
      const price = holding?.priceUsd == null ? null : Number(holding.priceUsd) / 1e8;
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
  const code = await publicClient.getCode({ address: account });
  return { eth, wif, usdg, locked, delegated: code?.toLowerCase().startsWith("0xef0100") ?? false };
}

export async function buildBuyPlan(amountText: string, round: RoundState): Promise<BuyLeg[]> {
  if (!round.isOpen) throw new Error("No vote round is open on mainnet.");
  if (round.totalVotes === 0n) throw new Error("The open round has no votes yet.");
  const total = parseUnits(amountText, 6);
  if (total <= 0n) throw new Error("Enter a positive USDG amount.");
  const active = assets.filter((_, index) => index < round.assetCount && round.weights[index] > 0n);
  if (active.length === 0) throw new Error("The open round has no weighted assets.");
  let allocated = 0n;
  const legs: BuyLeg[] = [];
  const now = await getLatestTimestamp();
  for (const [position, asset] of active.entries()) {
    const index = assets.indexOf(asset);
    const amountIn = position === active.length - 1
      ? total - allocated
      : (total * round.weights[index]) / (round.totalVotes * 10_000n);
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
    const minOut = (quoteOut * (10_000n - MAX_SLIPPAGE_BPS)) / 10_000n;
    if (minOut <= 0n) throw new Error(`${asset.symbol}: invalid minimum output.`);
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
  const minOut = (quoteOut * (10_000n - MAX_SLIPPAGE_BPS)) / 10_000n;
  if (minOut <= 0n) throw new Error(`${symbol}: invalid minimum output.`);
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

export function buildBuyCall(leg: BuyLeg, gasWifAmount: bigint): Hex {
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "buyUniswap",
    args: [addresses.usdg, leg.token, leg.fee, leg.amountIn, leg.minOut, 0n, gasWifAmount],
  });
}

export function buildSellCall(leg: SellLeg, gasWifAmount: bigint): Hex {
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "buyUniswap",
    args: [leg.token, addresses.usdg, leg.fee, leg.amountIn, leg.minOut, 0n, gasWifAmount],
  });
}

export function buildBatch(calls: BatchCall[]): Hex {
  return encodeFunctionData({
    abi: delegateAbi,
    functionName: "executeBatch",
    args: [calls],
  });
}

export async function sendDelegatedBatch(wallet: ConnectedWallet, account: Address, calls: BatchCall[]) {
  const data = buildBatch(calls);
  const response = await fetch(`${RELAYER_API}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: account, data }),
  });
  const payload = (await response.json()) as { txHash?: Hex; error?: string };
  if (!response.ok || !payload.txHash) throw new Error(payload.error || "The sponsor rejected this request.");
  await publicClient.waitForTransactionReceipt({ hash: payload.txHash });
  return payload.txHash;
}

export async function sendDirect(
  wallet: ConnectedWallet,
  account: Address,
  target: Address,
  data: Hex,
) {
  const hash = await wallet.sendTransaction({ account, to: target, data, chain });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
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

export { LEGAL_NOTICE };

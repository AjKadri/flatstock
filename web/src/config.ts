import {
  defineChain,
  parseAbi,
  parseAbiItem,
  type Address,
} from "viem";

export const CHAIN_ID = 4663;
export const RPC_URL =
  import.meta.env.VITE_RPC_URL || "/api/rpc";
export const EXPLORER_URL =
  import.meta.env.VITE_EXPLORER_URL || "https://robinhoodchain.blockscout.com";
export const RELAYER_API = import.meta.env.VITE_RELAYER_API || "/api";
export const ROUND_ID = BigInt(import.meta.env.VITE_ROUND_ID || "2");
export const STATS_FROM_BLOCK = BigInt(
  import.meta.env.VITE_STATS_FROM_BLOCK || "101593767",
);
export const LEGAL_NOTICE =
  "Not available to US persons. Not investment advice.";

export const chain = defineChain({
  id: CHAIN_ID,
  name: "Chain 4663",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const addresses = {
  wif: "0x5173b8eA6923c2d40267890D45C46a3480954773" as Address,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  votes: "0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9" as Address,
  lock: "0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121" as Address,
  buyRouter: "0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA" as Address,
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as Address,
  uniswap: "0xCaf681a66D020601342297493863E78C959E5cb2" as Address,
};

export const assets = [
  {
    symbol: "AAPL",
    token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" as Address,
    feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" as Address,
    fee: 500,
  },
  {
    symbol: "NVDA",
    token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address,
    feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" as Address,
    fee: 500,
  },
  {
    symbol: "MSFT",
    token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" as Address,
    feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" as Address,
    fee: 3000,
  },
] as const;

export const ONE_WIF = 1_000_000_000_000_000_000n;
export const NON_LOCKER_GAS_WIF = 10_000_000_000_000_000n;
export const MAX_SLIPPAGE_BPS = 200n;
export const ORACLE_MAX_AGE_SECONDS = 86_400n;

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const votesAbi = parseAbi([
  "function rounds(uint256) view returns (uint64 opensAt, uint64 closesAt, uint8 assetCount, uint256 totalVotes, bool closed)",
  "function vote(uint256 roundId, uint8 assetIndex)",
  "function weightBps(uint256 roundId, uint8 assetIndex) view returns (uint256)",
]);

export const lockAbi = parseAbi([
  "function lock(uint256 amount)",
  "function locked(address account) view returns (uint256)",
  "function isLocked(address account) view returns (bool)",
]);

export const routerAbi = parseAbi([
  "function buyUniswap(address sellToken, address buyToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96, uint256 gasWifAmount) returns (uint256 amountOut)",
]);

export const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const delegateAbi = parseAbi([
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

export const voteCastEvent = parseAbiItem(
  "event VoteCast(uint256 indexed roundId, address indexed voter, uint8 indexed assetIndex)",
);

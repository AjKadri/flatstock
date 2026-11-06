import {
  defineChain,
  parseAbi,
  parseAbiItem,
  type Address,
} from "viem";

export const CHAIN_ID = 4663;
export const NETWORK_LABEL = "Robinhood Chain";
export const RPC_URL =
  import.meta.env.VITE_RPC_URL || "/api/rpc";
export const EXPLORER_URL =
  import.meta.env.VITE_EXPLORER_URL || "https://robinhoodchain.blockscout.com";
export const RELAYER_API = import.meta.env.VITE_RELAYER_API || "/api";
export const FALLBACK_ROUND_ID = BigInt(import.meta.env.VITE_ROUND_ID || "2");
export const STATS_FROM_BLOCK = BigInt(
  import.meta.env.VITE_STATS_FROM_BLOCK || "101593767",
);
export const MIX_VOTE_SHARE_BPS = BigInt(import.meta.env.VITE_VOTE_SHARE_BPS || "5000");
export const MIX_MAX_WEIGHT_BPS = 5000n;
// The deployed contract addresses are public, so they are the defaults. The app no longer depends
// on VITE_* flags being set in Vercel for buying to work.
export const MIX_RULES_ENABLED = true;
export const SIGNATURE_SAFE_WRITES_ENABLED = true;
export const LEGAL_NOTICE =
  "Not available to US persons, or in Canada, the UK, Switzerland or other restricted jurisdictions. Not investment advice.";
export const RESTRICTED_JURISDICTIONS_URL = "https://docs.robinhood.com/rhj/restricted-jurisdictions";
export const RESTRICTED_JURISDICTIONS_TEXT =
  "Stock Tokens are restricted for the United States and U.S. persons, Canada, the United Kingdom and Switzerland, and prohibited for Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar and Venezuela. Source: docs.robinhood.com/rhj/restricted-jurisdictions, checked 5 Nov 2026. The list may change.";

export const chain = defineChain({
  id: CHAIN_ID,
  name: NETWORK_LABEL,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const addresses = {
  wif: "0x5173b8eA6923c2d40267890D45C46a3480954773" as Address,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  votes: (import.meta.env.VITE_VOTES_ADDRESS || "0x4BB945800d588E6B4DB287b3fCe9C13f7825A968") as Address,
  lock: "0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121" as Address,
  buyRouter: (import.meta.env.VITE_META_ROUTER_ADDRESS || "0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7") as Address,
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as Address,
  uniswap: "0xCaf681a66D020601342297493863E78C959E5cb2" as Address,
};
export const legacyBuyRouterAddress = "0x5B08a91F8C8666C85e636bbE61Aed3b059B61FfA" as Address;
export const metaVotesAddress = (import.meta.env.VITE_META_VOTES_ADDRESS || addresses.votes) as Address;
export const metaRouterAddress = (import.meta.env.VITE_META_ROUTER_ADDRESS || addresses.buyRouter) as Address;
export const legacyVotesAddress = "0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9" as Address;
export const previousReplacementVotesAddress = "0xD49249D2a5CffBCF35B6560857d1d1C703802e78" as Address;
export const retiredVotes68d2Address = "0x68d2622f3bbf6BE80CdfED679489de344410C7Db" as Address;
// Retired test contracts, oldest first. Their votes count in the $WIF-burned total and are listed
// under "Test rounds (earlier contract)". The 0x68d2 contract holds 1 real burned vote that the
// old total missed.
export const retiredVoteContracts = [
  { address: legacyVotesAddress, label: "Earlier contract 1 (0xEDB1…B8E9)" },
  { address: previousReplacementVotesAddress, label: "Earlier contract 2 (0xD492…2e78)" },
  { address: retiredVotes68d2Address, label: "Earlier contract 3 (0x68d2…C7Db)" },
] as const;
export const FIRST_MAIN_ROUND = 4n;
export const voteStatsAddresses = Array.from(
  new Set([
    addresses.votes.toLowerCase(),
    ...retiredVoteContracts.map((item) => item.address.toLowerCase()),
  ]),
).map((address) => address as Address);

// Order matters: it is the on-chain asset index. Rounds with assetCount N use the first N entries,
// so round 4 (3 stocks) keeps indexes 0-2 and round 5 uses all 8.
export const assets = [
  {
    symbol: "AAPL",
    name: "Apple",
    token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" as Address,
    feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" as Address,
    fee: 500,
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address,
    feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" as Address,
    fee: 500,
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" as Address,
    feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" as Address,
    fee: 3000,
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" as Address,
    feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" as Address,
    fee: 3000,
  },
  {
    symbol: "GOOGL",
    name: "Alphabet",
    token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" as Address,
    feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" as Address,
    fee: 500,
  },
  {
    symbol: "META",
    name: "Meta",
    token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" as Address,
    feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" as Address,
    fee: 3000,
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" as Address,
    feed: "0x4A1166a659A55625345e9515b32adECea5547C38" as Address,
    fee: 3000,
  },
  {
    symbol: "SPY",
    name: "S&P 500 ETF",
    token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" as Address,
    feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A" as Address,
    fee: 500,
  },
] as const;

export const MIN_BUY_USDG = 5;
export const ONE_WIF = 1_000_000_000_000_000_000n;
export const MAX_SLIPPAGE_BPS = 200n;
export const ORACLE_MAX_AGE_SECONDS = 86_400n;

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const votesAbi = parseAbi([
  "function rounds(uint256) view returns (uint64 opensAt, uint64 closesAt, uint8 assetCount, uint256 totalVotes, bool closed)",
  "function latestRoundId() view returns (uint256)",
  "function vote(uint256 roundId, uint8 assetIndex)",
  "function voteNonces(address voter) view returns (uint256)",
  "function voteBySig(address voter, uint256 roundId, uint8 assetIndex, uint256 nonce, uint256 deadline, bytes signature)",
  "function votesFor(uint256 roundId, uint8 assetIndex) view returns (uint256)",
  "function hasVoted(uint256 roundId, address voter) view returns (bool)",
  "function voteShareBps(uint256 roundId) view returns (uint16)",
  "function weightBps(uint256 roundId, uint8 assetIndex) view returns (uint256)",
]);

export const lockAbi = parseAbi([
  "function lock(uint256 amount)",
  "function unlock(uint256 amount)",
  "function locked(address account) view returns (uint256)",
  "function isLocked(address account) view returns (bool)",
]);

export const routerAbi = parseAbi([
  "function buyUniswap(address sellToken, address buyToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
  "function sellUniswap(address sellToken, address buyToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
  "function buyMix((address token, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)[] legs, uint256 amountIn) returns (uint256[] amountsOut)",
  "function buyMixBySig(address user, (address token, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)[] legs, uint256 amountIn, uint256 nonce, uint256 deadline, (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) permitData, bytes signature) returns (uint256[] amountsOut)",
  "function sellBySig(address user, address sellToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96, uint256 nonce, uint256 deadline, bytes signature) returns (uint256 amountOut)",
  "function buyNonces(address user) view returns (uint256)",
  "function sellNonces(address user) view returns (uint256)",
]);

export const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const permitAbi = parseAbi([
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function name() view returns (string)",
]);

export const voteCastEvent = parseAbiItem(
  "event VoteCast(uint256 indexed roundId, address indexed voter, uint8 indexed assetIndex)",
);
export const tradeExecutedEvent = parseAbiItem(
  "event TradeExecuted(address indexed account, address indexed sellToken, address indexed buyToken, uint256 amountIn, uint256 amountOut, uint8 kind)",
);
export const mixBoughtEvent = parseAbiItem(
  "event MixBought(address indexed account, address indexed sellToken, address indexed buyToken, uint256 amountIn, uint256 amountOut, bool lockedAccount)",
);

// Which Flatstock contracts have verified source on Blockscout/Sourcify. The approval notice only says
// "verified" for contracts where this is true. All three verified on Sourcify (exact match).
export const contractVerified = { votes: true, router: true, lock: true } as const;

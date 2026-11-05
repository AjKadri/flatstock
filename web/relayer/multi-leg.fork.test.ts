// Fork test: gasless (signed) buys with 2, 4 and 8 legs and a gasless sell, on REAL pools, against a
// LOCAL anvil fork only (FORK_RPC_URL). The user key is generated here; funds are moved inside the fork.
// It uses the router exactly as the relayer does (buyMixBySig / permit + sellBySig) and reports gas cost.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPublicClient, createTestClient, createWalletClient, decodeFunctionResult, encodeFunctionData, encodePacked, formatEther,
  formatUnits, http, parseAbi, parseEther, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const forkUrl = process.env.FORK_RPC_URL;
const REAL_RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const ROUTER = "0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7" as Address;
const LOCK = "0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121" as Address;
const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773" as Address;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const QUOTER = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as Address;
const RELAYER = "0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4" as Address;
const WIF_WHALE = "0x3554121694a2472300f079Afa4B1fC7F9aAFac01" as Address; // project test wallet, 984 WIF
const STOCKS = [
  { symbol: "AAPL", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", fee: 500 },
  { symbol: "NVDA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", fee: 500 },
  { symbol: "MSFT", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", fee: 3000 },
  { symbol: "AMZN", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", fee: 3000 },
  { symbol: "GOOGL", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", fee: 500 },
  { symbol: "META", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", fee: 3000 },
  { symbol: "TSLA", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", fee: 3000 },
  { symbol: "SPY", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", fee: 500 },
] as { symbol: string; token: Address; fee: number }[];

const erc20 = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)", "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)", "function name() view returns (string)", "function nonces(address) view returns (uint256)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);
const lockAbi = parseAbi(["function lock(uint256 amount)", "function isLocked(address) view returns (bool)"]);
const quoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] a, uint32[] b, uint256 gas)",
  "function factory() view returns (address)",
]);
const factoryAbi = parseAbi(["function getPool(address a, address b, uint24 fee) view returns (address)"]);
const routerAbi = parseAbi([
  "function buyNonces(address) view returns (uint256)", "function sellNonces(address) view returns (uint256)",
  "function buyMixBySig(address user, (address token, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)[] legs, uint256 amountIn, uint256 nonce, uint256 deadline, (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) permitData, bytes signature) returns (uint256[])",
  "function sellBySig(address user, address sellToken, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96, uint256 nonce, uint256 deadline, bytes signature) returns (uint256)",
]);
const legComponents = [
  { name: "token", type: "address" }, { name: "fee", type: "uint24" }, { name: "amountIn", type: "uint256" },
  { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
] as const;
const permitTypes = { Permit: [
  { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] } as const;

test("config.ts lists the same 8 stocks, tokens and fee tiers as this test", () => {
  const src = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
  for (const stock of STOCKS) {
    const block = src.slice(src.indexOf(`symbol: "${stock.symbol}"`));
    assert.ok(block.slice(0, 400).includes(stock.token), `${stock.symbol} token in config`);
    assert.ok(new RegExp(`fee: ${stock.fee},`).test(block.slice(0, 400)), `${stock.symbol} fee in config`);
  }
  const assetsBlock = src.slice(src.indexOf("export const assets = ["), src.indexOf("] as const;", src.indexOf("export const assets = [")));
  assert.equal([...assetsBlock.matchAll(/symbol: "/g)].length, 8);
});

test("gasless 2, 4 and 8 leg buys and a gasless sell on real pools", { skip: !forkUrl }, async (t) => {
  assert.ok(forkUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(forkUrl), "FORK_RPC_URL must be a local anvil fork");
  const pub = createPublicClient({ transport: http(forkUrl) });
  const real = createPublicClient({ transport: http(REAL_RPC) });
  const anvil = createTestClient({ mode: "anvil", transport: http(forkUrl) });
  const wallet = createWalletClient({ transport: http(forkUrl) });
  const send = async (from: Address, to: Address, data: Hex) => {
    const hash = await wallet.sendTransaction({ account: from, to, data, chain: null });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", `tx to ${to} reverted`);
    return receipt;
  };
  const impersonate = async (address: Address) => { await anvil.setBalance({ address, value: parseEther("10") }); await anvil.impersonateAccount({ address }); };

  const user = privateKeyToAccount(generatePrivateKey());
  await impersonate(user.address); await impersonate(RELAYER); await impersonate(WIF_WHALE);
  const gasPriceLive = await real.getGasPrice();

  // 10 WIF lock for the user (needed for signed buys), then 400 USDG from the AAPL/USDG pool.
  await send(WIF_WHALE, WIF, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [user.address, parseEther("10")] }));
  await send(user.address, WIF, encodeFunctionData({ abi: erc20, functionName: "approve", args: [LOCK, parseEther("10")] }));
  await send(user.address, LOCK, encodeFunctionData({ abi: lockAbi, functionName: "lock", args: [parseEther("10")] }));
  assert.equal(await pub.readContract({ address: LOCK, abi: lockAbi, functionName: "isLocked", args: [user.address] }), true);
  const factory = await pub.readContract({ address: QUOTER, abi: quoterAbi, functionName: "factory" });
  const pool = await pub.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [USDG, STOCKS[0].token, 500] });
  await impersonate(pool);
  await send(pool, USDG, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [user.address, 400_000_000n] }));

  const quote = async (token: Address, fee: number, tokenIn: Address, amountIn: bigint) => {
    const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInput", args: [encodePacked(["address", "uint24", "address"], [tokenIn, fee, token]), amountIn] });
    const { data: out } = await pub.call({ to: QUOTER, data });
    return decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInput", data: out! })[0];
  };
  const stamp = async () => (await pub.getBlock()).timestamp;
  const rows: string[] = [];

  for (const count of [2, 4, 8]) {
    const picked = STOCKS.slice(0, count);
    const per = 5_000_000n / BigInt(count) * 2n; // about 10 USDG split across the legs
    const legs: { token: Address; fee: number; amountIn: bigint; amountOutMinimum: bigint; sqrtPriceLimitX96: bigint }[] = [];
    for (const stock of picked) {
      const out = await quote(stock.token, stock.fee, USDG, per);
      legs.push({ token: stock.token, fee: stock.fee, amountIn: per, amountOutMinimum: out * 98n / 100n, sqrtPriceLimitX96: 0n });
    }
    const amountIn = legs.reduce((s, l) => s + l.amountIn, 0n);
    const deadline = (await stamp()) + 900n;
    const nonce = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "buyNonces", args: [user.address] });
    const pNonce = await pub.readContract({ address: USDG, abi: erc20, functionName: "nonces", args: [user.address] });
    const permitSig = await user.signTypedData({
      domain: { name: "Global Dollar", version: "1", chainId: 4663, verifyingContract: USDG }, types: permitTypes, primaryType: "Permit",
      message: { owner: user.address, spender: ROUTER, value: amountIn, nonce: pNonce, deadline },
    });
    const { keccak256, encodeAbiParameters, hexToBigInt } = await import("viem");
    const legsHash = keccak256(encodeAbiParameters([{ type: "tuple[]", components: legComponents }], [legs]));
    const sig = await user.signTypedData({
      domain: { name: "Flatstock Trades", version: "1", chainId: 4663, verifyingContract: ROUTER },
      types: { BuyMix: [{ name: "user", type: "address" }, { name: "legsHash", type: "bytes32" }, { name: "amountIn", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "BuyMix", message: { user: user.address, legsHash, amountIn, nonce, deadline },
    });
    const split = (s: Hex) => ({ r: `0x${s.slice(2, 66)}` as Hex, s: `0x${s.slice(66, 130)}` as Hex, v: Number.parseInt(s.slice(130, 132), 16) });
    const before = await Promise.all(picked.map((s) => pub.readContract({ address: s.token, abi: erc20, functionName: "balanceOf", args: [user.address] })));
    const usdgBefore = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [user.address] });
    const receipt = await send(RELAYER, ROUTER, encodeFunctionData({ abi: routerAbi, functionName: "buyMixBySig", args: [user.address, legs, amountIn, nonce, deadline, { value: amountIn, deadline, ...split(permitSig) }, sig] }));
    const after = await Promise.all(picked.map((s) => pub.readContract({ address: s.token, abi: erc20, functionName: "balanceOf", args: [user.address] })));
    const usdgAfter = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [user.address] });
    picked.forEach((s, i) => assert.ok(after[i] - before[i] >= legs[i].amountOutMinimum, `${s.symbol} received at least its minimum output`));
    assert.equal(usdgBefore - usdgAfter, amountIn, "exactly the signed amount left the user's wallet");
    void hexToBigInt;
    const costFork = receipt.gasUsed * receipt.effectiveGasPrice, costLive = receipt.gasUsed * gasPriceLive;
    rows.push(`buy ${count} legs: gas ${receipt.gasUsed}, cost ${formatEther(costLive)} ETH at live gas price (${formatEther(costFork)} at fork price)`);
    t.diagnostic(rows[rows.length - 1]);
  }

  // Gasless sell of the AAPL received above: Stock Token permit tx + sellBySig tx, both paid by the relayer.
  const sellToken = STOCKS[0].token, sellFee = STOCKS[0].fee;
  const held = await pub.readContract({ address: sellToken, abi: erc20, functionName: "balanceOf", args: [user.address] });
  const sellAmount = held / 2n;
  const quoteOut = await quote(sellToken, sellFee, sellToken, sellAmount).catch(async () => {
    const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInput", args: [encodePacked(["address", "uint24", "address"], [sellToken, sellFee, USDG]), sellAmount] });
    const { data: out } = await pub.call({ to: QUOTER, data });
    return decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInput", data: out! })[0];
  });
  const sellMin = quoteOut * 98n / 100n;
  const deadline = (await stamp()) + 300n;
  const sNonce = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "sellNonces", args: [user.address] });
  const tName = await pub.readContract({ address: sellToken, abi: erc20, functionName: "name" });
  const tNonce = await pub.readContract({ address: sellToken, abi: erc20, functionName: "nonces", args: [user.address] });
  const permitSig = await user.signTypedData({ domain: { name: tName, version: "1", chainId: 4663, verifyingContract: sellToken }, types: permitTypes, primaryType: "Permit", message: { owner: user.address, spender: ROUTER, value: sellAmount, nonce: tNonce, deadline } });
  const sellSig = await user.signTypedData({
    domain: { name: "Flatstock Trades", version: "1", chainId: 4663, verifyingContract: ROUTER },
    types: { SellStock: [{ name: "user", type: "address" }, { name: "token", type: "address" }, { name: "fee", type: "uint24" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "SellStock", message: { user: user.address, token: sellToken, fee: sellFee, amountIn: sellAmount, amountOutMinimum: sellMin, nonce: sNonce, deadline },
  });
  const ps = { r: `0x${permitSig.slice(2, 66)}` as Hex, s: `0x${permitSig.slice(66, 130)}` as Hex, v: Number.parseInt(permitSig.slice(130, 132), 16) };
  const usdgBefore = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [user.address] });
  const r1 = await send(RELAYER, sellToken, encodeFunctionData({ abi: erc20, functionName: "permit", args: [user.address, ROUTER, sellAmount, deadline, ps.v, ps.r, ps.s] }));
  const r2 = await send(RELAYER, ROUTER, encodeFunctionData({ abi: routerAbi, functionName: "sellBySig", args: [user.address, sellToken, sellFee, sellAmount, sellMin, 0n, sNonce, deadline, sellSig] }));
  const usdgAfter = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [user.address] });
  assert.ok(usdgAfter - usdgBefore >= sellMin, "sell paid at least the signed minimum");
  const gas = r1.gasUsed + r2.gasUsed;
  rows.push(`sell 1 stock (permit + sell, 2 txs): gas ${gas}, cost ${formatEther(gas * gasPriceLive)} ETH at live gas price; received ${formatUnits(usdgAfter - usdgBefore, 6)} USDG`);
  t.diagnostic(rows[rows.length - 1]);
  console.log(rows.join("\n"));
});

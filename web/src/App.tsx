import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  addresses,
  assets,
  chain,
  contractVerified,
  EXPLORER_URL,
  LEGAL_NOTICE,
  MIN_BUY_USDG,
  RESTRICTED_JURISDICTIONS_TEXT,
  RESTRICTED_JURISDICTIONS_URL,
  lockAbi,
  MIX_RULES_ENABLED,
  NETWORK_LABEL,
  ONE_WIF,
  RELAYER_API,
  SIGNATURE_SAFE_WRITES_ENABLED,
  votesAbi,
} from "./config";
import {
  buildApprove,
  buildBuyMixCall,
  buildBuyPlan,
  buildSellCall,
  buildSellPlan,
  connectWallet,
  formatDate,
  formatEth,
  formatWeightBps,
  formatUsdg,
  formatWif,
  publicClient,
  readHoldings,
  readCorporateActions,
  readAllowance,
  readHistory,
  readRound,
  readVoteBurned,
  readWalletState,
  signMetaBuy,
  signMetaSell,
  signMetaVote,
  sendDirect,
  readMyVote,
  waitForTransactionFinality,
  type BuyLeg,
  type ConnectedWallet,
  type CorporateAction,
  type Holding,
  type HistoryItem,
  type RoundState,
  type SellLeg,
} from "./lib/chain";
import { addressLink, pickBuyMix, readRoundHistory, txLink, type BuyMix, type PastRound, type RoundHistory } from "./lib/rounds";
import { renormaliseWeights } from "./lib/rounds-logic";
import { readPrices, type PriceMap } from "./lib/prices";
import { AllocationBar, ApprovalNote, EmptyLine, Loader, Logo, MixTable, ProgressLine, Rule, SignSummary, type MixRow } from "./ui";
import { cacheGet, cacheSet } from "./lib/cache";
import { gasState, sponsorshipOn } from "./lib/gas";

type Health = {
  enabled: boolean;
  killSwitch: boolean;
  dailyCap: number;
  usage?: number;
  error?: string;
  sponsorshipPaused?: boolean;
  sponsorshipPausedReason?: string | null;
};


async function fetchRelayHealth(wallet: string): Promise<Health | null> {
  try {
    const response = await fetch(`${RELAYER_API}/health`, { headers: { "x-wallet": wallet } });
    return response.ok ? ((await response.json()) as Health) : null;
  } catch {
    return null;
  }
}

// Gasless only when the relayer answered and is neither switched off nor low on ETH.
function relayAvailable(health: Health | null) {
  return sponsorshipOn(health);
}
type SubmittedTx = { action: "vote" | "buy" | "sell"; hash: Hex; finality?: string };

// Turn raw viem/RPC errors into one short, readable line. Full detail stays in the console.
async function readHasVoted(roundId: bigint, voter: Address) {
  try {
    return (await publicClient.readContract({ address: addresses.votes, abi: votesAbi, functionName: "hasVoted", args: [roundId, voter] })) as boolean;
  } catch {
    return false;
  }
}

const ALREADY_VOTED_TEXT = "You have already voted in this round. Each wallet gets one vote per round, so no WIF was spent. Use a different wallet to vote again, or wait for the next round.";

function friendlyError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const short = (error as { shortMessage?: string }).shortMessage;
  const text = short || error.message;
  if (/already ?voted/i.test(text)) return ALREADY_VOTED_TEXT;
  if (/user rejected|user denied|rejected the request/i.test(text)) return "You cancelled in your wallet. Nothing was sent.";
  if (text.length > 220 || /\n/.test(text) || /request body|http request failed/i.test(text)) {
    console.error(error);
    return `${fallback} Please try again in a moment.`;
  }
  return text;
}

function App() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [round, setRound] = useState<RoundState | null>(() => cacheGet<RoundState>("round"));
  const [corporateActions, setCorporateActions] = useState<CorporateAction[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [walletState, setWalletState] = useState<Awaited<ReturnType<typeof readWalletState>> | null>(null);
  const [votesBurned, setVotesBurned] = useState<bigint>(0n);
  const [health, setHealth] = useState<Health | null>(null);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [buyMix, setBuyMix] = useState<BuyMix | null>(() => cacheGet<BuyMix>("buyMix"));
  // "loading" until the round data has actually come back; only then can we say there is no mix.
  const [mixLoad, setMixLoad] = useState<"loading" | "ready" | "failed">(() => (cacheGet("round") ? "ready" : "loading"));
  const [roundHistory, setRoundHistory] = useState<RoundHistory | null>(() => cacheGet<RoundHistory>("roundHistory"));
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const [revealed, setRevealed] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [buyAmount, setBuyAmount] = useState("5");
  const [selectedAsset, setSelectedAsset] = useState<number | null>(null);
  const [prices, setPrices] = useState<PriceMap>(() => cacheGet<PriceMap>("prices") ?? {});
  const [plan, setPlan] = useState<BuyLeg[]>([]);
  const [sellSymbol, setSellSymbol] = useState("NVDA");
  const [sellAmount, setSellAmount] = useState("0.001");
  const [sellPlan, setSellPlan] = useState<SellLeg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingVote, setConfirmingVote] = useState(false);
  const [voteStep, setVoteStep] = useState<string | null>(null);
  const [myVote, setMyVote] = useState<{ assetIndex: number; hash: Hex } | null>(null);
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);
  const [confirmingBuy, setConfirmingBuy] = useState(false);
  const [confirmingSell, setConfirmingSell] = useState(false);
  const [submittedTx, setSubmittedTx] = useState<SubmittedTx | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const hasSponsorLock = walletState?.locked !== undefined && walletState.locked >= 10n * ONE_WIF;
  const gas = gasState({ connected: Boolean(account), locked: walletState?.locked, lockedLabel: walletState ? formatWif(walletState.locked) : "", health, signatureWrites: SIGNATURE_SAFE_WRITES_ENABLED });
  const useRelay = gas.useRelay;

  const refresh = useCallback(async (connectedAccount = account) => {
    try {
      const [nextRound, burned] = await Promise.all([
        readRound(),
        readVoteBurned(),
      ]);
      setRound(nextRound);
      cacheSet("round", nextRound);
      const nextMix = await pickBuyMix(nextRound);
      setBuyMix(nextMix);
      cacheSet("buyMix", nextMix);
      setMixLoad("ready");
      setVotesBurned(burned);
      setCorporateActions(await readCorporateActions(
        assets.slice(0, nextRound.assetCount).map((asset) => asset.symbol),
      ));
      if (connectedAccount) {
        const [nextHoldings, nextWallet] = await Promise.all([
          readHoldings(connectedAccount),
          readWalletState(connectedAccount),
        ]);
        setHoldings(nextHoldings);
        setWalletState(nextWallet);
        const voted = await readHasVoted(nextRound.roundId, connectedAccount);
        setAlreadyVoted(voted);
        setMyVote(voted ? await readMyVote(nextRound.roundId, connectedAccount) : null);
        setHistory(await readHistory(connectedAccount));
        setHealth(await fetchRelayHealth(connectedAccount));
      }
    } catch (error) {
      setMixLoad((state) => (state === "ready" ? state : "failed"));
      setMessage({ tone: "error", text: friendlyError(error, "Could not refresh chain state.") });
    }
  }, [account]);

  const connect = async () => {
    try {
      setMessage(null);
      const result = await connectWallet();
      setWallet(result.wallet);
      setAccount(result.account);
      setChainId(await result.wallet.getChainId());
      await refresh(result.account);
    } catch (error) {
      setMessage({ tone: "error", text: friendlyError(error, "Wallet connection was cancelled.") });
    }
  };

  const switchNetwork = async () => {
    try {
      if (!wallet) return;
      await wallet.switchChain({ id: chain.id });
      setChainId(await wallet.getChainId());
      setMessage({ tone: "success", text: "Connected to the correct network." });
    } catch (error) {
      setMessage({ tone: "error", text: friendlyError(error, "Network switch was cancelled.") });
    }
  };

  const disconnect = () => {
    setAccount(null);
    setWallet(null);
    setChainId(null);
    setWalletState(null);
    setHoldings([]);
    setHistory([]);
    setHealth(null);
    setPlan([]);
    setSellPlan(null);
    setSubmittedTx(null);
    setConfirmingVote(false);
    setConfirmingBuy(false);
    setConfirmingSell(false);
    setMessage({ tone: "info", text: "Wallet disconnected from this page." });
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let live = true;
    void readRoundHistory().then((value) => { if (live) { setRoundHistory(value); cacheSet("roundHistory", value); } }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    const load = (force: boolean) => { void readPrices(force).then((value) => { if (live) { setPrices(value); cacheSet("prices", value); } }).catch(() => undefined); };
    load(false);
    const timer = window.setInterval(() => load(true), 5 * 60 * 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;

    const handleChainChanged = (...args: unknown[]) => {
      const rawChainId = args[0];
      const nextChainId = typeof rawChainId === "string"
        ? rawChainId.startsWith("0x") ? Number.parseInt(rawChainId, 16) : Number(rawChainId)
        : Number(rawChainId);
      setChainId(Number.isFinite(nextChainId) ? nextChainId : null);
      setPlan([]);
      if (nextChainId === chain.id) {
        setMessage({ tone: "success", text: `Connected to ${NETWORK_LABEL} (4663).` });
        void refresh();
      } else {
        setMessage({ tone: "error", text: `Wrong network. Switch to ${NETWORK_LABEL} (4663).` });
      }
    };

    const handleAccountsChanged = (...args: unknown[]) => {
      const nextAccounts = Array.isArray(args[0]) ? args[0] as string[] : [];
      const nextAccount = nextAccounts[0] as Address | undefined;
      if (!nextAccount) {
        setAccount(null);
        setWallet(null);
        setWalletState(null);
        setHoldings([]);
        setHistory([]);
        setHealth(null);
        setPlan([]);
        return;
      }
      setAccount(nextAccount);
      setPlan([]);
      void refresh(nextAccount);
    };

    provider.on("chainChanged", handleChainChanged);
    provider.on("accountsChanged", handleAccountsChanged);
    return () => {
      provider.removeListener?.("chainChanged", handleChainChanged);
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (!account) return;
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [account, refresh]);

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
  // Poll the chain for up to ~25s: the vote may have landed even if the wallet or network reported an error.
  const voteLanded = async (roundId: bigint, voter: Address) => {
    for (let i = 0; i < 10; i += 1) {
      if (await readHasVoted(roundId, voter)) return true;
      await sleep(2500);
    }
    return false;
  };
  const userRejected = (error: unknown) => {
    const text = `${(error as { shortMessage?: string })?.shortMessage ?? ""} ${error instanceof Error ? error.message : ""}`;
    return (error as { code?: number })?.code === 4001 || /user rejected|user denied|rejected the request|request rejected/i.test(text);
  };
  const finishVote = async (roundId: bigint, voter: Address, hash?: Hex, viaRelay = false) => {
    const found = await readMyVote(roundId, voter);
    const txHash = hash ?? found?.hash;
    setMyVote(found ?? (txHash ? { assetIndex: selectedAsset ?? 0, hash: txHash } : null));
    setAlreadyVoted(true);
    if (txHash) setSubmittedTx({ action: "vote", hash: txHash });
    setMessage({ tone: "success", text: viaRelay ? "Vote cast. Exactly 1 $WIF was burned." : "Vote cast. Exactly 1 $WIF was burned." });
    setRevealed(true);
    await refresh();
    void readRoundHistory().then((value) => { setRoundHistory(value); cacheSet("roundHistory", value); });
  };

  const runVote = async () => {
    if (!wallet || !account || !round || selectedAsset === null) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before voting.` });
    if (!round.isOpen) return setMessage({ tone: "info", text: "No vote round is open on mainnet." });
    if (await readHasVoted(round.roundId, account)) {
      setAlreadyVoted(true);
      setConfirmingVote(false);
      setMyVote(await readMyVote(round.roundId, account));
      return setMessage({ tone: "info", text: ALREADY_VOTED_TEXT });
    }
    const roundId = round.roundId;
    try {
      setBusy("vote");
      setConfirmingVote(false);
      setMessage(null);
      setSubmittedTx(null);
      setVoteStep("Checking your wallet and the relay…");
      const liveHealth = await fetchRelayHealth(account);
      setHealth(liveHealth);
      const relayNow = hasSponsorLock && SIGNATURE_SAFE_WRITES_ENABLED && relayAvailable(liveHealth);
      const allowance = await readAllowance(addresses.wif, account, addresses.votes);
      const needsApproval = allowance < ONE_WIF;
      if (needsApproval) {
        setVoteStep("Step 1 of 2: approve 1 $WIF. Confirm in your wallet. Take your time.");
        await sendDirect(wallet, account, addresses.wif, buildApprove(addresses.votes, addresses.votes, ONE_WIF), () => setVoteStep("Step 1 of 2: approval sent. Waiting for confirmation…"));
      }
      setVoteStep(needsApproval
        ? `Step 2 of 2: confirm your vote. ${relayNow ? "Sign" : "Confirm"} in your wallet. Take your time.`
        : `Confirm your vote. ${relayNow ? "Sign" : "Confirm"} in your wallet. Take your time.`);
      const burning = () => setVoteStep("Burning 1 $WIF… waiting for confirmation. You can leave this page open.");
      let voteHash: Hex;
      if (relayNow) {
        voteHash = await signMetaVote(wallet, account, roundId, selectedAsset, burning);
      } else {
        const vote = encodeFunctionData({ abi: votesAbi, functionName: "vote", args: [roundId, selectedAsset] });
        voteHash = await sendDirect(wallet, account, addresses.votes, vote, burning);
      }
      await finishVote(roundId, account, voteHash, relayNow);
    } catch (error) {
      // Never trust the error alone: if the vote landed on-chain, it is a success.
      setVoteStep("Checking whether your vote landed…");
      const landed = userRejected(error) ? await readHasVoted(roundId, account) : await voteLanded(roundId, account);
      if (landed) {
        await finishVote(roundId, account, undefined);
      } else if (userRejected(error)) {
        setMessage({ tone: "error", text: "You cancelled in your wallet. Nothing was sent. If you already approved 1 $WIF, that approval stays in place until a vote uses it, so trying again will not ask for it twice." });
      } else {
        setMessage({ tone: "error", text: `${friendlyError(error, "The vote did not go through.")} I checked the chain and no vote from this wallet is recorded for this round, so no $WIF was burned.` });
      }
    } finally {
      setVoteStep(null);
      setBusy(null);
    }
  };

  const runUnlock = async () => {
    if (!wallet || !account || !walletState) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before unlocking.` });
    const amount = walletState.locked;
    if (amount <= 0n) return;
    try {
      setBusy("unlock");
      setConfirmingUnlock(false);
      setMessage(null);
      await sendDirect(wallet, account, addresses.lock, encodeFunctionData({ abi: lockAbi, functionName: "unlock", args: [amount] }));
      setMessage({ tone: "success", text: `${formatWif(amount)} unlocked and returned to your wallet. Free gas is off until you lock 10 $WIF again.` });
      await refresh();
    } catch (error) {
      const state = await readWalletState(account).catch(() => null);
      if (state && state.locked === 0n) {
        setMessage({ tone: "success", text: "Unlocked. Your $WIF is back in your wallet. Free gas is off until you lock 10 $WIF again." });
        await refresh();
      } else {
        setMessage({ tone: "error", text: friendlyError(error, "Unlock cancelled or failed.") });
      }
    } finally {
      setBusy(null);
    }
  };

  const runLock = async () => {
    if (!wallet || !account) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before locking WIF.` });
    try {
      setBusy("lock");
      setMessage(null);
      const lockAmount = 10n * ONE_WIF;
      const lockData = encodeFunctionData({
        abi: lockAbi,
        functionName: "lock",
        args: [lockAmount],
      });
      const calls = [
        { target: addresses.wif, value: 0n, data: buildApprove(addresses.lock, addresses.lock, lockAmount) },
        { target: addresses.lock, value: 0n, data: lockData },
      ];
      await sendDirect(wallet, account, addresses.wif, calls[0].data);
      await sendDirect(wallet, account, addresses.lock, calls[1].data);
      setMessage({ tone: "success", text: "10 $WIF locked. Free gas is active for your votes, buys and sells." });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: friendlyError(error, "Lock cancelled or failed.") });
    } finally {
      setBusy(null);
    }
  };

  const previewBuy = async () => {
    if (!buyMix) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before checking prices.` });
    try {
      if (!(Number(buyAmount) >= MIN_BUY_USDG)) {
        setPlan([]);
        return setMessage({ tone: "info", text: `The minimum buy is $${MIN_BUY_USDG}.` });
      }
      setBusy("quote");
      setMessage(null);
      const nextPlan = await buildBuyPlan(buyAmount, { ...buyMix.round, weights: adjustedWeights });
      setPlan(nextPlan);
      setMessage({ tone: "success", text: "Price guard passed for every leg. The plan is ready to sign." });
    } catch (error) {
      setPlan([]);
      setMessage({ tone: "error", text: friendlyError(error, "Quote rejected.") });
    } finally {
      setBusy(null);
    }
  };

  const runBuy = async () => {
    if (!wallet || !account || !buyMix) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before buying.` });
    if (plan.length === 0) return setMessage({ tone: "info", text: "Check prices before buying." });
    try {
      setBusy("buy");
      setConfirmingBuy(false);
      setMessage(null);
      setSubmittedTx(null);
      const nextPlan = plan;
      if (!SIGNATURE_SAFE_WRITES_ENABLED) throw new Error("Buys are paused until the signature-safe router is configured.");
      const liveHealth = await fetchRelayHealth(account);
      setHealth(liveHealth);
      const relayNow = hasSponsorLock && relayAvailable(liveHealth);
      let buyHash: Hex;
      if (relayNow) {
        buyHash = await signMetaBuy(wallet, account, nextPlan);
      } else {
        const totalIn = nextPlan.reduce((sum, leg) => sum + leg.amountIn, 0n);
        const allowance = await readAllowance(addresses.usdg, account, addresses.buyRouter);
        if (allowance < totalIn) await sendDirect(wallet, account, addresses.usdg, buildApprove(addresses.buyRouter, addresses.buyRouter, totalIn));
        buyHash = await sendDirect(wallet, account, addresses.buyRouter, buildBuyMixCall(nextPlan));
      }
      setSubmittedTx({ action: "buy", hash: buyHash });
      const finality = await waitForTransactionFinality(buyHash);
      setSubmittedTx({ action: "buy", hash: buyHash, finality: finality.stage });
      setMessage({ tone: "success", text: `Buy complete at ${finality.stage} finality. Tokens were sent directly to your wallet.` });
      setPlan([]);
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: friendlyError(error, "Buy cancelled or failed.") });
    } finally {
      setBusy(null);
    }
  };

  const previewSell = async () => {
    if (!account) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before checking prices.` });
    try {
      setBusy("sell-quote");
      setMessage(null);
      const nextPlan = await buildSellPlan(sellSymbol, sellAmount, account);
      setSellPlan(nextPlan);
      setMessage({ tone: "success", text: "Sell price guard passed. Review the USDG you will receive." });
    } catch (error) {
      setSellPlan(null);
      setMessage({ tone: "error", text: friendlyError(error, "Sell quote rejected.") });
    } finally {
      setBusy(null);
    }
  };

  const runSell = async () => {
    if (!wallet || !account || !sellPlan) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before selling.` });
    try {
      setBusy("sell");
      setConfirmingSell(false);
      setMessage(null);
      setSubmittedTx(null);
      if (!SIGNATURE_SAFE_WRITES_ENABLED) throw new Error("Sells are paused until the signature-safe router is configured.");
      const liveHealth = await fetchRelayHealth(account);
      setHealth(liveHealth);
      const relayNow = hasSponsorLock && relayAvailable(liveHealth);
      let sellHash: Hex;
      if (relayNow) {
        sellHash = await signMetaSell(wallet, account, sellPlan);
      } else {
        const allowance = await readAllowance(sellPlan.token, account, addresses.buyRouter);
        if (allowance < sellPlan.amountIn) await sendDirect(wallet, account, sellPlan.token, buildApprove(addresses.buyRouter, addresses.buyRouter, sellPlan.amountIn));
        sellHash = await sendDirect(wallet, account, addresses.buyRouter, buildSellCall(sellPlan));
      }
      setSubmittedTx({ action: "sell", hash: sellHash });
      setMessage({ tone: "success", text: `${sellPlan.symbol} sold. USDG was sent directly to your wallet.` });
      setSellPlan(null);
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: friendlyError(error, "Sell cancelled or failed.") });
    } finally {
      setBusy(null);
    }
  };

  const requestVote = () => {
    if (!wallet || !account || chainId !== chain.id || !round?.isOpen) return;
    setSubmittedTx(null);
    setMessage(null);
    setConfirmingVote(true);
  };

  const requestBuy = () => {
    if (!wallet || !account || chainId !== chain.id || !buyMix) return;
    if (plan.length === 0) {
      setMessage({ tone: "info", text: "Check prices before buying." });
      return;
    }
    setSubmittedTx(null);
    setMessage(null);
    setConfirmingBuy(true);
  };

  const requestSell = () => {
    if (!wallet || !account || chainId !== chain.id || !sellPlan) return;
    setSubmittedTx(null);
    setMessage(null);
    setConfirmingSell(true);
  };


  const connected = Boolean(account);
  const totalValue = useMemo(
    () => holdings.reduce((sum, holding) => sum + (holding.value || 0), 0),
    [holdings],
  );
  const heldSymbols = useMemo(
    () => new Set(holdings.filter((holding) => holding.balance > 0n).map((holding) => holding.symbol)),
    [holdings],
  );
  const holdingRows: MixRow[] = holdings.map((holding) => {
    const index = assets.findIndex((item) => item.symbol === holding.symbol);
    const sharesText = holding.shares ?? (Number(holding.balance) / 1e18 > 0 ? (Number(holding.balance) / 1e18).toFixed(6) : "0");
    return {
      symbol: holding.symbol,
      name: assets[index]?.name,
      index,
      weight: totalValue > 0 && holding.value ? (holding.value / totalValue) * 100 : 0,
      price: prices[holding.symbol],
      sub: `${sharesText} shares`,
      extra: holding.value === null ? "n/a" : `$${holding.value.toFixed(2)}`,
    };
  });
  const voteRoundOpen = Boolean(round?.isOpen);
  const mixRound = buyMix?.round ?? null;
  const mixLabel = mixLoad !== "ready"
    ? ""
    : !mixRound
    ? "This week's mix"
    : buyMix?.kind === "final"
      ? `This week · Round ${mixRound.roundId} final`
      : `Preview · Round ${mixRound.roundId} live`;
  const closesIn = round && voteRoundOpen ? Number(round.closesAt) - now : null;
  const communityRows = mixRound
    ? assets.slice(0, mixRound.assetCount).map((asset, index) => ({ asset, index, weight: mixRound.weights[index] || 0n }))
    : [];
  const keep = communityRows.filter((row) => row.weight > 0n && !excluded.includes(row.index)).map((row) => row.index);
  const adjustedWeights = mixRound ? renormaliseWeights(mixRound.weights, keep) : [];
  const mixRows = communityRows.map((row) => ({ ...row, weight: adjusting ? adjustedWeights[row.index] || 0n : row.weight }));
  const toMix = (rows: { asset: { symbol: string; name?: string }; index: number; weight: bigint }[]): MixRow[] =>
    rows.map((row) => ({ symbol: row.asset.symbol, name: row.asset.name, index: row.index, weight: Number(row.weight) / 100, price: prices[row.asset.symbol] }));
  const mixHeadline = buyMix && round && buyMix.round.roundId !== round.roundId && voteRoundOpen
    ? `This week: Round ${buyMix.round.roundId} ${buyMix.kind === "final" ? "final mix" : "preview"} (${buyMix.round.assetCount} stocks). Voting now: Round ${round.roundId}, ${round.assetCount} stocks, for next week.`
    : null;
  const toggleStock = (index: number) => {
    setPlan([]);
    setExcluded((current) => current.includes(index)
      ? current.filter((value) => value !== index)
      : keep.length <= 2 ? current : [...current, index]);
  };
  const buyTotal = Number(buyAmount) || 0;
  const goTab = (next: Tab) => { window.location.hash = next; setTab(next); window.scrollTo({ top: 0 }); };
  const walletReady = connected && chainId === chain.id;
  const voteNeedsWallet = !connected ? "Connect to vote" : chainId !== chain.id ? "Switch network to vote" : null;
  const voteRows = round ? assets.slice(0, round.assetCount).map((asset, index) => ({ asset, index, weight: round.weights[index] || 0n })) : [];
  const picked = selectedAsset !== null ? assets[selectedAsset] : null;
  const testRounds = roundHistory?.tests ?? [];
  const testBurned = testRounds.reduce((sum, item) => sum + item.votes, 0n);
  const pastRounds = (roundHistory?.main ?? []).filter((item) => !round || item.roundId !== round.roundId);
  const currentRoundCard = roundHistory?.main.find((item) => round && item.roundId === round.roundId) ?? null;

  const gasPill = (
    <span className={`gas ${connected ? (useRelay ? "free" : "pay") : "idle"}`} title={gas.title}>
      {gas.badge}
    </span>
  );
  const goLock = () => { goTab("portfolio"); window.setTimeout(() => document.getElementById("lock")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };
  const gasBlock = (
    <div className="gas-wrap">
      {gasPill}
      {connected && !hasSponsorLock && <button className="lock-link" onClick={goLock}>Lock 10 $WIF for free gas →</button>}
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#week" onClick={() => goTab("week")} aria-label="Flatstock, this week">
          <Logo size={30} />
          <span>Flatstock</span>
        </a>
        <nav className="tabs desktop-tabs" aria-label="Sections">
          {TABS.map((item) => <a key={item.id} href={`#${item.id}`} className={tab === item.id ? "on" : ""} onClick={(event) => { event.preventDefault(); goTab(item.id); }}>{item.label}</a>)}
        </nav>
        <div className="topbar-actions">
          <span className={`net ${chainId === null ? "" : chainId === chain.id ? "good" : "warn"}`}>
            {chainId !== null && chainId !== chain.id ? "Wrong network" : NETWORK_LABEL}
          </span>
          {account ? (
            <button className="chip-btn" onClick={disconnect} title="Disconnect">{account.slice(0, 6)}…{account.slice(-4)}</button>
          ) : (
            <button className="btn primary small" onClick={() => void connect()}>Connect</button>
          )}
        </div>
      </header>

      <main className="page">
        {chainId !== null && chainId !== chain.id && (
          <section className="alert error" role="alert"><strong>Wrong network.</strong> Switch to {NETWORK_LABEL} (4663) to use Flatstock.
            <span className="alert-actions">
              <button className="link" onClick={() => void switchNetwork()}>Switch network</button>
              <button className="link" onClick={() => void addChain()}>Add {NETWORK_LABEL}</button>
            </span>
          </section>
        )}
        {message && <section className={`alert ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</section>}

        {tab === "week" && (
          <section className="week">
            <header className="week-head">
              <p className="eyebrow mono">{mixLabel}</p>
              <h1>Buy what the community <em>picked.</em></h1>
              <p className="lede">{mixHeadline ?? "$WIF holders vote the mix every week. You buy it in one tap, straight into your own wallet."}</p>
            </header>

            {mixRows.length === 0 ? (
              mixLoad === "loading" ? <Loader label="Loading the mix" /> : mixLoad === "failed" ? <EmptyLine>Could not load the mix. Check your connection and reload.</EmptyLine> : <EmptyLine>No mix yet: the first round has not closed and has no votes.</EmptyLine>
            ) : (
              <AllocationBar rows={toMix(communityRows)} />
            )}

            {round && (
              <div className="round-strip">
                <div><span className="mono k">Round {round.roundId.toString()} {voteRoundOpen ? "closes in" : "closed"}</span><strong className="mono">{closesIn !== null ? formatCountdown(closesIn) : "Closed"}</strong></div>
                <ProgressLine opensAt={Number(round.opensAt)} closesAt={Number(round.closesAt)} now={now} label={voteRoundOpen ? `Mondays 15:00 WAT · ${formatDate(round.closesAt)}` : formatDate(round.closesAt)} />
                <div className="strip-stat"><span className="mono k">$WIF burned</span><strong className="mono">{formatWif((roundHistory?.totalVotes ?? votesBurned) * ONE_WIF)}</strong></div>
              </div>
            )}

            <Rule />

            {submittedTx?.action === "buy" && submittedTx.finality ? (
              <section className="moment mint" role="status">
                <p className="eyebrow mono">Buy complete</p>
                <h2>Done. It is in your wallet.</h2>
                <p>Finality: {submittedTx.finality}. The Stock Tokens were sent straight to your wallet.</p>
                <p className="source mono">Finality: QuickNode</p>
                <a className="btn dark" href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a>
              </section>
            ) : null}

            <div className="buy">
              <div className="buy-main">
                <div className="row-between">
                  <h2>Buy the mix</h2>
                  {gasBlock}
                </div>
                {mixLoad === "loading" ? (
                  <Loader label="Loading the mix to buy" />
                ) : !buyMix ? (
                  <EmptyLine>{mixLoad === "failed" ? "Could not load the mix. Check your connection and reload." : "There is no mix to buy yet. The first round closes Mon 9 Nov 15:00 WAT; after that buys use its final mix."}</EmptyLine>
                ) : (
                  <>
                    {buyMix.kind === "preview" && <p className="helper">Round {buyMix.round.roundId.toString()} is still open, so this is the live preview. After it closes, buys use its final mix.</p>}
                    <MixTable
                      rows={communityRows.map((community) => {
                        const row = mixRows.find((item) => item.index === community.index) ?? community;
                        return { ...toMix([row])[0], extra: `$${(buyTotal * Number(row.weight) / 10_000).toFixed(2)}` };
                      })}
                      extraHead="≈ you buy"
                      keepOrder
                      isOff={(row) => adjusting && excluded.includes(row.index)}
                      lead={adjusting ? (row) => (
                        <input type="checkbox" className="check" checked={!excluded.includes(row.index)} disabled={row.weight === 0 && excluded.includes(row.index)} onChange={() => toggleStock(row.index)} aria-label={`Include ${row.symbol}`} />
                      ) : undefined}
                    />
                    <p className="source mono">Price: Chainlink</p>
                    <div className="adjust-bar">
                      <button className={`btn ghost small ${adjusting ? "on" : ""}`} onClick={() => { setAdjusting(!adjusting); setPlan([]); if (adjusting) setExcluded([]); }}>{adjusting ? "Use the full community mix" : "Adjust"}</button>
                      {adjusting && <span className="helper">Untick stocks you do not want (keep at least 2). The rest keep the community's relative weights, rescaled to 100%.</span>}
                    </div>
                    {adjusting && keep.length <= 2 && <p className="helper">Two stocks is the minimum.</p>}
                    {adjusting && keep.some((index) => adjustedWeights[index] > 5000n) && <p className="helper">The community mix caps each stock at 50%. A smaller custom selection can exceed that, because it is rescaled to 100%.</p>}
                  </>
                )}
              </div>

              {buyMix && (
                <aside className="buy-side">
                  <label className="field">Amount in USDG <span className="muted">(minimum ${MIN_BUY_USDG})</span>
                    <input inputMode="decimal" value={buyAmount} onChange={(event) => { setBuyAmount(event.target.value); setPlan([]); }} aria-label="Amount in USDG" />
                  </label>
                  <div className="presets">{["5", "10", "25", "50"].map((value) => <button key={value} className={buyAmount === value ? "on" : ""} onClick={() => { setBuyAmount(value); setPlan([]); }}>${value}</button>)}</div>
                  <button className="btn ghost full" disabled={!MIX_RULES_ENABLED || chainId !== chain.id || busy !== null || !(buyTotal >= MIN_BUY_USDG)} onClick={() => void previewBuy()}>{busy === "quote" ? "Checking prices..." : buyTotal >= MIN_BUY_USDG ? "Check prices" : `Minimum buy is $${MIN_BUY_USDG}`}</button>
                  {plan.length > 0 && <ul className="quotes">{plan.map((leg) => <li key={leg.symbol}><b>{leg.symbol}</b><span className="mono">${leg.quotePrice.toFixed(2)} vs ${leg.chainlinkPrice.toFixed(2)}</span><span className="mono good-text">{(leg.differenceBps / 100).toFixed(2)}%</span></li>)}</ul>}
                  <button className="btn primary full" disabled={!MIX_RULES_ENABLED || !SIGNATURE_SAFE_WRITES_ENABLED || !walletReady || plan.length === 0 || busy !== null} onClick={requestBuy}>{busy === "buy" ? "Waiting for wallet signature..." : !MIX_RULES_ENABLED || !SIGNATURE_SAFE_WRITES_ENABLED ? "Buying is being configured" : !connected ? "Connect to buy" : chainId !== chain.id ? "Switch network to buy" : plan.length === 0 ? "Check prices first" : "Review this mix"}</button>
                  {confirmingBuy && <div className="confirm"><strong>{useRelay ? "Sign this mix" : "Confirm wallet mix"}</strong><p>This spends {buyAmount} USDG and sends the Stock Tokens directly to your wallet. {useRelay ? "Your wallet signs the exact legs, minimum outputs, amount, nonce and deadline. A separate USDG permit lets the relayer pull only this amount and pay the gas." : "Your wallet signs the one-transaction mix and you pay the ETH gas."} The price guard passed for every leg.</p>
                    <SignSummary lines={[
                      ...(useRelay ? [<>Permit: allow the Flatstock Router to pull exactly <b>{buyAmount} USDG</b> from you</>] : [<>Approve exactly <b>{buyAmount} USDG</b> to the Flatstock Router (only if not already approved)</>]),
                      <>Buy the mix: <b>{plan.map((leg) => leg.symbol).join(", ")}</b>, split as {plan.map((leg) => `${leg.symbol} ${Number(leg.amountIn) / 1e6} USDG`).join(", ")}</>,
                      "The Stock Tokens go straight to your wallet, with a minimum for each stock so a bad price cancels the whole buy",
                      useRelay ? "Valid for 15 minutes and can be used once. Gas is paid by Flatstock" : "You pay the ETH gas",
                    ]} />
                    <div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runBuy()}>Sign and submit</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingBuy(false)}>Cancel</button></div></div>}
                  {submittedTx?.action === "buy" && !submittedTx.finality && <div className="proof"><strong>Buy submitted. Waiting for finality confirmation.</strong><a href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a></div>}
                  <p className="helper">Safety check: every price must be within 2% of Chainlink, or the whole purchase is blocked. 0% trading fee.</p>
                </aside>
              )}
            </div>
          </section>
        )}

        {tab === "vote" && (
          <section className="vote">
            <header className="week-head">
              <p className="eyebrow mono">Vote for next week{round ? ` · Round ${round.roundId}` : ""}</p>
              <h1>Pick the stock you want <em>more of.</em></h1>
              <p className="lede">One vote per wallet per round. Each vote burns 1 $WIF. Tap a stock to choose.</p>
              {round && <p className="votes-line mono">{round.totalVotes.toString()} vote{round.totalVotes === 1n ? "" : "s"} · {round.totalVotes.toString()} $WIF burned this round</p>}
              <div className="row-between">{gasBlock}</div>
            </header>
            {!round ? <Loader label="Loading the round" /> : !voteRoundOpen ? (
              <EmptyLine>No round is open for voting right now. The next round opens soon, and buying keeps working in the meantime.</EmptyLine>
            ) : revealed && submittedTx?.action === "vote" ? (
              <section className="moment mint" role="status">
                <p className="eyebrow mono">Vote cast · 1 $WIF burned</p>
                <h2>Vote cast.</h2>
                <p>Your vote for {picked?.symbol} is in. This is how next week's mix looks now:</p>
                <AllocationBar rows={toMix(voteRows)} />
                <MixTable rows={toMix(voteRows)} market={false} selected={selectedAsset} label="Next week's mix" />
                <div className="cta-row"><a className="btn dark" href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a><button className="btn ghost-dark" onClick={() => { setRevealed(false); setSelectedAsset(null); }}>Back</button></div>
              </section>
            ) : (
              <>
                {alreadyVoted && (
                  <div className="voted-banner" role="status">
                    <strong>{myVote ? `You voted for ${assets[myVote.assetIndex]?.symbol ?? "a stock"} in Round ${round.roundId}` : `You voted in Round ${round.roundId}`} · 1 $WIF burned</strong>
                    {myVote && <a href={txLink(myVote.hash)} target="_blank" rel="noreferrer">View transaction on Blockscout</a>}
                  </div>
                )}
                {voteStep && <div className="stepbox" role="status" aria-live="polite"><strong>{voteStep}</strong><span className="mono">Do not close this page. A pause is fine: nothing here times out.</span></div>}
                <AllocationBar rows={toMix(voteRows)} />
                <MixTable rows={toMix(voteRows)} selected={alreadyVoted ? (myVote?.assetIndex ?? null) : selectedAsset} mine={alreadyVoted ? (myVote?.assetIndex ?? null) : null} onPick={(index) => setSelectedAsset(index)} disabled={alreadyVoted} label="Pick a stock to vote for" />
                <p className="source mono">Price: Chainlink</p>
                <div className="pick">
                  {alreadyVoted ? null : picked && selectedAsset !== null ? (
                    <>
                      <div><span className="mono k">You are voting for</span><strong className="pick-name">{picked.symbol}</strong><small>{assetLabel(picked)}</small></div>
                      <div className="mono pick-weight">{formatWeightBps(round.weights[selectedAsset] || 0n)}<small>now</small></div>
                    </>
                  ) : <p className="muted">Nothing selected yet. Tap a stock in the list to choose.</p>}
                </div>
                <div className="cta-row">
                  <button className="btn primary" disabled={Boolean(voteNeedsWallet) || alreadyVoted || selectedAsset === null || busy !== null} onClick={requestVote}>
                    {busy === "vote" ? "Waiting for wallet signature..." : alreadyVoted ? "You already voted this round" : voteNeedsWallet || (selectedAsset === null ? "Pick a stock to vote" : `Review vote for ${picked?.symbol}: burn 1 $WIF`)}
                  </button>
                </div>
                {alreadyVoted && <p className="helper">One vote per wallet per round, so no more $WIF can be spent here. Use a different wallet or wait for the next round.</p>}
                {confirmingVote && picked && <div className="confirm"><strong>{useRelay ? "Sign this vote" : "Confirm wallet vote"}</strong><p>This spends exactly 1 $WIF and burns it. {useRelay ? "The relayer submits only what you sign and pays the gas for the vote." : "Your wallet sends the vote and you pay the ETH gas."}</p>
                  <ApprovalNote amount="1" contract="Votes" verified={contractVerified.votes} link={addressLink(addresses.votes)} />
                  {useRelay
                    ? <SignSummary lines={[<>Vote in <b>Round {round.roundId.toString()}</b> for <b>{picked.symbol}</b></>, "Costs 1 $WIF, burned", "Valid for 15 minutes and can be used once", "Gas for the vote is paid by Flatstock. Before it, your wallet asks you to approve exactly 1 $WIF, and you pay the gas for that approval. Each vote needs its own approval"]} />
                    : <SignSummary lines={[<>Approve exactly 1 $WIF to the Flatstock Votes contract (only if not already approved)</>, <>Vote in <b>Round {round.roundId.toString()}</b> for <b>{picked.symbol}</b>, which burns 1 $WIF</>, "You pay the ETH gas for both"]} />}<div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runVote()}>Sign and submit</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingVote(false)}>Cancel</button></div></div>}
                {submittedTx?.action === "vote" && !revealed && <div className="proof"><strong>Vote submitted and 1 $WIF burned.</strong><a href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a></div>}
              </>
            )}
          </section>
        )}

        {tab === "portfolio" && (
          <section className="portfolio">
            <header className="week-head">
              <p className="eyebrow mono">Your wallet</p>
              <h1>Portfolio</h1>
            </header>

            <div className="two">
              <div>
                <div className="row-between"><h2>Holdings</h2><strong className="mono total">{connected ? `$${totalValue.toFixed(2)}` : "—"}</strong></div>
                {!connected ? <EmptyLine>Connect a wallet to see the Stock Tokens it holds.</EmptyLine> : (
                  <>
                    {totalValue > 0 ? <AllocationBar rows={holdingRows} /> : <EmptyLine>No Stock Tokens in this wallet yet. Buy the mix on This week.</EmptyLine>}
                    <MixTable
                      rows={holdingRows}
                      extraHead="Value"
                      selected={assets.findIndex((item) => item.symbol === sellSymbol)}
                      onPick={(index) => { setSellSymbol(assets[index].symbol); setSellPlan(null); }}
                      label="Your Stock Tokens"
                    />
                  </>
                )}
                {connected && <p className="source mono">Price: Chainlink · Balances: Robinhood Chain</p>}
              </div>

              <div className="lockbox" id="lock">
                <div className="row-between"><h2>Free gas</h2>{gasPill}</div>
                <p className="muted">Lock 10 $WIF and we pay the gas for your votes and buys, up to {health?.dailyCap ?? 3} sponsored actions a day. You can unlock any time, with no waiting period.</p>
                {connected && <ul className="kv"><li><span>ETH balance</span><b className="mono">{formatEth(walletState?.eth || 0n)}</b></li><li><span>$WIF balance</span><b className="mono">{formatWif(walletState?.wif || 0n)}</b></li><li><span>Locked</span><b className="mono">{walletState && walletState.locked > 0n ? formatWif(walletState.locked) : "Not locked"}</b></li></ul>}
                {walletState && walletState.locked > 0n ? (
                  <>
                    <p className="mono"><b>{gas.status}</b></p>
                    {confirmingUnlock ? (
                      <div className="confirm">
                        <strong>Unlock {formatWif(walletState.locked)}?</strong>
                        <p>All of your locked $WIF returns to your wallet. You'll lose free gas until you lock 10 $WIF again.</p>
                        <div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runUnlock()}>Unlock {formatWif(walletState.locked)}</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingUnlock(false)}>Keep locked</button></div>
                      </div>
                    ) : (
                      <button className="btn ghost full" disabled={!walletReady || busy !== null} onClick={() => setConfirmingUnlock(true)}>{busy === "unlock" ? "Waiting for confirmation..." : "Unlock"}</button>
                    )}
                  </>
                ) : (
                  <>
                    <button className="btn primary full" disabled={!walletReady || busy !== null} onClick={() => void runLock()}>{busy === "lock" ? "Waiting for confirmation..." : !connected ? "Connect to lock" : "Lock 10 $WIF for free gas"}</button>
                    {connected && <ApprovalNote amount="10" contract="Lock" verified={contractVerified.lock} link={addressLink(addresses.lock)} />}
                  </>
                )}
                {connected && !hasSponsorLock && <p className="helper">No $WIF is locked, so this wallet pays its own ETH gas.</p>}
                {gas.helper && <p className="helper">{gas.helper}</p>}
              </div>
            </div>

            <Rule />

            <h2>Sell a Stock Token</h2>
            <div className="form-row">
              <label className="field">Stock<select value={sellSymbol} onChange={(event) => { setSellSymbol(event.target.value); setSellPlan(null); }} aria-label="Stock Token to sell">{assets.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>)}</select></label>
              <label className="field">Shares<input inputMode="decimal" value={sellAmount} onChange={(event) => { setSellAmount(event.target.value); setSellPlan(null); }} aria-label="Amount in shares to sell" /></label>
              <button className="btn ghost" disabled={!walletReady || busy !== null} onClick={() => void previewSell()}>{busy === "sell-quote" ? "Checking price..." : "Check sell price"}</button>
            </div>
            {sellPlan && <ul className="quotes"><li><b>{sellPlan.symbol}</b><span className="mono">${sellPlan.quotePrice.toFixed(2)} vs ${sellPlan.chainlinkPrice.toFixed(2)}</span><span className="mono good-text">{(sellPlan.differenceBps / 100).toFixed(2)}%</span></li></ul>}
            <button className="btn primary" disabled={!walletReady || !sellPlan || busy !== null} onClick={requestSell}>{busy === "sell" ? "Submitting permit and sell..." : sellPlan ? `Review ${sellPlan.symbol} sell` : "Check sell price first"}</button>
            {confirmingSell && sellPlan && <div className="confirm"><strong>{useRelay ? `Sign ${sellPlan.symbol} sell` : `Confirm ${sellPlan.symbol} sell`}</strong><p>This sells {sellAmount} shares back to USDG and sends the output to your wallet. {useRelay ? "You sign two exact messages: a Stock Token permit for this token and amount, then the sell. The relayer submits both and pays the gas. Both signatures expire in 5 minutes." : "Your wallet signs the exact transaction and you pay the ETH gas."} The price guard passed.</p>
              <SignSummary lines={[
                ...(useRelay ? [<>Permit: allow the Flatstock Router to pull exactly <b>{sellAmount} {sellPlan.symbol}</b> from you</>] : [<>Approve exactly <b>{sellAmount} {sellPlan.symbol}</b> to the Flatstock Router (only if not already approved)</>]),
                <>Sell <b>{sellAmount} {sellPlan.symbol}</b> for USDG, at least {(Number(sellPlan.minOut) / 1e6).toFixed(2)} USDG</>,
                "The USDG goes straight to your wallet",
                useRelay ? "Valid for 5 minutes and can be used once. Gas is paid by Flatstock" : "You pay the ETH gas",
              ]} />
              <div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runSell()}>Sign and submit</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingSell(false)}>Cancel</button></div></div>}
            {submittedTx?.action === "sell" && <div className="proof"><strong>Sell submitted.</strong><a href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a></div>}
            <p className="helper">Safety check: the price must be fresh and within 2% of Chainlink.</p>

            {corporateActions.length > 0 && (
              <>
                <Rule />
                <h2>Corporate actions</h2>
                <p className="source mono">Corporate actions: QuickNode</p>
                <ul className="plain">{corporateActions.slice(0, 6).map((action, index) => {
                  const symbol = action.symbol || "Stock";
                  const mine = heldSymbols.has(symbol);
                  const who = mine ? "your" : "holders'";
                  const label = action.type === "CASH_DIVIDEND" ? `${symbol} paid a dividend, ${who} shares grew.` : action.type === "FORWARD_SPLIT" ? `${symbol} split, ${who} share count grew.` : action.type === "REVERSE_SPLIT" ? `${symbol} reverse split, ${who} share count changed.` : `${symbol} had a corporate action, ${who} shares were updated.`;
                  return <li key={`${symbol}-${action.effectiveAt || index}`}><b>{label}</b><small>{action.status || "Recorded"}{action.effectiveAtIso ? ` · ${formatDate(BigInt(action.effectiveAt || 0))}` : ""}</small></li>;
                })}</ul>
              </>
            )}

            <Rule />
            <h2>History</h2>
            {!connected ? <EmptyLine>Connect a wallet to load its votes, buys and sells.</EmptyLine> : history.length === 0 ? <EmptyLine>No votes, buys or sells found for this wallet yet.</EmptyLine> : <ul className="plain">{history.slice(0, 20).map((item) => <li key={`${item.hash}-${item.kind}`}><b>{item.title}</b><small>{item.date} · {item.amount} · <a href={item.link} target="_blank" rel="noreferrer">Blockscout</a></small></li>)}</ul>}
          </section>
        )}

        {tab === "rounds" && (
          <section className="rounds-page">
            <header className="week-head">
              <p className="eyebrow mono">Rounds</p>
              <h1>Every round is <em>public.</em></h1>
              <p className="lede">Rounds close every Monday at 15:00 WAT. The round that just closed sets the mix you can buy; the next one opens for voting.</p>
            </header>
            {!roundHistory ? <Loader label="Loading rounds from chain" /> : (
              <>
                {currentRoundCard && round && (
                  <article className="round current">
                    <div className="row-between"><h2>Round {currentRoundCard.roundId.toString()} <span className="tag">{voteRoundOpen ? "Voting now" : "Closed"}</span></h2><span className="mono k">{currentRoundCard.assetCount} stocks</span></div>
                    {currentRoundCard.weights && (
                      <>
                        <AllocationBar rows={toMix(assets.slice(0, currentRoundCard.assetCount).map((asset, index) => ({ asset, index, weight: currentRoundCard.weights?.[index] || 0n })))} />
                        <MixTable rows={toMix(assets.slice(0, currentRoundCard.assetCount).map((asset, index) => ({ asset, index, weight: currentRoundCard.weights?.[index] || 0n })))} label={`Round ${currentRoundCard.roundId} mix`} />
                      </>
                    )}
                    <ProgressLine opensAt={Number(round.opensAt)} closesAt={Number(round.closesAt)} now={now} label={voteRoundOpen && closesIn !== null ? `Closes in ${formatCountdown(closesIn)} · ${formatDate(round.closesAt)}` : formatDate(round.closesAt)} />
                    <p className="helper">{currentRoundCard.votes.toString()} vote{currentRoundCard.votes === 1n ? "" : "s"} · {currentRoundCard.votes.toString()} $WIF burned</p>
                    <p className="helper">{currentRoundCard.openTx && <><a href={txLink(currentRoundCard.openTx)} target="_blank" rel="noreferrer">Open tx</a> · </>}<a href={addressLink(currentRoundCard.contract)} target="_blank" rel="noreferrer">Contract</a></p>
                  </article>
                )}
                <Rule />
                <h2>Past rounds</h2>
                {pastRounds.length === 0 ? <EmptyLine>No closed rounds yet. The first closes Mon 9 Nov 15:00 WAT.</EmptyLine> : (
                  <ul className="past">{pastRounds.map((item) => <RoundRow key={item.key} item={item} />)}</ul>
                )}
                {testRounds.length > 0 && (
                  <details className="fold">
                    <summary>{testRounds.length} test round{testRounds.length === 1 ? "" : "s"} · {testBurned.toString()} $WIF burned <small>earlier contracts</small></summary>
                    <p className="helper">These ran on earlier test contracts that are retired. They are listed so the $WIF burned total matches: {formatWif(roundHistory.totalVotes * ONE_WIF)} in all.</p>
                    <ul className="past">{testRounds.map((item) => <RoundRow key={item.key} item={item} test />)}</ul>
                  </details>
                )}
              </>
            )}
          </section>
        )}
      </main>

      <footer className="foot">
        <p className="avail">Not available to US persons, or in Canada, the UK, Switzerland or other restricted jurisdictions. Not investment advice. <a href={RESTRICTED_JURISDICTIONS_URL} target="_blank" rel="noopener noreferrer">Restricted jurisdictions</a> · <details><summary>Full list</summary><span>{RESTRICTED_JURISDICTIONS_TEXT}</span></details></p>
        <div className="foot-row">
          <span>Flatstock is independent and not affiliated with Robinhood.</span>
          <span>Self-custody only. Live data from {NETWORK_LABEL} (4663).</span>
        </div>
        <nav className="foot-links" aria-label="Footer">
          <a href="https://flatstock.ajkadri.dev" target="_blank" rel="noopener noreferrer">Website</a>
          <a href="https://flatstock.ajkadri.dev/docs" target="_blank" rel="noopener noreferrer">Docs</a>
          <a href={addressLink(addresses.votes)} target="_blank" rel="noopener noreferrer">Votes contract</a>
          <a href={addressLink(addresses.buyRouter)} target="_blank" rel="noopener noreferrer">Router</a>
          <a href={addressLink(addresses.lock)} target="_blank" rel="noopener noreferrer">Lock</a>
          <button className="link" onClick={() => void addChain()}>Add {NETWORK_LABEL}</button>
          <a href="https://github.com/AjKadri/flatstock" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://x.com/flatstockapp" target="_blank" rel="noopener noreferrer">X</a>
        </nav>
      </footer>

      <nav className="tabs bottom-tabs" aria-label="Sections">
        {TABS.map((item) => <a key={item.id} href={`#${item.id}`} className={tab === item.id ? "on" : ""} onClick={(event) => { event.preventDefault(); goTab(item.id); }}>{item.label}</a>)}
      </nav>
    </div>
  );
}

type Tab = "week" | "vote" | "portfolio" | "rounds";
const TABS: { id: Tab; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "vote", label: "Vote" },
  { id: "portfolio", label: "Portfolio" },
  { id: "rounds", label: "Rounds" },
];
function tabFromHash(): Tab {
  const hash = window.location.hash.replace("#", "");
  return (TABS.find((item) => item.id === hash)?.id ?? "week") as Tab;
}

function formatCountdown(seconds: number) {
  if (seconds <= 0) return "Closing";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
}

async function addChain() {
  const provider = window.ethereum;
  if (!provider?.request) return;
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: `0x${chain.id.toString(16)}`,
        chainName: NETWORK_LABEL,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
        blockExplorerUrls: [EXPLORER_URL],
      }],
    });
  } catch {
    // The user declined in the wallet; nothing to do.
  }
}

function assetLabel(asset: { name?: string } | undefined) {
  return asset?.name ?? "";
}

function RoundRow({ item, test = false }: { item: PastRound; test?: boolean }) {
  const label = item.status === "closed" ? "Final" : item.status === "open" ? "Open" : item.status === "ended" ? "Ended" : "Unknown";
  const rows = item.weights
    ? assets.slice(0, item.assetCount).map((asset, index) => ({ symbol: asset.symbol, name: asset.name, index, weight: Number(item.weights?.[index] || 0n) / 100 }))
    : null;
  return (
    <li className="round">
      <div className="row-between"><strong className="round-no">Round {item.roundId.toString()}</strong><span className="tag">{test ? "Test · " : ""}{label}</span></div>
      {rows && (
        <>
          <AllocationBar rows={rows} />
          <MixTable rows={rows} market={false} label={`Round ${item.roundId} weights`} />
        </>
      )}
      <p className="helper">{item.votes.toString()} vote{item.votes === 1n ? "" : "s"} · {item.votes.toString()} $WIF burned{item.closesAt ? ` · closes ${formatDate(item.closesAt)}` : ""}{test ? ` · ${item.contractLabel}` : ""}</p>
      <p className="helper">
        {item.openTx && <><a href={txLink(item.openTx)} target="_blank" rel="noreferrer">Open tx</a> · </>}
        {item.closeTx && <><a href={txLink(item.closeTx)} target="_blank" rel="noreferrer">Close tx</a> · </>}
        <a href={addressLink(item.contract)} target="_blank" rel="noreferrer">Contract</a>
      </p>
    </li>
  );
}

export default App;

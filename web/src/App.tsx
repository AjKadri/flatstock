import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  addresses,
  assets,
  chain,
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

type Health = {
  enabled: boolean;
  killSwitch: boolean;
  dailyCap: number;
  usage?: number;
  error?: string;
  sponsorshipPaused?: boolean;
  sponsorshipPausedReason?: string | null;
};

const SPONSORSHIP_PAUSED_MESSAGE = "Gas sponsorship paused, you can still buy and pay your own gas.";

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
  return Boolean(health && health.enabled && !health.killSwitch && !health.sponsorshipPaused);
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
  const [round, setRound] = useState<RoundState | null>(null);
  const [corporateActions, setCorporateActions] = useState<CorporateAction[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [walletState, setWalletState] = useState<Awaited<ReturnType<typeof readWalletState>> | null>(null);
  const [votesBurned, setVotesBurned] = useState<bigint>(0n);
  const [health, setHealth] = useState<Health | null>(null);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [buyMix, setBuyMix] = useState<BuyMix | null>(null);
  const [roundHistory, setRoundHistory] = useState<RoundHistory | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const [revealed, setRevealed] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [buyAmount, setBuyAmount] = useState("5");
  const [selectedAsset, setSelectedAsset] = useState(0);
  const [plan, setPlan] = useState<BuyLeg[]>([]);
  const [sellSymbol, setSellSymbol] = useState("NVDA");
  const [sellAmount, setSellAmount] = useState("0.001");
  const [sellPlan, setSellPlan] = useState<SellLeg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingVote, setConfirmingVote] = useState(false);
  const [confirmingBuy, setConfirmingBuy] = useState(false);
  const [confirmingSell, setConfirmingSell] = useState(false);
  const [submittedTx, setSubmittedTx] = useState<SubmittedTx | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const hasSponsorLock = walletState?.locked !== undefined && walletState.locked >= 10n * ONE_WIF;
  const sponsorshipPaused = Boolean(health && (health.killSwitch || health.sponsorshipPaused));
  const useRelay = hasSponsorLock && SIGNATURE_SAFE_WRITES_ENABLED && !sponsorshipPaused;

  const refresh = useCallback(async (connectedAccount = account) => {
    try {
      const [nextRound, burned] = await Promise.all([
        readRound(),
        readVoteBurned(),
      ]);
      setRound(nextRound);
      setBuyMix(await pickBuyMix(nextRound));
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
        setAlreadyVoted(await readHasVoted(nextRound.roundId, connectedAccount));
        setHistory(await readHistory(connectedAccount));
        setHealth(await fetchRelayHealth(connectedAccount));
      }
    } catch (error) {
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
    void readRoundHistory().then((value) => { if (live) setRoundHistory(value); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
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

  const runVote = async () => {
    if (!wallet || !account || !round) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before voting.` });
    if (!round.isOpen) return setMessage({ tone: "info", text: "No vote round is open on mainnet." });
    if (await readHasVoted(round.roundId, account)) {
      setAlreadyVoted(true);
      setConfirmingVote(false);
      return setMessage({ tone: "info", text: ALREADY_VOTED_TEXT });
    }
    try {
      setBusy("vote");
      setConfirmingVote(false);
      setMessage(null);
      setSubmittedTx(null);
      const liveHealth = await fetchRelayHealth(account);
      setHealth(liveHealth);
      const relayNow = hasSponsorLock && SIGNATURE_SAFE_WRITES_ENABLED && relayAvailable(liveHealth);
      const allowance = await readAllowance(addresses.wif, account, addresses.votes);
      if (allowance < ONE_WIF) {
        await sendDirect(wallet, account, addresses.wif, buildApprove(addresses.votes, addresses.votes, ONE_WIF));
      }
      let voteHash: Hex;
      if (relayNow) {
        voteHash = await signMetaVote(wallet, account, round.roundId, selectedAsset);
      } else {
        const vote = encodeFunctionData({ abi: votesAbi, functionName: "vote", args: [round.roundId, selectedAsset] });
        voteHash = await sendDirect(wallet, account, addresses.votes, vote);
      }
      setSubmittedTx({ action: "vote", hash: voteHash });
      setMessage({ tone: "success", text: relayNow
        ? "Vote signature relayed. Exactly 1 WIF was burned."
        : "Vote submitted from your wallet. Exactly 1 WIF was burned." });
      setRevealed(true);
      await refresh();
      void readRoundHistory().then(setRoundHistory);
    } catch (error) {
      setMessage({ tone: "error", text: friendlyError(error, "Vote cancelled or failed.") });
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
      setMessage({ tone: "success", text: "10 WIF locked. Signature-relayed actions are available when the new contracts are configured." });
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


  const gasBadge = useRelay ? "Free gas" : "You pay gas";
  const totalValue = useMemo(
    () => holdings.reduce((sum, holding) => sum + (holding.value || 0), 0),
    [holdings],
  );
  const voteRoundOpen = Boolean(round?.isOpen);
  const mixRound = buyMix?.round ?? null;
  const mixLabel = !mixRound
    ? "This week's mix"
    : buyMix?.kind === "final"
      ? `This week's mix (Round ${mixRound.roundId}, final)`
      : `Preview mix (Round ${mixRound.roundId}, live)`;
  const voteLabel = round ? `Vote for next week (Round ${round.roundId})` : "Vote for next week";
  const closesIn = round && voteRoundOpen ? Number(round.closesAt) - now : null;
  const communityRows = mixRound
    ? assets.slice(0, mixRound.assetCount).map((asset, index) => ({ asset, index, weight: mixRound.weights[index] || 0n }))
    : [];
  const keep = communityRows.filter((row) => row.weight > 0n && !excluded.includes(row.index)).map((row) => row.index);
  const adjustedWeights = mixRound ? renormaliseWeights(mixRound.weights, keep) : [];
  const mixRows = communityRows.map((row) => ({ ...row, weight: adjusting ? adjustedWeights[row.index] || 0n : row.weight }));
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
  const walletReady = Boolean(account) && chainId === chain.id;
  const voteNeedsWallet = !account ? "Connect to vote" : chainId !== chain.id ? "Switch network to vote" : null;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#home" onClick={() => goTab("home")} aria-label="Flatstock home">
          <img src="/logo.svg" alt="" width="32" height="32" />
          <span>Flatstock</span>
        </a>
        <nav className="tabs desktop-tabs" aria-label="Sections">
          {TABS.map((item) => <button key={item.id} className={tab === item.id ? "on" : ""} onClick={() => goTab(item.id)}>{item.label}</button>)}
        </nav>
        <div className="topbar-actions">
          <span className={`pill ${chainId === null ? "" : chainId === chain.id ? "good" : "warn"}`}>
            {chainId === null ? NETWORK_LABEL : chainId === chain.id ? NETWORK_LABEL : "Wrong network"}
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

        {tab === "home" && (
          <>
            <section className="panel hero">
              <p className="eyebrow">{mixLabel}</p>
              <div className="hero-body">
                <Ring rows={mixRows.map((row) => ({ label: row.asset.symbol, weight: Number(row.weight) / 100 }))} center={mixRows.length ? `${mixRows.length} stocks` : "..."} />
                <div className="hero-copy">
                  <h1>Buy the US stocks the community picked.</h1>
                  <p className="lede">One tap. No gas with a 10 $WIF lock. Tokens go straight to your wallet.</p>
                  <ul className="legend">
                    {mixRows.length === 0 ? <li className="muted">{round ? "No mix yet: the first round has not closed and has no votes." : "Loading the mix from chain..."}</li> : mixRows.map((row, i) => (
                      <li key={row.asset.symbol}><i style={{ background: RING_COLORS[i % RING_COLORS.length] }} /><b>{row.asset.symbol}</b><span>{formatWeightBps(row.weight)}</span></li>
                    ))}
                  </ul>
                  <div className="cta-row">
                    <button className="btn primary" disabled={!mixRound} onClick={() => goTab("buy")}>Buy the mix</button>
                    <button className="btn ghost" onClick={() => goTab("vote")}>Vote for next week</button>
                  </div>
                  {buyMix?.kind === "preview" && <p className="helper">Round {mixRound?.roundId.toString()} has not closed yet, so this is the live vote preview. After it closes, buys use its final mix.</p>}
                </div>
              </div>
            </section>

            {mixHeadline && <p className="headline-note" role="note">{mixHeadline}</p>}
            <Schedule round={round} />

            <section className="stats">
              <div className="tile"><span>{round ? `Round ${round.roundId} closes in` : "Next round"}</span><strong className="mono">{closesIn !== null ? formatCountdown(closesIn) : voteRoundOpen ? "..." : "Not open"}</strong><small>{round ? formatDate(round.closesAt) : ""}</small></div>
              <div className="tile"><span>$WIF burned by votes</span><strong className="mono">{formatWif((roundHistory?.totalVotes ?? votesBurned) * ONE_WIF)}</strong><small>1 $WIF per vote</small></div>
              <div className="tile"><span>Your gas</span><strong>{account ? gasBadge : "Connect"}</strong><small>{sponsorshipPaused ? SPONSORSHIP_PAUSED_MESSAGE : "Lock 10 $WIF for free gas"}</small></div>
            </section>

            <ol className="steps">
              <li><b>01</b><span>Vote<small>Burns 1 $WIF on next week's mix</small></span></li>
              <li><b>02</b><span>Buy<small>The final mix of the last closed round</small></span></li>
              <li><b>03</b><span>Hold<small>Your wallet, your keys</small></span></li>
            </ol>
          </>
        )}

        {tab === "vote" && (
          <section className="panel vote">
            <p className="eyebrow">{voteLabel}</p>
            {!round ? <p className="muted">Loading the live round...</p> : !voteRoundOpen ? (
              <p className="muted">No round is open for voting right now. The next round opens soon, and buying keeps working in the meantime.</p>
            ) : revealed && submittedTx?.action === "vote" ? (
              <div className="reveal">
                <h2>1 $WIF burned.</h2>
                <p className="lede">Your vote for {assets[selectedAsset]?.symbol} is in. This is how next week's mix looks now:</p>
                <ul className="legend big">
                  {assets.slice(0, round.assetCount).map((asset, i) => <li key={asset.symbol}><i style={{ background: RING_COLORS[i % RING_COLORS.length] }} /><b>{asset.symbol}</b><span>{formatWeightBps(round.weights[i] || 0n)}</span></li>)}
                </ul>
                <a className="link" href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a>
                <button className="btn ghost" onClick={() => setRevealed(false)}>Back</button>
              </div>
            ) : (
              <>
                <p className="muted center">Pick the stock you want more of in next week's mix. One vote per wallet per round, 1 $WIF burned.</p>
                <div className="orbit" role="radiogroup" aria-label="Pick a stock">
                  <div className="orbit-ring" aria-hidden="true" />
                  <div className="orbit-center">
                    <small>You are voting for</small>
                    <strong>{assets[selectedAsset]?.symbol}</strong>
                    <small>{assetLabel(assets[selectedAsset])}</small>
                    <span className="mono">{formatWeightBps(round.weights[selectedAsset] || 0n)} now</span>
                  </div>
                  {assets.slice(0, round.assetCount).map((asset, index, list) => (
                    <button key={asset.symbol} role="radio" aria-checked={selectedAsset === index} className={`orbit-chip ${selectedAsset === index ? "on" : ""}`}
                      style={{ "--a": `${(360 / list.length) * index - 90}deg`, "--d": `${index * 0.8}s`, "--chip": list.length > 5 ? "62px" : "92px" } as CSSProperties} onClick={() => setSelectedAsset(index)} disabled={alreadyVoted}>
                      <span>{asset.symbol}<em className="mono">{formatWeightBps(round.weights[index] || 0n)}</em></span>
                    </button>
                  ))}
                </div>
                <div className="cta-row center">
                  <button className="btn primary" disabled={Boolean(voteNeedsWallet) || alreadyVoted || busy !== null} onClick={requestVote}>
                    {busy === "vote" ? "Waiting for wallet signature..." : alreadyVoted ? "You already voted this round" : voteNeedsWallet || "Review vote: burn 1 $WIF"}
                  </button>
                </div>
                {alreadyVoted && <p className="helper center">{ALREADY_VOTED_TEXT}</p>}
                {confirmingVote && <div className="confirm"><strong>{useRelay ? "Sign this vote" : "Confirm wallet vote"}</strong><p>This spends exactly 1 $WIF and burns it. {useRelay ? "Your wallet signs the exact round, stock, nonce and deadline. The relayer submits only that and pays the gas." : "Your wallet sends the vote and you pay the ETH gas."} A first vote may also ask for a one-time $WIF approval.</p><div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runVote()}>Sign and submit</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingVote(false)}>Cancel</button></div></div>}
                {submittedTx?.action === "vote" && !revealed && <div className="proof"><strong>Vote submitted and 1 $WIF burned.</strong><a href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a></div>}
              </>
            )}
          </section>
        )}

        {tab === "buy" && (
          <section className="panel">
            <div className="row-between"><div><p className="eyebrow">{mixLabel}</p><h2>Buy the mix</h2></div><span className={`pill ${useRelay ? "good" : "warn"}`}>{gasBadge}</span></div>
            {!buyMix ? <p className="muted">There is no mix to buy yet. The first round closes Mon 9 Nov 15:00 WAT, after that buys use its final mix.</p> : (
              <>
                {mixHeadline && <p className="headline-note">{mixHeadline}</p>}
                {buyMix.kind === "preview" && <p className="helper">Round {buyMix.round.roundId.toString()} is still open, so this is the live preview of the mix. After it closes, buys use its final mix.</p>}
                <label className="field">Amount in USDG (minimum ${MIN_BUY_USDG})
                  <input inputMode="decimal" value={buyAmount} onChange={(event) => { setBuyAmount(event.target.value); setPlan([]); }} aria-label="Amount in USDG" />
                </label>
                <div className="presets">{["5", "10", "25"].map((value) => <button key={value} className={buyAmount === value ? "on" : ""} onClick={() => { setBuyAmount(value); setPlan([]); }}>${value}</button>)}</div>
                <div className="adjust-bar">
                  <button className={`btn ghost small ${adjusting ? "on" : ""}`} onClick={() => { setAdjusting(!adjusting); setPlan([]); if (adjusting) setExcluded([]); }}>{adjusting ? "Use the full community mix" : "Adjust"}</button>
                  {adjusting && <span className="helper">Untick stocks you do not want (keep at least 2). The rest keep the community's relative weights, rescaled to 100%.</span>}
                </div>
                <ul className="split">
                  {mixRows.map((row) => {
                    const on = !excluded.includes(row.index);
                    return (
                      <li key={row.asset.symbol} className={adjusting && !on ? "off" : ""}>
                        {adjusting
                          ? <input type="checkbox" className="check" checked={on} disabled={row.weight === 0n && !on} onChange={() => toggleStock(row.index)} aria-label={`Include ${row.asset.symbol}`} />
                          : <i style={{ background: RING_COLORS[row.index % RING_COLORS.length] }} />}
                        <b>{row.asset.symbol}<small>{assetLabel(row.asset)}</small></b><span className="mono">{formatWeightBps(row.weight)}</span><span className="mono">≈ ${(buyTotal * Number(row.weight) / 10_000).toFixed(2)}</span>
                      </li>
                    );
                  })}
                </ul>
                {adjusting && keep.length <= 2 && <p className="helper">Two stocks is the minimum.</p>}
                {adjusting && keep.some((index) => adjustedWeights[index] > 5000n) && <p className="helper">The community mix caps each stock at 50%. A smaller custom selection can exceed that, because it is rescaled to 100%.</p>}
                <button className="btn ghost full" disabled={!MIX_RULES_ENABLED || chainId !== chain.id || busy !== null || !(buyTotal >= MIN_BUY_USDG)} onClick={() => void previewBuy()}>{busy === "quote" ? "Checking prices..." : buyTotal >= MIN_BUY_USDG ? "Check prices" : `Minimum buy is $${MIN_BUY_USDG}`}</button>
                {plan.length > 0 && <div className="quotes"><div className="qh"><span>Stock</span><span>Quote / Chainlink</span><span>Gap</span></div>{plan.map((leg) => <div className="qr" key={leg.symbol}><b>{leg.symbol}</b><span className="mono">${leg.quotePrice.toFixed(2)} / ${leg.chainlinkPrice.toFixed(2)}</span><span className="good-text mono">{(leg.differenceBps / 100).toFixed(2)}%</span></div>)}</div>}
                <button className="btn primary full" disabled={!MIX_RULES_ENABLED || !SIGNATURE_SAFE_WRITES_ENABLED || !walletReady || plan.length === 0 || busy !== null} onClick={requestBuy}>{busy === "buy" ? "Waiting for wallet signature..." : !MIX_RULES_ENABLED || !SIGNATURE_SAFE_WRITES_ENABLED ? "Buying is being configured" : !account ? "Connect to buy" : chainId !== chain.id ? "Switch network to buy" : plan.length === 0 ? "Check prices first" : "Review this mix"}</button>
                {confirmingBuy && <div className="confirm"><strong>{useRelay ? "Sign this mix" : "Confirm wallet mix"}</strong><p>This spends {buyAmount} USDG and sends the Stock Tokens directly to your wallet. {useRelay ? "Your wallet signs the exact legs, minimum outputs, amount, nonce and deadline. A separate USDG permit lets the relayer pull only this amount and pay the gas." : "Your wallet signs the one-transaction mix and you pay the ETH gas."} The price guard passed for every leg.</p><div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runBuy()}>Sign and submit</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingBuy(false)}>Cancel</button></div></div>}
                {submittedTx?.action === "buy" && <div className="proof"><strong>{submittedTx.finality ? `Buy complete at ${submittedTx.finality} finality.` : "Buy submitted. Waiting for finality confirmation."}</strong><a href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a></div>}
                <p className="helper">Safety check: every price must be within 2% of Chainlink, or the whole purchase is blocked. 0% trading fee.</p>
              </>
            )}
          </section>
        )}

        {tab === "portfolio" && (
          <>
            <section className="panel">
              <div className="row-between"><div><p className="eyebrow">Your holdings</p><h2>Portfolio</h2></div><strong className="mono total">${totalValue.toFixed(2)}</strong></div>
              {!account ? <p className="muted">Connect a wallet to see Stock Tokens held by that wallet.</p> : <ul className="holdings">{holdings.map((holding) => <li key={holding.symbol}><button onClick={() => { setSellSymbol(holding.symbol); setSellPlan(null); }}><span><b>{holding.symbol}</b><small>{holding.shares ? `${holding.shares} shares` : Number(holding.balance) / 1e18 > 0 ? `${(Number(holding.balance) / 1e18).toFixed(6)} raw` : "No tokens"}</small></span><span className="mono">{holding.price === null ? "Price unavailable" : `$${holding.price.toFixed(2)}`}<small>{holding.value === null ? "" : `$${holding.value.toFixed(2)}`}</small></span></button></li>)}</ul>}
            </section>
            <section className="panel">
              <p className="eyebrow">Sell</p><h2>Sell a Stock Token</h2>
              <div className="form-row">
                <label className="field">Stock<select value={sellSymbol} onChange={(event) => { setSellSymbol(event.target.value); setSellPlan(null); }} aria-label="Stock Token to sell">{assets.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>)}</select></label>
                <label className="field">Shares<input inputMode="decimal" value={sellAmount} onChange={(event) => { setSellAmount(event.target.value); setSellPlan(null); }} aria-label="Amount in shares to sell" /></label>
              </div>
              <button className="btn ghost full" disabled={!walletReady || busy !== null} onClick={() => void previewSell()}>{busy === "sell-quote" ? "Checking price..." : "Check sell price"}</button>
              {sellPlan && <div className="quotes"><div className="qh"><span>Stock</span><span>Quote / Chainlink</span><span>Gap</span></div><div className="qr"><b>{sellPlan.symbol}</b><span className="mono">${sellPlan.quotePrice.toFixed(2)} / ${sellPlan.chainlinkPrice.toFixed(2)}</span><span className="good-text mono">{(sellPlan.differenceBps / 100).toFixed(2)}%</span></div></div>}
              <button className="btn primary full" disabled={!walletReady || !sellPlan || busy !== null} onClick={requestSell}>{busy === "sell" ? "Submitting permit and sell..." : sellPlan ? `Review ${sellPlan.symbol} sell` : "Check sell price first"}</button>
              {confirmingSell && sellPlan && <div className="confirm"><strong>{useRelay ? `Sign ${sellPlan.symbol} sell` : `Confirm ${sellPlan.symbol} sell`}</strong><p>This sells {sellAmount} shares back to USDG and sends the output to your wallet. {useRelay ? "You sign two exact messages: a Stock Token permit for this token and amount, then the sell. The relayer submits both and pays the gas. Both signatures expire in 5 minutes." : "Your wallet signs the exact transaction and you pay the ETH gas."} The price guard passed.</p><div className="cta-row"><button className="btn primary" disabled={busy !== null} onClick={() => void runSell()}>Sign and submit</button><button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmingSell(false)}>Cancel</button></div></div>}
              {submittedTx?.action === "sell" && <div className="proof"><strong>Sell submitted.</strong><a href={txLink(submittedTx.hash)} target="_blank" rel="noreferrer">View transaction</a></div>}
              <p className="helper">Safety check: the price must be fresh and within 2% of Chainlink.</p>
            </section>
            {corporateActions.length > 0 && <section className="panel"><p className="eyebrow">Stock Token data</p><h2>Corporate actions</h2><ul className="plain">{corporateActions.slice(0, 6).map((action, index) => {
              const symbol = action.symbol || "Stock";
              const label = action.type === "CASH_DIVIDEND" ? `${symbol} paid a dividend, your shares grew.` : action.type === "FORWARD_SPLIT" ? `${symbol} split, your share count grew.` : action.type === "REVERSE_SPLIT" ? `${symbol} reverse split, your share count changed.` : `${symbol} had a corporate action, your shares were updated.`;
              return <li key={`${symbol}-${action.effectiveAt || index}`}><b>{label}</b><small>{action.status || "Recorded"}{action.effectiveAtIso ? ` · ${formatDate(BigInt(action.effectiveAt || 0))}` : ""}</small></li>;
            })}</ul></section>}
            <section className="panel">
              <p className="eyebrow">On-chain record</p><h2>History</h2>
              {!account ? <p className="muted">Connect a wallet to load its votes, buys and sells.</p> : history.length === 0 ? <p className="muted">No votes, buys or sells found for this wallet yet.</p> : <ul className="plain">{history.slice(0, 20).map((item) => <li key={`${item.hash}-${item.kind}`}><b>{item.title}</b><small>{item.date} · {item.amount} · <a href={item.link} target="_blank" rel="noreferrer">Blockscout</a></small></li>)}</ul>}
            </section>
          </>
        )}

        {tab === "more" && (
          <>
            <section className="panel">
              <div className="row-between"><div><p className="eyebrow">Free gas</p><h2>10 $WIF lock</h2></div><span className={`pill ${hasSponsorLock ? "good" : "warn"}`}>{hasSponsorLock ? "Active" : "Not locked"}</span></div>
              {account ? <ul className="kv"><li><span>ETH balance</span><b className="mono">{formatEth(walletState?.eth || 0n)}</b></li><li><span>$WIF balance</span><b className="mono">{formatWif(walletState?.wif || 0n)}</b></li><li><span>Locked</span><b className="mono">{walletState && walletState.locked > 0n ? formatWif(walletState.locked) : "Not locked"}</b></li></ul> : <p className="muted">Connect a wallet to see its balances and lock status.</p>}
              <p className="muted">Lock 10 $WIF and we pay the gas for your votes and buys, up to {health?.dailyCap ?? 3} sponsored actions per day.</p>
              <button className="btn ghost full" disabled={!walletReady || busy !== null || (walletState?.locked || 0n) > 0n} onClick={() => void runLock()}>{busy === "lock" ? "Waiting for confirmation..." : walletState?.locked ? "Free gas active" : "Lock 10 $WIF for free gas"}</button>
              {account && !hasSponsorLock && <p className="helper">No $WIF is locked, so this wallet pays its own ETH gas.</p>}
              {account && hasSponsorLock && !SIGNATURE_SAFE_WRITES_ENABLED && <p className="helper">Free gas is being configured. Until then this wallet pays its own gas.</p>}
              {health && <p className="helper">{sponsorshipPaused ? SPONSORSHIP_PAUSED_MESSAGE : `Free gas: ${health.enabled ? `${health.usage || 0} of ${health.dailyCap} sponsored actions used today` : "offline"}.`}</p>}
            </section>

            <section className="panel">
              <p className="eyebrow">Rounds</p><h2>Past rounds</h2>
              {!roundHistory ? <p className="muted">Loading rounds from chain...</p> : roundHistory.main.length === 0 ? <p className="muted">No rounds found yet.</p> : (
                <ul className="rounds">{roundHistory.main.map((item) => <RoundCard key={item.key} item={item} />)}</ul>
              )}
              {roundHistory && roundHistory.tests.length > 0 && (
                <details className="fold">
                  <summary>Test rounds (earlier contract) <small>{roundHistory.tests.length} · {roundHistory.tests.reduce((sum, item) => sum + item.votes, 0n).toString()} $WIF burned</small></summary>
                  <p className="helper">These ran on earlier test contracts that are retired. They are listed so the $WIF burned total matches: {formatWif((roundHistory.totalVotes) * ONE_WIF)} in all.</p>
                  <ul className="rounds">{roundHistory.tests.map((item) => <RoundCard key={item.key} item={item} test />)}</ul>
                </details>
              )}
            </section>

            <section className="panel">
              <p className="eyebrow">Contracts</p><h2>Verified on Blockscout</h2>
              <ul className="plain">
                <li><b>Votes (current)</b><small><a href={addressLink(addresses.votes)} target="_blank" rel="noreferrer">{addresses.votes}</a></small></li>
                <li><b>Router</b><small><a href={addressLink(addresses.buyRouter)} target="_blank" rel="noreferrer">{addresses.buyRouter}</a></small></li>
                <li><b>Lock</b><small><a href={addressLink(addresses.lock)} target="_blank" rel="noreferrer">{addresses.lock}</a></small></li>
              </ul>
              <button className="btn ghost full" onClick={() => void addChain()}>Add {NETWORK_LABEL} to my wallet</button>
            </section>
          </>
        )}

        <section className="notice"><b>Notice</b> {LEGAL_NOTICE} <a href={RESTRICTED_JURISDICTIONS_URL} target="_blank" rel="noopener noreferrer">Restricted jurisdictions</a><details><summary>Full list</summary><p>{RESTRICTED_JURISDICTIONS_TEXT}</p></details></section>
        <footer><span>Self-custody only. The app never holds your funds.</span><span>Live data from {NETWORK_LABEL} (4663).</span><span>Flatstock is independent and not affiliated with Robinhood.</span></footer>
      </main>

      <nav className="tabs bottom-tabs" aria-label="Sections">
        {TABS.map((item) => <button key={item.id} className={tab === item.id ? "on" : ""} onClick={() => goTab(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
      </nav>
    </div>
  );
}

type Tab = "home" | "vote" | "buy" | "portfolio" | "more";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "◔" },
  { id: "vote", label: "Vote", icon: "◎" },
  { id: "buy", label: "Buy", icon: "＋" },
  { id: "portfolio", label: "Portfolio", icon: "▤" },
  { id: "more", label: "More", icon: "⋯" },
];
function tabFromHash(): Tab {
  const hash = window.location.hash.replace("#", "");
  return (TABS.find((item) => item.id === hash)?.id ?? "home") as Tab;
}

function assetLabel(asset: { name?: string } | undefined) {
  return asset?.name ?? "";
}

const WEEKLY_SCHEDULE = "Rounds close every Monday at 15:00 WAT. The round that just closed sets the mix you can buy that week, and the next round opens for voting.";

function Schedule({ round }: { round: RoundState | null }) {
  return (
    <section className="schedule" aria-label="Weekly schedule">
      <p className="eyebrow">Weekly schedule</p>
      <p>{WEEKLY_SCHEDULE}</p>
      {round?.isOpen && <p className="helper">Round {round.roundId.toString()} closes {formatDate(round.closesAt)}.</p>}
    </section>
  );
}

const RING_COLORS = ["#2BD67B", "#1FA35E", "#8FE6B3", "#0F7A45", "#C8F2D9", "#5BB98A", "#3E8E66", "#A5D8BB"];

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

function Ring({ rows, center }: { rows: { label: string; weight: number }[]; center: string }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg className="ring" viewBox="0 0 140 140" role="img" aria-label={rows.map((row) => `${row.label} ${row.weight.toFixed(0)}%`).join(", ") || "Mix loading"}>
      <circle cx="70" cy="70" r={radius} className="ring-track" />
      {rows.map((row, index) => {
        const length = (row.weight / 100) * circumference;
        const circle = <circle key={row.label} cx="70" cy="70" r={radius} className="ring-seg" stroke={RING_COLORS[index % RING_COLORS.length]} strokeDasharray={`${Math.max(length - 2, 0)} ${circumference}`} strokeDashoffset={-offset} />;
        offset += length;
        return circle;
      })}
      <text x="70" y="75" textAnchor="middle" className="ring-text">{center}</text>
    </svg>
  );
}

function RoundCard({ item, test = false }: { item: PastRound; test?: boolean }) {
  const label = item.status === "closed" ? "Final" : item.status === "open" ? "Open" : item.status === "ended" ? "Ended" : "Unknown";
  return (
    <li className="round">
      <div className="row-between"><strong className="round-no">Round {item.roundId.toString()}</strong><span className={`pill ${item.status === "closed" ? "good" : ""}`}>{test ? "Test · " : ""}{label}</span></div>
      {item.weights ? (
        <ul className="legend">{assets.slice(0, item.assetCount).map((asset, i) => <li key={asset.symbol}><i style={{ background: RING_COLORS[i % RING_COLORS.length] }} /><b>{asset.symbol}</b><span>{formatWeightBps(item.weights?.[i] || 0n)}</span></li>)}</ul>
      ) : null}
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

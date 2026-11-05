import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  addresses,
  assets,
  chain,
  EXPLORER_URL,
  LEGAL_NOTICE,
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
function friendlyError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const short = (error as { shortMessage?: string }).shortMessage;
  const text = short || error.message;
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
      await refresh();
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
    if (!round) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before checking prices.` });
    try {
      setBusy("quote");
      setMessage(null);
      const nextPlan = await buildBuyPlan(buyAmount, round);
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
    if (!wallet || !account || !round) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: `Switch to ${NETWORK_LABEL} (4663) before buying.` });
    if (!round.isOpen) return setMessage({ tone: "info", text: "No vote round is open on mainnet." });
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
    if (!wallet || !account || chainId !== chain.id || !round?.isOpen) return;
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

  const roundStatus = round ? (round.isOpen ? "Open" : "Closed") : "Loading";
  const gasMode = useRelay ? "Signature relayed" : "Wallet gas";
  const totalValue = useMemo(
    () => holdings.reduce((sum, holding) => sum + (holding.value || 0), 0),
    [holdings],
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">F</span><h1>Flatstock</h1></div>
        <div className="topbar-actions">
          <span className={`network-pill ${chainId === null ? "" : chainId === chain.id ? "good" : "warn"}`}>
            {chainId === null ? "Read-only" : chainId === chain.id ? NETWORK_LABEL : "Wrong network"}
          </span>
          {account ? (
            <>
              <button className="wallet-chip" onClick={() => void refresh()} title={account}>
                {account.slice(0, 6)}...{account.slice(-4)}
              </button>
              <button className="secondary small" onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button className="primary small" onClick={() => void connect()}>Connect wallet</button>
          )}
        </div>
      </header>

      <section className="notice"><span>Notice</span>{LEGAL_NOTICE} <a href={RESTRICTED_JURISDICTIONS_URL} target="_blank" rel="noopener noreferrer">Restricted jurisdictions</a><details><summary>Full list</summary><p>{RESTRICTED_JURISDICTIONS_TEXT}</p></details></section>

      {chainId !== null && chainId !== chain.id && (
        <section className="alert error"><strong>Wrong network.</strong> Connect to {NETWORK_LABEL} (4663) to use the live contracts.
          <button className="text-button" onClick={() => void switchNetwork()}>Switch network</button>
        </section>
      )}
      {message && <section className={`alert ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</section>}

      <section className="hero card">
        <div>
          <p className="eyebrow">Community-picked stocks</p>
          <h2>Buy the US stocks the community picked, in one tap, with no gas.</h2>
          <p className="muted">$WIF holders choose the basket. You keep the Stock Tokens in your own wallet.</p>
          <ol className="steps">
            <li><b>1</b><span>Vote with $WIF<small>1 WIF per vote, burned</small></span></li>
            <li><b>2</b><span>Buy the mix<small>One signature, 0% fee</small></span></li>
            <li><b>3</b><span>Hold it yourself<small>Tokens go to your wallet</small></span></li>
          </ol>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><span>Round {round?.roundId.toString() || "..."}</span><strong>{roundStatus}</strong><small>{round ? `${round.totalVotes.toString()} vote${round.totalVotes === 1n ? "" : "s"} so far` : "Loading"}</small></div>
          <div className="hero-stat"><span>WIF burned by votes</span><strong>{formatWif(votesBurned * ONE_WIF)}</strong><small>1 WIF per vote</small></div>
        </div>
      </section>

      <div className="grid two">
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">Step 1 · This week</p><h3>Vote for the mix</h3></div><span className={`status ${round ? (round.isOpen ? "open" : "closed") : "pending"}`}>{roundStatus}</span></div>
          {round ? (
            <>
              <p className="muted">{round.isOpen ? `Closes ${formatDate(round.closesAt)}.` : `Closed ${formatDate(round.closesAt)}.`} {round.totalVotes.toString()} vote{round.totalVotes === 1n ? "" : "s"} counted.</p>
              <p className="helper">How the mix is set: half equal weight, half community votes. No stock can exceed 50%.{!MIX_RULES_ENABLED ? " Buys stay paused until the new vote contract is configured." : ""}</p>
              <div className="asset-list">
                {assets.map((asset, index) => (
                  <button key={asset.symbol} className={`asset-row ${selectedAsset === index ? "selected" : ""}`} onClick={() => setSelectedAsset(index)} disabled={!round.isOpen || index >= round.assetCount}>
                    <span className="asset-bar" style={{ width: `${Math.min(100, Number(round.weights[index] || 0n) / 100)}%` }} aria-hidden="true" /><span className="asset-symbol">{asset.symbol}</span><span className="weight">{formatWeightBps(round.weights[index] || 0n)}</span>
                  </button>
                ))}
              </div>
              <button className="secondary full" disabled={!account || chainId !== chain.id || !round.isOpen || busy !== null} onClick={requestVote}>
                {busy === "vote" ? "Waiting for wallet signature..." : account ? "Review vote: burn 1 WIF" : "Connect to vote"}
              </button>
              {confirmingVote && <div className="confirmation"><strong>{useRelay ? "Sign this vote" : "Confirm wallet vote"}</strong><p>This action spends exactly 1 WIF and burns it in the vote contract. {useRelay ? "Your wallet will sign the exact round, stock, nonce and deadline. The relayer can submit only that signed vote and pays the ETH gas." : "Your wallet signs the vote transaction and pays the ETH gas."} A first vote on the new contract may also ask for a one-time WIF approval.</p><div className="confirmation-actions"><button className="primary" disabled={busy !== null} onClick={() => void runVote()}>Sign and submit</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirmingVote(false)}>Cancel</button></div></div>}
              {submittedTx?.action === "vote" && <div className="tx-proof"><strong>Vote submitted and 1 WIF burned.</strong><a href={`${EXPLORER_URL}/tx/${submittedTx.hash}`} target="_blank" rel="noreferrer">View transaction</a></div>}
              {!round.isOpen && <p className="helper">Voting is closed for now. The next round opens soon.</p>}
            </>
          ) : <p className="muted">Loading the live round through the read-only proxy.</p>}
        </section>

        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">Your wallet</p><h3>Gas</h3></div><span className={`status ${gasMode === "Signature relayed" ? "open" : "closed"}`}>{useRelay ? "We pay your gas" : "You pay gas"}</span></div>
          {account ? (
            <div className="stat-stack">
              <div><span>ETH balance</span><strong>{formatEth(walletState?.eth || 0n)}</strong></div>
              <div><span>WIF balance</span><strong>{formatWif(walletState?.wif || 0n)}</strong></div>
              <div><span>Locked</span><strong>{walletState && walletState.locked > 0n ? formatWif(walletState.locked) : "Not locked"}</strong></div>
            </div>
          ) : <p className="muted">Connect a wallet to see if it qualifies for free gas. Lock 10 WIF and we pay the gas for your votes and buys.</p>}
          <button className="secondary full" disabled={!account || chainId !== chain.id || busy !== null || (walletState?.locked || 0n) > 0n} onClick={() => void runLock()}>
            {busy === "lock" ? "Waiting for confirmation..." : walletState?.locked ? "Free gas active" : "Lock 10 WIF for free gas"}
          </button>
          {account && !hasSponsorLock && <p className="helper">No WIF is locked, so this wallet pays its own ETH gas.</p>}
          {account && hasSponsorLock && !SIGNATURE_SAFE_WRITES_ENABLED && <p className="helper">Free gas is being configured. Until then this wallet pays its own gas.</p>}
          {health && <p className="helper">{sponsorshipPaused ? SPONSORSHIP_PAUSED_MESSAGE : `Free gas: ${health.enabled ? `${health.usage || 0} of ${health.dailyCap} sponsored actions used today` : "offline"}.`}</p>}
        </section>
      </div>

      <section className="card buy-card">
        <div className="section-heading"><div><p className="eyebrow">Step 2 · One tap</p><h3>Buy the voted mix</h3></div><span className="quiet">0% trading fee</span></div>
        <div className="buy-controls"><label>Amount in USDG<input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} aria-label="Amount in USDG" /></label><button className="secondary" disabled={!MIX_RULES_ENABLED || chainId !== chain.id || !round?.isOpen || busy !== null} onClick={() => void previewBuy()}>{busy === "quote" ? "Checking prices..." : "Check prices"}</button></div>
        {plan.length > 0 && <div className="quote-table"><div className="quote-header"><span>Asset</span><span>Quote vs Chainlink</span><span>Guard</span></div>{plan.map((leg) => <div className="quote-row" key={leg.symbol}><span>{leg.symbol}</span><span>${leg.quotePrice.toFixed(2)} / ${leg.chainlinkPrice.toFixed(2)}</span><span className="good-text">{(leg.differenceBps / 100).toFixed(2)}%</span></div>)}</div>}
        <button className="primary full" disabled={!MIX_RULES_ENABLED || !SIGNATURE_SAFE_WRITES_ENABLED || !account || chainId !== chain.id || !round?.isOpen || plan.length === 0 || busy !== null} onClick={requestBuy}>{busy === "buy" ? "Waiting for wallet signature..." : !MIX_RULES_ENABLED || !SIGNATURE_SAFE_WRITES_ENABLED ? "Buying is being configured" : plan.length === 0 ? "Check prices first" : account ? "Review this mix" : "Connect to buy"}</button>
        {confirmingBuy && <div className="confirmation"><strong>{useRelay ? "Sign this mix" : "Confirm wallet mix"}</strong><p>This action spends {buyAmount} USDG from your wallet and sends the Stock Tokens directly to your wallet. {useRelay ? "Your wallet signs the exact legs, minimum outputs, amount, nonce and deadline. A separate USDG permit signature lets the relayer pull only this amount and pay the ETH gas." : "Your wallet signs the exact one-transaction mix and pays the ETH gas."} The price guard has passed for every leg.</p><div className="confirmation-actions"><button className="primary" disabled={busy !== null} onClick={() => void runBuy()}>Sign and submit</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirmingBuy(false)}>Cancel</button></div></div>}
        {submittedTx?.action === "buy" && <div className="tx-proof"><strong>{submittedTx.finality ? `Buy complete at ${submittedTx.finality} finality.` : "Buy submitted. Waiting for finality confirmation."}</strong><a href={`${EXPLORER_URL}/tx/${submittedTx.hash}`} target="_blank" rel="noreferrer">View transaction</a></div>}
        <p className="helper">Safety check: every price must be within 2% of Chainlink, or the whole purchase is blocked.</p>
      </section>

      <details className="card fold">
        <summary><span><span className="eyebrow">Stock Token data</span><strong>Corporate actions</strong></span><span className="quiet">Shares update automatically</span></summary>
        {corporateActions.length === 0 ? <p className="muted">No recent corporate actions are available for this mix.</p> : <div className="action-list">{corporateActions.slice(0, 6).map((action, index) => {
          const symbol = action.symbol || "Stock";
          const label = action.type === "CASH_DIVIDEND"
            ? `${symbol} paid a dividend, your shares grew.`
            : action.type === "FORWARD_SPLIT"
              ? `${symbol} split, your share count grew.`
              : action.type === "REVERSE_SPLIT"
                ? `${symbol} reverse split, your share count changed.`
                : `${symbol} had a corporate action, your shares were updated.`;
          return <div className="action-row" key={`${symbol}-${action.effectiveAt || index}`}><strong>{label}</strong><small>{action.status || "Recorded"}{action.effectiveAtIso ? ` · ${formatDate(BigInt(action.effectiveAt || 0))}` : ""}</small></div>;
        })}</div>}
      </details>

      <section className="card buy-card">
        <div className="section-heading"><div><p className="eyebrow">Step 3 · Exit any time</p><h3>Sell a Stock Token</h3></div><span className="quiet">USDG straight to your wallet</span></div>
        <div className="buy-controls">
          <label>Asset<select value={sellSymbol} onChange={(event) => { setSellSymbol(event.target.value); setSellPlan(null); }} aria-label="Stock Token to sell">
            {assets.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>)}
          </select></label>
          <label>Amount in shares<input inputMode="decimal" value={sellAmount} onChange={(event) => { setSellAmount(event.target.value); setSellPlan(null); }} aria-label="Amount in shares to sell" /></label>
          <button className="secondary" disabled={!account || chainId !== chain.id || busy !== null} onClick={() => void previewSell()}>{busy === "sell-quote" ? "Checking price..." : "Check sell price"}</button>
        </div>
        {sellPlan && <div className="quote-table"><div className="quote-header"><span>Asset</span><span>Quote vs Chainlink</span><span>Guard</span></div><div className="quote-row"><span>{sellPlan.symbol}</span><span>${sellPlan.quotePrice.toFixed(2)} / ${sellPlan.chainlinkPrice.toFixed(2)}</span><span className="good-text">{(sellPlan.differenceBps / 100).toFixed(2)}%</span></div></div>}
        <button className="primary full" disabled={!account || chainId !== chain.id || !sellPlan || busy !== null} onClick={requestSell}>{busy === "sell" ? "Submitting permit and sell..." : sellPlan ? `Review ${sellPlan.symbol} sell` : "Check sell price first"}</button>
        {confirmingSell && sellPlan && <div className="confirmation"><strong>{useRelay ? `Sign ${sellPlan.symbol} sell` : `Confirm ${sellPlan.symbol} sell`}</strong><p>This action sells {sellAmount} shares back to USDG and sends the output directly to your wallet. {useRelay ? "You will sign two exact messages: a Stock Token permit for this token and amount, then the sell action. The relayer submits the permit first and sellBySig second in separate transactions, and pays both gas costs. Both signatures expire in 5 minutes. A failed sell cannot use a different token or amount, and it cannot be submitted after the signed action expires." : "Your wallet signs the exact transaction and pays the ETH gas."} The price guard passed.</p><div className="confirmation-actions"><button className="primary" disabled={busy !== null} onClick={() => void runSell()}>Sign and submit</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirmingSell(false)}>Cancel</button></div></div>}
        {submittedTx?.action === "sell" && <div className="tx-proof"><strong>Sell submitted.</strong><a href={`${EXPLORER_URL}/tx/${submittedTx.hash}`} target="_blank" rel="noreferrer">View transaction</a></div>}
        <p className="helper">Safety check: the price must be fresh and within 2% of Chainlink.</p>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">Your holdings</p><h3>Portfolio</h3></div><strong className="portfolio-total">${totalValue.toFixed(2)}</strong></div>
        {!account ? <p className="muted">Connect a wallet to see Stock Tokens held by that wallet.</p> : <div className="portfolio-list">{holdings.map((holding) => <button className="portfolio-row portfolio-button" key={holding.symbol} onClick={() => { setSellSymbol(holding.symbol); setSellPlan(null); }}><div><strong>{holding.symbol}</strong><small>{holding.shares ? `${holding.shares} shares` : Number(holding.balance) / 1e18 > 0 ? `${(Number(holding.balance) / 1e18).toFixed(6)} raw` : "No tokens"}</small></div><div>{holding.price === null ? "Price unavailable" : `$${holding.price.toFixed(2)}`}<small>{holding.value === null ? "" : `$${holding.value.toFixed(2)}`}</small></div></button>)}</div>}
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">On-chain record</p><h3>History</h3></div><span className="quiet">Votes, buys and sells</span></div>
        {!account ? <p className="muted">Connect any wallet to load its history from contract events.</p> : history.length === 0 ? <p className="muted">No votes, buys or sells found for this wallet.</p> : <div className="action-list">{history.slice(0, 20).map((item) => <div className="action-row" key={`${item.hash}-${item.kind}`}><strong>{item.title}</strong><small>{item.date} · {item.amount} · <a href={item.link} target="_blank" rel="noreferrer">Blockscout</a></small></div>)}</div>}
      </section>

      <footer><span>Self-custody only. The app never holds your funds.</span><span>Live data from {NETWORK_LABEL} (4663).</span><span>Flatstock is independent and not affiliated with Robinhood.</span></footer>
    </main>
  );
}

export default App;

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  addresses,
  assets,
  chain,
  EXPLORER_URL,
  LEGAL_NOTICE,
  lockAbi,
  MIX_RULES_ENABLED,
  ONE_WIF,
  RELAYER_API,
  votesAbi,
} from "./config";
import {
  buildApprove,
  buildBatch,
  buildBuyCall,
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
  readRound,
  readVoteBurned,
  readWalletState,
  sendDelegatedBatch,
  sendDirect,
  waitForTransactionFinality,
  type BuyLeg,
  type ConnectedWallet,
  type CorporateAction,
  type Holding,
  type RoundState,
  type SellLeg,
} from "./lib/chain";

type Health = { enabled: boolean; killSwitch: boolean; dailyCap: number; usage?: number; error?: string };
type SubmittedTx = { action: "vote" | "buy" | "sell"; hash: Hex; finality?: string };

function App() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [corporateActions, setCorporateActions] = useState<CorporateAction[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
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
        try {
          const response = await fetch(`${RELAYER_API}/health`, {
            headers: { "x-wallet": connectedAccount },
          });
          if (response.ok) setHealth((await response.json()) as Health);
        } catch {
          setHealth(null);
        }
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not refresh chain state." });
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
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Wallet connection was cancelled." });
    }
  };

  const switchNetwork = async () => {
    try {
      if (!wallet) return;
      await wallet.switchChain({ id: chain.id });
      setChainId(await wallet.getChainId());
      setMessage({ tone: "success", text: "Connected to the correct network." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Network switch was cancelled." });
    }
  };

  const disconnect = () => {
    setAccount(null);
    setWallet(null);
    setChainId(null);
    setWalletState(null);
    setHoldings([]);
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
        setMessage({ tone: "success", text: "Connected to chain 4663." });
        void refresh();
      } else {
        setMessage({ tone: "error", text: "Wrong network. Switch to chain 4663." });
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
    if (chainId !== chain.id) return setMessage({ tone: "error", text: "Switch to chain 4663 before voting." });
    if (!round.isOpen) return setMessage({ tone: "info", text: "No vote round is open on mainnet." });
    try {
      setBusy("vote");
      setConfirmingVote(false);
      setMessage(null);
      setSubmittedTx(null);
      const approve = buildApprove(addresses.votes, addresses.votes, ONE_WIF);
      const vote = encodeFunctionData({
        abi: votesAbi,
        functionName: "vote",
        args: [round.roundId, selectedAsset],
      });
      let voteHash: Hex;
      if (walletState?.delegated) {
        voteHash = await sendDelegatedBatch(wallet, account, [
          { target: addresses.wif, value: 0n, data: buildApprove(addresses.votes, addresses.votes, ONE_WIF) },
          { target: addresses.votes, value: 0n, data: vote },
        ]);
      } else {
        await sendDirect(wallet, account, addresses.wif, approve);
        voteHash = await sendDirect(wallet, account, addresses.votes, vote);
      }
      setSubmittedTx({ action: "vote", hash: voteHash });
      setMessage({ tone: "success", text: "Vote submitted. Exactly 1 WIF was burned. The relayer paid the ETH gas." });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Vote cancelled or failed." });
    } finally {
      setBusy(null);
    }
  };

  const runLock = async () => {
    if (!wallet || !account) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: "Switch to chain 4663 before locking WIF." });
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
      if (walletState?.delegated) await sendDelegatedBatch(wallet, account, calls);
      else {
        await sendDirect(wallet, account, addresses.wif, calls[0].data);
        await sendDirect(wallet, account, addresses.lock, calls[1].data);
      }
      setMessage({ tone: "success", text: "10 WIF locked. Sponsored buys are enabled for this wallet." });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Lock cancelled or failed." });
    } finally {
      setBusy(null);
    }
  };

  const previewBuy = async () => {
    if (!round) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: "Switch to chain 4663 before checking prices." });
    try {
      setBusy("quote");
      setMessage(null);
      const nextPlan = await buildBuyPlan(buyAmount, round);
      setPlan(nextPlan);
      setMessage({ tone: "success", text: "Price guard passed for every leg. The plan is ready to sign." });
    } catch (error) {
      setPlan([]);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Quote rejected." });
    } finally {
      setBusy(null);
    }
  };

  const runBuy = async () => {
    if (!wallet || !account || !round) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: "Switch to chain 4663 before buying." });
    if (!round.isOpen) return setMessage({ tone: "info", text: "No vote round is open on mainnet." });
    if (plan.length === 0) return setMessage({ tone: "info", text: "Check prices before buying." });
    try {
      setBusy("buy");
      setConfirmingBuy(false);
      setMessage(null);
      setSubmittedTx(null);
      const nextPlan = plan;
      const locked = walletState?.locked !== undefined && walletState.locked >= 10n * ONE_WIF;
      const gasWif = locked ? 0n : 10_000_000_000_000_000n;
      const totalIn = nextPlan.reduce((sum, leg) => sum + leg.amountIn, 0n);
      const calls = [
        { target: addresses.usdg, value: 0n, data: buildApprove(addresses.buyRouter, addresses.buyRouter, totalIn) },
        ...(!locked
          ? [{ target: addresses.wif, value: 0n, data: buildApprove(addresses.buyRouter, addresses.buyRouter, gasWif) }]
          : []),
        ...nextPlan.map((leg) => ({ target: addresses.buyRouter, value: 0n, data: buildBuyCall(leg, gasWif) })),
      ];
      let buyHash: Hex;
      if (walletState?.delegated) {
        buyHash = await sendDelegatedBatch(wallet, account, calls);
      } else if (walletState?.eth === 0n) {
        throw new Error("This wallet has no ETH and is not delegated for sponsorship.");
      } else {
        let lastHash: Hex | undefined;
        for (const call of calls) {
          const target = call.target === addresses.usdg || call.target === addresses.wif ? call.target : addresses.buyRouter;
          lastHash = await sendDirect(wallet, account, target, call.data);
        }
        if (!lastHash) throw new Error("The buy did not produce a transaction hash.");
        buyHash = lastHash;
      }
      setSubmittedTx({ action: "buy", hash: buyHash });
      const finality = await waitForTransactionFinality(buyHash);
      setSubmittedTx({ action: "buy", hash: buyHash, finality: finality.stage });
      setMessage({ tone: "success", text: `Buy complete at ${finality.stage} finality. Tokens were sent directly to your wallet.` });
      setPlan([]);
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Buy cancelled or failed." });
    } finally {
      setBusy(null);
    }
  };

  const previewSell = async () => {
    if (!account) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: "Switch to chain 4663 before checking prices." });
    try {
      setBusy("sell-quote");
      setMessage(null);
      const nextPlan = await buildSellPlan(sellSymbol, sellAmount, account);
      setSellPlan(nextPlan);
      setMessage({ tone: "success", text: "Sell price guard passed. Review the USDG you will receive." });
    } catch (error) {
      setSellPlan(null);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Sell quote rejected." });
    } finally {
      setBusy(null);
    }
  };

  const runSell = async () => {
    if (!wallet || !account || !sellPlan) return;
    if (chainId !== chain.id) return setMessage({ tone: "error", text: "Switch to chain 4663 before selling." });
    try {
      setBusy("sell");
      setConfirmingSell(false);
      setMessage(null);
      setSubmittedTx(null);
      const locked = walletState?.locked !== undefined && walletState.locked >= 10n * ONE_WIF;
      const gasWif = locked ? 0n : 10_000_000_000_000_000n;
      const calls = [
        { target: sellPlan.token, value: 0n, data: buildApprove(addresses.buyRouter, addresses.buyRouter, sellPlan.amountIn) },
        ...(!locked
          ? [{ target: addresses.wif, value: 0n, data: buildApprove(addresses.buyRouter, addresses.buyRouter, gasWif) }]
          : []),
        { target: addresses.buyRouter, value: 0n, data: buildSellCall(sellPlan, gasWif) },
      ];
      let sellHash: Hex;
      if (walletState?.delegated) {
        sellHash = await sendDelegatedBatch(wallet, account, calls);
      } else if (walletState?.eth === 0n) {
        throw new Error("This wallet has no ETH and is not delegated for sponsorship.");
      } else {
        let lastHash: Hex | undefined;
        for (const call of calls) {
          const target = call.target === addresses.wif || call.target === sellPlan.token ? call.target : addresses.buyRouter;
          lastHash = await sendDirect(wallet, account, target, call.data);
        }
        if (!lastHash) throw new Error("The sell did not produce a transaction hash.");
        sellHash = lastHash;
      }
      setSubmittedTx({ action: "sell", hash: sellHash });
      setMessage({ tone: "success", text: `${sellPlan.symbol} sold. USDG was sent directly to your wallet.` });
      setSellPlan(null);
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Sell cancelled or failed." });
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
  const totalValue = useMemo(
    () => holdings.reduce((sum, holding) => sum + (holding.value || 0), 0),
    [holdings],
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Community-picked stocks</p>
          <h1>Flatstock</h1>
        </div>
        <div className="topbar-actions">
          <span className={`network-pill ${chainId === null ? "" : chainId === chain.id ? "good" : "warn"}`}>
            {chainId === null ? "Read-only" : chainId === chain.id ? "Chain 4663" : "Wrong network"}
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

      <section className="notice"><span>Notice</span>{LEGAL_NOTICE}</section>

      {chainId !== null && chainId !== chain.id && (
        <section className="alert error"><strong>Wrong network.</strong> Connect to chain 4663 to use the live contracts.
          <button className="text-button" onClick={() => void switchNetwork()}>Switch network</button>
        </section>
      )}
      {message && <section className={`alert ${message.tone}`}>{message.text}</section>}

      <section className="hero card">
        <div>
          <p className="eyebrow">Community-picked stocks</p>
          <h2>Buy the US stocks the community picked, in one tap, with no gas.</h2>
          <p className="muted">$WIF holders choose the basket. You keep the Stock Tokens in your own wallet.</p>
        </div>
        <div className="hero-stat"><span>WIF burned by votes</span><strong>{formatWif(votesBurned * ONE_WIF)}</strong><small>1 WIF per vote</small></div>
      </section>

      <div className="grid two">
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">This week</p><h3>Vote round {round?.roundId.toString() || "..."}</h3></div><span className={`status ${round ? (round.isOpen ? "open" : "closed") : "pending"}`}>{roundStatus}</span></div>
          {round ? (
            <>
              <p className="muted">{round.isOpen ? `Closes ${formatDate(round.closesAt)}.` : `Closed ${formatDate(round.closesAt)}.`} {round.totalVotes.toString()} vote{round.totalVotes === 1n ? "" : "s"} counted.</p>
              <p className="helper">Mix rule preview: 50% equal-weight plus 50% vote share. No stock can exceed 50%.{!MIX_RULES_ENABLED ? " Buys stay paused until the new vote contract is configured." : ""}</p>
              <div className="asset-list">
                {assets.map((asset, index) => (
                  <button key={asset.symbol} className={`asset-row ${selectedAsset === index ? "selected" : ""}`} onClick={() => setSelectedAsset(index)} disabled={!round.isOpen || index >= round.assetCount}>
                    <span className="asset-symbol">{asset.symbol}</span><span className="weight">{formatWeightBps(round.weights[index] || 0n)}</span>
                  </button>
                ))}
              </div>
              <button className="secondary full" disabled={!account || chainId !== chain.id || !round.isOpen || busy !== null} onClick={requestVote}>
                {busy === "vote" ? "Submitting sponsored vote..." : account ? "Review vote: burn 1 WIF" : "Connect to vote"}
              </button>
              {confirmingVote && <div className="confirmation"><strong>Confirm sponsored vote</strong><p>This action spends exactly 1 WIF and burns it in the vote contract. Your wallet has 0 ETH. The approved relayer will submit the transaction and pay the ETH gas. No WIF or ETH is sent to the relayer.</p><div className="confirmation-actions"><button className="primary" disabled={busy !== null} onClick={() => void runVote()}>Confirm and submit</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirmingVote(false)}>Cancel</button></div></div>}
              {submittedTx?.action === "vote" && <div className="tx-proof"><strong>Vote submitted and 1 WIF burned.</strong><a href={`${EXPLORER_URL}/tx/${submittedTx.hash}`} target="_blank" rel="noreferrer">View transaction</a></div>}
              {!round.isOpen && <p className="helper">No vote round is open on mainnet. The organizer must open the next round.</p>}
            </>
          ) : <p className="muted">Loading the live round through the read-only proxy.</p>}
        </section>

        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">Eligibility</p><h3>Gas mode</h3></div><span className={`status ${walletState?.delegated ? "open" : "closed"}`}>{walletState?.delegated ? "Sponsored" : "Wallet"}</span></div>
          {account ? (
            <div className="stat-stack">
              <div><span>ETH balance</span><strong>{formatEth(walletState?.eth || 0n)}</strong></div>
              <div><span>WIF balance</span><strong>{formatWif(walletState?.wif || 0n)}</strong></div>
              <div><span>Locked</span><strong>{walletState && walletState.locked > 0n ? formatWif(walletState.locked) : "Not locked"}</strong></div>
            </div>
          ) : <p className="muted">Connect to check whether this wallet can use sponsored gas.</p>}
          <button className="secondary full" disabled={!account || chainId !== chain.id || busy !== null || (walletState?.locked || 0n) > 0n} onClick={() => void runLock()}>
            {busy === "lock" ? "Waiting for confirmation..." : walletState?.locked ? "WIF lock active" : "Lock 10 WIF for no gas"}
          </button>
          {health && <p className="helper">Sponsor: {health.killSwitch ? "paused" : health.enabled ? `${health.usage || 0}/${health.dailyCap} used today` : "offline"}.</p>}
        </section>
      </div>

      <section className="card buy-card">
        <div className="section-heading"><div><p className="eyebrow">One tap</p><h3>Buy the voted mix</h3></div><span className="quiet">0% trading fee</span></div>
        <div className="buy-controls"><label>Amount in USDG<input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} aria-label="Amount in USDG" /></label><button className="secondary" disabled={!MIX_RULES_ENABLED || chainId !== chain.id || !round?.isOpen || busy !== null} onClick={() => void previewBuy()}>{busy === "quote" ? "Checking prices..." : "Check prices"}</button></div>
        {plan.length > 0 && <div className="quote-table"><div className="quote-header"><span>Asset</span><span>Quote vs Chainlink</span><span>Guard</span></div>{plan.map((leg) => <div className="quote-row" key={leg.symbol}><span>{leg.symbol}</span><span>${leg.quotePrice.toFixed(2)} / ${leg.chainlinkPrice.toFixed(2)}</span><span className="good-text">{(leg.differenceBps / 100).toFixed(2)}%</span></div>)}</div>}
        <button className="primary full" disabled={!MIX_RULES_ENABLED || !account || chainId !== chain.id || !round?.isOpen || plan.length === 0 || busy !== null} onClick={requestBuy}>{busy === "buy" ? "Relaying your mix..." : !MIX_RULES_ENABLED ? "New mix contract required" : plan.length === 0 ? "Check prices first" : account ? "Review this mix" : "Connect to buy"}</button>
        {confirmingBuy && <div className="confirmation"><strong>Confirm sponsored mix</strong><p>This action spends {buyAmount} USDG from your wallet. Your Stock Tokens go directly to your wallet. The relayer pays the ETH gas and the price guard has passed for every leg. You can cancel here before submission.</p><div className="confirmation-actions"><button className="primary" disabled={busy !== null} onClick={() => void runBuy()}>Confirm and submit</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirmingBuy(false)}>Cancel</button></div></div>}
        {submittedTx?.action === "buy" && <div className="tx-proof"><strong>{submittedTx.finality ? `Buy complete at ${submittedTx.finality} finality.` : "Buy submitted. Waiting for finality confirmation."}</strong><a href={`${EXPLORER_URL}/tx/${submittedTx.hash}`} target="_blank" rel="noreferrer">View transaction</a></div>}
        <p className="helper">Every quote must exist and stay within 2% of Chainlink. A failed guard blocks the entire batch.</p>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">Stock Token data</p><h3>Corporate actions</h3></div><span className="quiet">Shares update automatically</span></div>
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
      </section>

      <section className="card buy-card">
        <div className="section-heading"><div><p className="eyebrow">Exit path</p><h3>Sell one Stock Token</h3></div><span className="quiet">Direct to your wallet</span></div>
        <div className="buy-controls">
          <label>Asset<select value={sellSymbol} onChange={(event) => { setSellSymbol(event.target.value); setSellPlan(null); }} aria-label="Stock Token to sell">
            {assets.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>)}
          </select></label>
          <label>Amount in shares<input inputMode="decimal" value={sellAmount} onChange={(event) => { setSellAmount(event.target.value); setSellPlan(null); }} aria-label="Amount in shares to sell" /></label>
          <button className="secondary" disabled={!account || chainId !== chain.id || busy !== null} onClick={() => void previewSell()}>{busy === "sell-quote" ? "Checking price..." : "Check sell price"}</button>
        </div>
        {sellPlan && <div className="quote-table"><div className="quote-header"><span>Asset</span><span>Quote vs Chainlink</span><span>Guard</span></div><div className="quote-row"><span>{sellPlan.symbol}</span><span>${sellPlan.quotePrice.toFixed(2)} / ${sellPlan.chainlinkPrice.toFixed(2)}</span><span className="good-text">{(sellPlan.differenceBps / 100).toFixed(2)}%</span></div></div>}
        <button className="primary full" disabled={!account || chainId !== chain.id || !sellPlan || busy !== null} onClick={requestSell}>{busy === "sell" ? "Submitting sell..." : sellPlan ? `Review ${sellPlan.symbol} sell` : "Check sell price first"}</button>
        {confirmingSell && sellPlan && <div className="confirmation"><strong>Confirm {sellPlan.symbol} sell</strong><p>This action sells {sellAmount} shares back to USDG and sends the output directly to your wallet. The price guard passed. If this wallet has no WIF lock, exactly 0.01 WIF is burned for gas.</p><div className="confirmation-actions"><button className="primary" disabled={busy !== null} onClick={() => void runSell()}>Confirm and submit</button><button className="secondary" disabled={busy !== null} onClick={() => setConfirmingSell(false)}>Cancel</button></div></div>}
        {submittedTx?.action === "sell" && <div className="tx-proof"><strong>Sell submitted.</strong><a href={`${EXPLORER_URL}/tx/${submittedTx.hash}`} target="_blank" rel="noreferrer">View transaction</a></div>}
        <p className="helper">Every sell quote must exist, be fresh, and stay within 2% of Chainlink.</p>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">Your holdings</p><h3>Portfolio</h3></div><strong className="portfolio-total">${totalValue.toFixed(2)}</strong></div>
        {!account ? <p className="muted">Connect a wallet to see Stock Tokens held by that wallet.</p> : <div className="portfolio-list">{holdings.map((holding) => <button className="portfolio-row portfolio-button" key={holding.symbol} onClick={() => { setSellSymbol(holding.symbol); setSellPlan(null); }}><div><strong>{holding.symbol}</strong><small>{holding.shares ? `${holding.shares} shares` : Number(holding.balance) / 1e18 > 0 ? `${(Number(holding.balance) / 1e18).toFixed(6)} raw` : "No tokens"}</small></div><div>{holding.price === null ? "Price unavailable" : `$${holding.price.toFixed(2)}`}<small>{holding.value === null ? "" : `$${holding.value.toFixed(2)}`}</small></div></button>)}</div>}
      </section>

      <footer><span>Self-custody only. The app never holds your funds.</span><span>Live data from chain 4663.</span></footer>
    </main>
  );
}

export default App;

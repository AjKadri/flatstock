import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import {
  addresses,
  assets,
  chain,
  LEGAL_NOTICE,
  lockAbi,
  ONE_WIF,
  ROUND_ID,
  votesAbi,
} from "./config";
import {
  buildApprove,
  buildBatch,
  buildBuyCall,
  buildBuyPlan,
  connectWallet,
  formatDate,
  formatEth,
  formatUsdg,
  formatWif,
  publicClient,
  readHoldings,
  readRound,
  readVoteBurned,
  readWalletState,
  sendDelegatedBatch,
  sendDirect,
  type BuyLeg,
  type ConnectedWallet,
  type Holding,
  type RoundState,
} from "./lib/chain";

type Health = { enabled: boolean; killSwitch: boolean; dailyCap: number; usage?: number; error?: string };

function App() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [walletState, setWalletState] = useState<Awaited<ReturnType<typeof readWalletState>> | null>(null);
  const [votesBurned, setVotesBurned] = useState<bigint>(0n);
  const [health, setHealth] = useState<Health | null>(null);
  const [buyAmount, setBuyAmount] = useState("5");
  const [selectedAsset, setSelectedAsset] = useState(0);
  const [plan, setPlan] = useState<BuyLeg[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const refresh = useCallback(async (connectedAccount = account) => {
    try {
      const [nextRound, burned] = await Promise.all([
        readRound(),
        readVoteBurned(),
      ]);
      setRound(nextRound);
      setVotesBurned(burned);
      if (connectedAccount) {
        const [nextHoldings, nextWallet] = await Promise.all([
          readHoldings(connectedAccount),
          readWalletState(connectedAccount),
        ]);
        setHoldings(nextHoldings);
        setWalletState(nextWallet);
        try {
          const response = await fetch("/api/health", {
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

  useEffect(() => {
    void refresh();
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
      setMessage(null);
      const approve = buildApprove(addresses.votes, addresses.votes, ONE_WIF);
      const vote = encodeFunctionData({
        abi: votesAbi,
        functionName: "vote",
        args: [ROUND_ID, selectedAsset],
      });
      if (walletState?.delegated) {
        await sendDelegatedBatch(wallet, account, [
          { target: addresses.wif, value: 0n, data: buildApprove(addresses.votes, addresses.votes, ONE_WIF) },
          { target: addresses.votes, value: 0n, data: vote },
        ]);
      } else {
        await sendDirect(wallet, account, addresses.wif, approve);
        await sendDirect(wallet, account, addresses.votes, vote);
      }
      setMessage({ tone: "success", text: "Vote submitted. Exactly 1 WIF is burned per vote." });
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
    try {
      setBusy("buy");
      setMessage(null);
      const nextPlan = plan.length > 0 ? plan : await buildBuyPlan(buyAmount, round);
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
      if (walletState?.delegated) {
        await sendDelegatedBatch(wallet, account, calls);
      } else if (walletState?.eth === 0n) {
        throw new Error("This wallet has no ETH and is not delegated for sponsorship.");
      } else {
        for (const call of calls) {
          const target = call.target === addresses.usdg || call.target === addresses.wif ? call.target : addresses.buyRouter;
          await sendDirect(wallet, account, target, call.data);
        }
      }
      setMessage({ tone: "success", text: "Mix bought. Tokens were sent directly to your wallet." });
      setPlan([]);
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Buy cancelled or failed." });
    } finally {
      setBusy(null);
    }
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
          <p className="eyebrow">Working name</p>
          <h1>Flat Index</h1>
        </div>
        <div className="topbar-actions">
          <span className={`network-pill ${chainId === chain.id ? "good" : "warn"}`}>
            {chainId === chain.id ? "Chain 4663" : "Wrong network"}
          </span>
          {account ? (
            <button className="wallet-chip" onClick={() => void refresh()} title={account}>
              {account.slice(0, 6)}...{account.slice(-4)}
            </button>
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
          <h2>Buy this week’s mix in one tap.</h2>
          <p className="muted">$WIF holders choose the basket. You keep the Stock Tokens in your own wallet.</p>
        </div>
        <div className="hero-stat"><span>WIF burned by votes</span><strong>{formatWif(votesBurned * ONE_WIF)}</strong><small>1 WIF per vote</small></div>
      </section>

      <div className="grid two">
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">This week</p><h3>Vote round {ROUND_ID.toString()}</h3></div><span className={`status ${round ? (round.isOpen ? "open" : "closed") : "pending"}`}>{roundStatus}</span></div>
          {round ? (
            <>
              <p className="muted">{round.isOpen ? `Closes ${formatDate(round.closesAt)}.` : `Closed ${formatDate(round.closesAt)}.`} {round.totalVotes.toString()} vote{round.totalVotes === 1n ? "" : "s"} counted.</p>
              <div className="asset-list">
                {assets.map((asset, index) => (
                  <button key={asset.symbol} className={`asset-row ${selectedAsset === index ? "selected" : ""}`} onClick={() => setSelectedAsset(index)} disabled={!round.isOpen || index >= round.assetCount}>
                    <span className="asset-symbol">{asset.symbol}</span><span className="weight">{Number(round.weights[index] || 0n) / 100}%</span>
                  </button>
                ))}
              </div>
              <button className="secondary full" disabled={!account || chainId !== chain.id || !round.isOpen || busy !== null} onClick={() => void runVote()}>
                {busy === "vote" ? "Waiting for confirmation..." : account ? "Vote and burn 1 WIF" : "Connect to vote"}
              </button>
              {!round.isOpen && <p className="helper">No vote round is open on mainnet. The organizer must open the next round.</p>}
            </>
          ) : <p className="muted">Connect a wallet to load the live round.</p>}
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
        <div className="buy-controls"><label>Amount in USDG<input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} aria-label="Amount in USDG" /></label><button className="secondary" disabled={chainId !== chain.id || !round?.isOpen || busy !== null} onClick={() => void previewBuy()}>{busy === "quote" ? "Checking prices..." : "Check prices"}</button></div>
        {plan.length > 0 && <div className="quote-table"><div className="quote-header"><span>Asset</span><span>Quote vs Chainlink</span><span>Guard</span></div>{plan.map((leg) => <div className="quote-row" key={leg.symbol}><span>{leg.symbol}</span><span>${leg.quotePrice.toFixed(2)} / ${leg.chainlinkPrice.toFixed(2)}</span><span className="good-text">{(leg.differenceBps / 100).toFixed(2)}%</span></div>)}</div>}
        <button className="primary full" disabled={!account || chainId !== chain.id || !round?.isOpen || busy !== null} onClick={() => void runBuy()}>{busy === "buy" ? "Relaying your mix..." : account ? "Buy this mix" : "Connect to buy"}</button>
        <p className="helper">Every quote must exist and stay within 2% of Chainlink. A failed guard blocks the entire batch.</p>
      </section>

      <section className="card">
        <div className="section-heading"><div><p className="eyebrow">Your holdings</p><h3>Portfolio</h3></div><strong className="portfolio-total">${totalValue.toFixed(2)}</strong></div>
        {!account ? <p className="muted">Connect a wallet to see Stock Tokens held by that wallet.</p> : <div className="portfolio-list">{holdings.map((holding) => <div className="portfolio-row" key={holding.symbol}><div><strong>{holding.symbol}</strong><small>{holding.shares ? `${holding.shares} shares` : Number(holding.balance) / 1e18 > 0 ? `${(Number(holding.balance) / 1e18).toFixed(6)} raw` : "No tokens"}</small></div><div>{holding.price === null ? "Price unavailable" : `$${holding.price.toFixed(2)}`}<small>{holding.value === null ? "" : `$${holding.value.toFixed(2)}`}</small></div></div>)}</div>}
      </section>

      <footer><span>Self-custody only. The app never holds your funds.</span><span>Live data from chain 4663.</span></footer>
    </main>
  );
}

export default App;

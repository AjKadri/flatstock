# Regenerates landing/docs/*.html. Run: python3 scripts/gen-docs.py
import os, html
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "landing", "docs")
EX = "https://robinhoodchain.blockscout.com"
def a(addr, label=None): return f'<a href="{EX}/address/{addr}" target="_blank" rel="noopener noreferrer"><code>{label or addr}</code></a>'
def tx(h): return f'<a href="{EX}/tx/{h}" target="_blank" rel="noopener noreferrer"><code>{h[:10]}…{h[-6:]}</code></a>'
VOTES="0x4BB945800d588E6B4DB287b3fCe9C13f7825A968"; ROUTER="0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7"; LOCK="0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121"
WIF="0x5173b8eA6923c2d40267890D45C46a3480954773"; USDG="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
NOTICE = 'Not available to US persons, or in Canada, the UK, Switzerland or other restricted jurisdictions. Not investment advice. <a href="https://docs.robinhood.com/rhj/restricted-jurisdictions" target="_blank" rel="noopener noreferrer">Restricted jurisdictions</a>'
NAV = [("", "Overview"), ("getting-started","Getting started"), ("voting","Voting"), ("trading","Buying and selling"), ("gas-and-lock","Gas and the 10 $WIF lock"),
       ("security","Security model"), ("tech-stack","Tech stack"), ("contracts","Contracts and addresses"), ("fees","Fees"), ("risks","Eligibility and risks"), ("faq","FAQ"), ("changelog","Changelog"), ("terms","Terms"), ("privacy","Privacy"), ("credits","Credits")]
P = {}
P[""] = ("Overview", """
<p class="lede">Flatstock lets you buy the US stocks the community picked, in one tap, with no gas. $WIF holders vote each round on a three-stock mix; you buy that mix into your own wallet on Robinhood Chain.</p>
<h2>The idea in four lines</h2>
<ol class="num"><li><b>Vote.</b> Each vote burns 1 $WIF and nudges next week's mix toward your pick.</li>
<li><b>Close.</b> When a round closes, its mix is final.</li>
<li><b>Buy.</b> One signature buys the final mix of the most recent closed round. Stock Tokens go straight to your wallet.</li>
<li><b>Hold or sell.</b> They are yours. Sell back to USDG any time.</li></ol>
<h2>This week and next week</h2>
<p>Buying uses the <b>final mix of the most recent closed round</b> ("This week's mix, Round N, final"). Voting always happens on the <b>open round</b> ("Vote for next week, Round N+1"). Rounds are closed and opened back to back, so buying and voting do not stop. Before the very first round has closed, the app shows a clearly labelled live preview instead.</p>
<h2>Weekly schedule</h2>
<p><b>Rounds close every Monday at 15:00 WAT</b> (Lagos time). At that moment the round's mix becomes final, buying switches to it for the week, and the next round opens for voting. Round 4 closes Mon 9 Nov 15:00 WAT (3 stocks). Round 5 has 8 stocks and closes Mon 16 Nov 15:00 WAT.</p>
<p>Example: <i>"This week: Round 4 final mix (3 stocks). Voting now: Round 5, 8 stocks, for next week."</i></p>
<h2>What it is not</h2>
<p>Flatstock is a hackathon project: it has not been audited, it is independent and not affiliated with Robinhood, and it does not give investment advice. See <a href="/docs/risks">Eligibility and risks</a>.</p>
<div class="cards"><a href="/docs/getting-started">Getting started</a><a href="/docs/voting">How voting works</a><a href="/docs/trading">Buying and selling</a><a href="/docs/security">Security model</a></div>
""")
P["getting-started"] = ("Getting started", f"""
<h2>1. A wallet</h2><p>Use any browser wallet that supports custom networks (the app also works inside wallet in-app browsers). Self-custody only: Flatstock never holds your funds.</p>
<h2>2. Add Robinhood Chain</h2>
<p>The app has an "Add Robinhood Chain" button (More tab, or the wrong-network banner). To add it by hand:</p>
<table><tr><th>Field</th><th>Value</th></tr><tr><td>Network name</td><td>Robinhood Chain</td></tr><tr><td>Chain ID</td><td><code>4663</code></td></tr><tr><td>RPC URL</td><td><code>https://rpc.mainnet.chain.robinhood.com</code></td></tr><tr><td>Currency</td><td>ETH</td></tr><tr><td>Explorer</td><td><code>{EX}</code></td></tr></table>
<h2>3. What you need to hold</h2>
<ul><li><b>USDG</b> to buy with ({a(USDG)}).</li><li><b>$WIF</b> to vote ({a(WIF)}). Each vote burns 1.</li><li><b>ETH</b> for gas, unless your wallet has the <a href="/docs/gas-and-lock">10 $WIF lock</a>.</li></ul>
<p>Flatstock does not sell these. Get them on Robinhood Chain through the venue you prefer.</p>
<h2>4. First steps</h2>
<ol class="num"><li>Open <a href="https://app.flatstock.ajkadri.dev">the app</a> and connect.</li><li>Check Home for this week's mix and the round countdown.</li><li>Optional: Vote for next week, and lock 10 $WIF for free gas.</li><li>Buy: enter an amount, check prices, review, sign.</li></ol>
<p class="small">Stock Tokens are not available to everyone. Read <a href="/docs/risks">Eligibility and risks</a> first.</p>
""")
P["voting"] = ("Voting", """
<h2>Rounds</h2><p>A round has a list of stocks (round 4 has three: AAPL, NVDA, MSFT; round 5 has eight: those plus AMZN, GOOGL, META, TSLA and SPY, the S&amp;P 500 ETF), an opening time and a closing time. The app always votes on the <b>open</b> round. After a round closes, its mix is frozen and used for buying.</p>
<h2>One vote per wallet, counted on-chain</h2><p><b>World is Fair-style voting:</b> one wallet, one vote, 1 $WIF burned — counted and burned on-chain by our contract, in the same transaction as the vote. Differences from World is Fair, stated plainly: Fair collects the $WIF and burns it after the event, and counts wallets funded from a shared source as one vote; Flatstock burns at vote time, costs exactly 1 $WIF, and does not look at where a wallet's funds came from (see the note on several wallets below). Rule source: <a href="https://worldisflat.fun/fair/docs.html" target="_blank" rel="noopener noreferrer">worldisflat.fun/fair/docs</a>.</p><p>The contract allows one vote per wallet per round, and every vote is an on-chain event anyone can check on Blockscout. Flatstock does not check who you are, so one person <i>can</i> use several wallets. That is allowed, but it is not free: each extra wallet's vote costs another 1 $WIF, and every one of those is burned like any other vote. Splitting across wallets does not make voting cheaper, it only burns more $WIF.</p>
<h2>Casting a vote</h2><ul><li><b>One vote per wallet per round.</b> A second attempt is rejected, and the app tells you so before spending anything.</li><li>Each vote <b>burns exactly 1 $WIF</b>, permanently.</li><li>A vote needs a $WIF approval of exactly 1 $WIF to the vote contract. That approval is an ordinary wallet transaction, so you pay its small gas even with the lock. It is not one-time: each vote uses up its approval, so every vote needs its own. Wallets such as Zerion or MetaMask may warn about it because the contracts are new; the contract is verified and the approval is for exactly 1 $WIF.</li><li>With the 10 $WIF lock, you sign the vote and the relayer pays the gas. Without it, your wallet sends the transaction and you pay the ETH gas.</li><li>Signed votes expire after 15 minutes.</li></ul>
<h2>How the mix is computed</h2>
<p>The mix is a blend: <b>50% equal weight + 50% vote share</b>, then <b>no stock may exceed 50%</b> (any excess is redistributed to the others). With zero votes, every stock gets an equal share.</p>
<table><tr><th>Example (3 stocks, 1 vote for AAPL)</th><th>Equal part (50%)</th><th>Vote part (50%)</th><th>Result</th></tr>
<tr><td>AAPL</td><td>16.67%</td><td>50.00%</td><td>66.67% → capped at 50%</td></tr><tr><td>NVDA</td><td>16.67%</td><td>0%</td><td>25%</td></tr><tr><td>MSFT</td><td>16.67%</td><td>0%</td><td>25%</td></tr></table>
<p class="small">The cap-excess goes to the other stocks equally, which is why round 4 shows 50 / 25 / 25.</p>
<h2>Vote share</h2><p>Each round stores its own vote share. Round 4 used <b>50%</b>. The vote share is the part of the mix that follows the votes; the rest is equal weight. The votes are counted as a <i>share</i>, not as a raw number: with a single vote or with ten votes all on the same stock, the mix is the same.</p>
<p>Round 5 uses a 50% vote share. The vote share may rise to 75% once rounds regularly get 20+ voters; it's set per round and shown in the app.</p>
<h2>Weekly schedule</h2><p>Rounds close every Monday at 15:00 WAT, and the next round opens at once. Round 5 closes Mon 16 Nov 15:00 WAT.</p>
<h2>Closing</h2><p>After a round's closing time, anyone can call <code>closeRound</code> on the contract. That stores the final weights. A closed round cannot be voted on again. Rounds on the current contract start at Round 4; earlier rounds ran on retired test contracts and are listed separately under "Test rounds".</p>
<h2>Past rounds</h2><p>The app (More tab) and the <a href="/#rounds">landing page</a> show each round's final mix, votes and $WIF burned, read straight from the chain, with Blockscout links.</p>
""")
P["trading"] = ("Buying and selling", """
<h2>Buying the mix</h2>
<ol class="num"><li>Choose an amount in USDG (<b>minimum $5</b>).</li><li>The app splits it by the mix weights (the final mix of the last closed round) into one swap per stock.</li><li><b>Check prices.</b> For each stock the app quotes the swap and compares it with the Chainlink price.</li><li>Review and sign. Tokens are sent directly to your wallet.</li></ol>
<h3>Adjust (a smaller custom set)</h3><p>By default you buy the full community mix. Press <b>Adjust</b> to untick stocks (keep at least 2). The stocks you keep keep the community's relative weights, rescaled to 100%. The same price guard applies to every leg. The 50% cap belongs to the community mix, so a small custom set can exceed 50% in one stock. Gasless buys of 2, 4 and 8 stocks all use the same contract and relayer.</p>
<h3>The price guard</h3><p>Every leg must be within <b>2% of Chainlink</b>. Each leg also needs a quote and a fresh, working Chainlink price (older than 24 hours counts as stale). If <b>any</b> leg fails, the whole buy is blocked. The minimum output of each leg is set 2% below its quote, and never more than 2% below the Chainlink price. When the relayer pays the gas, it checks that minimum against Chainlink again before sending and refuses the buy if it is lower.</p>
<h3>Free gas or your gas</h3><p>With the 10 $WIF lock and the relayer available, you sign two messages (a USDG permit for the exact amount, and the exact buy) and the relayer submits them and pays the gas. Otherwise your wallet sends the transaction, after an approval of the exact USDG amount if needed, and you pay the gas. Signed buys expire after 15 minutes.</p>
<h3>Buy complete</h3><p>The app waits for the chain's finality service before saying "Buy complete" and shows the finality stage. If it cannot confirm, it says the buy was submitted but finality was not confirmed, and links the transaction.</p>
<h2>Selling</h2><p>Pick a Stock Token and an amount in shares. The same price guard applies (fresh price, within 2% of Chainlink). With free gas you sign two messages (a permit for that token and amount, then the sell) that expire after <b>5 minutes</b>; the relayer submits both. The relayer also re-checks your signed minimum against Chainlink before it sends. USDG is sent straight to your wallet.</p>
<h2>Market hours</h2><p>Stock Token liquidity follows US market hours: roughly 15:30–22:00 Lagos time (WAT) on weekdays. Outside those hours quotes may be missing or stale, and the guard will block the trade rather than guess.</p>
<h2>Corporate actions</h2><p>Dividends and splits are handled by the Stock Token itself, so your share count updates automatically. The Portfolio tab lists recent actions.</p>
""")
P["gas-and-lock"] = (f"Gas and the 10 $WIF lock", f"""
<h2>The idea</h2><p>Lock <b>10 $WIF</b> and the relayer pays the gas for your votes and buys. The lock is your own $WIF, held in the lock contract ({a(LOCK)}); it has no owner and cannot move one user's balance to another account.</p>
<h2>Limits</h2><ul><li>Up to <b>3 sponsored transactions per wallet per day</b> (the day follows Lagos time). A vote or buy uses 1, a sell uses 2 (permit plus sell).</li><li>Sponsorship <b>pauses automatically</b> if the relayer's ETH balance falls below 0.0003 ETH, and there is a kill switch. When paused, the app says so and you can still buy and pay your own gas.</li><li>The relayer can only submit exactly what you signed.</li><li>The smallest buy the relayer will sponsor is 5 USDG.</li></ul>
<h2>Locking</h2><p>In the app: Portfolio → Free gas → "Lock 10 $WIF for free gas". Your wallet asks for a $WIF approval of exactly 10 $WIF and then the lock transaction (you pay that gas).</p>
<h2>Unlocking</h2><p>The lock contract has an <code>unlock(amount)</code> function: you can take back all of your locked $WIF, or part of it as long as what remains is still at least 10 $WIF. In the app, Portfolio → Free gas → Unlock returns all of your locked $WIF after a confirmation, and free gas turns off until you lock 10 $WIF again. You can unlock any time: there is no cooldown and no fee. Misuse is bounded by the 3-a-day cap per wallet, the cost of every sponsored action, and the automatic pause when the relayer's ETH is low. A minimum lock age could be added in the relayer later without changing any contract.</p>
<h2>Without a lock</h2><p>Nothing breaks. Every action is a normal wallet transaction and you pay the small ETH gas.</p>
""")
P["security"] = ("Security model", """
<p class="lede">Flatstock is built so it can only do what you signed. This page lists what the code does. It is a hackathon project and <b>has not been audited</b>.</p>
<h2>Self-custody</h2><p>Stock Tokens go directly to your wallet. The app never holds your funds, and there is no account.</p>
<h2>A signature for every action</h2><ul><li>Votes, buys and sells are authorised by your own EIP-712 signature for that exact action (round and stock, exact legs and minimum outputs, or exact token and amount), plus a nonce and a deadline.</li><li>Token movement uses standard EIP-2612 permits for the exact amount.</li><li>There is no account delegation (no EIP-7702) and nothing is paid in $WIF as gas.</li><li>The relayer can only submit what you signed. It cannot change the signed fields; it can refuse or delay a request, in which case you can send the same action from your own wallet and pay your own gas.</li></ul>
<h2>Price and oracle guards</h2><ul><li>Every swap leg must be within 2% of Chainlink, or the whole buy is blocked.</li><li>Missing quotes, stale prices (older than 24 hours) and unhealthy feeds fail closed.</li><li>Each leg has a minimum output.</li></ul>
<h2>Relayer limits</h2><ul><li>3 sponsored transactions per wallet per day.</li><li>Automatic pause when the relayer's ETH is low (below 0.0003 ETH); the pause fails closed if the balance cannot be read.</li><li>An operator kill switch.</li><li>The relayer's key is held only on the server; the website holds no secrets.</li></ul>
<h2>Contracts</h2><p>The votes, router and lock contracts all have exact-match source verification on Sourcify, and the source is in the <a href="https://github.com/AjKadri/flatstock" target="_blank" rel="noopener noreferrer">repository</a>. See <a href="/docs/contracts">Contracts and addresses</a>.</p><ul><li>None of the three contracts is a proxy and none can be upgraded: there is no <code>delegatecall</code> or <code>selfdestruct</code>.</li><li>The router and the lock contract have no owner and no admin functions.</li><li>The vote contract has one immutable owner (the relayer wallet). It can only open rounds. It cannot move, freeze or redirect anyone's $WIF. Closing a round is open to anyone after its closing time.</li><li>Approvals are exact: 1 $WIF to vote, 10 $WIF to lock, and only the USDG or Stock Token amount of the action you are doing.</li></ul><p>The full findings, with severities and what is mitigated, are in <a href="https://github.com/AjKadri/flatstock/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">SECURITY.md</a>.</p>
<h2>What we do not claim</h2><p>No audit, no insurance, no guarantee of availability. Use small amounts. Report a problem through the repository.</p>
""")
stocks = [("AAPL","0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9","0x6B22A786bAa607d76728168703a39Ea9C99f2cD0","0.05%"),("NVDA","0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC","0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15","0.05%"),("MSFT","0xe93237C50D904957Cf27E7B1133b510C669c2e74","0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E","0.3%"),("AMZN","0x12f190a9F9d7D37a250758b26824B97CE941bF54","0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C","0.3%"),("GOOGL","0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3","0xF6f373a037c30F0e5010d854385cA89185AE638b","0.05%"),("META","0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35","0x7C38C00C30BEe9378381E7B6135d7283356D71b1","0.3%"),("TSLA","0x322F0929c4625eD5bAd873c95208D54E1c003b2d","0x4A1166a659A55625345e9515b32adECea5547C38","0.3%"),("SPY","0x117cc2133c37B721F49dE2A7a74833232B3B4C0C","0x319724394D3A0e3669269846abE664Cd621f9f6A","0.05%")]
rows = "".join(f"<tr><td>{s}</td><td>{a(t, t[:6]+'…'+t[-4:])}</td><td>{a(f, f[:6]+'…'+f[-4:])}</td><td>{fee}</td></tr>" for s,t,f,fee in stocks)
P["contracts"] = ("Contracts and addresses", f"""
<p>Robinhood Chain, chain ID 4663. Every address links to Blockscout.</p>
<h2>Flatstock</h2><table><tr><th>Contract</th><th>Address</th><th>Notes</th></tr>
<tr><td>FlatstockVotes (current)</td><td>{a(VOTES)}</td><td>Rounds from Round 4. Verified on Blockscout and Sourcify.</td></tr>
<tr><td>FlatstockRouter</td><td>{a(ROUTER)}</td><td>Buys and sells. Blockscout "exact match" checked 5 Nov 2026.</td></tr>
<tr><td>FlatstockLock</td><td>{a(LOCK)}</td><td>10 $WIF minimum lock. Source in the repository; verified on Sourcify.</td></tr>
<tr><td>Relayer wallet</td><td>{a("0x6956C5bc2dBDb83d1216A02DA6b115bc4F8075F4")}</td><td>Pays sponsored gas. Holds only gas ETH.</td></tr></table>
<h2>Tokens and venues</h2><table><tr><th>Name</th><th>Address</th></tr><tr><td>$WIF</td><td>{a(WIF)}</td></tr><tr><td>USDG</td><td>{a(USDG)}</td></tr><tr><td>Uniswap router</td><td>{a("0xCaf681a66D020601342297493863E78C959E5cb2")}</td></tr><tr><td>Uniswap quoter</td><td>{a("0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7")}</td></tr></table>
<h2>Stocks in the mix</h2><p>Round 4 uses the first three (AAPL, NVDA, MSFT). Round 5 uses all eight. SPY is the S&amp;P 500 ETF. The list order is the on-chain asset index.</p><table><tr><th>Stock</th><th>Stock Token</th><th>Chainlink feed</th><th>Pool fee</th></tr>{rows}</table>
<h2>Retired test contracts</h2><p>These ran before the current contract. They are retired, the app ignores them for rounds, and their votes are included in the $WIF burned total.</p>
<ul><li>{a("0xEDB1FC3e26a53a2CC023e131A2D6c4B6F526B8E9")} · 3 votes</li><li>{a("0xD49249D2a5CffBCF35B6560857d1d1C703802e78")} · 0 votes</li><li>{a("0x68d2622f3bbf6BE80CdfED679489de344410C7Db")} · 1 vote</li></ul>
<p class="small">Source code: <a href="https://github.com/AjKadri/flatstock" target="_blank" rel="noopener noreferrer">github.com/AjKadri/flatstock</a> (Apache-2.0). Live relayer status: <a href="https://api.flatstock.ajkadri.dev/api/health" target="_blank" rel="noopener noreferrer">/api/health</a>.</p>
""")

P["tech-stack"] = ("Tech stack", f"""
<p class="lede">What Flatstock is built on, and exactly what each piece does here. Links go to the code.</p>
<h2 id="robinhood-chain">Robinhood Chain</h2>
<p>The Layer-2 network (chain ID 4663) where everything happens. The vote, router and lock contracts are deployed there, and every vote, burn, buy and sell is a transaction on it. The app reads rounds, burns and your history straight from the chain, and uses Blockscout as the explorer. Code: CODE_CHAIN</p>
<h2 id="stock-tokens">Stock Tokens</h2>
<p>The assets you actually buy: Robinhood's tokenized US stocks and ETFs on Robinhood Chain. Flatstock never issues or holds them. The router swaps USDG for them and sends them to your wallet; you can sell them back to USDG. Dividends and splits change your share count through the token's own multiplier, which the app shows as shares. Eight are used (AAPL, NVDA, MSFT, AMZN, GOOGL, META, TSLA, SPY). Code: CODE_STOCK</p>
<h2 id="wif">$WIF</h2>
<p>The community token. Voting burns 1 $WIF per vote in the vote contract. Locking 10 $WIF in the lock contract makes a wallet eligible for sponsored gas (up to 3 sponsored transactions a day). Nothing is paid in $WIF as gas. Code: CODE_WIF</p>
<h2 id="chainlink">Chainlink</h2>
<p>Every Stock Token has a Chainlink price feed on Robinhood Chain. Flatstock uses it in two ways: the price guard (each swap leg must be within 2% of the feed, and the feed must be fresh, at most 24 hours old, or the whole buy is blocked) and the live price and small chart beside each stock in the app (the last 20 feed rounds). The feeds report the token price already adjusted by its multiplier. Code: CODE_LINK</p>
<h2 id="quicknode">QuickNode Stock Token API</h2>
<p>Our relayer calls QuickNode's Stock Token API for Stock Token balances in USD, corporate actions (dividends and splits), oracle health (feed status and the market session) and transaction finality. The app waits for finality before it says "Buy complete". The Stock Token API is QuickNode-only. Code: CODE_QN</p>
<h2 id="getblock">GetBlock RPC</h2>
<p>General chain reads (prices, the vote mix, balances, the relayer's own reads) go to GetBlock's Robinhood Chain RPC first. If GetBlock errors, times out or rate-limits us, the same request is retried on QuickNode, then on the public Robinhood Chain RPC. If QuickNode is down, GetBlock keeps serving. A provider that fails is skipped for 30 seconds so users do not wait on it. The same method allow-list, request limits and 2% Chainlink check apply whichever provider answers, and sending transactions is still refused by the proxy. The relayer's health endpoint reports whether GetBlock is up. The GetBlock endpoint stays on the server and is never sent to the browser.</p>
<h2 id="uniswap">Uniswap</h2>
<p>The venue. Stocks are bought and sold against USDG in Uniswap pools, priced with Uniswap's quoter and executed through its swap router. Each stock uses the pool fee tier with the tightest quotes (0.05% or 0.3%). Flatstock's own router wraps the swaps so a whole mix, from 2 to 8 stocks, happens in one transaction that you sign once. Code: CODE_UNI</p>
""".replace("CODE_CHAIN", '<a href="https://github.com/AjKadri/flatstock/blob/main/web/src/config.ts" target="_blank" rel="noopener noreferrer"><code>web/src/config.ts</code></a> · <a href="https://github.com/AjKadri/flatstock/blob/main/src/FlatstockVotes.sol" target="_blank" rel="noopener noreferrer"><code>src/FlatstockVotes.sol</code></a>').replace("CODE_STOCK", '<a href="https://github.com/AjKadri/flatstock/blob/main/web/src/config.ts" target="_blank" rel="noopener noreferrer"><code>web/src/config.ts</code></a> · <a href="https://github.com/AjKadri/flatstock/blob/main/src/FlatstockRouter.sol" target="_blank" rel="noopener noreferrer"><code>src/FlatstockRouter.sol</code></a>').replace("CODE_WIF", '<a href="https://github.com/AjKadri/flatstock/blob/main/src/FlatstockVotes.sol" target="_blank" rel="noopener noreferrer"><code>src/FlatstockVotes.sol</code></a> · <a href="https://github.com/AjKadri/flatstock/blob/main/src/FlatstockLock.sol" target="_blank" rel="noopener noreferrer"><code>src/FlatstockLock.sol</code></a>').replace("CODE_LINK", '<a href="https://github.com/AjKadri/flatstock/blob/main/web/src/lib/chain.ts" target="_blank" rel="noopener noreferrer"><code>web/src/lib/chain.ts</code></a> · <a href="https://github.com/AjKadri/flatstock/blob/main/web/src/lib/prices.ts" target="_blank" rel="noopener noreferrer"><code>web/src/lib/prices.ts</code></a>').replace("CODE_QN", '<a href="https://github.com/AjKadri/flatstock/blob/main/web/relayer/server.ts" target="_blank" rel="noopener noreferrer"><code>web/relayer/server.ts</code></a>').replace("CODE_UNI", '<a href="https://github.com/AjKadri/flatstock/blob/main/src/FlatstockRouter.sol" target="_blank" rel="noopener noreferrer"><code>src/FlatstockRouter.sol</code></a> · <a href="https://github.com/AjKadri/flatstock/blob/main/web/relayer/stock-study.mjs" target="_blank" rel="noopener noreferrer"><code>web/relayer/stock-study.mjs</code></a>'))

P["fees"] = ("Fees", """
<h2>Flatstock fee: 0%</h2><p>Flatstock takes no trading fee today. The fee switch is off.</p>
<h2>What you do pay</h2><ul><li><b>The swap price</b>, including the Uniswap pool fee of each stock's pool (0.05% for AAPL, NVDA, GOOGL and SPY; 0.3% for MSFT, AMZN, META and TSLA) and market spread, which the price guard keeps within 2% of Chainlink.</li><li><b>ETH gas</b> for your own transactions: the exact 1 $WIF approval before each vote, the lock approval and the lock transaction, and any action when you have no lock. With the lock, votes and buys are sponsored (up to 3 per day).</li><li><b>1 $WIF</b> burned per vote.</li></ul>
<p class="small">Relayer costs measured on a fork of the real pools at the live gas price: about 0.0000084 ETH for a 2-stock gasless buy, 0.0000123 for 4 stocks and 0.0000223 for 8 stocks, and about 0.0000067 for a gasless sell. A vote costs about 0.000003 ETH. Minimum buy: 5 USDG.</p>
""")
P["risks"] = ("Eligibility and risks", f"""
<h2>Availability</h2><p>{NOTICE}</p>
<p>Stock Tokens are <b>restricted</b> for the United States and U.S. persons, Canada, the United Kingdom and Switzerland, and <b>prohibited</b> for Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar and Venezuela. Source: <a href="https://docs.robinhood.com/rhj/restricted-jurisdictions" target="_blank" rel="noopener noreferrer">docs.robinhood.com/rhj/restricted-jurisdictions</a>, checked 5 Nov 2026. The list may change. You are responsible for following the rules where you live.</p>
<h2>Not investment advice</h2><p>Flatstock shows a community-voted mix. It is not a recommendation, and stock prices can fall. You can lose money.</p>
<h2>Technical risks</h2><ul><li>Hackathon software, <b>not audited</b>. Smart contracts can have bugs.</li><li>Prices come from onchain pools; the guard blocks trades more than 2% from Chainlink but cannot remove market risk.</li><li>Stock Tokens trade against USDG on-chain, and liquidity can be thin, especially outside US market hours.</li><li>The relayer is run by one operator and can be paused or run out of gas funds. You can always use normal wallet transactions instead.</li></ul>
<h2>Independence</h2><p>Flatstock is independent and not affiliated with Robinhood. "Robinhood Chain" is used only to name the network.</p>
""")
P["faq"] = ("FAQ", """
<h2>Can I vote more than once?</h2><p>No. One vote per wallet per round, 1 $WIF burned.</p>
<h2>My vote did not count. Why?</h2><p>Most likely your wallet already voted in this round. The app now checks before it asks you to sign.</p>
<h2>Which round does my buy use?</h2><p>The final mix of the most recent closed round.</p>
<h2>Why does the app say "preview mix"?</h2><p>The first round has not closed yet, so there is no final mix. The preview shows the live vote result and is replaced by the final mix after the round closes.</p>
<h2>Why was my buy blocked?</h2><p>The price guard blocked it: a quote was missing, a price was stale, or a leg was more than 2% from Chainlink. This happens most outside US market hours. Try again later.</p>
<h2>Can I buy only some of the stocks?</h2><p>Yes. On the Buy tab press Adjust and untick stocks (keep at least 2). The rest keep the community's relative weights.</p>
<h2>Is there a minimum buy?</h2><p>Yes, 5 USDG.</p>
<h2>When do rounds close?</h2><p>Every Monday at 15:00 WAT. Round 4: Mon 9 Nov. Round 5: Mon 16 Nov.</p>
<h2>Do I need ETH?</h2><p>Only if your wallet has no 10 $WIF lock, or for the exact 1 $WIF approval before each vote and for the lock itself.</p>
<h2>Is it safe?</h2><p>It is designed so every action needs your own signature and nothing is held for you, but it is unaudited. Read the <a href="/docs/security">security model</a> and use small amounts.</p>
<h2>Can I take my $WIF back from the lock?</h2><p>Yes, any time. Portfolio → Free gas → Unlock returns all of it. See <a href="/docs/gas-and-lock">Gas and the lock</a>.</p>
""")
P["changelog"] = ("Changelog", f"""
<h2>5 Nov 2026</h2><ul><li>Round 5 will have 8 stocks (AAPL, NVDA, MSFT, AMZN, GOOGL, META, TSLA, SPY). Weekly schedule: rounds close every Monday 15:00 WAT.</li><li>Minimum buy 5 USDG; "Adjust" lets you buy a smaller custom set of 2 or more stocks.</li><li>New app UI: mobile-first tabs, vote orbit, mix ring, past rounds.</li><li>Buys now use the final mix of the most recent closed round; voting runs on the open round.</li><li>New landing page and these docs.</li><li>The $WIF burned total now includes all retired test contracts (5 in all).</li><li>Clear message when a wallet has already voted in a round.</li><li>Relayer pauses sponsorship when its ETH balance is low.</li></ul>
<h2>4 Nov 2026</h2><ul><li>Live mainnet test passed: signed permit sell, gasless 3 USDG full-mix buy, normal-wallet buy. Round 4 opened on the current contract ({tx("0x7776a75a5da7e8f2067a2ff23bfbcadac810bd0168b41f58713e81aa082dfe80")}).</li></ul>
<p class="small">Mainnet results are recorded in <code>CHECKS.md</code> in the repository.</p>
""")
P["terms"] = ("Terms", """
<p class="small"><b>Draft for the project team to review before submission.</b> This is a plain-language summary, not legal advice.</p>
<h2>1. What this is</h2><p>Flatstock is a hackathon project that helps you buy a community-voted mix of Stock Tokens on Robinhood Chain. It is provided as is, without warranties.</p>
<h2>2. Your responsibility</h2><p>You are responsible for your wallet, your keys and your signatures, and for following the laws where you live. You must not use Flatstock if you are in, or are, a person from a restricted or prohibited jurisdiction listed in <a href="/docs/risks">Eligibility and risks</a>.</p>
<h2>3. No advice</h2><p>Nothing here is investment, legal or tax advice.</p>
<h2>4. Risk</h2><p>Smart contracts and markets carry risk, including total loss. The software is unaudited. Votes burn $WIF permanently and cannot be reversed.</p>
<h2>5. Availability</h2><p>The app, the relayer and gas sponsorship may be paused, limited or stopped at any time. You can always use ordinary wallet transactions with the public contracts.</p>
<h2>6. Independence</h2><p>Flatstock is independent and not affiliated with Robinhood.</p>
<h2>7. Open source</h2><p>The code is Apache-2.0 licensed in the repository.</p>
""")
P["privacy"] = ("Privacy", """
<p class="small"><b>Draft for the project team to review before submission.</b></p>
<h2>What we ask for</h2><p>No name, email or account. You connect a wallet and sign.</p>
<h2>What our servers see</h2><ul><li>When you use the app, requests go to our RPC proxy and relayer API. They see your IP address, your wallet address (for the daily cap) and the requests you make. Daily usage counters are kept in memory. Standard web server logs may keep IP addresses for a limited time.</li><li>On-chain data (votes, buys, sells, locks) is public by nature.</li></ul>
<h2>Third parties</h2><ul><li>Fonts are loaded from Google Fonts.</li><li>The landing page reads public data directly from the Robinhood Chain RPC.</li><li>Links to Blockscout and other sites are governed by their own policies.</li></ul>
<h2>No tracking</h2><p>We do not use advertising trackers or analytics cookies on the app or the landing page.</p>
""")
P["credits"] = ("Credits", """
<h2>Fonts</h2><ul><li>Anton, Inter Tight and JetBrains Mono, via Google Fonts (SIL Open Font License).</li></ul>
<h2>Libraries</h2><ul><li>React, Vite and viem (MIT).</li><li>GSAP and ScrollTrigger (GreenSock standard licence, free to use).</li><li>Lenis (MIT).</li></ul>
<h2>Data</h2><ul><li>Prices: Chainlink feeds on Robinhood Chain. Quotes: Uniswap. Explorer: Blockscout.</li></ul>
<h2>Imagery</h2><p>All visuals are drawn in code. The site uses no third-party photos and no company logos.</p>
<h2>Independence</h2><p>Flatstock is independent and not affiliated with Robinhood.</p>
""")

def page(slug, title, body):
    nav = "".join(f'<a href="/docs{"/"+s if s else ""}"{" class=on aria-current=page" if s==slug else ""}>{html.escape(t)}</a>' for s,t in NAV)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="theme-color" content="#E6F7D9" />
<title>{html.escape(title)} · Flatstock docs</title><meta name="description" content="Flatstock docs: {html.escape(title)}." />
<meta property="og:title" content="{html.escape(title)} · Flatstock docs" /><meta property="og:image" content="https://flatstock.ajkadri.dev/og.png" /><meta name="twitter:card" content="summary_large_image" /><link rel="icon" type="image/svg+xml" href="/favicon.svg" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/docs/docs.css" /></head>
<body><header class="top"><a class="brand" href="/"><img src="/logo.svg" alt="" width="30" height="30" /><span>Flatstock</span></a><nav class="top-links"><a href="/docs">Docs</a><a href="https://github.com/AjKadri/flatstock" target="_blank" rel="noopener noreferrer">GitHub</a><a class="open" href="https://app.flatstock.ajkadri.dev">Open app</a></nav></header>
<div class="layout"><details class="side" open><summary>Docs menu</summary><nav aria-label="Docs">{nav}</nav></details>
<main><p class="eyebrow">Docs</p><h1>{html.escape(title)}</h1>{body}
<p class="notice"><b>Notice</b> {NOTICE}</p></main></div>
<footer><span>Flatstock is independent and not affiliated with Robinhood.</span><a href="/docs/terms">Terms</a><a href="/docs/privacy">Privacy</a><a href="/docs/credits">Credits</a><a href="https://x.com/flatstockapp" target="_blank" rel="noopener noreferrer">X</a></footer>
<script>if(matchMedia("(max-width:860px)").matches){{var d=document.querySelector(".side");if(d)d.removeAttribute("open");}}</script>
</body></html>"""
os.makedirs(OUT, exist_ok=True)
for slug,(title,body) in P.items():
    path = os.path.join(OUT, (slug or "index")+".html")
    open(path,"w").write(page(slug,title,body))
print(len(P),"pages")

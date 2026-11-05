# Build plan v3: Flat Index (working name), gasless, community-voted stocks
**Updated Fri 30 Oct 09:30 Lagos:** the product is now the Flat Index: $WIF holders vote weekly on a stock mix (each vote burns $WIF), and users buy that mix gasless, straight into their own wallet. There is no vault. Gasless buying from v2 is the engine. Sections 1, 3, 4, 5 and 6 below are updated; the rest is unchanged.

Written Fri 30 Oct 2026, 00:10 Lagos (/hackathon-build-and-submit, Mode 1). **This replaces PLAN.md**, which is kept as the fallback (the staked tipster).
Builder: solo with AI coding agents (Codex). Read RULES.md and ECOSYSTEM.md in research/.
**Working name only.** The product name, logo and subdomain are the user's call; ask first.

## 1. Core loop (plain sentence)
**"Buy the stocks $WIF holders voted for this week, in one tap, with no gas."**

1. **Weekly vote.**
   - Each round (e.g. Mon–Fri), $WIF holders vote on the weight of each stock in a fixed list of 5–8 Stock Tokens.
   - **One wallet, one vote, costs 1 $WIF, burned**: World is Fair-style. Optionally, a capped extra weight for more $WIF.
   - At round close, the new mix is fixed on-chain and anyone can recompute it.
2. **Buy the mix.**
   - A user taps "buy this week's Flat Index for $20".
   - The app splits the money across the voted stocks at the current weights and buys each one through an aggregator, **straight into the user's own wallet**.
   - The app never holds funds.
3. **Gasless.**
   - Users who lock a minimum amount of $WIF buy with **no gas** (our relayer pays).
   - Others pay gas in $WIF, and part of it is burned.
4. **Your holdings.** A portfolio view shows each stock (Chainlink prices) and how close the user's mix is to this week's vote.
5. **Optional later: "follow the vote".** Rebalances the user's *own* wallet toward the new mix with a spend-limited permission.

**The vote is pitched as "World is Fair-style voting", not "built on World is Fair".** Their votes are counted off-chain by the organisers, so we copy the mechanic and count on-chain ourselves.

## 2. Money and fee model
| Item | Hackathon version | Later (only after legal advice) |
|---|---|---|
| Trading fee | **0%**. A fee switch is built in but set to 0. | Turn on a small fee (e.g. 0.3–0.5%). Lockers pay less. |
| Gas | **Paid by the user (the app owner)** from a sponsor balance (Alchemy Gas Manager or ZeroDev). Budget set from the check 1 measurement. | Paid out of the fee. |
| $WIF burn | **From gas paid in $WIF** by users who didn't lock. | Plus a share of every fee buys $WIF and burns it. |
| User's income | None during the hackathon (the 10,000 USDG prize aside). | The fee, after gas and the burn share. |

**Why $WIF matters** (the judges' first criterion): every user who wants free gas locks $WIF, and everyone else spends $WIF on gas, which burns some. Weekly auto-buys bring people back, which is the flywheel.

**Legal guardrails (from the start).** None of this is legal advice.
- Self-custody only: the app never holds user funds.
- Block US persons and the restricted countries (docs.robinhood.com/rhj/restricted-jurisdictions).
- Show the "not available to US persons, not investment advice" notice and clear terms.
- No fee until legal advice is obtained.

## 3. The checks (run FIRST, Fri 30 Oct, US market hours 14:30–21:00 Lagos)
Only behaviour observed on mainnet passes. Use tiny amounts. **Ask the user before every mainnet transaction.** No paid services: no Alchemy Gas Manager.

**Check 1: Free gas through our own relayer, and its cost**
- *Pass:* a user wallet holding **0 ETH** gets a transaction executed with gas paid by our server wallet. Methods in order of preference:
  1. EIP-7702 delegation plus our relayer;
  2. EIP-712 meta-transaction through our router;
  3. our own ERC-4337 paymaster with a free bundler.
- Record the gas cost in USD per buy.

**Check 2: Buying a mix lands fairly in the user's wallet**
- *Pass:* buy about $5 split across 2–3 Stock Tokens with USDG through an aggregator (0x / LiFi / 1inch RFQ, Uniswap as fallback) in **one user action**.
  - Every fill is within 2% of that token's Chainlink price.
  - The tokens arrive in the user's wallet, not in our contract.
- Then sell one back.

**Check 3: The vote counts and burns correctly**
- *Pass, on a fork, then one tiny mainnet round:*
  - a vote costs exactly 1 $WIF, which is burned;
  - a second vote from the same wallet in the same round is rejected;
  - weights at close match the votes;
  - the round can't be changed after close.

If a check fails:
- Check 1 fails → users need a little ETH. The pitch shifts from "no gas" to "one-tap community mix".
- Check 2 fails → limit to the most liquid stocks, or buy one stock per transaction.
- Check 3 fails → fix it, since this is the core.

## 4. Scope tiers
**Must ship**
- Vote contract (weekly rounds, 1 $WIF per wallet burned, weights fixed at close).
- Buy-the-mix router (aggregator quotes, delivered to the user's wallet).
- Relayer for free gas for $WIF lockers, and gas-in-$WIF with a burn for others.
- $WIF lock contract.
- Web app: vote, buy the mix, portfolio.
- Country block and notices.
- Public stats page: votes, $WIF burned, buys, $WIF locked, each linked to Blockscout.

**Second tier** (after the core demo is recorded)
- Passkey sign-up.
- "Follow the vote" auto-rebalance with a spend limit.
- Weekly auto-buy.
- Telegram buy bot.
- A shareable "my Flat Index" card.

**Never (this hackathon)**
- A pooled vault or index share token.
- Turning the fee on.
- Lending.
- Leverage.
- Fiat on-ramp.

## 5. Milestones (Lagos time)
| # | Milestone | Acceptance check | Target |
|---|---|---|---|
| M1 | Repo + agent files; the three checks | Each check's output shown (tx hashes, gas in USD, fill vs Chainlink price, vote burn and double-vote revert) | **Fri 30 Oct 21:00** |
| M2 | Vote contract + router + relayer on mainnet; first real round opened | A 0-ETH locker buys the mix gasless; a non-locker's gas burns $WIF; votes burn $WIF (txs shown) | Sat 31 Oct 12:00 |
| M3 | Web app core loop (desktop + mobile browser) | A new user connects, votes, locks, buys the mix and sees the portfolio. Wrong network and cancel are handled. | **Sat 31 Oct 20:00 (midpoint)** |
| M4 | Round 1 closed + stats page + first second-tier item | A real round closes, the mix updates, the stats page shows burns. Invite real $WIF holders to vote from Sat. | Sun 1 Nov 12:00 |
| — | **Packaging reserve starts; building stops except for fixes** | | **Sun 1 Nov 14:00** |
| M5 | Judge audit, video, page, README | Recorded and drafted | Sun 1 Nov 23:00 |
| M6 | /hackathon-submission-audit | AUDIT.md, fixes done | Mon 2 Nov 12:00 |
| M7 | **Submitted**, repo tagged `submission` | Platform shows it submitted | **Mon 2 Nov 15:00** (lock is 18:30) |

**Market hours:** live stock buys can fill outside US hours through DEX pools, but RFQ quotes and Chainlink prices are best during market hours. The demo's main buys must be recorded **today (Fri) 14:30–21:00 or Mon 2 Nov 15:30–18:30**.

## 6. The replayable case
"Ada" (placeholder name; confirm with the user), in Lagos, holds a little $WIF and has never bought a US stock.
1. She sees this week's Flat Index, voted by $WIF holders: e.g. 40% NVDA, 30% AAPL, 30% MSFT.
2. She votes for next week. 1 $WIF is burned (tx shown).
3. She locks some $WIF and taps "buy $10 of this week's mix". **Gas: $0.** Three stocks arrive in **her own wallet**, each at a fair price vs Chainlink.
4. Her friend, who didn't lock, buys too, pays gas in $WIF, and the burn appears on the stats page.
5. The round closes, and the new mix shows next week's weights from everyone's votes.

**Benefit:** a non-US person owns a diversified set of US stocks in one tap, with no gas, chosen by a community, and holds them herself.

## 7. How a judge can check it
- **Live:** the judge signs up with a passkey and buys a tiny amount themselves. Sponsored gas is capped per account per day, with a kill switch.
- **Public stats page:** every buy, lock and burn is linked to Blockscout.

## 8. Claim-to-evidence map
| Claim | Evidence |
|---|---|
| No gas for lockers | Relayed tx paid by our server wallet; user ETH balance 0 |
| Non-lockers' gas burns $WIF | Burn transaction links; running total |
| Fair fills | Fill price vs Chainlink price shown per trade |
| Votes are fair and burn $WIF | Burn tx per vote; double-vote revert; recomputable weights |
| Users hold their own stocks | Token balances in user wallets, none in our contracts |
| **Benefit:** a non-US user owns a community-picked mix of US stocks in one tap | Timed screen recording of a fresh user's buy |

## 9. Evidence labels
- Buys, locks, burns: **live** on mainnet.
- Vote round shortened for the demo, if needed: **live**, labelled.
- Users: real outsiders only; anything the user funds is labelled "assisted".

## 10. Decisions needed from the user
1. Product name and logo.
2. Licence (suggested: Apache-2.0).
3. Subdomain on the user's domain.
4. Gas budget (set after check 1).
5. A funded wallet: a little ETH, USDG, and $WIF. Keys only in env vars.
6. Sign in on /build and copy the submission form fields into research/RULES.md.

## Schedule update

This section supersedes the dates in section 5 for the current submission.

- US market hours for live Stock Token buys: **15:30–22:00 Lagos (WAT)**.
- Round 3 short test round: opens when approved and closes **Sun 1 Nov 2026 21:00 WAT**.
- Real public round: opens **Wed 4 Nov 2026** and closes **Mon 9 Nov 2026 15:00 WAT**. Opening it requires separate user approval.
- Submissions close **Thu 12 Nov 2026 17:30 UTC**.
- The app must stay live until the final closes **Mon 16 Nov 2026 17:30 UTC**.

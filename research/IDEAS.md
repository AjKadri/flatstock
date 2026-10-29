# World is Flat hackathon: idea research (v2)
28 Oct 2026, ~22:15 WAT. v1 is kept as IDEAS-v1.md (full cards for the basket, the stock-call game, send-a-stock and weekend orders; this file only adds what changed).
Kept by you: Idea 1 (basket) and Idea 2 (stock-call game). New rule applied: every idea leads with **one everyday sentence anyone gets immediately** ("OpenSea: buy and sell NFTs").
Working labels only. Names are yours to pick.

## 1. The list at a glance

| Rank | Plain sentence | Who / benefit | Categories | Rubric fit | Ambition | Exec risk | Evidence | Riskiest assumption | Organiser need | Build |
|---|---|---|---|---|---|---|---|---|---|---|
| **1 ★** | **Buy the top AI stocks in one tap. $WIF holders vote on the mix.** | Holders outside the US: one buy, one token, a mix kept up to date for them | Stock Tokens, defi | High (weakest: built well, at this size) | High | Med-high | Medium | A contract can hold and swap Stock Tokens on mainnet | 1, 3, 5, 6 (published + verified sponsor posts) | Large |
| 2 | **A savings circle with friends that pays out in US stocks.** (an ajo / esusu / chit fund) | Groups who already save together: the pot grows in stocks, and anyone who skips a payment loses a $WIF bond to the others | Stock Tokens, consumer, social | High (weakest: built well) | High | Medium-high | Medium (practice is real; demand for the stock twist is untested) | Same Stock-Token custody gate, plus: will members put up a $WIF bond? | 1, 2, 6, plus "where you're born" message | Medium-large |
| 3 | **Fantasy football, but with stocks.** (new format for Idea 2) | Retail traders: pick 5 stocks, play friends weekly, winner takes the pot | Stock Tokens, games | Medium-high (weakest: reads as betting) | Medium | Low-medium | Medium | Chainlink stock feeds usable for weekly scoring | 1, 3, 6 | Medium |
| 4 | **Send someone a share of Apple with a link.** (v1 Idea 4, reworded) | Senders abroad: give family real US stock; they claim it with no wallet and no gas | Stock Tokens, onboarding | Medium (weakest: $WIF is only a fee) | Medium | Medium | Medium | Passkey claim + sponsored gas works for a Stock Token | 2, 6, 8 | Medium |
| 5 | **Sell automatically if a stock drops, even on weekends.** (v1 Idea 3, reworded) | Stock Token holders: protection while markets are closed | Stock Tokens, tools | Medium (weakest: $WIF loop) | Med-high | High | Low-med | Weekend DEX price is reliable and fills | 5, 6, 7 | Med-large |

All rankings are conditional on gates not yet run. Ideas 1 and 2 share the first gate, so one spike tests both.

## 2. Recommendation

**Still Idea 1.** It is the only one that sits on Robinhood's own listed "AI basket" use case *and* reuses World is Fair's pay-to-vote-and-burn, so the $WIF use is the product itself.

**Idea 2 is the new strong contender.** It has the clearest "world is flat" story of anything on the list, and it has a better reason to hold $WIF than a fee: a bond that protects your friends. It tells the same story as the organiser's "Where you're born shouldn't decide what you get to build". It loses to 1 only because its benefit (people actually join circles) can't be shown with real users in 4 days. The demo has to use 3–4 wallets, labelled.

**Pick instead:**
- **3** for the safest build with the most instantly understood pitch. It replaces v1's "weekly calls" wording: same engine, better sentence.
- **4** if onboarding is what you want to show.
- **5** only if you want a technical showpiece.

## 3. New card: Idea 2, savings circle paid in US stocks

**Plain sentence.** A savings circle with friends that pays out in US stocks.

**Pitch.** Groups who already run an ajo (rotating savings) pay in a little USDG each week. Each week's pot goes to one member as Stock Tokens of their choice. Every member locks a $WIF bond: miss a payment and your bond is split among the others, with part burned.

**End-user problem.**
- Rotating savings is a mainstream habit across West Africa and South Asia (ajo/esusu, chit funds). That is well known, but no source was pulled in this pass.
- Its known pain is one member vanishing after collecting.
- US-stock access from Nigeria needs local brokerage relationships ([@akshaybd](https://x.com/akshaybd/status/2092082328265015615), X-only).
- Corroboration: weak-to-moderate. **The demand for a *stock* payout is untested.**

**Organiser need.** 1 (the $WIF bond is a real reason to hold it), 2 (onboarding people with no crypto), 6 (Stock Tokens apps). It also echoes @WIFonRH's "where you're born" posts.

**Users and channel.** Your own circles in Lagos (a first-hand channel), $WIF Discord, /build/updates.

**Differentiation.**
- vs an offline ajo: no collector can run off, and the bond enforces payment.
- vs crypto ROSCA attempts: payout in real US stocks, which nobody has done.
- vs other entries: no one is on Stock Tokens or savings.
- I didn't search for prior on-chain ROSCAs; the spike should do one search.

**Sponsor tech.**
- Necessity high: Stock Tokens are the payout, plus USDG and AA for no-gas joins.
- Alignment high: Stock Tokens, consumer.
- Pull high: every member must hold $WIF for as long as the circle runs.

**Proof, 60 s.**
1. 4 wallets join, each locking a $WIF bond.
2. Round 1: everyone pays and the pot is paid out as AAPL to member A.
3. Round 2: member D skips. Their bond is split among the others and part burned (tx shown).
4. Final balances.

| Claim | Evidence |
|---|---|
| Payout is a real Stock Token | Swap and transfer txs |
| Skipper is punished, others made whole | Bond split and burn txs |
| No gas for members | Sponsored userOp hashes |

- **Labels.** Live on mainnet with tiny amounts. Round length is shortened to minutes (labelled). Members are your own test wallets (labelled; not traction).
- **Judge-triggered failure.** A judge joins as a 5th member and skips a payment, then sees their bond slashed.

**Gate.** Contracts can hold and swap Stock Tokens (shared with Idea 1), plus: does a swap of about $5 to AAPL fill near the oracle price? Fallback: pay out in USDG with "auto-buy" sent straight to the winner's wallet. This keeps the core value.

**Core build.** Circle contract (join with bond, pay, payout-with-swap, slash), web app with passkey join. *Cut first:* passkeys (normal wallet), then choice of stock (fixed AAPL).

**Rubric fit.**
- Real reason for $WIF: high (confidence medium).
- Flywheel: high (medium). A circle lasts N weeks, the bond stays locked, and a new circle needs more $WIF.
- Works and built well: medium (low until the gate passes).

**Main weakness.** The payout-in-stocks demand is unproven. Bond slashing can feel harsh, and it needs clear UX. US persons must be blocked.

## 4. Change to Idea 2 → now Idea 3: "Fantasy football, but with stocks"
- **Same engine as v1** (Chainlink-settled, $WIF entry, part burned). Only the format changes: draft 5 stocks, then play a weekly league against friends or the public. The winner takes the pot.
- **Why it's better than "stock calls".** Everyone knows fantasy football, so there's no explaining. It also stretches across a week of play, which suits the flywheel.
- **Gate (unchanged).** Feed `updatedAt` cadence and staleness are fine. Score from Friday close.
- **Weakness (unchanged).** Betting flavour, and games is the crowded category.

## 5. Ideas generated this round and rejected
- **"Challenge a friend: whose stock does better this week?"** Folded into Idea 3 as a mode.
- **"Guess tomorrow's Apple price, closest guess wins."** Same engine as Idea 3; a daily mode at most.
- **"Save up to own one whole Tesla share"** and **"save in US stocks automatically every week".** Clear sentences, but the only $WIF role would be a fee. Fails "real reason to use $wif".
- **"Copy another trader's portfolio"** (v1 Idea 5). Needs many users to show any benefit.
- **"Tip creators in Apple shares".** Overlaps the existing tipbot; $WIF role is weak.
- **v1 rejections stand.** Lending is already live on Morpho; the paymaster and tipbot are already entries.

## 6. Unchanged
The hackathon summary, submission needs and gaps are as in IDEAS-v1.md. One gap is added: prior on-chain savings-circle projects were not searched.

---
# v3 addendum: compared with Stocklana winners (28 Oct, ~22:20 WAT)
Source: [Stocklana winners page](https://hackathons.solana.com/hackathons/stocklana) (main criterion: "could this be a real app that people will actually use?").
**Relevance: partly applies.** Same asset class (tokenized stocks), but a different chain, different judges and a different question. World is Flat asks for "a real reason to use $wif" plus a flywheel. Only use the "real user, real problem" patterns.

## Why the main-track winners won (all 5)
| Winner | Plain sentence | Pattern |
|---|---|---|
| Roster (1st) | Leverage on stocks where you can't lose more than you paid | A known fear (blowing up), removed |
| Draw (2nd) | Spend your stocks without selling them | An everyday need (cash) met without giving up the stock |
| Neo (3rd) | US stocks for people outside the US, kept balanced for you | **Access + automation** for non-US users |
| CRESCO (3rd) | Young people invest, with limits their family sets | Trust and safety rules, enforced on-chain |
| Xorr (3rd) | An AI trades stocks for you, only within your rules | Delegation with guardrails you can revoke |

What they share:
- Each names **one ordinary person and one worry or need**.
- Four of the five are about **safety, limits or control** (losses capped, family limits, revocable agent, no forced sale).
- **None is market plumbing.** CallWindow (an auction) was.
- **Games won only sponsor bounties.** PreCall IPO, a free weekly up/down game, took 1st in PreStocks; AgarIPO took 3rd.

## How our ideas line up
| Our idea | Closest winner | Read |
|---|---|---|
| 1 Basket | **Neo (3rd)**: non-US access + auto-balancing | Closest to a main-track winner. Our edge: $WIF holders vote the mix, then burn. Build it better than Neo's balancing (one tap, redeem in kind). |
| 2 Savings circle | **CRESCO**: trust rules enforced on-chain, family/social | Same "people you trust, rules on-chain" pattern, plus a real money habit. Encouraging. |
| 3 Fantasy stocks | **PreCall IPO**: a weekly call game, but only a bounty win | Games won side prizes, not the main prize. Here there is only one prize, so this caps it. Make it **free to play**, as PreCall was, with $WIF only for boosts and prizes. |
| 4 Send a share by link | No twin | Consumer access, fits Neo's spirit. |
| 5 Weekend sell | Closest to CallWindow (plumbing that depends on liquidity) | Ranked down further. |

**Ranking update:** 1 holds (Neo pattern + $WIF voting); 2 rises in confidence; 3 drops a little; 5 drops to last.

## New ideas inspired by *why* they won (not copies)
| # | Plain sentence | Winner pattern | $WIF role | Read |
|---|---|---|---|---|
| 6 | **An AI that invests for you, only within the rules you set.** | Xorr (delegation + guardrails) + @RobinhoodCrypto amplifying agents (verified) | You pay the agent per trade in $WIF (part burned). Limits and revoke are on-chain via 7702 session keys. | Strong on judges and Robinhood. $WIF is a fee, so medium. Agents category has 1 entry (Agent Arena, a game). |
| 7 | **Give your child US stocks they can't sell until they're 18.** | CRESCO (family guardrails) | Weak: only a fee. Could add "relatives top up the gift with $WIF, which is burned as a birthday boost". Thin. | Lovely sentence, weak $WIF. Keep as a variant of 4 (send a share). |
| 8 | **Get paid in US stocks.** A freelancer's invoice is paid in USDG and arrives as the stocks they chose. | Neo (access) + a real income need | Weak: fee. | Fails "real reason to use $wif". Rejected. |
| 9 | **Spend your stocks without selling them** (borrow USDG on Morpho in one tap) | Draw (2nd) | None natural | Twin is fine by your rule, but there is no $WIF reason and Morpho already does the borrowing. Rejected. |

## The takeaway for this event
Stocklana rewarded "a real person, a real worry, handled safely". World is Flat adds "and $WIF must be the reason it works". The ideas that do both:
- **1** (Neo pattern; $WIF = the vote)
- **2** (CRESCO pattern; $WIF = the trust bond)
- **6** (Xorr pattern; $WIF = paying the agent)

---
# v4 addendum: ideas where $WIF can't be removed (28 Oct, ~22:45 WAT)
Test: delete $WIF from the idea. If it still works, $WIF was a fee.
Strong $WIF roles: **a vote** (Idea 1), **a bond someone can lose** (Idea 2), **a stake that backs a claim**.

## New
| # | Plain sentence | Real person + worry | Why $WIF can't be removed | Flywheel | Organiser fit | Gate |
|---|---|---|---|---|---|---|
| **10** | **Stock tips where the tipster loses money if they're wrong.** | Retail followers burned by fake "signal" gurus (common in Nigeria) | Every tip (e.g. "NVDA up by Friday") locks $WIF. Wrong: part is burned and part goes to followers who backed the call. Right: the stake comes back and the tipster's on-chain record grows. Without $WIF there is no skin in the game. | Tipsters must keep buying $WIF to post. Followers back tipsters with $WIF, then repeat weekly. | Very high: the organiser's first event ranked CT KOLs (GOAT of CT). This turns "who's the GOAT" into a verifiable record. | Chainlink stock feeds are readable and fresh enough to settle weekly (same gate as fantasy) |
| 11 | **Save in US stocks every week, or lose your deposit.** | Savers who can't stick to it | You lock $WIF as a promise. Each week you skip buying your stock, a slice is burned, or goes to people who kept their streak. Without $WIF there is no promise. | Streak keepers earn from quitters, so people re-commit next month. | High: burn, onboarding, Stock Tokens | Contract holds and swaps Stock Tokens (same gate as 1 and 2) |
| 6′ | Folded into 10. An **AI agent can be a tipster too**: "An AI stock-picker that loses $WIF when it's wrong." | | | | It also covers Robinhood's push on agents. | |

## Updated shortlist (all with $WIF as the core, not a fee)
| Rank | Plain sentence | $WIF is… | Winner pattern | Gate |
|---|---|---|---|---|
| **1 ★** | Buy the top AI stocks in one tap. $WIF holders vote on the mix. | the vote | Neo (Stocklana 3rd) | Stock Token custody + swap |
| **2** | Stock tips where the tipster loses money if they're wrong. | the stake | Xorr/CRESCO "trust, enforced" + WIF's own KOL voting | Chainlink feeds |
| 3 | A savings circle with friends that pays out in US stocks. | the bond | CRESCO | custody + swap |
| 4 | Save in US stocks every week, or lose your deposit. | the promise | Neo (habit) | custody + swap |
| 5 | Fantasy football, but with stocks. | entry + prize | PreCall IPO (bounty only) | feeds |

Dropped from the shortlist: send a share by link (fee), weekend sell (plumbing), get paid in stocks / spend without selling (no $WIF role).

**Why the tipster idea ranks 2nd.**
- **For:** It has the plainest sentence on the list. It answers a worry everyone knows (fake gurus), and it fits the organiser's own history (GOAT of CT). It's also the smallest build of the top three: no Stock Token custody, only price feeds.
- **Against:** Followers backing a call is close to betting, and the judges are CT people who might be the tipsters it exposes. Ranked under 1 because 1 sits on Robinhood's own listed use case.

**Two spikes cover everything.** (a) custody + swap covers 1, 3 and 4; (b) Chainlink feeds cover 2 and 5.

# Build plan v2: gasless US stocks for $WIF holders
Written Fri 30 Oct 2026, 00:10 Lagos (/hackathon-build-and-submit, Mode 1). **This replaces PLAN.md**, which is kept as the fallback (the staked tipster).
Builder: solo with AI coding agents (Codex). Read RULES.md and ECOSYSTEM.md in research/.
**Working name only.** The product name, logo and subdomain are the user's call; ask first.

## 1. Core loop (plain sentence)
**"Buy US stocks with no gas and no seed phrase. Just hold $WIF."**

1. Sign up with a passkey (Face ID / fingerprint). This creates a smart account; no seed phrase, no ETH.
2. Lock $WIF in the app → **every stock buy is gasless** (the app sponsors gas).
3. No $WIF locked → **pay gas in $WIF** instead, and part of that $WIF is burned.
4. Buy a Stock Token (e.g. $10 of NVDA) in the web app, or from Telegram if time allows.
5. **Auto-buy:** "$5 of Apple every Friday", an on-chain permission with a spend limit, revocable anytime.

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

## 3. The three checks (run FIRST, Fri 30 Oct, during US market hours 14:30–21:00 Lagos)
Only behaviour observed on mainnet passes. Use tiny amounts. **Ask the user before every mainnet transaction.**

**Check 1: Sponsored gas works, and what it costs**
- *Pass:* a passkey smart account on Robinhood Chain mainnet (4663) sends a transaction whose gas is paid by an Alchemy Gas Manager policy (or ZeroDev). The user's account holds zero ETH. Record the gas cost per transaction in USD for a token approve + a swap.
- *Also:* gas paid in $WIF works. This uses an ERC-20 paymaster if Alchemy or ZeroDev supports $WIF; otherwise the app takes $WIF from the user in the same batch and sponsors the gas itself.

**Check 2: A small Stock Token buy fills fairly, into a smart account**
- *Pass:* buy about $5 of one Stock Token (e.g. NVDA) with USDG through an aggregator (0x / LiFi / 1inch RFQ, with Uniswap as fallback). The fill is within 2% of that token's Chainlink price. The tokens arrive in the **smart account**, so any transfer restrictions don't block smart accounts.
- *Also:* check that a sell back to USDG works.

**Check 3: Auto-buy with a spend limit**
- *Pass:* the user grants a limited permission (session key or EIP-7702 delegation): only the approved router, only the chosen stock, at most $X per week.
  - A server-side keeper executes one buy within the limit.
  - A second buy over the limit **fails**.
  - After the user revokes, any buy **fails**.

If a check fails:
- Check 1 fails → the user needs a little ETH. This weakens the pitch; consider going back to PLAN.md.
- Check 2 fails → restrict to the most liquid Stock Tokens.
- Check 3 fails → drop auto-buy to the second tier and use "repeat my last buy" one-tap instead.

## 4. Scope tiers
**Must ship**
- Passkey sign-up → smart account.
- $WIF lock contract (lock / unlock, with a minimum to qualify for free gas).
- Gasless buy for lockers.
- Gas paid in $WIF (with burn) for non-lockers.
- Buy and sell 3–5 Stock Tokens via the aggregator.
- Portfolio view (Chainlink prices).
- Auto-buy with a spend limit.
- Country block plus notices.
- A public stats page: users, buys, $WIF locked, $WIF burned, every transaction linked to Blockscout.

**Second tier** (after the core demo is recorded)
- Telegram bot ("buy $10 of NVDA") linked to the same smart account.
- "Buy a mix" (one tap into 3 stocks).
- Shareable "I own Apple from Lagos" card.

**Never (this hackathon)**
- Turning the fee on.
- Lending or borrowing.
- Leverage.
- Tipster/predictions (that's the fallback plan).
- Fiat on-ramp.

## 5. Milestones (Lagos time)
| # | Milestone | Acceptance check | Target |
|---|---|---|---|
| M1 | Repo + agent files; the three checks | Each check's output shown (tx hashes, gas in USD, fill vs Chainlink price, over-limit revert) | **Fri 30 Oct 21:00** |
| M2 | Lock contract + gasless buy + gas-in-$WIF path on mainnet | A fresh passkey account with 0 ETH buys a stock; a non-locker's buy burns $WIF (tx shown) | Sat 31 Oct 12:00 |
| M3 | Web app core loop (desktop + mobile browser) | A new user signs up, locks, buys, sees the portfolio. Wrong network, cancel and back are handled. | **Sat 31 Oct 20:00 (midpoint)** |
| M4 | Auto-buy live + stats page | A Friday-style scheduled buy runs (use a short interval, labelled); the stats page updates | Sun 1 Nov 12:00 |
| — | **Packaging reserve starts; building stops except for fixes** | | **Sun 1 Nov 14:00** |
| M5 | Judge audit, video, page, README | Recorded and drafted | Sun 1 Nov 23:00 |
| M6 | /hackathon-submission-audit | AUDIT.md, fixes done | Mon 2 Nov 12:00 |
| M7 | **Submitted**, repo tagged `submission` | Platform shows it submitted | **Mon 2 Nov 15:00** (lock is 18:30) |

**Market hours:** live stock buys can fill outside US hours through DEX pools, but RFQ quotes and Chainlink prices are best during market hours. The demo's main buys must be recorded **today (Fri) 14:30–21:00 or Mon 2 Nov 15:30–18:30**.

## 6. The replayable case
"Ada" (placeholder name; confirm with the user), in Lagos, has never used crypto.
1. She signs up with her fingerprint (no seed phrase).
2. She locks a little $WIF.
3. She buys $10 of Apple. **Gas: $0**, shown on screen and on Blockscout.
4. She sets "$5 of Apple every Friday" with a $5/week limit. A test over the limit is refused.
5. Her friend, who didn't lock, buys too, pays gas in $WIF, and the burn appears on the stats page.

**Benefit:** owning US stocks from Lagos in under a minute, with no brokerage, no ETH and no seed phrase.

## 7. How a judge can check it
- **Live:** the judge signs up with a passkey and buys a tiny amount themselves. Sponsored gas is capped per account per day, with a kill switch.
- **Public stats page:** every buy, lock and burn is linked to Blockscout.

## 8. Claim-to-evidence map
| Claim | Evidence |
|---|---|
| No gas for lockers | User op with the paymaster, account ETH balance 0 |
| Non-lockers' gas burns $WIF | Burn transaction links; running total |
| Fair fills | Fill price vs Chainlink price shown per trade |
| Auto-buy can't overspend | Over-limit and after-revoke reverts |
| **Benefit:** a non-crypto user owns a US stock in under a minute | Timed screen recording of a fresh sign-up |

## 9. Evidence labels
- Buys, locks, burns: **live** on mainnet.
- Auto-buy interval shortened for the demo: **live**, labelled.
- Users: real outsiders only; anything the user funds is labelled "assisted".

## 10. Decisions needed from the user
1. Product name and logo.
2. Licence (suggested: Apache-2.0).
3. Subdomain on the user's domain.
4. Gas budget (set after check 1).
5. A funded wallet: a little ETH, USDG, and $WIF. Keys only in env vars.
6. Sign in on /build and copy the submission form fields into research/RULES.md.

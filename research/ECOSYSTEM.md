# Ecosystem scan: World is Flat ($WIF) on Robinhood Chain
Scan date: 28 Oct 2026. Budget: about 20 reads, about 17 used. X covered through Grok, key links confirmed.
Two layers: the **organiser** ($WIF / World is Flat team, who set the prize and judge) and the **chain** (Robinhood Chain, which decides what's possible and what's new).

## 1. Top organiser and sponsor needs (strongest first)

| # | Need | Source | Signal | Who has it |
|---|---|---|---|---|
| 1 | A **real, recurring reason to use $WIF** on-chain, a "flywheel" that keeps bringing people back | /build/rules ("what to build", rule 7, judging line) | Published ask, repeated 3× on the rules page | Organiser |
| 2 | **Bring people with no crypto to $WIF** | /build/rules, "onboarding" category | Published ask (a named category) | Organiser, plus end users |
| 3 | **More $WIF burned and more voting demand**: votes cost 1 $WIF and are burned, in both the hackathon and World is Fair | /build/rules (judging), worldisflat.fun/fair/docs.html ("what happens to the $WIF") | Repeated across 2 products | Organiser |
| 4 | Voting needs $WIF in a wallet, and sybil wallets get collapsed by hand: they review funding sources at close and publish "collapse groups" | fair/docs.html ("wallets funded from the same source") | Single source, but it's their core product and done manually | Organiser (World is Fair) |
| 5 | **Products on Stock Tokens**, with lending as the named use case ("Build lending markets that use stock tokens as collateral") | docs.robinhood.com/chain/stock-tokens, /building-with-stock-tokens | Published ask by the chain; hackathon category exists with **0 entries** | Chain (Robinhood) |

Supporting chain-side signal: SODAX's Robinhood Chain FAQ says Stock Tokens are swap-only there and none is in its money market (docs.sodax.com/robinhood-chain/faq). That is a single source showing the lending gap is still open.

### Added from X (28 Oct, through Grok; key links confirmed 28 Oct; see X-RESEARCH.md)

| # | Need | Source | Signal | Who has it |
|---|---|---|---|---|
| 6 | **More apps using Stock Tokens.** "More to do (and build) with Stock Tokens"; 8 new Stock Tokens live 28 Oct; Vlad: chain is for RWAs "and the apps people actually want to use with them" | @RobinhoodCrypto 2114756024980693058, 2115462521255506252; @vladtenev 2109700037861310828 | Sponsor-team ask, repeated (X-only) | Chain |
| 7 | **24/7 exit liquidity and fair pricing for tokenized stocks.** Base users get near-zero bids; a **WIF judge (@cryptogle)** replied "use Robinhood chain instead" | @_Auza_ 2114335297249120566 + 2 more authors, Base ack; @cryptogle 2114376018945265738 | 3+ authors, rival acknowledged (X-only) | End users; judge stance |
| 8 | **First stock buy that feels like a brokerage** (passkey plus sponsored gas) | @openfort_hq ×2; @Rex_Ogjy (gas UX on RH chain) | 2 authors, one a vendor (X-only) | End users |

These strengthen needs 2 and 5 above and point to Stock Tokens + onboarding as the open lane. Note: Robinhood × Arbitrum mentorship round two is open (@RobinhoodCrypto 2113307697059877079), a possible follow-on for whatever you build.

## 2. Primitives

| Primitive | New? | Promoted by organiser? | Used by known entries |
|---|---|---|---|
| $WIF ERC-20 (`0x5173…4773`, launched on Pons v2) | Yes (2026) | Required | All |
| World is Fair voting (send 1 $WIF to an option address, burned; block-hash draw) | Yes (event doc dated 30 Aug) | Yes, it's their flagship | Paymaster entry mentions votes |
| Stock Tokens (ERC-20, ERC-8056 `uiMultiplier`, per-asset Chainlink feeds, assets API with `tradingCapabilities`) | Yes (mainnet 1 Jul 2026) | Category only | **None seen** |
| USDG stablecoin (prize currency) | Yes | Prize | Unknown |
| Account abstraction: ERC-4337 EntryPoints v0.6/0.7/0.8, EIP-7702, Alchemy Gas Manager, ZeroDev, Privy, Dynamic | Yes | No | WIF Paymaster (GitHub, ERC-4337) |
| Uniswap v4 hooks / AMM | Yes on this chain | "hooks and defi" category | Sherwood |
| Liquidity: RFQ (0x, 1inch Fusion, LiFi), Rialto propAMM, Lighter orderbook and perps, Arcus DEX | Yes | No | None seen |
| Chainlink price feeds and Data Streams | Yes | No | None seen |
| Cross-chain messaging, bridging (LI.FI, deBridge listed for $WIF) | Yes | No | None seen |
| FCFS ordering (no priority gas), sequencer sanctions screening, `prevrandao` constant (randomness needs VRF) | Chain properties | No | FlatWorld uses EIP-712 attestations |

Known entries: FLAT//RELAY (play-to-claim campaigns, 1% burn), ORBRUSH (game), Sherwood (v4 hook leaderboard game, buyback and burn), WIF Agent Arena (game/agents), WIF Gift (onboarding), Proof of Ship (builder bounties with signed attestations, burns 2%), plus on GitHub a paymaster, a Telegram tipbot and FlatWorld.
Category counts: games 4, social 3, hooks 2, onboarding 2, agents 1, payments 1, tools 1, **Stock Tokens 0**.

## 3. Organiser intent

- "build a product on Robinhood Chain that people keep coming back to… as long as it puts $wif to work inside it, and it needs a flywheel" (/build/rules)
- "judges look for a real reason to use $wif, a flywheel that holds up, and something that works and is built well." (/build/rules)
- "the world is flat team may feature, link or integrate it" (terms 7): the winner may be integrated afterwards.
- Amplified: the /build/updates feed features builders posting shipped work with tx links (Sherwood burns, Proof of Ship bounty payouts).

## 4. Gaps

- **No Stock Tokens product in the hackathon** (evidenced: 0 entries; the chain asks for lending, baskets and price-aware contracts).
- **No lending or collateral market for Stock Tokens** (evidenced: Robinhood docs ask for it; SODAX lists them as swap-only).
- **Gasless or no-crypto entry to $WIF voting and holding** (evidenced by needs 2 and 4; one paymaster entry exists, but no full "no wallet → first vote" flow seen).
- **Sybil-resistant voting** to replace the manual funding-source collapse (evidenced by need 4; any fix must keep the vote simple).
- **Price-aware or conditional contracts on equities**, e.g. limit or "trigger when NVDA crosses X" (inferred from the docs use-case table).
- **Production RPC**: the public RPC is rate-limited and not for production (SODAX docs). A builder tool, but low judge appeal (inferred).

## 5. Community and language

- English throughout: X @WIFonRH, Discord, /build/updates comments.
- Judges: crypto VC and advisory (ogle, niro, daniel zou), Ava Labs gaming/retail BD (glabuz), QuickNode devrel (sahil sen), plus the WIF team.
- Builders post progress publicly on /build/updates, and testers are recruited there.
- The $WIF ticker collides with Solana's dogwifhat, so search and branding need care.

## 6. Angles (one line each)

1. **Stock Tokens × $WIF**: a product in the empty category where $WIF is the access, fee or burn layer on equity exposure (needs 1 and 5).
2. **Lending/collateral on Stock Tokens**, with $WIF used for fees, boosts or burns (need 5 plus the SODAX gap). Bigger build, strong chain fit.
3. **Zero-crypto onboarding straight into a first $WIF vote**: embedded wallet, sponsored gas via 7702/4337, a vote on World is Fair (needs 2–4).
4. **Sybil-resistant voting layer** for World is Fair, replacing the manual collapse. Directly useful to the organiser (need 4).
5. **Price-triggered equity actions** (conditional orders or prediction rounds on Stock Token prices) settled in $WIF (needs 1 and 5).

## 7. Fit checklist (score every candidate idea)

- [ ] Answers an evidenced need above (name the number)
- [ ] Uses a new primitive in the main flow (Stock Tokens, 7702/4337 sponsorship, v4 hooks, Chainlink feeds), not as a side feature
- [ ] Gives users an ongoing reason to acquire, spend or burn $WIF (the flywheel holds up under the question "why come back next week?")
- [ ] Serves a named non-developer audience, or unblocks other $WIF builders
- [ ] Connects to what the organiser runs (World is Fair votes and burns), so it's something they could "feature, link or integrate"
- [ ] Demo works live on mainnet with real txs and stays up until 6 Nov
- [ ] Stays clear of crowded categories (games, social), or is clearly different from the entries already in them
- [ ] Any Stock Tokens surface respects the restricted-jurisdictions list (US persons, CA, UK, CH restricted; prohibited list). **Nigeria is not on the list.**

## 8. Limits

- **X covered through Grok** (5 prompts, processed into X-RESEARCH.md and §1 above). The 8 key X links were confirmed by the user on 28 Oct; other X items stay unverified.
- Blockscout (holders and volume for $WIF) is behind a bot check, so on-chain usage metrics are unknown.
- Project pages for ORBRUSH, WIF Agent Arena and WIF Gift didn't load at the slugs tried; their one-liners are unread. Details for all projects stay hidden until submissions close.
- No GitHub issue tracker or RFP list found for $WIF or for Robinhood Chain builders. Discord wasn't read (needs a login).
- Whether Chainlink VRF is live on Robinhood Chain wasn't checked.
- Sources read 28 Oct 2026: worldisflat.fun (/, /build, /build/rules, /build/terms, /build/updates, /build/projects, /fair, /fair/docs.html); docs.robinhood.com/chain (stock-tokens, building-with-stock-tokens, account-abstraction, differences-from-ethereum); docs.robinhood.com/rhj/restricted-jurisdictions; docs.sodax.com/robinhood-chain; dwellir.com blog; GitHub READMEs of the paymaster, tipbot, Sherwood, FlatWorld and FLAT//RELAY.

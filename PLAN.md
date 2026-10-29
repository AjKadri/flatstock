# Build plan: staked stock-tipster → track-record fund
World is Flat hackathon. Written 29 Oct 2026, 14:40 WAT, by /hackathon-build-and-submit (Mode 1).
Builder: solo with AI coding agents (Codex). Read RULES.md, SPIKE.md (Codex's spike, kept in Codex's own folder), IDEAS.md and ECOSYSTEM.md first.
**Working name only:** "the tipster". The product name, handle and logo are the user's call; ask before using any name publicly.

## 0. Event facts that shape the build (from RULES.md, re-checked 29 Oct)
- **Submissions close Mon 2 Nov 17:30 UTC = 18:30 Lagos.** Edits lock then, except the logo. The app must stay live and working until **Fri 6 Nov 18:30 Lagos** (judges try it).
- **Judging:** organisers screen; then judges plus a community vote (burned $WIF) pick 10 finalists, then a winner.
- **Criteria, no weights, in published order:** "a real reason to use $wif", "a flywheel that holds up", "something that works and is built well".
- **Mandatory:**
  - $WIF used on-chain on Robinhood Chain mainnet (4663), $WIF `0x5173b8eA6923c2d40267890D45C46a3480954773`;
  - a visible repo, or a private one with GitHub user `wifonrh` invited;
  - a demo video;
  - real transactions.
- **Branding:** no Robinhood name or logo in the product name, logo or handles.
- **Open questions** (submission form unread; no AI-tools rule; video length unknown). Sign in on /build on day 1 and read the form.
- **Kind of event:** a protocol ecosystem campaign. Judges want a live mainnet product strangers can use, an economic reason to hold $WIF, and the newest primitives (Stock Tokens + Chainlink stock feeds) in the main flow.

### US market hours drive the schedule
Stock feeds only update during market hours, and calls can only settle then.
| Day | Market open (Lagos time) |
|---|---|
| Thu 29 Oct | 14:30–21:00 (US still on daylight time) |
| Fri 30 Oct | 14:30–21:00 |
| Sat 31 Oct, Sun 1 Nov | **closed** (US daylight time ends Sun 1 Nov) |
| Mon 2 Nov | 15:30–22:00, but the deadline is 18:30, so **3 hours** |

**Before the weekend there are only two market sessions (today and Friday). Real mainnet settlements must happen in them.**

## 1. Core loop
**A tipster locks $WIF behind a stock call; the call settles itself from the official price; a wrong call burns $WIF; every result goes on a public record nobody can edit.**

## 2. The replayable case (everything is built around this)
"Ada" (placeholder persona; confirm the name with the user) is a tipster who keeps saying NVDA is going up.
1. Ada calls "NVDA Stock Token higher at 20:00 Lagos than now" and locks 500 $WIF. The call and lock show on Blockscout.
2. She tries to cancel, edit, or withdraw the stake. **Refused.**
3. The deadline passes and the keeper settles from the first Chainlink round at or after the deadline.
4. NVDA went down, so part of her $WIF is **burned** (burn tx shown) and the loss goes on her public record.
5. A second call by an AI tipster settles right and its stake returns. Both records sit side by side.

**Benefit shown:** anyone can now see Ada's real record, losses included. Before, she could just delete the bad tweet.

## 3. How a judge can check it
- **Must ship: public run records.** A public "every call" page. Each call links its creation, settlement and burn transactions on Blockscout, plus the exact Chainlink round used, so anyone can recompute the result. AI tipsters keep making real calls throughout judging (6 Nov), so the record keeps growing without us.
- **Second tier: judge trigger.** A "make a demo call" button. A server wallet stakes a tiny fixed amount of $WIF on a fixed call.
  - Fixed operation only, no user input.
  - Rate-limited, with a daily cap and kill switch; the key stays server-side.
  - It writes to the chain, not the judged repo, so the frozen submission is unaffected.
  - Ask organisers in Discord if judge-triggered calls are OK.
- **Also:** judges with a wallet can make their own call. A short "how to get a little $WIF" note covers that.

## 4. Scope tiers
**Must ship (the tipster)**
1. Fix from the spike: settle on the **first round at or after the deadline**. The settler passes `roundId`; the contract checks `round.updatedAt >= deadline` and `prev.updatedAt < deadline`. Add a test that a later, more favourable round is rejected. Keep the expiry-refund path (W = 24h) so nothing gets stuck.
2. TipsterCalls contract on mainnet (verified on Blockscout/Sourcify):
   - create the call (asset, direction, deadline in market hours, stake);
   - settle exactly once;
   - burn share on a loss; refund on unresolved.
3. Keeper bot (on the VPS) that settles every call right after its deadline.
4. AI tipster bots: 2–3 agents making small real calls each market session, from now until 6 Nov. **This is the ambitious part; it stays in must-ship.**
5. Web app: connect wallet, make a call, profile/record page (calls, stake sizes, wins/losses, count; no "trust score"), all-calls page with tx links.
6. "Not for US persons / not investment advice" notice.

**Second tier (only after the core loop demo is recorded)**
1. **Weekly payout to tipsters who were right**, from part of what losing tipsters lose (fix #1 from research). Followers never bet.
2. **"Back a call": burn 1 $WIF**, no payout, mirroring World is Fair votes.
3. The judge trigger (section 3).
4. Shareable record card image.
5. **Track-record fund**: decide at the checkpoint (section 6).

**Never (this hackathon)**
- Followers betting on calls.
- Copy-trading.
- Paid subscriptions.
- Telegram bot.
- Multi-chain.
- Custom oracle.

## 5. Milestones and acceptance checks
A milestone is done only when its check has been run and its output seen. A coding agent saying "done" doesn't count.

| # | Milestone | Acceptance check | Target (Lagos) |
|---|---|---|---|
| M1 | Repo + agent files; first-round settlement fix | `forge test` passes, including "later favourable round rejected" and every spike failure-path test | Thu 29 Oct 18:00 |
| M2 | **Mainnet trial (needs the user's OK + a funded wallet)** | Deploy; one tiny call settles correctly from a real round in **today's session**; burn and refund txs on Blockscout. If missed, Fri session. | **Thu 29 Oct by 21:00** (latest Fri 30 Oct 21:00) |
| M3 | Keeper + AI tipster bots live on the VPS | Bots have created and the keeper has settled ≥10 real calls in Friday's session, with no manual step | Fri 30 Oct 21:00 |
| M4 | Web app core loop | A fresh wallet (desktop + mobile in-app browser) connects, makes a call, sees it on its record. Wrong network, disconnect and a cancelled signature are handled. | Sat 31 Oct 14:00 |
| — | **Midpoint: core loop live end to end on mainnet** | M1–M4 checks all pass | **Sat 31 Oct 14:00** |
| — | **Fund checkpoint** | See section 6 | Sat 31 Oct 16:00 |
| M5 | Second-tier items (in order) | Each item's own check | Sat 31 Oct – Sun 1 Nov 14:00 |
| M6 | Deployed + frozen candidate | Hosted on a subdomain of the user's domain (ask which), signed-out private window works | Sun 1 Nov 14:00 |
| — | **Packaging reserve starts. Building stops except for audit fixes.** | | **Sun 1 Nov 14:00** |
| M7 | Judge audit (Mode 3), video, page, README | Video recorded, page drafted | Sun 1 Nov 23:00 |
| M8 | /hackathon-submission-audit | AUDIT.md, fixes done | Mon 2 Nov 12:00 |
| M9 | **Submitted** | Platform shows it submitted. Tag `submission` in the repo; the deployed app runs that tag. | **Mon 2 Nov 15:00** (3.5 h before the lock) |

## 6. Fund checkpoint (Sat 31 Oct 16:00)
Add the track-record fund only if **all** of these hold:
- M1–M4 pass;
- the Stock Token custody test passes (a contract can hold, transfer and swap a Stock Token on mainnet with a fill within 2% of the feed; run it quietly on Friday with the user's OK);
- the ranking-gaming check is designed: minimum calls before ranking, ranking weighted by $WIF risked, every account's full record public.

Otherwise spend the time on second-tier items 1–4 and polish. The fund would also only show live trades on Mon 2 Nov morning US time, since the weekend is closed. Weigh that.

## 7. Time budget
Window: Thu 29 Oct 14:40 → Mon 2 Nov 18:30, about 100 h. The reserve from Sun 1 Nov 14:00 is about 28 h (28%). It's larger than 15% because Monday's only market session is before the lock, and video and packaging are solo work.

## 8. Project files for coding agents
- `AGENTS.md` (next to this file; copy it into the repo root).
- `plan.md` in the repo = sections 4–6 of this file, kept current.
- `README.md`: what it does + how to run it. Rewritten at packaging.
- `.gitignore`: `.env`, `*.key`, keystores, `broadcast/` secrets, `node_modules`. First commit must contain it.
- **Licence: to be decided by the user before the repo goes public.** Suggested: Apache-2.0. It's permissive, so the organisers can "feature, link or integrate" it (terms 7), and it adds a patent grant.

## 9. Deliverables map
| Deliverable | Source | Owner |
|---|---|---|
| Repo (public, or private + invite `wifonrh`) | GitHub | Codex, user approves visibility |
| Demo video (length rule unknown; check form) | Screen recording, whole screen so wallet confirmations show | User records, Claude scripts |
| Real txs: contract addresses + explorer links in the description | Blockscout | Codex |
| Live link, up until 6 Nov | VPS subdomain | Codex sets up; user owns uptime |
| Name, one-liner, categories (Stock Tokens, tools and infra, social and creators, agents and ai), logo | User decides | User |
| Form fields not yet seen | Sign in on /build day 1 | User |
| Optional: progress posts on /build/updates | Claude drafts, user posts | User |

## 10. Claim-to-evidence map
| Claim | Evidence |
|---|---|
| A call can't be edited, cancelled or withdrawn | Revert txs / tests; contract source verified |
| It settles from the official price, and anyone can recompute it | Chainlink round ID + `getRoundData` output shown per call |
| A wrong call burns $WIF | Burn tx links; running burn total |
| No stake ever gets stuck | Expiry-refund tests + one real unresolved refund tx if it happens naturally |
| **Benefit:** a tipster's full record, losses included, is public and can't be deleted | Record page vs. a deleted-tweet comparison in the video |

## 11. Evidence labels (keep current)
| Part | Label |
|---|---|
| Calls, settlements, burns | **Live** (mainnet) |
| AI tipsters | **Live**, labelled as our bots, not users |
| Demo deadlines shortened to minutes/hours | **Live**, with a short deadline (labelled) |
| Followers / traction | None claimed unless real outsiders join; seeded calls are not traction |
| Sequencer health | **Unavailable** (no Robinhood Chain sequencer feed); staleness check used instead |

## 12. Outside users
- **Day 1:** post on /build/updates ("looking for tipsters to test") and in the $WIF Discord.
- Invite the X authors who raised the stock-token problem only if the user wants to.
- Count outside wallets that made a call, labelled honestly. Any we fund (gas or $WIF) are labelled "assisted".

## 13. Sponsor prizes
None besides the main prize.

## 14. Audit date
/hackathon-submission-audit on **Mon 2 Nov, 09:00–12:00 Lagos**. Submit by 15:00.

## Needs from the user now
1. **A funded wallet on Robinhood Chain:** a little ETH for gas plus some $WIF (bots stake small amounts). It's needed for M2 today. Key in env vars only, never in files.
2. **OK for the first mainnet transactions** (M2).
3. **Decisions:** product name, licence, which subdomain to host on.
4. **Sign in on /build** and copy the submission form fields into RULES.md.

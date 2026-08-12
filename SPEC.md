# Challenge Account Tracker — Product Spec

## What this is

A personal trading scoreboard for a concentrated swing-trading "challenge account," built around a specific money-management strategy. It is NOT a generic portfolio tracker. The strategy rules below are the product; the UI exists to enforce and visualize them.

**Owner:** Mark. Single user, personal tool. Stack: React frontend, Cloudflare Pages hosting, **Supabase (Postgres)** for persistence — using the owner's EXISTING **Sackets** Supabase project (ref `mlvntnbgboinjhmavwao`), not a new project. The owner's Supabase layout: SpokenFor.money lives alone in its own separate project; everything else (Sackets Harbor race apps and other work) shares the Sackets project, and this app joins the Sackets project too. Existing tables there are most likely in the `public` schema. All of this app's tables live in a new schema named **`challenge`** — never create, modify, or drop anything outside the `challenge` schema in this project. Auth is the Sackets project's existing Supabase auth: the owner logs in with his existing account; no new auth system. RLS on every table, scoped to the owner's `auth.uid()`.

Supabase schema gotchas to handle during setup (these bite silently if skipped):
- Expose the `challenge` schema in the project's Data API settings (API → Exposed schemas), or every request 404s.
- Grant usage/select/insert/update/delete on the schema and its tables to the `authenticated` role (and usage on sequences).
- Create the JS client with `{ db: { schema: 'challenge' } }` (or use `.schema('challenge')` per query).
- Migrations: keep schema SQL in the repo (`/supabase/migrations`) so the schema is reproducible.

Reference implementation: `Challenge_Account_Tracker.xlsx` in this repo — the app's math must match the workbook's math.

## The strategy (business rules — these are law)

### Goal framing
- Aspiration: $1,000,000. It is a direction, NOT a pass/fail line.
- Success metric = **Total Score** = challenge account value + banked floors + tax reserved. Every banked dollar counts as won, permanently. The final number is the prize, never a shortfall against the aspiration. The only real failures are breaking the rules or losing to VOO.

### Milestone ratchet
- Below $100,000 account value: everything rides. No skims except tax reserve.
- Milestones: $100k, $200k, $400k, $800k, $1M (extendable by doubling).
- When account value crosses a milestone: bank **25% of account value at the moment of hit** into VOO in the parked pile. Banked money NEVER returns to the trading account. The app must surface "MILESTONE HIT — BANK NOW" prominently and nag until the banking event is recorded.

### Tax reserve
- Quarterly: reserve **30% of net realized gains YTD** (challenge account only), moved out of play. If YTD net realized is negative, reserve nothing.
- Realized gains exclude wash-sale-disallowed losses.
- This rule is non-negotiable in the UI — no setting to disable it.

### Funding rules
- **Timing:** the bankroll is never refilled in response to losses. A drawdown or round-trip is a result, not a reason to add money. Additions happen only on the pre-planned schedule.
- **Source:** stake additions come only from long-term trims of the parked pile (held > 1 year, planned in advance; ~21% combined tax vs ~28–30% short-term) or fresh income. Never from selling parked winners at short-term rates. NVDA, TSLA, and the MSTR conviction hold are never trim fuel.
- **Contribution cap:** net contributed caps at $25,000. Once reached, the account grows only by trading; raising the cap requires beating VOO after tax over a trailing 12 months. The cap is a config value (`contribution_cap` in `challenge.app_settings`), not a hardcoded constant. UI: at 80% of the cap the Dashboard and Cash Ledger show a subtle badge with remaining room; at 100% they show a persistent "Contribution cap reached — growth by trading only" state, and Deposit entries that would exceed the cap are refused.
- The parked pile is tracked for context and funding-calendar purposes but is walled off from all scoreboard math.

### Trading guardrails (the Xu rules — full Xu since 2026-08-05)
- No margin. No options. No crypto. No chasing stocks that have already run.
- **One stock at a time**: the bankroll rides a single name with a near-term catalyst — full position, sell then rotate. The app warns loudly (doesn't block, to allow same-day rotations) when opening a ticker while another has open lots.
- Every position requires an **exit target** entered at open — the catalyst move being sold into (Xu's 20–30%). The app refuses entry without it. **The bail point requirement was removed by owner decision 2026-08-05** (target-only exits, Xu style); the `bail_point` column remains nullable for history.
- Wash sale rule: selling at a loss then rebuying the same ticker within 31 days — in ANY account (Robinhood, Cash App, Stash) — disallows the loss. This applies in both directions — don't buy a name in the challenge account within 31 days of selling it at a loss anywhere else. The app should warn when a buy is entered for a ticker with a loss-sale in the past 31 days.

### Benchmark (the honest test)
- Every deposit into the challenge account creates a "shadow" VOO purchase: shares = deposit / VOO price that day.
- Scoreboard comparison: Total Score vs shadow VOO value at today's price.
- Beating the shadow over rolling 12 months = demonstrated edge → justifies adding capital. Losing to it = the experiment answered the question.
- Note in UI: the real hurdle is higher than the raw comparison because short-term gains are taxed ~28–30% while VOO held long-term is ~21% and only when sold.

## Data model

### CashEvent
- id, date, type: enum [Deposit, Withdrawal, Buy, Sell, Dividend, TaxSkim, MilestoneBank, Fee]
- amount (positive decimal; type determines direction: Deposit/Sell/Dividend add cash, all others remove)
- ticker (optional), sourceDestination (text), notes
- Derived: running cash balance; netContributed = deposits − withdrawals

### Position (open)
- id, ticker, buyDate, shares, avgCost — **each purchase is its own lot** (a row); a ticker may have multiple open lots, displayed grouped with a per-ticker subtotal.
- exitTarget (required), bailPoint (optional, legacy pre-Xu), thesis (text)
- buy_event_id (2026-08-16): exact link to the lot's Buy cash event — adding a lot creates both and links them; deleting a lot takes its exact ledger row; a buy-date edit moves both. Legacy lots (null) fall back to ticker+date+amount matching, only when unambiguous on both sides.
- Derived per lot: costBasis = shares × avgCost; marketValue = shares × currentPrice; unrealized $ and %; daysHeld; longTermDate = buyDate + 366
- **Partial close:** closing may take fewer shares than the lot holds — the closed portion becomes a Trade (proportional basis) and the lot's remaining shares stay open with original buyDate. Closing across multiple lots defaults to FIFO (oldest lot first), with per-lot override.
- **Known limitation — no undo for closes:** unlike pile sales, closing records no snapshot; a mis-entered close is repaired by deleting its trades and Sell event and re-adding the lot. Pile-style reversibility for the challenge account is a possible future feature.
- **Stock splits:** a manual "record split" action per ticker (ratio input) multiplies shares and divides avgCost across all open lots (and ParkedPositions of that ticker), logging the event in notes. No auto-detection needed.

### Trade (closed)
- id, ticker, openDate, closeDate, costBasis, proceeds
- washSale (bool), notes
- Derived: daysHeld; realizedGain; stLt = daysHeld > 365 ? LT : ST; taxYear = year(closeDate)
- Derived aggregate: netRealizedYTD = Σ realizedGain where taxYear = currentYear AND washSale = false
- **Tax-year rollover:** on January 1, realized YTD resets. A per-tax-year `lossCarryforward` record holds any net loss carried into the new year (net losses offset future gains first, then deduct up to $3,000/yr against ordinary income). The Tax Reserve calculation uses (current-year net realized − applicable carryforward), floored at 0.

### Snapshot (history — required for all time-series features)
- date (one per calendar day, written on first app load of the day)
- accountValue, bankedTotal, reservedTotal, totalScore, shadowVooValue, netContributed, parkedPileValue, semiAiPct
- Powers: the rolling-12-month VOO verdict, the Total Score progress chart, and the concentration trend. Without snapshots these features are uncomputable — this table is not optional.

### Milestone
- level ($100k/$200k/$400k/$800k/$1M, extendable)
- accountValueAtHit, dateHit, amountBanked, parkedDestination
- Derived: skimDue = 25% × accountValueAtHit; cumulativeFloor = Σ amountBanked
- Status: Banked | HIT-BANK-NOW (accountValue ≥ level and not banked) | NotYet

### TaxReserveCheck
- quarter, checkDate, netRealizedYTD (from Trades), reserveTarget = max(0, 30% × netRealizedYTD), alreadyReserved, moveOutNow = max(0, target − alreadyReserved), moved (bool)
- **Computed, not stored:** there is no table — every quarter's row derives fresh from trades + cash events + carryforwards. "Moved" = a TaxSkim event exists covering the target; deleting that event makes the quarter show as due again.

### BenchmarkDeposit
- date, amount, vooPriceThatDay, cash_event_id (2026-08-15: FK to the Deposit, on-delete cascade — created and deleted as one converging unit with its deposit; legacy null rows fall back to date+amount matching)
- Derived: shadowShares = amount / vooPriceThatDay
- Global input: vooPriceToday → shadowValue = Σ shadowShares × vooPriceToday
- Lead = TotalScore − shadowValue (also as %)

### ParkedPosition (context only — excluded from all score math)
- ticker, account (Cash App / Robinhood), category: enum [Semi/AI, AI-adjacent, BTC, Other]
- shares, avgCost, currentPrice, buyDate (oldest lot), notes, trimRank
- Derived: longTermDate = buyDate + 366; ltStatus = "FUNDING UNLOCKED" when today ≥ longTermDate, else countdown
- Concentration: Semi/AI % of pile; Semi/AI + AI-adjacent %; target cap (default 50%, editable); status "OVER CAP — trim semis first" when exceeded
- Seed data lives in the reference workbook's Parked Pile tab (MU, AMAT, AMKR, ASML, SOXX, NBIS, AMD, AVGO, GOOGL, GLW, MSTR, plus NVDA/TSLA arriving from a Stash ACATS transfer). MSTR is a conviction hold, category BTC, never trim fuel.
- Manual income estimate for projections: dividendRate (annual $ per share) + dividendFrequency (daily/semimonthly/monthly/quarterly/semiannual/annual — daily for SATA-style payers, semimonthly for STRC), plus dividendGrowthPct (assumed annual growth, drives the Transition modeler). All nullable; clearing the rate retires its companions.

### Account / OutsideSale / ParkedCashEvent (context tables)
- **accounts**: id, name, broker, kind (bank / outside / challenge), notes. Labels for where money lives — never score math.
- **outside_sales**: id, account_id, ticker, sale_date, loss (bool), notes. Radar-only records so Rule 9's cross-brokerage wash-sale window has teeth; never in score or YTD math. Pile sales feed the same radar (unknown-basis sales warn as possible losses).
- **parked_cash_events**: id, account_id, date, type (deposit / interest / withdrawal / fee / adjustment), amount, notes. Manual cash movements in non-challenge accounts; reconcile writes an `adjustment` row (zero-amount when the balance already matches — it stamps the reconciled-ago cue).

### Dividend income (context only — the wall holds)
Added 2026-08-11 as Phase 1 of the parked pile growing into a full tracking system (owner direction: dividends first; ROC basis machinery and a retirement-transition modeler come as later phases).

- Dividends are lots. A dividend is a `parked_lots` row with source `dividend`: cash = shares 0 + amount; DRIP = shares > 0 + reinvest price + amount (basis, own 366-day clock). No separate dividends table.
- **Classification** per dividend lot: enum [qualified, ordinary, return_of_capital, capital_gain_dist, unclassified]. `unclassified` is the default and the backfill value for pre-existing dividends — visibly flagged (amber), estimated at the qualified rate until confirmed. A payment that splits across classifications is multiple dividend lots on the same date. Optional `ex_date`; `reclassified_at` records post-1099 corrections (edit via the Income screen's reclassify action).
- **Return of capital reduces cost basis** (Phase 2, 2026-08-11): each ROC distribution allocates per share across the share lots held at its date, stored as `parked_lot_adjustments` rows keyed to both the share lot and the dividend event — the lot's original `amount` is never touched, so original basis stays recoverable and deleting/reclassifying the dividend reverses its reductions exactly (reversal deletes by dividend id, which transfers preserve). Allocation caps at each lot's remaining adjusted basis; a capped lot's excess is THAT lot's estimated capital gain (per-share treatment — never redistributed), recorded on the dividend as `roc_overflow` AT allocation time — never re-derived from the rows, which trims/transfers legitimately scale or cascade away — and taxed at the LT rate in the YTD estimate. Allocation is idempotent (prior rows for the event are cleared first), so retries and stale tabs can't double-reduce. `roc_allocated_at` distinguishes "not yet allocated" (backfill affordance on the Income screen) from "allocated, basis exhausted". Sales/trims are taxed against ADJUSTED basis; yield-on-cost and avg_cost stay on ORIGINAL basis. Transfers recreate each moved slice's adjustment rows at the destination with event linkage intact. Basis-exhausted lots are flagged; further ROC on them is capital gain.
- **lt_shares policy:** undated shares count as long-term in the recorded sale and every estimate (matches `estimatedPileTax`'s documented assumption).
- **Projections** (pure engine, `parkedIncome.ts`): per holding, next-12-months income prefers trailing actuals (≥2 dated payments in the last 12 months → cadence from median gap, amount from recent mean, schedule anchored to the last real pay date); falls back to the manual dividendRate × shares at dividendFrequency; excluded with neither. Null-dated dividend lots are excluded from all time windows (they still count in lifetime and ROC totals).
- **Tax estimates are informational only** and use `app_settings` rates: `qualified_dividend_tax_rate` (0.15), `ordinary_dividend_tax_rate` (0.24), plus `lt_tax_rate` (0.21) / `st_tax_rate` (0.29) which now drive the pile sale estimates. Editable via the Tax Reserve screen's "Estimate rates" modal. None of this touches the challenge account's 30% reserve rule.
- **The wall, restated:** parked dividends never touch Total Score, milestone progress, YTD realized, or the tax skim. Enforced structurally — `totalScore(lots, prices, events, milestones)` has no parameter that can carry parked data — and documented by a guard test in the engine suite.
- **Archived positions** (Phase 2): a position fully trimmed or transferred away survives at zero shares so its dividend history is never destroyed. Archived rows appear ONLY on the Income screen (gray "closed" pill, no projections — recent payments don't project for shares no longer held); the Parked Pile table, quote fetching, and the daily snapshot all skip them. Re-adding the same ticker+account revives the archived row and its history. A position with no lots at all still deletes. DRIP dividends survive full trims too: the reinvested shares sell (their basis goes into the sale) but the lot stays at zero shares as an income record — cash-vs-DRIP in account-cash math keys off `price` (null = cash). Known caveat: a PARTIAL trim that consumes part of a DRIP lot shrinks that lot's recorded income proportionally — one field carries both basis and income.
- Tracked-cash note: because lots now survive a position's closure, `computeAccountCash` retains historical purchase debits and cash-dividend credits that the old cascade used to erase — affected account balances shift once, and the next reconcile trues them up.
- **Retirement transition modeler** (Phase 3, 2026-08-14): `income_scenarios` (name, after-tax target income, retirement year, per-scenario qualified/ordinary/capital-gain rate overrides — null falls back to the settings rates) and `scenario_rotations` (sell a holding by shares or percent-of-today's-shares, or deploy new cash via `cash_amount`, into a buy symbol with assumed yield, dividend growth, and a 0–100 classification-mix). Pure what-if — nothing touches real holdings. Projection rules: rotation price = the holding's current price (no future price modeling); a rotation takes effect the month AFTER its date, both sides prorated by whole months in that year; sale haircut computed against ROC-adjusted basis via the real FIFO (sequential rotations see earlier consumption), undated shares taxed as LT, short-term sales WARN never block; buys' ROC portions untaxed in-horizon with cumulative-ROC-vs-basis displayed; target-reached is the first year of AFTER-TAX income ≥ target (retirement income is spendable income); horizon = max(retirement year + 5, now + 10). The wall holds — scenarios are pile context only.
- **Notional entry mode** (2026-08-14): every shares×price form has a total-dollars field two-way-bound with price — enter the broker's filled notional and the per-share price derives at full precision, so stored amounts reproduce the notional to the cent (rounded per-share prices drift on fractional shares). `position_lots.avg_cost` widened to 6dp for the same reason.
- **Reversible sales** (2026-08-13): every sale records a `consumed` snapshot on `parked_sales` — position metadata plus per-lot slices (three modes: shrunk / zeroed-DRIP / deleted) carrying pre-sale absolutes, removed deltas, and per-ROC-event adjustment detail. **Undo** restores exactly via a converging plan (absolutes when nothing intervened, deltas when something did, original-id upserts for anything that vanished — retries are idempotent, the sale row deletes last); ROC events whose allocation changed after the sale re-run through the idempotent allocator instead of restoring stale rows. **Edit** = undo + re-apply against fresh data (basis and LT/ST split re-derive). Undo/edit are LIFO per holding in the UI and NEVER touch the challenge ledger — a funded sale's Deposit and shadow-VOO twin are the owner's to reconcile, with a loud warning. Sales recorded before snapshots stay field-edit-only. The pile's verbs are now Buy (merges into a live position as a new lot, revives archived ones) and Sell (the Rule 5 trim flow under its plain name — every warning intact).

## Screens

1. **Dashboard (landing).** Total Score (hero number), broken into account value / banked floors / tax reserved. Next milestone + distance. Progress bar to $1M labeled "aspiration." Net contributed. Lead vs VOO. Net realized YTD. Any active alerts (milestone hit, tax skim due, wash-sale warning, over concentration cap). Parked pile total shown small and explicitly labeled "context only — not in score."
2. **Cash Ledger.** Event list with running balance, add-event form with type dropdown, summary block (deposits, withdrawals, net contributed, buys, sells, dividends, skims, fees, current cash). Adding a Deposit prompts for that day's VOO price to auto-create the BenchmarkDeposit twin.
3. **Positions.** Open positions table; add form enforces the exit target and warns when a second ticker would open (one stock at a time); shows days held and long-term date; close action moves it to Trade Log and creates the Sell cash event.
4. **Trade Log.** Closed trades, ST/LT badge, wash-sale flag, YTD realized total.
5. **Milestones.** The ratchet table with statuses and a "record banking" action.
6. **Tax Reserve.** Quarterly checklist, auto-computed from Trade Log, with "mark moved" action creating the TaxSkim cash event.
7. **Benchmark.** Shadow purchases list, VOO price today input, lead display, rolling-12-month verdict once a year of data exists.
8. **Parked Pile.** Foundation table with funding-unlock countdowns, concentration watch, trim ranks.
9. **Rules.** Static page with the full rules text (copy from the workbook's Rules tab). Show a link to it after any milestone banking event and after any closed trade with |gain| > 25%.
10. **Income** (added 2026-08-11). The pile's dividend engine: trailing-12M / projected-12M / est.-tax-YTD / yield-on-cost stat cards, a 24-month bar chart (12 actual + 12 projected), per-holding income table with rate-source badge and set-rate affordance, and the sortable distribution history with reclassify/delete actions. All figures parked-pile context — nothing here enters score math.
11. **Transition** (added 2026-08-14). The retirement modeler: scenario list with after-tax target and per-scenario tax rates, planned-rotations table with short-term/clamped warnings and net-proceeds/est.-tax previews, stacked after-tax income projection (green = today's holdings, indigo = rotation buys) with the target line and target-reached year, and a two-scenario overlay comparison. Pure pile context.
12. **Activity** (added 2026-08-12). Every pile event in one reverse-chronological stream — buys, sells (with gain/term/funded detail and undo/edit/delete), dividends (DRIP vs cash, classification), ACATS transfers, and account cash movements — with persisted account/ticker/type filters and the realized-total header. Pile only, never the score; the challenge account's history stays on the Cash Ledger and Trade Log.
13. **Watchlist** (added 2026-08-12). The bench: `challenge.watchlist` rows (ticker, catalyst text, catalyst_date, entry_note, planned_target, notes) sorted soonest-catalyst-first with a days-to-catalyst countdown, a "riding" pill on the open position's ticker, and the wash-sale radar flagging bench names inside the 31-day window before they become buys. Research notes only — nothing here trades, prefills, or touches score math. Companion: the Trade Log gains a `tradeStats` card (win rate, avg win/loss $ and %, payoff ratio, avg hold, best/worst — all closes count; wash is a tax flag, not a performance one).

## Calculations to port exactly

All formulas live in the reference workbook; port them 1:1. Key ones:
- accountTotal = Σ open position marketValue + currentCash
- currentCash = deposits − withdrawals − buys + sells + dividends − taxSkims − milestoneBanks − fees
- TotalScore = accountTotal + Σ amountBanked + Σ taxSkimsMoved
- nextMilestone = smallest level > accountTotal (100k floor)
- shadowValue = Σ (deposit/vooPriceAtDeposit) × vooPriceToday

## Price updates
- No brokerage integration, but quotes should self-update. Delayed prices are fine — this is a scoreboard, not a trading terminal.
- Architecture (as built): a Cloudflare Pages Function (`/api/quotes?tickers=...`) fetches server-side — **Yahoo Finance chart endpoint primary** (no key; live price + previous close for a true day change, covers ETFs), **Finnhub fallback** via `FINNHUB_API_KEY` (env var, never in the browser). Finnhub's free tier lags a session and skips ETFs, which is why it's the fallback.
- Edge-cached per ticker with a 15-minute TTL. App fetches on load; the header has a manual "refresh prices" button with a last-updated timestamp that turns amber when the last fetch failed.
- Manual price override per ticker must still exist as a fallback (API outages, delisted tickers, the VOO-price-on-a-past-date entries for the Benchmark).
- Tickers to cover: all open Positions, all ParkedPositions, and VOO.

## Import, export, and PWA
- **Seed import:** a one-time import script (or admin action) seeds the database from the reference workbook — Parked Pile positions, initial cash events, benchmark deposits — so the app starts populated rather than hand-typed.
- **Export:** one-click export of all `challenge` schema data (JSON and CSV per table). Same family value as SpokenFor's "export your data anytime," and it doubles as backup.
- **PWA:** manifest + icons + installability so the scoreboard lives on the owner's phone home screen. No offline-write support needed in v1; a cached read-only last-known dashboard is a nice-to-have.

## Non-goals (v1)
- No brokerage API integration (account sync, order placement, cost-basis import).
- No multi-user, no auth beyond whatever hosting requires, no mobile app (responsive web is enough).
- No automated trading, alerts by UI badge only (no email/push in v1).

## Definition of done (v1)
- All screens above (plus in-app Help) functional, persisting to the `challenge` schema in the existing Supabase project, behind the existing auth.
- Enter the workbook's example data → app numbers match workbook numbers exactly (including a partial-close case).
- Daily snapshot writes on first load; dashboard shows a Total Score trend once ≥2 snapshots exist.
- Milestone-hit and tax-skim-due alerts fire correctly on test data.
- Quotes auto-populate via the Pages Function with manual override working.
- Seed import from the workbook works; export produces complete JSON/CSV.
- Installable as a PWA.
- Deployed on Cloudflare Pages, meeting the design bar in `DESIGN.md`.

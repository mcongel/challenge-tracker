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
- Success metric = **Total Score** = challenge account value + banked floors + tax reserved. Every banked dollar counts as won, permanently. Ending at $180k means winning $180k, not missing 82% of $1M.

### Milestone ratchet
- Below $100,000 account value: everything rides. No skims except tax reserve.
- Milestones: $100k, $200k, $400k, $800k, $1M (extendable by doubling).
- When account value crosses a milestone: bank **25% of account value at hit** into VOO in the parked pile. Banked money NEVER returns to the trading account. The app must surface "MILESTONE HIT — BANK NOW" prominently and nag until the banking event is recorded.

### Tax reserve
- Quarterly: reserve **30% of net realized gains YTD** (challenge account only), moved out of play. If YTD net realized is negative, reserve nothing.
- Realized gains exclude wash-sale-disallowed losses.
- This rule is non-negotiable in the UI — no setting to disable it.

### Funding rules
- Stake additions come ONLY from: (a) long-term trims of the parked pile (held > 1 year, ~21% combined tax vs ~28–30% short-term), or (b) fresh income. NEVER from selling parked winners short-term, and NEVER refilling after losses from the parked pile.
- The parked pile is tracked for context and funding-calendar purposes but is walled off from all scoreboard math.

### Trading guardrails (the Xu rules)
- No margin. No options. No chasing stocks that have already run.
- Every position requires an **exit target** and **bail point** entered at open. The app should refuse (or loudly warn on) a position entry without them.
- Wash sale rule: selling at a loss then rebuying the same ticker within 31 days — in ANY account (Robinhood, Cash App, Stash) — disallows the loss. The app should warn when a buy is entered for a ticker with a loss-sale in the past 31 days.

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
- exitTarget (required), bailPoint (required), thesis (text)
- Derived per lot: costBasis = shares × avgCost; marketValue = shares × currentPrice; unrealized $ and %; daysHeld; longTermDate = buyDate + 366
- **Partial close:** closing may take fewer shares than the lot holds — the closed portion becomes a Trade (proportional basis) and the lot's remaining shares stay open with original buyDate. Closing across multiple lots defaults to FIFO (oldest lot first), with per-lot override.
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

### BenchmarkDeposit
- date, amount, vooPriceThatDay
- Derived: shadowShares = amount / vooPriceThatDay
- Global input: vooPriceToday → shadowValue = Σ shadowShares × vooPriceToday
- Lead = TotalScore − shadowValue (also as %)

### ParkedPosition (context only — excluded from all score math)
- ticker, account (Cash App / Robinhood), category: enum [Semi/AI, AI-adjacent, BTC, Other]
- shares, avgCost, currentPrice, buyDate (oldest lot), notes, trimRank
- Derived: longTermDate = buyDate + 366; ltStatus = "FUNDING UNLOCKED" when today ≥ longTermDate, else countdown
- Concentration: Semi/AI % of pile; Semi/AI + AI-adjacent %; target cap (default 50%, editable); status "OVER CAP — trim semis first" when exceeded
- Seed data lives in the reference workbook's Parked Pile tab (MU, AMAT, AMKR, ASML, SOXX, NBIS, AMD, AVGO, GOOGL, GLW, MSTR, plus NVDA/TSLA arriving from a Stash ACATS transfer). MSTR is a conviction hold, category BTC, never trim fuel.

## Screens

1. **Dashboard (landing).** Total Score (hero number), broken into account value / banked floors / tax reserved. Next milestone + distance. Progress bar to $1M labeled "aspiration." Net contributed. Lead vs VOO. Net realized YTD. Any active alerts (milestone hit, tax skim due, wash-sale warning, over concentration cap). Parked pile total shown small and explicitly labeled "context only — not in score."
2. **Cash Ledger.** Event list with running balance, add-event form with type dropdown, summary block (deposits, withdrawals, net contributed, buys, sells, dividends, skims, fees, current cash). Adding a Deposit prompts for that day's VOO price to auto-create the BenchmarkDeposit twin.
3. **Positions.** Open positions table; add form enforces exit target + bail point; shows days held and long-term date; close action moves it to Trade Log and creates the Sell cash event.
4. **Trade Log.** Closed trades, ST/LT badge, wash-sale flag, YTD realized total.
5. **Milestones.** The ratchet table with statuses and a "record banking" action.
6. **Tax Reserve.** Quarterly checklist, auto-computed from Trade Log, with "mark moved" action creating the TaxSkim cash event.
7. **Benchmark.** Shadow purchases list, VOO price today input, lead display, rolling-12-month verdict once a year of data exists.
8. **Parked Pile.** Foundation table with funding-unlock countdowns, concentration watch, trim ranks.
9. **Rules.** Static page with the full rules text (copy from the workbook's Rules tab). Show a link to it after any milestone banking event and after any closed trade with |gain| > 25%.

## Calculations to port exactly

All formulas live in the reference workbook; port them 1:1. Key ones:
- accountTotal = Σ open position marketValue + currentCash
- currentCash = deposits − withdrawals − buys + sells + dividends − taxSkims − milestoneBanks − fees
- TotalScore = accountTotal + Σ amountBanked + Σ taxSkimsMoved
- nextMilestone = smallest level > accountTotal (100k floor)
- shadowValue = Σ (deposit/vooPriceAtDeposit) × vooPriceToday

## Price updates
- No brokerage integration, but quotes should self-update. Delayed/EOD prices are fine — this is a scoreboard, not a trading terminal.
- Architecture: a Cloudflare Pages Function (`/api/quotes?tickers=...`) fetches quotes server-side from a free market-data API (Finnhub or Twelve Data free tier — pick at build time; note Google Finance has no public API), with the API key in an environment variable, never in the browser.
- Cache quotes (KV or in-function cache) with a TTL of ~15–60 minutes. App fetches on load; every screen showing prices gets a manual "refresh prices" button with a last-updated timestamp.
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
- All nine screens functional, persisting to the `challenge` schema in the existing Supabase project, behind the existing auth.
- Enter the workbook's example data → app numbers match workbook numbers exactly (including a partial-close case).
- Daily snapshot writes on first load; dashboard shows a Total Score trend once ≥2 snapshots exist.
- Milestone-hit and tax-skim-due alerts fire correctly on test data.
- Quotes auto-populate via the Pages Function with manual override working.
- Seed import from the workbook works; export produces complete JSON/CSV.
- Installable as a PWA.
- Deployed on Cloudflare Pages, meeting the design bar in `DESIGN.md`.

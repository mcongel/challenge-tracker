# Challenge Tracker — how to use it

The app is a scoreboard that enforces the rules. **Total Score = account value + banked floors + tax reserved.** Banked money never returns to the table; the floor only rises. Everything below is organized by when you actually do it.

## Every time you open it — the 30-second loop

1. **Dashboard** shows Total Score, its three parts, the next milestone, and your lead vs the VOO shadow.
2. **Banners at the top mean act now**: MILESTONE HIT — BANK NOW, a tax skim due, or the parked pile over its concentration cap. Click one to go handle it.
3. Hit **refresh prices** (circular arrow, header) if the "prices as of" stamp looks stale. Quotes are delayed ~30 minutes — it's a scoreboard, not a trading terminal.
4. The first open of each day writes a **snapshot** — the history that draws the race chart and, after a year, the rolling verdict. A scheduled GitHub Action also writes it after market close, so history holds even on days the app never opens. Snapshots need a VOO price, so if the quote feed is down, set one on the Benchmark screen.

## When money moves — Cash Ledger

- **Deposit**: needs that day's **VOO price** — it creates the shadow VOO purchase automatically (the honest test never skips a beat). Pick the account the money came from. **Rule 12**: the form refuses any deposit that would push net contributed past the $25,000 cap; you'll see an amber "room left" badge from 80%.
- **Withdrawal / other events**: pick the destination account so the ledger tells the whole story ("→ Tax Reserve Savings").
- Buys and Sells are written for you when you trade on the Positions screen — you rarely add those by hand.
- Deleting a Deposit also deletes its shadow VOO twin.

## When you trade — Positions & Trade Log

**Opening a position** (Positions → Add position):
- One stock at a time — Rule 7. The form warns if another name is still riding; Xu style is sell, then rotate.
- The exit target is required — the catalyst move you're selling into (Rule 8). The form won't submit without it.
- The wash-sale check runs as you type: any loss-sale of that ticker in the past 31 days — challenge account or a recorded outside sale — gets cited with its date and account (Rule 9).
- The Buy is written to the Cash Ledger automatically.

**When the target hits**, the app tells you: a green banner on the Dashboard and a "target hit" flag on the position the moment the live price crosses your written exit target. Selling at a loss? The close form shows the exact date before which a rebuy anywhere disallows it.

**Closing** (Close button on the ticker):
- Enter shares (partial is fine), price, date — and the broker's SEC/FINRA fees in the optional Fees field: proceeds and realized gain record net, which keeps the tax skim exact. Oldest lots close first (FIFO); "customize per lot" overrides that. Remaining shares keep their original buy dates.
- The app writes the Trade Log entries and the Sell cash event. After a big win or loss (|gain| > 25%), a quiet link appears: *read the rules*. Especially after the wins.

**Sales in your other brokerages** (Trade Log → Record outside sale):
- Ticker, account, date, loss checkbox. Five seconds. This is radar only — never in the score — but it's what lets the app catch a cross-brokerage wash sale before you rebuy.

**Wash checkbox** on a trade: tick it if the loss is actually disallowed; it drops out of YTD realized (and therefore out of the tax skim).

**Stock split**: Split button on the ticker — enter the ratio, it adjusts open lots and parked positions and logs itself in notes.

## Once a quarter — the tax skim

The day after a quarter ends, a banner appears and the **Tax Reserve** screen shows the row as due: 30% of net realized YTD, minus what's already reserved. Move the money in real life, then **Mark moved** and pick the bank account it went to. The screen shows where the reserve is held. There is no off switch — Rule 3 is what makes a blown account a shrug instead of a debt. Reserved money still counts in Total Score: it's won, just out of play.

## At a milestone — the championship moment

When account value crosses $100k (then $200k, $400k, $800k…), a banner shows the exact amount: **BANK $X NOW** — 25% of account value at the moment of hit. It will not go away until you act:

1. In real life: sell down 25% and buy VOO in the parked pile.
2. In the app: **Record banking** — value at hit, amount, date, destination.

The floor rises permanently, the staircase chart gets a step, and the banner is replaced by a quiet *read the rules* link. Banked money never returns to the table — Rule 2.

## The parked pile — context, fuel schedule, never score

- Everything here is **walled off from the score**. The pile total appears on the Dashboard small and labeled "context only."
- Each holding is a stack of dated **lots** (click a row to open them) — every purchase and DRIP reinvestment has its own 366-day unlock clock, so the table shows "3.2/5.56 sh unlocked" honestly. Unlocked shares are the only legitimate trim fuel — Rules 4 and 5: on schedule, never in response to losses, and NVDA/TSLA/MSTR never.
- **Dividends** go in from the same lots view: date, amount, classification, and whether it reinvested (a DRIP buys its own dated sliver; cash just logs as income context). One entry per brokerage statement line. **Return-of-capital** distributions automatically reduce lot cost basis (the original stays recoverable) — sales are then taxed against the adjusted basis, while yield on cost stays anchored to what you paid. A lot whose basis hits zero gets a "basis 0" flag; further ROC on it is capital gain.
- **Buy** (toolbar button) records a purchase: a new holding, or — if the ticker is already held in that account — a new dated lot on the existing position. Each buy gets its own 366-day unlock clock.
- **Sell** (scissors icon on a row) does the whole flow in one form: shrinks the position, logs the sale in the wash-sale radar, and — if you check "deposit the proceeds" — writes the Deposit and its shadow VOO twin. The optional Fees field records proceeds (and the deposit) net of the broker's regulatory fees. It warns before unlock and refuses to blow the contribution cap. Fully selling (or transferring away) a position closes it but keeps its dividend history — it moves to the Income screen with a "closed" pill, and re-adding the same ticker in that account picks the history back up.
- **Sales are undoable and editable.** Every sale records exactly which lots it consumed, so the undo arrow in the sale history brings lots, basis, and ROC adjustments back precisely, and editing a sale's shares/price/date re-derives everything. Undo newest-first per holding. One thing undo never touches: the challenge ledger — if the sale funded a Deposit, fix the Cash Ledger yourself. Sales recorded before this feature can only have their numbers corrected.
- **Concentration watch**: Semi/AI over the 50% cap turns the banner red — trim semis first; it funds the account *and* fixes the concentration.
- **Accounts** button: manage where money lives, and each account's *tracked cash*. Trims, buys, dividends, and challenge funding flow in automatically; you enter only external deposits, interest, and fees. **Reconcile monthly**: click the cash figure, type the brokerage's actual balance, and an adjustment keeps the number true (first reconcile = your opening balance).
- ACATS transfer landed? Edit the position and change its account.

## When the pile starts paying you — Living Expenses

- The turn from growing the pile to living off it. Enter your **bills** (monthly, annual with the month due, or one-off), and the app matches your **spendable** after-tax dividend income against them — filling the **cheapest bill first** (the debt-snowball method), so each flips to covered and the next target is always the next-cheapest gap.
- Each holding on Income carries a **DRIP / Spend** toggle — only *Spend* income counts toward coverage. It defaults from the holding's own history; an amber dot warns when your choice contradicts what the broker actually did.
- The headline ("62% · 7 of 12 bills") is annualized; the **next-target line** turns the gap into an investing goal ("$95/mo more covers your phone — ≈ $30k more invested at your yield"). The reinvesting-vs-spendable split is your growth-vs-drawdown lever.
- The **monthly chart** lands each bill in its actual month, so an annual premium spikes where it really hits. Green months clear it, red months are where you'd dip into principal. Tap a month for its payers and bills.
- **Record a payment** when you withdraw to pay a bill — tagged to the expense and flagged *income* vs *principal* (defaulted from your accumulated dividend cash). The Payments card tracks how much of what you drew came from income — the honest "living on the yield, or eating the seed corn" read. A coverage tile on the Dashboard keeps the headline % in view. Context only — never score or challenge math.

## The retirement modeler — Transition

- **Scenarios** are pure what-ifs: which holdings rotate into income assets, when, at what assumed yields — projected against your after-tax target income. Nothing in a scenario touches real holdings, the score, or the ledger.
- Each scenario can carry its **own tax rates** (retired brackets differ from working ones); blank rates fall back to the Tax Reserve settings.
- Rotation sale proceeds are haircut using the holding's REAL ROC-adjusted basis, and a rotation dated before shares unlock gets a **short-term flag** — warned, never blocked.
- Enter total dollars on any trade form (**notional mode**): type the broker's filled total and the per-share price derives — no more penny drift on fractional shares.

## Once a year — January, the 1099 ritual

- **Confirm dividend classifications** against the 1099-DIV: on Income, filter the year, compare the per-class subtotal line to the form's boxes, and bulk-reclassify anything the broker re-characterized. Reclassified rows get a small history flag.
- **Record any loss carryforward**: Tax Reserve → Carryforwards. The loss carried into the new year offsets gains before the 30% applies.
- **Check wash flags** on the Trade Log against the 1099-B — a disallowed loss ticked as washed drops out of YTD realized (and the skim math).

## The honest test — Benchmark

Every deposit bought shadow VOO the same day. The Benchmark screen shows the race: your Total Score vs what the same money in VOO would be worth now, and after a year of snapshots, the **rolling 12-month verdict**. Beating VOO after tax is what proves the edge — and it's the only thing that raises the contribution cap (Rules 10 and 12). Two honesty notes printed on the screen: the shadow ignores VOO dividends (flatters you) and taxes (also flatters you). The real hurdle is higher than the lead suggests.

## Housekeeping

- **Prices**: pinned manual prices (pencil icon) beat API quotes until cleared — for delisted tickers or corrections. Everything else auto-refreshes.
- **Export** (download icon, header): full JSON or CSV per table, any time. A nightly GitHub Action also backs up every table to a 90-day artifact — recovery is download + `scripts/restore.mjs`.
- **Phone**: the site installs as an app — Share/menu → Add to Home Screen.
- **Example data**: rows marked "EXAMPLE" came from the workbook seed. The Dashboard's getting-started checklist clears them all in one click when you're ready to start for real.
- **Dark mode**: moon icon. **Sign out**: door icon.

## Screen cheat sheet

| Screen | Job |
|---|---|
| Dashboard | The score, alerts, charts — start here |
| Cash Ledger | Every dollar in and out, running balance |
| Positions | Open lots; one name at a time, exit target enforced |
| Watchlist | The bench — researched setups waiting for the rotation |
| Trade Log | Closed trades, YTD realized, outside-sale radar |
| Milestones | The ratchet: bank 25% at each level |
| Tax Reserve | Quarterly 30% checklist |
| Benchmark | You vs shadow VOO |
| Parked Pile | The foundation — context only |
| Activity | Every pile event, filterable by account/ticker/type |
| Income | What the pile pays; 1099 filters, ROC basis, DRIP/Spend |
| Living Expenses | Bills covered by dividend income, cheapest first |
| Transition | Retirement rotations, on paper only |
| Rules | The law. Read after big wins especially |

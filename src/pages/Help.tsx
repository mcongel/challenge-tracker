import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';

/* The field guide — same content as HELP.md, organized by when you actually
 * do things. Keep the two in sync when flows change. */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wider text-green-600 mb-0.5">{children}</p>
  );
}

function Rule({ n }: { n: string }) {
  return (
    <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-bold whitespace-nowrap">
      Rule {n}
    </span>
  );
}

function Screen({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-gray-900 border-b-2 border-green-100 hover:border-green-600">
      {children}
    </Link>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="bg-white rounded-lg shadow-lg p-5 sm:p-6">{children}</section>;
}

export function Help() {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="Field Guide"
        subtitle="The app is a scoreboard that enforces the rules. Total Score = account value + banked floors + tax reserved. The floor only rises."
      />

      <Card>
        <Eyebrow>Every open · ~30 seconds</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">The daily loop</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-600 leading-relaxed">
          <li>
            <Screen to="/">Dashboard</Screen> shows Total Score, its three parts, the next
            milestone, and your lead vs the VOO shadow.
          </li>
          <li>
            <strong className="text-gray-900">Banners at the top mean act now</strong> — a
            milestone hit, a tax skim due, or the pile over its concentration cap. Click one to go
            handle it.
          </li>
          <li>
            Hit <strong className="text-gray-900">refresh prices</strong> (circular arrow, header)
            if "prices as of" looks stale. Quotes are delayed ~30 minutes — it's a scoreboard, not
            a trading terminal.
          </li>
          <li>
            The first open of each day writes a <strong className="text-gray-900">snapshot</strong>{' '}
            — the history behind the race chart and, after a year, the rolling verdict. Snapshots
            need a VOO price; if the feed is down, set one on <Screen to="/benchmark">Benchmark</Screen>.
          </li>
        </ol>
      </Card>

      <Card>
        <Eyebrow>When money moves</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          Deposits and withdrawals — <Screen to="/ledger">Cash Ledger</Screen>
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-600 leading-relaxed">
          <li>
            <strong className="text-gray-900">Deposit</strong> asks for that day's VOO price — it
            creates the shadow VOO purchase automatically, so the honest test never skips a beat.
            Pick the account the money came from.
          </li>
          <li>
            <strong className="text-gray-900">Withdrawal</strong> and skims ask where the money
            went, so the ledger tells the whole story.
          </li>
          <li>
            Buys and Sells write themselves when you trade — you rarely add those by hand.
            Deleting a Deposit also removes its shadow twin.
          </li>
        </ul>
        <p className="mt-3 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
          <Rule n="12" /> Net contributed caps at $25,000. From 80% you'll see a "room left" badge;
          the form refuses any deposit that would cross the cap.
        </p>
      </Card>

      <Card>
        <Eyebrow>When you trade</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          Opening, closing, and the wash-sale radar
        </h2>
        <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
          <p>
            <strong className="text-gray-900">Open</strong> (<Screen to="/positions">Positions</Screen>{' '}
            → Add position): one stock at a time <Rule n="7" /> — the form warns if another name is
            still riding — and the exit target is required: the catalyst move you're selling into{' '}
            <Rule n="8" />. As you type the ticker, the wash-sale check cites any loss-sale in the
            past 31 days, challenge account or outside, with its date and account <Rule n="9" />.
            The Buy hits the ledger automatically.
          </p>
          <p>
            <strong className="text-gray-900">When the target hits</strong>, the app tells you: a
            green banner on the Dashboard and a "target hit" flag on the position the moment the
            live price crosses your written exit target. Selling at a loss? The close form shows
            the exact date before which a rebuy anywhere disallows it.
          </p>
          <p>
            <strong className="text-gray-900">Close</strong> (Close button on the ticker): shares —
            partial is fine — price, date. Oldest lots go first (FIFO); "customize per lot"
            overrides. Remaining shares keep their buy dates. The trades and the Sell event are
            written for you; after any close beyond ±25%, a quiet link appears:{' '}
            <em>read the rules</em>. Especially after the wins.
          </p>
          <p>
            <strong className="text-gray-900">Sold something in another brokerage?</strong>{' '}
            <Screen to="/trades">Trade Log</Screen> → Record outside sale: ticker, account, date,
            loss checkbox — five seconds. Radar only, never in the score, but it's how a
            cross-brokerage wash sale gets caught before you rebuy.
          </p>
          <p>
            <strong className="text-gray-900">Also here:</strong> the Wash checkbox removes a
            disallowed loss from YTD; the Split button adjusts open lots and parked positions by
            ratio.
          </p>
        </div>
      </Card>

      <Card>
        <Eyebrow>Once a quarter</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          The tax skim — <Screen to="/tax">Tax Reserve</Screen>
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          The day after a quarter ends, the due row lights up: 30% of net realized YTD, minus
          what's already reserved. Move the money in real life, then{' '}
          <strong className="text-gray-900">Mark moved</strong> and pick the bank account it went
          to — the screen shows where the reserve is held.
        </p>
        <p className="mt-3 bg-red-50 text-red-700 rounded-md px-3 py-2 text-sm font-medium">
          <Rule n="3" /> There is no off switch. The reserve is what makes a blown account a shrug
          instead of a debt — and it still counts in Total Score: won, just out of play.
        </p>
      </Card>

      <Card>
        <Eyebrow>At a milestone</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          The championship moment — <Screen to="/milestones">Milestones</Screen>
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          When account value crosses $100k (then $200k, $400k, $800k…), a banner shows the exact
          amount — <strong className="text-gray-900">BANK $X NOW</strong>, 25% of account value at
          the moment of hit — and won't leave until you act:
        </p>
        <ol className="list-decimal pl-5 mt-2 space-y-1.5 text-sm text-gray-600">
          <li>In real life: sell down 25% and buy VOO in the parked pile.</li>
          <li>
            In the app: <strong className="text-gray-900">Record banking</strong> — value at hit,
            amount, date, destination.
          </li>
        </ol>
        <p className="mt-2 text-sm text-gray-600">
          The floor rises permanently and the staircase gets a step. Banked money never returns to
          the table <Rule n="2" />.
        </p>
      </Card>

      <Card>
        <Eyebrow>The foundation</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          <Screen to="/parked">Parked Pile</Screen> — context and fuel schedule, never score
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-600 leading-relaxed">
          <li>Walled off from the score entirely; the Dashboard shows the total small, labeled "context only."</li>
          <li>
            Each holding is a stack of dated <strong className="text-gray-900">lots</strong> (clock
            icon on a row) — every purchase and DRIP reinvestment has its own 366-day unlock clock,
            so the table shows "3.2/5.56 sh unlocked" honestly. Unlocked shares are the only
            legitimate trim fuel — on schedule, never in response to losses, and NVDA/TSLA/MSTR
            never <Rule n="4–5" />.
          </li>
          <li>
            <strong className="text-gray-900">Dividends</strong> go in from the same lots view: date,
            amount, classification, and whether it reinvested (a DRIP buys its own dated sliver;
            cash just logs as income context). One entry per brokerage statement line.
            Return-of-capital distributions automatically reduce lot cost basis (the original stays
            recoverable) — sales get taxed against the adjusted number, yield on cost stays on what
            you paid, and a lot at zero basis is flagged "basis 0."
          </li>
          <li>
            <strong className="text-gray-900">Trim</strong> (scissors icon on a row) does the whole
            thing in one form: shrinks the position, logs the sale in the wash-sale radar, and —
            if you check "deposit the proceeds" — writes the Deposit and its shadow VOO twin. It
            warns before unlock and refuses to blow the contribution cap. A full trim (or transfer
            away) closes the position but keeps its dividend history on the Income screen.
          </li>
          <li>
            <strong className="text-gray-900">Concentration watch</strong>: Semi/AI past the 50%
            cap turns the banner red — trim semis first; it funds the account <em>and</em> fixes
            the concentration.
          </li>
          <li>
            <strong className="text-gray-900">Accounts</strong> button: brokerages and bank
            accounts live here. Bank accounts show <em>tracked strategy cash</em> — what the ledger
            has routed there, deliberately not your real balance. ACATS landed? Edit the position,
            change its account.
          </li>
        </ul>
      </Card>

      <Card>
        <Eyebrow>The honest test</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          <Screen to="/benchmark">Benchmark</Screen> — you vs shadow VOO
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Every deposit bought shadow VOO the same day. This screen shows the race: Total Score vs
          what the same money in VOO would be worth now — and after a year of snapshots, the{' '}
          <strong className="text-gray-900">rolling 12-month verdict</strong>. Beating VOO after
          tax is what proves the edge, and it's the only thing that raises the contribution cap{' '}
          <Rule n="10 & 12" />. Two honesty notes, printed on the screen too: the shadow ignores VOO
          dividends and taxes — both flatter you. The real hurdle is higher than the lead suggests.
        </p>
      </Card>

      <Card>
        <Eyebrow>Housekeeping</Eyebrow>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Prices, backup, phone</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm text-gray-600 leading-relaxed">
          <li>
            <strong className="text-gray-900">Pinned prices</strong> (pencil icon) beat API quotes
            until cleared — for delisted tickers or corrections. Everything else auto-refreshes.
          </li>
          <li>
            <strong className="text-gray-900">Export</strong> (download icon): full JSON or CSV per
            table, anytime. It doubles as your backup.
          </li>
          <li>
            <strong className="text-gray-900">Phone</strong>: the site installs as an app — browser
            menu → Add to Home Screen.
          </li>
          <li>
            <strong className="text-gray-900">Example data</strong>: rows marked "EXAMPLE" came
            from the workbook seed. The Dashboard's getting-started checklist clears them all in
            one click when you're ready to start for real.
          </li>
        </ul>
      </Card>

      <p className="text-sm italic text-gray-500 px-1 pb-4">
        Read <Link to="/rules" className="text-green-700 hover:underline">the Rules</Link> after
        every big win and every big loss. Especially the wins.
      </p>
    </div>
  );
}

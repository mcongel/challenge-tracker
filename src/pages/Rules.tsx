import { PageHeader } from '../components/ui/PageHeader';

/* Text verbatim from the workbook's Rules tab; bolding added for scanability,
 * numbers rendered as badges. The words themselves are the product — never
 * paraphrase them. */

interface Rule {
  n: number;
  text: React.ReactNode;
}

const SECTIONS: { heading: string; rules: Rule[] }[] = [
  {
    heading: 'Money management',
    rules: [
      {
        n: 1,
        text: (
          <>Below $100,000: <strong>everything rides</strong>. Full aggression, no skims except the tax reserve.</>
        ),
      },
      {
        n: 2,
        text: (
          <>At $100,000 and at every double after (200k, 400k, 800k): <strong>bank 25% of account value at the moment of hit</strong> into VOO in the parked pile. Banked money <strong>NEVER returns to the table</strong>.</>
        ),
      },
      {
        n: 3,
        text: (
          <>Tax reserve: every quarter, move <strong>30% of net realized gains YTD</strong> out of play. This rule is non-negotiable. It is what makes a blown account a shrug instead of a debt.</>
        ),
      },
      {
        n: 4,
        text: (
          <>The bankroll is <strong>never refilled in response to losses</strong>. A drawdown or round-trip is a result, not a reason to add money. Additions happen only on the pre-planned schedule.</>
        ),
      },
      {
        n: 5,
        text: (
          <>Stake additions come only from <strong>long-term trims of the parked pile</strong> (held &gt;1 year, planned in advance) or fresh income. Never from selling parked winners at short-term rates. <strong>NVDA, TSLA, and the MSTR conviction hold are never trim fuel.</strong></>
        ),
      },
    ],
  },
  {
    heading: 'Trading guardrails (the Xu rules)',
    rules: [
      {
        n: 6,
        text: (
          <><strong>No margin. No options. No crypto.</strong> No chasing stocks that have already run.</>
        ),
      },
      {
        n: 7,
        text: (
          <><strong>One stock at a time.</strong> The bankroll rides a single name with a near-term catalyst — full position, no hedging, no diversifying the challenge account. Sell, then rotate.</>
        ),
      },
      {
        n: 8,
        text: (
          <><strong>Exit on the target.</strong> Every position gets an exit target written at open — the catalyst move you're selling into (Xu's 20–30%). Sell into strength and rotate to the next setup.</>
        ),
      },
      {
        n: 9,
        text: (
          <>No rebuying a name sold at a loss within <strong>31 days</strong> — in ANY account (Robinhood, Cash App, Stash). Wash sales cross brokerages. This applies <strong>in both directions</strong> — don't buy a name in the challenge account within 31 days of selling it at a loss anywhere else.</>
        ),
      },
    ],
  },
  {
    heading: 'Scorekeeping',
    rules: [
      {
        n: 10,
        text: (
          <>The benchmark is <strong>VOO after tax</strong>. Beating it over rolling 12 months is what proves an edge. If the edge is proven, adding capital is investing. If not, the experiment answered the question cheaply.</>
        ),
      },
      {
        n: 11,
        text: (
          <><strong>Success = Total Score: account value + banked floors + tax reserved.</strong> The final number is the prize, never a shortfall against the aspiration. The only real failures are breaking the rules or losing to VOO.</>
        ),
      },
      {
        n: 12,
        text: (
          <><strong>Net contributed caps at $25,000.</strong> Once reached, the account grows only by trading. Raising the cap requires <strong>beating VOO after tax over a trailing 12 months</strong> — not wanting to.</>
        ),
      },
    ],
  },
];

export function Rules() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="The Rules" />

      {/* The goal */}
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-4">
        <h2 className="text-xl font-bold text-gray-900 mb-3">The goal</h2>
        <p className="text-base leading-relaxed text-gray-700">
          Compound aggressively, lock in floors as you climb, and let{' '}
          <strong>the final height be the prize</strong>. $1M is the aspiration, not a pass/fail
          line. Every banked dollar is a retirement upgrade already purchased.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.heading} className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-4">
          <h2 className="text-xl font-bold text-gray-900 mb-4">{section.heading}</h2>
          <ol className="space-y-4">
            {section.rules.map((rule) => (
              <li key={rule.n} className="flex gap-3">
                <span className="flex-shrink-0 h-7 w-7 rounded-full bg-green-50 text-green-700 flex items-center justify-center text-sm font-bold tabular-nums">
                  {rule.n}
                </span>
                <p className="text-base leading-relaxed text-gray-700 pt-0.5">{rule.text}</p>
              </li>
            ))}
          </ol>
        </div>
      ))}

      <p className="text-sm italic text-gray-500 px-1 pb-6">
        Read this after every big win and every big loss. Especially the wins.
      </p>
    </div>
  );
}

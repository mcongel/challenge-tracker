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
          <>At $100,000 and at every double after (200k, 400k, 800k): <strong>bank 25% of the account</strong> into VOO in the parked pile. Banked money <strong>NEVER returns to the table</strong>.</>
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
          <>The bankroll is <strong>never refilled from the parked pile</strong> (NVDA, TSLA, MU, AMAT, and the other winners). New money comes only from scheduled long-term trims or fresh income.</>
        ),
      },
      {
        n: 5,
        text: (
          <>Stake additions: only from <strong>long-term trims</strong> (held &gt;1 year) to avoid short-term tax rates.</>
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
          <><strong>No margin. No options.</strong> No chasing stocks that have already run.</>
        ),
      },
      {
        n: 7,
        text: (
          <><strong>Defined exit before entry.</strong> Every position gets a target and a bail point written in the Trade Log at open.</>
        ),
      },
      {
        n: 8,
        text: (
          <>No rebuying a name sold at a loss within <strong>31 days</strong> — in ANY account (Robinhood, Cash App, Stash). Wash sales cross brokerages.</>
        ),
      },
    ],
  },
  {
    heading: 'Scorekeeping',
    rules: [
      {
        n: 9,
        text: (
          <>The benchmark is <strong>VOO after tax</strong>. Beating it over rolling 12 months is what proves an edge. If the edge is proven, adding capital is investing. If not, the experiment answered the question cheaply.</>
        ),
      },
      {
        n: 10,
        text: (
          <><strong>Success = banked pile + account value when done.</strong> Ending at $180k means winning $180k, not missing 82% of a million.</>
        ),
      },
    ],
  },
];

export function Rules() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="The Rules" />

      {/* The epigraph — why this page exists */}
      <blockquote className="mb-6 border-l-4 border-green-600 pl-4 py-1">
        <p className="font-display text-lg sm:text-xl italic text-gray-700 leading-relaxed" style={{ letterSpacing: '-0.01em' }}>
          Written while calm. The person who wrote these is smarter about risk than the person
          staring at a big number later.
        </p>
      </blockquote>

      {/* The goal */}
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-4">
        <h2 className="font-display text-xl font-bold text-gray-900 mb-3" style={{ letterSpacing: '-0.01em' }}>
          The goal
        </h2>
        <p className="text-base leading-relaxed text-gray-700">
          Compound aggressively, lock in floors as you climb, and let{' '}
          <strong>the final height be the prize</strong>. $1M is the aspiration, not a pass/fail
          line. Every banked dollar is a retirement upgrade already purchased.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.heading} className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-4">
          <h2 className="font-display text-xl font-bold text-gray-900 mb-4" style={{ letterSpacing: '-0.01em' }}>
            {section.heading}
          </h2>
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

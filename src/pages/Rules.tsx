import { PageHeader } from '../components/ui/PageHeader';

/* Verbatim from the workbook's Rules tab — the reference implementation. */
const SECTIONS: { heading: string; rules: string[] }[] = [
  {
    heading: 'The goal',
    rules: [
      'Compound aggressively, lock in floors as you climb, and let the final height be the prize. $1M is the aspiration, not a pass/fail line. Every banked dollar is a retirement upgrade already purchased.',
    ],
  },
  {
    heading: 'Money management',
    rules: [
      '1. Below $100,000: everything rides. Full aggression, no skims except the tax reserve.',
      '2. At $100,000 and at every double after (200k, 400k, 800k): bank 25% of the account into VOO in the parked pile. Banked money NEVER returns to the table.',
      '3. Tax reserve: every quarter, move 30% of net realized gains YTD out of play. This rule is non-negotiable. It is what makes a blown account a shrug instead of a debt.',
      '4. The bankroll is never refilled from the parked pile (NVDA, TSLA, MU, AMAT, and the other winners). New money comes only from scheduled long-term trims or fresh income.',
      '5. Stake additions: only from long-term trims (held >1 year) to avoid short-term tax rates.',
    ],
  },
  {
    heading: 'Trading guardrails (the Xu rules)',
    rules: [
      '6. No margin. No options. No chasing stocks that have already run.',
      '7. Defined exit before entry. Every position gets a target and a bail point written in the Trade Log at open.',
      '8. No rebuying a name sold at a loss within 31 days — in ANY account (Robinhood, Cash App, Stash). Wash sales cross brokerages.',
    ],
  },
  {
    heading: 'Scorekeeping',
    rules: [
      '9. The benchmark is VOO after tax. Beating it over rolling 12 months is what proves an edge. If the edge is proven, adding capital is investing. If not, the experiment answered the question cheaply.',
      '10. Success = banked pile + account value when done. Ending at $180k means winning $180k, not missing 82% of a million.',
    ],
  },
];

export function Rules() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="The Rules"
        subtitle="Written while calm. The person who wrote these is smarter about risk than the person staring at a big number later."
      />
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              {section.heading}
            </h2>
            <div className="space-y-2">
              {section.rules.map((rule) => (
                <p key={rule} className="text-sm leading-relaxed text-gray-700">
                  {rule}
                </p>
              ))}
            </div>
          </section>
        ))}
        <p className="text-xs text-gray-400 border-t border-gray-100 pt-4">
          Read this after every big win and every big loss. Especially the wins.
        </p>
      </div>
    </div>
  );
}

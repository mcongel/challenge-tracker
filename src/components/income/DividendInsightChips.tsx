import type { DividendInsight } from '../../lib/engine';
import { cn, formatPercent } from '../../lib/utils';

const COVERAGE_STYLE: Record<DividendInsight['coverage'], string> = {
  healthy: 'bg-green-50 text-green-700',
  elevated: 'bg-amber-50 text-amber-800',
  stretched: 'bg-red-50 text-red-700',
  na: 'bg-gray-100 text-gray-500',
};
const COVERAGE_LABEL: Record<DividendInsight['coverage'], string> = {
  healthy: 'covered', elevated: 'tight', stretched: 'stretched', na: '',
};

/** Growth + payout-coverage chips for a dividend holding (item 3). Renders
 * nothing when there's no data (no FMP key, or a non-payer) so the row is
 * unchanged until the signal exists. */
export function DividendInsightChips({ insight }: { insight: DividendInsight | null | undefined }) {
  if (!insight) return null;
  const { growthCagr, streakYears, coverage, payoutRatio } = insight;
  const hasGrowth = growthCagr != null;
  const hasCoverage = coverage !== 'na';
  if (!hasGrowth && !hasCoverage && streakYears === 0) return null;

  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
      {hasGrowth && (
        <span
          className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
            growthCagr >= 0 ? 'bg-sky-50 text-sky-700' : 'bg-red-50 text-red-700')}
          title={`Dividend growth ${formatPercent(growthCagr)}/yr across complete years${streakYears > 0 ? `, ${streakYears}-yr raise-or-hold streak` : ''}`}
        >
          {growthCagr >= 0 ? '↑' : '↓'}{formatPercent(Math.abs(growthCagr), 0)}/yr
        </span>
      )}
      {hasCoverage && (
        <span
          className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', COVERAGE_STYLE[coverage])}
          title={`Payout ratio ${payoutRatio != null ? formatPercent(payoutRatio, 0) : '—'} (dividends ÷ earnings) — a coverage proxy, not a rating; REITs/CEFs run high by design.`}
        >
          {COVERAGE_LABEL[coverage]}
        </span>
      )}
    </span>
  );
}

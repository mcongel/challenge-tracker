/** Dividend growth + payout coverage — the "safety/growth" signals (item 3),
 * computed from FMP dividend history + TTM payout ratio. Pure: the proxy
 * fetches, this interprets, so the thresholds are testable and one place.
 * These are DECISION AIDS for a hold-forever income pile, deliberately
 * conservative and clearly proxies — not a proprietary "rating". */

export interface DividendFundamentals {
  /** Declared dividends summed per calendar year, oldest first. */
  annual: { year: number; amount: number }[];
  /** Trailing-twelve-month payout ratio (dividends ÷ earnings), or null. */
  payoutRatio: number | null;
  freq?: string | null;
}

export interface DividendInsight {
  /** Compound annual growth of the annual dividend across COMPLETE years,
   * null if fewer than two complete years exist. The current (partial) year
   * is dropped so a mid-year snapshot never reads as a cut. */
  growthCagr: number | null;
  /** Consecutive most-recent complete years the annual dividend did not fall
   * (a raise-or-hold streak). 0 when the latest complete year dropped. */
  streakYears: number;
  payoutRatio: number | null;
  /** Coverage verdict from the payout ratio. 'na' when unknown or when the
   * ratio is meaningless (≤0 earnings). Thresholds are deliberately loose;
   * REITs/CEFs/BDCs routinely run hot, so 'stretched' is a prompt to look,
   * not a verdict. */
  coverage: 'healthy' | 'elevated' | 'stretched' | 'na';
}

/** Complete years only — exclude the calendar year in progress. */
function completeYears(
  annual: { year: number; amount: number }[],
  today: string,
): { year: number; amount: number }[] {
  const thisYear = Number(today.slice(0, 4));
  return annual.filter((a) => a.year < thisYear);
}

export function dividendGrowthCagr(
  annual: { year: number; amount: number }[],
  today: string,
): number | null {
  const years = completeYears(annual, today);
  if (years.length < 2) return null;
  const first = years[0];
  const last = years[years.length - 1];
  if (first.amount <= 0 || last.year === first.year) return null;
  return (last.amount / first.amount) ** (1 / (last.year - first.year)) - 1;
}

export function dividendStreakYears(
  annual: { year: number; amount: number }[],
  today: string,
): number {
  const years = completeYears(annual, today);
  let streak = 0;
  // Walk newest→oldest; count while each year is ≥ the prior year (a small
  // tolerance absorbs rounding in summed distributions).
  for (let i = years.length - 1; i > 0; i--) {
    if (years[i].amount >= years[i - 1].amount - 0.0001) streak++;
    else break;
  }
  return streak;
}

export function payoutCoverage(payoutRatio: number | null): DividendInsight['coverage'] {
  if (payoutRatio == null || payoutRatio <= 0) return 'na';
  if (payoutRatio <= 0.6) return 'healthy';
  if (payoutRatio <= 0.9) return 'elevated';
  return 'stretched';
}

export function dividendInsight(
  f: DividendFundamentals | undefined,
  today: string,
): DividendInsight | null {
  if (!f) return null;
  return {
    growthCagr: dividendGrowthCagr(f.annual, today),
    streakYears: dividendStreakYears(f.annual, today),
    payoutRatio: f.payoutRatio,
    coverage: payoutCoverage(f.payoutRatio),
  };
}

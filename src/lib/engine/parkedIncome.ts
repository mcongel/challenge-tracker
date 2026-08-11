/** Parked-pile dividend income: trailing actuals, next-12-month projection,
 * yield on cost, and informational tax estimates by classification. Income
 * context only — never score, YTD realized, or tax-skim math, and NOT the
 * challenge account's 30% reserve rule.
 *
 * Time-window policy: null-dated dividend lots cannot be placed in a window,
 * so they are excluded from trailing/YTD figures; they still count in lifetime
 * totals (dividendsCollected) and rocCumulative. */

import { addMonths, taxYearOf } from './dates';
import { sum } from './money';
import { aggregateLots } from './parkedLots';
import type { DividendClassification, ParkedLot } from './parkedLots';
import type { DividendFrequency, ParkedPosition } from './types';

/** Rates are fractions (0.15 = 15%). capitalGainDist callers pass the LT rate.
 * return_of_capital is always 0 in Phase 1 (basis adjustment comes later). */
export interface DividendTaxRates {
  /** Also applied to 'unclassified' (flagged upstream, not taxed harder). */
  qualified: number;
  ordinary: number;
  capitalGainDist: number;
}

export const classificationOf = (l: ParkedLot): DividendClassification =>
  l.classification ?? 'unclassified';

export function dividendTaxRateFor(
  c: DividendClassification,
  rates: DividendTaxRates,
): number {
  switch (c) {
    case 'ordinary':
      return rates.ordinary;
    case 'capital_gain_dist':
      return rates.capitalGainDist;
    case 'return_of_capital':
      return 0;
    default: // qualified, unclassified
      return rates.qualified;
  }
}

const MONTHS_PER: Record<DividendFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

const monthOf = (iso: string) => iso.slice(0, 7);
const firstOfMonth = (iso: string) => `${monthOf(iso)}-01`;

const datedDividends = (lots: ParkedLot[]) =>
  lots.filter((l): l is ParkedLot & { date: string } => l.source === 'dividend' && l.date !== null);

export interface MonthlyIncomePoint {
  /** 'yyyy-mm' */
  month: string;
  amount: number;
}

/** Dividend dollars per calendar month for the `months` months ending with
 * today's (partial) month. Dense: every month present, zero-filled. */
export function trailingIncomeByMonth(
  lots: ParkedLot[],
  today: string,
  months = 12,
): MonthlyIncomePoint[] {
  const start = firstOfMonth(today);
  const points = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) points.set(monthOf(addMonths(start, -i)), 0);
  for (const l of datedDividends(lots)) {
    const m = monthOf(l.date);
    if (points.has(m) && l.date <= today) points.set(m, (points.get(m) ?? 0) + l.amount);
  }
  return [...points.entries()].map(([month, amount]) => ({ month, amount }));
}

/** One broker payment = all dividend lots on the same pay date (a payment that
 * splits across classifications is recorded as multiple lots). */
interface Payment {
  date: string;
  amount: number;
}

function paymentsByDate(lots: ParkedLot[]): Payment[] {
  const byDate = new Map<string, number>();
  for (const l of datedDividends(lots)) {
    byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.amount);
  }
  return [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Payment cadence in months from the median gap between recent payments. */
function inferIntervalMonths(dates: string[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(
      (new Date(`${dates[i]}T00:00:00Z`).getTime() -
        new Date(`${dates[i - 1]}T00:00:00Z`).getTime()) /
        86_400_000,
    );
  }
  const gap = median(gaps);
  if (gap <= 45) return 1;
  if (gap <= 135) return 3;
  if (gap <= 270) return 6;
  return 12;
}

export type RateSource = 'actual' | 'manual';

export interface IncomeProjection {
  /** The 12 calendar months after today's month, dense and zero-filled. */
  monthly: MonthlyIncomePoint[];
  annualGross: number;
  annualAfterTax: number;
  source: RateSource;
  nextPayment: { date: string; amount: number } | null;
}

/** After-tax multiplier from the classification mix of trailing-12-month
 * dollars; positions with no classified history assume 'unclassified'. */
function afterTaxFraction(lots: ParkedLot[], today: string, rates: DividendTaxRates): number {
  const windowStart = addMonths(today, -12);
  const recent = datedDividends(lots).filter((l) => l.date > windowStart && l.date <= today);
  const total = sum(recent.map((l) => l.amount));
  if (total <= 0) return 1 - rates.qualified; // unclassified assumption
  const taxed = sum(recent.map((l) => l.amount * dividendTaxRateFor(classificationOf(l), rates)));
  return 1 - taxed / total;
}

/**
 * Next-12-month income for one position. Trailing actuals win when ≥2 dated
 * payments exist in the last 12 months: cadence from the median gap, amount
 * from the mean of the recent payments, schedule anchored to the last actual
 * pay date. Otherwise the manual dividendRate × shares at dividendFrequency
 * (first payment one interval after today). Neither → null (excluded).
 */
export function projectPositionIncome(args: {
  position: ParkedPosition;
  lots: ParkedLot[];
  today: string;
  rates: DividendTaxRates;
}): IncomeProjection | null {
  const { position, lots, today, rates } = args;
  const windowStart = addMonths(today, -12);
  const recentPayments = paymentsByDate(lots).filter(
    (p) => p.date > windowStart && p.date <= today,
  );

  let source: RateSource;
  let intervalMonths: number;
  let perPayment: number;
  let anchor: string; // a real or synthetic pay date; payments recur from here

  if (recentPayments.length >= 2) {
    source = 'actual';
    intervalMonths = inferIntervalMonths(recentPayments.map((p) => p.date));
    const keep = Math.min(recentPayments.length, Math.round(12 / intervalMonths));
    const recent = recentPayments.slice(-keep);
    perPayment = sum(recent.map((p) => p.amount)) / recent.length;
    anchor = recentPayments[recentPayments.length - 1].date;
  } else if (position.dividendRate != null && position.dividendRate > 0 && position.dividendFrequency) {
    source = 'manual';
    intervalMonths = MONTHS_PER[position.dividendFrequency];
    perPayment = (position.dividendRate * position.shares) / (12 / intervalMonths);
    anchor = today;
  } else {
    return null;
  }

  // Dense next-12-months buckets, then drop scheduled payments into them.
  const startMonth = firstOfMonth(today);
  const points = new Map<string, number>();
  for (let i = 1; i <= 12; i++) points.set(monthOf(addMonths(startMonth, i)), 0);
  const horizon = addMonths(startMonth, 13); // exclusive upper bound
  let next: string | null = null;
  for (let d = addMonths(anchor, intervalMonths); d < horizon; d = addMonths(d, intervalMonths)) {
    if (d <= today) continue; // stale anchor: skip already-elapsed dates
    if (next === null) next = d;
    const m = monthOf(d);
    if (points.has(m)) points.set(m, (points.get(m) ?? 0) + perPayment);
  }

  const monthly = [...points.entries()].map(([month, amount]) => ({ month, amount }));
  const annualGross = sum(monthly.map((p) => p.amount));
  return {
    monthly,
    annualGross,
    annualAfterTax: annualGross * afterTaxFraction(lots, today, rates),
    source,
    nextPayment: next ? { date: next, amount: perPayment } : null,
  };
}

export interface PositionIncomeSummary {
  positionId: string;
  trailing12m: number;
  projection: IncomeProjection | null;
  /** Projected annual gross / cost basis from share lots; null when excluded
   * from projections or basis ≤ 0. Original basis — Phase 2 adds ROC-adjusted. */
  yieldOnCost: number | null;
  /** Lifetime return-of-capital dollars, undated included. Display-only until
   * Phase 2 wires basis adjustment. */
  rocCumulative: number;
  hasUnclassified: boolean;
  /** Dollars excluded from time windows because the lot has no date. */
  undatedDividendAmount: number;
}

export function positionIncomeSummary(
  position: ParkedPosition,
  lots: ParkedLot[],
  today: string,
  rates: DividendTaxRates,
): PositionIncomeSummary {
  const dividends = lots.filter((l) => l.source === 'dividend');
  const projection = projectPositionIncome({ position, lots, today, rates });
  const { costBasis } = aggregateLots(lots);
  return {
    positionId: position.id,
    trailing12m: sum(trailingIncomeByMonth(lots, today).map((p) => p.amount)),
    projection,
    yieldOnCost:
      projection && costBasis > 0 ? projection.annualGross / costBasis : null,
    rocCumulative: sum(
      dividends.filter((l) => classificationOf(l) === 'return_of_capital').map((l) => l.amount),
    ),
    hasUnclassified: dividends.some((l) => classificationOf(l) === 'unclassified'),
    undatedDividendAmount: sum(dividends.filter((l) => l.date === null).map((l) => l.amount)),
  };
}

export interface DividendTaxYTD {
  byClassification: Partial<Record<DividendClassification, { amount: number; tax: number }>>;
  totalTax: number;
  /** Dollars estimated at the qualified rate only because nobody confirmed
   * the classification yet — surfaced as a flag in the UI. */
  unclassifiedAmount: number;
}

/** Estimated tax on dividends dated in `year`. Informational only — this is
 * NOT the challenge account's 30% reserve. Undated lots excluded (no year). */
export function dividendTaxYTD(
  lots: ParkedLot[],
  year: number,
  rates: DividendTaxRates,
): DividendTaxYTD {
  const byClassification: DividendTaxYTD['byClassification'] = {};
  let totalTax = 0;
  let unclassifiedAmount = 0;
  for (const l of datedDividends(lots)) {
    if (taxYearOf(l.date) !== year) continue;
    const c = classificationOf(l);
    const tax = l.amount * dividendTaxRateFor(c, rates);
    const entry = (byClassification[c] ??= { amount: 0, tax: 0 });
    entry.amount += l.amount;
    entry.tax += tax;
    totalTax += tax;
    if (c === 'unclassified') unclassifiedAmount += l.amount;
  }
  return { byClassification, totalTax, unclassifiedAmount };
}

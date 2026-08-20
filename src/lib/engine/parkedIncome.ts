/** Parked-pile dividend income: trailing actuals, next-12-month projection,
 * yield on cost, and informational tax estimates by classification. Income
 * context only — never score, YTD realized, or tax-skim math, and NOT the
 * challenge account's 30% reserve rule.
 *
 * Time-window policy: null-dated dividend lots cannot be placed in a window,
 * so they are excluded from trailing/YTD figures; they still count in lifetime
 * totals (dividendsCollected) and rocCumulative. */

import { addDays, addMonths, daysBetween, taxYearOf } from './dates';
import { sum } from './money';
import { isArchivedPosition } from './parked';
import type { DividendClassification, ParkedLot } from './parkedLots';
import { aggregateLotsAdjusted } from './parkedRoc';
import type { ParkedLotAdjustment } from './parkedRoc';
import type { DividendFrequency, ParkedPosition } from './types';

/** Default estimate rates — live values come from app_settings. Single source
 * for the migration seeds and the DataContext fallbacks. */
export const QUALIFIED_DIVIDEND_TAX_RATE = 0.15;
export const ORDINARY_DIVIDEND_TAX_RATE = 0.24;

/** Rates are fractions (0.15 = 15%). capitalGainDist callers pass the LT rate.
 * return_of_capital is 0 while basis remains; the overflow beyond basis is
 * estimated at the capitalGainDist rate in dividendTaxYTD. */
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

/** Payment interval in whole months. Sub-monthly frequencies (daily,
 * semimonthly) aren't listed — they project as monthly aggregates since the
 * output buckets are calendar months anyway. */
const MONTHS_PER: Partial<Record<DividendFrequency, number>> = {
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
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const gap = median(gaps);
  if (gap <= 45) return 1;
  if (gap <= 135) return 3;
  if (gap <= 270) return 6;
  return 12;
}

/** Merge payments in the same calendar month (a special dividend lands days
 * from the regular one) so a two-payment burst can't read as a monthly
 * cadence. The merged payment carries the month's total and its last date. */
function mergeByMonth(payments: Payment[]): Payment[] {
  const byMonth = new Map<string, Payment>();
  for (const p of payments) {
    const m = monthOf(p.date);
    const existing = byMonth.get(m);
    if (existing) {
      existing.amount += p.amount;
      existing.date = p.date;
    } else {
      byMonth.set(m, { ...p });
    }
  }
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
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

/** The trailing window is the same 12 calendar months everywhere (buckets,
 * projection inputs, tax mix): first day of the month 11 months back, through
 * today. Keeps the T12M column and the projection source consistent. */
const trailingWindowStart = (today: string) => addMonths(firstOfMonth(today), -11);

/** After-tax multiplier from the classification mix of trailing-window
 * dollars; positions with no classified history assume 'unclassified'. */
function afterTaxFraction(lots: ParkedLot[], today: string, rates: DividendTaxRates): number {
  const windowStart = trailingWindowStart(today);
  const recent = datedDividends(lots).filter((l) => l.date >= windowStart && l.date <= today);
  const total = sum(recent.map((l) => l.amount));
  if (total <= 0) return 1 - rates.qualified; // unclassified assumption
  const taxed = sum(recent.map((l) => l.amount * dividendTaxRateFor(classificationOf(l), rates)));
  return 1 - taxed / total;
}

/** Phase 1 — cadence from history: payments in ≥2 distinct trailing-window
 * months, latest not stale (older than ~1.5 payment intervals — a suspended
 * dividend must not keep projecting). Cadence from the median gap, amount
 * from the mean of the recent monthly payments, schedule anchored to the
 * last actual pay date. */
function actualCadence(
  lots: ParkedLot[],
  today: string,
): { intervalMonths: number; perPayment: number; anchor: string } | null {
  const windowStart = trailingWindowStart(today);
  const recentPayments = mergeByMonth(
    paymentsByDate(lots).filter((p) => p.date >= windowStart && p.date <= today),
  );
  if (recentPayments.length < 2) return null;
  const intervalMonths = inferIntervalMonths(recentPayments.map((p) => p.date));
  const last = recentPayments[recentPayments.length - 1];
  // ~45 days per interval month = 1.5 intervals of slack before we decide
  // the payer has gone quiet and stop trusting the history.
  if (daysBetween(last.date, today) > intervalMonths * 45) return null;
  const keep = Math.min(recentPayments.length, Math.round(12 / intervalMonths));
  const recent = recentPayments.slice(-keep);
  return {
    intervalMonths,
    perPayment: sum(recent.map((p) => p.amount)) / recent.length,
    anchor: last.date,
  };
}

/** Phase 1 fallback — the manual dividendRate × shares at dividendFrequency,
 * first payment one interval after today. Sub-monthly cadences project as
 * monthly aggregates (the buckets are calendar months anyway); the
 * next-payment hint keeps the true cadence. */
function manualCadence(
  position: ParkedPosition,
  today: string,
): {
  intervalMonths: number;
  perPayment: number;
  anchor: string;
  subMonthlyNext: { date: string; amount: number } | null;
} | null {
  if (!(position.dividendRate != null && position.dividendRate > 0 && position.dividendFrequency)) {
    return null;
  }
  const annual = position.dividendRate * position.shares;
  const freq = position.dividendFrequency;
  if (freq === 'daily' || freq === 'weekly' || freq === 'semimonthly') {
    return {
      intervalMonths: 1,
      perPayment: annual / 12,
      anchor: today,
      subMonthlyNext:
        freq === 'daily' ? { date: addDays(today, 1), amount: annual / 365 }
        : freq === 'weekly' ? { date: addDays(today, 7), amount: annual / 52 }
        : { date: addDays(today, 15), amount: annual / 24 },
    };
  }
  const intervalMonths = MONTHS_PER[freq]!;
  return {
    intervalMonths,
    perPayment: annual / (12 / intervalMonths),
    anchor: today,
    subMonthlyNext: null,
  };
}

/** Phase 2 — dense next-12-months buckets, then drop the schedule into them.
 * Payments recur every intervalMonths from the (real or synthetic) anchor. */
function bucketizeSchedule(
  anchor: string,
  intervalMonths: number,
  perPayment: number,
  today: string,
): { monthly: MonthlyIncomePoint[]; next: string | null } {
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
  return { monthly: [...points.entries()].map(([month, amount]) => ({ month, amount })), next };
}

/**
 * Next-12-month income for one position. Trailing actuals win when payments
 * exist in ≥2 distinct months of the trailing window AND the latest payment
 * isn't stale (older than ~1.5 payment intervals — a suspended dividend must
 * not keep projecting): cadence from the median gap, amount from the mean of
 * the recent monthly payments, schedule anchored to the last actual pay date.
 * Same-month payments merge first, so a special dividend days after a regular
 * one can't masquerade as a monthly cadence. Otherwise the manual
 * dividendRate × shares at dividendFrequency (first payment one interval
 * after today). Neither → null (excluded).
 */
export function projectPositionIncome(args: {
  position: ParkedPosition;
  lots: ParkedLot[];
  today: string;
  rates: DividendTaxRates;
}): IncomeProjection | null {
  const { position, lots, today, rates } = args;
  // Archived positions keep their history but never project — recent
  // payments belong to shares that are no longer held.
  if (isArchivedPosition(position)) return null;

  const actual = actualCadence(lots, today);
  const manual = actual ? null : manualCadence(position, today);
  if (!actual && !manual) return null;
  const source: RateSource = actual ? 'actual' : 'manual';
  const { intervalMonths, perPayment, anchor } = (actual ?? manual)!;
  const subMonthlyNext = manual?.subMonthlyNext ?? null;

  const { monthly, next } = bucketizeSchedule(anchor, intervalMonths, perPayment, today);
  const annualGross = sum(monthly.map((p) => p.amount));
  return {
    monthly,
    annualGross,
    annualAfterTax: annualGross * afterTaxFraction(lots, today, rates),
    source,
    nextPayment: subMonthlyNext ?? (next ? { date: next, amount: perPayment } : null),
  };
}

export interface PositionIncomeSummary {
  positionId: string;
  trailing12m: number;
  projection: IncomeProjection | null;
  /** Original cost basis from share lots (purchases + DRIP). */
  costBasis: number;
  /** ROC-adjusted cost basis — what a sale would actually be taxed against. */
  adjustedCostBasis: number;
  /** Projected annual gross / ORIGINAL cost basis; null when excluded from
   * projections or basis ≤ 0. Yield-on-cost stays anchored to what was paid. */
  yieldOnCost: number | null;
  /** Lifetime return-of-capital dollars, undated included. */
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
  adjustments: ParkedLotAdjustment[] = [],
): PositionIncomeSummary {
  const dividends = lots.filter((l) => l.source === 'dividend');
  const projection = projectPositionIncome({ position, lots, today, rates });
  const { costBasis, adjustedCostBasis } = aggregateLotsAdjusted(lots, adjustments);
  return {
    positionId: position.id,
    trailing12m: sum(trailingIncomeByMonth(lots, today).map((p) => p.amount)),
    projection,
    costBasis,
    adjustedCostBasis,
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
  /** ROC beyond remaining basis — estimated as capital gain at the LT rate.
   * (Overflow means the basis ran out, which takes years of a long hold, so
   * LT is the honest default; the exact ST slice isn't reconstructible.) */
  rocOverflowAmount: number;
  /** ROC dollars whose allocation never ran — taxed 0, flagged in the UI. */
  rocUnallocatedAmount: number;
}

/** Estimated tax on dividends received in today's tax year, through today —
 * pre-logged future payments don't count until they land, matching every
 * other figure on the Income screen. ROC overflow comes from the value stored
 * at allocation time (rocOverflow) — never derived from adjustment rows,
 * which trims/transfers legitimately mutate. Informational only — this is
 * NOT the challenge account's 30% reserve. Undated lots excluded (no year). */
export function dividendTaxYTD(
  lots: ParkedLot[],
  today: string,
  rates: DividendTaxRates,
): DividendTaxYTD {
  return dividendTaxForYear(lots, taxYearOf(today), today, rates);
}

/** Same estimate for an arbitrary tax year (the Pile-taxes card's year
 * picker). Past years are complete; the current year clips at today. */
export function dividendTaxForYear(
  lots: ParkedLot[],
  year: number,
  today: string,
  rates: DividendTaxRates,
): DividendTaxYTD {
  const byClassification: DividendTaxYTD['byClassification'] = {};
  let totalTax = 0;
  let unclassifiedAmount = 0;
  let rocOverflowAmount = 0;
  let rocUnallocatedAmount = 0;
  for (const l of datedDividends(lots)) {
    if (taxYearOf(l.date) !== year || l.date > today) continue;
    const c = classificationOf(l);
    let tax = l.amount * dividendTaxRateFor(c, rates);
    if (c === 'return_of_capital') {
      if (l.rocAllocatedAt) {
        const overflow = l.rocOverflow ?? 0;
        rocOverflowAmount += overflow;
        tax = overflow * rates.capitalGainDist;
      } else {
        rocUnallocatedAmount += l.amount;
        tax = 0;
      }
    }
    const entry = (byClassification[c] ??= { amount: 0, tax: 0 });
    entry.amount += l.amount;
    entry.tax += tax;
    totalTax += tax;
    if (c === 'unclassified') unclassifiedAmount += l.amount;
  }
  return { byClassification, totalTax, unclassifiedAmount, rocOverflowAmount, rocUnallocatedAmount };
}

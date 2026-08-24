/** Living-expenses coverage — the "pile pays the bills" engine. Spendable
 * after-tax dividend income is matched against expenses CHEAPEST-FIRST (the
 * debt-snowball method the owner chose): income fills the ladder from the
 * bottom, each fully-funded bill flips to covered, and the next target is
 * always the next-cheapest gap. Pure: the page supplies the income figures,
 * this decides coverage. Never score or challenge math. */

import type { Expense } from './types';
import type { ParkedLot } from './parkedLots';
import type { ParkedPosition } from './types';

/** A cost normalized to dollars per month, whatever its cadence. One-off
 * expenses return their full amount but are excluded from the recurring
 * coverage ratio by the caller (they'd distort a monthly figure). */
export function monthlyAmount(e: Expense): number {
  switch (e.cadence) {
    case 'annual': return e.amount / 12;
    case 'once': return e.amount;
    default: return e.amount;
  }
}

export interface CoveredExpense {
  expense: Expense;
  monthly: number;
  /** 1 = fully covered, 0..1 = the in-progress bill, 0 = not reached yet. */
  fundedFraction: number;
  /** Running covered total AFTER this expense — the cumulative fill. */
  cumulativeMonthly: number;
}

export interface CoverageSnowball {
  rows: CoveredExpense[];
  coveredCount: number;
  totalCount: number;
  coveredMonthly: number;
  /** Recurring monthly need (one-offs excluded). */
  totalMonthly: number;
  spendableMonthly: number;
  /** Surplus after all recurring bills (≥0), or 0 when short. */
  surplusMonthly: number;
  coveragePct: number;
  /** The next-cheapest bill not yet fully covered, and the monthly income
   * still needed to finish it. null when everything recurring is covered. */
  nextTarget: { expense: Expense; monthlyGap: number } | null;
}

/** Fill the cheapest bills first with spendableMonthly after-tax income. Only
 * active, recurring (monthly/annual) expenses form the ladder; one-offs are a
 * separate planning concern. */
export function coverageSnowball(
  spendableMonthly: number,
  expenses: Expense[],
): CoverageSnowball {
  const ladder = expenses
    .filter((e) => e.active && e.cadence !== 'once')
    .map((e) => ({ expense: e, monthly: monthlyAmount(e) }))
    .sort((a, b) => a.monthly - b.monthly);

  let remaining = spendableMonthly;
  let cumulative = 0;
  let coveredCount = 0;
  let nextTarget: CoverageSnowball['nextTarget'] = null;
  const rows: CoveredExpense[] = ladder.map(({ expense, monthly }) => {
    const funded = monthly <= 0 ? 1 : Math.max(0, Math.min(1, remaining / monthly));
    const applied = monthly * funded;
    cumulative += applied;
    remaining -= applied;
    if (funded >= 1 - 1e-9) coveredCount++;
    else if (nextTarget === null) nextTarget = { expense, monthlyGap: monthly - applied };
    return { expense, monthly, fundedFraction: funded, cumulativeMonthly: cumulative };
  });

  const totalMonthly = ladder.reduce((t, r) => t + r.monthly, 0);
  return {
    rows,
    coveredCount,
    totalCount: ladder.length,
    coveredMonthly: Math.min(spendableMonthly, totalMonthly),
    totalMonthly,
    spendableMonthly,
    surplusMonthly: Math.max(0, spendableMonthly - totalMonthly),
    coveragePct: totalMonthly > 0 ? Math.min(1, spendableMonthly / totalMonthly) : 0,
    nextTarget,
  };
}

/** Expense dollars landing in each of the given month keys (YYYY-MM), by
 * ACTUAL due month: a monthly bill hits every month; an annual bill hits the
 * month of its dueDate each year (or spreads evenly across the window when it
 * has no dueDate — the documented fallback); a one-off hits the single month
 * of its dueDate if that month is in the window. Only active expenses. */
export function expensesByMonth(expenses: Expense[], monthKeys: string[]): Map<string, number> {
  const out = new Map<string, number>(monthKeys.map((m) => [m, 0]));
  const add = (m: string, amt: number) => {
    if (out.has(m)) out.set(m, out.get(m)! + amt);
  };
  for (const e of expenses) {
    if (!e.active) continue;
    if (e.cadence === 'monthly') {
      for (const m of monthKeys) add(m, e.amount);
    } else if (e.cadence === 'once') {
      if (e.dueDate) add(e.dueDate.slice(0, 7), e.amount);
    } else {
      // annual
      if (e.dueDate) {
        const mm = e.dueDate.slice(5, 7);
        for (const m of monthKeys) if (m.slice(5, 7) === mm) add(m, e.amount);
      } else {
        // No month set — spread evenly so the window total still reconciles.
        for (const m of monthKeys) add(m, e.amount / 12);
      }
    }
  }
  return out;
}

export interface MonthlyCoverage {
  month: string;
  income: number;
  expenses: number;
  /** income − expenses; negative = a shortfall that month. */
  net: number;
}

/** Per-month spendable income vs actual-month expenses across the window. */
export function monthlyCoverage(
  incomeByMonth: Map<string, number>,
  expenses: Expense[],
  monthKeys: string[],
): MonthlyCoverage[] {
  const exp = expensesByMonth(expenses, monthKeys);
  return monthKeys.map((month) => {
    const income = incomeByMonth.get(month) ?? 0;
    const expensesM = exp.get(month) ?? 0;
    return { month, income, expenses: expensesM, net: income - expensesM };
  });
}

/** Roughly how much MORE must be invested to add `monthlyAfterTax` of
 * spendable income, at the given after-tax yield-on-cost. null when the yield
 * is unknown/zero (can't translate). */
export function investedForMonthlyIncome(
  monthlyAfterTax: number,
  afterTaxYieldOnCost: number | null,
): number | null {
  if (!afterTaxYieldOnCost || afterTaxYieldOnCost <= 0) return null;
  return (monthlyAfterTax * 12) / afterTaxYieldOnCost;
}

/** Recorded expense payments (Phase 3) — the ACTUAL side of coverage. A
 * withdrawal tagged to an expense, with whether it drew on dividend income or
 * on principal. */
export interface ExpensePayment {
  accountId: string;
  date: string;
  amount: number;
  expenseId: string | null;
  fundedFrom: 'income' | 'principal' | null;
}

export interface PaymentsSummary {
  total: number;
  fromIncome: number;
  fromPrincipal: number;
  /** Withdrawn per expense id, for the ledger. */
  byExpense: Map<string, number>;
  count: number;
}

/** Sum tagged withdrawals over a period. `prefix` filters by date (a year
 * '2026' or a month '2026-08'); omit for all-time. Only rows carrying an
 * expense tag or a funded-from flag count as expense payments. */
export function paymentsSummary(
  events: ExpensePayment[],
  prefix?: string,
): PaymentsSummary {
  const rows = events.filter(
    (e) => (e.expenseId != null || e.fundedFrom != null) &&
      (!prefix || e.date.startsWith(prefix)),
  );
  const byExpense = new Map<string, number>();
  let fromIncome = 0;
  let fromPrincipal = 0;
  for (const e of rows) {
    if (e.expenseId) byExpense.set(e.expenseId, (byExpense.get(e.expenseId) ?? 0) + e.amount);
    if (e.fundedFrom === 'principal') fromPrincipal += e.amount;
    else fromIncome += e.amount; // null defaults to income (the aspiration)
  }
  return {
    total: fromIncome + fromPrincipal,
    fromIncome,
    fromPrincipal,
    byExpense,
    count: rows.length,
  };
}

/** Smart default for a new payment's funded-from: 'income' while accumulated
 * dividend cash still covers it, else 'principal'. `incomePool` is the
 * account's cash dividends received minus what prior income-funded
 * withdrawals already drew. */
export function fundedFromDefault(amount: number, incomePool: number): 'income' | 'principal' {
  return incomePool + 1e-9 >= amount ? 'income' : 'principal';
}

/** A position's income intent: the explicit flag wins; otherwise infer from
 * recent dividend history — a position whose recent payments mostly
 * reinvested defaults to 'reinvest', mostly-cash to 'spend', no history to
 * 'reinvest' (the growth default). A DRIP lot carries a reinvest price; a
 * cash dividend has none. */
export function incomeUseOf(
  position: Pick<ParkedPosition, 'incomeUse'>,
  lots: ParkedLot[],
  recentCount = 4,
): 'reinvest' | 'spend' {
  if (position.incomeUse) return position.incomeUse;
  const dividends = lots
    .filter((l) => l.source === 'dividend')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, recentCount);
  if (dividends.length === 0) return 'reinvest';
  const drip = dividends.filter((l) => l.price != null).length;
  return drip >= dividends.length - drip ? 'reinvest' : 'spend';
}

/** True when the explicit intent contradicts recent behavior — the nudge
 * ("you marked this spendable, but its dividends keep reinvesting"). */
export function incomeUseMismatch(
  position: Pick<ParkedPosition, 'incomeUse'>,
  lots: ParkedLot[],
): boolean {
  if (!position.incomeUse) return false;
  const inferred = incomeUseOf({ incomeUse: null }, lots);
  const dividends = lots.filter((l) => l.source === 'dividend');
  return dividends.length > 0 && inferred !== position.incomeUse;
}

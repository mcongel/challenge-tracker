import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import {
  coverageSnowball, incomeUseOf, isArchivedPosition, lotsByPositionId, parkedMarketValue,
  paymentsSummary, positionIncomeSummary,
} from './engine';
import type { CoverageSnowball, PaymentsSummary } from './engine';
import { todayISO } from './utils';

export interface Coverage {
  /** Average spendable after-tax income per month. */
  spendableMonthly: number;
  /** Average reinvesting (DRIP) after-tax income per month. */
  reinvestingMonthly: number;
  /** Spendable holdings' after-tax annual income ÷ their cost basis. */
  afterTaxYieldOnCost: number | null;
  /** Spendable after-tax income landing in each projected month. */
  spendableByMonth: Map<string, number>;
  /** Which spendable holdings pay in each month (for the chart drill-down). */
  spendablePayersByMonth: Map<string, { ticker: string; amount: number }[]>;
  /** The cheapest-first coverage snowball against the active expenses. */
  snapshot: CoverageSnowball;
  /** Actual expense payments this year (plan-vs-actual). */
  paymentsYtd: PaymentsSummary;
  /** How the invested capital is split by what it produces (market value). */
  capital: {
    spendableValue: number;
    reinvestValue: number;
    /** Live holdings paying no dividend — capital generating no income. */
    nonProducingValue: number;
    totalValue: number;
    /** The non-producers, biggest first, for the "which ones" answer. */
    nonProducers: { ticker: string; value: number }[];
  };
  /** True when there are dividends OR expenses to reason about. */
  hasAny: boolean;
}

/** The living-expenses coverage figures, computed once from context so the
 * Coverage page and the Dashboard tile agree. */
export function useCoverage(): Coverage {
  const {
    taxableParked: parked, parkedLots: allLots, parkedLotAdjustments, dividendTaxRates,
    expenses, parkedCashEvents,
  } = useData();
  const today = todayISO();

  return useMemo(() => {
    const pileIds = new Set(parked.map((p) => p.id));
    const parkedLots = allLots.filter((l) => pileIds.has(l.parkedPositionId));
    const lotsByPosition = lotsByPositionId(parkedLots);

    let spendableAnnual = 0;
    let reinvestAnnual = 0;
    let spendableBasis = 0;
    let spendableValue = 0;
    let reinvestValue = 0;
    let nonProducingValue = 0;
    const nonProducers: { ticker: string; value: number }[] = [];
    const spendableByMonth = new Map<string, number>();
    const spendablePayersByMonth = new Map<string, { ticker: string; amount: number }[]>();

    for (const p of parked) {
      if (isArchivedPosition(p)) continue;
      const lots = lotsByPosition.get(p.id) ?? [];
      const summary = positionIncomeSummary(p, lots, today, dividendTaxRates, parkedLotAdjustments);
      const proj = summary.projection;
      const mv = parkedMarketValue(p);
      if (!proj) {
        // Live holding paying no dividend — capital generating no income.
        nonProducingValue += mv;
        if (mv > 0) nonProducers.push({ ticker: p.ticker, value: mv });
        continue;
      }
      if (incomeUseOf(p, lots) !== 'spend') {
        reinvestAnnual += proj.annualAfterTax;
        reinvestValue += mv;
        continue;
      }
      spendableAnnual += proj.annualAfterTax;
      spendableBasis += summary.costBasis;
      spendableValue += mv;
      const atf = proj.annualGross > 0 ? proj.annualAfterTax / proj.annualGross : 1;
      for (const pt of proj.monthly) {
        if (pt.amount <= 0) continue;
        const after = pt.amount * atf;
        spendableByMonth.set(pt.month, (spendableByMonth.get(pt.month) ?? 0) + after);
        const list = spendablePayersByMonth.get(pt.month) ?? [];
        list.push({ ticker: p.ticker, amount: after });
        spendablePayersByMonth.set(pt.month, list);
      }
    }
    for (const list of spendablePayersByMonth.values()) list.sort((a, b) => b.amount - a.amount);

    const spendableMonthly = spendableAnnual / 12;
    const payments = parkedCashEvents
      .filter((e) => e.type === 'withdrawal')
      .map((e) => ({
        accountId: e.accountId, date: e.date, amount: e.amount,
        expenseId: e.expenseId ?? null, fundedFrom: e.fundedFrom ?? null,
      }));

    return {
      spendableMonthly,
      reinvestingMonthly: reinvestAnnual / 12,
      afterTaxYieldOnCost: spendableBasis > 0 ? spendableAnnual / spendableBasis : null,
      spendableByMonth,
      spendablePayersByMonth,
      snapshot: coverageSnowball(spendableMonthly, expenses),
      paymentsYtd: paymentsSummary(payments, today.slice(0, 4)),
      capital: {
        spendableValue,
        reinvestValue,
        nonProducingValue,
        totalValue: spendableValue + reinvestValue + nonProducingValue,
        nonProducers: nonProducers.sort((a, b) => b.value - a.value),
      },
      hasAny: expenses.length > 0 || spendableAnnual > 0 || reinvestAnnual > 0,
    };
  }, [parked, allLots, parkedLotAdjustments, dividendTaxRates, expenses, parkedCashEvents, today]);
}

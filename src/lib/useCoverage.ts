import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import {
  coverageSnowball, incomeUseOf, isArchivedPosition, isNeverTrimFuel, lotsByPositionId,
  parkedMarketValue, paymentsSummary, positionIncomeSummary,
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
    /** No-dividend holdings that AREN'T conviction holds — the capital you
     * could actually rotate into income. */
    idleValue: number;
    /** No-dividend conviction holds (BTC bucket + never-trim NVDA/TSLA/MSTR):
     * held on purpose, not candidates for rotation. */
    convictionValue: number;
    totalValue: number;
    /** The idle (rotatable) holdings, biggest first — the "which to rotate"
     * answer. Conviction holds are excluded. Alias of holdings.idle. */
    rotatable: { ticker: string; value: number }[];
    /** The holdings behind each bucket, biggest first — the drill-down. For
     * the two producing buckets `income` is the annual after-tax dividend. */
    holdings: {
      spend: CapitalHolding[];
      reinvest: CapitalHolding[];
      idle: CapitalHolding[];
      conviction: CapitalHolding[];
    };
  };
  /** True when there are dividends OR expenses to reason about. */
  hasAny: boolean;
}

/** One holding inside a capital bucket (drill-down row). */
export interface CapitalHolding {
  ticker: string;
  value: number;
  /** Annual after-tax dividend — only for the producing buckets. */
  income?: number;
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
    let idleValue = 0;
    let convictionValue = 0;
    const holdings = {
      spend: [] as CapitalHolding[],
      reinvest: [] as CapitalHolding[],
      idle: [] as CapitalHolding[],
      conviction: [] as CapitalHolding[],
    };
    const spendableByMonth = new Map<string, number>();
    const spendablePayersByMonth = new Map<string, { ticker: string; amount: number }[]>();

    for (const p of parked) {
      if (isArchivedPosition(p)) continue;
      const lots = lotsByPosition.get(p.id) ?? [];
      const summary = positionIncomeSummary(p, lots, today, dividendTaxRates, parkedLotAdjustments);
      const proj = summary.projection;
      const mv = parkedMarketValue(p);
      if (!proj) {
        // No dividend. Conviction holds (BTC bucket, never-trim names) are
        // held on purpose — not "idle capital to rotate"; everything else is.
        if (isNeverTrimFuel(p)) {
          convictionValue += mv;
          if (mv > 0) holdings.conviction.push({ ticker: p.ticker, value: mv });
        } else {
          idleValue += mv;
          if (mv > 0) holdings.idle.push({ ticker: p.ticker, value: mv });
        }
        continue;
      }
      if (incomeUseOf(p, lots) !== 'spend') {
        reinvestAnnual += proj.annualAfterTax;
        reinvestValue += mv;
        if (mv > 0) holdings.reinvest.push({ ticker: p.ticker, value: mv, income: proj.annualAfterTax });
        continue;
      }
      spendableAnnual += proj.annualAfterTax;
      spendableBasis += summary.costBasis;
      spendableValue += mv;
      if (mv > 0) holdings.spend.push({ ticker: p.ticker, value: mv, income: proj.annualAfterTax });
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
    for (const list of Object.values(holdings)) list.sort((a, b) => b.value - a.value);

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
        idleValue,
        convictionValue,
        totalValue: spendableValue + reinvestValue + idleValue + convictionValue,
        rotatable: holdings.idle,
        holdings,
      },
      hasAny: expenses.length > 0 || spendableAnnual > 0 || reinvestAnnual > 0,
    };
  }, [parked, allLots, parkedLotAdjustments, dividendTaxRates, expenses, parkedCashEvents, today]);
}

import type { Trade } from './types';
import { daysBetween, taxYearOf } from './dates';
import { sum } from './money';

export function realizedGain(t: Trade): number {
  return t.proceeds - t.costBasis;
}

export function realizedPct(t: Trade): number {
  return t.costBasis === 0 ? 0 : realizedGain(t) / t.costBasis;
}

export function tradeDaysHeld(t: Trade): number {
  return daysBetween(t.openDate, t.closeDate);
}

export function stLt(t: Trade): 'ST' | 'LT' {
  return tradeDaysHeld(t) > 365 ? 'LT' : 'ST';
}

export function tradeTaxYear(t: Trade): number {
  return taxYearOf(t.closeDate);
}

/** Net realized for a tax year, excluding wash-sale-disallowed losses. */
export function netRealizedYTD(trades: Trade[], year: number, asOf?: string): number {
  return sum(
    trades
      .filter(
        (t) =>
          tradeTaxYear(t) === year && !t.washSale && (asOf === undefined || t.closeDate <= asOf),
      )
      .map(realizedGain),
  );
}

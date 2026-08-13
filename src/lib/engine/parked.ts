import type { ParkedPosition } from './types';
import { daysBetween, longTermDate } from './dates';
import { sum } from './money';

/** Archived: fully trimmed/transferred away, kept for dividend history.
 * The single definition of "closed" — use this, not a raw epsilon. */
export const isArchivedPosition = (p: Pick<ParkedPosition, 'shares'>): boolean =>
  p.shares <= 1e-9;

export const DEFAULT_CONCENTRATION_CAP = 0.5;

/** Rule 5: NVDA, TSLA, and the MSTR/BTC conviction holds are never trim
 * fuel. One definition — the Sell guard and every "trim calendar" cue must
 * agree on it. */
export const NEVER_TRIM_TICKERS = new Set(['NVDA', 'TSLA', 'MSTR']);
export const isNeverTrimFuel = (p: Pick<ParkedPosition, 'ticker' | 'category'>): boolean =>
  NEVER_TRIM_TICKERS.has(p.ticker) || p.category === 'BTC';

/** Map an API industry string to a category SUGGESTION — never an
 * assignment. The categories are strategy buckets, not sectors: MSTR reads
 * "Software" to every data vendor but is BTC here, and "AI-adjacent" is a
 * thesis only the owner can hold. Suggest only the unambiguous cases. */
export function suggestCategory(
  industry: string | null | undefined,
): ParkedPosition['category'] | null {
  if (!industry) return null;
  if (/semiconductor/i.test(industry)) return 'Semi/AI';
  if (/bitcoin|crypto|blockchain/i.test(industry)) return 'BTC';
  return null;
}

export function parkedMarketValue(p: ParkedPosition): number {
  return p.shares * p.currentPrice;
}

export function parkedCostBasis(p: ParkedPosition): number {
  return p.shares * p.avgCost;
}

export function pileTotal(positions: ParkedPosition[]): number {
  return sum(positions.map(parkedMarketValue));
}

export type LtStatus =
  | { kind: 'UNLOCKED' }
  | { kind: 'COUNTDOWN'; daysLeft: number; unlockDate: string }
  | { kind: 'NO_BUY_DATE' };

/** "FUNDING UNLOCKED" once today ≥ buyDate + 366, else countdown. */
export function ltStatus(p: ParkedPosition, today: string): LtStatus {
  if (!p.buyDate) return { kind: 'NO_BUY_DATE' };
  const unlockDate = longTermDate(p.buyDate);
  const daysLeft = daysBetween(today, unlockDate);
  return daysLeft <= 0 ? { kind: 'UNLOCKED' } : { kind: 'COUNTDOWN', daysLeft, unlockDate };
}

export interface Concentration {
  total: number;
  semiValue: number;
  semiPlusAdjacentValue: number;
  semiPct: number;
  semiPlusAdjacentPct: number;
  overCap: boolean;
}

export function concentration(
  positions: ParkedPosition[],
  cap = DEFAULT_CONCENTRATION_CAP,
): Concentration {
  const total = pileTotal(positions);
  const semiValue = pileTotal(positions.filter((p) => p.category === 'Semi/AI'));
  const semiPlusAdjacentValue =
    semiValue + pileTotal(positions.filter((p) => p.category === 'AI-adjacent'));
  const semiPct = total === 0 ? 0 : semiValue / total;
  const semiPlusAdjacentPct = total === 0 ? 0 : semiPlusAdjacentValue / total;
  return {
    total,
    semiValue,
    semiPlusAdjacentValue,
    semiPct,
    semiPlusAdjacentPct,
    overCap: semiPct > cap,
  };
}

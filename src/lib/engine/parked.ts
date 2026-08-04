import type { ParkedPosition } from './types';
import { daysBetween, longTermDate } from './dates';
import { sum } from './money';

export const DEFAULT_CONCENTRATION_CAP = 0.5;

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

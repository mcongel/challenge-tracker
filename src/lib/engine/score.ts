import type { CashEvent, MilestoneRecord, PositionLot } from './types';
import { currentCash } from './cash';
import { cumulativeFloor } from './milestones';
import { marketValue } from './positions';
import { sum } from './money';

export type PriceMap = Record<string, number>;

/** Σ open lot market value + current cash — the workbook's account total. */
export function accountTotal(lots: PositionLot[], prices: PriceMap, events: CashEvent[]): number {
  return sum(lots.map((l) => marketValue(l, prices[l.ticker] ?? 0))) + currentCash(events);
}

/** Tax actually moved out of play: Σ TaxSkim cash events (all years). */
export function reservedTotal(events: CashEvent[]): number {
  return sum(events.filter((e) => e.type === 'TaxSkim').map((e) => e.amount));
}

/** The number that measures success: account + banked floors + tax reserved. */
export function totalScore(
  lots: PositionLot[],
  prices: PriceMap,
  events: CashEvent[],
  milestones: MilestoneRecord[],
): number {
  return accountTotal(lots, prices, events) + cumulativeFloor(milestones) + reservedTotal(events);
}

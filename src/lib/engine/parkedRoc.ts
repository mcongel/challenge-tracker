/** Return-of-capital basis adjustments for parked lots. An ROC distribution
 * reduces cost basis per share; each event's reductions are stored as rows
 * keyed to both the share lot and the dividend event, so the lot's original
 * amount is never touched and reversing an event is exact. Context only —
 * never score math. */

import { longTermDate } from './dates';
import { round6, sum } from './money';
import type { ParkedLot } from './parkedLots';

export interface ParkedLotAdjustment {
  id: string;
  shareLotId: string;
  /** null = carried over by an ACATS transfer, not tied to a dividend event. */
  dividendLotId: string | null;
  /** Basis reduction in dollars, ≥ 0, 6dp. */
  amount: number;
  createdAt?: string | null;
}

/** Original amount minus this lot's accumulated reductions, floored at 0
 * (guards rounding drift — basis never goes negative). */
export function adjustedLotAmount(lot: ParkedLot, adjustments: ParkedLotAdjustment[]): number {
  const reduced = sum(adjustments.filter((a) => a.shareLotId === lot.id).map((a) => a.amount));
  return Math.max(0, lot.amount - reduced);
}

export interface RocAllocation {
  /** New adjustment rows to insert. Allocated per share across eligible lots
   * (held at the event date), capped per lot at remaining adjusted basis. */
  allocations: { shareLotId: string; amount: number }[];
  /** Allocation beyond a lot's remaining basis — that lot's estimated capital
   * gain, NOT redistributed to other lots (per-share treatment). Term from
   * the lot's age at the event date; undated lots or events → unknown. */
  overflow: { total: number; ltAmount: number; stAmount: number; unknownAmount: number };
}

/**
 * Allocate one ROC event across the position's share lots, per share:
 * eligible lots are share-bearing lots dated on/before the event (null dates
 * on either side are treated as eligible/unknowable), each receives
 * perShare × shares capped at its remaining adjusted basis; the capped
 * excess is that lot's overflow. Zero eligible lots → the whole event is
 * overflow with unknown term.
 */
export function allocateRoc(
  shareLots: ParkedLot[],
  existingAdjustments: ParkedLotAdjustment[],
  event: { amount: number; date: string | null; excludeLotId?: string },
): RocAllocation {
  const eligible = shareLots.filter(
    (l) =>
      l.shares > 0 &&
      l.id !== event.excludeLotId &&
      (l.date === null || event.date === null || l.date <= event.date),
  );
  const totalShares = sum(eligible.map((l) => l.shares));
  const overflow = { total: 0, ltAmount: 0, stAmount: 0, unknownAmount: 0 };
  if (event.amount <= 0) return { allocations: [], overflow };
  if (totalShares <= 0) {
    overflow.total = event.amount;
    overflow.unknownAmount = event.amount;
    return { allocations: [], overflow };
  }
  const perShare = event.amount / totalShares;
  const allocations: RocAllocation['allocations'] = [];
  for (const lot of eligible) {
    const allocated = perShare * lot.shares;
    const remaining = adjustedLotAmount(lot, existingAdjustments);
    const applied = round6(Math.min(allocated, remaining));
    if (applied > 0) allocations.push({ shareLotId: lot.id, amount: applied });
    const over = allocated - applied;
    if (over > 1e-9) {
      overflow.total += over;
      if (lot.date === null || event.date === null) overflow.unknownAmount += over;
      else if (longTermDate(lot.date) <= event.date) overflow.ltAmount += over;
      else overflow.stAmount += over;
    }
  }
  overflow.total = round6(overflow.total);
  overflow.ltAmount = round6(overflow.ltAmount);
  overflow.stAmount = round6(overflow.stAmount);
  overflow.unknownAmount = round6(overflow.unknownAmount);
  return { allocations, overflow };
}

/** Position aggregate with both basis views: original (yield-on-cost,
 * display) and ROC-adjusted (tax truth). avgCost stays original. */
export function aggregateLotsAdjusted(lots: ParkedLot[], adjustments: ParkedLotAdjustment[]) {
  const shareLots = lots.filter((l) => l.shares > 0);
  const shares = sum(shareLots.map((l) => l.shares));
  const costBasis = sum(shareLots.map((l) => l.amount));
  const adjustedCostBasis = sum(shareLots.map((l) => adjustedLotAmount(l, adjustments)));
  return { shares, costBasis, adjustedCostBasis, avgCost: shares > 0 ? costBasis / shares : 0 };
}

/** Derived event overflow: dividend amount − Σ its adjustment rows. Only
 * meaningful when the dividend's rocAllocatedAt is set (otherwise the event
 * simply hasn't been allocated yet). */
export function overflowForDividend(
  dividendLot: ParkedLot,
  adjustments: ParkedLotAdjustment[],
): number {
  const applied = sum(
    adjustments.filter((a) => a.dividendLotId === dividendLot.id).map((a) => a.amount),
  );
  return Math.max(0, dividendLot.amount - applied);
}

/** Share lots whose basis has been fully consumed by ROC — further ROC on
 * them is capital gain. Flagged in the UI. */
export function basisExhaustedLotIds(
  lots: ParkedLot[],
  adjustments: ParkedLotAdjustment[],
): string[] {
  return lots
    .filter((l) => l.shares > 0 && l.amount > 0 && adjustedLotAmount(l, adjustments) <= 1e-6)
    .map((l) => l.id);
}

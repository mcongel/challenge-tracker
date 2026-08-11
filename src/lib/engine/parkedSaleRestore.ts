/** Reversible parked-pile sales. `buildSaleSnapshot` records, at sale time,
 * exactly what the sale consumed — position metadata, per-lot pre-sale
 * absolutes AND removed deltas, and per-ROC-event adjustment detail.
 * `planSaleRestore` turns a snapshot plus FRESH current state into a
 * converging plan: absolutes when nothing else intervened, deltas when
 * something did, original-id upserts for anything that vanished — so a
 * retried undo is a no-op for whatever already restored. Context only,
 * never score math; undo never touches the challenge ledger. */

import { round6, roundCents } from './money';
import { classificationOf } from './parkedIncome';
import { isArchivedPosition } from './parked';
import type { LotConsumption, ParkedLot } from './parkedLots';
import type { ParkedLotAdjustment } from './parkedRoc';
import type { ParkedSale, ParkedSaleSnapshot, ParkedPosition, SaleSnapshotSlice } from './types';

const SHARES_TOL = 1e-6;
const AMOUNT_TOL = 0.01;

export function buildSaleSnapshot(
  position: ParkedPosition,
  preLots: ParkedLot[],
  preAdjustments: ParkedLotAdjustment[],
  consumption: LotConsumption,
  /** recordTrim's DRIP split — passed in so the two can't diverge. */
  dripZeroedLotIds: string[],
  /** Stamp lookup for dividends outside this position (post-transfer carried
   * rows). Missing lookups store null — the restore gate then re-allocates,
   * which is safe because allocation is idempotent. */
  dividendStampOf?: (dividendLotId: string) => string | null | undefined,
): ParkedSaleSnapshot {
  const lotById = new Map(preLots.map((l) => [l.id, l]));
  const zeroed = new Set(dripZeroedLotIds);
  const deleted = new Set(consumption.deletes);
  const stampOf = (id: string): string | null => {
    const local = lotById.get(id)?.rocAllocatedAt;
    if (local !== undefined) return local ?? null;
    return dividendStampOf?.(id) ?? null;
  };

  const slices: SaleSnapshotSlice[] = consumption.consumed.map((c) => {
    const lot = lotById.get(c.id);
    if (!lot) throw new Error(`Snapshot: consumed lot ${c.id} missing from pre-sale lots`);
    const mode: SaleSnapshotSlice['mode'] = zeroed.has(c.id)
      ? 'zeroed'
      : deleted.has(c.id)
        ? 'deleted'
        : 'shrunk';
    const keptFraction = mode === 'shrunk' ? (lot.shares - c.shares) / lot.shares : 0;
    return {
      lotId: c.id,
      mode,
      preShares: lot.shares,
      preAmount: lot.amount,
      sharesDelta: c.shares,
      amountDelta: mode === 'zeroed' ? 0 : c.amount,
      date: lot.date,
      source: lot.source,
      price: lot.price ?? null,
      classification: lot.classification ?? null,
      exDate: lot.exDate ?? null,
      reclassifiedAt: lot.reclassifiedAt ?? null,
      rocAllocatedAt: lot.rocAllocatedAt ?? null,
      rocOverflow: lot.rocOverflow ?? null,
      notes: lot.notes ?? null,
      adjustments: preAdjustments
        .filter((a) => a.shareLotId === c.id)
        .map((a) => ({
          id: a.id,
          dividendLotId: a.dividendLotId,
          preAmount: a.amount,
          amountDelta:
            mode === 'zeroed'
              ? 0
              : mode === 'deleted'
                ? a.amount
                : round6(a.amount - round6(a.amount * keptFraction)),
          deleted: mode === 'deleted',
          dividendRocAllocatedAt: a.dividendLotId ? stampOf(a.dividendLotId) : null,
        })),
    };
  });

  return {
    version: 1,
    positionId: position.id,
    position: {
      category: position.category,
      avgCost: position.avgCost,
      currentPrice: position.currentPrice,
      trimRank: position.trimRank ?? null,
      dividendRate: position.dividendRate ?? null,
      dividendFrequency: position.dividendFrequency ?? null,
      notes: position.notes ?? null,
    },
    slices,
  };
}

export interface SaleRestorePlan {
  /** Recreate the position row (original id) when a full trim deleted it. */
  recreatePosition: {
    id: string;
    ticker: string;
    accountId: string;
  } | null;
  /** Archived position being revived: refresh its frozen price. */
  revivePrice: number | null;
  /** Vanished lots, recreated with ORIGINAL ids (idempotent on retry). */
  lotUpserts: {
    id: string;
    parkedPositionId: string;
    date: string | null;
    source: 'purchase' | 'dividend';
    shares: number;
    price: number | null;
    amount: number;
    classification: string | null;
    exDate: string | null;
    reclassifiedAt: string | null;
    rocAllocatedAt: string | null;
    rocOverflow: number | null;
    notes: string | null;
  }[];
  /** Absolute targets for surviving lots. */
  lotSets: { id: string; shares: number; amount: number }[];
  adjustmentUpserts: {
    id: string;
    shareLotId: string;
    dividendLotId: string | null;
    amount: number;
  }[];
  adjustmentSets: { id: string; amount: number }[];
  /** ROC events to re-run (idempotent allocation), oldest first. */
  reallocate: { id: string; parkedPositionId: string; amount: number; date: string | null }[];
  skipped: { dividendLotId: string | null; reason: 'event-removed' | 'event-reallocated' }[];
}

/** Field-level three-branch convergence: already restored → null (no-op);
 * exactly as the sale left it → absolute pre; something else intervened →
 * current + delta (the sale's slice is the exact counterfactual). */
function converge(
  current: number,
  pre: number,
  delta: number,
  tol: number,
): number | null {
  if (Math.abs(current - pre) <= tol) return null;
  if (Math.abs(current - (pre - delta)) <= tol) return pre;
  return current + delta;
}

export function planSaleRestore(
  sale: ParkedSale,
  snapshot: ParkedSaleSnapshot,
  current: {
    position: ParkedPosition | null;
    /** Fresh: the position's lots plus any snapshot-referenced lots. */
    lots: ParkedLot[];
    /** Fresh: adjustments for those lots plus snapshot-referenced row ids. */
    adjustments: ParkedLotAdjustment[];
    /** Fresh lookups for event gates — may span positions (carried rows). */
    dividendLots: ParkedLot[];
  },
): SaleRestorePlan {
  const plan: SaleRestorePlan = {
    recreatePosition: current.position
      ? null
      : { id: snapshot.positionId, ticker: sale.ticker, accountId: sale.accountId },
    revivePrice:
      current.position && isArchivedPosition(current.position)
        ? snapshot.position.currentPrice
        : null,
    lotUpserts: [],
    lotSets: [],
    adjustmentUpserts: [],
    adjustmentSets: [],
    reallocate: [],
    skipped: [],
  };
  const lotById = new Map(current.lots.map((l) => [l.id, l]));
  const adjById = new Map(current.adjustments.map((a) => [a.id, a]));
  const divById = new Map(current.dividendLots.map((l) => [l.id, l]));
  const reallocateIds = new Set<string>();
  const queueReallocate = (div: ParkedLot) => {
    if (reallocateIds.has(div.id)) return;
    reallocateIds.add(div.id);
    plan.reallocate.push({
      id: div.id,
      parkedPositionId: div.parkedPositionId,
      amount: div.amount,
      date: div.date,
    });
  };

  for (const slice of snapshot.slices) {
    const cur = lotById.get(slice.lotId);
    if (!cur) {
      // The lot vanished (this sale deleted it, or something later did).
      // Recreate the slice with its original id. A 'zeroed' slice's amount
      // was never sale-consumed, so it comes back whole.
      plan.lotUpserts.push({
        id: slice.lotId,
        parkedPositionId: snapshot.positionId,
        date: slice.date,
        source: slice.source,
        shares: slice.sharesDelta,
        price: slice.price,
        amount: slice.mode === 'zeroed' ? slice.preAmount : slice.amountDelta,
        classification: slice.classification,
        exDate: slice.exDate,
        reclassifiedAt: slice.reclassifiedAt,
        rocAllocatedAt: slice.rocAllocatedAt,
        rocOverflow: slice.rocOverflow,
        notes: slice.notes,
      });
    } else {
      const sharesTarget = converge(cur.shares, slice.preShares, slice.sharesDelta, SHARES_TOL);
      const amountTarget = converge(cur.amount, slice.preAmount, slice.amountDelta, AMOUNT_TOL);
      if (sharesTarget !== null || amountTarget !== null) {
        plan.lotSets.push({
          id: slice.lotId,
          shares: sharesTarget ?? cur.shares,
          amount: roundCents(amountTarget ?? cur.amount),
        });
      }
    }

    for (const entry of slice.adjustments) {
      if (entry.dividendLotId) {
        const div = divById.get(entry.dividendLotId);
        if (!div || classificationOf(div) !== 'return_of_capital') {
          // The event's reductions were legitimately reversed everywhere —
          // had the sale never happened, this row would be gone too.
          plan.skipped.push({ dividendLotId: entry.dividendLotId, reason: 'event-removed' });
          continue;
        }
        if ((div.rocAllocatedAt ?? null) !== (entry.dividendRocAllocatedAt ?? null)) {
          // Re-allocated since the sale: restoring the old portion would
          // double-reduce. Re-run the whole event over the restored lots.
          plan.skipped.push({ dividendLotId: entry.dividendLotId, reason: 'event-reallocated' });
          queueReallocate(div);
          continue;
        }
      }
      const curRow = adjById.get(entry.id);
      if (!curRow) {
        plan.adjustmentUpserts.push({
          id: entry.id,
          shareLotId: slice.lotId,
          dividendLotId: entry.dividendLotId,
          amount: entry.amountDelta > 0 ? entry.amountDelta : entry.preAmount,
        });
      } else {
        const target = converge(curRow.amount, entry.preAmount, entry.amountDelta, AMOUNT_TOL);
        if (target !== null) plan.adjustmentSets.push({ id: entry.id, amount: round6(target) });
      }
    }
  }

  // ROC events allocated AFTER the sale spread over post-sale lots — re-run
  // them over the restored basis so the whole position converges.
  if (sale.createdAt) {
    for (const div of current.dividendLots) {
      if (
        div.parkedPositionId === snapshot.positionId &&
        classificationOf(div) === 'return_of_capital' &&
        div.rocAllocatedAt &&
        div.rocAllocatedAt > sale.createdAt
      ) {
        queueReallocate(div);
      }
    }
  }
  plan.reallocate.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  return plan;
}

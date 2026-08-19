import { longTermDate } from './dates';
import { round6, roundCents, sum } from './money';
import { spentCash } from './parkedCash';
import type { ParkedLotAdjustment } from './parkedRoc';

/** Tax character of a dividend. Brokers reclassify after the 1099, so lots
 * start 'unclassified' until confirmed. */
export type DividendClassification =
  | 'qualified'
  | 'ordinary'
  | 'return_of_capital'
  | 'capital_gain_dist'
  | 'unclassified';

/** One dated slice of a parked position — a purchase or a dividend. Reinvested
 * dividends carry shares (their own 366-day clock); cash dividends carry only
 * the amount. Context only, never score math. */
export interface ParkedLot {
  id: string;
  parkedPositionId: string;
  /** null = date unknown (backfilled seed); treated as oldest for FIFO. */
  date: string | null;
  source: 'purchase' | 'dividend';
  shares: number;
  price?: number | null;
  /** Cost basis added (purchases, reinvested dividends) or cash received. */
  amount: number;
  /** Dividend lots only; null on purchases. Treat null-on-dividend as 'unclassified'. */
  classification?: DividendClassification | null;
  exDate?: string | null;
  /** Set when a broker 1099 reclassified this dividend after entry. */
  reclassifiedAt?: string | null;
  /** ROC dividends only: set when basis allocation ran (null = not yet
   * allocated; set with zero adjustment rows = basis was already exhausted). */
  rocAllocatedAt?: string | null;
  /** ROC dividends only: the beyond-basis excess recorded AT allocation time
   * (estimated capital gain). Never derived from adjustment rows — trims and
   * transfers legitimately scale or cascade those away. */
  rocOverflow?: number | null;
  /** How the shares arrived: purchase spent this account's cash; transfer
   * (ACATS) and milestone (challenge money) did not. null/undefined = legacy
   * row — spentCash falls back to the notes prefix. */
  origin?: 'purchase' | 'transfer' | 'milestone' | null;
  notes?: string | null;
}

export interface UnlockSummary {
  totalShares: number;
  /** Shares held > 365 days — legitimate Rule 5 trim fuel. */
  unlockedShares: number;
  /** Shares whose lot has no date — can't prove long-term. */
  unknownShares: number;
  nextUnlock: { date: string; shares: number } | null;
}

export function unlockSummary(lots: ParkedLot[], today: string): UnlockSummary {
  let unlocked = 0;
  let unknown = 0;
  let total = 0;
  const future = new Map<string, number>();
  for (const lot of lots) {
    if (lot.shares <= 0) continue;
    total += lot.shares;
    if (!lot.date) {
      unknown += lot.shares;
    } else {
      const unlockDate = longTermDate(lot.date);
      if (unlockDate <= today) unlocked += lot.shares;
      else future.set(unlockDate, (future.get(unlockDate) ?? 0) + lot.shares);
    }
  }
  const next = [...future.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
  return {
    totalShares: total,
    unlockedShares: unlocked,
    unknownShares: unknown,
    nextUnlock: next ? { date: next[0], shares: next[1] } : null,
  };
}

/** Position aggregate from its lots. Cash dividends (shares = 0) add income,
 * not basis; reinvested dividends add both shares and basis. */
export function aggregateLots(lots: ParkedLot[]) {
  const shareLots = lots.filter((l) => l.shares > 0);
  const shares = sum(shareLots.map((l) => l.shares));
  const costBasis = sum(shareLots.map((l) => l.amount));
  return { shares, costBasis, avgCost: shares > 0 ? costBasis / shares : 0 };
}

export function dividendsCollected(lots: ParkedLot[]): number {
  return sum(lots.filter((l) => l.source === 'dividend').map((l) => l.amount));
}

/** Lots grouped by position id — previously hand-rolled (four different
 * ways) on every page that renders lot detail. */
export function lotsByPositionId(lots: ParkedLot[]): Map<string, ParkedLot[]> {
  const m = new Map<string, ParkedLot[]>();
  for (const l of lots) {
    const list = m.get(l.parkedPositionId);
    if (list) list.push(l);
    else m.set(l.parkedPositionId, [l]);
  }
  return m;
}

export interface LotConsumption {
  updates: { id: string; shares: number; amount: number }[];
  deletes: string[];
  /** deletes, partitioned by source. DRIP dividend lots double as income
   * records — recordTrim keeps them at zero shares instead of deleting, so
   * trailing income and the YTD tax estimate don't shrink retroactively. */
  dripDeletes: string[];
  hardDeletes: string[];
  /** RAW cash-spending purchase basis this consumption removes from the lots
   * (spentCash predicate — ACATS/milestone lots never brought cash in). The
   * account-cash math adds it back so the original purchase stays spent.
   * Computed HERE so it can't diverge from what was actually consumed. */
  cashSpendingBasisConsumed: number;
  /** Scale surviving ROC-adjustment rows on partially consumed lots (amount ×
   * remaining fraction). Fully consumed lots need nothing — the FK cascade
   * removes their rows with the lot. */
  adjustmentUpdates: { id: string; amount: number }[];
  /** What was taken, lot by lot — carries basis, dates, and origin (so a
   * transfer can recreate DRIP slivers as DRIP slivers). */
  consumed: {
    id: string;
    date: string | null;
    source: 'purchase' | 'dividend';
    shares: number;
    amount: number;
    /** amount minus the consumed slice of this lot's ROC adjustments —
     * the basis a sale is actually taxed against. */
    adjustedAmount: number;
  }[];
}

/** Consume shares oldest-first (unknown dates count as oldest — they're the
 * original purchases). A partially consumed lot keeps proportional basis,
 * and its ROC adjustments shrink by the same share fraction. */
export function consumeLotsFifo(
  lots: ParkedLot[],
  sharesToSell: number,
  adjustments: ParkedLotAdjustment[] = [],
): LotConsumption {
  const ordered = [...lots]
    .filter((l) => l.shares > 0)
    .sort((a, b) => {
      if (a.date === null && b.date === null) return 0;
      if (a.date === null) return -1;
      if (b.date === null) return 1;
      return a.date.localeCompare(b.date);
    });
  const available = sum(ordered.map((l) => l.shares));
  if (sharesToSell > available + 1e-9) {
    throw new Error(`Cannot consume ${sharesToSell} shares; only ${available} in lots`);
  }
  const updates: LotConsumption['updates'] = [];
  const deletes: string[] = [];
  const dripDeletes: string[] = [];
  const hardDeletes: string[] = [];
  const adjustmentUpdates: LotConsumption['adjustmentUpdates'] = [];
  const consumed: LotConsumption['consumed'] = [];
  let cashSpendingBasisConsumed = 0;
  let remaining = sharesToSell;
  for (const lot of ordered) {
    if (remaining <= 1e-9) break;
    const lotAdjs = adjustments.filter((a) => a.shareLotId === lot.id);
    const lotAdjTotal = sum(lotAdjs.map((a) => a.amount));
    const take = Math.min(lot.shares, remaining);
    remaining -= take;
    const left = lot.shares - take;
    if (left > 1e-9) {
      const keptFraction = left / lot.shares;
      const keptAmount = roundCents(lot.amount * keptFraction);
      const consumedAmount = roundCents(lot.amount - keptAmount);
      const consumedAdj = lotAdjTotal * (take / lot.shares);
      updates.push({ id: lot.id, shares: left, amount: keptAmount });
      for (const a of lotAdjs) {
        adjustmentUpdates.push({ id: a.id, amount: round6(a.amount * keptFraction) });
      }
      if (lot.source === 'purchase' && spentCash(lot)) cashSpendingBasisConsumed += consumedAmount;
      consumed.push({
        id: lot.id,
        date: lot.date,
        source: lot.source,
        shares: take,
        amount: consumedAmount,
        adjustedAmount: Math.max(0, round6(consumedAmount - consumedAdj)),
      });
    } else {
      deletes.push(lot.id);
      (lot.source === 'dividend' ? dripDeletes : hardDeletes).push(lot.id);
      if (lot.source === 'purchase' && spentCash(lot)) cashSpendingBasisConsumed += lot.amount;
      consumed.push({
        id: lot.id,
        date: lot.date,
        source: lot.source,
        shares: lot.shares,
        amount: lot.amount,
        adjustedAmount: Math.max(0, round6(lot.amount - lotAdjTotal)),
      });
    }
  }
  return { updates, deletes, dripDeletes, hardDeletes, adjustmentUpdates, consumed, cashSpendingBasisConsumed };
}

export interface TrimPreview {
  proceeds: number;
  /** Original basis of the consumed slices (yield-on-cost, display). */
  costBasis: number;
  /** ROC-adjusted basis of the consumed slices — the tax truth. */
  adjustedCostBasis: number;
  /** proceeds − adjustedCostBasis: what a sale actually realizes for tax. */
  gain: number;
  /** Shares long-term at the sale date (legit Rule 5 fuel). */
  ltShares: number;
  stShares: number;
  unknownShares: number;
}

/** What a sale would realize, from the lots it would actually consume. */
export function trimPreview(
  lots: ParkedLot[],
  sharesToSell: number,
  pricePerShare: number,
  saleDate: string,
  adjustments: ParkedLotAdjustment[] = [],
): TrimPreview {
  const { consumed } = consumeLotsFifo(lots, sharesToSell, adjustments);
  const costBasis = sum(consumed.map((c) => c.amount));
  const adjustedCostBasis = sum(consumed.map((c) => c.adjustedAmount));
  const proceeds = sharesToSell * pricePerShare;
  let ltShares = 0;
  let stShares = 0;
  let unknownShares = 0;
  for (const c of consumed) {
    if (!c.date) unknownShares += c.shares;
    else if (longTermDate(c.date) <= saleDate) ltShares += c.shares;
    else stShares += c.shares;
  }
  return {
    proceeds,
    costBasis,
    adjustedCostBasis,
    gain: proceeds - adjustedCostBasis,
    ltShares,
    stShares,
    unknownShares,
  };
}

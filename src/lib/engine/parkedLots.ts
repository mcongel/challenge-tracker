import { longTermDate } from './dates';
import { sum } from './money';

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

export interface LotConsumption {
  updates: { id: string; shares: number; amount: number }[];
  deletes: string[];
}

/** Consume shares oldest-first (unknown dates count as oldest — they're the
 * original purchases). A partially consumed lot keeps proportional basis. */
export function consumeLotsFifo(lots: ParkedLot[], sharesToSell: number): LotConsumption {
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
  let remaining = sharesToSell;
  for (const lot of ordered) {
    if (remaining <= 1e-9) break;
    const take = Math.min(lot.shares, remaining);
    remaining -= take;
    const left = lot.shares - take;
    if (left > 1e-9) {
      updates.push({
        id: lot.id,
        shares: left,
        amount: Math.round(lot.amount * (left / lot.shares) * 100) / 100,
      });
    } else {
      deletes.push(lot.id);
    }
  }
  return { updates, deletes };
}

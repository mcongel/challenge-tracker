import type { PositionLot, Trade } from './types';
import { daysBetween } from './dates';

export function costBasis(lot: Pick<PositionLot, 'shares' | 'avgCost'>): number {
  return lot.shares * lot.avgCost;
}

export function marketValue(lot: Pick<PositionLot, 'shares'>, currentPrice: number): number {
  return lot.shares * currentPrice;
}

export function unrealized(lot: PositionLot, currentPrice: number): number {
  return marketValue(lot, currentPrice) - costBasis(lot);
}

export function unrealizedPct(lot: PositionLot, currentPrice: number): number {
  const basis = costBasis(lot);
  return basis === 0 ? 0 : unrealized(lot, currentPrice) / basis;
}

export function daysHeld(lot: PositionLot, today: string): number {
  return daysBetween(lot.buyDate, today);
}

export type PendingTrade = Omit<Trade, 'id' | 'washSale' | 'notes'>;

export interface CloseAllocation {
  lotId: string;
  shares: number;
}

export interface CloseResult {
  /** One trade per lot consumed, proportional basis, openDate = lot's buyDate. */
  trades: PendingTrade[];
  remainingLots: PositionLot[];
  totalProceeds: number;
}

/**
 * Close shares of a ticker across its lots. Defaults to FIFO (oldest buyDate
 * first); pass explicit allocations to override per lot. A partially consumed
 * lot keeps its original buyDate on the remainder.
 */
export function closeShares(
  lots: PositionLot[],
  ticker: string,
  sharesToClose: number,
  pricePerShare: number,
  closeDate: string,
  allocations?: CloseAllocation[],
): CloseResult {
  const tickerLots = lots
    .filter((l) => l.ticker === ticker)
    .sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  const otherLots = lots.filter((l) => l.ticker !== ticker);

  const available = tickerLots.reduce((acc, l) => acc + l.shares, 0);
  if (sharesToClose <= 0) throw new Error('sharesToClose must be positive');
  if (sharesToClose > available + 1e-9) {
    throw new Error(`Cannot close ${sharesToClose} shares of ${ticker}; only ${available} open`);
  }

  const takeFrom = new Map<string, number>();
  if (allocations) {
    let allocated = 0;
    for (const a of allocations) {
      const lot = tickerLots.find((l) => l.id === a.lotId);
      if (!lot) throw new Error(`Allocation references unknown lot ${a.lotId}`);
      if (a.shares > lot.shares + 1e-9) {
        throw new Error(`Allocation takes ${a.shares} from lot ${a.lotId} holding ${lot.shares}`);
      }
      takeFrom.set(a.lotId, a.shares);
      allocated += a.shares;
    }
    if (Math.abs(allocated - sharesToClose) > 1e-9) {
      throw new Error(`Allocations total ${allocated}, expected ${sharesToClose}`);
    }
  } else {
    let remaining = sharesToClose;
    for (const lot of tickerLots) {
      if (remaining <= 1e-9) break;
      const take = Math.min(lot.shares, remaining);
      takeFrom.set(lot.id, take);
      remaining -= take;
    }
  }

  const trades: PendingTrade[] = [];
  const remainingTickerLots: PositionLot[] = [];
  for (const lot of tickerLots) {
    const take = takeFrom.get(lot.id) ?? 0;
    if (take > 0) {
      trades.push({
        ticker,
        openDate: lot.buyDate,
        closeDate,
        costBasis: take * lot.avgCost,
        proceeds: take * pricePerShare,
      });
    }
    const left = lot.shares - take;
    if (left > 1e-9) {
      remainingTickerLots.push({ ...lot, shares: left });
    }
  }

  return {
    trades,
    remainingLots: [...otherLots, ...remainingTickerLots],
    totalProceeds: sharesToClose * pricePerShare,
  };
}

/** Manual split recording: shares × ratio, avgCost ÷ ratio, across a ticker's lots. */
export function applySplit(lots: PositionLot[], ticker: string, ratio: number): PositionLot[] {
  if (ratio <= 0) throw new Error('Split ratio must be positive');
  return lots.map((l) =>
    l.ticker === ticker ? { ...l, shares: l.shares * ratio, avgCost: l.avgCost / ratio } : l,
  );
}

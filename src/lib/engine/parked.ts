import type { ParkedPosition } from './types';
import { daysBetween, longTermDate } from './dates';
import { sum } from './money';
import { lookThroughSemiValue } from './fundLookThrough';

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

/** Default category from the vendor industry — the sector itself, with
 * crypto normalized into the BTC bucket and the cap category name pinned.
 * A DEFAULT, never an override: the owner's thesis edits (NBIS as
 * 'Semiconductors', MSTR as 'BTC') always win. */
export function suggestCategory(
  industry: string | null | undefined,
): ParkedPosition['category'] | null {
  if (!industry) return null;
  if (/semiconductor/i.test(industry)) return 'Semiconductors';
  if (/bitcoin|crypto|blockchain/i.test(industry)) return 'BTC';
  return industry;
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

/** The category that carries the concentration cap. Edge cases (NBIS-style
 * semi-correlated names) are curated INTO it by hand — the cap is a risk
 * bucket, and vendor labels are only its default. */
export const SEMI_CATEGORY = 'Semiconductors';
/** The bitcoin conviction bucket — also the never-trim marker. */
export const BTC_CATEGORY = 'BTC';

export interface Concentration {
  total: number;
  /** Cap-bearing semiconductor value: positions categorized 'Semiconductors'
   * at full value PLUS the semi slice hiding inside broad ETFs (look-through). */
  semiValue: number;
  semiPct: number;
  /** Semi value from directly-categorized positions only. */
  directSemiValue: number;
  /** Semi value contributed by ETF look-through — the previously-hidden part. */
  lookThroughSemiValue: number;
  /** Value share per category, for the mix display. */
  byCategory: Record<string, number>;
  overCap: boolean;
}

export function concentration(
  positions: ParkedPosition[],
  cap = DEFAULT_CONCENTRATION_CAP,
): Concentration {
  const total = pileTotal(positions);
  const directSemiValue = pileTotal(positions.filter((p) => p.category === SEMI_CATEGORY));
  // Hidden semi exposure inside broad ETFs — a total-market or AI fund adds to
  // real concentration even when its own category isn't 'Semiconductors'.
  const lookThrough = sum(
    positions.map((p) =>
      lookThroughSemiValue(p.ticker, p.category, parkedMarketValue(p), SEMI_CATEGORY),
    ),
  );
  const semiValue = directSemiValue + lookThrough;
  const semiPct = total === 0 ? 0 : semiValue / total;
  const byCategory: Record<string, number> = {};
  for (const p of positions) {
    byCategory[p.category] = (byCategory[p.category] ?? 0) + parkedMarketValue(p);
  }
  return {
    total,
    semiValue,
    semiPct,
    directSemiValue,
    lookThroughSemiValue: lookThrough,
    byCategory,
    overCap: semiPct > cap,
  };
}

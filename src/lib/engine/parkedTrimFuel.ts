/** The funding answer, as engine math: which pile holdings have long-term
 * (Rule 5) shares ready NOW, worth how much, at what est. tax — ordered by
 * the plan (trim rank), then double-duty semis when over the cap, then size.
 * Never-trim holds are excluded by definition. Extracted from the ParkedPile
 * page so the ordering strategy is testable. */

import { isNeverTrimFuel, SEMI_CATEGORY } from './parked';
import type { ParkedLot } from './parkedLots';
import { trimPreview, unlockSummary } from './parkedLots';
import type { ParkedLotAdjustment } from './parkedRoc';
import { adjustmentsForLots } from './parkedRoc';
import { estimatedPileTax } from './pileTax';
import type { ParkedPosition } from './types';

export interface TrimFuelRow {
  p: ParkedPosition;
  unlockedShares: number;
  readyValue: number;
  /** ROC-adjusted gain of trimming exactly the unlocked shares; null when
   * the preview couldn't run (no lots, or over-consume edge). */
  gain: number | null;
  estTax: number | null;
}

export function trimFuelRows(args: {
  /** Live pile positions (archived and retirement already excluded). */
  parked: ParkedPosition[];
  lotsByPosition: Map<string, ParkedLot[]>;
  adjustments: ParkedLotAdjustment[];
  today: string;
  ltRate: number;
  stRate: number;
  /** Semis over the concentration cap? Double-duty trims jump the size order. */
  overCap: boolean;
}): TrimFuelRow[] {
  const { parked, lotsByPosition, adjustments, today, ltRate, stRate, overCap } = args;
  return parked
    .filter((p) => !isNeverTrimFuel(p))
    .map((p) => {
      const lots = lotsByPosition.get(p.id) ?? [];
      const summ = unlockSummary(lots, today);
      if (summ.unlockedShares <= 1e-9) return null;
      const readyValue = summ.unlockedShares * p.currentPrice;
      let gain: number | null = null;
      let estTax: number | null = null;
      if (lots.length > 0) {
        try {
          const prev = trimPreview(
            lots, summ.unlockedShares, p.currentPrice, today,
            adjustmentsForLots(lots, adjustments),
          );
          gain = prev.gain;
          estTax = estimatedPileTax(
            prev.gain, summ.unlockedShares, prev.ltShares + prev.unknownShares,
            ltRate, stRate,
          );
        } catch { /* preview is best-effort */ }
      }
      return { p, unlockedShares: summ.unlockedShares, readyValue, gain, estTax };
    })
    .filter((r): r is TrimFuelRow => r !== null)
    .sort((a, b) => {
      if (a.p.trimRank != null && b.p.trimRank != null) return a.p.trimRank - b.p.trimRank;
      if (a.p.trimRank != null) return -1;
      if (b.p.trimRank != null) return 1;
      if (overCap) {
        const aSemi = a.p.category === SEMI_CATEGORY ? 0 : 1;
        const bSemi = b.p.category === SEMI_CATEGORY ? 0 : 1;
        if (aSemi !== bSemi) return aSemi - bSemi;
      }
      return b.readyValue - a.readyValue;
    });
}

/** What unlocks next among the still-locked (and not never-trim) holdings. */
export function nextUnlockRows(args: {
  parked: ParkedPosition[];
  lotsByPosition: Map<string, ParkedLot[]>;
  today: string;
  limit?: number;
}): { p: ParkedPosition; next: { date: string; shares: number } }[] {
  const { parked, lotsByPosition, today, limit = 3 } = args;
  return parked
    .filter((p) => !isNeverTrimFuel(p))
    .map((p) => ({ p, next: unlockSummary(lotsByPosition.get(p.id) ?? [], today).nextUnlock }))
    .filter((x): x is { p: ParkedPosition; next: { date: string; shares: number } } => x.next != null)
    .sort((a, b) => a.next.date.localeCompare(b.next.date))
    .slice(0, limit);
}

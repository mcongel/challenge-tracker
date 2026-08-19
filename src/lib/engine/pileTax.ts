/** Parked-pile capital-gains tax picture, per tax year. Informational only —
 * the pile is walled off from the challenge account's 30% quarterly skim, so
 * whatever this estimates must be set aside by hand. Wash-sale disallowances
 * and loss carryovers are NOT modeled; a net loss simply taxes at zero here. */

import { taxYearOf } from './dates';
import { roundCents } from './money';
import type { ParkedSale } from './types';

/** Spec's rough combined rates: ~21% long-term, ~28–30% short-term. Defaults
 * only — live values come from app_settings (lt_tax_rate / st_tax_rate). */
export const LT_TAX_RATE = 0.21;
export const ST_TAX_RATE = 0.29;

/** Long-term fraction of a sale, clamped to [0,1]. Null ltShares = all LT —
 * the house assumption for undated lots. THE single definition: the trim
 * preview and the year table blend with the same rule or they quote
 * different tax on the same sale. */
export function ltFraction(shares: number, ltShares: number | null | undefined): number {
  return ltShares == null || shares <= 0 ? 1 : Math.min(1, Math.max(0, ltShares / shares));
}

/**
 * Rough tax estimate on a positive pile gain, blended by the long-term share
 * fraction. Context only — the quarterly skim is challenge-account-only and
 * never covers this. NOTE the deliberate asymmetry with pileCapGainsYear:
 * this previews ONE sale, so there is nothing to net a loss against — a
 * non-positive gain simply estimates zero; the year table nets LT/ST buckets
 * across all of a year's sales before applying rates.
 */
export function estimatedPileTax(
  gain: number,
  shares: number,
  ltShares: number | null | undefined,
  ltRate: number = LT_TAX_RATE,
  stRate: number = ST_TAX_RATE,
): number {
  if (gain <= 0 || shares <= 0) return 0;
  const ltFrac = ltFraction(shares, ltShares);
  return gain * (ltFrac * ltRate + (1 - ltFrac) * stRate);
}

export interface PileCapGainsYear {
  /** Sales dated in the year that carry a basis (the ones we can tax). */
  saleCount: number;
  proceeds: number;
  /** Net gain per bucket over the year; negative = net loss. The LT/ST split
   * of each sale's gain follows its recorded ltShares fraction (null = all
   * LT, the house assumption for undated lots — same as estimatedPileTax). */
  ltGain: number;
  stGain: number;
  /** Schedule-D style: a net loss in one bucket offsets the other's gain
   * before the rates apply; a remaining overall loss owes nothing. */
  estTax: number;
  /** Sales in the year excluded for having no recorded basis. */
  unknownBasisCount: number;
}

export function pileCapGainsYear(
  sales: ParkedSale[],
  year: number,
  ltRate: number,
  stRate: number,
): PileCapGainsYear {
  let ltGain = 0;
  let stGain = 0;
  let proceeds = 0;
  let saleCount = 0;
  let unknownBasisCount = 0;
  for (const s of sales) {
    if (taxYearOf(s.date) !== year) continue;
    if (s.costBasis == null) {
      unknownBasisCount++;
      continue;
    }
    saleCount++;
    proceeds += s.proceeds;
    const gain = s.proceeds - s.costBasis;
    const ltFrac = ltFraction(s.shares, s.ltShares);
    ltGain += gain * ltFrac;
    stGain += gain * (1 - ltFrac);
  }
  // Cross-bucket netting: losses in one bucket absorb the other's gains
  // before rates apply (the Schedule D order of operations).
  let taxableLt = ltGain;
  let taxableSt = stGain;
  if (taxableSt < 0 && taxableLt > 0) {
    taxableLt = Math.max(0, taxableLt + taxableSt);
    taxableSt = 0;
  } else if (taxableLt < 0 && taxableSt > 0) {
    taxableSt = Math.max(0, taxableSt + taxableLt);
    taxableLt = 0;
  }
  const estTax = roundCents(Math.max(0, taxableLt) * ltRate + Math.max(0, taxableSt) * stRate);
  return {
    saleCount,
    proceeds: roundCents(proceeds),
    ltGain: roundCents(ltGain),
    stGain: roundCents(stGain),
    estTax,
    unknownBasisCount,
  };
}

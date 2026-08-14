/** Parked-pile capital-gains tax picture, per tax year. Informational only —
 * the pile is walled off from the challenge account's 30% quarterly skim, so
 * whatever this estimates must be set aside by hand. Wash-sale disallowances
 * and loss carryovers are NOT modeled; a net loss simply taxes at zero here. */

import { taxYearOf } from './dates';
import { roundCents } from './money';
import type { ParkedSale } from './types';

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
    const ltFraction = s.ltShares == null || s.shares <= 0
      ? 1
      : Math.min(1, Math.max(0, s.ltShares / s.shares));
    ltGain += gain * ltFraction;
    stGain += gain * (1 - ltFraction);
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

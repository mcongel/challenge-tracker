/** Retirement transition modeler: project a scenario's annual dividend income
 * as parked-pile growth holdings rotate into income assets. Pure pile
 * context — never score, YTD, or tax-skim math.
 *
 * Documented simplifying assumptions:
 * - Rotation price = the holding's CURRENT price (no future price modeling).
 * - `projectPositionIncome().annualGross` (a next-12-months figure) stands in
 *   for calendar-year-0 income.
 * - A rotation takes effect the first day of the month AFTER its date; both
 *   the sold holding's income and the bought asset's income prorate by whole
 *   months within the rotation year.
 * - ROC portions of a buy's distributions are untaxed on the assumption that
 *   basis isn't exhausted within the horizon — rocCumulativeBySymbol vs
 *   netProceedsBySymbol lets the user judge how close a scenario gets.
 * - Portfolio values are price-static (todays' prices throughout).
 */

import { longTermDate, taxYearOf } from './dates';
import { isArchivedPosition, parkedMarketValue } from './parked';
import { consumeLotsFifo, trimPreview } from './parkedLots';
import { estimatedPileTax } from './pileTax';
import type { ParkedLot } from './parkedLots';
import { projectPositionIncome } from './parkedIncome';
import type { DividendTaxRates } from './parkedIncome';
import type { ParkedLotAdjustment } from './parkedRoc';
import { adjustmentsForLots } from './parkedRoc';
import type { ParkedPosition } from './types';

export interface IncomeScenario {
  id: string;
  name: string;
  description?: string | null;
  targetAnnualIncome?: number | null;
  /** Planned retirement year — drives the horizon. */
  targetYear?: number | null;
  isActive: boolean;
  /** Per-scenario tax overrides (fractions); null → settings fallback. */
  qualifiedRate?: number | null;
  ordinaryRate?: number | null;
  capitalGainRate?: number | null;
  createdAt?: string | null;
}

/** Percent points summing to ~100, e.g. {"ordinary": 40, "return_of_capital": 60}. */
export type BuyClassificationMix = Partial<
  Record<'qualified' | 'ordinary' | 'return_of_capital' | 'capital_gain_dist', number>
>;

export interface ScenarioRotation {
  id: string;
  scenarioId: string;
  /** null = new cash (cashAmount required instead). */
  sellHoldingId?: string | null;
  sellShares?: number | null;
  /** Fraction of TODAY'S share count (0..1]. */
  sellPct?: number | null;
  cashAmount?: number | null;
  rotationDate: string;
  buySymbol: string;
  /** Fractions (0.07 = 7%). */
  buyYieldPct: number;
  buyDividendGrowthPct: number;
  buyClassificationMix: BuyClassificationMix;
  notes?: string | null;
}

export interface ScenarioRates {
  dividend: DividendTaxRates;
  /** Long-term slice of a rotation's gain: scenario override or settings lt. */
  capGainLt: number;
  /** Short-term slice always uses settings st — ST sales are warned, not planned. */
  capGainSt: number;
}

export function resolveScenarioRates(
  scenario: IncomeScenario,
  settings: { dividend: DividendTaxRates; lt: number; st: number },
): ScenarioRates {
  const capGainLt = scenario.capitalGainRate ?? settings.lt;
  return {
    dividend: {
      qualified: scenario.qualifiedRate ?? settings.dividend.qualified,
      ordinary: scenario.ordinaryRate ?? settings.dividend.ordinary,
      capitalGainDist: capGainLt,
    },
    capGainLt,
    capGainSt: settings.st,
  };
}

export type RotationWarning =
  | 'short_term'
  | 'oversell_clamped'
  | 'no_lots'
  | 'holding_missing'
  | 'beyond_horizon';

export interface RotationPreview {
  rotationId: string;
  buySymbol: string;
  /** Resolved + clamped; null for cash rotations. */
  sellShares: number | null;
  grossProceeds: number;
  /** vs ROC-adjusted basis; 0 for cash rotations. */
  gain: number;
  capitalGainsTax: number;
  netProceeds: number;
  stShares: number;
  unknownShares: number;
  warnings: RotationWarning[];
}

export interface ScenarioYearRow {
  year: number;
  grossIncome: number;
  afterTaxIncome: number;
  /** Keys: 'pos:<positionId>' and 'buy:<SYMBOL>'. */
  byHoldingGross: Record<string, number>;
  byHoldingAfterTax: Record<string, number>;
  /** grossIncome / static-price portfolio value; null when value ≤ 0. */
  portfolioYieldPct: number | null;
}

export interface ScenarioProjection {
  years: ScenarioYearRow[];
  horizon: { startYear: number; endYear: number };
  /** First year AFTER-TAX income ≥ target — retirement income is spendable income. */
  targetReachedYear: number | null;
  rotationPreviews: RotationPreview[];
  rocCumulativeBySymbol: Record<string, number>;
  netProceedsBySymbol: Record<string, number>;
  excludedPositionIds: string[];
  holdingLabels: Record<string, string>;
}

const monthOf = (iso: string) => Number(iso.slice(5, 7));

export function projectScenario(args: {
  scenario: IncomeScenario;
  rotations: ScenarioRotation[];
  positions: ParkedPosition[];
  lots: ParkedLot[];
  adjustments: ParkedLotAdjustment[];
  today: string;
  settings: { dividend: DividendTaxRates; lt: number; st: number };
}): ScenarioProjection {
  const { scenario, positions, lots, adjustments, today, settings } = args;
  const rates = resolveScenarioRates(scenario, settings);
  const Y0 = taxYearOf(today);
  const endYear = Math.max((scenario.targetYear ?? Y0) + 5, Y0 + 10);

  const live = positions.filter((p) => !isArchivedPosition(p));
  const posById = new Map(live.map((p) => [p.id, p]));
  const lotsByPosition = new Map<string, ParkedLot[]>();
  for (const l of lots) {
    const arr = lotsByPosition.get(l.parkedPositionId);
    if (arr) arr.push(l);
    else lotsByPosition.set(l.parkedPositionId, [l]);
  }

  // ---- Baseline income per live position ------------------------------------
  const excludedPositionIds: string[] = [];
  const holdingLabels: Record<string, string> = {};
  const baseline = new Map<string, { gross: number; atf: number; growth: number }>();
  for (const p of live) {
    holdingLabels[`pos:${p.id}`] = p.ticker;
    const proj = projectPositionIncome({
      position: p,
      lots: lotsByPosition.get(p.id) ?? [],
      today,
      rates: rates.dividend,
    });
    if (!proj) {
      excludedPositionIds.push(p.id);
      continue;
    }
    baseline.set(p.id, {
      gross: proj.annualGross,
      atf: proj.annualGross > 0 ? proj.annualAfterTax / proj.annualGross : 1,
      growth: p.dividendGrowthPct ?? 0,
    });
  }

  // ---- Rotations: sell haircuts against SIMULATED lot state -----------------
  // Sorted by date so a later rotation's basis and LT/ST split reflect what
  // earlier rotations already consumed.
  const sorted = [...args.rotations].sort((a, b) =>
    a.rotationDate.localeCompare(b.rotationDate),
  );
  const simLots = new Map<string, Map<string, ParkedLot>>();
  const simAdjs = new Map<string, Map<string, ParkedLotAdjustment>>();
  /** Remaining sellable shares, decremented by EVERY sale — a holding whose
   * lots ran out must clamp to zero, never refill from its original count. */
  const simRemaining = new Map<string, number>();
  const hadLots = new Map<string, boolean>();
  const ensureSim = (pid: string) => {
    if (!simLots.has(pid)) {
      const copies = (lotsByPosition.get(pid) ?? []).map((l) => ({ ...l }));
      simLots.set(pid, new Map(copies.map((l) => [l.id, l])));
      simAdjs.set(
        pid,
        new Map(adjustmentsForLots(copies, adjustments).map((a) => [a.id, { ...a }])),
      );
      simRemaining.set(pid, posById.get(pid)?.shares ?? 0);
      hadLots.set(pid, copies.some((l) => l.shares > 0));
    }
  };

  const rotationPreviews: RotationPreview[] = [];
  const rocCumulativeBySymbol: Record<string, number> = {};
  const netProceedsBySymbol: Record<string, number> = {};
  interface SellEffect { positionId: string; soldFrac: number; effAbs: number }
  interface BuyEffect {
    symbol: string; base: number; growth: number; atf: number; rocShare: number;
    rotYear: number; monthsAfter: number; effAbs: number; netProceeds: number;
  }
  const sellEffects: SellEffect[] = [];
  const buyEffects: BuyEffect[] = [];

  const zeroPreview = (
    r: ScenarioRotation,
    warnings: RotationWarning[],
    extra: RotationWarning,
    sellShares: number | null,
  ): RotationPreview => ({
    rotationId: r.id, buySymbol: r.buySymbol.toUpperCase(), sellShares,
    grossProceeds: 0, gain: 0, capitalGainsTax: 0, netProceeds: 0,
    stShares: 0, unknownShares: 0, warnings: [...warnings, extra],
  });

  for (const r of sorted) {
    const warnings: RotationWarning[] = [];
    const rYear = taxYearOf(r.rotationDate);
    const rMonth = monthOf(r.rotationDate);
    const effAbs = rYear * 12 + rMonth + 1; // first live absolute month (1-based)
    const monthsAfter = 12 - rMonth;
    if (rYear > endYear) warnings.push('beyond_horizon');

    let netProceeds: number;
    let preview: Omit<RotationPreview, 'rotationId' | 'buySymbol' | 'warnings'>;

    if (!r.sellHoldingId) {
      // New cash: no sale, no tax.
      netProceeds = r.cashAmount ?? 0;
      preview = {
        sellShares: null, grossProceeds: netProceeds, gain: 0,
        capitalGainsTax: 0, netProceeds, stShares: 0, unknownShares: 0,
      };
    } else {
      const p = posById.get(r.sellHoldingId);
      if (!p) {
        rotationPreviews.push(zeroPreview(r, warnings, 'holding_missing', null));
        continue;
      }
      ensureSim(p.id);
      const requested = r.sellShares ?? (r.sellPct ?? 0) * p.shares;
      const lotMap = simLots.get(p.id)!;
      const shareLots = [...lotMap.values()].filter((l) => l.shares > 0);
      // simRemaining is the single clamp source — the no-lots fallback only
      // applies to positions that never had lots (legacy), otherwise a fully
      // consumed holding would refill to its original count.
      const available = Math.min(
        simRemaining.get(p.id)!,
        hadLots.get(p.id) ? shareLots.reduce((s, l) => s + l.shares, 0) : Infinity,
      );
      let shares = requested;
      if (shares > available + 1e-9) {
        shares = available;
        warnings.push('oversell_clamped');
      }
      if (shares <= 1e-9) {
        rotationPreviews.push(zeroPreview(r, warnings, 'oversell_clamped', 0));
        continue;
      }

      let gross: number;
      let gain: number;
      let tax: number;
      let stShares = 0;
      let unknownShares = 0;
      if (shareLots.length > 0) {
        const adjList = [...simAdjs.get(p.id)!.values()];
        const tp = trimPreview(shareLots, shares, p.currentPrice, r.rotationDate, adjList);
        gross = tp.proceeds;
        gain = tp.gain;
        stShares = tp.stShares;
        unknownShares = tp.unknownShares;
        // Undated shares count as LT (established policy); LT slice at the
        // scenario's capital-gain rate, ST slice at settings st.
        tax = estimatedPileTax(gain, shares, tp.ltShares + tp.unknownShares, rates.capGainLt, rates.capGainSt);
        // Advance the simulation so the next rotation sees reduced basis.
        const consumption = consumeLotsFifo(shareLots, shares, adjList);
        for (const u of consumption.updates) {
          const lot = lotMap.get(u.id);
          if (lot) { lot.shares = u.shares; lot.amount = u.amount; }
        }
        const adjMap = simAdjs.get(p.id)!;
        for (const au of consumption.adjustmentUpdates) {
          const a = adjMap.get(au.id);
          if (a) a.amount = au.amount;
        }
        for (const deadId of consumption.deletes) {
          lotMap.delete(deadId);
          for (const a of adjMap.values()) {
            if (a.shareLotId === deadId) adjMap.delete(a.id);
          }
        }
      } else {
        // Legacy: shares but no lot history — basis from avgCost; the
        // position-level buyDate can still prove a short-term sale.
        warnings.push('no_lots');
        gross = shares * p.currentPrice;
        gain = gross - shares * p.avgCost;
        const shortTerm = p.buyDate != null && longTermDate(p.buyDate) > r.rotationDate;
        if (shortTerm) stShares = shares;
        tax = estimatedPileTax(gain, shares, shortTerm ? 0 : shares, rates.capGainLt, rates.capGainSt);
      }
      simRemaining.set(p.id, simRemaining.get(p.id)! - shares);
      if (stShares > 1e-9) warnings.push('short_term');
      netProceeds = gross - tax;
      preview = {
        sellShares: shares, grossProceeds: gross, gain,
        capitalGainsTax: tax, netProceeds, stShares, unknownShares,
      };
      sellEffects.push({ positionId: p.id, soldFrac: shares / p.shares, effAbs });
    }

    // Buy side.
    const sym = r.buySymbol.toUpperCase();
    holdingLabels[`buy:${sym}`] = sym;
    const mixEntries = Object.entries(r.buyClassificationMix ?? {}) as [
      keyof BuyClassificationMix, number,
    ][];
    const mixSum = mixEntries.reduce((s, [, v]) => s + (v > 0 ? v : 0), 0);
    const share = (k: keyof BuyClassificationMix) =>
      mixSum > 0 ? Math.max(0, r.buyClassificationMix[k] ?? 0) / mixSum : k === 'qualified' ? 1 : 0;
    const atf =
      share('qualified') * (1 - rates.dividend.qualified) +
      share('ordinary') * (1 - rates.dividend.ordinary) +
      share('capital_gain_dist') * (1 - rates.capGainLt) +
      share('return_of_capital'); // ROC untaxed
    buyEffects.push({
      symbol: sym,
      base: netProceeds * r.buyYieldPct,
      growth: r.buyDividendGrowthPct,
      atf,
      rocShare: share('return_of_capital'),
      rotYear: rYear,
      monthsAfter,
      effAbs,
      netProceeds,
    });
    netProceedsBySymbol[sym] = (netProceedsBySymbol[sym] ?? 0) + netProceeds;
    rotationPreviews.push({
      rotationId: r.id, buySymbol: sym, warnings, ...preview,
    });
  }

  // ---- Year rows ------------------------------------------------------------
  const soldByPosition = new Map<string, SellEffect[]>();
  for (const e of sellEffects) {
    const arr = soldByPosition.get(e.positionId);
    if (arr) arr.push(e);
    else soldByPosition.set(e.positionId, [e]);
  }
  /** Retained fraction at the END of `year`. */
  const retainedEnd = (pid: string, year: number): number => {
    let sold = 0;
    for (const e of soldByPosition.get(pid) ?? []) {
      if (year * 12 + 12 >= e.effAbs) sold += e.soldFrac;
    }
    return Math.max(0, 1 - sold);
  };
  /** Mean retained fraction over `year`'s 12 months, closed-form: each sale
   * effect overlaps clamp(year·12 + 12 − effAbs + 1, 0, 12) months. */
  const yearWeight = (pid: string, year: number): number => {
    let soldMonths = 0;
    for (const e of soldByPosition.get(pid) ?? []) {
      const overlap = Math.min(12, Math.max(0, year * 12 + 12 - e.effAbs + 1));
      soldMonths += e.soldFrac * overlap;
    }
    return Math.max(0, 1 - soldMonths / 12);
  };
  const valueById = new Map(live.map((p) => [p.id, parkedMarketValue(p)]));

  const years: ScenarioYearRow[] = [];
  let targetReachedYear: number | null = null;
  for (let year = Y0; year <= endYear; year++) {
    const byHoldingGross: Record<string, number> = {};
    const byHoldingAfterTax: Record<string, number> = {};
    let gross = 0;
    let afterTax = 0;
    let value = 0;

    for (const p of live) {
      value += valueById.get(p.id)! * retainedEnd(p.id, year);
      const b = baseline.get(p.id);
      if (!b || b.gross <= 0) continue;
      const g = b.gross * Math.pow(1 + b.growth, year - Y0) * yearWeight(p.id, year);
      if (g <= 0) continue;
      byHoldingGross[`pos:${p.id}`] = g;
      byHoldingAfterTax[`pos:${p.id}`] = g * b.atf;
      gross += g;
      afterTax += g * b.atf;
    }

    for (const b of buyEffects) {
      let g = 0;
      // Rotation year pays the prorated STARTING yield; the first full year
      // pays the full starting yield; growth compounds only after that.
      if (year === b.rotYear) g = b.base * (b.monthsAfter / 12);
      else if (year > b.rotYear) g = b.base * Math.pow(1 + b.growth, year - b.rotYear - 1);
      if (b.effAbs <= year * 12 + 12) value += b.netProceeds;
      if (g <= 0) continue;
      const key = `buy:${b.symbol}`;
      byHoldingGross[key] = (byHoldingGross[key] ?? 0) + g;
      byHoldingAfterTax[key] = (byHoldingAfterTax[key] ?? 0) + g * b.atf;
      gross += g;
      afterTax += g * b.atf;
      rocCumulativeBySymbol[b.symbol] = (rocCumulativeBySymbol[b.symbol] ?? 0) + g * b.rocShare;
    }

    if (
      targetReachedYear === null &&
      scenario.targetAnnualIncome != null &&
      afterTax >= scenario.targetAnnualIncome
    ) {
      targetReachedYear = year;
    }
    years.push({
      year,
      grossIncome: gross,
      afterTaxIncome: afterTax,
      byHoldingGross,
      byHoldingAfterTax,
      portfolioYieldPct: value > 0 ? gross / value : null,
    });
  }

  return {
    years,
    horizon: { startYear: Y0, endYear },
    targetReachedYear,
    rotationPreviews,
    rocCumulativeBySymbol,
    netProceedsBySymbol,
    excludedPositionIds,
    holdingLabels,
  };
}

import type { CashEvent, LossCarryforward, TaxQuarter, TaxReserveCheck, Trade } from './types';
import { quarterEndDate, quarterOf, taxYearOf } from './dates';
import { roundCents, sum } from './money';
import { netRealizedYTD } from './trades';

export const RESERVE_RATE = 0.3;

/** Loss carried into a tax year (positive number), 0 if none recorded.
 * Multiple rows for the same year sum — a duplicate entry must not vanish. */
export function applicableCarryforward(carryforwards: LossCarryforward[], year: number): number {
  return sum(carryforwards.filter((c) => c.taxYear === year).map((c) => c.amount));
}

/** 30% of (net realized YTD − carryforward), floored at zero. */
export function reserveTarget(netRealized: number, carryforward = 0): number {
  return roundCents(Math.max(0, RESERVE_RATE * (netRealized - carryforward)));
}

/** Tax skims actually moved during a tax year (optionally up to a date). */
export function alreadyReserved(events: CashEvent[], year: number, asOf?: string): number {
  return sum(
    events
      .filter(
        (e) =>
          e.type === 'TaxSkim' &&
          taxYearOf(e.date) === year &&
          (asOf === undefined || e.date <= asOf),
      )
      .map((e) => e.amount),
  );
}

export function moveOutNow(target: number, already: number): number {
  return roundCents(Math.max(0, target - already));
}

/** Every calendar quarter that has fully ended between firstDate and today. */
export function quartersEnded(firstDate: string, today: string): TaxQuarter[] {
  const out: TaxQuarter[] = [];
  let year = taxYearOf(firstDate);
  let quarter = quarterOf(firstDate);
  while (quarterEndDate(year, quarter) < today) {
    out.push({ year, quarter });
    if (quarter === 4) {
      year += 1;
      quarter = 1;
    } else {
      quarter = (quarter + 1) as TaxQuarter['quarter'];
    }
  }
  return out;
}

/**
 * The quarterly checklist row. Net realized is measured as of the quarter's
 * end; skims moved any time during the tax year count toward the target
 * (settling Q3 late still credits an October move against Q3).
 */
export function computeCheck(
  q: TaxQuarter,
  trades: Trade[],
  events: CashEvent[],
  carryforwards: LossCarryforward[],
): TaxReserveCheck {
  const endDate = quarterEndDate(q.year, q.quarter);
  const netRealized = netRealizedYTD(trades, q.year, endDate);
  const target = reserveTarget(netRealized, applicableCarryforward(carryforwards, q.year));
  const already = alreadyReserved(events, q.year);
  return {
    ...q,
    endDate,
    netRealizedYTD: netRealized,
    reserveTarget: target,
    alreadyReserved: already,
    moveOutNow: moveOutNow(target, already),
  };
}

/** The skim-due alert: fires the day after quarter end, nags until settled. */
export function skimDueNow(checks: TaxReserveCheck[]): TaxReserveCheck | undefined {
  return checks.find((c) => c.moveOutNow > 0);
}

export function formatQuarterLabel(q: TaxQuarter): string {
  return `Q${q.quarter} ${q.year}`;
}

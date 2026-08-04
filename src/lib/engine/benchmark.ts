import type { BenchmarkDeposit, Snapshot } from './types';
import { sum } from './money';

export function shadowShares(d: BenchmarkDeposit): number {
  return d.vooPriceThatDay === 0 ? 0 : d.amount / d.vooPriceThatDay;
}

export function totalShadowShares(deposits: BenchmarkDeposit[]): number {
  return sum(deposits.map(shadowShares));
}

export function shadowValue(deposits: BenchmarkDeposit[], vooPriceToday: number): number {
  return totalShadowShares(deposits) * vooPriceToday;
}

export function lead(totalScore: number, shadow: number): number {
  return totalScore - shadow;
}

export function leadPct(totalScore: number, shadow: number): number {
  return shadow === 0 ? 0 : (totalScore - shadow) / shadow;
}

/**
 * Rolling-12-month verdict: how the lead moved over the trailing year.
 * Deposits raise Total Score and the shadow equally, so the lead's delta
 * isolates trading skill. Null until a snapshot ≥365 days old exists.
 */
export function rollingLeadDelta(snapshots: Snapshot[], today: string): number | null {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1];
  if (!current) return null;
  // Oldest snapshot within the window's far edge; must be at least a year old.
  const yearAgo = sorted.filter((s) => daysApart(s.date, today) >= 365).pop();
  if (!yearAgo) return null;
  const leadThen = yearAgo.totalScore - yearAgo.shadowVooValue;
  const leadNow = current.totalScore - current.shadowVooValue;
  return leadNow - leadThen;
}

function daysApart(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

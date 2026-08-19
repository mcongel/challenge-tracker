import type { MilestoneRecord, MilestoneRow } from './types';
import { roundCents, sum } from './money';

export const BASE_LEVELS = [100_000, 200_000, 400_000, 800_000, 1_000_000];
export const SKIM_RATE = 0.25;

/**
 * The ratchet ladder, extended by doubling once the account grows past the
 * base levels ($1.6M, $3.2M, ... per the workbook's note). Always includes at
 * least one level above accountValue so "next milestone" exists.
 */
export function milestoneLevels(accountValue: number, records: MilestoneRecord[] = []): number[] {
  const levels = [...BASE_LEVELS];
  const highestRelevant = Math.max(accountValue, ...records.map((r) => r.level), 0);
  let next = 1_600_000;
  while (levels[levels.length - 1] <= highestRelevant) {
    levels.push(next);
    next *= 2;
  }
  return levels;
}

export function skimDue(accountValueAtHit: number): number {
  return roundCents(SKIM_RATE * accountValueAtHit);
}

/** Smallest un-banked level above the account value; $100k floor. Banked
 * levels are skipped — after the $100k skim drops the account to ~$79k, the
 * next milestone is $200k, not $100k again. */
export function nextMilestone(accountValue: number, records: MilestoneRecord[] = []): number {
  const banked = new Set(records.map((r) => r.level));
  return (
    milestoneLevels(accountValue, records).find((l) => l > accountValue && !banked.has(l)) ??
    BASE_LEVELS[0]
  );
}

export function cumulativeFloor(records: MilestoneRecord[]): number {
  return sum(records.map((r) => r.amountBanked));
}

/**
 * Full ratchet table. EVERY unbanked level at or below the current account
 * value reads HIT_BANK_NOW — a single move from $95k past $210k flags both
 * $100k and $200k, each with its own skim.
 */
export function milestoneTable(accountValue: number, records: MilestoneRecord[]): MilestoneRow[] {
  const byLevel = new Map(records.map((r) => [r.level, r]));
  let running = 0;
  return milestoneLevels(accountValue, records).map((level) => {
    const record = byLevel.get(level);
    if (record) running += record.amountBanked;
    const status = record ? 'BANKED' : accountValue >= level ? 'HIT_BANK_NOW' : 'NOT_YET';
    return {
      level,
      status,
      skimDue: skimDue(record ? record.accountValueAtHit : accountValue),
      record,
      cumulativeFloor: running,
    };
  });
}

import type { CashEvent } from './types';
import { sum } from './money';

/**
 * Strategy cash tracked into/out of an account via the ledger: events whose
 * destination is this account add, events sourced from it subtract. This is
 * "tracked strategy cash", NOT the account's real balance — the app never
 * sees groceries or interest — and it is never part of score math.
 */
export function trackedBalance(accountId: string, events: CashEvent[]): number {
  return (
    sum(events.filter((e) => e.destinationAccountId === accountId).map((e) => e.amount)) -
    sum(events.filter((e) => e.accountId === accountId).map((e) => e.amount))
  );
}

/** Tax skims grouped by where they were parked. Key null = no destination recorded. */
export function reservedByAccount(events: CashEvent[]): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const e of events) {
    if (e.type !== 'TaxSkim') continue;
    const key = e.destinationAccountId ?? null;
    out.set(key, (out.get(key) ?? 0) + e.amount);
  }
  return out;
}

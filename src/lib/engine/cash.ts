import type { CashEvent, CashEventType } from './types';
import { sum } from './money';

const CASH_IN: ReadonlySet<CashEventType> = new Set(['Deposit', 'Sell', 'Dividend']);

/** Positive for money entering the account's cash, negative for leaving. */
export function signedAmount(e: CashEvent): number {
  return CASH_IN.has(e.type) ? e.amount : -e.amount;
}

/** Chronological events paired with the running cash balance after each. */
export function withRunningBalance(events: CashEvent[]): { event: CashEvent; balance: number }[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  return sorted.map((event) => {
    balance += signedAmount(event);
    return { event, balance };
  });
}

export function currentCash(events: CashEvent[]): number {
  return sum(events.map(signedAmount));
}

/** True stake so far: deposits − withdrawals. */
export function netContributed(events: CashEvent[]): number {
  return sum(
    events.map((e) => (e.type === 'Deposit' ? e.amount : e.type === 'Withdrawal' ? -e.amount : 0)),
  );
}

export function totalByType(events: CashEvent[], type: CashEventType): number {
  return sum(events.filter((e) => e.type === type).map((e) => e.amount));
}

export function cashSummary(events: CashEvent[]) {
  return {
    deposits: totalByType(events, 'Deposit'),
    withdrawals: totalByType(events, 'Withdrawal'),
    buys: totalByType(events, 'Buy'),
    sells: totalByType(events, 'Sell'),
    dividends: totalByType(events, 'Dividend'),
    taxSkims: totalByType(events, 'TaxSkim'),
    milestoneBanks: totalByType(events, 'MilestoneBank'),
    fees: totalByType(events, 'Fee'),
    netContributed: netContributed(events),
    currentCash: currentCash(events),
  };
}

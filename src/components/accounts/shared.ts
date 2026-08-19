import type { AccountKind } from '../../lib/engine';

export const KIND_STYLES: Record<AccountKind, string> = {
  challenge: 'bg-green-50 text-green-700',
  outside: 'bg-indigo-50 text-indigo-700',
  bank: 'bg-sky-50 text-sky-700',
  retirement: 'bg-purple-50 text-purple-700',
};

/** Everything that points at an account, split into what blocks structural
 * changes (delete / kind change) vs the account's own manual cash rows,
 * which delete along with it. */
export interface AccountUsage {
  holdings: number;
  pileSales: number;
  ledgerRows: number;
  outsideSaleRows: number;
  cashMovements: number;
}

export function usageBlockers(u: AccountUsage): string[] {
  const part = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const out: string[] = [];
  if (u.holdings > 0) out.push(part(u.holdings, 'holding'));
  if (u.pileSales > 0) out.push(part(u.pileSales, 'pile sale'));
  if (u.ledgerRows > 0) out.push(part(u.ledgerRows, 'ledger row'));
  if (u.outsideSaleRows > 0) out.push(part(u.outsideSaleRows, 'outside-sale record'));
  return out;
}

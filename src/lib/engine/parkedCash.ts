import type { CashEvent, ParkedPosition, ParkedSale } from './types';
import type { ParkedLot } from './parkedLots';
import { trackedBalance } from './accounts';
import { sum } from './money';

/** Manual cash movement in a non-challenge account. Everything else
 * (sales, dividends, buys, challenge funding) auto-flows. */
export type ParkedCashType = 'deposit' | 'withdrawal' | 'interest' | 'fee' | 'adjustment';

export interface ParkedCashEvent {
  id: string;
  accountId: string;
  date: string;
  type: ParkedCashType;
  /** Positive with typed direction; adjustments may be signed either way. */
  amount: number;
  notes?: string | null;
}

export function signedParkedCash(e: ParkedCashEvent): number {
  return e.type === 'withdrawal' || e.type === 'fee' ? -e.amount : e.amount;
}

/** Lots that moved cash in this account. Transfer-created and milestone-bank
 * lots didn't (ACATS moves shares, not cash; milestone money came from the
 * challenge account) — they're identifiable by the notes the app writes.
 * Exported so trimCore can apply the SAME predicate when it records how much
 * cash-spending basis a sale consumed. */
export const spentCash = (lot: Pick<ParkedLot, 'notes'>) =>
  !(lot.notes && (/^ACATS from /.test(lot.notes) || /^Milestone /.test(lot.notes)));

export interface AccountCashBreakdown {
  balance: number;
  manual: number;
  saleProceeds: number;
  cashDividends: number;
  purchases: number;
  /** Challenge-ledger flows: deposits sourced here (−), skims parked here (+). */
  challengeFlows: number;
}

/**
 * Tracked cash for one account — the app's view of strategy money, healed by
 * reconcile adjustments, never a claim about the real balance. Auto-flows:
 * sale proceeds and cash dividends credit; purchases debit; challenge-ledger
 * events move whichever direction they recorded.
 */
export function computeAccountCash(
  accountId: string,
  args: {
    parkedCashEvents: ParkedCashEvent[];
    parkedSales: ParkedSale[];
    parkedLots: ParkedLot[];
    parked: ParkedPosition[];
    cashEvents: CashEvent[];
  },
): AccountCashBreakdown {
  const manual = sum(
    args.parkedCashEvents.filter((e) => e.accountId === accountId).map(signedParkedCash),
  );
  const saleProceeds = sum(
    args.parkedSales.filter((s) => s.accountId === accountId).map((s) => s.proceeds),
  );
  const positionIds = new Set(
    args.parked.filter((p) => p.accountId === accountId).map((p) => p.id),
  );
  const accountLots = args.parkedLots.filter((l) => positionIds.has(l.parkedPositionId));
  // Cash dividends only: price is null exactly when nothing was reinvested.
  // A DRIP lot whose shares were later fully trimmed keeps its price and
  // sits at zero shares as an income record — it never brought cash in.
  const cashDividends = sum(
    accountLots
      .filter((l) => l.source === 'dividend' && l.shares <= 0 && l.price == null)
      .map((l) => l.amount),
  );
  // Purchases = cash originally spent. Lot amounts SHRINK when a sale
  // consumes them (basis moves into the sale record), but the cash left the
  // account at buy time and never comes back — so each sale's consumed
  // purchase basis is added back. Without this, every lot-consuming sale
  // phantom-credits its cost basis to tracked cash.
  const consumedBySales = sum(
    args.parkedSales.filter((s) => s.accountId === accountId).map((s) => s.consumedBasis ?? 0),
  );
  const purchases = sum(
    accountLots.filter((l) => l.source === 'purchase' && spentCash(l)).map((l) => l.amount),
  ) + consumedBySales;
  const challengeFlows = trackedBalance(accountId, args.cashEvents);
  return {
    manual,
    saleProceeds,
    cashDividends,
    purchases,
    challengeFlows,
    balance: manual + saleProceeds + cashDividends - purchases + challengeFlows,
  };
}

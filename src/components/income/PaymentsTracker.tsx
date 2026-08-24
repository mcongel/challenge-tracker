import { useMemo, useState } from 'react';
import { HandCoins, Plus } from 'lucide-react';
import { Card } from '../ui/Card';
import { PayExpenseModal } from './PayExpenseModal';
import { useData } from '../../contexts/DataContext';
import { paymentsSummary } from '../../lib/engine';
import { cn, money, todayISO } from '../../lib/utils';

/** Actual expense payments this year vs this month (Phase 3): how much you
 * drew to pay bills, and how much of it came from dividend income vs
 * principal — the honest "living on the yield, or eating the seed corn"
 * read. */
export function PaymentsTracker() {
  const { parkedCashEvents, expenses } = useData();
  const [paying, setPaying] = useState(false);
  const today = todayISO();
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);

  const payments = useMemo(
    () => parkedCashEvents
      .filter((e) => e.type === 'withdrawal')
      .map((e) => ({
        accountId: e.accountId, date: e.date, amount: e.amount,
        expenseId: e.expenseId ?? null, fundedFrom: e.fundedFrom ?? null,
      })),
    [parkedCashEvents],
  );
  const ytd = useMemo(() => paymentsSummary(payments, year), [payments, year]);
  const mtd = useMemo(() => paymentsSummary(payments, month), [payments, month]);
  const expenseName = (id: string) => expenses.find((e) => e.id === id)?.name ?? 'untagged';

  const incomeShare = ytd.total > 0 ? ytd.fromIncome / ytd.total : null;

  return (
    <>
      <Card className="p-4 sm:p-6 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <HandCoins className="h-4 w-4 text-gray-400" /> Payments
            <span className="ml-1 text-xs font-normal text-gray-400">withdrawals that paid bills</span>
          </p>
          <button onClick={() => setPaying(true)}
            className="text-xs font-medium text-green-700 hover:underline flex items-center gap-1 flex-shrink-0">
            <Plus className="h-3.5 w-3.5" /> Record
          </button>
        </div>

        {ytd.count === 0 ? (
          <p className="text-sm text-gray-400">
            No payments recorded yet. Log a withdrawal when you actually spend from the pile — it
            tracks whether you're living on dividend income or dipping into principal.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">This month</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-text-primary">{money(mtd.total)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">This year</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-text-primary">{money(ytd.total)}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">From income</p>
                <p className={cn('mt-0.5 text-lg font-bold tabular-nums',
                  incomeShare != null && incomeShare >= 0.999 ? 'text-green-600'
                    : ytd.fromPrincipal > 0 ? 'text-amber-700' : 'text-text-primary')}>
                  {incomeShare != null ? `${Math.round(incomeShare * 100)}%` : '—'}
                </p>
              </div>
            </div>

            {/* The honest headline. */}
            <p className={cn('mb-3 rounded-md px-3 py-2 text-sm',
              ytd.fromPrincipal <= 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800')}>
              {ytd.fromPrincipal <= 0
                ? `Every dollar you drew this year came from dividend income — ${money(ytd.fromIncome)}.`
                : `${money(ytd.fromIncome)} from income · ${money(ytd.fromPrincipal)} from principal this year — you outspent the yield.`}
            </p>

            {ytd.byExpense.size > 0 && (
              <ul className="divide-y divide-gray-100">
                {[...ytd.byExpense.entries()].sort((a, b) => b[1] - a[1]).map(([id, amt]) => (
                  <li key={id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-text-secondary">{expenseName(id)}</span>
                    <span className="tabular-nums text-text-secondary">{money(amt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
      {paying && <PayExpenseModal onClose={() => setPaying(false)} />}
    </>
  );
}

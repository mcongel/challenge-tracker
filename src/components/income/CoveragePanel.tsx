import { useState } from 'react';
import { Check, Pencil, Plus, Target, Trash2, Wallet } from 'lucide-react';
import { Card } from '../ui/Card';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ExpenseModal } from './ExpenseModal';
import { useData } from '../../contexts/DataContext';
import type { Expense } from '../../lib/engine';
import { coverageSnowball, investedForMonthlyIncome, monthlyAmount } from '../../lib/engine';
import { cn, formatPercent, money } from '../../lib/utils';

/** The living-expenses coverage panel (Phase 1): spendable after-tax income
 * vs the expense ladder, cheapest bill first. reinvesting/spendable split
 * shows the growth-vs-drawdown lever; the next-target line turns the gap into
 * an investing number. */
export function CoveragePanel({
  spendableMonthly, reinvestingMonthly, afterTaxYieldOnCost,
}: {
  spendableMonthly: number;
  reinvestingMonthly: number;
  /** Spendable holdings' after-tax annual income ÷ their cost basis — the
   * rate that translates a monthly gap into dollars-to-invest. */
  afterTaxYieldOnCost: number | null;
}) {
  const { expenses, deleteExpense } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const cov = coverageSnowball(spendableMonthly, expenses);
  const oneOffs = expenses.filter((e) => e.active && e.cadence === 'once');

  if (expenses.length === 0) {
    return (
      <>
        <Card className="p-4 sm:p-6 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Wallet className="h-4 w-4 text-gray-400" /> Living expenses
            </p>
            <button onClick={() => setAdding(true)}
              className="text-xs font-medium text-green-700 hover:underline flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Add expense
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-400">
            Add your monthly and yearly bills to see how much of them your dividend income
            covers — cheapest first — and how much more you'd need to invest to cover the rest.
          </p>
        </Card>
        {adding && <ExpenseModal onClose={() => setAdding(false)} />}
      </>
    );
  }

  const nextInvested = cov.nextTarget
    ? investedForMonthlyIncome(cov.nextTarget.monthlyGap, afterTaxYieldOnCost)
    : null;

  return (
    <>
      <Card className="p-4 sm:p-6 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <Wallet className="h-4 w-4 text-gray-400" /> Living expenses
            <span className="ml-1 text-xs font-normal text-gray-400">
              covered by spendable dividend income, cheapest first
            </span>
          </p>
          <button onClick={() => setAdding(true)}
            className="text-xs font-medium text-green-700 hover:underline flex items-center gap-1 flex-shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        {/* Headline: coverage % + the reinvesting/spendable split. */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
          <div>
            <p className="text-3xl font-bold tabular-nums text-text-primary">
              {formatPercent(cov.coveragePct, 0)}
              <span className="ml-2 text-sm font-normal text-gray-400">
                {cov.coveredCount} of {cov.totalCount} bills
              </span>
            </p>
            <p className="text-xs text-gray-400 tabular-nums">
              {money(cov.coveredMonthly)} of {money(cov.totalMonthly)}/mth covered
            </p>
          </div>
          <div className="text-right text-xs tabular-nums">
            <p className="text-green-600 font-medium">{money(spendableMonthly)}/mth spendable</p>
            <p className="text-gray-400">{money(reinvestingMonthly)}/mth reinvesting</p>
          </div>
        </div>

        {/* Coverage bar. */}
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden mb-3">
          <div className={cn('h-full rounded-full', cov.coveragePct >= 1 ? 'bg-green-600' : 'bg-green-500/80')}
            style={{ width: `${cov.coveragePct * 100}%` }} />
        </div>

        {/* Next target — the gap as an investing goal. */}
        {cov.nextTarget ? (
          <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 flex items-start gap-2">
            <Target className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              <b className="tabular-nums">{money(cov.nextTarget.monthlyGap)}/mth</b> more covers{' '}
              <b>{cov.nextTarget.expense.name}</b>
              {nextInvested != null && (
                <> — at your yield, ≈ <b className="tabular-nums">{money(nextInvested)}</b> more invested</>
              )}.
            </span>
          </p>
        ) : (
          <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
            <Check className="h-4 w-4 flex-shrink-0" />
            Every recurring bill is covered — {money(cov.surplusMonthly)}/mth to spare.
          </p>
        )}

        {/* The ladder. */}
        <ul className="divide-y divide-gray-100">
          {cov.rows.map(({ expense: e, monthly, fundedFraction }) => {
            const covered = fundedFraction >= 1 - 1e-9;
            const partial = fundedFraction > 0 && !covered;
            return (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span className={cn('flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
                  covered ? 'bg-green-100 text-green-700'
                    : partial ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400')}>
                  {covered ? <Check className="h-3 w-3" /> : partial ? formatPercent(fundedFraction, 0) : ''}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-text-primary">{e.name}</span>
                  {e.category && <span className="ml-1.5 text-xs text-gray-400">{e.category}</span>}
                  {!covered && (
                    <span className="block h-1 mt-1 rounded-full bg-gray-100 overflow-hidden max-w-[8rem]">
                      <span className="block h-full bg-amber-400" style={{ width: `${fundedFraction * 100}%` }} />
                    </span>
                  )}
                </span>
                <span className="text-sm tabular-nums text-text-secondary flex-shrink-0">{money(monthly)}/mth</span>
                <span className="flex flex-shrink-0 gap-1">
                  <button onClick={() => setEditing(e)} className="p-1.5 rounded hover:bg-gray-100" aria-label={`Edit ${e.name}`}>
                    <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                  </button>
                  <button onClick={() => setDeleting(e)} className="p-1.5 rounded hover:bg-red-50" aria-label={`Delete ${e.name}`}>
                    <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>

        {oneOffs.length > 0 && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
            One-off (not in the ratio): {oneOffs.map((e) => `${e.name} ${money(monthlyAmount(e))}`).join(' · ')}
          </p>
        )}
      </Card>

      {adding && <ExpenseModal onClose={() => setAdding(false)} />}
      {editing && <ExpenseModal expense={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}`}
          message={`Remove "${deleting.name}" from your expenses? Coverage recomputes without it.`}
          confirmLabel="Delete"
          onConfirm={() => deleteExpense(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

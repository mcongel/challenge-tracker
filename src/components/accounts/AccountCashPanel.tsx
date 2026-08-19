import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { theadCls } from '../ui/Card';
import { FormError } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { Account, ParkedCashEvent } from '../../lib/engine';
import { roundCents } from '../../lib/engine';
import {
  cn, errorMessage, formatCurrency, inputCls, money, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../../lib/utils';

const CASH_TYPE_STYLES: Record<string, string> = {
  deposit: 'bg-green-50 text-green-700',
  interest: 'bg-sky-50 text-sky-700',
  withdrawal: 'bg-orange-50 text-orange-700',
  fee: 'bg-red-50 text-red-700',
  adjustment: 'bg-gray-100 text-gray-600',
};

export function AccountCashPanel({ account }: { account: Account }) {
  const {
    accountCash, parkedCashEvents, addParkedCashEvent, deleteParkedCashEvent, reconcileAccountCash,
  } = useData();
  const cash = accountCash(account.id);
  const events = parkedCashEvents.filter((e) => e.accountId === account.id).slice().reverse();

  const [type, setType] = useState<ParkedCashEvent['type']>('deposit');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [actual, setActual] = useState('');
  const [reconcileNote, setReconcileNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ParkedCashEvent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const breakdown: { label: string; value: number; signed?: boolean }[] = [
    { label: 'sales', value: cash.saleProceeds },
    { label: 'dividends', value: cash.cashDividends },
    { label: 'buys', value: -cash.purchases },
    { label: 'challenge', value: cash.challengeFlows, signed: true },
    { label: 'manual', value: cash.manual, signed: true },
  ];

  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amt = Number(amount);
    if (!amt || (type !== 'adjustment' && amt <= 0)) return setFormError('Amount must be positive (adjustments may be negative).');
    setBusy(true);
    try {
      await addParkedCashEvent({ accountId: account.id, date, type, amount: roundCents(amt), notes: notes || null });
      setAmount(''); setNotes('');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setFormError(null);
    setReconcileNote(null);
    const target = Number(actual);
    if (actual === '' || Number.isNaN(target)) return setFormError('Enter the actual balance from the brokerage.');
    setBusy(true);
    try {
      const { adjusted, diff } = await reconcileAccountCash(account.id, target);
      setActual('');
      setReconcileNote(
        adjusted
          ? `Adjusted by ${diff >= 0 ? '+' : '−'}${formatCurrency(Math.abs(diff))} — tracked cash now matches.`
          : '✓ Matches — no adjustment needed.',
      );
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pb-4 space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-xs font-medium text-gray-500">Tracked cash</p>
          <p className="text-2xl font-bold tabular-nums text-gray-900">
            {money(cash.balance)}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pb-0.5">
          {breakdown.map(({ label, value, signed }) => (
            <div key={label}>
              <p className="text-[11px] text-gray-400">{label}</p>
              <p className={cn('text-sm font-medium tabular-nums',
                value < 0 ? 'text-red-600' : signed || value > 0 ? 'text-green-600' : 'text-gray-400')}>
                {value >= 0 ? '+' : '−'}{money(Math.abs(value))}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Reconcile — the piece that keeps the number honest. */}
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-green-700 mb-1.5">Reconcile to actual</p>
          <div className="flex gap-2">
            <input type="number" step="0.01" value={actual} placeholder="balance from the brokerage"
              onChange={(e) => setActual(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
            <button onClick={reconcile} disabled={busy} className={cn(primaryBtnCls, 'py-1.5')}>
              Reconcile
            </button>
          </div>
          <p className="text-[11px] text-green-700/80 mt-1">
            Writes an adjustment for the difference. First time? This sets your opening balance.
            A monthly glance keeps it true.
          </p>
          {reconcileNote && (
            <p className="text-xs font-medium text-green-800 mt-1.5">{reconcileNote}</p>
          )}
        </div>

        <form onSubmit={addEvent} className="rounded-md border border-gray-200 px-3 py-2.5 space-y-2">
          <p className="text-xs font-semibold text-gray-500">Add movement (external money, interest, fees)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as ParkedCashEvent['type'])} className={inputCls}>
              <option value="deposit">deposit</option>
              <option value="withdrawal">withdrawal</option>
              <option value="interest">interest</option>
              <option value="fee">fee</option>
              <option value="adjustment">adjustment</option>
            </select>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="number" step="any" required value={amount} placeholder="$"
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-2">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes" className={inputCls} />
            <button type="submit" disabled={busy} className={secondaryBtnCls}>Add</button>
          </div>
          <p className="text-[11px] text-gray-400">
            Trims, buys, dividends, and challenge funding flow in automatically — only enter what
            the app can't see.
          </p>
        </form>
      </div>

      <FormError message={formError} />

      {events.length > 0 && (
        <div className="max-h-96 overflow-y-auto rounded-md border border-gray-200">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className={theadCls}>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-1 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 tabular-nums text-gray-500 w-24">{e.date}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', CASH_TYPE_STYLES[e.type])}>
                      {e.type}
                    </span>
                  </td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums font-medium',
                    (e.type === 'withdrawal' || e.type === 'fee' || e.amount < 0) ? 'text-red-600' : 'text-green-600')}>
                    {formatCurrency(e.amount)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-400 text-xs">{e.notes}</td>
                  <td className="px-1 py-1.5 w-8">
                    <button onClick={() => setDeleting(e)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete cash event">
                      <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete cash movement"
          message={`Delete this ${deleting.type} (${formatCurrency(deleting.amount)}) from ${deleting.date}? The tracked balance recomputes without it.`}
          onConfirm={() => deleteParkedCashEvent(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

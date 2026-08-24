import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { AccountSelect } from '../ui/AccountSelect';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import { fundedFromDefault, monthlyAmount } from '../../lib/engine';
import { cn, inputCls, todayISO } from '../../lib/utils';

/** Record an actual withdrawal that paid a bill (Phase 3). Writes a parked
 * withdrawal tagged to the expense and flagged income vs principal — the
 * funded-from default is inferred from the account's remaining dividend-cash
 * pool, then overridable. */
export function PayExpenseModal({ presetExpenseId, onClose }: { presetExpenseId?: string; onClose: () => void }) {
  const { expenses, accounts, parkedCashEvents, accountCash, addParkedCashEvent } = useData();
  const activeExpenses = expenses.filter((e) => e.active);

  const [expenseId, setExpenseId] = useState(presetExpenseId ?? '');
  const preset = activeExpenses.find((e) => e.id === expenseId);
  const [amount, setAmount] = useState(preset ? String(Math.round(monthlyAmount(preset) * 100) / 100) : '');
  // Where the money is drawn from — brokerage/bank/retirement, not challenge.
  const sourceAccounts = accounts.filter((a) => a.kind !== 'challenge');
  const [accountId, setAccountId] = useState(sourceAccounts[0]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [fundedFrom, setFundedFrom] = useState<'income' | 'principal'>('income');
  const [touchedFunded, setTouchedFunded] = useState(false);
  const [notes, setNotes] = useState('');

  // Inferred default: income while the account's cash-dividend pool (minus
  // prior income-funded withdrawals) still covers this payment.
  const inferred = useMemo(() => {
    if (!accountId) return 'income' as const;
    const pool = accountCash(accountId).cashDividends -
      parkedCashEvents
        .filter((e) => e.accountId === accountId && e.fundedFrom === 'income')
        .reduce((t, e) => t + e.amount, 0);
    return fundedFromDefault(Number(amount) || 0, pool);
  }, [accountId, amount, accountCash, parkedCashEvents]);
  const effectiveFunded = touchedFunded ? fundedFrom : inferred;

  const onExpense = (id: string) => {
    setExpenseId(id);
    const e = activeExpenses.find((x) => x.id === id);
    if (e && !amount) setAmount(String(Math.round(monthlyAmount(e) * 100) / 100));
  };

  const { busy, formError, submit } = useModalForm(async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error('Enter the amount paid.');
    if (!accountId) throw new Error('Pick the account it came from.');
    if (!date) throw new Error('Enter the date.');
    const label = preset?.name ?? 'expenses';
    await addParkedCashEvent({
      accountId,
      date,
      type: 'withdrawal',
      amount: amt,
      expenseId: expenseId || null,
      fundedFrom: effectiveFunded,
      notes: notes || `Paid ${label}`,
    });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title="Record a payment">
      <form onSubmit={submit} className="space-y-3">
        <Field label="For which expense">
          <select value={expenseId} onChange={(e) => onExpense(e.target.value)} className={inputCls}>
            <option value="">General withdrawal (untagged)</option>
            {activeExpenses.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ($)">
            <input type="number" step="0.01" min="0" required value={amount}
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Date">
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <AccountSelect accounts={sourceAccounts} value={accountId} onChange={setAccountId}
          label="Withdrawn from" allowNone={false} />
        <Field label="Paid from" hint={touchedFunded ? undefined : `Inferred: ${inferred === 'income' ? 'dividend income' : 'principal'}`}>
          <div className="flex gap-2">
            {(['income', 'principal'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => { setFundedFrom(f); setTouchedFunded(true); }}
                className={cn('flex-1 rounded-md border px-3 py-1.5 text-sm font-medium',
                  effectiveFunded === f
                    ? f === 'income' ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-amber-500 bg-amber-50 text-amber-800'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50')}
              >
                {f === 'income' ? 'Dividend income' : 'Principal'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Notes (optional)">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Records a withdrawal from the account (reducing its tracked cash). "Principal" means you
          dipped into invested money — the honest signal you outspent the yield.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Record payment" busyLabel="Recording…" onCancel={onClose} />
      </form>
    </Modal>
  );
}

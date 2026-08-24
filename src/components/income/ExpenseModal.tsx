import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { Expense, ExpenseCadence } from '../../lib/engine';
import { inputCls } from '../../lib/utils';

const CADENCES: { value: ExpenseCadence; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'once', label: 'One-off' },
];

/** Add or edit a living expense. One-offs are recorded but sit outside the
 * monthly coverage ratio (they'd distort it). */
export function ExpenseModal({ expense, onClose }: { expense?: Expense | null; onClose: () => void }) {
  const { addExpense, updateExpense } = useData();
  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [cadence, setCadence] = useState<ExpenseCadence>(expense?.cadence ?? 'monthly');
  const [dueDate, setDueDate] = useState(expense?.dueDate ?? '');
  const [category, setCategory] = useState(expense?.category ?? '');
  const [active, setActive] = useState(expense?.active ?? true);

  const { busy, formError, submit } = useModalForm(async () => {
    const amt = Number(amount);
    if (!name.trim()) throw new Error('Give the expense a name.');
    if (!amt || amt <= 0) throw new Error('Amount must be a positive number.');
    if (cadence === 'once' && !dueDate) throw new Error('A one-off needs its date.');
    const payload = {
      name: name.trim(), amount: amt, cadence,
      // Monthly bills hit every month, so a due date is meaningless for them.
      dueDate: cadence === 'monthly' ? null : dueDate || null,
      category: category.trim() || null, active,
    };
    if (expense) await updateExpense(expense.id, payload);
    else await addExpense(payload);
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={expense ? `Edit — ${expense.name}` : 'Add expense'}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <input required value={name} onChange={(e) => setName(e.target.value)}
            className={inputCls} placeholder="Rent, phone, groceries…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ($)">
            <input type="number" step="0.01" min="0" required value={amount}
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Cadence">
            <select value={cadence} onChange={(e) => setCadence(e.target.value as ExpenseCadence)} className={inputCls}>
              {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        {cadence !== 'monthly' && (
          <Field
            label={cadence === 'once' ? 'Date due' : 'Month due (recurs yearly)'}
            hint={cadence === 'annual' ? 'Only the month is used; leave blank to spread evenly.' : undefined}
          >
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              required={cadence === 'once'} className={inputCls} />
          </Field>
        )}
        {cadence === 'once' && (
          <p className="text-xs text-gray-400">
            One-off costs are tracked for planning but stay out of the monthly coverage ratio.
          </p>
        )}
        <Field label="Category (optional)" hint="Display grouping only — coverage snowballs by amount, not category.">
          <input value={category} onChange={(e) => setCategory(e.target.value)}
            className={inputCls} placeholder="Housing, Food, …" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Active — counts toward coverage
        </label>
        <FormError message={formError} />
        <ModalFooter busy={busy} label={expense ? 'Save' : 'Add expense'} onCancel={onClose} />
      </form>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useData } from '../../contexts/DataContext';
import type { Account, AccountKind, ParkedCashEvent } from '../../lib/engine';
import { daysBetween, roundCents } from '../../lib/engine';
import {
  cn, errorMessage, formatCurrency, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../../lib/utils';

const KIND_STYLES: Record<AccountKind, string> = {
  challenge: 'bg-green-50 text-green-700',
  outside: 'bg-indigo-50 text-indigo-700',
  bank: 'bg-sky-50 text-sky-700',
  retirement: 'bg-purple-50 text-purple-700',
};

export function AccountsModal({ onClose }: { onClose: () => void }) {
  const { accounts, addAccount, accountCash, parkedCashEvents } = useData();
  // Last reconcile per account, one pass — the rows written by the reconcile
  // flow all carry a 'Reconciled…' note (including zero-diff "matched" ones).
  const lastReconciledByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of parkedCashEvents) {
      if (!e.notes?.startsWith('Reconciled')) continue;
      const prev = m.get(e.accountId);
      if (!prev || e.date > prev) m.set(e.accountId, e.date);
    }
    return m;
  }, [parkedCashEvents]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [broker, setBroker] = useState('');
  const [flavor, setFlavor] = useState('');
  const [cashFor, setCashFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Account | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (accounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      return setFormError(`An account named "${trimmed}" already exists.`);
    }
    setBusy(true);
    try {
      await addAccount(trimmed, kind, broker.trim() || undefined, flavor.trim() || undefined);
      setName(''); setBroker(''); setFlavor('');
    } catch (err) {
      // 23505 = unique violation — races past the client-side check.
      const isDuplicate = typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
      setFormError(
        isDuplicate
          ? `An account named "${trimmed}" already exists.`
          : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Accounts">
      <div className="space-y-4">
        <p className="text-sm text-gray-500 -mt-1">
          Click an account to see its tracked cash, add movements, and reconcile.
        </p>
        <div className="space-y-1.5">
          {accounts.map((a) => {
            const tracked = a.kind === 'challenge' ? null : accountCash(a.id).balance;
            if (tracked === null) {
              return (
                <div key={a.id} className="rounded-lg border border-gray-200 px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-700 truncate">{a.name}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
                      {a.kind}
                    </span>
                    <button onClick={() => setRenaming(a)} className="ml-auto p-1 rounded hover:bg-gray-100" aria-label={`Rename ${a.name}`}>
                      <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">its cash lives on the Cash Ledger</p>
                </div>
              );
            }
            const lastRec = lastReconciledByAccount.get(a.id);
            const recDays = lastRec ? daysBetween(lastRec, todayISO()) : null;
            const recLabel = recDays == null
              ? ' · never reconciled'
              : ` · reconciled ${recDays <= 0 ? 'today' : `${recDays}d ago`}`;
            return (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => setCashFor(a.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setCashFor(a.id); }}
                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-700 truncate">{a.name}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
                      {a.kind}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenaming(a); }}
                      className="p-1 rounded hover:bg-gray-100"
                      aria-label={`Rename ${a.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                    </button>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </div>
                <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">
                  {formatCurrency(roundCents(tracked))}
                </p>
                <p className="text-xs text-gray-400">
                  tracked cash · view history & reconcile{recLabel}
                </p>
              </div>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">Add account</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                className={inputCls} placeholder="Ally Savings" />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={inputCls}>
                <option value="bank">bank</option>
                <option value="outside">outside</option>
                <option value="retirement">retirement</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Broker / institution (optional)</label>
            <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputCls} />
          </div>
          {kind === 'retirement' && (
            <div>
              <label className={labelCls}>Flavor (Roth / traditional / 401k…)</label>
              <input value={flavor} onChange={(e) => setFlavor(e.target.value)} className={inputCls}
                placeholder="Roth IRA" list="retirement-flavors" />
              <datalist id="retirement-flavors">
                <option value="Roth IRA" /><option value="Traditional IRA" />
                <option value="401k" /><option value="Roth 401k" />
                <option value="403b" /><option value="457b" /><option value="457b Roth" />
                <option value="ORP" /><option value="HSA" />
              </datalist>
              <p className="mt-0.5 text-xs text-gray-400">
                Retirement holdings get their own page — never in the pile's total, cap, or taxes.
              </p>
            </div>
          )}
          {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={primaryBtnCls}>
              {busy ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
        <p className="text-xs text-gray-400">
          Accounts are labels for where money lives — they never change the score. Cash figures are
          tracked strategy cash, not a claim about your real balance — reconcile monthly.
        </p>
      </div>

      {cashFor && (
        <AccountCashModal
          account={accounts.find((a) => a.id === cashFor)!}
          onClose={() => setCashFor(null)}
        />
      )}
      {renaming && <RenameAccountModal account={renaming} onClose={() => setRenaming(null)} />}
    </Modal>
  );
}

function RenameAccountModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { accounts, updateAccount } = useData();
  const [name, setName] = useState(account.name);
  const [broker, setBroker] = useState(account.broker ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) return setFormError('Name required.');
    if (accounts.some((a) => a.id !== account.id && a.name.toLowerCase() === trimmed.toLowerCase())) {
      return setFormError(`An account named "${trimmed}" already exists.`);
    }
    setBusy(true);
    try {
      await updateAccount(account.id, { name: trimmed, broker: broker.trim() || null });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Rename ${account.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Name</label>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Broker / institution (optional)</label>
          <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Labels only — history, cash, and holdings all reference the account by id, so nothing
          else moves. The kind ({account.kind}) can't change; it steers ledger and pile logic.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

const CASH_TYPE_STYLES: Record<string, string> = {
  deposit: 'bg-green-50 text-green-700',
  interest: 'bg-sky-50 text-sky-700',
  withdrawal: 'bg-orange-50 text-orange-700',
  fee: 'bg-red-50 text-red-700',
  adjustment: 'bg-gray-100 text-gray-600',
};

function AccountCashModal({ account, onClose }: { account: Account; onClose: () => void }) {
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
      setFormError(err instanceof Error ? err.message : String(err));
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
    <Modal isOpen onClose={onClose} title={`${account.name} — tracked cash`}>
      <div className="space-y-4">
        <div>
          <p className="text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(cash.balance))}</p>
          <p className="text-xs text-gray-400 tabular-nums">
            sales +{formatCurrency(roundCents(cash.saleProceeds))} · dividends +{formatCurrency(roundCents(cash.cashDividends))} ·
            buys −{formatCurrency(roundCents(cash.purchases))} · challenge {cash.challengeFlows >= 0 ? '+' : '−'}{formatCurrency(roundCents(Math.abs(cash.challengeFlows)))} ·
            manual {cash.manual >= 0 ? '+' : '−'}{formatCurrency(roundCents(Math.abs(cash.manual)))}
          </p>
        </div>

        {/* Reconcile — the piece that keeps the number honest. */}
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-green-700 mb-1.5">
            Reconcile to actual
          </p>
          <div className="flex gap-2">
            <input type="number" step="0.01" value={actual} placeholder="balance from the brokerage"
              onChange={(e) => setActual(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
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

        {events.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
            <table className="w-full text-sm">
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
                    <td className="px-3 py-1.5 text-gray-400 text-xs max-w-[10rem] truncate">{e.notes}</td>
                    <td className="px-1 py-1.5 w-8">
                      <button onClick={() => setDeleting(e)} className="p-1 rounded hover:bg-red-50" aria-label="Delete cash event">
                        <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={addEvent} className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">Add movement (external money, interest, fees)</p>
          <div className="grid grid-cols-3 gap-2">
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
        </form>
        <p className="text-xs text-gray-400">
          Trims, buys, dividends, and challenge funding flow in automatically — only enter what the
          app can't see. Tracked strategy cash, never a claim about the real balance.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete cash movement"
          message={`Delete this ${deleting.type} (${formatCurrency(deleting.amount)}) from ${deleting.date}? The tracked balance recomputes without it.`}
          onConfirm={() => deleteParkedCashEvent(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}

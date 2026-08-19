import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { useData } from '../contexts/DataContext';
import type { Account, AccountKind, ParkedCashEvent } from '../lib/engine';
import { daysBetween, parkedMarketValue, roundCents } from '../lib/engine';
import {
  cn, errorMessage, formatCurrency, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';

const KIND_STYLES: Record<AccountKind, string> = {
  challenge: 'bg-green-50 text-green-700',
  outside: 'bg-indigo-50 text-indigo-700',
  bank: 'bg-sky-50 text-sky-700',
  retirement: 'bg-purple-50 text-purple-700',
};

/** Display order mirrors the app's walls: score money first, then context. */
const KIND_SECTIONS: { kind: AccountKind; label: string; blurb: string }[] = [
  { kind: 'challenge', label: 'Challenge', blurb: 'the trading account — its cash lives on the Cash Ledger' },
  { kind: 'bank', label: 'Bank', blurb: 'cash parking — deposits, interest, the tax reserve' },
  { kind: 'outside', label: 'Outside brokerage', blurb: 'taxable accounts holding the parked pile' },
  { kind: 'retirement', label: 'Retirement', blurb: 'behind its own wall — never in pile or score math' },
];

const FLAVOR_DATALIST = (
  <datalist id="retirement-flavors">
    <option value="Roth IRA" /><option value="Traditional IRA" />
    <option value="401k" /><option value="Roth 401k" />
    <option value="403b" /><option value="457b" /><option value="457b Roth" />
    <option value="ORP" /><option value="HSA" />
  </datalist>
);

/** Everything that points at an account, split into what blocks structural
 * changes (delete / kind change) vs the account's own manual cash rows,
 * which delete along with it. */
interface AccountUsage {
  holdings: number;
  pileSales: number;
  ledgerRows: number;
  outsideSaleRows: number;
  cashMovements: number;
}

function usageBlockers(u: AccountUsage): string[] {
  const part = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const out: string[] = [];
  if (u.holdings > 0) out.push(part(u.holdings, 'holding'));
  if (u.pileSales > 0) out.push(part(u.pileSales, 'pile sale'));
  if (u.ledgerRows > 0) out.push(part(u.ledgerRows, 'ledger row'));
  if (u.outsideSaleRows > 0) out.push(part(u.outsideSaleRows, 'outside-sale record'));
  return out;
}

export function Accounts() {
  const {
    accounts, parked, parkedSales, outsideSales, cashEvents, parkedCashEvents,
    accountCash, deleteAccount, loading, error,
  } = useData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

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

  const usageById = useMemo(() => {
    const m = new Map<string, AccountUsage>();
    const get = (id: string): AccountUsage => {
      let u = m.get(id);
      if (!u) { u = { holdings: 0, pileSales: 0, ledgerRows: 0, outsideSaleRows: 0, cashMovements: 0 }; m.set(id, u); }
      return u;
    };
    for (const p of parked) get(p.accountId).holdings += 1;
    for (const s of parkedSales) get(s.accountId).pileSales += 1;
    for (const s of outsideSales) get(s.accountId).outsideSaleRows += 1;
    for (const e of cashEvents) {
      if (e.accountId) get(e.accountId).ledgerRows += 1;
      if (e.destinationAccountId) get(e.destinationAccountId).ledgerRows += 1;
    }
    for (const e of parkedCashEvents) get(e.accountId).cashMovements += 1;
    return m;
  }, [parked, parkedSales, outsideSales, cashEvents, parkedCashEvents]);

  const EMPTY_USAGE: AccountUsage = { holdings: 0, pileSales: 0, ledgerRows: 0, outsideSaleRows: 0, cashMovements: 0 };
  const usageOf = (id: string) => usageById.get(id) ?? EMPTY_USAGE;

  const holdingsValue = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of parked) {
      m.set(p.accountId, (m.get(p.accountId) ?? 0) + parkedMarketValue(p));
    }
    return m;
  }, [parked]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  if (loading) return <div><PageHeader title="Accounts" /><SkeletonTable /></div>;

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Where money lives — labels and context only, never score math. Tracked cash is what the app routed here, not a claim about the real balance."
        actions={
          <button onClick={() => setAdding(true)} className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Add account
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          hint="Add your bank, outside brokerage, and retirement accounts — every holding and cash movement hangs off one."
        />
      ) : (
        <div className="space-y-5">
          {KIND_SECTIONS.map(({ kind, label, blurb }) => {
            const group = accounts
              .filter((a) => a.kind === kind)
              .sort((a, b) => a.name.localeCompare(b.name));
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {label} <span className="normal-case font-normal tracking-normal">— {blurb}</span>
                </p>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {group.map((a) => (
                    <AccountCard
                      key={a.id}
                      account={a}
                      selected={a.id === selectedId}
                      onSelect={() => setSelectedId(a.id === selectedId ? null : a.id)}
                      tracked={a.kind === 'challenge' ? null : accountCash(a.id).balance}
                      holdings={usageOf(a.id).holdings > 0 ? { value: holdingsValue.get(a.id) ?? 0 } : null}
                      lastReconciled={lastReconciledByAccount.get(a.id) ?? null}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {selected ? (
            <AccountDetail
              account={selected}
              usage={usageOf(selected.id)}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
            />
          ) : (
            <p className="text-xs text-gray-400 text-center">
              Select an account to see its tracked cash, reconcile, or edit it.
            </p>
          )}
        </div>
      )}

      {adding && <AccountFormModal onClose={() => setAdding(false)} />}
      {editing && (
        <AccountFormModal
          account={editing}
          usage={usageOf(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}`}
          message={
            `Delete the account "${deleting.name}"? Nothing references it` +
            (usageOf(deleting.id).cashMovements > 0
              ? `, but its ${usageOf(deleting.id).cashMovements} manual cash movement${usageOf(deleting.id).cashMovements === 1 ? '' : 's'} (reconciles included) go with it.`
              : ', so nothing else changes.')
          }
          onConfirm={async () => {
            await deleteAccount(deleting.id);
            if (selectedId === deleting.id) setSelectedId(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function AccountCard({ account: a, selected, onSelect, tracked, holdings, lastReconciled }: {
  account: Account;
  selected: boolean;
  onSelect: () => void;
  /** null = challenge account (its cash is the ledger's business). */
  tracked: number | null;
  holdings: { value: number } | null;
  lastReconciled: string | null;
}) {
  const recDays = lastReconciled ? daysBetween(lastReconciled, todayISO()) : null;
  return (
    <button
      onClick={onSelect}
      className={cn(
        'text-left bg-white rounded-lg shadow-lg p-4 density-aware-card transition-shadow hover:shadow-xl',
        selected && 'ring-2 ring-green-600',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-bold text-gray-900 truncate">{a.name}</span>
        <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
          {a.kind}
        </span>
        {a.retirementFlavor && (
          <span className="flex-shrink-0 rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
            {a.retirementFlavor}
          </span>
        )}
      </div>
      {a.broker && <p className="text-xs text-gray-400 mt-0.5 truncate">{a.broker}</p>}
      {tracked === null ? (
        <p className="text-xs text-gray-400 mt-2">
          cash on the Cash Ledger · score math lives here
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg sm:text-xl font-bold tabular-nums text-gray-900">
            {formatCurrency(roundCents(tracked))}
          </p>
          <p className="text-xs text-gray-400">
            tracked cash
            {holdings && <> · {formatCurrency(roundCents(holdings.value))} held</>}
            {' · '}
            {recDays == null ? 'never reconciled' : `reconciled ${recDays <= 0 ? 'today' : `${recDays}d ago`}`}
          </p>
        </>
      )}
    </button>
  );
}

const CASH_TYPE_STYLES: Record<string, string> = {
  deposit: 'bg-green-50 text-green-700',
  interest: 'bg-sky-50 text-sky-700',
  withdrawal: 'bg-orange-50 text-orange-700',
  fee: 'bg-red-50 text-red-700',
  adjustment: 'bg-gray-100 text-gray-600',
};

function AccountDetail({ account, usage, onEdit, onDelete }: {
  account: Account;
  usage: AccountUsage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const blockers = usageBlockers(usage);
  const deletable = account.kind !== 'challenge' && blockers.length === 0;
  const deleteTitle = account.kind === 'challenge'
    ? 'The challenge account is the scoreboard — it stays.'
    : blockers.length > 0
      ? `Still referenced: ${blockers.join(' · ')}. Move or delete those first.`
      : 'Delete this empty account';

  return (
    <div className="bg-white rounded-lg shadow-lg density-aware-card">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h2 className="text-lg font-bold text-gray-900 truncate">{account.name}</h2>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[account.kind])}>
          {account.kind}
        </span>
        {account.retirementFlavor && (
          <span className="rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
            {account.retirementFlavor}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={onEdit} className={cn(secondaryBtnCls, 'flex items-center gap-1.5 py-1.5')}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            onClick={onDelete}
            disabled={!deletable}
            title={deleteTitle}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-white transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {account.kind === 'challenge' ? (
        <p className="px-4 pb-4 pt-2 text-sm text-gray-500">
          This is the trading account — its cash, deposits, and skims all live on the{' '}
          <Link to="/ledger" className="font-medium text-green-700 hover:underline">Cash Ledger</Link>.
        </p>
      ) : (
        <AccountCashPanel account={account} />
      )}
    </div>
  );
}

function AccountCashPanel({ account }: { account: Account }) {
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
            {formatCurrency(roundCents(cash.balance))}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pb-0.5">
          {breakdown.map(({ label, value, signed }) => (
            <div key={label}>
              <p className="text-[11px] text-gray-400">{label}</p>
              <p className={cn('text-sm font-medium tabular-nums',
                value < 0 ? 'text-red-600' : signed || value > 0 ? 'text-green-600' : 'text-gray-400')}>
                {value >= 0 ? '+' : '−'}{formatCurrency(roundCents(Math.abs(value)))}
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

      {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}

      {events.length > 0 && (
        <div className="max-h-96 overflow-y-auto rounded-md border border-gray-200">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
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

/** One form for both create and edit. Kind is offered on create and on edits
 * of accounts nothing structural references yet — the wall between pile and
 * retirement means a kind change re-routes future holdings, so a referenced
 * account's kind stays put. */
function AccountFormModal({ account, usage, onClose }: {
  account?: Account;
  usage?: AccountUsage;
  onClose: () => void;
}) {
  const { accounts, addAccount, updateAccount } = useData();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank');
  const [broker, setBroker] = useState(account?.broker ?? '');
  const [flavor, setFlavor] = useState(account?.retirementFlavor ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blockers = usage ? usageBlockers(usage) : [];
  const kindLocked = account !== undefined && (account.kind === 'challenge' || blockers.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) return setFormError('Name required.');
    if (accounts.some((a) => a.id !== account?.id && a.name.toLowerCase() === trimmed.toLowerCase())) {
      return setFormError(`An account named "${trimmed}" already exists.`);
    }
    setBusy(true);
    try {
      if (account) {
        await updateAccount(account.id, {
          name: trimmed,
          broker: broker.trim() || null,
          ...(kindLocked ? {} : { kind }),
          retirementFlavor: (kindLocked ? account.kind : kind) === 'retirement' ? flavor.trim() || null : null,
        });
      } else {
        await addAccount(trimmed, kind, broker.trim() || undefined, flavor.trim() || undefined);
      }
      onClose();
    } catch (err) {
      // 23505 = unique violation — races past the client-side check.
      const isDuplicate = typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
      setFormError(isDuplicate ? `An account named "${trimmed}" already exists.` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const effectiveKind = kindLocked && account ? account.kind : kind;

  return (
    <Modal isOpen onClose={onClose} title={account ? `Edit ${account.name}` : 'Add account'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Name</label>
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)}
              className={inputCls} placeholder="Ally Savings" />
          </div>
          <div>
            <label className={labelCls}>Kind</label>
            {kindLocked && account ? (
              <input disabled value={account.kind} className={cn(inputCls, 'bg-gray-50 text-gray-500')} />
            ) : (
              <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={inputCls}>
                <option value="bank">bank</option>
                <option value="outside">outside</option>
                <option value="retirement">retirement</option>
              </select>
            )}
          </div>
        </div>
        <div>
          <label className={labelCls}>Broker / institution (optional)</label>
          <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputCls} />
        </div>
        {effectiveKind === 'retirement' && (
          <div>
            <label className={labelCls}>Flavor (Roth / traditional / 401k…)</label>
            <input value={flavor} onChange={(e) => setFlavor(e.target.value)} className={inputCls}
              placeholder="Roth IRA" list="retirement-flavors" />
            {FLAVOR_DATALIST}
            <p className="mt-0.5 text-xs text-gray-400">
              Retirement holdings get their own page — never in the pile's total, cap, or taxes.
            </p>
          </div>
        )}
        <p className="text-xs text-gray-400">
          {account
            ? kindLocked && account.kind !== 'challenge'
              ? `Kind is locked while the account is referenced (${blockers.join(' · ')}) — it steers pile vs retirement logic.`
              : 'History, cash, and holdings reference the account by id — relabeling moves nothing.'
            : 'Accounts are labels for where money lives — they never change the score.'}
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : account ? 'Save' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

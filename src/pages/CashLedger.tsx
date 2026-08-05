import { useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { useData } from '../contexts/DataContext';
import { ContributionCapBadge } from '../components/ui/ContributionCapBadge';
import type { CashEventType } from '../lib/engine';
import {
  cashSummary, contributionStatus, depositExceedsCap, netContributed, roundCents,
  withRunningBalance,
} from '../lib/engine';
import {
  cn, formatCurrency, formatCurrencyWhole, inputCls, labelCls, primaryBtnCls, todayISO,
} from '../lib/utils';

const TYPES: CashEventType[] = [
  'Deposit', 'Withdrawal', 'Buy', 'Sell', 'Dividend', 'TaxSkim', 'MilestoneBank', 'Fee',
];

const TYPE_STYLES: Record<CashEventType, string> = {
  Deposit: 'bg-green-50 text-green-700',
  Sell: 'bg-teal-50 text-teal-700',
  Dividend: 'bg-sky-50 text-sky-700',
  Buy: 'bg-indigo-50 text-indigo-700',
  Withdrawal: 'bg-orange-50 text-orange-700',
  TaxSkim: 'bg-yellow-50 text-yellow-700',
  MilestoneBank: 'bg-emerald-50 text-emerald-700',
  Fee: 'bg-red-50 text-red-700',
};

const ADDS_CASH: CashEventType[] = ['Deposit', 'Sell', 'Dividend'];

export function CashLedger() {
  const { cashEvents, addCashEvent, deleteCashEvent, contributionCap, loading, error } = useData();
  const [modalOpen, setModalOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = withRunningBalance(cashEvents);
  const summary = cashSummary(cashEvents);

  const remove = async (id: string) => {
    if (!confirm('Delete this event? A deposit’s shadow VOO twin goes with it.')) return;
    try {
      await deleteCashEvent(id);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Cash Ledger"
        subtitle="Every dollar in and out. Running balance beside each row."
        actions={
          <button onClick={() => setModalOpen(true)} className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Add event
          </button>
        }
      />

      {error && <ErrorCard message={error} />}
      {rowError && <ErrorCard message={rowError} />}

      {/* Summary block */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          ['Deposits', summary.deposits],
          ['Withdrawals', summary.withdrawals],
          ['Net contributed', summary.netContributed],
          ['Current cash', roundCents(summary.currentCash)],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={cn('mt-0.5 text-xl font-bold tabular-nums',
              (value as number) < 0 ? 'text-red-600' : 'text-gray-900')}>
              {formatCurrency(value as number)}
            </p>
            {label === 'Net contributed' && (
              <ContributionCapBadge netContributed={summary.netContributed} cap={contributionCap} />
            )}
          </div>
        ))}
      </div>

      {loading ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No cash events yet"
          hint="Start with the funding deposit. Adding a deposit also records that day's shadow VOO purchase for the benchmark."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Source / notes</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Running</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ event: e, balance }) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-gray-600">{e.date}</td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', TYPE_STYLES[e.type])}>
                      {e.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{e.ticker ?? ''}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[16rem] truncate">
                    {[e.sourceDestination, e.notes].filter(Boolean).join(' · ')}
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums font-medium',
                    ADDS_CASH.includes(e.type) ? 'text-green-600' : 'text-gray-900')}>
                    {ADDS_CASH.includes(e.type) ? '+' : '−'}{formatCurrency(e.amount)}
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums font-bold',
                    balance < 0 ? 'text-red-600' : 'text-gray-900')}>
                    {formatCurrency(roundCents(balance))}
                  </td>
                  <td className="px-2 py-3">
                    <button onClick={() => remove(e.id)} className="p-1 rounded hover:bg-red-50"
                      aria-label="Delete event">
                      <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddEventModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onAdd={addCashEvent} />
    </div>
  );
}

function AddEventModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (e: Parameters<ReturnType<typeof useData>['addCashEvent']>[0], voo?: number) => Promise<void>;
}) {
  const { cashEvents, contributionCap } = useData();
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<CashEventType>('Deposit');
  const [amount, setAmount] = useState('');
  const [ticker, setTicker] = useState('');
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');
  const [vooPrice, setVooPrice] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsTicker = ['Buy', 'Sell', 'Dividend'].includes(type);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setFormError('Amount must be positive — the type sets direction.');
    if (type === 'Deposit' && (!vooPrice || Number(vooPrice) <= 0)) {
      return setFormError("Deposits need that day's VOO price — it creates the shadow purchase for the honest test.");
    }
    // Rule 11: net contributed caps at the configured value. Refuse, don't warn.
    if (type === 'Deposit' && contributionCap !== null) {
      const contributed = netContributed(cashEvents);
      if (depositExceedsCap(contributed, amt, contributionCap)) {
        const room = contributionStatus(contributed, contributionCap).remaining;
        return setFormError(
          room > 0
            ? `Rule 11: this deposit would exceed the ${formatCurrencyWhole(contributionCap)} contribution cap — only ${formatCurrency(roundCents(room))} of room remains.`
            : `Rule 11: the ${formatCurrencyWhole(contributionCap)} contribution cap is reached — growth by trading only. Raising the cap requires beating VOO over a trailing 12 months.`,
        );
      }
    }
    setBusy(true);
    try {
      await onAdd(
        {
          date,
          type,
          amount: roundCents(amt),
          ticker: needsTicker && ticker ? ticker.toUpperCase() : null,
          sourceDestination: source || null,
          notes: notes || null,
        },
        type === 'Deposit' ? Number(vooPrice) : undefined,
      );
      setAmount(''); setTicker(''); setSource(''); setNotes(''); setVooPrice('');
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add cash event">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as CashEventType)} className={inputCls}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Amount ($)</label>
            <input type="number" step="0.01" min="0.01" required value={amount}
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          {needsTicker ? (
            <div>
              <label className={labelCls}>Ticker</label>
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputCls} placeholder="NBIS" />
            </div>
          ) : type === 'Deposit' ? (
            <div>
              <label className={labelCls}>VOO price today</label>
              <input type="number" step="0.01" min="0.01" value={vooPrice}
                onChange={(e) => setVooPrice(e.target.value)} className={inputCls} placeholder="620.00" />
            </div>
          ) : <div />}
        </div>
        <div>
          <label className={labelCls}>Source / destination</label>
          <input value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} placeholder="Cash App sales" />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {type === 'Deposit' && (
          <p className="text-xs text-gray-400">
            Every deposit buys shadow VOO the same day — that's the benchmark you're trying to beat.
          </p>
        )}
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : 'Add event'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="mb-4 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{message}</div>
  );
}

export function SkeletonTable() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

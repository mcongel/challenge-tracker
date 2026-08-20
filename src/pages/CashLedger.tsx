import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { useData } from '../contexts/DataContext';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { ContributionCapBadge } from '../components/ui/ContributionCapBadge';
import { Card, TableCard, theadCls } from '../components/ui/Card';
import { RowCard, RowCardStat } from '../components/ui/RowCard';
import { Field } from '../components/ui/Field';
import { FormError, ModalFooter, useModalForm } from '../components/ui/useModalForm';
import type { CashEvent, CashEventType } from '../lib/engine';
import {
  cashSummary, contributionStatus, depositExceedsCap, netContributed, roundCents,
  withRunningBalance,
} from '../lib/engine';
import {
  cn, formatCurrency, formatCurrencyWhole, inputCls, money, primaryBtnCls,
  todayISO,
} from '../lib/utils';
import { fetchClose } from '../lib/quotes';

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

function accountName(accounts: { id: string; name: string }[], id?: string | null): string | null {
  if (!id) return null;
  return accounts.find((a) => a.id === id)?.name ?? null;
}

/** Deleting a ledger row never touches its companion records — say exactly
 * what stays behind so a cleanup doesn't silently desync the books. */
function deleteWarning(e: CashEvent | undefined): string {
  switch (e?.type) {
    case 'Deposit':
      return 'Delete this deposit? Its shadow VOO twin goes with it, and net contributed drops.';
    case 'Buy':
      return 'Delete this Buy? The position lot keeps its shares — cash comes back while the stock stays, inflating the account. If the buy never happened, delete the lot too.';
    case 'Sell':
      return 'Delete this Sell? The Trade Log rows from the close remain — realized gains (and the 30% skim they drive) still count. If the sale never happened, delete those trades too.';
    case 'MilestoneBank':
      return 'Delete this bank transfer? The milestone record still counts its floor toward Total Score — the score and the ledger will disagree until the milestone is corrected too.';
    case 'TaxSkim':
      return 'Delete this skim? The reserved total drops and the quarter shows as due again on the Tax Reserve checklist.';
    default:
      return 'Delete this event? The running balance recomputes without it.';
  }
}

export function CashLedger() {
  const { cashEvents, addCashEvent, deleteCashEvent, contributionCap, accounts, loading, error } =
    useData();
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CashEvent | null>(null);

  // Balance walks forward chronologically; the table reads newest-first.
  const rows = withRunningBalance(cashEvents).slice().reverse();
  const summary = cashSummary(cashEvents);

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

      {/* Summary block */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {[
          ['Deposits', summary.deposits],
          ['Withdrawals', summary.withdrawals],
          ['Net contributed', summary.netContributed],
          ['Current cash', roundCents(summary.currentCash)],
        ].map(([label, value]) => (
          <Card key={label as string} className="p-4 density-aware-card">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={cn('mt-0.5 text-lg sm:text-xl font-bold tabular-nums',
              (value as number) < 0 ? 'text-red-600' : 'text-gray-900')}>
              {formatCurrency(value as number)}
            </p>
            {label === 'Net contributed' && (
              <ContributionCapBadge netContributed={summary.netContributed} cap={contributionCap} />
            )}
          </Card>
        ))}
      </div>
      {/* The rest of cashSummary, compact — the spec's full breakdown. */}
      <p className="mb-4 px-1 text-xs text-gray-500 tabular-nums">
        Buys −{money(summary.buys)} · Sells +{money(summary.sells)} ·
        Dividends +{money(summary.dividends)} · Tax skims −{money(summary.taxSkims)} ·
        Milestone banks −{money(summary.milestoneBanks)} · Fees −{money(summary.fees)}
      </p>

      {loading ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No cash events yet"
          hint="Start with the funding deposit. Adding a deposit also records that day's shadow VOO purchase for the benchmark."
        />
      ) : (
        <TableCard
          cards={rows.map(({ event: e, balance }) => {
            const note = [
              accountName(accounts, e.accountId) && `from ${accountName(accounts, e.accountId)}`,
              accountName(accounts, e.destinationAccountId) && `→ ${accountName(accounts, e.destinationAccountId)}`,
              e.sourceDestination,
              e.notes,
            ].filter(Boolean).join(' · ');
            return (
              <RowCard
                key={e.id}
                title={
                  <span className="flex items-center gap-1.5">
                    <span className="tabular-nums text-gray-600">{e.date}</span>
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', TYPE_STYLES[e.type])}>
                      {e.type}
                    </span>
                    {e.ticker && <span className="font-medium">{e.ticker}</span>}
                  </span>
                }
                value={
                  <span className={ADDS_CASH.includes(e.type) ? 'text-green-600' : undefined}>
                    {ADDS_CASH.includes(e.type) ? '+' : '−'}{formatCurrency(e.amount)}
                  </span>
                }
                actions={
                  <>
                    <button onClick={() => setEditing(e)} className="p-2 rounded hover:bg-gray-100" aria-label="Edit event">
                      <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                    </button>
                    <button onClick={() => setDeletingId(e.id)} className="p-2 rounded hover:bg-red-50" aria-label="Delete event">
                      <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                    </button>
                  </>
                }
              >
                {note && <p className="mt-1 text-xs text-gray-500 truncate">{note}</p>}
                <RowCardStat label="Running balance">
                  <span className={cn('font-bold', balance < 0 ? 'text-red-600' : 'text-text-primary')}>
                    {money(balance)}
                  </span>
                </RowCardStat>
              </RowCard>
            );
          })}
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className={theadCls}>
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
                  <td className="px-4 py-3 text-gray-500">
                    {/* max-width is ignored on table cells; the inner div is what actually truncates. */}
                    <div className="max-w-[16rem] truncate">
                      {[
                        accountName(accounts, e.accountId) && `from ${accountName(accounts, e.accountId)}`,
                        accountName(accounts, e.destinationAccountId) && `→ ${accountName(accounts, e.destinationAccountId)}`,
                        e.sourceDestination,
                        e.notes,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums font-medium',
                    ADDS_CASH.includes(e.type) ? 'text-green-600' : 'text-gray-900')}>
                    {ADDS_CASH.includes(e.type) ? '+' : '−'}{formatCurrency(e.amount)}
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums font-bold',
                    balance < 0 ? 'text-red-600' : 'text-gray-900')}>
                    {money(balance)}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <button onClick={() => setEditing(e)} className="p-2 sm:p-1 rounded hover:bg-gray-100"
                      aria-label="Edit event">
                      <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                    </button>
                    <button onClick={() => setDeletingId(e.id)} className="p-2 sm:p-1 rounded hover:bg-red-50"
                      aria-label="Delete event">
                      <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <AddEventModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onAdd={addCashEvent} />
      {editing && <EditEventModal event={editing} onClose={() => setEditing(null)} />}

      {deletingId && (
        <ConfirmModal
          title="Delete cash event"
          message={deleteWarning(cashEvents.find((e) => e.id === deletingId))}
          onConfirm={() => deleteCashEvent(deletingId)}
          onClose={() => setDeletingId(null)}
        />
      )}
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
  const { cashEvents, contributionCap, accounts, overrides, quotes } = useData();
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<CashEventType>('Deposit');
  const [amount, setAmount] = useState('');
  const [ticker, setTicker] = useState('');
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');
  const [vooPrice, setVooPrice] = useState('');
  // Same-day deposits prefill the shadow price from the live quote — ONCE
  // per open (the flag), so a deliberately cleared field is never refilled
  // by a background quote refresh. Resets when the modal closes.
  const [vooPrefilled, setVooPrefilled] = useState(false);
  const vooQuote = overrides['VOO'] ?? quotes['VOO'];
  useEffect(() => {
    if (!isOpen) {
      setVooPrefilled(false);
      return;
    }
    if (!vooPrefilled && type === 'Deposit' && date === todayISO() && vooPrice === '' && vooQuote) {
      setVooPrice(String(vooQuote));
      setVooPrefilled(true);
    }
  }, [isOpen, vooPrefilled, type, date, vooQuote, vooPrice]);
  // A backdated deposit must never keep today's quote — the shadow twin's
  // price is that DAY's price, and it is never re-derivable later.
  const changeDate = (d: string) => {
    setDate(d);
    if (d !== todayISO() && vooQuote && vooPrice === String(vooQuote)) setVooPrice('');
  };
  // Backdated dates auto-fill VOO's historical close instead of sending the
  // owner off to look it up. Once per date (the ref), so a deliberately
  // cleared field stays cleared; a fetch failure falls back to the hint.
  const [vooClose, setVooClose] = useState<{ requested: string; actual: string } | null>(null);
  const [closeFailedFor, setCloseFailedFor] = useState<string | null>(null);
  const closeFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen || type !== 'Deposit') return;
    if (date >= todayISO()) return; // same-day uses the live prefill
    if (vooPrice !== '' || closeFetchedFor.current === date) return;
    closeFetchedFor.current = date;
    let cancelled = false;
    void fetchClose('VOO', date).then((r) => {
      if (cancelled) return;
      if (!r) {
        setCloseFailedFor(date);
        return;
      }
      setVooPrice(String(Math.round(r.close * 100) / 100));
      setVooClose({ requested: date, actual: r.date });
    });
    return () => { cancelled = true; };
  }, [isOpen, type, date, vooPrice]);
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');

  const needsTicker = ['Buy', 'Sell', 'Dividend'].includes(type);
  const hasDestination = ['Withdrawal', 'TaxSkim', 'MilestoneBank'].includes(type);

  const { busy, formError, submit } = useModalForm(async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error('Amount must be positive — the type sets direction.');
    if (type === 'Deposit' && (!vooPrice || Number(vooPrice) <= 0)) {
      throw new Error("Deposits need that day's VOO price — it creates the shadow purchase for the honest test.");
    }
    // Rule 12: net contributed caps at the configured value. Refuse, don't warn.
    if (type === 'Deposit' && contributionCap !== null) {
      const contributed = netContributed(cashEvents);
      if (depositExceedsCap(contributed, amt, contributionCap)) {
        const room = contributionStatus(contributed, contributionCap).remaining;
        throw new Error(
          room > 0
            ? `Rule 12: this deposit would exceed the ${formatCurrencyWhole(contributionCap)} contribution cap — only ${money(room)} of room remains.`
            : `Rule 12: the ${formatCurrencyWhole(contributionCap)} contribution cap is reached — growth by trading only. Raising the cap requires beating VOO over a trailing 12 months.`,
        );
      }
    }
    await onAdd(
      {
        date,
        type,
        amount: roundCents(amt),
        ticker: needsTicker && ticker ? ticker.toUpperCase() : null,
        sourceDestination: source || null,
        accountId: type === 'Deposit' && fromAccount ? fromAccount : null,
        destinationAccountId: hasDestination && toAccount ? toAccount : null,
        notes: notes || null,
      },
      type === 'Deposit' ? Number(vooPrice) : undefined,
    );
    setAmount(''); setTicker(''); setSource(''); setNotes(''); setVooPrice('');
    onClose();
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add cash event">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" required value={date} onChange={(e) => changeDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as CashEventType)} className={inputCls}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ($)">
            <input type="number" step="0.01" min="0.01" required value={amount}
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </Field>
          {needsTicker ? (
            <Field label="Ticker">
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputCls} placeholder="NBIS" />
            </Field>
          ) : type === 'Deposit' ? (
            <Field label="VOO price today">
              <input type="number" step="0.01" min="0.01" value={vooPrice}
                onChange={(e) => setVooPrice(e.target.value)} className={inputCls} placeholder="620.00" />
              {vooQuote !== undefined && vooPrice === String(vooQuote) && date === todayISO() && (
                <p className="mt-0.5 text-xs text-gray-400">from the live quote — edit if needed</p>
              )}
              {date !== todayISO() && (
                <p className="mt-0.5 text-xs text-gray-400">
                  {vooClose?.requested === date && vooPrice !== ''
                    ? `VOO close ${vooClose.actual === date ? 'that day' : `on ${vooClose.actual} (nearest session)`} — fetched; edit if needed`
                    : closeFailedFor === date
                      ? `couldn't fetch — look up VOO's close for ${date}`
                      : `backdated — fetching VOO's close for ${date}…`}
                </p>
              )}
            </Field>
          ) : <div />}
        </div>
        {type === 'Deposit' && (
          <AccountSelect accounts={accounts} value={fromAccount} onChange={setFromAccount}
            label="From account" kinds={['bank', 'outside']} />
        )}
        {hasDestination && (
          <AccountSelect accounts={accounts} value={toAccount} onChange={setToAccount}
            label="To account" kinds={type === 'TaxSkim' ? ['bank'] : ['bank', 'outside']} />
        )}
        <Field label="Source / destination note">
          <input value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} placeholder="Cash App sales" />
        </Field>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
        {type === 'Deposit' && (
          <p className="text-xs text-gray-400">
            Every deposit buys shadow VOO the same day — that's the benchmark you're trying to beat.
          </p>
        )}
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Add event" />
      </form>
    </Modal>
  );
}

function EditEventModal({ event, onClose }: { event: CashEvent; onClose: () => void }) {
  const { updateCashEvent } = useData();
  const [date, setDate] = useState(event.date);
  const [notes, setNotes] = useState(event.notes ?? '');

  const { busy, formError, submit } = useModalForm(async () => {
    await updateCashEvent(event.id, { date, notes: notes || null });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${event.type} — ${formatCurrency(event.amount)}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Date">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Amount and type can't change — the twin, running balance, and reserve math key off them.
          Delete and re-add if the money is wrong.
          {event.type === 'Deposit' &&
            ' A date change moves the shadow twin’s date too, but keeps its recorded VOO price — fix typos, don’t re-date real deposits.'}
          {event.type === 'Buy' &&
            ' The position lot keeps its own buy date — edit it from Positions if both should move.'}
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save changes" />
      </form>
    </Modal>
  );
}

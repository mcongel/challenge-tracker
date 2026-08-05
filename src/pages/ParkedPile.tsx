import { useState } from 'react';
import { Archive, Pencil, Settings2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import type { AccountKind, ParkedPosition } from '../lib/engine';
import {
  concentration, ltStatus, parkedCostBasis, parkedMarketValue, roundCents, trackedBalance,
} from '../lib/engine';
import {
  cn, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';

const CATEGORY_STYLES: Record<ParkedPosition['category'], string> = {
  'Semi/AI': 'bg-indigo-50 text-indigo-700',
  'AI-adjacent': 'bg-sky-50 text-sky-700',
  BTC: 'bg-amber-50 text-amber-800',
  Other: 'bg-gray-100 text-gray-600',
};

export function ParkedPile() {
  const { parked, loading, error } = useData();
  const [editing, setEditing] = useState<ParkedPosition | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);

  const today = todayISO();
  const c = concentration(parked);
  const totalBasis = parked.reduce((s, p) => s + parkedCostBasis(p), 0);
  const ordered = [...parked].sort((a, b) => {
    if (a.trimRank != null && b.trimRank != null) return a.trimRank - b.trimRank;
    if (a.trimRank != null) return -1;
    if (b.trimRank != null) return 1;
    return parkedMarketValue(b) - parkedMarketValue(a);
  });

  return (
    <div>
      <PageHeader
        title="Parked Pile"
        subtitle="The foundation — context only, never in the score. Funding source and skim destination; never refill fuel."
        actions={
          <button onClick={() => setAccountsOpen(true)}
            className={cn(secondaryBtnCls, 'flex items-center gap-1.5')} title="Manage accounts">
            <Settings2 className="h-4 w-4" /> Accounts
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {/* Concentration watch */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Pile total</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(c.total))}</p>
          <p className="text-xs text-gray-400 mt-0.5">not in score</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Semi/AI</p>
          <p className={cn('mt-0.5 text-xl font-bold tabular-nums', c.overCap ? 'text-red-600' : 'text-gray-900')}>
            {formatPercent(c.semiPct)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">cap 50%</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Semi/AI + adjacent</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{formatPercent(c.semiPlusAdjacentPct)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatCurrency(roundCents(c.semiPlusAdjacentValue))}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Unrealized</p>
          <p className={cn('mt-0.5 text-xl font-bold tabular-nums',
            c.total - totalBasis >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(roundCents(c.total - totalBasis))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">vs {formatCurrency(roundCents(totalBasis))} basis</p>
        </div>
      </div>

      {c.overCap && (
        <div className="mb-4 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm font-medium">
          OVER CAP — trim semis first. When a lot goes long-term, trimming Semi/AI does double duty:
          funds the challenge account AND reduces concentration.
        </div>
      )}

      {loading ? (
        <SkeletonTable />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Parked pile not seeded yet"
          hint="Run the seed script (supabase/SETUP.md) to import the workbook's holdings."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Shares</th>
                <th className="px-4 py-3 text-right">Avg cost</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Unreal %</th>
                <th className="px-4 py-3">Funding unlock</th>
                <th className="px-4 py-3 text-right">Trim rank</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ordered.map((p) => {
                const value = parkedMarketValue(p);
                const basis = parkedCostBasis(p);
                const lt = ltStatus(p, today);
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {p.ticker}
                      {p.notes && <p className="text-xs font-normal text-gray-400 max-w-[14rem] truncate">{p.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.account}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', CATEGORY_STYLES[p.category])}>
                        {p.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.shares}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.avgCost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.currentPrice)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(roundCents(value))}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums',
                      value - basis >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {basis === 0 ? '—' : formatPercent((value - basis) / basis)}
                    </td>
                    <td className="px-4 py-3">
                      {lt.kind === 'UNLOCKED' ? (
                        <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">
                          FUNDING UNLOCKED
                        </span>
                      ) : lt.kind === 'COUNTDOWN' ? (
                        <span className="text-xs text-gray-500 tabular-nums">{lt.daysLeft}d → {lt.unlockDate}</span>
                      ) : (
                        <span className="text-xs text-amber-800">enter buy date</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">{p.trimRank ?? '—'}</td>
                    <td className="px-2 py-3">
                      <button onClick={() => setEditing(p)} className="p-1 rounded hover:bg-gray-100" aria-label={`Edit ${p.ticker}`}>
                        <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditParkedModal position={editing} onClose={() => setEditing(null)} />}
      {accountsOpen && <AccountsModal onClose={() => setAccountsOpen(false)} />}
    </div>
  );
}

const KIND_STYLES: Record<AccountKind, string> = {
  challenge: 'bg-green-50 text-green-700',
  outside: 'bg-indigo-50 text-indigo-700',
  bank: 'bg-sky-50 text-sky-700',
};

function AccountsModal({ onClose }: { onClose: () => void }) {
  const { accounts, cashEvents, addAccount } = useData();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [broker, setBroker] = useState('');
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
      await addAccount(trimmed, kind, broker.trim() || undefined);
      setName(''); setBroker('');
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
        <div className="space-y-1.5">
          {accounts.map((a) => {
            const tracked = a.kind === 'bank' ? trackedBalance(a.id, cashEvents) : null;
            return (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-700 truncate">{a.name}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
                    {a.kind}
                  </span>
                </div>
                {tracked !== null && (
                  <span className="text-xs text-gray-500 tabular-nums" title="Tracked strategy cash — not the real account balance">
                    {formatCurrency(roundCents(tracked))} tracked
                  </span>
                )}
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
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Broker / institution (optional)</label>
            <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputCls} />
          </div>
          {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={primaryBtnCls}>
              {busy ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
        <p className="text-xs text-gray-400">
          Accounts are labels for where money lives — they never change the score. Bank balances
          show tracked strategy cash only, not your real balance.
        </p>
      </div>
    </Modal>
  );
}

function EditParkedModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { updateParked, accounts } = useData();
  const [price, setPrice] = useState(String(p.currentPrice || ''));
  const [shares, setShares] = useState(String(p.shares));
  const [avgCost, setAvgCost] = useState(String(p.avgCost));
  const [buyDate, setBuyDate] = useState(p.buyDate ?? '');
  const [trimRank, setTrimRank] = useState(p.trimRank != null ? String(p.trimRank) : '');
  const [accountId, setAccountId] = useState(p.accountId);
  const [notes, setNotes] = useState(p.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await updateParked(p.id, {
        currentPrice: Number(price) || 0,
        shares: Number(shares),
        avgCost: Number(avgCost),
        buyDate: buyDate || null,
        trimRank: trimRank === '' ? null : Number(trimRank),
        accountId,
        notes: notes || null,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${p.ticker} (${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Shares</label>
            <input type="number" step="any" min="0" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Avg cost ($)</label>
            <input type="number" step="0.01" min="0" required value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Price ($)</label>
            <input type="number" step="0.01" min="0" value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Buy date (oldest lot — drives the unlock)</label>
            <input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Trim rank</label>
            <input type="number" min="1" step="1" value={trimRank}
              onChange={(e) => setTrimRank(e.target.value)} className={inputCls} placeholder="1 = trim first" />
          </div>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account (e.g. after an ACATS transfer)" kinds={['outside', 'challenge']} allowNone={false} />
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

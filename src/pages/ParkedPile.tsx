import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, Archive, ChevronDown, ChevronRight, Pencil, Plus, Scissors, Settings2, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import type { AccountKind, ParkedLot, ParkedPosition, UnlockSummary } from '../lib/engine';
import {
  concentration, contributionStatus, depositExceedsCap, dividendsCollected, netContributed,
  parkedCostBasis, parkedMarketValue, roundCents, trackedBalance, unlockSummary,
} from '../lib/engine';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import {
  cn, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';

const CATEGORY_STYLES: Record<ParkedPosition['category'], string> = {
  'Semi/AI': 'bg-indigo-50 text-indigo-700',
  'AI-adjacent': 'bg-sky-50 text-sky-700',
  BTC: 'bg-amber-50 text-amber-800',
  Other: 'bg-gray-100 text-gray-600',
};

const fmtSh = (n: number) => String(Number(n.toFixed(4)));

export function ParkedPile() {
  const { parked, parkedLots, loading, error } = useData();
  const [editing, setEditing] = useState<ParkedPosition | null>(null);
  const [trimming, setTrimming] = useState<ParkedPosition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const lotsByPosition = useMemo(() => {
    const m = new Map<string, ParkedLot[]>();
    for (const l of parkedLots) (m.get(l.parkedPositionId) ?? m.set(l.parkedPositionId, []).get(l.parkedPositionId)!).push(l);
    return m;
  }, [parkedLots]);
  const divTotal = dividendsCollected(parkedLots);

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
          <div className="flex gap-2">
            <button onClick={() => setAccountsOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')} title="Manage accounts">
              <Settings2 className="h-4 w-4" /> Accounts
            </button>
            <button onClick={() => setAddOpen(true)}
              className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
              <Plus className="h-4 w-4" /> Add holding
            </button>
          </div>
        }
      />

      {error && <ErrorCard message={error} />}

      {/* Concentration watch */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Pile total</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(c.total))}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            not in score
            {divTotal > 0 && <span className="text-green-700"> · +{formatCurrency(roundCents(divTotal))} dividends</span>}
          </p>
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
                <th className="px-2 py-3 w-8" />
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Shares</th>
                <th className="px-4 py-3 text-right">Avg cost</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Unreal %</th>
                <th className="px-4 py-3" title="Shares held >1 year sell at long-term rates — the only legitimate funding trims (Rule 5). Expand a row for the lot-by-lot schedule.">
                  Funding unlock
                </th>
                <th className="px-4 py-3 text-right">Trim rank</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ordered.map((p) => {
                const value = parkedMarketValue(p);
                const basis = parkedCostBasis(p);
                const summ = unlockSummary(lotsByPosition.get(p.id) ?? [], today);
                const expanded = expandedId === p.id;
                const toggle = () => setExpandedId(expanded ? null : p.id);
                return (
                  <Fragment key={p.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={toggle}>
                      <td className="px-2 py-3">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-300" />
                        )}
                      </td>
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
                      <td className="px-4 py-3 text-right tabular-nums">{fmtSh(p.shares)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.avgCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.currentPrice)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(roundCents(value))}</td>
                      <td className={cn('px-4 py-3 text-right tabular-nums',
                        value - basis >= 0 ? 'text-green-600' : 'text-red-600')}>
                        {basis === 0 ? '—' : formatPercent((value - basis) / basis)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <UnlockCell summary={summ} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{p.trimRank ?? '—'}</td>
                      <td className="px-2 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setTrimming(p)} className="p-1 rounded hover:bg-green-50" aria-label={`Trim ${p.ticker}`} title="Record trim">
                          <Scissors className="h-4 w-4 text-gray-300 hover:text-green-700" />
                        </button>
                        <button onClick={() => setEditing(p)} className="p-1 rounded hover:bg-gray-100" aria-label={`Edit ${p.ticker}`}>
                          <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={12} className="bg-gray-50 px-4 sm:px-6 py-4">
                          <LotPanel position={p} summary={summ} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditParkedModal position={editing} onClose={() => setEditing(null)} />}
      {trimming && <TrimModal position={trimming} onClose={() => setTrimming(null)} />}
      {accountsOpen && <AccountsModal onClose={() => setAccountsOpen(false)} />}
      {addOpen && <AddHoldingModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddHoldingModal({ onClose }: { onClose: () => void }) {
  const { accounts, parked, addParkedPosition } = useData();
  const outside = accounts.filter((a) => a.kind === 'outside');
  const [ticker, setTicker] = useState('');
  const [accountId, setAccountId] = useState(outside[0]?.id ?? '');
  const [category, setCategory] = useState<ParkedPosition['category']>('Semi/AI');
  const [date, setDate] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const t = ticker.trim().toUpperCase();
    if (parked.some((p) => p.ticker === t && p.accountId === accountId)) {
      return setFormError(
        `${t} is already parked in that account — expand its row and add a lot instead.`,
      );
    }
    const sh = Number(shares);
    const pr = Number(price);
    if (!sh || sh <= 0 || !pr || pr <= 0) return setFormError('Enter shares and cost per share.');
    setBusy(true);
    try {
      await addParkedPosition({
        ticker: t,
        accountId,
        category,
        date: date || null,
        shares: sh,
        price: pr,
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
    <Modal isOpen onClose={onClose} title="Add parked holding">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="NVDA" />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ParkedPosition['category'])}
              className={inputCls}>
              <option>Semi/AI</option>
              <option>AI-adjacent</option>
              <option>BTC</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Buy date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account" kinds={['outside']} allowNone={false} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Shares</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cost per share ($)</label>
            <input type="number" step="any" min="0" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          This becomes the first purchase lot. Add more purchases and dividends by expanding the
          row afterward. Context only — never in the score.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Adding…' : 'Add holding'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One readable pill; hover for the full sentence, expand the row for detail.
 * "Unlocked" = held >1 year = sellable at long-term rates (Rule 5 trim fuel). */
function UnlockCell({ summary: s }: { summary: UnlockSummary }) {
  const pill = (cls: string, text: string) => (
    <span
      title={unlockSentence(s)}
      className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', cls)}
    >
      {text}
    </span>
  );
  if (s.totalShares <= 0) return <span className="text-xs text-gray-400">—</span>;
  if (s.unknownShares >= s.totalShares - 1e-9) {
    return pill('bg-amber-50 text-amber-800', 'needs lot dates');
  }
  if (s.unlockedShares >= s.totalShares - 1e-9) {
    return pill('bg-green-50 text-green-700', 'all unlocked');
  }
  if (s.unlockedShares > 0) {
    return pill('bg-green-50 text-green-700', `${fmtSh(s.unlockedShares)} sh unlocked`);
  }
  if (s.nextUnlock) {
    return pill('bg-gray-100 text-gray-600', `locked until ${s.nextUnlock.date}`);
  }
  return pill('bg-gray-100 text-gray-600', 'locked');
}

function unlockSentence(s: UnlockSummary): string {
  if (s.totalShares <= 0) return 'No shares.';
  const parts: string[] = [];
  parts.push(`${fmtSh(s.unlockedShares)} of ${fmtSh(s.totalShares)} sh are long-term (funding unlocked)`);
  if (s.nextUnlock) parts.push(`next ${fmtSh(s.nextUnlock.shares)} sh unlock ${s.nextUnlock.date}`);
  if (s.unknownShares > 0) parts.push(`${fmtSh(s.unknownShares)} sh undated — add dates below`);
  return parts.join(' · ') + '.';
}

function LotPanel({ position: p, summary }: { position: ParkedPosition; summary: UnlockSummary }) {
  const { parkedLots, addParkedLot, deleteParkedLot, overrides, quotes } = useData();
  const lots = parkedLots
    .filter((l) => l.parkedPositionId === p.id)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const effectivePrice = overrides[p.ticker] ?? quotes[p.ticker] ?? p.currentPrice;

  const [mode, setMode] = useState<'purchase' | 'dividend' | null>(null);
  const [date, setDate] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [reinvested, setReinvested] = useState(true);
  // Dividends accept either entry: dollars (amount) or shares — whichever was
  // typed last drives, the other computes from the reinvest price.
  const [divDriver, setDivDriver] = useState<'amount' | 'shares'>('amount');

  const syncFromAmount = (amt: string, pr: string) => {
    setAmount(amt);
    setDivDriver('amount');
    const a = Number(amt); const pnum = Number(pr);
    if (a > 0 && pnum > 0) setShares(String(Number((a / pnum).toFixed(8))));
  };
  const syncFromShares = (sh: string, pr: string) => {
    setShares(sh);
    setDivDriver('shares');
    const s = Number(sh); const pnum = Number(pr);
    if (s > 0 && pnum > 0) setAmount(String(roundCents(s * pnum)));
  };
  const syncFromPrice = (pr: string) => {
    setPrice(pr);
    if (mode !== 'dividend') return;
    if (divDriver === 'amount') syncFromAmount(amount, pr);
    else syncFromShares(shares, pr);
  };
  const [deleting, setDeleting] = useState<ParkedLot | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openForm = (m: 'purchase' | 'dividend') => {
    setMode(m);
    setDate(todayISO());
    setShares('');
    setAmount('');
    setPrice(m === 'dividend' && effectivePrice ? String(effectivePrice) : '');
    setFormError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (mode === 'purchase') {
        const sh = Number(shares);
        const pr = Number(price);
        if (!sh || sh <= 0 || !pr || pr <= 0) throw new Error('Enter shares and price.');
        await addParkedLot({
          parkedPositionId: p.id,
          date: date || null,
          source: 'purchase',
          shares: sh,
          price: pr,
          amount: roundCents(sh * pr),
        });
      } else {
        const pr = Number(price);
        if (reinvested && (!pr || pr <= 0)) throw new Error('Reinvested dividends need the reinvestment price.');
        const amt = Number(amount) > 0 ? Number(amount) : Number(shares) > 0 && pr > 0 ? Number(shares) * pr : 0;
        if (amt <= 0) throw new Error('Enter the dividend as dollars or shares.');
        const sh = reinvested ? (Number(shares) > 0 ? Number(shares) : amt / pr) : 0;
        await addParkedLot({
          parkedPositionId: p.id,
          date: date || null,
          source: 'dividend',
          shares: sh,
          price: reinvested ? pr : null,
          amount: roundCents(amt),
          notes: reinvested ? 'reinvested' : 'cash',
        });
      }
      setMode(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
        {p.ticker} — lots &amp; dividends
      </p>
      <p className="text-sm text-gray-600 mb-3">{unlockSentence(summary)}</p>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {lots.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className={cn('px-3 py-2 tabular-nums w-28', l.date ? 'text-gray-600' : 'text-amber-800')}>
                    {l.date ?? 'no date'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      l.source === 'purchase' ? 'bg-indigo-50 text-indigo-700' : 'bg-sky-50 text-sky-700')}>
                      {l.source === 'dividend' ? (l.shares > 0 ? 'dividend · DRIP' : 'dividend · cash') : 'purchase'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {l.shares > 0 ? `${fmtSh(l.shares)} sh` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatCurrency(l.amount)}</td>
                  <td className="px-1 py-2 w-8">
                    <button onClick={() => setDeleting(l)} className="p-1 rounded hover:bg-red-50" aria-label="Delete lot">
                      <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
              {lots.length === 0 && (
                <tr><td className="px-3 py-4 text-sm text-gray-400 text-center">No lots yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
        {mode === null ? (
          <div className="flex gap-2">
            <button onClick={() => openForm('purchase')} className={secondaryBtnCls}>Add past purchase</button>
            <button onClick={() => openForm('dividend')} className={secondaryBtnCls}>Add dividend</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs font-medium text-gray-500">
              {mode === 'purchase' ? 'Past purchase' : 'Dividend'}
            </p>
            {mode === 'purchase' ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Shares</label>
                  <input type="number" step="any" min="0.00000001" required value={shares}
                    onChange={(e) => setShares(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Price ($)</label>
                  <input type="number" step="any" min="0" required value={price}
                    onChange={(e) => setPrice(e.target.value)} className={inputCls} />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                  </div>
                  {reinvested && (
                    <div>
                      <label className={labelCls}>Reinvest price ($)</label>
                      <input type="number" step="any" min="0" value={price}
                        onChange={(e) => syncFromPrice(e.target.value)} className={inputCls} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Amount ($)</label>
                    <input type="number" step="any" min="0" value={amount}
                      onChange={(e) => syncFromAmount(e.target.value, price)} className={inputCls} />
                  </div>
                  {reinvested && (
                    <div>
                      <label className={labelCls}>Shares</label>
                      <input type="number" step="any" min="0" value={shares}
                        onChange={(e) => syncFromShares(e.target.value, price)} className={inputCls} />
                    </div>
                  )}
                </div>
              </>
            )}
            {mode === 'dividend' && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={reinvested} onChange={(e) => setReinvested(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
                Reinvested (DRIP) — enter dollars or shares, the other computes. The shares get
                their own 366-day clock.
              </label>
            )}
            {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMode(null)} className={secondaryBtnCls}>Cancel</button>
              <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Add'}</button>
            </div>
          </form>
        )}

        <p className="text-xs text-gray-400 mt-3">
          Shares and cost basis derive from these lots. To fix a wrong entry, delete it and re-add.
          Leave the date blank only if it's truly unknown — dated lots drive the unlock countdowns.
        </p>
        </div>
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete lot"
          message={`Delete this ${deleting.source} (${deleting.shares > 0 ? `${fmtSh(deleting.shares)} sh, ` : ''}${formatCurrency(deleting.amount)})? The position's shares and cost recompute without it.`}
          onConfirm={() => deleteParkedLot(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

const NEVER_TRIM = new Set(['NVDA', 'TSLA', 'MSTR']);

function TrimModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { recordTrim, cashEvents, contributionCap, parkedLots } = useData();
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState(p.currentPrice ? String(p.currentPrice) : '');
  const [date, setDate] = useState(todayISO());
  const [fund, setFund] = useState(true);
  const [vooPrice, setVooPrice] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numShares = Number(shares);
  const numPrice = Number(price);
  const proceeds = numShares > 0 && numPrice > 0 ? roundCents(numShares * numPrice) : 0;
  const fullTrim = numShares >= p.shares - 1e-9;
  const summ = unlockSummary(parkedLots.filter((l) => l.parkedPositionId === p.id), date);
  const dipsShortTerm = numShares > 0 && numShares > summ.unlockedShares + 1e-9;
  const neverTrimFuel = NEVER_TRIM.has(p.ticker) || p.category === 'BTC';
  const isLoss = numPrice > 0 && numPrice < p.avgCost;

  const contributed = netContributed(cashEvents);
  const overCap =
    fund && proceeds > 0 && contributionCap !== null &&
    depositExceedsCap(contributed, proceeds, contributionCap);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!numShares || numShares <= 0) return setFormError('Enter shares to trim.');
    if (numShares > p.shares + 1e-9) return setFormError(`Only ${p.shares} shares parked.`);
    if (!numPrice || numPrice <= 0) return setFormError('Enter the sale price.');
    if (fund && (!Number(vooPrice) || Number(vooPrice) <= 0)) {
      return setFormError("Funding the challenge account needs that day's VOO price for the shadow purchase.");
    }
    if (overCap && contributionCap !== null) {
      const room = contributionStatus(contributed, contributionCap).remaining;
      return setFormError(
        `Rule 12: depositing ${formatCurrency(proceeds)} would exceed the contribution cap — only ${formatCurrency(roundCents(room))} of room remains. Uncheck funding or trim less.`,
      );
    }
    setBusy(true);
    try {
      await recordTrim({
        parkedId: p.id,
        shares: numShares,
        pricePerShare: numPrice,
        date,
        depositVooPrice: fund ? Number(vooPrice) : undefined,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Trim ${p.ticker} (${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        {neverTrimFuel && (
          <div className="flex gap-2 bg-red-50 text-red-700 rounded-md px-3 py-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{p.ticker} is never trim fuel — Rule 5. The conviction holds stay parked.</span>
          </div>
        )}
        {dipsShortTerm && !neverTrimFuel && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Only {fmtSh(summ.unlockedShares)} of {fmtSh(summ.totalShares)} sh are long-term.
              Trimming {fmtSh(numShares)} dips into short-term{summ.unknownShares > 0 ? ' or undated' : ''} lots —
              short-term rates, and Rule 5 says planned long-term trims.
              {summ.nextUnlock && ` Next ${fmtSh(summ.nextUnlock.shares)} sh unlock ${summ.nextUnlock.date}.`}
            </span>
          </div>
        )}
        {summ.unlockedShares > 0 && !dipsShortTerm && numShares > 0 && (
          <p className="text-xs text-green-700">
            Within the long-term shares ({fmtSh(summ.unlockedShares)} sh unlocked) — legitimate Rule 5 fuel.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Shares (of {p.shares})</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Price / share ($)</label>
            <input type="number" step="0.01" min="0.01" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={fund} onChange={(e) => setFund(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Deposit the proceeds into the challenge account
        </label>
        {fund && (
          <div>
            <label className={labelCls}>VOO price on {date}</label>
            <input type="number" step="0.01" min="0.01" value={vooPrice}
              onChange={(e) => setVooPrice(e.target.value)} className={inputCls} placeholder="for the shadow purchase" />
          </div>
        )}

        {proceeds > 0 && (
          <div className="bg-gray-50 rounded-md px-3 py-2 text-sm space-y-1">
            <p className="text-gray-600">
              Proceeds <span className="font-medium tabular-nums">{formatCurrency(proceeds)}</span>
              {isLoss && <span className="ml-2 text-red-600 font-medium">below cost — arms the 31-day wash-sale window</span>}
              {fullTrim && <span className="ml-2 text-gray-500">· sells the whole position (row removed)</span>}
            </p>
            <p className="text-xs text-gray-400">
              One action: shrinks the parked position, logs the sale in the wash-sale radar
              {fund ? ', and writes the Deposit + shadow VOO twin to the ledger.' : '.'}
            </p>
          </div>
        )}

        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Recording…' : 'Record trim'}
          </button>
        </div>
      </form>
    </Modal>
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Price ($)</label>
            <input type="number" step="0.01" min="0" value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Trim rank</label>
            <input type="number" min="1" step="1" value={trimRank}
              onChange={(e) => setTrimRank(e.target.value)} className={inputCls} placeholder="1 = trim first" />
          </div>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account (e.g. after an ACATS transfer)" kinds={['outside', 'challenge']} allowNone={false} />
        <p className="text-xs text-gray-400">
          Shares, cost, and dates live in the lots (clock icon on the row) — they recompute from there.
        </p>
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

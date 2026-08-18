import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, PiggyBank, Plus, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import type { ParkedPosition } from '../lib/engine';
import {
  isArchivedPosition, parkedCostBasis, parkedMarketValue, roundCents,
} from '../lib/engine';
import {
  cn, errorMessage, formatCurrency, formatPercent, inputCls, primaryBtnCls, secondaryBtnCls,
} from '../lib/utils';
import { categoryPillCls, fmtSh } from '../components/parked/shared';
import { AddHoldingModal } from '../components/parked/AddHoldingModal';
import { EditParkedModal } from '../components/parked/EditParkedModal';
import { LotPanel } from '../components/parked/LotPanel';
import { unlockSummary } from '../lib/engine';

/** The third pot. Reuses the parked machinery (positions, lots, dividends,
 * quotes) but lives behind its own wall — never in the pile's total, cap,
 * trim fuel, income projections, or taxes, and never in the score. */
export function Retirement() {
  const {
    retirementParked, parkedLots, accounts, tickerNames, overrides, quotes, loading, error,
  } = useData();

  const [addOpen, setAddOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [editing, setEditing] = useState<ParkedPosition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const retirementAccounts = useMemo(
    () => accounts.filter((a) => a.kind === 'retirement').sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  );
  const live = useMemo(
    () => retirementParked.filter((p) => !isArchivedPosition(p)),
    [retirementParked],
  );
  const lotsByPosition = useMemo(() => {
    const m = new Map<string, typeof parkedLots>();
    for (const l of parkedLots) {
      const list = m.get(l.parkedPositionId);
      if (list) list.push(l);
      else m.set(l.parkedPositionId, [l]);
    }
    return m;
  }, [parkedLots]);

  const total = live.reduce((s, p) => s + parkedMarketValue(p), 0);
  const totalBasis = live.reduce((s, p) => s + parkedCostBasis(p), 0);
  const byFlavor = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of live) {
      const acct = retirementAccounts.find((a) => a.id === p.accountId);
      const flavor = acct?.retirementFlavor || 'unlabeled';
      m.set(flavor, (m.get(flavor) ?? 0) + parkedMarketValue(p));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [live, retirementAccounts]);

  const groups = retirementAccounts
    .map((a) => ({ account: a, positions: live.filter((p) => p.accountId === a.id) }))
    .filter((g) => g.positions.length > 0);

  return (
    <div>
      <PageHeader
        title="Retirement"
        subtitle="The third pot. Same lot machinery as the pile, behind its own wall — never in the pile's total, cap, taxes, or the score."
        actions={
          <div className="flex gap-2">
            <button onClick={() => setPricesOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}
              disabled={live.length === 0}
              title="Bulk-update pinned prices — the Voya-unit-value routine">
              <RefreshCw className="h-4 w-4" /> Update prices
            </button>
            <button onClick={() => setAddOpen(true)}
              className={cn(primaryBtnCls, 'flex items-center gap-1.5')}
              disabled={retirementAccounts.length === 0}
              title={retirementAccounts.length === 0 ? 'Add a retirement account first (Parked Pile → Accounts)' : undefined}>
              <Plus className="h-4 w-4" /> Buy
            </button>
          </div>
        }
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : retirementAccounts.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="No retirement accounts yet"
          hint="Add one under Parked Pile → Accounts with kind 'retirement' (and a flavor like Roth IRA), then Buy holdings into it here."
        />
      ) : live.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Accounts ready, nothing held yet"
          hint="Hit Buy to add the first holding — each purchase is a dated lot, so basis and history stay exact."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Retirement total</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">
                {formatCurrency(roundCents(total))}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">not in the score, not in the pile</p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Unrealized</p>
              <p className={cn('mt-0.5 text-xl font-bold tabular-nums',
                total - totalBasis >= 0 ? 'text-green-600' : 'text-red-600')}>
                {formatCurrency(roundCents(total - totalBasis))}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">vs {formatCurrency(roundCents(totalBasis))} basis</p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card col-span-2 sm:col-span-1"
              title={byFlavor.map(([f, v]) => `${f} ${formatCurrency(roundCents(v))}`).join(' · ')}>
              <p className="text-xs font-medium text-gray-500">By flavor</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{byFlavor.length}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">
                {byFlavor.map(([f, v]) =>
                  `${f} ${total > 0 ? Math.round((v / total) * 100) : 0}%`).join(' · ') || '—'}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-2 py-3 w-8" />
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">Avg cost</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Unrealized</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groups.map((g) => (
                  <Fragment key={g.account.id}>
                    <tr className="bg-gray-50">
                      <td colSpan={8} className="px-4 py-2">
                        <span className="flex items-center gap-1.5 font-bold text-gray-700">
                          {g.account.name}
                          {g.account.retirementFlavor && (
                            <span className="inline-block rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
                              {g.account.retirementFlavor}
                            </span>
                          )}
                          <span className="text-xs font-normal text-gray-400 tabular-nums">
                            · {formatCurrency(roundCents(g.positions.reduce((s, p) => s + parkedMarketValue(p), 0)))}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {g.positions
                      .sort((a, b) => parkedMarketValue(b) - parkedMarketValue(a))
                      .map((p) => {
                        const value = parkedMarketValue(p);
                        const basis = parkedCostBasis(p);
                        const expanded = expandedId === p.id;
                        return (
                          <Fragment key={p.id}>
                            <tr className="hover:bg-gray-50 cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : p.id)}>
                              <td className="px-2 py-3">
                                {expanded
                                  ? <ChevronDown className="h-4 w-4 text-gray-400" />
                                  : <ChevronRight className="h-4 w-4 text-gray-300" />}
                              </td>
                              <td className="px-4 py-3 font-medium">
                                <span className="flex items-center gap-1.5">
                                  {p.ticker}
                                  <span className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', categoryPillCls(p.category))}>
                                    {p.category}
                                  </span>
                                </span>
                                {tickerNames[p.ticker] && (
                                  <p className="text-xs font-normal text-gray-400 max-w-[10rem] truncate">
                                    {tickerNames[p.ticker]}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{fmtSh(p.shares)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.avgCost)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {formatCurrency(p.currentPrice)}
                                {overrides[p.ticker] !== undefined && (
                                  <span className="ml-1 text-[10px] uppercase text-amber-800 font-bold"
                                    title="Pinned manual price — beats quotes. Clear it from Edit.">
                                    pin
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums font-medium">
                                {formatCurrency(roundCents(value))}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span className={cn('tabular-nums font-medium',
                                  value - basis >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {value - basis >= 0 ? '+' : '−'}{formatCurrency(Math.abs(roundCents(value - basis)))}
                                  {basis > 0 && (
                                    <span className="block text-xs font-normal">
                                      {formatPercent((value - basis) / basis)}
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="px-2 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => setEditing(p)} className="p-1 rounded hover:bg-gray-100" aria-label={`Edit ${p.ticker}`}>
                                  <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr>
                                <td colSpan={8} className="bg-gray-50 px-4 sm:px-6 py-4">
                                  <LotPanel position={p}
                                    summary={unlockSummary(lotsByPosition.get(p.id) ?? [], new Date().toISOString().slice(0, 10))} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Sales, taxes, and the 366-day clocks are informational curiosities here — retirement
            money is tax-sheltered and can't fund the challenge, so nothing on this page feeds
            trim fuel, Pile Taxes, or any pile alert.
          </p>
        </>
      )}

      {addOpen && <AddHoldingModal kinds={['retirement']} onClose={() => setAddOpen(false)} />}
      {pricesOpen && (
        <UpdatePricesModal positions={live} quotes={quotes} onClose={() => setPricesOpen(false)} />
      )}
      {editing && (
        <EditParkedModal position={editing} accountKinds={['retirement']}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** The monthly Voya routine in one form: every manually-priced holding (no
 * live quote, or already pinned), current value prefilled — type the fresh
 * unit values from the statement, save once. Pins beat quotes until cleared,
 * so live-quoted tickers stay OUT of this list unless already pinned. */
function UpdatePricesModal({
  positions, quotes, onClose,
}: {
  positions: ParkedPosition[];
  quotes: Record<string, number>;
  onClose: () => void;
}) {
  const { overrides, overrideSetAt, setOverrides } = useData();
  const rows = useMemo(() => {
    const byTicker = new Map<string, ParkedPosition>();
    for (const p of positions) {
      if (quotes[p.ticker] !== undefined && overrides[p.ticker] === undefined) continue;
      if (!byTicker.has(p.ticker)) byTicker.set(p.ticker, p);
    }
    return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [positions, quotes, overrides]);
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((p) => [p.ticker, String(overrides[p.ticker] ?? (p.currentPrice || ''))])),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const entries = rows
      .map((p) => ({ ticker: p.ticker, price: Number(prices[p.ticker]) }))
      .filter((e2) => e2.price > 0);
    if (entries.length === 0) return setFormError('Nothing to update.');
    setBusy(true);
    try {
      await setOverrides(entries);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Update prices">
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          Every holding here has a live quote — nothing needs a manual price. Pins set from a
          holding's Edit modal would show up in this list.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-gray-400">
            Manually-priced holdings only (no live quote, or already pinned). Type the fresh unit
            values from the statement — one save pins them all with today's stamp.
          </p>
          <div className="space-y-2">
            {rows.map((p) => (
              <div key={p.ticker} className="flex items-center gap-3">
                <span className="w-28 flex-shrink-0">
                  <span className="text-sm font-medium">{p.ticker}</span>
                  <span className="block text-[11px] text-gray-400">
                    {overrideSetAt[p.ticker]
                      ? `pinned ${overrideSetAt[p.ticker].slice(0, 10)}`
                      : 'no live quote'}
                  </span>
                </span>
                <input type="number" step="any" min="0.0001" value={prices[p.ticker] ?? ''}
                  onChange={(e) => setPrices((m) => ({ ...m, [p.ticker]: e.target.value }))}
                  className={inputCls} placeholder="unit value ($)" />
              </div>
            ))}
          </div>
          {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={primaryBtnCls}>
              {busy ? 'Saving…' : `Pin ${rows.length} price${rows.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

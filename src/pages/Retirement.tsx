import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, PiggyBank, Plus } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import type { ParkedPosition } from '../lib/engine';
import {
  isArchivedPosition, parkedCostBasis, parkedMarketValue, roundCents,
} from '../lib/engine';
import { cn, formatCurrency, formatPercent, primaryBtnCls } from '../lib/utils';
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
    retirementParked, parkedLots, accounts, tickerNames, overrides, loading, error,
  } = useData();

  const [addOpen, setAddOpen] = useState(false);
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
          <button onClick={() => setAddOpen(true)}
            className={cn(primaryBtnCls, 'flex items-center gap-1.5')}
            disabled={retirementAccounts.length === 0}
            title={retirementAccounts.length === 0 ? 'Add a retirement account first (Parked Pile → Accounts)' : undefined}>
            <Plus className="h-4 w-4" /> Buy
          </button>
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
      {editing && (
        <EditParkedModal position={editing} accountKinds={['retirement']}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

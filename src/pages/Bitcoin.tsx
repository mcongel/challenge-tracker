import { Fragment, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Bitcoin as BitcoinIcon, ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react';
import type { ParkedPosition, Snapshot } from '../lib/engine';
import { useIsDark } from '../lib/useIsDark';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import {
  isArchivedPosition, parkedCostBasis, parkedMarketValue, roundCents, unlockSummary,
} from '../lib/engine';
import {
  cn, compactUsd, formatCurrency, formatCurrencyWhole, formatPercent, primaryBtnCls,
} from '../lib/utils';
import { fmtSh } from '../components/parked/shared';
import { AddHoldingModal } from '../components/parked/AddHoldingModal';
import { EditParkedModal } from '../components/parked/EditParkedModal';
import { LotPanel } from '../components/parked/LotPanel';

/** The fourth pot: the bitcoin conviction bucket (category 'BTC' — BTC
 * itself plus thesis members like MSTR and BTCI). Split out of the pile by
 * owner decision 2026-08-19: never pile total, cap, or trim fuel, and never
 * the score — but it IS taxable money, so Income, Pile Taxes, and Activity
 * keep counting it. Same lot machinery as everything else. */
export function Bitcoin() {
  const {
    btcParked, parkedLots, accounts, tickerNames, overrides, quotes, dayChange, snapshots,
    loading, error,
  } = useData();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ParkedPosition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const live = useMemo(() => btcParked.filter((p) => !isArchivedPosition(p)), [btcParked]);
  const lotsByPosition = useMemo(() => {
    const m = new Map<string, typeof parkedLots>();
    for (const l of parkedLots) {
      const list = m.get(l.parkedPositionId);
      if (list) list.push(l);
      else m.set(l.parkedPositionId, [l]);
    }
    return m;
  }, [parkedLots]);
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const total = live.reduce((s, p) => s + parkedMarketValue(p), 0);
  const totalBasis = live.reduce((s, p) => s + parkedCostBasis(p), 0);
  const btcPrice = overrides['BTC'] ?? quotes['BTC'];
  const btcDay = dayChange['BTC'];
  const chartSnapshots = useMemo(
    () => snapshots.filter((s) => s.btcValue != null && s.btcValue > 0),
    [snapshots],
  );

  return (
    <div>
      <PageHeader
        title="Bitcoin"
        subtitle="The fourth pot — the conviction bucket, held, not traded. Never in the score, the pile, or its cap; its income and taxes still count with the taxable book."
        actions={
          <button onClick={() => setAddOpen(true)}
            className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Buy
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : live.length === 0 ? (
        <EmptyState
          icon={BitcoinIcon}
          title="Nothing in the bucket yet"
          hint="Buy adds a holding with a dated lot. Anything categorized 'BTC' lands here — BTC itself, or thesis members like MSTR."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Bucket total</p>
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
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card col-span-2 sm:col-span-1">
              <p className="text-xs font-medium text-gray-500">BTC</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">
                {btcPrice ? formatCurrencyWhole(btcPrice) : '—'}
              </p>
              <p className={cn('text-xs mt-0.5 tabular-nums',
                btcDay?.changePct == null ? 'text-gray-400'
                  : btcDay.changePct >= 0 ? 'text-green-600' : 'text-red-600')}>
                {btcDay?.changePct == null ? 'live quote' : `${btcDay.changePct >= 0 ? '+' : ''}${btcDay.changePct.toFixed(2)}% today`}
              </p>
            </div>
          </div>

          {chartSnapshots.length >= 2 && <BtcValueChart snapshots={chartSnapshots} />}

          <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-2 py-3 w-8" />
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">Avg cost</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Unrealized</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {live
                  .slice()
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
                            {p.ticker}
                            {tickerNames[p.ticker] && (
                              <p className="text-xs font-normal text-gray-400 max-w-[10rem] truncate">
                                {tickerNames[p.ticker]}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500">{accountName.get(p.accountId) ?? p.account}</td>
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
                            <td colSpan={9} className="bg-gray-50 px-4 sm:px-6 py-4">
                              <LotPanel position={p}
                                summary={unlockSummary(lotsByPosition.get(p.id) ?? [], new Date().toISOString().slice(0, 10))} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Rule 5 territory: this bucket is never trim fuel and never sells to feed the challenge.
            Lot dates still matter — a sale here would be a real taxable event, so Pile Taxes and
            Income keep watching these holdings. Moving something in or out is just its Sector
            field: 'BTC' means this page.
          </p>
        </>
      )}

      {addOpen && <AddHoldingModal onClose={() => setAddOpen(false)} />}
      {editing && (
        <EditParkedModal position={editing} accountKinds={['outside']}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Same house chart contract as the pile's and retirement's value charts —
 * VALUE, not return: buys move this line too. Days before the fourth-pot
 * split have no btcValue (bitcoin rode inside the pile's line back then). */
function BtcValueChart({ snapshots }: { snapshots: Snapshot[] }) {
  const isDark = useIsDark();
  const gridColor = isDark ? '#334155' : '#e5e7eb';
  const axisColor = isDark ? '#94a3b8' : '#6b7280';
  const green = isDark ? '#22c55e' : '#16a34a';
  const data = snapshots.map((s) => ({
    date: s.date.slice(5),
    Value: roundCents(s.btcValue ?? 0),
  }));
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">
        Bucket value over time
        <span className="ml-2 text-xs font-normal text-gray-400">
          value, not return — buys move this line too
        </span>
      </p>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} minTickGap={32} />
            <YAxis stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} domain={['auto', 'auto']} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Area type="monotone" dataKey="Value" stroke={green} strokeWidth={2}
              fill={green} fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

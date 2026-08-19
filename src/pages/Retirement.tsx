import { Fragment, useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChevronDown, ChevronRight, Pencil, PiggyBank, Plus, RefreshCw, Scale } from 'lucide-react';
import type { Snapshot } from '../lib/engine';
import { useIsDark } from '../lib/useIsDark';
import { compactUsd } from '../lib/utils';
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
    retirementParked, parkedLots, accounts, tickerNames, overrides, quotes, snapshots,
    loading, error,
  } = useData();
  const chartSnapshots = useMemo(
    () => snapshots.filter((s) => s.retirementValue != null && s.retirementValue > 0),
    [snapshots],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [balancesOpen, setBalancesOpen] = useState(false);
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
            <button onClick={() => setBalancesOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}
              disabled={live.length === 0}
              title="The daily routine: one balance per account — holdings scale to match">
              <Scale className="h-4 w-4" /> Update balances
            </button>
            <button onClick={() => setPricesOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}
              disabled={live.length === 0}
              title="Exact unit values per holding — the monthly true-up">
              <RefreshCw className="h-4 w-4" /> Update prices
            </button>
            <button onClick={() => setAddOpen(true)}
              className={cn(primaryBtnCls, 'flex items-center gap-1.5')}
              disabled={retirementAccounts.length === 0}
              title={retirementAccounts.length === 0 ? 'Add a retirement account first (Accounts screen)' : undefined}>
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
          hint="Add one on the Accounts screen with kind 'retirement' (and a flavor like Roth IRA), then Buy holdings into it here."
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

          {chartSnapshots.length >= 2 && <RetirementValueChart snapshots={chartSnapshots} />}

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
      {balancesOpen && (
        <UpdateBalancesModal
          accounts={retirementAccounts.filter((a) => live.some((p) => p.accountId === a.id))}
          positions={live} quotes={quotes} onClose={() => setBalancesOpen(false)} />
      )}
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

/** Same house chart contract as the pile's value chart — VALUE, not return:
 * contributions move this line too. Captured by the daily snapshot from
 * whatever the balances were that day. */
function RetirementValueChart({ snapshots }: { snapshots: Snapshot[] }) {
  const isDark = useIsDark();
  const gridColor = isDark ? '#334155' : '#e5e7eb';
  const axisColor = isDark ? '#94a3b8' : '#6b7280';
  const green = isDark ? '#22c55e' : '#16a34a';
  const data = snapshots.map((s) => ({
    date: s.date.slice(5),
    Value: roundCents(s.retirementValue ?? 0),
  }));
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">
        Retirement value over time
        <span className="ml-2 text-xs font-normal text-gray-400">
          value, not return — contributions move this line too
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

/** The daily routine, matched to how the owner actually checks: one balance
 * per account, straight off the Voya screen. The delta lands on the
 * manually-priced holdings by scaling their prices proportionally — weights
 * hold, the total lands exact, and live-quoted holdings (BTC) are left
 * alone: their value is subtracted before scaling. Weights drift between
 * true-ups; the Update-prices form corrects them with real unit values. */
function UpdateBalancesModal({
  accounts, positions, quotes, onClose,
}: {
  accounts: { id: string; name: string; retirementFlavor?: string | null }[];
  positions: ParkedPosition[];
  quotes: Record<string, number>;
  onClose: () => void;
}) {
  const { overrides, updateParkedPrices } = useData();
  const perAccount = useMemo(
    () =>
      accounts.map((a) => {
        const holdings = positions.filter((p) => p.accountId === a.id);
        const isLive = (p: ParkedPosition) =>
          quotes[p.ticker] !== undefined || overrides[p.ticker] !== undefined;
        const liveValue = holdings.filter(isLive).reduce((s, p) => s + parkedMarketValue(p), 0);
        const manual = holdings.filter((p) => !isLive(p));
        const manualValue = manual.reduce((s, p) => s + parkedMarketValue(p), 0);
        return { account: a, total: liveValue + manualValue, liveValue, manual, manualValue };
      }),
    [accounts, positions, quotes, overrides],
  );
  const [balances, setBalances] = useState<Record<string, string>>(() =>
    Object.fromEntries(perAccount.map((r) => [r.account.id, String(roundCents(r.total))])),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const priceUpdates: { id: string; price: number }[] = [];
    for (const r of perAccount) {
      const entered = Number(balances[r.account.id]);
      if (!entered || Math.abs(entered - r.total) < 0.005) continue; // unchanged
      if (r.manual.length === 0) {
        return setFormError(
          `${r.account.name} is fully live-priced — its balance follows the quotes and can't be set by hand.`,
        );
      }
      const targetManual = entered - r.liveValue;
      if (targetManual <= 0 || r.manualValue <= 0) {
        return setFormError(
          `${r.account.name}: the entered balance is below its live-priced holdings' value (${formatCurrency(roundCents(r.liveValue))}) — check the number.`,
        );
      }
      const factor = targetManual / r.manualValue;
      for (const p of r.manual) {
        priceUpdates.push({ id: p.id, price: Number((p.currentPrice * factor).toFixed(4)) });
      }
    }
    if (priceUpdates.length === 0) return onClose();
    setBusy(true);
    try {
      await updateParkedPrices(priceUpdates);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Update balances">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-gray-400">
          Type each account's balance straight off its app. Manually-priced holdings scale
          proportionally so the total lands exact; live-quoted holdings (like BTC) are left to
          the feed. Weights drift a little between true-ups — Update prices fixes them with real
          unit values whenever you care to.
        </p>
        <div className="space-y-2">
          {perAccount.map((r) => (
            <div key={r.account.id} className="flex items-center gap-3">
              <span className="w-40 flex-shrink-0">
                <span className="text-sm font-medium">{r.account.name}</span>
                <span className="block text-[11px] text-gray-400 tabular-nums">
                  now {formatCurrency(roundCents(r.total))}
                  {r.liveValue > 0 && r.manual.length > 0 &&
                    ` · ${formatCurrency(roundCents(r.liveValue))} live`}
                  {r.manual.length === 0 && ' · fully live-priced'}
                </span>
              </span>
              <input type="number" step="0.01" min="0" value={balances[r.account.id] ?? ''}
                onChange={(e) => setBalances((m) => ({ ...m, [r.account.id]: e.target.value }))}
                className={inputCls} disabled={r.manual.length === 0} />
            </div>
          ))}
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : 'Save balances'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** The true-up: exact unit values per manually-priced holding (no live
 * quote, no pin), written to the POSITION rows — the same store the daily
 * balance-scaler adjusts, so the two routines never fight. Pins (the
 * override table) stay reserved for misquoted real tickers via Edit. */
function UpdatePricesModal({
  positions, quotes, onClose,
}: {
  positions: ParkedPosition[];
  quotes: Record<string, number>;
  onClose: () => void;
}) {
  const { overrides, updateParkedPrices } = useData();
  const rows = useMemo(
    () =>
      positions
        .filter((p) => quotes[p.ticker] === undefined && overrides[p.ticker] === undefined)
        .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [positions, quotes, overrides],
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((p) => [p.id, String(p.currentPrice || '')])),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const entries = rows
      .map((p) => ({ id: p.id, price: Number(prices[p.id]) }))
      .filter((e2) => e2.price > 0);
    if (entries.length === 0) return setFormError('Nothing to update.');
    setBusy(true);
    try {
      await updateParkedPrices(entries);
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
          Every holding here has a live quote — nothing needs a manual price.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-gray-400">
            Exact unit values for the holdings no feed can price. This is the true-up that
            corrects any weight drift from the daily balance updates.
          </p>
          <div className="space-y-2">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="w-40 flex-shrink-0">
                  <span className="text-sm font-medium">{p.ticker}</span>
                  <span className="block text-[11px] text-gray-400 truncate">{p.account}</span>
                </span>
                <input type="number" step="any" min="0.0001" value={prices[p.id] ?? ''}
                  onChange={(e) => setPrices((m) => ({ ...m, [p.id]: e.target.value }))}
                  className={inputCls} placeholder="unit value ($)" />
              </div>
            ))}
          </div>
          {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={primaryBtnCls}>
              {busy ? 'Saving…' : `Save ${rows.length} price${rows.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

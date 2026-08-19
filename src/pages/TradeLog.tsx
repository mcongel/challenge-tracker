import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, ScrollText, Trash2 } from 'lucide-react';
import { useIsDark } from '../lib/useIsDark';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { useData } from '../contexts/DataContext';
import {
  netRealizedYTD, realizedGain, realizedPct, roundCents, stLt, taxYearOf, tradeDaysHeld,
  tradeStats,
} from '../lib/engine';
import { useIndustries } from '../lib/useIndustries';
import { useMemo } from 'react';
import {
  cn, compactUsd, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls,
  secondaryBtnCls, todayISO,
} from '../lib/utils';

/** Polarity per bar — the house P&L pair (same steps the YTD number wears). */
const GAIN = '#16a34a';
const LOSS = '#dc2626';

const EXIT_REASON_LABELS: Record<string, string> = {
  target_hit: 'target hit',
  calendar: 'calendar',
  early: 'early',
  thesis_broke: 'thesis broke',
};

export function TradeLog() {
  const {
    trades, setTradeWashSale, deleteTrade, outsideSales, accounts, deleteOutsideSale,
    loading, error,
  } = useData();
  const [rowError, setRowError] = useState<string | null>(null);
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [deletingTradeId, setDeletingTradeId] = useState<string | null>(null);
  const [deletingOutsideId, setDeletingOutsideId] = useState<string | null>(null);

  const isDark = useIsDark();
  const currentYear = taxYearOf(todayISO());
  const ytd = netRealizedYTD(trades, currentYear);
  const ordered = [...trades].sort((a, b) => b.closeDate.localeCompare(a.closeDate));
  const stats = tradeStats(trades);
  // Net realized per calendar month — the quarterly skim taxes what these
  // add up to. Same convention as YTD: wash-sale trades don't count.
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) {
      if (t.washSale) continue;
      const key = t.closeDate.slice(0, 7); // YYYY-MM
      m.set(key, (m.get(key) ?? 0) + realizedGain(t));
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, net]) => {
        const [y, mo] = key.split('-').map(Number);
        return {
          month: `${new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'short' })} '${String(y).slice(2)}`,
          net: roundCents(net),
        };
      });
  }, [trades]);
  // Vendor industry labels — the "win rate in WHAT?" dimension.
  const industries = useIndustries(trades.map((t) => t.ticker));
  const byIndustry = useMemo(() => {
    const groups = new Map<string, typeof trades>();
    for (const t of trades) {
      const ind = industries[t.ticker] ?? 'Unclassified';
      groups.set(ind, [...(groups.get(ind) ?? []), t]);
    }
    return [...groups.entries()]
      .map(([industry, ts]) => ({
        industry,
        s: tradeStats(ts),
        net: ts.reduce((sum, t) => sum + realizedGain(t), 0),
      }))
      .sort((a, b) => b.net - a.net);
  }, [trades, industries]);

  return (
    <div>
      <PageHeader
        title="Trade Log"
        subtitle="Every close. ST = held 365 days or less; wash-sale losses don't count toward YTD."
        actions={
          <button onClick={() => setOutsideOpen(true)}
            className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Record outside sale
          </button>
        }
      />

      {error && <ErrorCard message={error} />}
      {rowError && <ErrorCard message={rowError} />}

      <div className="bg-white rounded-lg shadow-lg p-4 mb-4 density-aware-card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-xs font-medium text-gray-500">Net realized {currentYear} (drives the tax skim)</p>
          <p className={cn('mt-0.5 text-2xl font-bold tabular-nums', ytd >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(roundCents(ytd))}
          </p>
        </div>
        <p className="text-xs text-gray-400">{trades.length} closed trade{trades.length === 1 ? '' : 's'}</p>
      </div>

      {/* Net realized per month. Shows from the first month: one lonely bar
          beats an invisible feature, and the axis gives even that its scale. */}
      {byMonth.length >= 1 && (
        <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-1">
            Realized by month
            <span className="ml-2 text-xs font-normal text-gray-400">
              net of basis, wash sales excluded — the quarterly skim taxes what these add up to
            </span>
          </p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={isDark ? '#334155' : '#e5e7eb'} vertical={false} />
                <XAxis dataKey="month" stroke={isDark ? '#94a3b8' : '#6b7280'} tickLine={false}
                  axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis stroke={isDark ? '#94a3b8' : '#6b7280'} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: 'transparent' }} />
                <ReferenceLine y={0} stroke={isDark ? '#94a3b8' : '#6b7280'} />
                <Bar dataKey="net" name="Net realized">
                  {byMonth.map((q) => (
                    <Cell key={q.month} fill={q.net >= 0 ? GAIN : LOSS} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Know thyself — the pattern behind the closes. The best picking input
          there is: what YOUR trades actually do. */}
      {stats.count >= 2 && (
        <div className="bg-white rounded-lg shadow-lg p-4 mb-4 density-aware-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Your pattern — all {stats.count} closes
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="text-xs text-gray-500">Win rate</p>
              <p className="font-bold tabular-nums">
                {stats.winRate != null ? formatPercent(stats.winRate, 0) : '—'}
                <span className="ml-1 text-xs font-normal text-gray-400">{stats.wins}W · {stats.losses}L</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Avg winner</p>
              <p className="font-bold tabular-nums text-green-600">
                {stats.avgWin != null ? formatCurrency(roundCents(stats.avgWin)) : '—'}
                {stats.avgWinPct != null && (
                  <span className="ml-1 text-xs font-normal">({formatPercent(stats.avgWinPct)})</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Avg loser</p>
              <p className="font-bold tabular-nums text-red-600">
                {stats.avgLoss != null ? formatCurrency(roundCents(stats.avgLoss)) : '—'}
                {stats.avgLossPct != null && (
                  <span className="ml-1 text-xs font-normal">({formatPercent(stats.avgLossPct)})</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500" title="Average winner ÷ average loser — how much a win pays for each loss. Above 1 means winners outpay losers.">
                Payoff ratio
              </p>
              <p className="font-bold tabular-nums">
                {stats.payoff != null ? `${(Math.round(stats.payoff * 100) / 100)}×` : '—'}
                {stats.avgHoldDays != null && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    ~{Math.round(stats.avgHoldDays)}d avg hold
                  </span>
                )}
              </p>
            </div>
          </div>
          {stats.best && stats.worst && stats.count >= 3 && (
            <p className="mt-2 text-xs text-gray-400 tabular-nums">
              Best: {stats.best.ticker} {formatCurrency(roundCents(realizedGain(stats.best)))} ·
              Worst: {stats.worst.ticker} {formatCurrency(roundCents(realizedGain(stats.worst)))}
            </p>
          )}
          {(() => {
            const reasoned = trades.filter((t) => t.exitReason && EXIT_REASON_LABELS[t.exitReason]);
            if (reasoned.length < 2) return null;
            const counts = new Map<string, number>();
            for (const t of reasoned) counts.set(t.exitReason!, (counts.get(t.exitReason!) ?? 0) + 1);
            return (
              <p className="mt-2 text-xs text-gray-400"
                title="Target calibration: mostly target-hit exits mean the written targets are honest; mostly early exits mean they're fantasy (or nerves).">
                Exits: {[...counts.entries()].map(([r, n]) => `${n} ${EXIT_REASON_LABELS[r]}`).join(' · ')}
                {reasoned.length < trades.length && ` · ${trades.length - reasoned.length} unlabeled`}
              </p>
            );
          })()}
          {byIndustry.length >= 2 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="text-xs font-medium text-gray-500 mb-1">By industry — where the edge actually is</p>
              <ul className="space-y-0.5 text-xs tabular-nums">
                {byIndustry.map(({ industry, s, net }) => (
                  <li key={industry} className="flex flex-wrap gap-x-3">
                    <span className="text-gray-600 min-w-[10rem]">{industry}</span>
                    <span className="text-gray-500">{s.wins}W–{s.losses}L</span>
                    <span className={cn('font-medium', net >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(roundCents(net)))}
                    </span>
                    {s.winRate != null && s.count >= 2 && (
                      <span className="text-gray-400">{formatPercent(s.winRate, 0)} win rate</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonTable />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No closed trades yet"
          hint="Trades appear here when positions are closed on the Positions screen."
        />
      ) : (
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Open</th>
                <th className="px-4 py-3">Close</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3 text-right">Basis</th>
                <th className="px-4 py-3 text-right">Proceeds</th>
                <th className="px-4 py-3 text-right">Gain $</th>
                <th className="px-4 py-3 text-right">Gain %</th>
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">Wash</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ordered.map((t) => {
                const gain = realizedGain(t);
                const pct = realizedPct(t);
                const big = Math.abs(pct) > 0.25;
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {t.ticker}
                      {industries[t.ticker] && (
                        <span className="block text-xs font-normal text-gray-400">{industries[t.ticker]}</span>
                      )}
                      {t.exitReason && EXIT_REASON_LABELS[t.exitReason] && (
                        <span className={cn('mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          t.exitReason === 'target_hit' ? 'bg-green-50 text-green-700'
                          : t.exitReason === 'thesis_broke' ? 'bg-red-50 text-red-700'
                          : 'bg-gray-100 text-gray-600')}>
                          {EXIT_REASON_LABELS[t.exitReason]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-500">{t.openDate}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-500">{t.closeDate}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{tradeDaysHeld(t)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(t.costBasis)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(t.proceeds)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-medium',
                      gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatCurrency(roundCents(gain))}
                    </td>
                    <td className={cn('px-4 py-3 text-right tabular-nums',
                      gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {formatPercent(pct)}
                      {big && (
                        <Link to="/rules" className="ml-1.5 text-xs text-indigo-600 hover:text-indigo-800">
                          read the rules
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        stLt(t) === 'LT' ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700')}>
                        {stLt(t)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={t.washSale}
                        onChange={(e) => setTradeWashSale(t.id, e.target.checked).catch((err) =>
                          setRowError(err instanceof Error ? err.message : String(err)))}
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600"
                        title="Wash sale — loss disallowed"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-500"><div className="max-w-[12rem] truncate">{t.notes}</div></td>
                    <td className="px-2 py-3">
                      <button onClick={() => setDeletingTradeId(t.id)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete trade">
                        <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Outside sales — the cross-brokerage wash-sale radar (Rule 9). */}
      {outsideSales.length > 0 && (
        <div className="mt-4 bg-white rounded-lg shadow-lg overflow-x-auto">
          <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Outside sales — wash-sale radar only, never in the score
          </p>
          <table className="w-full text-sm compact-table">
            <tbody className="divide-y divide-gray-100">
              {[...outsideSales].reverse().map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 tabular-nums text-gray-500 w-28">{s.saleDate}</td>
                  <td className="px-4 py-2 font-medium w-20">{s.ticker}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {accounts.find((a) => a.id === s.accountId)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    {s.loss ? (
                      <span className="inline-block rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-medium">
                        loss — 31-day window
                      </span>
                    ) : (
                      <span className="inline-block rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-medium">
                        gain
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500"><div className="max-w-[12rem] truncate">{s.notes}</div></td>
                  <td className="px-2 py-2 w-10">
                    <button
                      onClick={() => setDeletingOutsideId(s.id)}
                      className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete outside sale">
                      <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {outsideOpen && <OutsideSaleModal onClose={() => setOutsideOpen(false)} />}

      {deletingTradeId && (
        <ConfirmModal
          title="Delete trade"
          message="Delete this trade? The YTD realized number — and with it the tax skim target — recomputes without it."
          onConfirm={() => deleteTrade(deletingTradeId)}
          onClose={() => setDeletingTradeId(null)}
        />
      )}
      {deletingOutsideId && (
        <ConfirmModal
          title="Delete outside sale"
          message="Delete this outside sale? The wash-sale radar forgets it — a rebuy inside its 31-day window won't be flagged."
          onConfirm={() => deleteOutsideSale(deletingOutsideId)}
          onClose={() => setDeletingOutsideId(null)}
        />
      )}
    </div>
  );
}

function OutsideSaleModal({ onClose }: { onClose: () => void }) {
  const { accounts, addOutsideSale } = useData();
  const outsideAccounts = accounts.filter((a) => a.kind === 'outside');
  const [ticker, setTicker] = useState('');
  const [accountId, setAccountId] = useState(outsideAccounts[0]?.id ?? '');
  const [saleDate, setSaleDate] = useState(todayISO());
  const [loss, setLoss] = useState(true);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!accountId) return setFormError('Pick the account the sale happened in.');
    setBusy(true);
    try {
      await addOutsideSale({
        ticker: ticker.toUpperCase(),
        accountId,
        saleDate,
        loss,
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
    <Modal isOpen onClose={onClose} title="Record outside sale">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="GLW" />
          </div>
          <div>
            <label className={labelCls}>Sale date</label>
            <input type="date" required value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account" kinds={['outside']} allowNone={false} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={loss} onChange={(e) => setLoss(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Sold at a loss (starts the 31-day wash-sale window — Rule 9 crosses brokerages)
        </label>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Radar only: this never touches the score, YTD realized, or the tax skim. It exists so a
          challenge-account buy inside the window gets called out.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Saving…' : 'Record sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

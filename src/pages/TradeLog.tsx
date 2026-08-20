import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, ScrollText, Trash2 } from 'lucide-react';
import { useChartColors } from '../lib/useIsDark';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card, TableCard, theadCls } from '../components/ui/Card';
import { RowCard, RowCardStat } from '../components/ui/RowCard';
import { SortHeader, useSortState } from '../components/ui/SortHeader';
import { Field } from '../components/ui/Field';
import { FormError, ModalFooter, useModalForm } from '../components/ui/useModalForm';
import { useData } from '../contexts/DataContext';
import {
  netRealizedYTD, realizedGain, realizedPct, roundCents, stLt, taxYearOf, tradeDaysHeld,
  tradeStats,
} from '../lib/engine';
import { useIndustries } from '../lib/useIndustries';
import { useMemo } from 'react';
import {
  cn, compactUsd, errorMessage, formatCurrency, formatPercent, inputCls, money,
  secondaryBtnCls, signedMoney, todayISO,
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

type TradeSortKey = 'closeDate' | 'ticker' | 'gain' | 'daysHeld';

export function TradeLog() {
  const {
    trades, setTradeWashSale, deleteTrade, outsideSales, accounts, deleteOutsideSale,
    loading, error,
  } = useData();
  const [rowError, setRowError] = useState<string | null>(null);
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [deletingTradeId, setDeletingTradeId] = useState<string | null>(null);
  const [deletingOutsideId, setDeletingOutsideId] = useState<string | null>(null);

  const { gridColor, axisColor } = useChartColors();
  const currentYear = taxYearOf(todayISO());
  const ytd = netRealizedYTD(trades, currentYear);
  // Sortable close list — newest close first stays the default. The same
  // ordering feeds the table and the phone cards.
  const { sort, toggleSort } = useSortState<TradeSortKey>({
    initial: { key: 'closeDate', dir: 'desc' },
    naturalDir: { closeDate: 'desc', ticker: 'asc', gain: 'desc', daysHeld: 'desc' },
    storageKey: 'tradeLogSort',
  });
  const ordered = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...trades].sort((a, b) => {
      switch (sort.key) {
        case 'ticker': return dir * a.ticker.localeCompare(b.ticker);
        case 'gain': return dir * (realizedGain(a) - realizedGain(b));
        case 'daysHeld': return dir * (tradeDaysHeld(a) - tradeDaysHeld(b));
        default: return dir * a.closeDate.localeCompare(b.closeDate);
      }
    });
  }, [trades, sort]);
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

      <Card className="p-4 mb-4 density-aware-card flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-xs font-medium text-gray-500">Net realized {currentYear} (drives the tax skim)</p>
          <p className={cn('mt-0.5 text-2xl font-bold tabular-nums', ytd >= 0 ? 'text-green-600' : 'text-red-600')}>
            {money(ytd)}
          </p>
        </div>
        <p className="text-xs text-gray-400">{trades.length} closed trade{trades.length === 1 ? '' : 's'}</p>
      </Card>

      {/* Net realized per month. Shows from the first month: one lonely bar
          beats an invisible feature, and the axis gives even that its scale. */}
      {byMonth.length >= 1 && (
        <Card className="p-4 sm:p-6 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-1">
            Realized by month
            <span className="ml-2 text-xs font-normal text-gray-400">
              net of basis, wash sales excluded — the quarterly skim taxes what these add up to
            </span>
          </p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="month" stroke={axisColor} tickLine={false}
                  axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: 'transparent' }} />
                <ReferenceLine y={0} stroke={axisColor} />
                <Bar dataKey="net" name="Net realized">
                  {byMonth.map((q) => (
                    <Cell key={q.month} fill={q.net >= 0 ? GAIN : LOSS} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Know thyself — the pattern behind the closes. The best picking input
          there is: what YOUR trades actually do. */}
      {stats.count >= 2 && (
        <Card className="p-4 mb-4 density-aware-card">
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
                {stats.avgWin != null ? money(stats.avgWin) : '—'}
                {stats.avgWinPct != null && (
                  <span className="ml-1 text-xs font-normal">({formatPercent(stats.avgWinPct)})</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Avg loser</p>
              <p className="font-bold tabular-nums text-red-600">
                {stats.avgLoss != null ? money(stats.avgLoss) : '—'}
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
              Best: {stats.best.ticker} {money(realizedGain(stats.best))} ·
              Worst: {stats.worst.ticker} {money(realizedGain(stats.worst))}
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
                      {signedMoney(net)}
                    </span>
                    {s.winRate != null && s.count >= 2 && (
                      <span className="text-gray-400">{formatPercent(s.winRate, 0)} win rate</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
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
        <TableCard
          cards={ordered.map((t) => {
            const gain = realizedGain(t);
            return (
              <RowCard
                key={t.id}
                title={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="tabular-nums text-gray-600">{t.closeDate}</span>
                    <span className="font-medium">{t.ticker}</span>
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      stLt(t) === 'LT' ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700')}>
                      {stLt(t)}
                    </span>
                    {t.washSale && (
                      <span className="inline-block rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-xs font-medium"
                        title="Wash sale — loss disallowed">
                        wash
                      </span>
                    )}
                  </span>
                }
                value={
                  <span className={gain >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {money(gain)}
                  </span>
                }
                actions={
                  <>
                    <label className="flex items-center gap-1.5 p-2 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={t.washSale}
                        onChange={(e) => setTradeWashSale(t.id, e.target.checked).catch((err) =>
                          setRowError(errorMessage(err)))}
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600"
                        title="Wash sale — loss disallowed"
                      />
                      Wash
                    </label>
                    <button onClick={() => setDeletingTradeId(t.id)} className="p-2 rounded hover:bg-red-50" aria-label="Delete trade">
                      <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                    </button>
                  </>
                }
              >
                <RowCardStat label="Days held">{tradeDaysHeld(t)}</RowCardStat>
                <RowCardStat label="Proceeds / basis">
                  {formatCurrency(t.proceeds)} / {formatCurrency(t.costBasis)}
                </RowCardStat>
                {t.notes && <p className="mt-1 text-xs text-gray-500 truncate">{t.notes}</p>}
              </RowCard>
            );
          })}
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0 group/head">
              <tr className={theadCls}>
                <SortHeader label="Ticker" sortKey="ticker" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-3">Open</th>
                <SortHeader label="Close" sortKey="closeDate" sort={sort} onSort={toggleSort} />
                <SortHeader label="Days" sortKey="daysHeld" sort={sort} onSort={toggleSort} align="right" />
                <th className="px-4 py-3 text-right">Basis</th>
                <th className="px-4 py-3 text-right">Proceeds</th>
                <SortHeader label="Gain $" sortKey="gain" sort={sort} onSort={toggleSort} align="right" />
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
                      {money(gain)}
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
                          setRowError(errorMessage(err)))}
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
        </TableCard>
      )}

      {/* Outside sales — the cross-brokerage wash-sale radar (Rule 9). */}
      {outsideSales.length > 0 && (
        <TableCard
          className="mt-4"
          toolbar={
            <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Outside sales — wash-sale radar only, never in the score
            </p>
          }
          cards={[...outsideSales].reverse().map((s) => (
            <RowCard
              key={s.id}
              title={
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="tabular-nums text-gray-600">{s.saleDate}</span>
                  <span className="font-medium">{s.ticker}</span>
                  {s.loss ? (
                    <span className="inline-block rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-medium">
                      loss — 31-day window
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-medium">
                      gain
                    </span>
                  )}
                </span>
              }
              actions={
                <button
                  onClick={() => setDeletingOutsideId(s.id)}
                  className="p-2 rounded hover:bg-red-50" aria-label="Delete outside sale">
                  <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                </button>
              }
            >
              {s.notes && <p className="mt-1 text-xs text-gray-500 truncate">{s.notes}</p>}
            </RowCard>
          ))}
        >
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
        </TableCard>
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

  const { busy, formError, submit } = useModalForm(async () => {
    if (!accountId) throw new Error('Pick the account the sale happened in.');
    await addOutsideSale({
      ticker: ticker.toUpperCase(),
      accountId,
      saleDate,
      loss,
      notes: notes || null,
    });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title="Record outside sale">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ticker">
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="GLW" />
          </Field>
          <Field label="Sale date">
            <input type="date" required value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account" kinds={['outside']} allowNone={false} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={loss} onChange={(e) => setLoss(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Sold at a loss (starts the 31-day wash-sale window — Rule 9 crosses brokerages)
        </label>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Radar only: this never touches the score, YTD realized, or the tax skim. It exists so a
          challenge-account buy inside the window gets called out.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Record sale" />
      </form>
    </Modal>
  );
}

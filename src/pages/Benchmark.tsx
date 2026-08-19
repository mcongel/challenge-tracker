import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { Pencil, Swords } from 'lucide-react';
import { useChartColors } from '../lib/useIsDark';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card, TableCard, theadCls } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { FormError } from '../components/ui/useModalForm';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from '../lib/alerts';
import {
  lead, leadPct, roundCents, rollingLeadDelta, shadowShares, shadowValue, totalScore,
} from '../lib/engine';
import {
  cn, compactUsd, errorMessage, formatCurrency, formatPercent, inputCls, money, primaryBtnCls,
  todayISO,
} from '../lib/utils';

/** Polarity colors for the lead (ahead/behind) — the house P&L pair, both
 * steps inside the validated lightness band on both surfaces. */
const AHEAD = '#16a34a';
const BEHIND = '#dc2626';

export function Benchmark() {
  const {
    benchmarkDeposits, lots, cashEvents, milestones, snapshots, overrides, overrideSetAt, quotes,
    setOverride, clearOverride, loading, error,
  } = useData();
  const [priceOpen, setPriceOpen] = useState(false);
  const { gridColor, axisColor } = useChartColors();

  const vooPinned = overrides['VOO'];
  const vooToday = vooPinned ?? quotes['VOO'];
  const score = totalScore(lots, priceMapFor(lots, overrides, quotes), cashEvents, milestones);
  const shadow = vooToday ? shadowValue(benchmarkDeposits, vooToday) : null;
  const delta = rollingLeadDelta(snapshots, todayISO());

  // The race chart on the Dashboard shows two lines; the verdict is their
  // GAP. One zero-anchored series makes widening or eroding unmissable.
  const leadData = useMemo(
    () => snapshots.map((s) => ({
      date: s.date.slice(5),
      Lead: roundCents(s.totalScore - s.shadowVooValue),
    })),
    [snapshots],
  );
  // Gradient split at zero: green above the line, red below (recharts offset
  // technique — the same series changes color as it crosses).
  const leadSplit = useMemo(() => {
    const values = leadData.map((d) => d.Lead);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    return max === min ? 1 : max / (max - min);
  }, [leadData]);

  // Trading alpha: is the account anything more than its deposits?
  const alphaData = useMemo(
    () => snapshots.map((s) => ({
      date: s.date.slice(5),
      'Account value': roundCents(s.accountValue),
      'Net contributed': roundCents(s.netContributed),
    })),
    [snapshots],
  );


  return (
    <div>
      <PageHeader
        title="Benchmark"
        subtitle="The honest test: every deposit buys shadow VOO the same day. Beat the shadow over rolling 12 months and the edge is real."
        actions={
          <button
            onClick={() => setPriceOpen(true)}
            className={cn(primaryBtnCls, 'flex items-center gap-1.5')}
            title={vooPinned !== undefined
              ? `Pinned manual price — beats the live quote${overrideSetAt['VOO'] ? `, set ${overrideSetAt['VOO'].slice(0, 10)}` : ''}`
              : 'Live quote — click to pin a manual price'}
          >
            <Pencil className="h-4 w-4" />
            {vooToday ? `VOO ${formatCurrency(vooToday)}` : 'Set VOO price'}
            {vooPinned !== undefined && (
              <span className="text-[10px] uppercase font-bold opacity-80">pin</span>
            )}
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {/* The race */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">You (Total Score)</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">{money(score)}</p>
        </Card>
        <Card className="p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Shadow VOO</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
            {shadow === null ? '—' : money(shadow)}
          </p>
          {shadow === null && <p className="text-xs text-gray-400 mt-0.5">set today's VOO price</p>}
        </Card>
        <Card className="p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Lead</p>
          {shadow === null ? (
            <p className="mt-0.5 text-2xl font-bold text-gray-400">—</p>
          ) : (
            <p className={cn('mt-0.5 text-2xl font-bold tabular-nums',
              lead(score, shadow) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {money(lead(score, shadow))}
              <span className="ml-2 text-sm font-medium">{formatPercent(leadPct(score, shadow))}</span>
            </p>
          )}
        </Card>
      </div>

      <Card className="p-4 mb-4 density-aware-card">
        <p className="text-xs font-medium text-gray-500">Rolling 12-month verdict</p>
        {delta === null ? (
          <p className="mt-0.5 text-sm text-gray-400">
            Needs a year of daily snapshots — the verdict unlocks {snapshots.length > 0 ? 'as history accumulates' : 'once the scoreboard starts recording'}.
          </p>
        ) : (
          <p className={cn('mt-0.5 text-lg sm:text-xl font-bold tabular-nums', delta >= 0 ? 'text-green-600' : 'text-red-600')}>
            {delta >= 0 ? 'AHEAD' : 'BEHIND'} by {money(Math.abs(delta))} over the trailing year
            <span className="ml-2 text-xs font-normal text-gray-400">
              {delta >= 0 ? 'edge demonstrated — adding capital is investing' : 'the experiment is answering the question'}
            </span>
          </p>
        )}
      </Card>

      {/* Lead over time — the gap as its own series, zero-anchored */}
      {leadData.length >= 2 && (
        <Card className="p-4 sm:p-6 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-1">
            Lead over time
            <span className="ml-2 text-xs font-normal text-gray-400">
              Total Score − shadow VOO · green ahead, red behind
            </span>
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={leadData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={leadSplit} stopColor={AHEAD} stopOpacity={0.2} />
                    <stop offset={leadSplit} stopColor={BEHIND} stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="leadStroke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={leadSplit} stopColor={AHEAD} />
                    <stop offset={leadSplit} stopColor={BEHIND} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <ReferenceLine y={0} stroke={axisColor} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="Lead" stroke="url(#leadStroke)" strokeWidth={2}
                  fill="url(#leadFill)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Trading alpha — the account against its own deposits */}
      {alphaData.length >= 2 && (
        <Card className="p-4 sm:p-6 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-1">
            Trading alpha
            <span className="ml-2 text-xs font-normal text-gray-400">
              account value vs money in — the gap is what trading added
            </span>
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={alphaData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Account value" stroke={AHEAD} strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} />
                {/* A reference baseline, not a competitor — gray and stepped,
                    since deposits move in jumps. */}
                <Line type="stepAfter" dataKey="Net contributed" stroke={axisColor} strokeWidth={2}
                  strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {loading ? (
        <SkeletonTable />
      ) : benchmarkDeposits.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="No shadow purchases yet"
          hint="Each deposit on the Cash Ledger creates one automatically — amount ÷ that day's VOO price."
        />
      ) : (
        <TableCard
          footer={
            <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
              Two honesty notes: the shadow ignores VOO dividends (~1.3%/yr — flatters you), and the raw
              comparison ignores taxes (short-term gains ~28–30% vs ~21% long-term VOO — flatters you
              too). The real hurdle is higher than the lead suggests.
            </p>
          }
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className={theadCls}>
                <th className="px-4 py-3">Deposit date</th>
                <th className="px-4 py-3 text-right">Amount in</th>
                <th className="px-4 py-3 text-right">VOO that day</th>
                <th className="px-4 py-3 text-right">Shadow shares</th>
                <th className="px-4 py-3 text-right">Worth today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...benchmarkDeposits].reverse().map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 tabular-nums text-gray-600">{d.date}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(d.vooPriceThatDay)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{shadowShares(d).toFixed(6)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {vooToday ? money(shadowShares(d) * vooToday) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      {priceOpen && (
        <VooPriceModal
          current={vooToday}
          pinned={vooPinned !== undefined}
          onClose={() => setPriceOpen(false)}
          onSet={setOverride}
          onClear={() => clearOverride('VOO')}
        />
      )}
    </div>
  );
}

function VooPriceModal({
  current, pinned, onClose, onSet, onClear,
}: {
  current?: number;
  pinned: boolean;
  onClose: () => void;
  onSet: (ticker: string, price: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [price, setPrice] = useState(current ? String(current) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Deliberately NOT useModalForm: the clear-pin button is a second submit
  // path sharing the same busy/error state, which the hook can't drive.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price);
    if (!p || p <= 0) return setFormError('Price must be positive.');
    setBusy(true);
    try {
      await onSet('VOO', p);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="VOO price today">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Price ($)">
          <input type="number" step="0.01" min="0.01" required autoFocus value={price}
            onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Setting a price pins it — it beats the live quote until cleared. With no pin, the delayed
          quote feed prices the shadow automatically.
        </p>
        <FormError message={formError} />
        <div className={cn('flex', pinned ? 'justify-between' : 'justify-end')}>
          {pinned && (
            <button
              type="button"
              disabled={busy}
              className="text-sm font-medium text-red-600 hover:text-red-800"
              onClick={async () => {
                setBusy(true);
                try {
                  await onClear();
                  onClose();
                } catch (err) {
                  setFormError(errorMessage(err));
                  setBusy(false);
                }
              }}
            >
              Clear pin — use live quote
            </button>
          )}
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Pin price'}</button>
        </div>
      </form>
    </Modal>
  );
}

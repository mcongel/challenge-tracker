import { useMemo, useState } from 'react';
import { HandCoins, History, Pencil, Trash2 } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { CLASSIFICATION_LABELS, classificationPillCls, SortHeader } from './ParkedPile';
import type { SortState } from './ParkedPile';
import { useData } from '../contexts/DataContext';
import type {
  DividendClassification, DividendFrequency, ParkedLot, ParkedPosition, PositionIncomeSummary,
} from '../lib/engine';
import {
  aggregateLots, dividendTaxYTD, positionIncomeSummary, roundCents, taxYearOf,
  trailingIncomeByMonth,
} from '../lib/engine';
import {
  cn, compactUsd, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls,
  secondaryBtnCls, todayISO,
} from '../lib/utils';
import { useIsDark } from '../lib/useIsDark';

/** Same CVD-validated pair as the Dashboard chart: actuals in brand green,
 * projections in indigo. No new hues. */
const SERIES = {
  actual: { light: '#16a34a', dark: '#16a34a' },
  projected: { light: '#4f46e5', dark: '#6366f1' },
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;

const FREQUENCY_LABELS: Record<DividendFrequency, string> = {
  monthly: 'monthly', quarterly: 'quarterly', semiannual: 'semiannual', annual: 'annual',
};

type HistSortKey = 'date' | 'ticker' | 'amount' | 'classification';
const HIST_NATURAL_DIR: Record<HistSortKey, 'asc' | 'desc'> = {
  date: 'desc', // history reads newest-first
  ticker: 'asc',
  amount: 'desc',
  classification: 'asc',
};
const HIST_KEYS = Object.keys(HIST_NATURAL_DIR) as HistSortKey[];

interface HistRow {
  lot: ParkedLot;
  ticker: string;
  account: string;
}

export function Income() {
  const {
    parked, parkedLots, dividendTaxRates, deleteParkedLot, loading, error,
  } = useData();
  const today = todayISO();

  const lotsByPosition = useMemo(() => {
    const m = new Map<string, ParkedLot[]>();
    for (const l of parkedLots) (m.get(l.parkedPositionId) ?? m.set(l.parkedPositionId, []).get(l.parkedPositionId)!).push(l);
    return m;
  }, [parkedLots]);

  const summaries = useMemo(
    () =>
      parked.map((p) => ({
        position: p,
        lots: lotsByPosition.get(p.id) ?? [],
        summary: positionIncomeSummary(p, lotsByPosition.get(p.id) ?? [], today, dividendTaxRates),
      })),
    [parked, lotsByPosition, today, dividendTaxRates],
  );

  const trailing = useMemo(() => trailingIncomeByMonth(parkedLots, today), [parkedLots, today]);
  const trailingTotal = trailing.reduce((t, p) => t + p.amount, 0);

  const projectedGross = summaries.reduce((t, s) => t + (s.summary.projection?.annualGross ?? 0), 0);
  const projectedAfterTax = summaries.reduce((t, s) => t + (s.summary.projection?.annualAfterTax ?? 0), 0);

  const taxYtd = useMemo(
    () => dividendTaxYTD(parkedLots, taxYearOf(today), dividendTaxRates),
    [parkedLots, today, dividendTaxRates],
  );

  // Portfolio yield on cost: only positions that project income count — in
  // both the numerator and the denominator — so excluded holdings can't dilute.
  const included = summaries.filter((s) => s.summary.projection);
  const includedBasis = included.reduce((t, s) => t + aggregateLots(s.lots).costBasis, 0);
  const portfolioYoc = includedBasis > 0
    ? included.reduce((t, s) => t + (s.summary.projection?.annualGross ?? 0), 0) / includedBasis
    : null;

  // 24-month chart: trailing actuals then projected months.
  const isDark = useIsDark();
  const gridColor = isDark ? '#334155' : '#e5e7eb';
  const axisColor = isDark ? '#94a3b8' : '#6b7280';
  const chartData = useMemo(() => {
    const projectedByMonth = new Map<string, number>();
    for (const s of summaries) {
      for (const pt of s.summary.projection?.monthly ?? []) {
        projectedByMonth.set(pt.month, (projectedByMonth.get(pt.month) ?? 0) + pt.amount);
      }
    }
    const projMonths = [...projectedByMonth.keys()].sort();
    return [
      ...trailing.map((p) => ({ label: monthLabel(p.month), actual: roundCents(p.amount), projected: null as number | null })),
      ...projMonths.map((m) => ({ label: monthLabel(m), actual: null as number | null, projected: roundCents(projectedByMonth.get(m) ?? 0) })),
    ];
  }, [trailing, summaries]);
  const hasChart = trailingTotal > 0 || projectedGross > 0;

  const anyRoc = summaries.some((s) => s.summary.rocCumulative > 0);
  const anyDividends = parkedLots.some((l) => l.source === 'dividend');
  const anyIncome = anyDividends || included.length > 0;

  // Distribution history rows + sorting.
  const histRows = useMemo<HistRow[]>(() => {
    const posById = new Map(parked.map((p) => [p.id, p]));
    return parkedLots
      .filter((l) => l.source === 'dividend')
      .map((l) => ({
        lot: l,
        ticker: posById.get(l.parkedPositionId)?.ticker ?? '?',
        account: posById.get(l.parkedPositionId)?.account ?? '',
      }));
  }, [parkedLots, parked]);

  const [histSort, setHistSortState] = useState<SortState<HistSortKey>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('incomeHistSort') ?? 'null');
      if (stored && HIST_KEYS.includes(stored.key) && (stored.dir === 'asc' || stored.dir === 'desc')) return stored;
    } catch { /* fall through to default */ }
    return { key: 'date', dir: 'desc' };
  });
  const setHistSort = (s: SortState<HistSortKey>) => {
    setHistSortState(s);
    localStorage.setItem('incomeHistSort', JSON.stringify(s));
  };
  const toggleHistSort = (key: HistSortKey) =>
    setHistSort(
      histSort.key === key
        ? { key, dir: histSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: HIST_NATURAL_DIR[key] },
    );

  const sortedHist = useMemo(() => {
    const flip = histSort.dir === 'asc' ? 1 : -1;
    const val = (r: HistRow): number | string => {
      switch (histSort.key) {
        case 'date': return r.lot.date ?? ''; // undated sinks to the oldest end
        case 'ticker': return r.ticker;
        case 'amount': return r.lot.amount;
        default: return r.lot.classification ?? 'unclassified';
      }
    };
    return [...histRows].sort((a, b) => {
      const av = val(a); const bv = val(b);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * flip;
      return (av - bv) * flip;
    });
  }, [histRows, histSort]);

  const [reclassifying, setReclassifying] = useState<HistRow | null>(null);
  const [deleting, setDeleting] = useState<HistRow | null>(null);
  const [editingRate, setEditingRate] = useState<ParkedPosition | null>(null);

  return (
    <div>
      <PageHeader
        title="Income"
        subtitle="What the parked pile pays. Context only — dividends never touch Total Score, the ratchet, or the 30% skim."
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : !anyIncome ? (
        <EmptyState
          icon={HandCoins}
          title="No dividend income tracked yet"
          hint="Log dividends from a holding's lot panel on the Parked Pile screen, or set a manual rate on a payer to project income before the first payment lands."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Trailing 12 months</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{formatCurrency(roundCents(trailingTotal))}</p>
              <p className="text-xs text-gray-400 mt-0.5">dividends received</p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Next 12 months</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{formatCurrency(roundCents(projectedGross))}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                ~{formatCurrency(roundCents(projectedAfterTax))} after est. tax
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Est. dividend tax YTD</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{formatCurrency(roundCents(taxYtd.totalTax))}</p>
              {taxYtd.unclassifiedAmount > 0 ? (
                <p className="text-xs text-amber-700 mt-0.5">
                  {formatCurrency(roundCents(taxYtd.unclassifiedAmount))} unclassified
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">informational — not the skim</p>
              )}
            </div>
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Yield on cost</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">
                {portfolioYoc != null ? formatPercent(portfolioYoc) : '—'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">projecting holdings only</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 density-aware-card mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Monthly income — last 12 actual, next 12 projected
            </p>
            {hasChart ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={gridColor} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false}
                      tick={{ fontSize: 11, fill: axisColor }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={compactUsd} width={52} tickLine={false} axisLine={false}
                      tick={{ fontSize: 11, fill: axisColor }} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="actual" name="Actual" fill={isDark ? SERIES.actual.dark : SERIES.actual.light} />
                    <Bar dataKey="projected" name="Projected" fill={isDark ? SERIES.projected.dark : SERIES.projected.light} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-gray-400 py-6 text-center">
                No dated dividends and nothing to project yet — log a payment or set a manual rate.
              </p>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-x-auto mb-4">
            <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Holdings
            </p>
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-2">Ticker</th>
                  <th className="px-4 py-2 text-right" title="Projected annual income / original cost basis">Yield on cost</th>
                  <th className="px-4 py-2 text-right">T12M</th>
                  <th className="px-4 py-2 text-right">Projected 12M</th>
                  <th className="px-4 py-2 text-right">Next payment</th>
                  <th className="px-4 py-2">Source</th>
                  {anyRoc && (
                    <th className="px-4 py-2 text-right" title="Cumulative return of capital. Display-only for now — basis adjustment comes in a later phase.">ROC</th>
                  )}
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...summaries]
                  .sort((a, b) => (b.summary.projection?.annualGross ?? 0) - (a.summary.projection?.annualGross ?? 0))
                  .map(({ position: p, summary: s }) => (
                    <HoldingRow key={p.id} position={p} summary={s} anyRoc={anyRoc}
                      onEditRate={() => setEditingRate(p)} />
                  ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
            <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Distribution history
            </p>
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50 group/head">
                <tr className="text-left text-xs">
                  <SortHeader<HistSortKey> label="Date" sortKey="date" sort={histSort} onSort={toggleHistSort} />
                  <SortHeader<HistSortKey> label="Ticker" sortKey="ticker" sort={histSort} onSort={toggleHistSort} />
                  <SortHeader<HistSortKey> label="Amount" sortKey="amount" sort={histSort} onSort={toggleHistSort} align="right" />
                  <SortHeader<HistSortKey> label="Class" sortKey="classification" sort={histSort} onSort={toggleHistSort} />
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedHist.map((r) => (
                  <tr key={r.lot.id} className="hover:bg-gray-50">
                    <td className={cn('px-4 py-2 tabular-nums', r.lot.date ? 'text-gray-600' : 'text-amber-800')}
                      title={r.lot.exDate ? `Ex-date ${r.lot.exDate}` : undefined}>
                      {r.lot.date ?? 'no date'}
                    </td>
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {r.ticker}
                      {r.account && <span className="ml-1 text-xs text-gray-400">{r.account}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatCurrency(r.lot.amount)}</td>
                    <td className="px-4 py-2">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        classificationPillCls(r.lot.classification ?? 'unclassified'))}>
                        {CLASSIFICATION_LABELS[r.lot.classification ?? 'unclassified']}
                      </span>
                      {r.lot.reclassifiedAt && (
                        <History className="ml-1 inline h-3.5 w-3.5 text-gray-400"
                          aria-label="Reclassified" />
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{r.lot.shares > 0 ? 'DRIP' : 'cash'}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setReclassifying(r)} className="p-1 rounded hover:bg-gray-100"
                          aria-label="Reclassify" title="Change classification (1099 correction)">
                          <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setDeleting(r)} className="p-1 rounded hover:bg-red-50"
                          aria-label="Delete dividend">
                          <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sortedHist.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-sm text-gray-400 text-center">No dividends recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {reclassifying && (
        <ReclassifyModal row={reclassifying} onClose={() => setReclassifying(null)} />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete dividend"
          message={`Delete this ${deleting.ticker} dividend (${formatCurrency(deleting.lot.amount)}${deleting.lot.shares > 0 ? `, ${deleting.lot.shares} DRIP sh` : ''})? ${deleting.lot.shares > 0 ? "The position's shares and cost recompute without it." : ''}`}
          onConfirm={() => deleteParkedLot(deleting.lot.id)}
          onClose={() => setDeleting(null)}
        />
      )}
      {editingRate && (
        <RateModal position={editingRate} onClose={() => setEditingRate(null)} />
      )}
    </div>
  );
}

function HoldingRow({
  position: p, summary: s, anyRoc, onEditRate,
}: {
  position: ParkedPosition;
  summary: PositionIncomeSummary;
  anyRoc: boolean;
  onEditRate: () => void;
}) {
  const proj = s.projection;
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 font-medium text-gray-900">
        {p.ticker}
        <span className="ml-1 text-xs text-gray-400">{p.account}</span>
        {s.hasUnclassified && (
          <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
            title="Some dividends are unclassified — estimates assume the qualified rate.">
            unclassified
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {s.yieldOnCost != null ? formatPercent(s.yieldOnCost) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {s.trailing12m > 0 ? formatCurrency(roundCents(s.trailing12m)) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {proj ? formatCurrency(roundCents(proj.annualGross)) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {proj?.nextPayment
          ? `${proj.nextPayment.date} · ~${formatCurrency(roundCents(proj.nextPayment.amount))}`
          : '—'}
      </td>
      <td className="px-4 py-2">
        {proj ? (
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            proj.source === 'actual' ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700')}>
            {proj.source === 'actual' ? 'actual' : 'manual rate'}
          </span>
        ) : (
          <button onClick={onEditRate} className="text-xs text-green-700 hover:underline font-medium">
            set rate
          </button>
        )}
      </td>
      {anyRoc && (
        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
          {s.rocCumulative > 0 ? formatCurrency(roundCents(s.rocCumulative)) : '—'}
        </td>
      )}
      <td className="px-2 py-2 text-right">
        <button onClick={onEditRate} className="p-1 rounded hover:bg-gray-100"
          aria-label="Edit dividend rate" title="Manual rate & frequency (used when there's no payment history)">
          <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
        </button>
      </td>
    </tr>
  );
}

function ReclassifyModal({ row, onClose }: { row: HistRow; onClose: () => void }) {
  const { reclassifyDividend } = useData();
  const [classification, setClassification] = useState<DividendClassification>(
    row.lot.classification ?? 'unclassified',
  );
  const [exDate, setExDate] = useState(row.lot.exDate ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await reclassifyDividend(row.lot.id, classification, exDate || null);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Reclassify ${row.ticker} dividend`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-600">
          {row.lot.date ?? 'Undated'} · {formatCurrency(row.lot.amount)} ·{' '}
          {row.lot.shares > 0 ? 'DRIP' : 'cash'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Classification</label>
            <select value={classification} className={inputCls}
              onChange={(e) => setClassification(e.target.value as DividendClassification)}>
              <option value="unclassified">Unclassified</option>
              <option value="qualified">Qualified</option>
              <option value="ordinary">Ordinary (non-qualified)</option>
              <option value="return_of_capital">Return of capital</option>
              <option value="capital_gain_dist">Capital gain distribution</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Ex-date (optional)</label>
            <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Brokers reclassify distributions on the 1099 after year end — this records the correction
          and flags the row so you know it was revised.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RateModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { updateParked } = useData();
  const [rate, setRate] = useState(p.dividendRate != null ? String(p.dividendRate) : '');
  const [frequency, setFrequency] = useState<DividendFrequency>(p.dividendFrequency ?? 'quarterly');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = rate === '' ? null : Number(rate);
    if (r != null && (Number.isNaN(r) || r < 0)) return setFormError('Rate is annual dollars per share, ≥ 0.');
    setBusy(true);
    try {
      await updateParked(p.id, { dividendRate: r, dividendFrequency: r == null ? null : frequency });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`${p.ticker} dividend rate`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Annual rate ($/share)</label>
            <input type="number" step="any" min="0" value={rate} autoFocus
              onChange={(e) => setRate(e.target.value)} className={inputCls} placeholder="e.g. 2.48" />
          </div>
          <div>
            <label className={labelCls}>Frequency</label>
            <select value={frequency} className={inputCls}
              onChange={(e) => setFrequency(e.target.value as DividendFrequency)}>
              {(Object.keys(FREQUENCY_LABELS) as DividendFrequency[]).map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          A manual estimate for projections until real payments build a history — actuals take over
          automatically once two dated payments exist. Clear the rate to exclude the holding.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

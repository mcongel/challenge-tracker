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
import { CLASSIFICATION_LABELS, classificationPillCls, SortHeader } from '../components/parked/shared';
import type { SortState } from '../components/parked/shared';
import { useData } from '../contexts/DataContext';
import type {
  DividendClassification, DividendFrequency, ParkedLot, ParkedPosition, PileTaxSetAside,
  PositionIncomeSummary,
} from '../lib/engine';
import {
  dividendTaxForYear, dividendTaxYTD, isArchivedPosition, isUnallocatedRoc, pileCapGainsYear,
  positionIncomeSummary, roundCents, taxYearOf, trailingIncomeByMonth,
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
  daily: 'daily',
  weekly: 'weekly',
  semimonthly: 'twice a month',
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'semiannual',
  annual: 'annual',
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
    parked, parkedLots, parkedLotAdjustments, parkedSales, dividendTaxRates, deleteParkedLot,
    allocateRocDividends, reclassifyDividends, ltTaxRate, stTaxRate,
    pileTaxSetAsides, addPileTaxSetAside, deletePileTaxSetAside, loading, error,
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
        summary: positionIncomeSummary(
          p, lotsByPosition.get(p.id) ?? [], today, dividendTaxRates, parkedLotAdjustments,
        ),
      })),
    [parked, lotsByPosition, today, dividendTaxRates, parkedLotAdjustments],
  );

  const trailing = useMemo(() => trailingIncomeByMonth(parkedLots, today), [parkedLots, today]);
  const trailingTotal = trailing.reduce((t, p) => t + p.amount, 0);

  const taxYtd = useMemo(
    () => dividendTaxYTD(parkedLots, today, dividendTaxRates),
    [parkedLots, today, dividendTaxRates],
  );

  // The pile's own tax picture, per year — sales cap gains + dividend income.
  // Estimate only, walled off from the challenge: the 30% quarterly skim
  // never covers the pile, so this number is the owner's to set aside.
  const [pileYear, setPileYear] = useState(taxYearOf(today));
  const pileYearOptions = useMemo(() => {
    const years = new Set<number>([taxYearOf(today)]);
    for (const s of parkedSales) years.add(taxYearOf(s.date));
    for (const l of parkedLots) if (l.source === 'dividend' && l.date) years.add(taxYearOf(l.date));
    return [...years].sort((a, b) => b - a);
  }, [parkedSales, parkedLots, today]);
  const pileCapGains = useMemo(
    () => pileCapGainsYear(parkedSales, pileYear, ltTaxRate, stTaxRate),
    [parkedSales, pileYear, ltTaxRate, stTaxRate],
  );
  const pileDivTax = useMemo(
    () => dividendTaxForYear(parkedLots, pileYear, today, dividendTaxRates),
    [parkedLots, pileYear, today, dividendTaxRates],
  );
  const pileDivAmount = useMemo(
    () => Object.values(pileDivTax.byClassification).reduce((t, e) => t + e.amount, 0),
    [pileDivTax],
  );
  const pileSetAside = roundCents(pileCapGains.estTax + pileDivTax.totalTax);
  // What's actually been moved aside for this year, against that estimate.
  const yearSetAsides = useMemo(
    () => pileTaxSetAsides.filter((s) => s.taxYear === pileYear),
    [pileTaxSetAsides, pileYear],
  );
  const recordedSetAside = roundCents(yearSetAsides.reduce((t, s) => t + s.amount, 0));
  const setAsideRemaining = roundCents(pileSetAside - recordedSetAside);
  const [setAsideOpen, setSetAsideOpen] = useState(false);

  // Portfolio yield on cost: only positions that project income AND have a
  // real cost basis count — in both the numerator and the denominator — so a
  // basis-less holding (pending ACATS with a manual rate) can't inflate it.
  const { projectedGross, projectedAfterTax, portfolioYoc, anyProjection } = useMemo(() => {
    const gross = summaries.reduce((t, s) => t + (s.summary.projection?.annualGross ?? 0), 0);
    const afterTax = summaries.reduce((t, s) => t + (s.summary.projection?.annualAfterTax ?? 0), 0);
    const withBasis = summaries.filter((s) => s.summary.projection && s.summary.costBasis > 0);
    const basis = withBasis.reduce((t, s) => t + s.summary.costBasis, 0);
    return {
      projectedGross: gross,
      projectedAfterTax: afterTax,
      portfolioYoc: basis > 0
        ? withBasis.reduce((t, s) => t + (s.summary.projection?.annualGross ?? 0), 0) / basis
        : null,
      anyProjection: summaries.some((s) => s.summary.projection),
    };
  }, [summaries]);

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
  const anyIncome = anyDividends || anyProjection;

  // Live holdings always; archived (zero-share) rows only when they actually
  // have dividend history worth remembering.
  const sortedSummaries = useMemo(
    () =>
      summaries
        .filter(
          (s) => !isArchivedPosition(s.position) || s.lots.some((l) => l.source === 'dividend'),
        )
        .sort(
          (a, b) =>
            (b.summary.projection?.annualGross ?? 0) - (a.summary.projection?.annualGross ?? 0),
        ),
    [summaries],
  );

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

  // Date order matters: each event caps against basis the earlier ones
  // already reduced. Null dates sort OLDEST, matching the FIFO convention.
  const unallocatedRoc = useMemo(
    () =>
      histRows
        .filter((r) => isUnallocatedRoc(r.lot))
        .sort((a, b) => (a.lot.date ?? '').localeCompare(b.lot.date ?? '')),
    [histRows],
  );
  const [allocatingAll, setAllocatingAll] = useState(false);
  const [allocError, setAllocError] = useState<string | null>(null);
  const allocateAll = async () => {
    setAllocatingAll(true);
    setAllocError(null);
    try {
      await allocateRocDividends(unallocatedRoc.map((r) => r.lot.id));
    } catch (err) {
      setAllocError(err instanceof Error ? err.message : String(err));
    } finally {
      setAllocatingAll(false);
    }
  };

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

  // Year/ticker filters — persisted like the sort, because 1099 season means
  // coming back to the same year's view repeatedly.
  const [histFilters, setHistFiltersState] = useState<{ year: string; ticker: string }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('incomeHistFilters') ?? 'null');
      if (stored && typeof stored.year === 'string' && typeof stored.ticker === 'string') return stored;
    } catch { /* fall through to default */ }
    return { year: '', ticker: '' };
  });
  const setHistFilters = (f: { year: string; ticker: string }) => {
    setHistFiltersState(f);
    localStorage.setItem('incomeHistFilters', JSON.stringify(f));
  };
  const histYears = useMemo(
    () => [...new Set(histRows.map((r) => r.lot.date?.slice(0, 4)).filter(Boolean) as string[])]
      .sort().reverse(),
    [histRows],
  );
  const histTickers = useMemo(
    () => [...new Set(histRows.map((r) => r.ticker))].sort(),
    [histRows],
  );
  // Persisted values may reference a year/ticker that no longer exists
  // (data cleared, dividends deleted) — treat those as "all" so a stale
  // filter can't invisibly hide every row behind a blank-looking select.
  const yearFilter = histYears.includes(histFilters.year) ? histFilters.year : '';
  const tickerFilter = histTickers.includes(histFilters.ticker) ? histFilters.ticker : '';
  const filteredHist = useMemo(
    () => sortedHist.filter(
      (r) =>
        (!yearFilter || (r.lot.date ?? '').startsWith(yearFilter)) &&
        (!tickerFilter || r.ticker === tickerFilter),
    ),
    [sortedHist, yearFilter, tickerFilter],
  );
  // Per-classification subtotals for a filtered year — the 1099-DIV boxes.
  const classTotals = useMemo(() => {
    if (!yearFilter) return null;
    const m = new Map<DividendClassification, number>();
    for (const r of filteredHist) {
      const c = r.lot.classification ?? 'unclassified';
      m.set(c, (m.get(c) ?? 0) + r.lot.amount);
    }
    return m;
  }, [filteredHist, yearFilter]);

  const [bulkClass, setBulkClass] = useState<DividendClassification | ''>('');
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const filtersActive = Boolean(yearFilter || tickerFilter);

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
                {formatCurrency(roundCents(projectedAfterTax))} after est. tax
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
              <p className="text-xs font-medium text-gray-500">Est. dividend tax YTD</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums">{formatCurrency(roundCents(taxYtd.totalTax))}</p>
              {taxYtd.unclassifiedAmount > 0 ? (
                <p className="text-xs text-amber-700 mt-0.5">
                  {formatCurrency(roundCents(taxYtd.unclassifiedAmount))} unclassified
                </p>
              ) : taxYtd.rocUnallocatedAmount > 0 ? (
                <p className="text-xs text-amber-700 mt-0.5">
                  {formatCurrency(roundCents(taxYtd.rocUnallocatedAmount))} ROC unallocated
                </p>
              ) : taxYtd.rocOverflowAmount > 0 ? (
                <p className="text-xs text-gray-400 mt-0.5">
                  incl. ROC beyond basis: {formatCurrency(roundCents(taxYtd.rocOverflowAmount))}
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

          {/* The pile's yearly tax bill, sales + dividends in one place.
              Deliberately NOT the Tax Reserve screen — that's the challenge's
              non-negotiable 30% skim; this is context the owner acts on. */}
          <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 density-aware-card mb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Pile taxes — set aside yourself, the skim never covers these
              </p>
              <select value={pileYear} onChange={(e) => setPileYear(Number(e.target.value))}
                className={cn(inputCls, 'w-auto py-1 text-xs')} aria-label="Pile tax year">
                {pileYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500">Realized sales</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">
                  {pileCapGains.saleCount > 0 ? (
                    <span className={pileCapGains.ltGain + pileCapGains.stGain >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {pileCapGains.ltGain + pileCapGains.stGain >= 0 ? '+' : '−'}
                      {formatCurrency(Math.abs(roundCents(pileCapGains.ltGain + pileCapGains.stGain)))}
                    </span>
                  ) : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                  {pileCapGains.saleCount > 0
                    ? `LT ${formatCurrency(pileCapGains.ltGain)} · ST ${formatCurrency(pileCapGains.stGain)} · est. tax ${formatCurrency(pileCapGains.estTax)}`
                    : 'no sales with basis this year'}
                  {pileCapGains.unknownBasisCount > 0 &&
                    ` · ${pileCapGains.unknownBasisCount} unknown-basis excluded`}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Dividends</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums">
                  {pileDivAmount > 0 ? formatCurrency(roundCents(pileDivAmount)) : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                  {pileDivAmount > 0 ? `est. tax ${formatCurrency(roundCents(pileDivTax.totalTax))}` : 'none this year'}
                  {pileDivTax.unclassifiedAmount > 0 && (
                    <span className="text-amber-700"> · {formatCurrency(roundCents(pileDivTax.unclassifiedAmount))} unclassified</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Set aside for {pileYear}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
                  {formatCurrency(pileSetAside)}
                  {recordedSetAside > 0 && (
                    <span className={cn('ml-2 text-sm font-medium',
                      setAsideRemaining <= 0.005 ? 'text-green-600' : 'text-amber-700')}>
                      {setAsideRemaining <= 0.005
                        ? `✓ ${formatCurrency(recordedSetAside)} parked`
                        : `${formatCurrency(recordedSetAside)} parked · ${formatCurrency(setAsideRemaining)} short`}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  at ~{formatPercent(ltTaxRate, 0)} LT / ~{formatPercent(stTaxRate, 0)} ST — edit on Tax Reserve
                  {' · '}
                  <button type="button" onClick={() => setSetAsideOpen(true)}
                    className="font-medium text-indigo-600 hover:text-indigo-800">
                    record set-aside
                  </button>
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Estimate only. LT/ST split follows each sale's recorded long-term shares (undated
              lots assume LT); a net loss owes nothing here — wash-sale disallowances and loss
              carryover aren't modeled. Entirely separate from the challenge account's 30% reserve.
            </p>
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
                    <th className="px-4 py-2 text-right" title="Cumulative return of capital — applied against lot cost basis, so sales realize a bigger gain.">ROC</th>
                  )}
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedSummaries.map(({ position: p, summary: s }) => (
                  <HoldingRow key={p.id} position={p} summary={s} anyRoc={anyRoc}
                    onEditRate={() => setEditingRate(p)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
            <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Distribution history
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={yearFilter}
                  onChange={(e) => setHistFilters({ year: e.target.value, ticker: tickerFilter })}
                  className={cn(inputCls, 'w-auto py-1 text-xs')}
                  aria-label="Filter by year"
                >
                  <option value="">All years</option>
                  {histYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select
                  value={tickerFilter}
                  onChange={(e) => setHistFilters({ year: yearFilter, ticker: e.target.value })}
                  className={cn(inputCls, 'w-auto py-1 text-xs')}
                  aria-label="Filter by ticker"
                >
                  <option value="">All tickers</option>
                  {histTickers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {unallocatedRoc.length > 0 && (
                  <button
                    onClick={allocateAll}
                    disabled={allocatingAll}
                    className={cn(secondaryBtnCls, 'text-xs px-2.5 py-1')}
                    title="Apply basis reductions for every ROC distribution that predates basis tracking, oldest first."
                  >
                    {allocatingAll ? 'Allocating…' : `Allocate ${unallocatedRoc.length} ROC to basis`}
                  </button>
                )}
              </div>
            </div>
            {filtersActive && filteredHist.length > 0 && (
              <div className="px-4 pt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{filteredHist.length} filtered:</span>
                <select
                  value={bulkClass}
                  onChange={(e) => setBulkClass(e.target.value as DividendClassification | '')}
                  className={cn(inputCls, 'w-auto py-1 text-xs')}
                  aria-label="Bulk classification"
                >
                  <option value="">reclassify to…</option>
                  {(Object.keys(CLASSIFICATION_LABELS) as DividendClassification[]).map((c) => (
                    <option key={c} value={c}>{CLASSIFICATION_LABELS[c]}</option>
                  ))}
                </select>
                <button
                  onClick={() => setBulkConfirm(true)}
                  disabled={!bulkClass}
                  className={cn(secondaryBtnCls, 'text-xs px-2.5 py-1 disabled:opacity-50')}
                >
                  Apply to all {filteredHist.length}
                </button>
              </div>
            )}
            {allocError && (
              <p className="mx-4 mt-2 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{allocError}</p>
            )}
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
                {filteredHist.map((r) => (
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
                      {isUnallocatedRoc(r.lot) && (
                        <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
                          title="This ROC hasn't been applied to lot basis yet — use the allocate button above.">
                          unallocated
                        </span>
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
                {filteredHist.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-sm text-gray-400 text-center">
                      {sortedHist.length === 0 ? 'No dividends recorded yet' : 'No dividends match the filters'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {classTotals && filteredHist.length > 0 && (
              <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100 tabular-nums">
                {yearFilter}{tickerFilter ? ` · ${tickerFilter}` : ''} by class
                (the 1099-DIV boxes):{' '}
                {(['qualified', 'ordinary', 'return_of_capital', 'capital_gain_dist', 'unclassified'] as DividendClassification[])
                  .filter((c) => (classTotals.get(c) ?? 0) > 0)
                  .map((c) => `${CLASSIFICATION_LABELS[c]} ${formatCurrency(roundCents(classTotals.get(c) ?? 0))}`)
                  .join(' · ')}
                {' '}· Total {formatCurrency(roundCents(filteredHist.reduce((t, r) => t + r.lot.amount, 0)))}
              </p>
            )}
          </div>
        </>
      )}

      {reclassifying && (
        <ReclassifyModal row={reclassifying} onClose={() => setReclassifying(null)} />
      )}
      {bulkConfirm && bulkClass && (
        <ConfirmModal
          title={`Reclassify ${filteredHist.length} dividends`}
          message={`Set all ${filteredHist.length} filtered dividends${yearFilter ? ` from ${yearFilter}` : ''}${tickerFilter ? ` (${tickerFilter})` : ''} to "${CLASSIFICATION_LABELS[bulkClass]}"? Rows already confirmed as another class get the reclassified flag; moves into or out of Return of capital re-run basis allocation per dividend, oldest first.`}
          confirmLabel="Reclassify"
          onConfirm={async () => {
            await reclassifyDividends(filteredHist.map((r) => r.lot.id), bulkClass);
            setBulkClass('');
          }}
          onClose={() => setBulkConfirm(false)}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete dividend"
          message={`Delete this ${deleting.ticker} dividend (${formatCurrency(deleting.lot.amount)}${deleting.lot.shares > 0 ? `, ${deleting.lot.shares} DRIP sh` : ''})? ${deleting.lot.shares > 0 ? "The position's shares and cost recompute without it." : ''} Any basis reductions from this distribution are reversed.`}
          onConfirm={() => deleteParkedLot(deleting.lot.id)}
          onClose={() => setDeleting(null)}
        />
      )}
      {editingRate && (
        <RateModal position={editingRate} onClose={() => setEditingRate(null)} />
      )}
      {setAsideOpen && (
        <SetAsideModal
          taxYear={pileYear}
          target={pileSetAside}
          remaining={setAsideRemaining}
          rows={yearSetAsides}
          onAdd={addPileTaxSetAside}
          onDelete={deletePileTaxSetAside}
          onClose={() => setSetAsideOpen(false)}
        />
      )}
    </div>
  );
}

/** Recording the ACTION the estimate asks for: real dollars moved somewhere
 * safe for the pile's tax bill. Notes say where. Never the challenge's
 * reserve — that money has its own screen and its own rules. */
function SetAsideModal({
  taxYear, target, remaining, rows, onAdd, onDelete, onClose,
}: {
  taxYear: number;
  target: number;
  remaining: number;
  rows: PileTaxSetAside[];
  onAdd: (s: Omit<PileTaxSetAside, 'id'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '');
  const [notes, setNotes] = useState('');
  const [deleting, setDeleting] = useState<PileTaxSetAside | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) return setFormError('Enter the dollars you moved aside.');
    setBusy(true);
    try {
      await onAdd({ taxYear, date, amount: roundCents(amt), notes: notes || null });
      setAmount(''); setNotes('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Pile tax set-asides — ${taxYear}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 tabular-nums">
          Estimated bill <span className="font-medium">{formatCurrency(target)}</span>
          {remaining > 0.005
            ? <> · still to park <span className="font-medium text-amber-700">{formatCurrency(remaining)}</span></>
            : rows.length > 0 && <> · <span className="font-medium text-green-600">covered ✓</span></>}
        </p>

        {rows.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 tabular-nums text-gray-500 w-24">{s.date}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-green-600">
                      {formatCurrency(s.amount)}
                    </td>
                    <td className="px-3 py-1.5 text-gray-400 text-xs max-w-[12rem] truncate">{s.notes}</td>
                    <td className="px-1 py-1.5 w-8">
                      <button onClick={() => setDeleting(s)} className="p-1 rounded hover:bg-red-50" aria-label="Delete set-aside">
                        <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={submit} className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">Record a set-aside</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="number" step="0.01" min="0.01" required value={amount} placeholder="$"
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-2">
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="where it's parked (e.g. Key Bank savings)" className={inputCls} />
            <button type="submit" disabled={busy} className={secondaryBtnCls}>Add</button>
          </div>
        </form>
        <p className="text-xs text-gray-400">
          A record of money you actually moved — nothing transfers automatically, and this never
          touches the challenge account's reserve.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete set-aside record"
          message={`Delete the ${deleting.date} set-aside (${formatCurrency(deleting.amount)})? Only the record goes — move the real money back yourself if it shouldn't be parked.`}
          onConfirm={() => onDelete(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Modal>
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
  const archived = isArchivedPosition(p);
  return (
    <tr className={cn('hover:bg-gray-50', archived && 'text-gray-400')}>
      <td className="px-4 py-2 font-medium text-gray-900">
        {p.ticker}
        <span className="ml-1 text-xs text-gray-400">{p.account}</span>
        {archived && (
          <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500"
            title="Fully trimmed or transferred away — history kept, nothing projected.">
            closed
          </span>
        )}
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
          ? `${proj.nextPayment.date} · est. ${formatCurrency(roundCents(proj.nextPayment.amount))}`
          : '—'}
      </td>
      <td className="px-4 py-2">
        {proj ? (
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            proj.source === 'actual' ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700')}>
            {proj.source === 'actual' ? 'actual' : 'manual rate'}
          </span>
        ) : archived ? (
          <span className="text-xs text-gray-400">—</span>
        ) : (
          <button onClick={onEditRate} className="text-xs text-green-700 hover:underline font-medium">
            set rate
          </button>
        )}
      </td>
      {anyRoc && (
        <td className="px-4 py-2 text-right tabular-nums text-gray-600"
          title={s.rocCumulative > 0 && s.adjustedCostBasis < s.costBasis
            ? `Adjusted basis ${formatCurrency(roundCents(s.adjustedCostBasis))} (original ${formatCurrency(roundCents(s.costBasis))})`
            : undefined}>
          {s.rocCumulative > 0 ? formatCurrency(roundCents(s.rocCumulative)) : '—'}
        </td>
      )}
      <td className="px-2 py-2 text-right">
        {!archived && (
          <button onClick={onEditRate} className="p-1 rounded hover:bg-gray-100"
            aria-label="Edit dividend rate" title="Manual rate & frequency (used when there's no payment history)">
            <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
          </button>
        )}
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
  const [growth, setGrowth] = useState(
    p.dividendGrowthPct != null ? String(Math.round(p.dividendGrowthPct * 10000) / 100) : '',
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = rate === '' ? null : Number(rate);
    if (r != null && (Number.isNaN(r) || r < 0)) return setFormError('Rate is annual dollars per share, ≥ 0.');
    const g = growth === '' ? null : Number(growth) / 100;
    if (g != null && (Number.isNaN(g) || g <= -1 || g >= 1)) {
      return setFormError('Growth is an annual percentage between -99 and 99.');
    }
    setBusy(true);
    try {
      await updateParked(p.id, {
        dividendRate: r,
        dividendFrequency: r == null ? null : frequency,
        // Clearing the rate retires its projection companions too — a stale
        // growth assumption must not keep compounding actual-history income.
        dividendGrowthPct: r == null ? null : g,
      });
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
        <div className="grid grid-cols-3 gap-3">
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
          <div>
            <label className={labelCls}>Div growth (%/yr)</label>
            <input type="number" step="any" value={growth}
              onChange={(e) => setGrowth(e.target.value)} className={inputCls}
              placeholder="for projections" title="Assumed annual dividend growth — used by the Transition modeler." />
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

import { useMemo, useState } from 'react';
import { HandCoins, History, Pencil, Trash2 } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card, TableCard, theadCls } from '../components/ui/Card';
import { RowCard, RowCardStat } from '../components/ui/RowCard';
import { StatTile } from '../components/ui/StatTile';
import { CLASSIFICATION_LABELS, classificationPillCls, SortHeader } from '../components/parked/shared';
import type { SortState } from '../components/parked/shared';
import { HoldingRow } from '../components/income/HoldingRow';
import { RateModal } from '../components/income/RateModal';
import { ReclassifyModal } from '../components/income/ReclassifyModal';
import { DividendCalendar } from '../components/income/DividendCalendar';
import { CoveragePanel } from '../components/income/CoveragePanel';
import { MonthlyCoverageChart } from '../components/income/MonthlyCoverageChart';
import { IncomeUseToggle } from '../components/income/IncomeUseToggle';
import { DividendInsightChips } from '../components/income/DividendInsightChips';
import { useDividendInsights } from '../lib/useDividendInsights';
import type { HistRow } from '../components/income/shared';
import { useData } from '../contexts/DataContext';
import { lotsByPositionId } from '../lib/engine';
import { Link } from 'react-router-dom';
import type {
  DividendClassification, ParkedPosition,
} from '../lib/engine';
import {
  dividendInsight, dividendTaxYTD, incomeUseOf, isArchivedPosition, isUnallocatedRoc,
  positionIncomeSummary, roundCents,
  trailingIncomeByMonth,
} from '../lib/engine';
import {
  cn, compactUsd, formatCurrency, formatPercent, inputCls, money,
  safeStorage, secondaryBtnCls, todayISO,
} from '../lib/utils';
import { useChartColors } from '../lib/useIsDark';

/** Same CVD-validated pair as the Dashboard chart: actuals in brand green,
 * projections in indigo. No new hues. */
const SERIES = {
  actual: { light: '#16a34a', dark: '#16a34a' },
  projected: { light: '#4f46e5', dark: '#6366f1' },
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;

type HistSortKey = 'date' | 'ticker' | 'amount' | 'classification';
const HIST_NATURAL_DIR: Record<HistSortKey, 'asc' | 'desc'> = {
  date: 'desc', // history reads newest-first
  ticker: 'asc',
  amount: 'desc',
  classification: 'asc',
};
const HIST_KEYS = Object.keys(HIST_NATURAL_DIR) as HistSortKey[];

export function Income() {
  const {
    // Taxable positions only — a Roth's dividends are nobody's 1099. The
    // bitcoin bucket stays IN: BTCI's payouts are as taxable as any other.
    taxableParked: parked, parkedLots: allLots, parkedLotAdjustments, dividendTaxRates,
    expenses, deleteParkedLot, allocateRocDividends, reclassifyDividends, loading, error,
  } = useData();
  const today = todayISO();
  // Lots scoped to pile positions — retirement lots stay on their page.
  const parkedLots = useMemo(() => {
    const pileIds = new Set(parked.map((p) => p.id));
    return allLots.filter((l) => pileIds.has(l.parkedPositionId));
  }, [allLots, parked]);

  const lotsByPosition = useMemo(() => lotsByPositionId(parkedLots), [parkedLots]);

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

  // Dividend growth + payout coverage (item 3), keyed by ticker. Best-effort:
  // empty until /api/fundamentals answers, absent entirely without an FMP key.
  const dividendPayers = useMemo(
    () => [...new Set(summaries
      .filter((s) => !isArchivedPosition(s.position) && s.summary.projection)
      .map((s) => s.position.ticker))],
    [summaries],
  );
  const fundamentals = useDividendInsights(dividendPayers);
  const insights = useMemo(() => {
    const m: Record<string, ReturnType<typeof dividendInsight>> = {};
    for (const t of Object.keys(fundamentals)) m[t] = dividendInsight(fundamentals[t], today);
    return m;
  }, [fundamentals, today]);

  // Coverage split: spendable (income_use = 'spend') vs reinvesting income,
  // after tax, per month. Only spendable income covers living expenses.
  const coverage = useMemo(() => {
    let spendableAnnual = 0;
    let reinvestAnnual = 0;
    let spendableBasis = 0;
    for (const s of summaries) {
      if (isArchivedPosition(s.position) || !s.summary.projection) continue;
      const use = incomeUseOf(s.position, s.lots);
      const afterTax = s.summary.projection.annualAfterTax;
      if (use === 'spend') {
        spendableAnnual += afterTax;
        spendableBasis += s.summary.costBasis;
      } else {
        reinvestAnnual += afterTax;
      }
    }
    // Spendable AFTER-TAX income landing in each projected month (for the
    // month-accurate coverage chart). Uses the after-tax fraction implied by
    // each holding's annual gross vs after-tax.
    const spendableByMonth = new Map<string, number>();
    for (const s of summaries) {
      if (isArchivedPosition(s.position) || !s.summary.projection) continue;
      if (incomeUseOf(s.position, s.lots) !== 'spend') continue;
      const proj = s.summary.projection;
      const atf = proj.annualGross > 0 ? proj.annualAfterTax / proj.annualGross : 1;
      for (const pt of proj.monthly) {
        if (pt.amount <= 0) continue;
        spendableByMonth.set(pt.month, (spendableByMonth.get(pt.month) ?? 0) + pt.amount * atf);
      }
    }
    return {
      spendableMonthly: spendableAnnual / 12,
      reinvestingMonthly: reinvestAnnual / 12,
      afterTaxYieldOnCost: spendableBasis > 0 ? spendableAnnual / spendableBasis : null,
      spendableByMonth,
    };
  }, [summaries]);

  const trailing = useMemo(() => trailingIncomeByMonth(parkedLots, today), [parkedLots, today]);
  const trailingTotal = trailing.reduce((t, p) => t + p.amount, 0);

  const taxYtd = useMemo(
    () => dividendTaxYTD(parkedLots, today, dividendTaxRates),
    [parkedLots, today, dividendTaxRates],
  );

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
  const { isDark, gridColor, axisColor } = useChartColors();
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
      const stored = JSON.parse(safeStorage.get('incomeHistSort') ?? 'null');
      if (stored && HIST_KEYS.includes(stored.key) && (stored.dir === 'asc' || stored.dir === 'desc')) return stored;
    } catch { /* fall through to default */ }
    return { key: 'date', dir: 'desc' };
  });
  const setHistSort = (s: SortState<HistSortKey>) => {
    setHistSortState(s);
    safeStorage.set('incomeHistSort', JSON.stringify(s));
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
      const stored = JSON.parse(safeStorage.get('incomeHistFilters') ?? 'null');
      if (stored && typeof stored.year === 'string' && typeof stored.ticker === 'string') return stored;
    } catch { /* fall through to default */ }
    return { year: '', ticker: '' };
  });
  const setHistFilters = (f: { year: string; ticker: string }) => {
    setHistFiltersState(f);
    safeStorage.set('incomeHistFilters', JSON.stringify(f));
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
            <StatTile label="Trailing 12 months" value={money(trailingTotal)}
              sub="dividends received" />
            <StatTile label="Next 12 months" value={money(projectedGross)}
              sub={<>{money(projectedAfterTax)} after est. tax</>} />
            <StatTile label="Est. dividend tax YTD" value={money(taxYtd.totalTax)}
              sub={
                taxYtd.unclassifiedAmount > 0 ? (
                  <span className="text-amber-700">
                    {money(taxYtd.unclassifiedAmount)} unclassified
                  </span>
                ) : taxYtd.rocUnallocatedAmount > 0 ? (
                  <span className="text-amber-700">
                    {money(taxYtd.rocUnallocatedAmount)} ROC unallocated
                  </span>
                ) : taxYtd.rocOverflowAmount > 0 ? (
                  <>incl. ROC beyond basis: {money(taxYtd.rocOverflowAmount)}</>
                ) : (
                  <Link to="/pile-taxes" className="hover:text-green-700 hover:underline">
                    full year picture on Pile Taxes →
                  </Link>
                )
              } />
            <StatTile label="Yield on cost"
              value={portfolioYoc != null ? formatPercent(portfolioYoc) : '—'}
              sub="projecting holdings only" />
          </div>

          <Card className="p-4 sm:p-6 density-aware-card mb-4">
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
          </Card>

          <CoveragePanel
            spendableMonthly={coverage.spendableMonthly}
            reinvestingMonthly={coverage.reinvestingMonthly}
            afterTaxYieldOnCost={coverage.afterTaxYieldOnCost}
          />

          <MonthlyCoverageChart incomeByMonth={coverage.spendableByMonth} expenses={expenses} />

          <DividendCalendar entries={sortedSummaries.map(({ position, summary }) => ({ position, summary }))} />

          <TableCard
            className="mb-4"
            toolbar={
              <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Holdings
              </p>
            }
            cards={sortedSummaries.map(({ position: p, summary: s }) => {
              const proj = s.projection;
              const archived = isArchivedPosition(p);
              return (
                <RowCard
                  key={p.id}
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={archived ? 'text-gray-400' : undefined}>{p.ticker}</span>
                      <span className="text-xs font-normal text-gray-400">{p.account}</span>
                      {archived && (
                        <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500"
                          title="Fully trimmed or transferred away — history kept, nothing projected.">
                          closed
                        </span>
                      )}
                      {s.hasUnclassified && (
                        <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
                          title="Some dividends are unclassified — estimates assume the qualified rate.">
                          unclassified
                        </span>
                      )}
                      {!archived && <DividendInsightChips insight={insights[p.ticker]} />}
                      {!archived && proj && <IncomeUseToggle position={p} lots={lotsByPosition.get(p.id) ?? []} />}
                    </span>
                  }
                  value={proj ? money(proj.annualGross) : '—'}
                  actions={!archived && (
                    <button onClick={() => setEditingRate(p)} className="p-2 rounded hover:bg-gray-100"
                      aria-label="Edit dividend rate" title="Manual rate & frequency (used when there's no payment history)">
                      <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                    </button>
                  )}
                >
                  <RowCardStat label="Yield on cost">
                    {s.yieldOnCost != null ? formatPercent(s.yieldOnCost) : '—'}
                  </RowCardStat>
                  <RowCardStat label="T12M">
                    {s.trailing12m > 0 ? money(s.trailing12m) : '—'}
                  </RowCardStat>
                  <RowCardStat label="Next payment">
                    {proj?.nextPayment
                      ? `${proj.nextPayment.date} · est. ${money(proj.nextPayment.amount)}`
                      : '—'}
                  </RowCardStat>
                  <RowCardStat label="Source">
                    {proj ? (
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                        proj.source === 'actual' ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700')}>
                        {proj.source === 'actual' ? 'actual' : 'manual rate'}
                      </span>
                    ) : archived ? '—' : (
                      <button onClick={() => setEditingRate(p)} className="text-xs text-green-700 hover:underline font-medium">
                        set rate
                      </button>
                    )}
                  </RowCardStat>
                  {anyRoc && s.rocCumulative > 0 && (
                    <RowCardStat label="ROC">
                      <span title={s.adjustedCostBasis < s.costBasis
                        ? `Adjusted basis ${money(s.adjustedCostBasis)} (original ${money(s.costBasis)})`
                        : undefined}>
                        {money(s.rocCumulative)}
                      </span>
                    </RowCardStat>
                  )}
                </RowCard>
              );
            })}
          >
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50">
                <tr className={theadCls}>
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
                    insight={insights[p.ticker]} lots={lotsByPosition.get(p.id) ?? []}
                    onEditRate={() => setEditingRate(p)} />
                ))}
              </tbody>
            </table>
          </TableCard>

          {/* Only the table scrolls sideways — the filter/reclassify bars above stay put. */}
          <TableCard
            toolbar={
              <>
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
              </>
            }
            footer={classTotals && filteredHist.length > 0 && (
              <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100 tabular-nums">
                {yearFilter}{tickerFilter ? ` · ${tickerFilter}` : ''} by class
                (the 1099-DIV boxes):{' '}
                {(['qualified', 'ordinary', 'return_of_capital', 'capital_gain_dist', 'unclassified'] as DividendClassification[])
                  .filter((c) => (classTotals.get(c) ?? 0) > 0)
                  .map((c) => `${CLASSIFICATION_LABELS[c]} ${money(classTotals.get(c) ?? 0)}`)
                  .join(' · ')}
                {' '}· Total {money(filteredHist.reduce((t, r) => t + r.lot.amount, 0))}
              </p>
            )}
            cards={filteredHist.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">
                {sortedHist.length === 0 ? 'No dividends recorded yet' : 'No dividends match the filters'}
              </p>
            ) : filteredHist.map((r) => (
              <RowCard
                key={r.lot.id}
                title={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('tabular-nums', r.lot.date ? 'text-gray-600' : 'text-amber-800')}
                      title={r.lot.exDate ? `Ex-date ${r.lot.exDate}` : undefined}>
                      {r.lot.date ?? 'no date'}
                    </span>
                    <span>{r.ticker}</span>
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      classificationPillCls(r.lot.classification ?? 'unclassified'))}>
                      {CLASSIFICATION_LABELS[r.lot.classification ?? 'unclassified']}
                    </span>
                    {r.lot.reclassifiedAt && (
                      <History className="inline h-3.5 w-3.5 text-gray-400" aria-label="Reclassified" />
                    )}
                    {isUnallocatedRoc(r.lot) && (
                      <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
                        title="This ROC hasn't been applied to lot basis yet — use the allocate button above.">
                        unallocated
                      </span>
                    )}
                  </span>
                }
                value={formatCurrency(r.lot.amount)}
                actions={
                  <>
                    <button onClick={() => setReclassifying(r)} className="p-2 rounded hover:bg-gray-100"
                      aria-label="Reclassify" title="Change classification (1099 correction)">
                      <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                    </button>
                    <button onClick={() => setDeleting(r)} className="p-2 rounded hover:bg-red-50"
                      aria-label="Delete dividend">
                      <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                    </button>
                  </>
                }
              >
                <p className="mt-1 text-xs text-gray-500">
                  {r.lot.shares > 0 ? 'DRIP' : 'cash'}
                  {r.account && ` · ${r.account}`}
                </p>
              </RowCard>
            ))}
          >
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50 group/head">
                <tr className="text-left text-xs">
                  <SortHeader<HistSortKey> label="Date" sortKey="date" sort={histSort} onSort={toggleHistSort} />
                  <SortHeader<HistSortKey> label="Ticker" sortKey="ticker" sort={histSort} onSort={toggleHistSort} />
                  <SortHeader<HistSortKey> label="Amount" sortKey="amount" sort={histSort} onSort={toggleHistSort} align="right" />
                  <SortHeader<HistSortKey> label="Class" sortKey="classification" sort={histSort} onSort={toggleHistSort} />
                  <th className={cn('px-4 py-3', theadCls)}>Type</th>
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
                        <button onClick={() => setReclassifying(r)} className="p-2 sm:p-1 rounded hover:bg-gray-100"
                          aria-label="Reclassify" title="Change classification (1099 correction)">
                          <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setDeleting(r)} className="p-2 sm:p-1 rounded hover:bg-red-50"
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
          </TableCard>
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
    </div>
  );
}

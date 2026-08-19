import { Fragment, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive, ArrowLeftRight, ChevronDown, ChevronRight, Divide, Pencil, Plus,
  Scissors, Settings2,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card, TableCard } from '../components/ui/Card';
import { StatTile, toneOf } from '../components/ui/StatTile';
import { SplitModal } from '../components/SplitModal';
import { useData } from '../contexts/DataContext';
import { lotsByPositionId } from '../lib/engine';
import type { ParkedPosition } from '../lib/engine';
import {
  adjustmentsForLots, concentration, contributionStatus, daysBetween, dividendsCollected,
  estimatedPileTax, isArchivedPosition, isNeverTrimFuel, netContributed, parkedCostBasis,
  parkedMarketValue, positionTotalReturn, SEMI_CATEGORY, trimPreview, unlockSummary,
} from '../lib/engine';
import type { PositionTotalReturn } from '../lib/engine';
import {
  cn, formatCurrency, formatPercent, money, primaryBtnCls, safeStorage, secondaryBtnCls,
  signedMoney, todayISO,
} from '../lib/utils';
import { categoryPillCls, fmtSh, SortHeader } from '../components/parked/shared';
import type { SortState } from '../components/parked/shared';
import { DayChangeCell, UnlockCell, UnrealCell } from '../components/parked/PileCells';
import { CapModal } from '../components/parked/CapModal';
import { PileValueChart } from '../components/parked/PileValueChart';
import { ValueChart } from '../components/ValueChart';
import { useValueHistory } from '../lib/useValueHistory';
import { AddHoldingModal } from '../components/parked/AddHoldingModal';
import { EditParkedModal } from '../components/parked/EditParkedModal';
import { LotPanel } from '../components/parked/LotPanel';
import { TransferModal } from '../components/parked/TransferModal';
import { TrimModal } from '../components/parked/TrimModal';

type GroupBy = 'account' | 'ticker' | 'flat';
type SortKey =
  | 'default' | 'label' | 'shares' | 'avgCost' | 'price' | 'dayChange' | 'value' | 'unreal'
  | 'totalReturn' | 'unlock';
/** First click on a header sorts the way you'd want: money and size biggest
 * first, names A–Z, unlocks soonest first. */
const NATURAL_DIR: Record<SortKey, 'asc' | 'desc'> = {
  default: 'desc',
  label: 'asc',
  shares: 'desc',
  avgCost: 'desc',
  price: 'desc',
  dayChange: 'desc',
  value: 'desc',
  unreal: 'desc',
  totalReturn: 'desc',
  unlock: 'asc',
};
const SORT_KEYS = Object.keys(NATURAL_DIR) as SortKey[];

export function ParkedPile() {
  const {
    // Pile positions only — retirement reuses the machinery on its own page.
    pileParked: allParked, btcParked, retirementAccountIds, parkedLots, parkedLotAdjustments,
    parkedSales, snapshots, accounts,
    tickerNames, concentrationCap, updateSetting, accountCash, dayChange, cashEvents,
    contributionCap, ltTaxRate, stTaxRate, overrides, overrideSetAt, loading, error,
  } = useData();
  // Archived (zero-share) rows keep dividend history alive on the Income
  // screen; this table shows live holdings only.
  const parked = useMemo(() => allParked.filter((p) => !isArchivedPosition(p)), [allParked]);
  const [capOpen, setCapOpen] = useState(false);
  const [splitTicker, setSplitTicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<ParkedPosition | null>(null);
  const [trimming, setTrimming] = useState<ParkedPosition | null>(null);
  /** Trim-fuel shortcut: prefill the Sell form with the unlocked shares. */
  const [trimPresetShares, setTrimPresetShares] = useState<number | null>(null);
  // Accordion — the summary lives in the header, so collapsed still informs.
  const [fuelOpen, setFuelOpenState] = useState(() => safeStorage.get('pileFuelOpen') === '1');
  const setFuelOpen = (v: boolean) => {
    setFuelOpenState(v);
    safeStorage.set('pileFuelOpen', v ? '1' : '0');
  };
  const [transferring, setTransferring] = useState<ParkedPosition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const lotsByPosition = useMemo(() => lotsByPositionId(parkedLots), [parkedLots]);
  const divTotal = dividendsCollected(parkedLots);

  // Total return per position (price + income + realized, ROC counted once)
  // — the ranking answer to "which of these actually worked?" Includes
  // archived positions so the pile-wide figure keeps closed winners/losers.
  const totalReturnByPosition = useMemo(() => {
    const m = new Map<string, PositionTotalReturn>();
    for (const p of allParked) {
      const lots = parkedLots.filter((l) => l.parkedPositionId === p.id);
      const sales = parkedSales.filter((s) => s.ticker === p.ticker && s.accountId === p.accountId);
      m.set(p.id, positionTotalReturn(p, lots, parkedLotAdjustments, sales));
    }
    return m;
  }, [allParked, parkedLots, parkedLotAdjustments, parkedSales]);
  const pileReturn = useMemo(() => {
    let total = 0; let invested = 0;
    for (const r of totalReturnByPosition.values()) {
      total += r.total; invested += r.invested;
    }
    return { total, invested, pct: invested > 0 ? total / invested : null };
  }, [totalReturnByPosition]);

  const today = todayISO();
  const c = concentration(parked, concentrationCap);
  const totalBasis = parked.reduce((s, p) => s + parkedCostBasis(p), 0);

  // Real history: shares held per past day (lots + sale add-backs) × actual
  // closes — reaches back to the first dated lot, decades past the snapshots.
  const btcTickers = useMemo(() => new Set(btcParked.map((p) => p.ticker)), [btcParked]);
  const pileSales = useMemo(
    () => parkedSales.filter((s) => !retirementAccountIds.has(s.accountId) && !btcTickers.has(s.ticker)),
    [parkedSales, retirementAccountIds, btcTickers],
  );
  // Window floored at 2020 — the 2003 QCOM lots still count as held, but
  // two decades of axis made the recent story unreadable (owner call).
  const valueHistory = useValueHistory(allParked, parkedLots, pileSales, c.total, '2020-01-01');

  // The funding answer, computed instead of tooltipped: which holdings have
  // long-term (Rule 5) shares ready NOW, worth how much, at what est. tax —
  // ordered by the plan (trim rank), then double-duty semis when over cap,
  // then size. Never-trim holds are excluded by definition.
  const trimFuel = useMemo(() => {
    const rows = parked
      .filter((p) => !isNeverTrimFuel(p))
      .map((p) => {
        const lots = lotsByPosition.get(p.id) ?? [];
        const summ = unlockSummary(lots, today);
        if (summ.unlockedShares <= 1e-9) return null;
        const readyValue = summ.unlockedShares * p.currentPrice;
        let gain: number | null = null;
        let estTax: number | null = null;
        if (lots.length > 0) {
          try {
            const prev = trimPreview(
              lots, summ.unlockedShares, p.currentPrice, today,
              adjustmentsForLots(lots, parkedLotAdjustments),
            );
            gain = prev.gain;
            estTax = estimatedPileTax(
              prev.gain, summ.unlockedShares, prev.ltShares + prev.unknownShares,
              ltTaxRate, stTaxRate,
            );
          } catch { /* preview is best-effort */ }
        }
        return { p, unlockedShares: summ.unlockedShares, readyValue, gain, estTax };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => {
        if (a.p.trimRank != null && b.p.trimRank != null) return a.p.trimRank - b.p.trimRank;
        if (a.p.trimRank != null) return -1;
        if (b.p.trimRank != null) return 1;
        if (c.overCap) {
          const aSemi = a.p.category === SEMI_CATEGORY ? 0 : 1;
          const bSemi = b.p.category === SEMI_CATEGORY ? 0 : 1;
          if (aSemi !== bSemi) return aSemi - bSemi;
        }
        return b.readyValue - a.readyValue;
      });
    return rows;
  }, [parked, lotsByPosition, parkedLotAdjustments, today, ltTaxRate, stTaxRate, c.overCap]);
  // What unlocks next among the still-locked (and not never-trim) holdings.
  const nextUnlocks = useMemo(
    () =>
      parked
        .filter((p) => !isNeverTrimFuel(p))
        .map((p) => ({ p, next: unlockSummary(lotsByPosition.get(p.id) ?? [], today).nextUnlock }))
        .filter((x): x is { p: ParkedPosition; next: NonNullable<typeof x.next> } => x.next != null)
        .sort((a, b) => a.next.date.localeCompare(b.next.date))
        .slice(0, 3),
    [parked, lotsByPosition, today],
  );
  const capRoom = contributionCap !== null
    ? contributionStatus(netContributed(cashEvents), contributionCap).remaining
    : null;

  // Three lenses: by account (where things live — the default, matching
  // SpokenFor's grouped accounts), by ticker (across accounts), or flat so a
  // column sort ranks the whole pile at once.
  const [groupBy, setGroupByState] = useState<GroupBy>(() => {
    const stored = safeStorage.get('pileGroupBy');
    return stored === 'ticker' || stored === 'flat' ? stored : 'account';
  });
  const setGroupBy = (m: GroupBy) => {
    setGroupByState(m);
    safeStorage.set('pileGroupBy', m);
  };

  const [sort, setSortState] = useState<SortState<SortKey>>(() => {
    try {
      const stored = JSON.parse(safeStorage.get('pileSort') ?? 'null');
      // Validate: a key retired by a later version must not survive here.
      if (stored?.key && SORT_KEYS.includes(stored.key)) return stored as SortState<SortKey>;
    } catch {
      /* fall through to default */
    }
    return { key: 'default', dir: 'desc' };
  });
  const setSort = (s: SortState<SortKey>) => {
    setSortState(s);
    safeStorage.set('pileSort', JSON.stringify(s));
  };
  /** Click a header: first click sorts by its natural direction, then toggles. */
  const toggleSort = (key: SortKey) =>
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: NATURAL_DIR[key] },
    );

  const sortValue = useCallback(
    (p: ParkedPosition, key: SortKey): number | string => {
      switch (key) {
        case 'label':
          return groupBy === 'ticker' ? p.account : p.ticker;
        case 'shares':
          return p.shares;
        case 'avgCost':
          return p.avgCost;
        case 'price':
          return p.currentPrice;
        case 'dayChange':
          // Sort by the day's percent move; unknown sinks to the bottom.
          return dayChange[p.ticker]?.changePct ?? -Infinity;
        case 'value':
          return parkedMarketValue(p);
        case 'unreal':
          // By dollars — it's the figure the cell leads with.
          return parkedMarketValue(p) - parkedCostBasis(p);
        case 'totalReturn':
          return totalReturnByPosition.get(p.id)?.total ?? -Infinity;
        case 'unlock': {
          // Soonest actionable first: fully unlocked, then by days to unlock,
          // undated last (the app can't prove a holding period).
          const s = unlockSummary(lotsByPosition.get(p.id) ?? [], today);
          if (s.totalShares > 0 && s.unlockedShares >= s.totalShares - 1e-9) return -1;
          if (s.nextUnlock) return daysBetween(today, s.nextUnlock.date);
          return Number.MAX_SAFE_INTEGER;
        }
        default:
          return 0;
      }
    },
    [groupBy, lotsByPosition, today, dayChange, totalReturnByPosition],
  );

  const sortPositions = useCallback(
    (positions: ParkedPosition[]) => {
      if (sort.key === 'default') {
        // Trim rank first (the plan), then biggest value.
        return [...positions].sort((a, b) => {
          if (a.trimRank != null && b.trimRank != null) return a.trimRank - b.trimRank;
          if (a.trimRank != null) return -1;
          if (b.trimRank != null) return 1;
          return parkedMarketValue(b) - parkedMarketValue(a);
        });
      }
      const flip = sort.dir === 'asc' ? 1 : -1;
      return [...positions].sort((a, b) => {
        const av = sortValue(a, sort.key);
        const bv = sortValue(b, sort.key);
        if (typeof av === 'string' || typeof bv === 'string') {
          return String(av).localeCompare(String(bv)) * flip;
        }
        return (av - bv) * flip;
      });
    },
    [sort, sortValue],
  );

  const groups = useMemo(() => {
    if (groupBy === 'flat') {
      return [{ key: 'all', label: '', positions: sortPositions(parked) }].filter(
        (g) => g.positions.length > 0,
      );
    }
    if (groupBy === 'account') {
      return [...accounts]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({
          key: a.id,
          label: a.name,
          positions: sortPositions(parked.filter((p) => p.accountId === a.id)),
        }))
        .filter((g) => g.positions.length > 0);
    }
    const tickers = [...new Set(parked.map((p) => p.ticker))];
    return tickers
      .map((t) => ({
        key: t,
        label: t,
        positions: sortPositions(parked.filter((p) => p.ticker === t)),
      }))
      .sort(
        (a, b) =>
          b.positions.reduce((s, p) => s + parkedMarketValue(p), 0) -
          a.positions.reduce((s, p) => s + parkedMarketValue(p), 0),
      );
  }, [groupBy, accounts, parked, sortPositions]);
  const anyPositions = groups.some((g) => g.positions.length > 0);

  return (
    <div>
      <PageHeader
        title="Parked Pile"
        subtitle="The foundation — context only, never in the score. Funding source and skim destination; never refill fuel."
        actions={
          <div className="flex gap-2">
            <Link to="/accounts"
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')} title="Manage accounts">
              <Settings2 className="h-4 w-4" /> Accounts
            </Link>
            <button onClick={() => setAddOpen(true)}
              className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
              <Plus className="h-4 w-4" /> Buy
            </button>
          </div>
        }
      />

      {error && <ErrorCard message={error} />}

      {/* Concentration watch */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile label="Pile total" value={money(c.total)}
          title={`All-time total return: price + dividends (${money(divTotal)} collected) + realized sales, ROC counted once. Simple return on dollars invested, not annualized.`}
          sub={
            <>
              not in score
              {pileReturn.invested > 0 && (
                <span className={pileReturn.total >= 0 ? 'text-green-700' : 'text-red-600'}>
                  {' '}· {signedMoney(pileReturn.total)} all-time
                  {pileReturn.pct != null && ` (${formatPercent(pileReturn.pct)})`}
                </span>
              )}
            </>
          } />
        <StatTile label="Semiconductors" value={formatPercent(c.semiPct)}
          tone={c.overCap ? 'neg' : undefined}
          sub={
            <button onClick={() => setCapOpen(true)} className="hover:text-green-700 hover:underline">
              cap {formatPercent(concentrationCap, 0)} — edit
            </button>
          } />
        <StatTile label="Sector mix" value={Object.keys(c.byCategory).length}
          title={Object.entries(c.byCategory).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${c.total > 0 ? Math.round((v / c.total) * 100) : 0}%`).join(' · ')}
          sub={
            <span className="block truncate">
              {Object.entries(c.byCategory).sort((a, b) => b[1] - a[1]).slice(1, 3)
                .map(([k, v]) => `${k} ${c.total > 0 ? Math.round((v / c.total) * 100) : 0}%`)
                .join(' · ') || '—'}
            </span>
          } />
        <StatTile label="Unrealized" value={money(c.total - totalBasis)}
          tone={toneOf(c.total - totalBasis)}
          sub={<>vs {money(totalBasis)} basis</>} />
      </div>

      {c.overCap && (
        <div className="mb-4 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm font-medium">
          OVER CAP — trim semis first. When a lot goes long-term, trimming a semiconductor does double duty:
          funds the challenge account AND reduces concentration.
        </div>
      )}

      {/* The funding answer: what's ready to move into the challenge, in plan
          order, with the tax cost attached. Supersedes squinting at locks.
          Accordion: the header carries the summary, so collapsed still informs. */}
      {(trimFuel.length > 0 || nextUnlocks.length > 0) && (
        <Card className="p-4 sm:p-6 mb-4 density-aware-card">
          <button
            onClick={() => setFuelOpen(!fuelOpen)}
            className="w-full flex flex-wrap items-baseline justify-between gap-2 text-left"
            aria-expanded={fuelOpen}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {fuelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Trim fuel — {trimFuel.length > 0
                ? `${trimFuel.length} holding${trimFuel.length > 1 ? 's' : ''} · ${money(trimFuel.reduce((s, r) => s + r.readyValue, 0))} ready (Rule 5)`
                : 'nothing long-term yet (Rule 5)'}
            </span>
            {capRoom !== null && (
              <span className={cn('text-xs tabular-nums', capRoom <= 0 ? 'text-red-600 font-medium' : 'text-gray-400')}>
                {capRoom <= 0
                  ? 'contribution cap reached — proceeds stay in the pile'
                  : `${money(capRoom)} of contribution-cap room`}
              </span>
            )}
          </button>
          {fuelOpen && (trimFuel.length > 0 ? (
            <ul className="mt-2 divide-y divide-gray-100">
              {trimFuel.map(({ p, unlockedShares, readyValue, gain, estTax }) => (
                <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {p.trimRank != null && (
                      <span className="inline-block rounded-full bg-green-50 text-green-700 px-1.5 py-0.5 text-[10px] font-bold"
                        title={`Trim rank ${p.trimRank} — your planned order`}>
                        #{p.trimRank}
                      </span>
                    )}
                    <span className="font-medium">{p.ticker}</span>
                    <span className="text-xs text-gray-400 truncate">{p.account}</span>
                    {c.overCap && p.category === SEMI_CATEGORY && (
                      <span className="inline-block rounded-full bg-red-50 text-red-700 px-1.5 py-0.5 text-[10px] font-medium"
                        title="Over the semiconductor cap — trimming this funds the challenge AND fixes concentration.">
                        double duty
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3 text-sm tabular-nums">
                    <span>
                      <span className="font-bold">{money(readyValue)}</span>
                      <span className="ml-1 text-xs text-gray-400">{fmtSh(unlockedShares)} sh</span>
                    </span>
                    {gain != null && (
                      <span className={cn('text-xs', gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                        {signedMoney(gain)} gain
                        {estTax != null && estTax > 0 && (
                          <span className="text-gray-400"> · est. tax {money(estTax)}</span>
                        )}
                      </span>
                    )}
                    <button
                      onClick={() => { setTrimPresetShares(Math.round(unlockedShares * 1e6) / 1e6); setTrimming(p); }}
                      className={cn(secondaryBtnCls, 'py-1 px-2.5 text-xs')}
                      title="Opens the Sell form with the unlocked shares prefilled — adjust freely."
                    >
                      Sell {fmtSh(unlockedShares)} sh
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-gray-400">Nothing is long-term yet.</p>
          ))}
          {fuelOpen && nextUnlocks.length > 0 && (
            <p className="mt-2 text-xs text-gray-400 tabular-nums">
              Unlocking next: {nextUnlocks.map(({ p, next }) =>
                `${fmtSh(next.shares)} sh ${p.ticker} on ${next.date}`).join(' · ')}
            </p>
          )}
        </Card>
      )}

      {/* Value history reconstructed from the real records (lots × actual
          closes); daily snapshots stay as the fallback while it loads or
          when the price API is out. VALUE, not return — new money moves it. */}
      {valueHistory && valueHistory.length >= 2 ? (
        <ValueChart title="Pile value over time" data={valueHistory}
          note="reconstructed from lots × real closes — new money moves this line too" />
      ) : (
        snapshots.length >= 2 && <PileValueChart snapshots={snapshots} />
      )}

      {loading ? (
        <SkeletonTable />
      ) : !anyPositions ? (
        <EmptyState
          icon={Archive}
          title="Nothing parked yet"
          hint="Hit Buy to add the first holding — every position starts as a dated purchase lot with its own 366-day unlock clock."
        />
      ) : (
        // Only the table scrolls sideways — the group-by toolbar above stays put.
        <TableCard
          toolbar={
            <div className="flex flex-wrap items-center gap-1 px-4 pt-3">
              <span className="text-xs text-gray-400 mr-1">Group by</span>
              {(['account', 'ticker', 'flat'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setGroupBy(m)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                    groupBy === m ? 'bg-green-50 text-green-700' : 'text-gray-400 hover:bg-gray-100',
                  )}
                >
                  {m === 'account' ? 'Account' : m === 'ticker' ? 'Ticker' : 'Nothing (flat)'}
                </button>
              ))}
              {sort.key !== 'default' && (
                <button
                  onClick={() => setSort({ key: 'default', dir: 'desc' })}
                  className="ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium text-gray-400 hover:bg-gray-100"
                  title="Back to trim rank, then largest value"
                >
                  clear sort
                </button>
              )}
            </div>
          }
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0 group/head">
              <tr className="text-left text-xs">
                <th className="px-2 py-3 w-8" />
                <SortHeader label={groupBy === 'ticker' ? 'Account' : 'Ticker'} sortKey="label"
                  sort={sort} onSort={toggleSort} />
                <SortHeader label="Shares" sortKey="shares" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader label="Avg cost" sortKey="avgCost" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader label="Price" sortKey="price" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader label="Change" sortKey="dayChange" sort={sort} onSort={toggleSort} align="right"
                  title="Today's move from the quote feed (delayed)." />
                <SortHeader label="Value" sortKey="value" sort={sort} onSort={toggleSort} align="right" />
                <SortHeader label="Unrealized" sortKey="unreal" sort={sort} onSort={toggleSort} align="right"
                  title="Gain or loss against cost basis, in dollars and percent. Sorts by dollars." />
                <SortHeader label="Total return" sortKey="totalReturn" sort={sort} onSort={toggleSort} align="right"
                  title="The whole story: price gain + dividends + realized sales, with ROC counted once. Percent is simple return on dollars invested — not annualized. Sort to rank winners and losers." />
                <SortHeader label="LT" sortKey="unlock" sort={sort} onSort={toggleSort}
                  title="Funding unlock: shares held >1 year sell at long-term rates — the only legitimate funding trims (Rule 5). Open lock = unlocked, amber = partly, closed = locked, warning = needs lot dates. Sorts soonest-actionable first; expand a row for the schedule." />
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((group) => {
                const groupValue = group.positions.reduce((s, p) => s + parkedMarketValue(p), 0);
                const groupShares = group.positions.reduce((s, p) => s + p.shares, 0);
                const groupBasis = group.positions.reduce((s, p) => s + parkedCostBasis(p), 0);
                const first = group.positions[0];
                return (
                  <Fragment key={group.key}>
                    {groupBy !== 'flat' && (
                    <tr className="bg-gray-50">
                      <td colSpan={11} className="px-4 py-2">
                        {groupBy === 'account' ? (
                          <span className="font-bold text-gray-700">
                            {group.label}
                            <span className="ml-2 text-xs font-normal text-gray-400">
                              {group.positions.length} holding{group.positions.length > 1 ? 's' : ''} ·{' '}
                              <span className="tabular-nums">{money(groupValue)}</span>
                              {groupBasis > 0 && (
                                <span className={cn('tabular-nums',
                                  groupValue - groupBasis >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {' '}· {signedMoney(groupValue - groupBasis)}
                                </span>
                              )}
                              <span className="tabular-nums" title="Tracked strategy cash — auto-flows from sales, dividends, buys, and challenge funding, plus your manual entries. Reconcile on the Accounts screen.">
                                {' '}· {money(accountCash(group.key).balance)} cash
                              </span>
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-bold text-gray-700">
                            {group.label}
                            <span className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', categoryPillCls(first.category))}>
                              {first.category}
                            </span>
                            {tickerNames[group.label] && (
                              <span className="inline-block align-bottom text-xs font-normal text-gray-400 truncate max-w-[12rem]">{tickerNames[group.label]}</span>
                            )}
                            <span className="text-xs font-normal text-gray-400 tabular-nums">
                              · {fmtSh(groupShares)} sh across {group.positions.length} account{group.positions.length > 1 ? 's' : ''} ·{' '}
                              {money(groupValue)}
                              {groupBasis > 0 && (
                                <span className={groupValue - groupBasis >= 0 ? ' text-green-600' : ' text-red-600'}>
                                  {' '}· {signedMoney(groupValue - groupBasis)}
                                  {' '}({formatPercent((groupValue - groupBasis) / groupBasis)})
                                </span>
                              )}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                    )}
                    {group.positions.map((p) => {
                const value = parkedMarketValue(p);
                const basis = parkedCostBasis(p);
                const summ = unlockSummary(lotsByPosition.get(p.id) ?? [], today);
                const expanded = expandedId === p.id;
                const toggle = () => setExpandedId(expanded ? null : p.id);
                return (
                  <Fragment key={p.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={toggle}>
                      <td className="px-2 py-3">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-300" />
                        )}
                      </td>
                      {groupBy !== 'ticker' ? (
                        <td className="px-4 py-3 font-medium">
                          <span className="flex items-center gap-1.5">
                            {p.ticker}
                            <span className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', categoryPillCls(p.category))}>
                              {p.category}
                            </span>
                            {p.trimRank != null && (
                              <span className="inline-block rounded-full bg-gray-100 text-gray-500 px-1.5 py-0.5 text-[10px] font-bold" title={`Trim rank ${p.trimRank}`}>
                                #{p.trimRank}
                              </span>
                            )}
                          </span>
                          {(() => {
                            // Flat view has no account header, so name it on the row.
                            const parts = [
                              groupBy === 'flat' ? p.account : null,
                              tickerNames[p.ticker],
                              p.notes,
                            ].filter(Boolean);
                            return parts.length > 0 ? (
                              <p className="text-xs font-normal text-gray-400 max-w-[9rem] truncate"
                                title={parts.join(' · ')}>
                                {parts.join(' · ')}
                              </p>
                            ) : null;
                          })()}
                        </td>
                      ) : (
                        <td className="px-4 py-3 pl-8 text-gray-600">
                          {p.account}
                          {p.trimRank != null && (
                            <span className="ml-1.5 inline-block rounded-full bg-gray-100 text-gray-500 px-1.5 py-0.5 text-[10px] font-bold" title={`Trim rank ${p.trimRank}`}>
                              #{p.trimRank}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right tabular-nums">{fmtSh(p.shares)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(p.avgCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(p.currentPrice)}
                        {overrides[p.ticker] !== undefined && (
                          <span
                            className="ml-1 text-[10px] uppercase text-amber-800 font-bold"
                            title={`Pinned manual price — beats quotes${overrideSetAt[p.ticker] ? `, set ${overrideSetAt[p.ticker].slice(0, 10)}` : ''}. Clear it from Edit.`}
                          >
                            pin
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DayChangeCell move={dayChange[p.ticker]} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{money(value)}</td>
                      <td className="px-4 py-3 text-right">
                        <UnrealCell gain={value - basis} basis={basis} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const tr = totalReturnByPosition.get(p.id);
                          if (!tr) return <span className="text-gray-400">—</span>;
                          return (
                            <span className={cn('tabular-nums font-medium', tr.total >= 0 ? 'text-green-600' : 'text-red-600')}>
                              {signedMoney(tr.total)}
                              {tr.pct != null && (
                                <span className="block text-xs font-normal">{formatPercent(tr.pct)}</span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <UnlockCell summary={summ} price={p.currentPrice} />
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setTrimming(p)} className="p-2 sm:p-1 rounded hover:bg-green-50" aria-label={`Sell ${p.ticker}`} title="Sell shares (Rule 5 trim)">
                          <Scissors className="h-4 w-4 text-gray-300 hover:text-green-700" />
                        </button>
                        <button onClick={() => setTransferring(p)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label={`Transfer ${p.ticker}`} title="Transfer between accounts (ACATS)">
                          <ArrowLeftRight className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setSplitTicker(p.ticker)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label={`Record split for ${p.ticker}`} title={`Record stock split — adjusts every ${p.ticker} holding (all accounts + any challenge lots)`}>
                          <Divide className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setEditing(p)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label={`Edit ${p.ticker}`}>
                          <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={11} className="bg-gray-50 px-4 sm:px-6 py-4">
                          <LotPanel position={p} summary={summ} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      {editing && <EditParkedModal position={editing} onClose={() => setEditing(null)} />}
      {trimming && (
        <TrimModal
          position={trimming}
          initialShares={trimPresetShares ?? undefined}
          onClose={() => { setTrimming(null); setTrimPresetShares(null); }}
        />
      )}
      {transferring && <TransferModal position={transferring} onClose={() => setTransferring(null)} />}
      {splitTicker && <SplitModal ticker={splitTicker} onClose={() => setSplitTicker(null)} />}
      {addOpen && <AddHoldingModal onClose={() => setAddOpen(false)} />}
      {capOpen && (
        <CapModal
          current={concentrationCap}
          onSave={(v) => updateSetting('concentration_cap', v)}
          onClose={() => setCapOpen(false)}
        />
      )}
    </div>
  );
}

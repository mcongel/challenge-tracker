import { Fragment, useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, ChevronDown,
  ChevronRight, Lock, Pencil, Plus, Scissors, Settings2, Trash2, Undo2, Unlock,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ErrorCard, SkeletonTable } from './CashLedger';
import { useData } from '../contexts/DataContext';
import type {
  Account, AccountKind, DividendClassification, ParkedCashEvent, ParkedLot, ParkedPosition,
  ParkedSale, UnlockSummary,
} from '../lib/engine';
import {
  adjustmentsForLots, aggregateLotsAdjusted, basisExhaustedLotIds, concentration,
  contributionStatus, daysBetween, depositExceedsCap, dividendsCollected, estimatedPileTax,
  isArchivedPosition, isNeverTrimFuel, netContributed, parkedCostBasis, parkedMarketValue,
  roundCents, trimPreview, unlockSummary,
} from '../lib/engine';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import {
  cn, errorMessage, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls,
  secondaryBtnCls, todayISO,
} from '../lib/utils';
import { useNotional } from '../lib/useNotional';
import { TotalField } from '../components/ui/TotalField';

/** Short pill labels for dividend tax character; unclassified reads as a
 * warning (amber) until the owner confirms what the broker actually paid. */
export const CLASSIFICATION_LABELS: Record<DividendClassification, string> = {
  qualified: 'qualified',
  ordinary: 'ordinary',
  return_of_capital: 'ROC',
  capital_gain_dist: 'cap gain dist',
  unclassified: 'unclassified',
};

export const classificationPillCls = (c: DividendClassification) =>
  c === 'unclassified'
    ? 'bg-amber-50 text-amber-800'
    : c === 'return_of_capital'
      ? 'bg-sky-50 text-sky-700'
      : 'bg-gray-100 text-gray-600';

const CATEGORY_STYLES: Record<ParkedPosition['category'], string> = {
  'Semi/AI': 'bg-indigo-50 text-indigo-700',
  'AI-adjacent': 'bg-sky-50 text-sky-700',
  BTC: 'bg-amber-50 text-amber-800',
  Other: 'bg-gray-100 text-gray-600',
};

const fmtSh = (n: number) => String(Number(n.toFixed(4)));

type GroupBy = 'account' | 'ticker' | 'flat';
type SortKey =
  | 'default' | 'label' | 'shares' | 'avgCost' | 'price' | 'dayChange' | 'value' | 'unreal'
  | 'unlock';
/** Reused by other sortable tables (Income) — the thead needs `group/head`
 * for the idle-arrow hover reveal. */
export interface SortState<K extends string = SortKey> {
  key: K;
  dir: 'asc' | 'desc';
}
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
  unlock: 'asc',
};
const SORT_KEYS = Object.keys(NATURAL_DIR) as SortKey[];

export function SortHeader<K extends string = SortKey>({
  label, sortKey, sort, onSort, align = 'left', title,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn('px-4 py-3', align === 'right' && 'text-right')} title={title}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wider font-semibold hover:text-gray-700',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-green-700' : 'text-gray-500',
        )}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-0 group-hover/head:opacity-100 text-gray-300" />
        )}
      </button>
    </th>
  );
}

export function ParkedPile() {
  const {
    parked: allParked, parkedLots, parkedSales, accounts, tickerNames, deleteParkedSale,
    undoParkedSale, concentrationCap, updateSetting, accountCash, dayChange, ltTaxRate, stTaxRate,
    overrides, overrideSetAt, loading, error,
  } = useData();
  // Archived (zero-share) rows keep dividend history alive on the Income
  // screen; this table shows live holdings only.
  const parked = useMemo(() => allParked.filter((p) => !isArchivedPosition(p)), [allParked]);
  const [capOpen, setCapOpen] = useState(false);
  const [deletingSale, setDeletingSale] = useState<ParkedSale | null>(null);
  const [editingSale, setEditingSale] = useState<ParkedSale | null>(null);
  const [undoingSale, setUndoingSale] = useState<ParkedSale | null>(null);

  // Undo is LIFO per holding: only the newest snapshot sale for a
  // ticker+account can be undone (older restores would fight newer state).
  const newestSnapshotSaleIds = useMemo(() => {
    const newest = new Map<string, ParkedSale>();
    for (const s of parkedSales) {
      if (!s.consumed) continue;
      const key = `${s.ticker}|${s.accountId}`;
      const cur = newest.get(key);
      if (!cur || (s.createdAt ?? s.date) > (cur.createdAt ?? cur.date)) newest.set(key, s);
    }
    return new Set([...newest.values()].map((s) => s.id));
  }, [parkedSales]);

  const realized = parkedSales.filter((s) => s.costBasis != null);
  const realizedTotal = realized.reduce((sum, s) => sum + (s.proceeds - (s.costBasis as number)), 0);
  const estTaxTotal = realized.reduce(
    (sum, s) =>
      sum + estimatedPileTax(s.proceeds - (s.costBasis as number), s.shares, s.ltShares, ltTaxRate, stTaxRate),
    0,
  );
  const unknownBasisCount = parkedSales.length - realized.length;
  const [editing, setEditing] = useState<ParkedPosition | null>(null);
  const [trimming, setTrimming] = useState<ParkedPosition | null>(null);
  const [transferring, setTransferring] = useState<ParkedPosition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const lotsByPosition = useMemo(() => {
    const m = new Map<string, ParkedLot[]>();
    for (const l of parkedLots) (m.get(l.parkedPositionId) ?? m.set(l.parkedPositionId, []).get(l.parkedPositionId)!).push(l);
    return m;
  }, [parkedLots]);
  const divTotal = dividendsCollected(parkedLots);

  const today = todayISO();
  const c = concentration(parked, concentrationCap);
  const totalBasis = parked.reduce((s, p) => s + parkedCostBasis(p), 0);

  // Three lenses: by account (where things live — the default, matching
  // SpokenFor's grouped accounts), by ticker (across accounts), or flat so a
  // column sort ranks the whole pile at once.
  const [groupBy, setGroupByState] = useState<GroupBy>(() => {
    const stored = localStorage.getItem('pileGroupBy');
    return stored === 'ticker' || stored === 'flat' ? stored : 'account';
  });
  const setGroupBy = (m: GroupBy) => {
    setGroupByState(m);
    localStorage.setItem('pileGroupBy', m);
  };

  const [sort, setSortState] = useState<SortState>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pileSort') ?? 'null');
      // Validate: a key retired by a later version must not survive here.
      if (stored?.key && SORT_KEYS.includes(stored.key)) return stored as SortState;
    } catch {
      /* fall through to default */
    }
    return { key: 'default', dir: 'desc' };
  });
  const setSort = (s: SortState) => {
    setSortState(s);
    localStorage.setItem('pileSort', JSON.stringify(s));
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
    [groupBy, lotsByPosition, today, dayChange],
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
            <button onClick={() => setAccountsOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')} title="Manage accounts">
              <Settings2 className="h-4 w-4" /> Accounts
            </button>
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
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Pile total</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(c.total))}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            not in score
            {divTotal > 0 && <span className="text-green-700"> · +{formatCurrency(roundCents(divTotal))} dividends</span>}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Semi/AI</p>
          <p className={cn('mt-0.5 text-xl font-bold tabular-nums', c.overCap ? 'text-red-600' : 'text-gray-900')}>
            {formatPercent(c.semiPct)}
          </p>
          <button onClick={() => setCapOpen(true)}
            className="text-xs text-gray-400 mt-0.5 hover:text-green-700 hover:underline">
            cap {formatPercent(concentrationCap, 0)} — edit
          </button>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Semi/AI + adjacent</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{formatPercent(c.semiPlusAdjacentPct)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatCurrency(roundCents(c.semiPlusAdjacentValue))}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Unrealized</p>
          <p className={cn('mt-0.5 text-xl font-bold tabular-nums',
            c.total - totalBasis >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(roundCents(c.total - totalBasis))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">vs {formatCurrency(roundCents(totalBasis))} basis</p>
        </div>
      </div>

      {c.overCap && (
        <div className="mb-4 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm font-medium">
          OVER CAP — trim semis first. When a lot goes long-term, trimming Semi/AI does double duty:
          funds the challenge account AND reduces concentration.
        </div>
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
        <div className="bg-white rounded-lg shadow-lg overflow-x-auto">
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
                      <td colSpan={10} className="px-4 py-2">
                        {groupBy === 'account' ? (
                          <span className="font-bold text-gray-700">
                            {group.label}
                            <span className="ml-2 text-xs font-normal text-gray-400">
                              {group.positions.length} holding{group.positions.length > 1 ? 's' : ''} ·{' '}
                              <span className="tabular-nums">{formatCurrency(roundCents(groupValue))}</span>
                              {groupBasis > 0 && (
                                <span className={cn('tabular-nums',
                                  groupValue - groupBasis >= 0 ? 'text-green-600' : 'text-red-600')}>
                                  {' '}· {groupValue - groupBasis >= 0 ? '+' : '−'}
                                  {formatCurrency(Math.abs(roundCents(groupValue - groupBasis)))}
                                </span>
                              )}
                              <span className="tabular-nums" title="Tracked strategy cash — auto-flows from sales, dividends, buys, and challenge funding, plus your manual entries. Reconcile in the Accounts modal.">
                                {' '}· {formatCurrency(roundCents(accountCash(group.key).balance))} cash
                              </span>
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-bold text-gray-700">
                            {group.label}
                            <span className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_STYLES[first.category])}>
                              {first.category}
                            </span>
                            {tickerNames[group.label] && (
                              <span className="text-xs font-normal text-gray-400 truncate max-w-[12rem]">{tickerNames[group.label]}</span>
                            )}
                            <span className="text-xs font-normal text-gray-400 tabular-nums">
                              · {fmtSh(groupShares)} sh across {group.positions.length} account{group.positions.length > 1 ? 's' : ''} ·{' '}
                              {formatCurrency(roundCents(groupValue))}
                              {groupBasis > 0 && (
                                <span className={groupValue - groupBasis >= 0 ? ' text-green-600' : ' text-red-600'}>
                                  {' '}· {groupValue - groupBasis >= 0 ? '+' : '−'}
                                  {formatCurrency(Math.abs(roundCents(groupValue - groupBasis)))}
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
                            <span className={cn('inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_STYLES[p.category])}>
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
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(roundCents(value))}</td>
                      <td className="px-4 py-3 text-right">
                        <UnrealCell gain={value - basis} basis={basis} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <UnlockCell summary={summ} />
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setTrimming(p)} className="p-1 rounded hover:bg-green-50" aria-label={`Sell ${p.ticker}`} title="Sell shares (Rule 5 trim)">
                          <Scissors className="h-4 w-4 text-gray-300 hover:text-green-700" />
                        </button>
                        <button onClick={() => setTransferring(p)} className="p-1 rounded hover:bg-gray-100" aria-label={`Transfer ${p.ticker}`} title="Transfer between accounts (ACATS)">
                          <ArrowLeftRight className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setEditing(p)} className="p-1 rounded hover:bg-gray-100" aria-label={`Edit ${p.ticker}`}>
                          <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={10} className="bg-gray-50 px-4 sm:px-6 py-4">
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
        </div>
      )}

      {/* The pile's own sale log — its own little tracker, never in the score. */}
      {parkedSales.length > 0 && (
        <div className="mt-4 bg-white rounded-lg shadow-lg overflow-x-auto">
          <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Sale history — pile only, never in the score
            </p>
            <p className="text-sm tabular-nums">
              <span className="text-gray-500">Realized: </span>
              <span className={cn('font-bold', realizedTotal >= 0 ? 'text-green-600' : 'text-red-600')}>
                {formatCurrency(roundCents(realizedTotal))}
              </span>
              {estTaxTotal > 0 && (
                <span className="text-xs text-gray-400" title={`Rough estimate (~${formatPercent(ltTaxRate, 0)} LT / ~${formatPercent(stTaxRate, 0)} ST — editable on Tax Reserve). The quarterly skim is challenge-account-only — set this aside yourself.`}>
                  {' '}· est. tax ~{formatCurrency(roundCents(estTaxTotal))}
                </span>
              )}
              {unknownBasisCount > 0 && (
                <span className="text-xs text-gray-400"> · {unknownBasisCount} sale{unknownBasisCount > 1 ? 's' : ''} with unknown basis excluded</span>
              )}
            </p>
          </div>
          <table className="w-full text-sm compact-table">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Ticker</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2 text-right">Shares</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2 text-right">Proceeds</th>
                <th className="px-4 py-2 text-right">Basis</th>
                <th className="px-4 py-2 text-right">Gain</th>
                <th className="px-4 py-2">Term</th>
                <th className="px-4 py-2">Proceeds went</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...parkedSales].reverse().map((s) => {
                const gain = s.costBasis === null || s.costBasis === undefined ? null : s.proceeds - s.costBasis;
                const term =
                  s.ltShares === null || s.ltShares === undefined ? null
                  : s.ltShares >= s.shares - 1e-9 ? 'LT'
                  : s.ltShares <= 1e-9 ? 'ST' : 'MIXED';
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 tabular-nums text-gray-500">{s.date}</td>
                    <td className="px-4 py-2 font-medium">{s.ticker}</td>
                    <td className="px-4 py-2 text-gray-500">{accounts.find((a) => a.id === s.accountId)?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtSh(s.shares)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(s.pricePerShare)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(s.proceeds)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                      {s.costBasis == null ? '—' : formatCurrency(s.costBasis)}
                    </td>
                    <td className={cn('px-4 py-2 text-right tabular-nums font-medium',
                      gain === null ? 'text-gray-400' : gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                      {gain === null ? 'unknown' : formatCurrency(roundCents(gain))}
                    </td>
                    <td className="px-4 py-2">
                      {term === null ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          term === 'LT' ? 'bg-teal-50 text-teal-700'
                          : term === 'ST' ? 'bg-indigo-50 text-indigo-700'
                          : 'bg-amber-50 text-amber-800')}>
                          {term}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {s.fundedChallenge ? (
                        <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">
                          → challenge
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">stayed outside</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {s.consumed && (
                        <button
                          onClick={() => setUndoingSale(s)}
                          disabled={!newestSnapshotSaleIds.has(s.id)}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                          aria-label="Undo sale"
                          title={newestSnapshotSaleIds.has(s.id)
                            ? 'Undo — lots and basis come back exactly'
                            : 'Undo newer sales of this holding first'}
                        >
                          <Undo2 className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                      )}
                      <button onClick={() => setEditingSale(s)} className="p-1 rounded hover:bg-gray-100" aria-label="Edit sale record">
                        <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                      </button>
                      <button onClick={() => setDeletingSale(s)} className="p-1 rounded hover:bg-red-50" aria-label="Delete sale record">
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

      {editing && <EditParkedModal position={editing} onClose={() => setEditing(null)} />}
      {trimming && <TrimModal position={trimming} onClose={() => setTrimming(null)} />}
      {transferring && <TransferModal position={transferring} onClose={() => setTransferring(null)} />}
      {accountsOpen && <AccountsModal onClose={() => setAccountsOpen(false)} />}
      {addOpen && <AddHoldingModal onClose={() => setAddOpen(false)} />}
      {deletingSale && (
        <ConfirmModal
          title="Delete sale record"
          message={`Delete the ${deletingSale.ticker} sale from ${deletingSale.date} (${formatCurrency(deletingSale.proceeds)})? This removes only the history record — it does not restore shares or lots.${deletingSale.consumed ? ` If you want the shares back, use Undo instead. Deleting the record also lifts the check that stops OLDER ${deletingSale.ticker} sales from being undone out of order — their Undo could then restore lots this sale already consumed.` : ''}`}
          onConfirm={() => deleteParkedSale(deletingSale.id)}
          onClose={() => setDeletingSale(null)}
        />
      )}
      {undoingSale && (
        <ConfirmModal
          title="Undo sale"
          message={`Undo the ${undoingSale.ticker} sale from ${undoingSale.date} (${fmtSh(undoingSale.shares)} sh, ${formatCurrency(undoingSale.proceeds)})? Lots, basis, and ROC adjustments come back exactly; ROC recorded after this sale is recomputed over the restored lots.${undoingSale.fundedChallenge ? ' IMPORTANT: this sale funded the challenge — the ledger Deposit and its shadow VOO twin are NOT removed. Fix the Cash Ledger yourself.' : ''}`}
          confirmLabel="Undo sale"
          onConfirm={() => undoParkedSale(undoingSale.id)}
          onClose={() => setUndoingSale(null)}
        />
      )}
      {editingSale && <EditSaleModal sale={editingSale} onClose={() => setEditingSale(null)} />}
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

function CapModal({
  current, onSave, onClose,
}: {
  current: number;
  onSave: (v: number) => Promise<void>;
  onClose: () => void;
}) {
  const [pct, setPct] = useState(String(Math.round(current * 100)));
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(pct);
    if (!v || v <= 0 || v > 100) return setFormError('Enter a percentage between 1 and 100.');
    setBusy(true);
    try {
      await onSave(v / 100);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Semi/AI concentration cap">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Cap (% of pile)</label>
          <input type="number" min="1" max="100" step="1" required value={pct} autoFocus
            onChange={(e) => setPct(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Above this share of the pile in Semi/AI, the OVER CAP banner fires — trim semis first.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save cap'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditSaleModal({ sale: s, onClose }: { sale: ParkedSale; onClose: () => void }) {
  const { updateParkedSale, editParkedSaleAmounts } = useData();
  // Snapshot sales re-derive basis and term from the lots — their numbers are
  // truly editable. Legacy (pre-snapshot) sales can only correct the record.
  const snapshotMode = Boolean(s.consumed);
  const [date, setDate] = useState(s.date);
  const { shares, price, total, setShares, setPrice, setTotal } = useNotional({
    shares: String(s.shares),
    price: String(s.pricePerShare),
    total: String(s.proceeds), // the stored dollars, not the rounded product
    driver: 'total', // share edits re-derive price from the EXACT proceeds
  });
  const [basis, setBasis] = useState(s.costBasis != null ? String(s.costBasis) : '');
  const [ltShares, setLtShares] = useState(s.ltShares != null ? String(s.ltShares) : '');
  const [funded, setFunded] = useState(s.fundedChallenge);
  const [notes, setNotes] = useState(s.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numBasis = Number(basis);
  const gainPreview = snapshotMode
    ? null
    : basis !== '' && numBasis >= 0 ? s.proceeds - numBasis : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (snapshotMode) {
      const sh = Number(shares);
      const pr = Number(price);
      if (!sh || sh <= 0) return setFormError('Enter the shares sold.');
      if (!pr || pr <= 0) return setFormError('Enter the sale price.');
      // Only a real number change goes through the destructive undo+re-apply;
      // funded/notes-only edits patch the record in place.
      const numbersChanged =
        Math.abs(sh - s.shares) > 1e-9 ||
        Math.abs(pr - s.pricePerShare) > 1e-9 ||
        date !== s.date;
      setBusy(true);
      try {
        if (numbersChanged) {
          await editParkedSaleAmounts(s.id, {
            shares: sh,
            pricePerShare: pr,
            date,
            fundedChallenge: funded,
            notes: notes || null,
          });
        } else {
          await updateParkedSale(s.id, { fundedChallenge: funded, notes: notes || null });
        }
        onClose();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (ltShares !== '' && Number(ltShares) > s.shares + 1e-9) {
      return setFormError(`Long-term shares can't exceed the ${fmtSh(s.shares)} sh sold.`);
    }
    setBusy(true);
    try {
      await updateParkedSale(s.id, {
        date,
        costBasis: basis === '' ? null : roundCents(numBasis),
        ltShares: ltShares === '' ? null : Number(ltShares),
        fundedChallenge: funded,
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
    <Modal isOpen onClose={onClose} title={`Edit sale — ${s.ticker} (${fmtSh(s.shares)} sh, ${formatCurrency(s.proceeds)})`}>
      <form onSubmit={submit} className="space-y-3">
        {snapshotMode ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Shares</label>
                <input type="number" step="any" min="0.00000001" required value={shares}
                  onChange={(e) => setShares(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Price ($)</label>
                <input type="number" step="any" min="0" required value={price}
                  onChange={(e) => setPrice(e.target.value)} className={inputCls} />
              </div>
              <TotalField value={total} onChange={setTotal} label="Total proceeds ($)" />
            </div>
            <p className="text-xs text-gray-400">
              Saving undoes this sale and re-applies it with the corrected numbers — lots, basis,
              and long-term split all re-derive. The challenge ledger is never touched; if this
              sale funded a Deposit whose amount changed, fix it on the Cash Ledger.
            </p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cost basis ($)</label>
                <input type="number" step="any" min="0" value={basis} placeholder="unknown"
                  onChange={(e) => setBasis(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Long-term shares (of {fmtSh(s.shares)})</label>
                <input type="number" step="any" min="0" value={ltShares} placeholder="unknown"
                  onChange={(e) => setLtShares(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Recorded before undo support — numbers only; shares and lots don't change.
            </p>
          </>
        )}
        {gainPreview !== null && (
          <p className="text-sm text-gray-600">
            Realized gain:{' '}
            <span className={cn('font-medium tabular-nums', gainPreview >= 0 ? 'text-green-600' : 'text-red-600')}>
              {formatCurrency(roundCents(gainPreview))}
            </span>
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={funded} onChange={(e) => setFunded(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Proceeds funded the challenge account
        </label>
        <p className="text-xs text-gray-400">
          This flag is bookkeeping only — it does not create or remove ledger deposits. If a
          deposit exists or is missing on the Cash Ledger, fix it there.
        </p>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddHoldingModal({ onClose }: { onClose: () => void }) {
  const { accounts, parked, addParkedPosition, addParkedLot } = useData();
  const outside = accounts.filter((a) => a.kind === 'outside');
  const [ticker, setTicker] = useState('');
  const [accountId, setAccountId] = useState(outside[0]?.id ?? '');
  const [category, setCategory] = useState<ParkedPosition['category']>('Semi/AI');
  const [date, setDate] = useState('');
  const { shares, price, total, setShares, setPrice, setTotal } = useNotional();
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Buying more of something already held merges as a new purchase lot; the
  // existing position's category wins. (Archived matches go through the
  // revive path in addParkedPosition instead.)
  const existing = parked.find(
    (p) => p.ticker === ticker.trim().toUpperCase() && p.accountId === accountId,
  );
  const liveMatch = existing && !isArchivedPosition(existing) ? existing : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const t = ticker.trim().toUpperCase();
    const sh = Number(shares);
    const pr = Number(price);
    if (!sh || sh <= 0 || !pr || pr <= 0) return setFormError('Enter shares and cost per share.');
    setBusy(true);
    try {
      if (liveMatch) {
        await addParkedLot({
          parkedPositionId: liveMatch.id,
          date: date || null,
          source: 'purchase',
          shares: sh,
          price: pr,
          amount: roundCents(sh * pr),
          notes: notes || null,
        });
      } else {
        await addParkedPosition({
          ticker: t,
          accountId,
          category,
          date: date || null,
          shares: sh,
          price: pr,
          notes: notes || null,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Buy — parked pile">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="NVDA" />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <select
              value={liveMatch ? liveMatch.category : category}
              disabled={Boolean(liveMatch)}
              onChange={(e) => setCategory(e.target.value as ParkedPosition['category'])}
              className={cn(inputCls, liveMatch && 'opacity-60')}>
              <option>Semi/AI</option>
              <option>AI-adjacent</option>
              <option>BTC</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Buy date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        {liveMatch && (
          <p className="text-xs text-sky-700 bg-sky-50 rounded-md px-3 py-2">
            {liveMatch.ticker} is already held in this account — this buy adds a purchase lot to
            the existing position ({fmtSh(liveMatch.shares)} sh held).
          </p>
        )}
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account" kinds={['outside']} allowNone={false} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Shares</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cost per share ($)</label>
            <input type="number" step="any" min="0" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <TotalField value={total} onChange={setTotal} label="Total cost ($)" />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Each buy is its own dated lot with its own 366-day unlock clock. Dividends go in from
          the row's lot panel. Context only — never in the score.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Buying…' : 'Buy'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A flag, not a sentence — hover for the summary, expand the row for the
 * lot-by-lot schedule. "Unlocked" = held >1 year = Rule 5 trim fuel. */
function UnlockCell({ summary: s }: { summary: UnlockSummary }) {
  if (s.totalShares <= 0) return <span className="text-xs text-gray-400">—</span>;
  const flag = (icon: React.ReactNode, cls: string) => (
    <span className={cn('inline-flex items-center', cls)} title={unlockSentence(s)}>
      {icon}
    </span>
  );
  if (s.unknownShares >= s.totalShares - 1e-9) {
    return flag(<AlertTriangle className="h-4 w-4" />, 'text-amber-600');
  }
  if (s.unlockedShares >= s.totalShares - 1e-9) {
    return flag(<Unlock className="h-4 w-4" />, 'text-green-600');
  }
  if (s.unlockedShares > 0) {
    // Partially unlocked: open lock, amber — some fuel, not all.
    return flag(<Unlock className="h-4 w-4" />, 'text-amber-600');
  }
  return flag(<Lock className="h-4 w-4" />, 'text-gray-300');
}

/** Unrealized gain: the dollar figure leads, the percent rides in a tinted
 * pill — same grammar as the day-change cell. */
function UnrealCell({ gain, basis }: { gain: number; basis: number }) {
  const up = gain >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className={cn('font-medium', up ? 'text-green-600' : 'text-red-600')}>
        {up ? '+' : '−'}{formatCurrency(Math.abs(roundCents(gain)))}
      </span>
      {basis > 0 && (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium',
          up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
          {formatPercent(gain / basis)}
        </span>
      )}
    </span>
  );
}

/** The day's move, Google-Finance style: dollars then a tinted percent pill. */
function DayChangeCell({
  move,
}: {
  move?: { change: number | null; changePct: number | null };
}) {
  if (!move || move.change === null) return <span className="text-xs text-gray-300">—</span>;
  const up = move.change >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className={up ? 'text-green-600' : 'text-red-600'}>
        {up ? '+' : '−'}{formatCurrency(Math.abs(move.change))}
      </span>
      {move.changePct !== null && (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium',
          up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
          {move.changePct.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

function unlockSentence(s: UnlockSummary): string {
  if (s.totalShares <= 0) return 'No shares.';
  const parts: string[] = [];
  parts.push(`${fmtSh(s.unlockedShares)} of ${fmtSh(s.totalShares)} sh are long-term (funding unlocked)`);
  if (s.nextUnlock) parts.push(`next ${fmtSh(s.nextUnlock.shares)} sh unlock ${s.nextUnlock.date}`);
  if (s.unknownShares > 0) parts.push(`${fmtSh(s.unknownShares)} sh undated — add dates below`);
  return parts.join(' · ') + '.';
}

function LotPanel({ position: p, summary }: { position: ParkedPosition; summary: UnlockSummary }) {
  const { parkedLots, parkedLotAdjustments, addParkedLot, deleteParkedLot, overrides, quotes } = useData();
  const { lots, adjustedAgg, exhausted } = useMemo(() => {
    const positionLots = parkedLots
      .filter((l) => l.parkedPositionId === p.id)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const positionAdjs = adjustmentsForLots(positionLots, parkedLotAdjustments);
    return {
      lots: positionLots,
      adjustedAgg: aggregateLotsAdjusted(positionLots, positionAdjs),
      exhausted: new Set(basisExhaustedLotIds(positionLots, positionAdjs)),
    };
  }, [parkedLots, parkedLotAdjustments, p.id]);
  const effectivePrice = overrides[p.ticker] ?? quotes[p.ticker] ?? p.currentPrice;
  const lastDiv = lots.filter((l) => l.source === 'dividend' && l.date).at(-1);

  const [mode, setMode] = useState<'purchase' | 'dividend' | null>(null);
  const [date, setDate] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [reinvested, setReinvested] = useState(true);
  const [classification, setClassification] = useState<DividendClassification>('unclassified');
  const [exDate, setExDate] = useState('');
  // Dividends accept either entry: dollars (amount) or shares — whichever was
  // typed last drives, the other computes from the reinvest price.
  const [divDriver, setDivDriver] = useState<'amount' | 'shares'>('amount');
  // Purchases get their own notional binding (shares × price ↔ total); the
  // dividend fields keep their separate amount↔shares sync below.
  const pur = useNotional();

  const syncFromAmount = (amt: string, pr: string) => {
    setAmount(amt);
    setDivDriver('amount');
    const a = Number(amt); const pnum = Number(pr);
    if (a > 0 && pnum > 0) setShares(String(Number((a / pnum).toFixed(8))));
  };
  const syncFromShares = (sh: string, pr: string) => {
    setShares(sh);
    setDivDriver('shares');
    const s = Number(sh); const pnum = Number(pr);
    if (s > 0 && pnum > 0) setAmount(String(roundCents(s * pnum)));
  };
  const syncFromPrice = (pr: string) => {
    setPrice(pr);
    if (mode !== 'dividend') return;
    if (divDriver === 'amount') syncFromAmount(amount, pr);
    else syncFromShares(shares, pr);
  };
  const [deleting, setDeleting] = useState<ParkedLot | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openForm = (m: 'purchase' | 'dividend') => {
    setMode(m);
    setDate(todayISO());
    setShares('');
    setAmount('');
    setPrice(m === 'dividend' && effectivePrice ? String(effectivePrice) : '');
    pur.reset();
    setClassification('unclassified');
    setExDate('');
    setFormError(null);
    setJustAdded(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (mode === 'purchase') {
        const sh = Number(pur.shares);
        const pr = Number(pur.price);
        if (!sh || sh <= 0 || !pr || pr <= 0) throw new Error('Enter shares and price.');
        await addParkedLot({
          parkedPositionId: p.id,
          date: date || null,
          source: 'purchase',
          shares: sh,
          price: pr,
          amount: roundCents(sh * pr),
        });
        setMode(null);
      } else {
        const pr = Number(price);
        if (reinvested && (!pr || pr <= 0)) throw new Error('Reinvested dividends need the reinvestment price.');
        const amt = Number(amount) > 0 ? Number(amount) : Number(shares) > 0 && pr > 0 ? Number(shares) * pr : 0;
        if (amt <= 0) throw new Error('Enter the dividend as dollars or shares.');
        const sh = reinvested ? (Number(shares) > 0 ? Number(shares) : amt / pr) : 0;
        await addParkedLot({
          parkedPositionId: p.id,
          date: date || null,
          source: 'dividend',
          shares: sh,
          price: reinvested ? pr : null,
          amount: roundCents(amt),
          classification,
          exDate: exDate || null,
          notes: reinvested ? 'reinvested' : 'cash',
        });
        // Streaks are the norm (daily/monthly payers entered in a run) — keep
        // the form open with date/classification/reinvest intact and the
        // per-entry fields cleared. Ex-date clears too: it differs per
        // payment, and a silently inherited one is wrong holding-period
        // evidence.
        setAmount('');
        setShares('');
        setExDate('');
        setJustAdded(`Added ${formatCurrency(roundCents(amt))} ✓ — form kept for the next one`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
        {p.ticker} — lots &amp; dividends
      </p>
      <p className="text-sm text-gray-600 mb-3">
        {unlockSentence(summary)}
        {lastDiv && (
          <span className="text-gray-500"> Last dividend {lastDiv.date} ({formatCurrency(lastDiv.amount)}).</span>
        )}
        {adjustedAgg.adjustedCostBasis < adjustedAgg.costBasis - 0.005 && (
          <span className="text-gray-500">
            {' '}Basis {formatCurrency(roundCents(adjustedAgg.costBasis))} original ·{' '}
            {formatCurrency(roundCents(adjustedAgg.adjustedCostBasis))} after ROC — sales are taxed
            against the adjusted number.
          </span>
        )}
      </p>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {lots.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className={cn('px-3 py-2 tabular-nums w-28', l.date ? 'text-gray-600' : 'text-amber-800')}>
                    {l.date ?? 'no date'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      l.source === 'purchase' ? 'bg-indigo-50 text-indigo-700' : 'bg-sky-50 text-sky-700')}>
                      {l.source === 'dividend' ? (l.shares > 0 ? 'dividend · DRIP' : 'dividend · cash') : 'purchase'}
                    </span>
                    {l.source === 'dividend' && (
                      <span className={cn('ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        classificationPillCls(l.classification ?? 'unclassified'))}>
                        {CLASSIFICATION_LABELS[l.classification ?? 'unclassified']}
                      </span>
                    )}
                    {exhausted.has(l.id) && (
                      <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
                        title="ROC has consumed this lot's entire basis — further ROC on it is capital gain.">
                        basis 0
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {l.shares > 0 ? `${fmtSh(l.shares)} sh` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatCurrency(l.amount)}</td>
                  <td className="px-1 py-2 w-8">
                    <button onClick={() => setDeleting(l)} className="p-1 rounded hover:bg-red-50" aria-label="Delete lot">
                      <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
              {lots.length === 0 && (
                <tr><td className="px-3 py-4 text-sm text-gray-400 text-center">No lots yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
        {mode === null ? (
          <div className="flex gap-2">
            <button onClick={() => openForm('purchase')} className={secondaryBtnCls}>Add past purchase</button>
            <button onClick={() => openForm('dividend')} className={secondaryBtnCls}>Add dividend</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs font-medium text-gray-500">
              {mode === 'purchase' ? 'Past purchase' : 'Dividend'}
            </p>
            {mode === 'purchase' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Shares</label>
                  <input type="number" step="any" min="0.00000001" required value={pur.shares}
                    onChange={(e) => pur.setShares(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Price ($)</label>
                  <input type="number" step="any" min="0" required value={pur.price}
                    onChange={(e) => pur.setPrice(e.target.value)} className={inputCls} />
                </div>
                <TotalField value={pur.total} onChange={pur.setTotal} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                  </div>
                  {reinvested && (
                    <div>
                      <label className={labelCls}>Reinvest price ($)</label>
                      <input type="number" step="any" min="0" value={price}
                        onChange={(e) => syncFromPrice(e.target.value)} className={inputCls} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Amount ($)</label>
                    <input type="number" step="any" min="0" value={amount}
                      onChange={(e) => syncFromAmount(e.target.value, price)} className={inputCls} />
                  </div>
                  {reinvested && (
                    <div>
                      <label className={labelCls}>Shares</label>
                      <input type="number" step="any" min="0" value={shares}
                        onChange={(e) => syncFromShares(e.target.value, price)} className={inputCls} />
                    </div>
                  )}
                </div>
              </>
            )}
            {mode === 'dividend' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Classification</label>
                    <select value={classification} className={inputCls}
                      onChange={(e) => setClassification(e.target.value as DividendClassification)}>
                      <option value="unclassified">Unclassified (confirm later)</option>
                      <option value="qualified">Qualified</option>
                      <option value="ordinary">Ordinary (non-qualified)</option>
                      <option value="return_of_capital">Return of capital</option>
                      <option value="capital_gain_dist">Capital gain distribution</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Ex-date (optional)</label>
                    <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)}
                      className={inputCls} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={reinvested} onChange={(e) => setReinvested(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
                  Reinvested (DRIP) — enter dollars or shares, the other computes. The shares get
                  their own 366-day clock.
                </label>
              </>
            )}
            {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
            {justAdded && !formError && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">{justAdded}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMode(null)} className={secondaryBtnCls}>
                {justAdded ? 'Done' : 'Cancel'}
              </button>
              <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Add'}</button>
            </div>
          </form>
        )}

        <p className="text-xs text-gray-400 mt-3">
          Shares and cost basis derive from these lots. To fix a wrong entry, delete it and re-add —
          any ROC that was applied to it flips back to "unallocated" on the Income screen for
          one-click re-spreading. Leave the date blank only if it's truly unknown — dated lots
          drive the unlock countdowns.
        </p>
        </div>
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete lot"
          message={`Delete this ${deleting.source} (${deleting.shares > 0 ? `${fmtSh(deleting.shares)} sh, ` : ''}${formatCurrency(deleting.amount)})? The position's shares and cost recompute without it.`}
          onConfirm={() => deleteParkedLot(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function TransferModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { accounts, transferParked } = useData();
  const destinations = accounts.filter((a) => a.kind === 'outside' && a.id !== p.accountId);
  const [toAccountId, setToAccountId] = useState(destinations[0]?.id ?? '');
  const [shares, setShares] = useState(String(p.shares));
  const [date, setDate] = useState(todayISO());
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numShares = Number(shares);
  const partial = numShares > 0 && numShares < p.shares - 1e-9;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!toAccountId) return setFormError('Pick the destination account.');
    if (!numShares || numShares <= 0) return setFormError('Enter shares to transfer.');
    if (numShares > p.shares + 1e-9) return setFormError(`Only ${fmtSh(p.shares)} shares parked.`);
    setBusy(true);
    try {
      await transferParked({ parkedId: p.id, toAccountId, shares: numShares, date });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Transfer ${p.ticker} (from ${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        <AccountSelect accounts={accounts.filter((a) => a.id !== p.accountId)} value={toAccountId}
          onChange={setToAccountId} label="To account" kinds={['outside']} allowNone={false} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Shares (of {fmtSh(p.shares)})</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Transfer date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Not a sale: lot slices move with their original dates and basis, so unlock clocks and
          taxes are unaffected. Oldest lots move first
          {partial && ' — the remainder (e.g. fractional shares an ACATS left behind) stays put with its own dates'}.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || destinations.length === 0} className={primaryBtnCls}>
            {busy ? 'Transferring…' : 'Record transfer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TrimModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const {
    recordTrim, cashEvents, contributionCap, parkedLots, parkedLotAdjustments, ltTaxRate, stTaxRate,
    overrides, quotes,
  } = useData();
  const { shares, price, total, setShares, setPrice, setTotal } = useNotional({
    price: p.currentPrice ? String(p.currentPrice) : '',
  });
  const [date, setDate] = useState(todayISO());
  // The pile stands on its own: selling does NOT presume funding the challenge.
  const [fund, setFund] = useState(false);
  // Today's trims prefill the shadow price from the live VOO quote (editable);
  // backdated trims still need the historical price by hand — changing the
  // date away from today clears a still-prefilled value, because the twin's
  // price is that DAY's price and is never re-derivable later.
  const vooQuote = overrides['VOO'] ?? quotes['VOO'];
  const [vooPrice, setVooPrice] = useState(vooQuote ? String(vooQuote) : '');
  const vooPrefilled = Boolean(vooQuote) && vooPrice === String(vooQuote) && date === todayISO();
  const changeDate = (d: string) => {
    setDate(d);
    if (d !== todayISO() && vooQuote && vooPrice === String(vooQuote)) setVooPrice('');
  };
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numShares = Number(shares);
  const numPrice = Number(price);
  const proceeds = numShares > 0 && numPrice > 0 ? roundCents(numShares * numPrice) : 0;
  const fullTrim = numShares >= p.shares - 1e-9;
  const positionLots = parkedLots.filter((l) => l.parkedPositionId === p.id);
  const summ = unlockSummary(positionLots, date);
  const dipsShortTerm = numShares > 0 && numShares > summ.unlockedShares + 1e-9;
  const neverTrimFuel = isNeverTrimFuel(p);
  let preview: ReturnType<typeof trimPreview> | null = null;
  if (numShares > 0 && numShares <= p.shares + 1e-9 && numPrice > 0 && positionLots.length > 0) {
    try {
      preview = trimPreview(
        positionLots, numShares, numPrice, date,
        adjustmentsForLots(positionLots, parkedLotAdjustments),
      );
    } catch {
      preview = null;
    }
  }
  const isLoss = preview ? preview.gain < 0 : numPrice > 0 && numPrice < p.avgCost;

  const contributed = netContributed(cashEvents);
  const overCap =
    fund && proceeds > 0 && contributionCap !== null &&
    depositExceedsCap(contributed, proceeds, contributionCap);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!numShares || numShares <= 0) return setFormError('Enter shares to trim.');
    if (numShares > p.shares + 1e-9) return setFormError(`Only ${p.shares} shares parked.`);
    if (!numPrice || numPrice <= 0) return setFormError('Enter the sale price.');
    if (fund && (!Number(vooPrice) || Number(vooPrice) <= 0)) {
      return setFormError("Funding the challenge account needs that day's VOO price for the shadow purchase.");
    }
    if (overCap && contributionCap !== null) {
      const room = contributionStatus(contributed, contributionCap).remaining;
      return setFormError(
        `Rule 12: depositing ${formatCurrency(proceeds)} would exceed the contribution cap — only ${formatCurrency(roundCents(room))} of room remains. Uncheck funding or trim less.`,
      );
    }
    setBusy(true);
    try {
      await recordTrim({
        parkedId: p.id,
        shares: numShares,
        pricePerShare: numPrice,
        date,
        depositVooPrice: fund ? Number(vooPrice) : undefined,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Sell ${p.ticker} (${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        {neverTrimFuel && (
          <div className="flex gap-2 bg-red-50 text-red-700 rounded-md px-3 py-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{p.ticker} is never trim fuel — Rule 5. The conviction holds stay parked.</span>
          </div>
        )}
        {dipsShortTerm && !neverTrimFuel && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Only {fmtSh(summ.unlockedShares)} of {fmtSh(summ.totalShares)} sh are long-term.
              Trimming {fmtSh(numShares)} dips into short-term{summ.unknownShares > 0 ? ' or undated' : ''} lots —
              short-term rates, and Rule 5 says planned long-term trims.
              {summ.nextUnlock && ` Next ${fmtSh(summ.nextUnlock.shares)} sh unlock ${summ.nextUnlock.date}.`}
            </span>
          </div>
        )}
        {summ.unlockedShares > 0 && !dipsShortTerm && numShares > 0 && (
          <p className="text-xs text-green-700">
            Within the long-term shares ({fmtSh(summ.unlockedShares)} sh unlocked) — legitimate Rule 5 fuel.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Shares (of {p.shares})</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Price / share ($)</label>
            <input type="number" step="any" min="0.00000001" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" required value={date} onChange={(e) => changeDate(e.target.value)} className={inputCls} />
          </div>
          <TotalField value={total} onChange={setTotal} label="Total proceeds ($)" />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={fund} onChange={(e) => setFund(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Deposit the proceeds into the challenge account
        </label>
        {fund && (
          <div>
            <label className={labelCls}>VOO price on {date}</label>
            <input type="number" step="0.01" min="0.01" value={vooPrice}
              onChange={(e) => setVooPrice(e.target.value)} className={inputCls} placeholder="for the shadow purchase" />
            {vooPrefilled && (
              <p className="mt-0.5 text-xs text-gray-400">from the live quote — edit if the fill differed</p>
            )}
            {!vooPrefilled && date !== todayISO() && (
              <p className="mt-0.5 text-xs text-gray-400">backdated — look up VOO's close for {date}</p>
            )}
          </div>
        )}

        {proceeds > 0 && (
          <div className="bg-gray-50 rounded-md px-3 py-2 text-sm space-y-1">
            <p className="text-gray-600">
              Proceeds <span className="font-medium tabular-nums">{formatCurrency(proceeds)}</span>
              {preview && (
                <>
                  {' '}· gain{' '}
                  <span className={cn('font-medium tabular-nums', preview.gain >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {formatCurrency(roundCents(preview.gain))}
                  </span>
                  <span className="text-gray-400">
                    {preview.adjustedCostBasis < preview.costBasis - 0.005
                      ? ` (adjusted basis ${formatCurrency(roundCents(preview.adjustedCostBasis))} — ROC-reduced from ${formatCurrency(roundCents(preview.costBasis))})`
                      : ` (basis ${formatCurrency(roundCents(preview.costBasis))})`}
                  </span>
                </>
              )}
              {fullTrim && <span className="ml-2 text-gray-500">· sells the whole position — dividend history stays on the Income screen</span>}
            </p>
            {preview && (
              <p className="text-xs text-gray-500 tabular-nums">
                {fmtSh(preview.ltShares)} sh long-term
                {preview.stShares > 0 && ` · ${fmtSh(preview.stShares)} sh short-term`}
                {preview.unknownShares > 0 && ` · ${fmtSh(preview.unknownShares)} sh undated`}
                {preview.gain > 0 && (
                  <span title={`Rough estimate (~${formatPercent(ltTaxRate, 0)} LT / ~${formatPercent(stTaxRate, 0)} ST — editable on Tax Reserve). The quarterly skim never covers pile sales — set this aside yourself.`}>
                    {' '}· est. tax ~{formatCurrency(roundCents(estimatedPileTax(preview.gain, numShares, preview.ltShares + preview.unknownShares, ltTaxRate, stTaxRate)))}
                  </span>
                )}
                {isLoss && <span className="text-red-600 font-medium"> · loss — arms the 31-day wash-sale window</span>}
              </p>
            )}
            <p className="text-xs text-gray-400">
              Recorded in the pile's sale history with basis and term
              {fund ? ', and the Deposit + shadow VOO twin hit the ledger.' : '. Nothing touches the challenge account.'}
              {' '}Sales are undoable from the history — lots and basis come back exactly.
            </p>
          </div>
        )}

        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Recording…' : 'Record sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const KIND_STYLES: Record<AccountKind, string> = {
  challenge: 'bg-green-50 text-green-700',
  outside: 'bg-indigo-50 text-indigo-700',
  bank: 'bg-sky-50 text-sky-700',
};

function AccountsModal({ onClose }: { onClose: () => void }) {
  const { accounts, addAccount, accountCash, parkedCashEvents } = useData();
  // Last reconcile per account, one pass — the rows written by the reconcile
  // flow all carry a 'Reconciled…' note (including zero-diff "matched" ones).
  const lastReconciledByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of parkedCashEvents) {
      if (!e.notes?.startsWith('Reconciled')) continue;
      const prev = m.get(e.accountId);
      if (!prev || e.date > prev) m.set(e.accountId, e.date);
    }
    return m;
  }, [parkedCashEvents]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [broker, setBroker] = useState('');
  const [cashFor, setCashFor] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (accounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      return setFormError(`An account named "${trimmed}" already exists.`);
    }
    setBusy(true);
    try {
      await addAccount(trimmed, kind, broker.trim() || undefined);
      setName(''); setBroker('');
    } catch (err) {
      // 23505 = unique violation — races past the client-side check.
      const isDuplicate = typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
      setFormError(
        isDuplicate
          ? `An account named "${trimmed}" already exists.`
          : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Accounts">
      <div className="space-y-4">
        <p className="text-sm text-gray-500 -mt-1">
          Click an account to see its tracked cash, add movements, and reconcile.
        </p>
        <div className="space-y-1.5">
          {accounts.map((a) => {
            const tracked = a.kind === 'challenge' ? null : accountCash(a.id).balance;
            if (tracked === null) {
              return (
                <div key={a.id} className="rounded-lg border border-gray-200 px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-700 truncate">{a.name}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
                      {a.kind}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">its cash lives on the Cash Ledger</p>
                </div>
              );
            }
            const lastRec = lastReconciledByAccount.get(a.id);
            const recDays = lastRec ? daysBetween(lastRec, todayISO()) : null;
            const recLabel = recDays == null
              ? ' · never reconciled'
              : ` · reconciled ${recDays <= 0 ? 'today' : `${recDays}d ago`}`;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setCashFor(a.id)}
                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-700 truncate">{a.name}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
                      {a.kind}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </div>
                <p className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">
                  {formatCurrency(roundCents(tracked))}
                </p>
                <p className="text-xs text-gray-400">
                  tracked cash · view history & reconcile{recLabel}
                </p>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-3 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">Add account</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                className={inputCls} placeholder="Ally Savings" />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={inputCls}>
                <option value="bank">bank</option>
                <option value="outside">outside</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Broker / institution (optional)</label>
            <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputCls} />
          </div>
          {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={primaryBtnCls}>
              {busy ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
        <p className="text-xs text-gray-400">
          Accounts are labels for where money lives — they never change the score. Cash figures are
          tracked strategy cash, not a claim about your real balance — reconcile monthly.
        </p>
      </div>

      {cashFor && (
        <AccountCashModal
          account={accounts.find((a) => a.id === cashFor)!}
          onClose={() => setCashFor(null)}
        />
      )}
    </Modal>
  );
}

const CASH_TYPE_STYLES: Record<string, string> = {
  deposit: 'bg-green-50 text-green-700',
  interest: 'bg-sky-50 text-sky-700',
  withdrawal: 'bg-orange-50 text-orange-700',
  fee: 'bg-red-50 text-red-700',
  adjustment: 'bg-gray-100 text-gray-600',
};

function AccountCashModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const {
    accountCash, parkedCashEvents, addParkedCashEvent, deleteParkedCashEvent, reconcileAccountCash,
  } = useData();
  const cash = accountCash(account.id);
  const events = parkedCashEvents.filter((e) => e.accountId === account.id).slice().reverse();

  const [type, setType] = useState<ParkedCashEvent['type']>('deposit');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [actual, setActual] = useState('');
  const [reconcileNote, setReconcileNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ParkedCashEvent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const amt = Number(amount);
    if (!amt || (type !== 'adjustment' && amt <= 0)) return setFormError('Amount must be positive (adjustments may be negative).');
    setBusy(true);
    try {
      await addParkedCashEvent({ accountId: account.id, date, type, amount: roundCents(amt), notes: notes || null });
      setAmount(''); setNotes('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setFormError(null);
    setReconcileNote(null);
    const target = Number(actual);
    if (actual === '' || Number.isNaN(target)) return setFormError('Enter the actual balance from the brokerage.');
    setBusy(true);
    try {
      const { adjusted, diff } = await reconcileAccountCash(account.id, target);
      setActual('');
      setReconcileNote(
        adjusted
          ? `Adjusted by ${diff >= 0 ? '+' : '−'}${formatCurrency(Math.abs(diff))} — tracked cash now matches.`
          : '✓ Matches — no adjustment needed.',
      );
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`${account.name} — tracked cash`}>
      <div className="space-y-4">
        <div>
          <p className="text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(roundCents(cash.balance))}</p>
          <p className="text-xs text-gray-400 tabular-nums">
            sales +{formatCurrency(roundCents(cash.saleProceeds))} · dividends +{formatCurrency(roundCents(cash.cashDividends))} ·
            buys −{formatCurrency(roundCents(cash.purchases))} · challenge {cash.challengeFlows >= 0 ? '+' : '−'}{formatCurrency(roundCents(Math.abs(cash.challengeFlows)))} ·
            manual {cash.manual >= 0 ? '+' : '−'}{formatCurrency(roundCents(Math.abs(cash.manual)))}
          </p>
        </div>

        {/* Reconcile — the piece that keeps the number honest. */}
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-green-700 mb-1.5">
            Reconcile to actual
          </p>
          <div className="flex gap-2">
            <input type="number" step="0.01" value={actual} placeholder="balance from the brokerage"
              onChange={(e) => setActual(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600" />
            <button onClick={reconcile} disabled={busy} className={cn(primaryBtnCls, 'py-1.5')}>
              Reconcile
            </button>
          </div>
          <p className="text-[11px] text-green-700/80 mt-1">
            Writes an adjustment for the difference. First time? This sets your opening balance.
            A monthly glance keeps it true.
          </p>
          {reconcileNote && (
            <p className="text-xs font-medium text-green-800 mt-1.5">{reconcileNote}</p>
          )}
        </div>

        {events.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 tabular-nums text-gray-500 w-24">{e.date}</td>
                    <td className="px-3 py-1.5">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', CASH_TYPE_STYLES[e.type])}>
                        {e.type}
                      </span>
                    </td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums font-medium',
                      (e.type === 'withdrawal' || e.type === 'fee' || e.amount < 0) ? 'text-red-600' : 'text-green-600')}>
                      {formatCurrency(e.amount)}
                    </td>
                    <td className="px-3 py-1.5 text-gray-400 text-xs max-w-[10rem] truncate">{e.notes}</td>
                    <td className="px-1 py-1.5 w-8">
                      <button onClick={() => setDeleting(e)} className="p-1 rounded hover:bg-red-50" aria-label="Delete cash event">
                        <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={addEvent} className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">Add movement (external money, interest, fees)</p>
          <div className="grid grid-cols-3 gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as ParkedCashEvent['type'])} className={inputCls}>
              <option value="deposit">deposit</option>
              <option value="withdrawal">withdrawal</option>
              <option value="interest">interest</option>
              <option value="fee">fee</option>
              <option value="adjustment">adjustment</option>
            </select>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="number" step="any" required value={amount} placeholder="$"
              onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          <div className="flex gap-2">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes" className={inputCls} />
            <button type="submit" disabled={busy} className={secondaryBtnCls}>Add</button>
          </div>
        </form>
        <p className="text-xs text-gray-400">
          Trims, buys, dividends, and challenge funding flow in automatically — only enter what the
          app can't see. Tracked strategy cash, never a claim about the real balance.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete cash movement"
          message={`Delete this ${deleting.type} (${formatCurrency(deleting.amount)}) from ${deleting.date}? The tracked balance recomputes without it.`}
          onConfirm={() => deleteParkedCashEvent(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}

function EditParkedModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { updateParked, accounts, overrides, overrideSetAt, setOverride, clearOverride } = useData();
  const pinned = overrides[p.ticker];
  const pinnedAt = overrideSetAt[p.ticker];
  const [price, setPrice] = useState(String(p.currentPrice || ''));
  const [trimRank, setTrimRank] = useState(p.trimRank != null ? String(p.trimRank) : '');
  const [accountId, setAccountId] = useState(p.accountId);
  const [notes, setNotes] = useState(p.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await updateParked(p.id, {
        currentPrice: Number(price) || 0,
        trimRank: trimRank === '' ? null : Number(trimRank),
        accountId,
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
    <Modal isOpen onClose={onClose} title={`Edit ${p.ticker} (${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Price ($)</label>
            <input type="number" step="0.01" min="0" value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Trim rank</label>
            <input type="number" min="1" step="1" value={trimRank}
              onChange={(e) => setTrimRank(e.target.value)} className={inputCls} placeholder="1 = trim first" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
          <span>
            {pinned != null
              ? `Pinned at ${formatCurrency(pinned)}${pinnedAt ? ` since ${pinnedAt.slice(0, 10)}` : ''} — beats quotes until cleared.`
              : 'Pinning beats API quotes until cleared — for tickers the feed misprices.'}
          </span>
          <span className="flex gap-2 whitespace-nowrap">
            {pinned != null && (
              <button
                type="button"
                disabled={busy}
                className="font-medium text-red-600 hover:text-red-800"
                onClick={async () => {
                  setBusy(true);
                  try { await clearOverride(p.ticker); } catch (err) {
                    setFormError(errorMessage(err));
                  } finally { setBusy(false); }
                }}
              >
                Clear pin
              </button>
            )}
            <button
              type="button"
              disabled={busy || !Number(price)}
              className="font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                try { await setOverride(p.ticker, Number(price)); } catch (err) {
                  setFormError(errorMessage(err));
                } finally { setBusy(false); }
              }}
            >
              Pin this price
            </button>
          </span>
        </div>
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account (e.g. after an ACATS transfer)" kinds={['outside', 'challenge']} allowNone={false} />
        <p className="text-xs text-gray-400">
          Shares, cost, and dates live in the lots (click the row to open them) — they recompute from there.
        </p>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

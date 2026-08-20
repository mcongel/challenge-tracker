import { useCallback, useMemo, useState } from 'react';
import type { SortState } from '../components/ui/SortHeader';
import type { Account, ParkedLot, ParkedPosition, PositionTotalReturn } from './engine';
import { daysBetween, parkedCostBasis, parkedMarketValue, unlockSummary } from './engine';
import { safeStorage } from './utils';

export type PileGroupBy = 'account' | 'ticker' | 'flat';
export type PileSortKey =
  | 'default' | 'label' | 'shares' | 'avgCost' | 'price' | 'dayChange' | 'value' | 'unreal'
  | 'totalReturn' | 'unlock';
/** First click on a header sorts the way you'd want: money and size biggest
 * first, names A–Z, unlocks soonest first. */
export const PILE_NATURAL_DIR: Record<PileSortKey, 'asc' | 'desc'> = {
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
const SORT_KEYS = Object.keys(PILE_NATURAL_DIR) as PileSortKey[];

export interface PileGroup {
  key: string;
  label: string;
  positions: ParkedPosition[];
}

/** The pile table's model — grouping lens, sort state (both persisted), and
 * the grouped/sorted rows. Extracted whole from the ParkedPile page. */
export function usePileTable(args: {
  parked: ParkedPosition[];
  accounts: Account[];
  lotsByPosition: Map<string, ParkedLot[]>;
  dayChange: Record<string, { change: number | null; changePct: number | null }>;
  totalReturnByPosition: Map<string, PositionTotalReturn>;
  today: string;
}) {
  const { parked, accounts, lotsByPosition, dayChange, totalReturnByPosition, today } = args;

  // Three lenses: by account (where things live — the default, matching
  // SpokenFor's grouped accounts), by ticker (across accounts), or flat so a
  // column sort ranks the whole pile at once.
  const [groupBy, setGroupByState] = useState<PileGroupBy>(() => {
    const stored = safeStorage.get('pileGroupBy');
    return stored === 'ticker' || stored === 'flat' ? stored : 'account';
  });
  const setGroupBy = (m: PileGroupBy) => {
    setGroupByState(m);
    safeStorage.set('pileGroupBy', m);
  };

  const [sort, setSortState] = useState<SortState<PileSortKey>>(() => {
    try {
      const stored = JSON.parse(safeStorage.get('pileSort') ?? 'null');
      // Validate: a key retired by a later version must not survive here.
      if (stored?.key && SORT_KEYS.includes(stored.key)) return stored as SortState<PileSortKey>;
    } catch {
      /* fall through to default */
    }
    return { key: 'default', dir: 'desc' };
  });
  const setSort = (s: SortState<PileSortKey>) => {
    setSortState(s);
    safeStorage.set('pileSort', JSON.stringify(s));
  };
  /** Click a header: first click sorts by its natural direction, then toggles. */
  const toggleSort = (key: PileSortKey) =>
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: PILE_NATURAL_DIR[key] },
    );

  const sortValue = useCallback(
    (p: ParkedPosition, key: PileSortKey): number | string => {
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

  const groups = useMemo<PileGroup[]>(() => {
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

  /** Back to trim rank, then largest value. */
  const clearSort = () => setSort({ key: 'default', dir: 'desc' });

  return { groupBy, setGroupBy, sort, toggleSort, clearSort, groups };
}

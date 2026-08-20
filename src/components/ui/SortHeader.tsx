import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn, safeStorage } from '../../lib/utils';

/** Sortable column header. The thead needs `group/head` for the idle-arrow
 * hover reveal. Promoted from components/parked — it was never pile-specific. */
export interface SortState<K extends string = string> {
  key: K;
  dir: 'asc' | 'desc';
}

export function SortHeader<K extends string = string>({
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
          active ? 'text-green-700' : 'text-text-muted',
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

/** Sort state with the house toggle convention: clicking the active column
 * flips direction; clicking a new column adopts its NATURAL direction (the
 * one a person wants first — newest dates, biggest dollars). Persists per
 * storageKey; stale stored keys fall back to the initial so a retired column
 * can't wedge a table. */
export function useSortState<K extends string>(args: {
  initial: SortState<K>;
  naturalDir: Record<K, 'asc' | 'desc'>;
  storageKey?: string;
}): { sort: SortState<K>; toggleSort: (key: K) => void } {
  const { initial, naturalDir, storageKey } = args;
  const [sort, setSort] = useState<SortState<K>>(() => {
    if (!storageKey) return initial;
    try {
      const stored = JSON.parse(safeStorage.get(storageKey) ?? 'null');
      if (
        stored && (stored.dir === 'asc' || stored.dir === 'desc') &&
        typeof stored.key === 'string' && stored.key in naturalDir
      ) {
        return stored as SortState<K>;
      }
    } catch { /* fall through to default */ }
    return initial;
  });
  const toggleSort = (key: K) => {
    const next: SortState<K> =
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: naturalDir[key] };
    setSort(next);
    if (storageKey) safeStorage.set(storageKey, JSON.stringify(next));
  };
  return { sort, toggleSort };
}

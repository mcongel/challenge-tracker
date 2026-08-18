import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { DividendClassification, UnlockSummary } from '../../lib/engine';
import { cn } from '../../lib/utils';

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
/** Pill style per sector: the two rule-bearing categories get their own
 * colors (semis = cap, BTC = never-trim); everything else reads neutral. */
export const categoryPillCls = (category: string): string =>
  category === 'Semiconductors'
    ? 'bg-indigo-50 text-indigo-700'
    : category === 'BTC'
      ? 'bg-amber-50 text-amber-800'
      : 'bg-gray-100 text-gray-600';

/** Sector suggestions for the category datalist — vendor labels plus the
 * house buckets. Free text; these are conveniences, not an enum. */
export const CATEGORY_SUGGESTIONS = [
  'Semiconductors', 'BTC', 'Technology', 'Media', 'Retail', 'Automobiles', 'Energy',
  'Electrical Equipment', 'Aerospace', 'Preferred Income', 'Income ETF', 'Other',
];


/** 4 decimals normally; tiny quantities (satoshi-scale BTC) get 8 so
 * 0.00052 BTC never displays as 0.0005-rounded-to-nothing. */
export const fmtSh = (n: number) =>
  String(Number(n.toFixed(Math.abs(n) > 0 && Math.abs(n) < 0.01 ? 8 : 4)));
/** Reused by other sortable tables (Income) — the thead needs `group/head`
 * for the idle-arrow hover reveal. */
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
export function unlockSentence(s: UnlockSummary): string {
  if (s.totalShares <= 0) return 'No shares.';
  const parts: string[] = [];
  parts.push(`${fmtSh(s.unlockedShares)} of ${fmtSh(s.totalShares)} sh are long-term (funding unlocked)`);
  if (s.nextUnlock) parts.push(`next ${fmtSh(s.nextUnlock.shares)} sh unlock ${s.nextUnlock.date}`);
  if (s.unknownShares > 0) parts.push(`${fmtSh(s.unknownShares)} sh undated — add dates below`);
  return parts.join(' · ') + '.';
}

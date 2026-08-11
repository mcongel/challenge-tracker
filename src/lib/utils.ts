const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return usd.format(value);
}

const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Whole dollars — for hero numbers where cents are noise. */
export function formatCurrencyWhole(value: number): string {
  return usdWhole.format(value);
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Chart-axis money: $1.2M / $45k / $980. */
export const compactUsd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`;

/** Stored fraction → percent input string (0.238 → "23.8"); null/undefined → "". */
export const pctToInput = (v: number | null | undefined): string =>
  v == null ? '' : String(Math.round(v * 10000) / 100);

/** Percent input string → stored fraction; blank → null. */
export const inputToPct = (s: string): number | null => (s === '' ? null : Number(s) / 100);

/** The house error-to-message idiom, in one place. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Today's local calendar date as ISO yyyy-mm-dd. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Shared styling for the family look. Brand accent is SpokenFor's green
 * (green-600 #16a34a, hover green-700 #15803d — its exact button colors). */
export const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600';
export const labelCls = 'block text-xs font-medium text-gray-500 mb-1';
export const primaryBtnCls =
  'rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors';
export const secondaryBtnCls =
  'rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors';

import { cn } from '../../lib/utils';

/** The app's signature stat block (DESIGN.md): small gray label, bold
 * tabular number, optional context line. `tone` carries the house polarity
 * colors so the green/red ternary lives in one place. */
export function StatTile({
  label, value, sub, tone = 'neutral', className, title,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'pos' | 'neg' | 'neutral' | 'muted';
  className?: string;
  title?: string;
}) {
  return (
    <div className={cn('bg-white rounded-lg shadow-lg p-4 density-aware-card', className)} title={title}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-lg sm:text-xl font-bold tabular-nums',
          tone === 'pos' ? 'text-green-600'
          : tone === 'neg' ? 'text-red-600'
          : tone === 'muted' ? 'text-gray-700'
          : 'text-gray-900',
        )}
      >
        {value}
      </p>
      {sub != null && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/** The house polarity rule: zero counts as positive. */
export const toneOf = (n: number): 'pos' | 'neg' => (n >= 0 ? 'pos' : 'neg');

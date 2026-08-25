import { Layers } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Coverage } from '../../lib/useCoverage';
import { cn, formatPercent, money } from '../../lib/utils';

/** Which capital is actually producing income (owner question 2026-08-25).
 * The pile's market value split by what it produces: spendable income,
 * reinvesting, idle (no dividend, rotatable), and conviction holds (BTC /
 * never-trim — no dividend but held on purpose). The idle bucket names its
 * holdings, since that's the capital you'd consider rotating into income. */
export function CapitalAtWork({
  capital, afterTaxYieldOnCost,
}: {
  capital: Coverage['capital'];
  afterTaxYieldOnCost: number | null;
}) {
  const { spendableValue, reinvestValue, idleValue, convictionValue, totalValue, rotatable } = capital;
  if (totalValue <= 0) return null;
  const pct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);

  const segs = [
    {
      key: 'spend', label: 'Producing spendable', value: spendableValue,
      bar: 'bg-green-500', dot: 'bg-green-500',
      sub: afterTaxYieldOnCost != null ? `${formatPercent(afterTaxYieldOnCost)} yield on cost` : undefined,
    },
    { key: 'reinvest', label: 'Reinvesting', value: reinvestValue, bar: 'bg-sky-400', dot: 'bg-sky-400' },
    { key: 'idle', label: 'Idle (no income)', value: idleValue, bar: 'bg-amber-400', dot: 'bg-amber-400' },
    { key: 'conviction', label: 'Conviction', value: convictionValue, bar: 'bg-gray-300', dot: 'bg-gray-300' },
  ].filter((s) => s.value > 0);

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-gray-400" /> Capital at work
          <span className="ml-1 text-xs font-normal text-gray-400">what your invested value produces</span>
        </p>
        <p className="text-sm font-semibold tabular-nums text-text-primary">{money(totalValue)}</p>
      </div>

      {/* One stacked bar — the split at a glance. */}
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 my-3">
        {segs.map((s) => (
          <div key={s.key} className={s.bar} style={{ width: `${pct(s.value)}%` }} title={`${s.label}: ${money(s.value)}`} />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {segs.map((s) => (
          <div key={s.key}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1">
              <span className={cn('inline-block h-2 w-2 rounded-full flex-shrink-0', s.dot)} />
              <span className="truncate">{s.label}</span>
            </p>
            <p className="mt-0.5 text-base sm:text-lg font-bold tabular-nums text-text-primary">{money(s.value)}</p>
            <p className="text-[11px] text-gray-400 tabular-nums">
              {Math.round(pct(s.value))}%{s.sub ? ` · ${s.sub}` : ''}
            </p>
          </div>
        ))}
      </div>

      {rotatable.length > 0 && (
        <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
          <span className="text-gray-500">Idle capital:</span>{' '}
          {rotatable.slice(0, 6).map((n) => `${n.ticker} ${money(n.value)}`).join(' · ')}
          {rotatable.length > 6 && ` · +${rotatable.length - 6} more`}
          {' '}— no dividend, and not a conviction hold: the capital you could rotate into income.
        </p>
      )}
    </Card>
  );
}

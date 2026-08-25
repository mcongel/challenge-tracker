import { Layers } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Coverage } from '../../lib/useCoverage';
import { cn, formatPercent, money } from '../../lib/utils';

/** Which capital is actually producing income (owner question 2026-08-25).
 * The pile's market value split three ways: producing spendable income,
 * reinvesting, and producing nothing — with the non-producers named, since
 * that's the capital you'd consider rotating into income. */
export function CapitalAtWork({
  capital, afterTaxYieldOnCost,
}: {
  capital: Coverage['capital'];
  afterTaxYieldOnCost: number | null;
}) {
  const { spendableValue, reinvestValue, nonProducingValue, totalValue, nonProducers } = capital;
  if (totalValue <= 0) return null;
  const pct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);

  const segs = [
    { label: 'Producing spendable', value: spendableValue, cls: 'bg-green-500', text: 'text-green-700' },
    { label: 'Reinvesting', value: reinvestValue, cls: 'bg-sky-400', text: 'text-sky-700' },
    { label: 'No income', value: nonProducingValue, cls: 'bg-gray-300', text: 'text-gray-500' },
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
          <div key={s.label} className={s.cls} style={{ width: `${pct(s.value)}%` }} title={`${s.label}: ${money(s.value)}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Producing spendable" value={money(spendableValue)} pct={pct(spendableValue)} dot="bg-green-500"
          sub={afterTaxYieldOnCost != null ? `${formatPercent(afterTaxYieldOnCost)} yield on cost` : undefined} />
        <Metric label="Reinvesting" value={money(reinvestValue)} pct={pct(reinvestValue)} dot="bg-sky-400" />
        <Metric label="No income" value={money(nonProducingValue)} pct={pct(nonProducingValue)} dot="bg-gray-300" />
      </div>

      {nonProducers.length > 0 && (
        <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
          <span className="text-gray-500">Producing no income:</span>{' '}
          {nonProducers.slice(0, 6).map((n) => `${n.ticker} ${money(n.value)}`).join(' · ')}
          {nonProducers.length > 6 && ` · +${nonProducers.length - 6} more`}
          {' '}— the capital you could rotate into income.
        </p>
      )}
    </Card>
  );
}

function Metric({ label, value, pct, dot, sub }: {
  label: string; value: string; pct: number; dot: string; sub?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1">
        <span className={cn('inline-block h-2 w-2 rounded-full flex-shrink-0', dot)} />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 text-base sm:text-lg font-bold tabular-nums text-text-primary">{value}</p>
      <p className="text-[11px] text-gray-400 tabular-nums">
        {Math.round(pct)}%{sub ? ` · ${sub}` : ''}
      </p>
    </div>
  );
}

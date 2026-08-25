import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Coverage } from '../../lib/useCoverage';
import { cn, formatPercent, money } from '../../lib/utils';

type BucketKey = 'spend' | 'reinvest' | 'idle' | 'conviction';

const BLURB: Record<BucketKey, string> = {
  spend: 'Dividend holdings you spend — the income that pays your bills.',
  reinvest: 'Dividend holdings set to reinvest (DRIP) — compounding, not spent.',
  idle: 'No dividend and not a conviction hold — the capital you could rotate into income.',
  conviction: 'No-dividend names held on purpose (never-trim NVDA/TSLA) — not for rotation.',
};

/** Which capital is actually producing income (owner question 2026-08-25).
 * The pile's market value split by what it produces: spendable income,
 * reinvesting, idle (no dividend, rotatable), and conviction holds (never-trim
 * names — no dividend but held on purpose). The BTC pot is walled off upstream,
 * so it never appears here. Each bucket is clickable to reveal its holdings. */
export function CapitalAtWork({
  capital, afterTaxYieldOnCost,
}: {
  capital: Coverage['capital'];
  afterTaxYieldOnCost: number | null;
}) {
  const {
    spendableValue, reinvestValue, idleValue, convictionValue, totalValue, holdings,
  } = capital;
  const [open, setOpen] = useState<BucketKey | null>(null);
  if (totalValue <= 0) return null;
  const pct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);

  const segs = [
    {
      key: 'spend' as const, label: 'Producing spendable', value: spendableValue,
      bar: 'bg-green-500', dot: 'bg-green-500',
      sub: afterTaxYieldOnCost != null ? `${formatPercent(afterTaxYieldOnCost)} yield on cost` : undefined,
    },
    { key: 'reinvest' as const, label: 'Reinvesting', value: reinvestValue, bar: 'bg-sky-400', dot: 'bg-sky-400' },
    { key: 'idle' as const, label: 'Idle (no income)', value: idleValue, bar: 'bg-amber-400', dot: 'bg-amber-400' },
    { key: 'conviction' as const, label: 'Conviction', value: convictionValue, bar: 'bg-gray-300', dot: 'bg-gray-300' },
  ].filter((s) => s.value > 0);

  const sel = open ? segs.find((s) => s.key === open) : undefined;
  const rows = sel ? holdings[sel.key] : [];

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-gray-400" /> Capital at work
          <span className="ml-1 text-xs font-normal text-gray-400">tap a bucket for the holdings behind it</span>
        </p>
        <p className="text-sm font-semibold tabular-nums text-text-primary">{money(totalValue)}</p>
      </div>

      {/* One stacked bar — the split at a glance; each segment selects its bucket. */}
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 my-3">
        {segs.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setOpen(open === s.key ? null : s.key)}
            className={cn(s.bar, 'transition-opacity hover:opacity-80', open && open !== s.key && 'opacity-40')}
            style={{ width: `${pct(s.value)}%` }}
            title={`${s.label}: ${money(s.value)}`}
            aria-label={`${s.label}: ${money(s.value)}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {segs.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setOpen(open === s.key ? null : s.key)}
            className={cn(
              'text-left rounded-lg -mx-1.5 px-1.5 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-white/5',
              open === s.key && 'bg-gray-50 dark:bg-white/5 ring-1 ring-border-base',
            )}
            aria-expanded={open === s.key}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1">
              <span className={cn('inline-block h-2 w-2 rounded-full flex-shrink-0', s.dot)} />
              <span className="truncate">{s.label}</span>
            </p>
            <p className="mt-0.5 text-base sm:text-lg font-bold tabular-nums text-text-primary">{money(s.value)}</p>
            <p className="text-[11px] text-gray-400 tabular-nums">
              {Math.round(pct(s.value))}%{s.sub ? ` · ${s.sub}` : ''}
            </p>
          </button>
        ))}
      </div>

      {sel && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              <span className={cn('inline-block h-2 w-2 rounded-full flex-shrink-0', sel.dot)} />
              {sel.label}
            </p>
            <p className="text-sm font-semibold tabular-nums text-text-primary">
              {money(sel.value)} <span className="text-xs font-normal text-gray-400">· {rows.length} holding{rows.length === 1 ? '' : 's'}</span>
            </p>
          </div>
          <p className="text-xs text-gray-400 mb-2">{BLURB[sel.key]}</p>
          {rows.length === 0 ? (
            <p className="text-xs text-gray-400">No holdings in this bucket.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {rows.map((h) => (
                <div key={h.ticker} className="flex items-baseline justify-between gap-2 py-1 text-sm">
                  <span className="font-medium text-text-secondary">{h.ticker}</span>
                  <span className="flex items-baseline gap-2 tabular-nums">
                    {h.income != null && h.income > 0 && (
                      <span className="text-xs text-gray-400">{money(h.income)}/yr</span>
                    )}
                    <span className="text-gray-400 text-xs">{Math.round(sel.value > 0 ? (h.value / sel.value) * 100 : 0)}%</span>
                    <span className="font-semibold text-text-primary w-24 text-right">{money(h.value)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

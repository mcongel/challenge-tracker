import { useState } from 'react';
import { Archive, ChevronDown } from 'lucide-react';
import { Card } from '../ui/Card';
import { LotPanel } from './LotPanel';
import type { ParkedLot, ParkedPosition, PositionTotalReturn } from '../../lib/engine';
import { unlockSummary } from '../../lib/engine';
import { cn, formatPercent, money, signedMoney, todayISO } from '../../lib/utils';

/** Fully-sold (archived) pile positions: their final performance — realized
 * result + income, ROC counted once — and a way back in. A sold position
 * drops out of the live pile table, which used to mean no way to log a
 * post-sale dividend (a payout whose ex-date preceded the sale still pays
 * after) or review how the trade actually did. Expand one for its lot panel. */
export function ClosedPositions({ positions, returns, lotsByPosition, tickerNames }: {
  positions: ParkedPosition[];
  returns: Map<string, PositionTotalReturn>;
  lotsByPosition: Map<string, ParkedLot[]>;
  tickerNames: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const today = todayISO();
  if (positions.length === 0) return null;

  const sorted = [...positions].sort(
    (a, b) => (returns.get(b.id)?.total ?? 0) - (returns.get(a.id)?.total ?? 0),
  );
  let total = 0;
  let invested = 0;
  for (const p of positions) {
    const r = returns.get(p.id);
    if (r) { total += r.total; invested += r.invested; }
  }
  const pct = invested > 0 ? total / invested : null;

  return (
    <Card className="mb-4">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Archive className="h-4 w-4 text-gray-400" />
          Closed positions
          <span className="text-xs font-normal text-gray-400">{positions.length} sold — final performance</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold tabular-nums', total >= 0 ? 'text-green-600' : 'text-red-600')}>
            {signedMoney(total)}{pct != null && ` (${formatPercent(pct)})`}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {sorted.map((p) => {
            const r = returns.get(p.id);
            const summ = unlockSummary(lotsByPosition.get(p.id) ?? [], today);
            const expanded = expandedId === p.id;
            return (
              <div key={p.id}>
                <button type="button" onClick={() => setExpandedId(expanded ? null : p.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="font-medium text-text-primary">{p.ticker}</span>
                    <span className="ml-1.5 text-xs text-gray-400">{p.account}</span>
                    {tickerNames[p.ticker] && (
                      <span className="block text-xs text-gray-400 truncate">{tickerNames[p.ticker]}</span>
                    )}
                  </span>
                  {r && (
                    <span className="flex-shrink-0 text-right">
                      <span className={cn('block text-sm font-semibold tabular-nums', r.total >= 0 ? 'text-green-600' : 'text-red-600')}>
                        {signedMoney(r.total)}{r.pct != null && ` (${formatPercent(r.pct)})`}
                      </span>
                      <span className="block text-[11px] text-gray-400 tabular-nums">
                        realized {money(r.realized)} · income {money(r.income)}
                      </span>
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="bg-gray-50 px-4 py-3">
                    <p className="mb-2 text-xs text-gray-400">
                      Sold out. Record a post-sale dividend here (cash — leave “Reinvested” off so it
                      stays closed), or review the lot history.
                    </p>
                    <LotPanel position={p} summary={summ} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

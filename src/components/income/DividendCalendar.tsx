import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '../ui/Card';
import type { ParkedPosition, PositionIncomeSummary } from '../../lib/engine';
import { money } from '../../lib/utils';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;

interface Entry {
  position: ParkedPosition;
  summary: PositionIncomeSummary;
}

/** The forward dividend calendar (Snowball's headline income feature), built
 * entirely from the projections the income engine already computes — no
 * external data. Each of the next 12 months lists which holdings pay and how
 * much, so "when does income actually land" is answerable at a glance.
 * Amounts are gross projections; the Projection table carries after-tax. */
export function DividendCalendar({ entries }: { entries: Entry[] }) {
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const months = useMemo(() => {
    // month key -> paying holdings, from each position's projected buckets.
    const byMonth = new Map<string, { ticker: string; amount: number }[]>();
    for (const { position, summary } of entries) {
      for (const pt of summary.projection?.monthly ?? []) {
        if (pt.amount <= 0) continue;
        const list = byMonth.get(pt.month) ?? [];
        list.push({ ticker: position.ticker, amount: pt.amount });
        byMonth.set(pt.month, list);
      }
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, payers]) => ({
        month,
        payers: payers.sort((a, b) => b.amount - a.amount),
        total: payers.reduce((t, p) => t + p.amount, 0),
      }));
  }, [entries]);

  if (months.length === 0) return null;
  const peak = Math.max(...months.map((m) => m.total));

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        Dividend calendar
        <span className="ml-1 text-xs font-normal text-gray-400">
          projected gross payouts, next 12 months — tap a month for the holdings
        </span>
      </p>
      <div className="mt-2 divide-y divide-gray-100">
        {months.map((m) => {
          const open = openMonth === m.month;
          return (
            <div key={m.month}>
              <button
                onClick={() => setOpenMonth(open ? null : m.month)}
                className="flex w-full items-center gap-3 py-2 text-left"
              >
                {open ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />}
                <span className="w-16 flex-shrink-0 text-sm font-medium text-text-primary">
                  {monthLabel(m.month)}
                </span>
                {/* Bar makes the seasonal lumpiness of income visible at a glance. */}
                <span className="hidden sm:block flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <span className="block h-full bg-green-500/70"
                    style={{ width: `${peak > 0 ? (m.total / peak) * 100 : 0}%` }} />
                </span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-text-primary">
                  {money(m.total)}
                </span>
                <span className="w-14 flex-shrink-0 text-right text-xs text-gray-400">
                  {m.payers.length} pay{m.payers.length === 1 ? '' : 's'}
                </span>
              </button>
              {open && (
                <ul className="pb-2 pl-9 pr-1 space-y-1">
                  {m.payers.map((p) => (
                    <li key={p.ticker} className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-text-secondary">{p.ticker}</span>
                      <span className="tabular-nums text-text-secondary">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

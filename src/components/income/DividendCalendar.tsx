import { useMemo, useState } from 'react';
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../ui/Card';
import type { ParkedPosition, PositionIncomeSummary } from '../../lib/engine';
import { compactUsd, money } from '../../lib/utils';
import { useChartColors } from '../../lib/useIsDark';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;
const monthLong = (m: string) =>
  `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

interface Entry {
  position: ParkedPosition;
  summary: PositionIncomeSummary;
}

/** Forward dividend calendar — Snowball's signature view: the SHAPE of the
 * year in one bar chart (which months are fat, which are lean), a summary
 * strip, and a click-to-drill month detail. Built from the projection
 * buckets the income engine already computes; no external data. */
export function DividendCalendar({ entries }: { entries: Entry[] }) {
  const { gridColor, axisColor, isDark } = useChartColors();

  const months = useMemo(() => {
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
        label: monthLabel(month),
        payers: payers.sort((a, b) => b.amount - a.amount),
        total: payers.reduce((t, p) => t + p.amount, 0),
      }));
  }, [entries]);

  // Soonest dated payout across holdings — the "what's next" line.
  const nextPayout = useMemo(() => {
    let best: { ticker: string; date: string; amount: number } | null = null;
    for (const { position, summary } of entries) {
      const np = summary.projection?.nextPayment;
      if (np && (!best || np.date < best.date)) {
        best = { ticker: position.ticker, date: np.date, amount: np.amount };
      }
    }
    return best;
  }, [entries]);

  // Default the drill-down to the first upcoming month.
  const [selected, setSelected] = useState<string | null>(null);
  const selectedMonth = months.find((m) => m.month === selected) ?? months[0];
  const selectedIdx = selectedMonth ? months.indexOf(selectedMonth) : -1;

  if (months.length === 0) return null;

  const annual = months.reduce((t, m) => t + m.total, 0);
  const avg = annual / months.length;
  const peak = months.reduce((a, b) => (b.total > a.total ? b : a));
  const green = isDark ? '#22c55e' : '#16a34a';
  const dimGreen = isDark ? 'rgba(34,197,94,0.35)' : 'rgba(22,163,74,0.30)';

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        Dividend calendar
        <span className="ml-1 text-xs font-normal text-gray-400">
          projected gross income, next 12 months
        </span>
      </p>

      {/* Summary strip — the numbers Snowball leads with. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Metric label="Projected 12-mth" value={money(annual)} />
        <Metric label="Avg / month" value={money(avg)} />
        <Metric label="Peak month" value={money(peak.total)} sub={monthLabel(peak.month)} />
        <Metric
          label="Next payout"
          value={nextPayout ? money(nextPayout.amount) : '—'}
          sub={nextPayout ? `${nextPayout.ticker} · ${nextPayout.date}` : 'nothing scheduled'}
        />
      </div>

      {/* The shape of the year. Click a bar to drill into that month. */}
      <div className="h-44 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={months} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
            onClick={(st) => { const m = st?.activeLabel; if (m) setSelected(months.find((x) => x.label === m)?.month ?? null); }}>
            <XAxis dataKey="label" stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} interval={0} />
            <YAxis stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={44} />
            <Tooltip
              cursor={{ fill: gridColor, opacity: 0.4 }}
              contentStyle={{ fontSize: 12 }}
              formatter={(v) => [money(Number(v)), 'Projected']}
              labelFormatter={(l) => {
                const m = months.find((x) => x.label === l);
                return m ? `${monthLong(m.month)} · ${m.payers.length} payer${m.payers.length === 1 ? '' : 's'}` : l;
              }}
            />
            <Bar dataKey="total" radius={[3, 3, 0, 0]} cursor="pointer">
              {months.map((m) => (
                <Cell key={m.month} fill={m.month === selectedMonth?.month ? green : dimGreen} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Selected-month detail, keyboard-navigable via the arrows. */}
      {selectedMonth && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => selectedIdx > 0 && setSelected(months[selectedIdx - 1].month)}
                disabled={selectedIdx <= 0}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4 text-gray-500" />
              </button>
              <span className="text-sm font-semibold text-text-primary w-28 text-center">
                {monthLong(selectedMonth.month)}
              </span>
              <button
                onClick={() => selectedIdx < months.length - 1 && setSelected(months[selectedIdx + 1].month)}
                disabled={selectedIdx >= months.length - 1}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <span className="text-sm font-semibold tabular-nums text-text-primary">
              {money(selectedMonth.total)}
            </span>
          </div>
          <ul className="space-y-1.5">
            {selectedMonth.payers.map((p) => (
              <li key={p.ticker} className="flex items-center gap-2 text-xs">
                <span className="w-14 flex-shrink-0 font-medium text-text-secondary">{p.ticker}</span>
                <span className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <span className="block h-full rounded-full"
                    style={{
                      width: `${(p.amount / selectedMonth.payers[0].amount) * 100}%`,
                      backgroundColor: green,
                      opacity: 0.7,
                    }} />
                </span>
                <span className="w-20 flex-shrink-0 text-right tabular-nums text-text-secondary">
                  {money(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-base sm:text-lg font-bold tabular-nums text-text-primary">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '../ui/Card';
import type { Expense } from '../../lib/engine';
import { expensesByMonth, monthlyCoverage } from '../../lib/engine';
import { cn, compactUsd, money } from '../../lib/utils';
import { useChartColors } from '../../lib/useIsDark';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;
const monthLong = (m: string) =>
  `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Month-accurate coverage over the year: spendable income bars vs a bills
 * line that lands each expense in its REAL month (annual insurance in March,
 * not smeared). Green months clear the line; red months run short. Click a
 * month to drill into the paying holdings and the bills due — the single
 * rich income-vs-bills view (folds in the calendar's drill-down). */
export function MonthlyCoverageChart({
  incomeByMonth, payersByMonth, expenses,
}: {
  incomeByMonth: Map<string, number>;
  /** Spendable holdings paying each month, for the drill-down. */
  payersByMonth?: Map<string, { ticker: string; amount: number }[]>;
  expenses: Expense[];
}) {
  const { gridColor, axisColor, isDark } = useChartColors();
  const [selected, setSelected] = useState<string | null>(null);

  const months = useMemo(() => [...incomeByMonth.keys()].sort(), [incomeByMonth]);
  const data = useMemo(() => {
    if (months.length === 0) return [];
    return monthlyCoverage(incomeByMonth, expenses, months).map((c) => ({
      ...c, label: monthLabel(c.month), short: c.net < -0.005,
    }));
  }, [incomeByMonth, expenses, months]);
  const billsByMonth = useMemo(() => expensesByMonth(expenses, months), [expenses, months]);

  const activeRecurring = expenses.some((e) => e.active && e.cadence !== 'once');
  if (data.length === 0 || !activeRecurring) return null;

  const shortMonths = data.filter((d) => d.short).length;
  const green = isDark ? '#22c55e' : '#16a34a';
  const dimGreen = isDark ? 'rgba(34,197,94,0.35)' : 'rgba(22,163,74,0.30)';
  const red = isDark ? '#f87171' : '#dc2626';
  const sel = data.find((d) => d.month === selected);
  const dueThatMonth = sel
    ? expenses.filter((e) => e.active && billsMonthMatch(e, sel.month, months)).sort((a, b) => b.amount - a.amount)
    : [];

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">
        Monthly coverage
        <span className="ml-2 text-xs font-normal text-gray-400">
          spendable income vs bills, each in its actual month — tap a month for detail
        </span>
      </p>
      <p className="mb-3 text-xs text-gray-400">
        {shortMonths === 0
          ? 'Income clears your bills every month in the next year.'
          : `${shortMonths} of ${data.length} months fall short — the red bars are when you'd dip into principal.`}
      </p>
      <div className="h-48 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
            onClick={(st) => { const l = st?.activeLabel; if (l) setSelected(data.find((x) => x.label === l)?.month ?? null); }}>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} interval={0} />
            <YAxis stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={44} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v, name) => [money(Number(v)), name === 'income' ? 'Spendable income' : 'Bills']}
              labelFormatter={(l) => {
                const d = data.find((x) => x.label === l);
                return d ? `${l} · ${d.net >= 0 ? `+${money(d.net)} surplus` : `${money(d.net)} short`}` : l;
              }}
            />
            <Bar dataKey="income" radius={[3, 3, 0, 0]} cursor="pointer">
              {data.map((d) => (
                <Cell key={d.month} fill={d.short ? red : d.net > 0.005 ? green : dimGreen}
                  stroke={d.month === selected ? axisColor : undefined} strokeWidth={d.month === selected ? 1.5 : 0} />
              ))}
            </Bar>
            <Line dataKey="expenses" stroke={axisColor} strokeWidth={2} strokeDasharray="4 3"
              dot={false} type="stepAfter" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {sel && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-text-primary">{monthLong(sel.month)}</span>
            <span className={cn('text-sm font-semibold tabular-nums',
              sel.net >= 0 ? 'text-green-600' : 'text-red-600')}>
              {sel.net >= 0 ? `+${money(sel.net)} surplus` : `${money(sel.net)} short`}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">
                Income {money(sel.income)}
              </p>
              {(payersByMonth?.get(sel.month) ?? []).map((p) => (
                <p key={p.ticker} className="flex justify-between text-xs text-text-secondary">
                  <span className="font-medium">{p.ticker}</span><span className="tabular-nums">{money(p.amount)}</span>
                </p>
              ))}
              {(payersByMonth?.get(sel.month) ?? []).length === 0 && (
                <p className="text-xs text-gray-400">No spendable payouts this month.</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">
                Bills {money(billsByMonth.get(sel.month) ?? 0)}
              </p>
              {dueThatMonth.map((e) => (
                <p key={e.id} className="flex justify-between text-xs text-text-secondary">
                  <span>{e.name}</span>
                  <span className="tabular-nums">{money(e.cadence === 'monthly' ? e.amount : e.amount)}</span>
                </p>
              ))}
              {dueThatMonth.length === 0 && <p className="text-xs text-gray-400">No bills due this month.</p>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Does this expense land in `month`? Mirrors expensesByMonth's placement. */
function billsMonthMatch(e: Expense, month: string, monthKeys: string[]): boolean {
  if (e.cadence === 'monthly') return true;
  if (e.cadence === 'once') return e.dueDate?.slice(0, 7) === month;
  // annual
  if (e.dueDate) return e.dueDate.slice(5, 7) === month.slice(5, 7);
  return monthKeys.includes(month); // spread-evenly fallback lands in all
}

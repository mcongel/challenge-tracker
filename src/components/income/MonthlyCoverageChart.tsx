import { useMemo } from 'react';
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '../ui/Card';
import type { Expense } from '../../lib/engine';
import { monthlyCoverage } from '../../lib/engine';
import { compactUsd, money } from '../../lib/utils';
import { useChartColors } from '../../lib/useIsDark';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} '${m.slice(2, 4)}`;

/** Month-accurate coverage over the year (Phase 2): spendable income bars vs
 * a bills line that lands each expense in its REAL month (annual insurance in
 * March, not smeared). Green months clear the line; red months run short —
 * the seasonal-lumpiness answer to "when do I dip into principal". */
export function MonthlyCoverageChart({
  incomeByMonth, expenses,
}: {
  incomeByMonth: Map<string, number>;
  expenses: Expense[];
}) {
  const { gridColor, axisColor, isDark } = useChartColors();

  const data = useMemo(() => {
    const months = [...incomeByMonth.keys()].sort();
    if (months.length === 0) return [];
    return monthlyCoverage(incomeByMonth, expenses, months).map((c) => ({
      ...c, label: monthLabel(c.month), short: c.net < -0.005,
    }));
  }, [incomeByMonth, expenses]);

  const activeRecurring = expenses.some((e) => e.active && e.cadence !== 'once');
  if (data.length === 0 || !activeRecurring) return null;

  const shortMonths = data.filter((d) => d.short).length;
  const green = isDark ? '#22c55e' : '#16a34a';
  const dimGreen = isDark ? 'rgba(34,197,94,0.35)' : 'rgba(22,163,74,0.30)';
  const red = isDark ? '#f87171' : '#dc2626';

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">
        Monthly coverage
        <span className="ml-2 text-xs font-normal text-gray-400">
          spendable income vs bills, each in its actual month
        </span>
      </p>
      <p className="mb-3 text-xs text-gray-400">
        {shortMonths === 0
          ? 'Income clears your bills every month in the next year.'
          : `${shortMonths} of ${data.length} months fall short — the red bars are when you'd dip into principal.`}
      </p>
      <div className="h-48 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
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
            <Bar dataKey="income" radius={[3, 3, 0, 0]}>
              {data.map((d) => <Cell key={d.month} fill={d.short ? red : d.net > 0.005 ? green : dimGreen} />)}
            </Bar>
            <Line dataKey="expenses" stroke={axisColor} strokeWidth={2} strokeDasharray="4 3"
              dot={false} type="stepAfter" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

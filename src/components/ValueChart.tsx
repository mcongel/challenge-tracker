import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useChartColors } from '../lib/useIsDark';
import { compactUsd, formatCurrency } from '../lib/utils';

/** The house value-over-time chart — one green line, VALUE not return.
 * Handles multi-year spans: past ~14 months the axis labels by month. */
export function ValueChart({ title, note, data }: {
  title: string;
  note: string;
  data: { date: string; value: number }[];
}) {
  const { isDark, gridColor, axisColor } = useChartColors();
  const green = isDark ? '#22c55e' : '#16a34a';
  const longSpan =
    data.length > 0 && data[data.length - 1].date.slice(0, 7) > addMonthsIso(data[0].date, 14);
  const rows = data.map((d) => ({ date: d.date, Value: d.value }));
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">
        {title}
        <span className="ml-2 text-xs font-normal text-gray-400">{note}</span>
      </p>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} minTickGap={40}
              tickFormatter={(d: string) => (longSpan ? d.slice(0, 7) : d.slice(5))} />
            <YAxis stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} domain={['auto', 'auto']} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Area type="monotone" dataKey="Value" stroke={green} strokeWidth={2}
              fill={green} fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** ISO yyyy-mm of `date` plus n months — cheap span check, no Date math. */
function addMonthsIso(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
}

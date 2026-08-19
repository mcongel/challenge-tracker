import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Snapshot } from '../../lib/engine';
import { roundCents } from '../../lib/engine';
import { useChartColors } from '../../lib/useIsDark';
import { compactUsd, formatCurrency } from '../../lib/utils';

/** Pile value from the daily snapshots — house chart contract (green area,
 * CVD-validated palette). VALUE, not a return series: new money moves it. */
export function PileValueChart({ snapshots }: { snapshots: Snapshot[] }) {
  const { isDark, gridColor, axisColor } = useChartColors();
  const green = isDark ? '#22c55e' : '#16a34a';
  const data = snapshots.map((s) => ({
    date: s.date.slice(5),
    Value: roundCents(s.parkedPileValue),
  }));
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">
        Pile value over time
        <span className="ml-2 text-xs font-normal text-gray-400">
          value, not return — new money moves this line too
        </span>
      </p>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
              tick={{ fontSize: 11 }} minTickGap={32} />
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

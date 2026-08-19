import { useMemo } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ScenarioProjection } from '../../lib/engine';
import { compactUsd, formatCurrency } from '../../lib/utils';
import { useChartColors } from '../../lib/useIsDark';

export function CompareChart({
  a, b, target,
}: {
  a: { name: string; projection: ScenarioProjection };
  b: { name: string; projection: ScenarioProjection };
  target: number | null;
}) {
  const { isDark, gridColor, axisColor } = useChartColors();
  const data = useMemo(() => {
    const years = new Map<number, { year: string; a?: number; b?: number }>();
    for (const y of a.projection.years) years.set(y.year, { year: String(y.year), a: y.afterTaxIncome });
    for (const y of b.projection.years) {
      const row = years.get(y.year) ?? { year: String(y.year) };
      row.b = y.afterTaxIncome;
      years.set(y.year, row);
    }
    return [...years.values()].sort((x, y) => x.year.localeCompare(y.year));
  }, [a.projection, b.projection]);

  return (
    <div className="h-44 mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
        After-tax totals — {a.name} vs {b.name}
      </p>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: axisColor }} />
          <YAxis tickFormatter={compactUsd} width={52} tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: axisColor }} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="a" name={a.name} stroke="#16a34a" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="b" name={b.name} stroke={isDark ? '#6366f1' : '#4f46e5'} strokeWidth={2} dot={false} />
          {target != null && <ReferenceLine y={target} stroke={axisColor} strokeDasharray="4 4" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useMemo } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ScenarioProjection } from '../../lib/engine';
import { compactUsd, formatCurrency } from '../../lib/utils';
import { useChartColors } from '../../lib/useIsDark';

/** House palette only: existing holdings in green tints, rotation buys in
 * indigo tints — the established actual/projected semantic, no new hues. */
const GREENS = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0'];
const INDIGOS = ['#4f46e5', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe'];

export function ProjectionChart({ projection, target }: { projection: ScenarioProjection; target: number | null }) {
  const { gridColor, axisColor } = useChartColors();

  const { data, posKeys, buyKeys } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const y of projection.years) {
      for (const [k, v] of Object.entries(y.byHoldingAfterTax)) {
        totals.set(k, (totals.get(k) ?? 0) + v);
      }
    }
    const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return {
      data: projection.years.map((y) => ({ year: String(y.year), ...y.byHoldingAfterTax })),
      posKeys: keys.filter((k) => k.startsWith('pos:')),
      buyKeys: keys.filter((k) => k.startsWith('buy:')),
    };
  }, [projection]);

  if (posKeys.length === 0 && buyKeys.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-6 text-center">
        Nothing projects yet — holdings need income history or manual rates, or add a rotation.
      </p>
    );
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: axisColor }} />
          <YAxis tickFormatter={compactUsd} width={52} tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: axisColor }} />
          <Tooltip
            formatter={(v, name) => [
              formatCurrency(Number(v)),
              projection.holdingLabels[String(name)] ?? String(name),
            ]}
          />
          {posKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="income" fill={GREENS[i % GREENS.length]}
              name={k} legendType="none" />
          ))}
          {buyKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="income" fill={INDIGOS[i % INDIGOS.length]}
              name={k} legendType="none" />
          ))}
          {target != null && (
            <ReferenceLine y={target} stroke={axisColor} strokeDasharray="4 4"
              label={{ value: 'target', fontSize: 10, fill: axisColor, position: 'insideTopRight' }} />
          )}
          {projection.targetReachedYear != null && (
            <ReferenceLine x={String(projection.targetReachedYear)} stroke="#16a34a" strokeDasharray="4 4" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {projection.targetReachedYear != null && (
        <p className="text-xs text-green-700 mt-1">
          Target reached {projection.targetReachedYear} — after-tax. Green bars = today's holdings,
          indigo = rotation buys.
        </p>
      )}
    </div>
  );
}

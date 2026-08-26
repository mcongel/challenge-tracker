import {
  Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { Card } from '../ui/Card';
import type { PositionTotalReturn } from '../../lib/engine';
import { useChartColors } from '../../lib/useIsDark';
import { cn, compactUsd, formatPercent, money, signedMoney } from '../../lib/utils';

/** Total return of the income holdings — price and income in one place
 * (owner question 2026-08-25). The headline is the vetted point-in-time
 * decomposition (unrealized + income + realized, ROC counted once); the chart
 * trends the two legs the way Sharesight does — market VALUE on the left axis
 * (how price moved), cumulative INCOME received on the right (what they paid
 * out) — kept as separate series, never summed, so nothing double-counts. */
export function TotalReturnCard({ agg, data }: {
  agg: PositionTotalReturn;
  /** value + cumulative-income per date; null while price history loads. */
  data: { date: string; value: number; income: number }[] | null;
}) {
  const { isDark, gridColor, axisColor } = useChartColors();
  const green = isDark ? '#22c55e' : '#16a34a';
  const sky = isDark ? '#38bdf8' : '#0284c7';
  const up = agg.total >= 0;

  const longSpan =
    data && data.length > 1 &&
    data[data.length - 1].date.slice(0, 7) > addMonthsIso(data[0].date, 14);

  return (
    <Card className="p-4 sm:p-6 mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-gray-400" /> Total return
          <span className="ml-1 text-xs font-normal text-gray-400">price change + income, on your income holdings</span>
        </p>
        <p className={cn('text-xl font-bold tabular-nums', up ? 'text-green-600' : 'text-red-600')}>
          {signedMoney(agg.total)}
          {agg.pct != null && <span className="ml-1 text-sm font-semibold">({formatPercent(agg.pct)})</span>}
        </p>
      </div>

      {/* The three legs of the vetted total, each on its own footing. */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Leg label="Price (unrealized)" value={agg.unrealized} dot="bg-green-500" />
        <Leg label="Income (dividends)" value={agg.income} dot="bg-sky-500" alwaysPositive />
        <Leg label="Realized (sales)" value={agg.realized} dot="bg-gray-400" />
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        On {money(agg.invested)} invested{agg.unknownBasisSales > 0
          && ` · ${agg.unknownBasisSales} unknown-basis sale${agg.unknownBasisSales > 1 ? 's' : ''} excluded`}.
        Simple return, not annualized.
      </p>

      {data && data.length >= 2 ? (
        <>
          <div className="h-44 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={40}
                  tickFormatter={(d: string) => (longSpan ? d.slice(0, 7) : d.slice(5))} />
                <YAxis yAxisId="value" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={48} domain={['auto', 'auto']} />
                <YAxis yAxisId="income" orientation="right" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={48} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={(d) => String(d)}
                  formatter={(v, name) => [money(Number(v)), name === 'value' ? 'Value' : 'Income received']}
                />
                <Area yAxisId="value" type="monotone" dataKey="value" name="value"
                  stroke={green} strokeWidth={2} fill={green} fillOpacity={0.12} />
                <Line yAxisId="income" type="monotone" dataKey="income" name="income"
                  stroke={sky} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: green }} /> Market value (left)</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: sky }} /> Cumulative income received (right)</span>
            <span>— reconstructed from your lots × real closes and logged dividends.</span>
          </p>
        </>
      ) : (
        <p className="text-xs text-gray-400 py-4 text-center">
          Price history loads here once the market data answers — the headline above is live regardless.
        </p>
      )}
    </Card>
  );
}

function Leg({ label, value, dot, alwaysPositive }: {
  label: string; value: number; dot: string; alwaysPositive?: boolean;
}) {
  const tone = alwaysPositive || value >= 0 ? 'text-green-600' : 'text-red-600';
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1">
        <span className={cn('inline-block h-2 w-2 rounded-full flex-shrink-0', dot)} />
        <span className="truncate">{label}</span>
      </p>
      <p className={cn('mt-0.5 text-base font-bold tabular-nums', tone)}>{signedMoney(value)}</p>
    </div>
  );
}

/** ISO yyyy-mm of `date` plus n months — cheap span check, no Date math. */
function addMonthsIso(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
}

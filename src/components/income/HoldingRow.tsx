import { Pencil } from 'lucide-react';
import type { DividendInsight, ParkedPosition, PositionIncomeSummary } from '../../lib/engine';
import { isArchivedPosition } from '../../lib/engine';
import { cn, formatPercent, money } from '../../lib/utils';
import { DividendInsightChips } from './DividendInsightChips';

export function HoldingRow({
  position: p, summary: s, anyRoc, insight, onEditRate,
}: {
  position: ParkedPosition;
  summary: PositionIncomeSummary;
  anyRoc: boolean;
  insight?: DividendInsight | null;
  onEditRate: () => void;
}) {
  const proj = s.projection;
  const archived = isArchivedPosition(p);
  return (
    <tr className={cn('hover:bg-gray-50', archived && 'text-gray-400')}>
      <td className="px-4 py-2 font-medium text-gray-900">
        {p.ticker}
        <span className="ml-1 text-xs text-gray-400">{p.account}</span>
        {archived && (
          <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500"
            title="Fully trimmed or transferred away — history kept, nothing projected.">
            closed
          </span>
        )}
        {s.hasUnclassified && (
          <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
            title="Some dividends are unclassified — estimates assume the qualified rate.">
            unclassified
          </span>
        )}
        {!archived && <DividendInsightChips insight={insight} />}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {s.yieldOnCost != null ? formatPercent(s.yieldOnCost) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {s.trailing12m > 0 ? money(s.trailing12m) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {proj ? money(proj.annualGross) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
        {proj?.nextPayment
          ? `${proj.nextPayment.date} · est. ${money(proj.nextPayment.amount)}`
          : '—'}
      </td>
      <td className="px-4 py-2">
        {proj ? (
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
            proj.source === 'actual' ? 'bg-green-50 text-green-700' : 'bg-indigo-50 text-indigo-700')}>
            {proj.source === 'actual' ? 'actual' : 'manual rate'}
          </span>
        ) : archived ? (
          <span className="text-xs text-gray-400">—</span>
        ) : (
          <button onClick={onEditRate} className="text-xs text-green-700 hover:underline font-medium">
            set rate
          </button>
        )}
      </td>
      {anyRoc && (
        <td className="px-4 py-2 text-right tabular-nums text-gray-600"
          title={s.rocCumulative > 0 && s.adjustedCostBasis < s.costBasis
            ? `Adjusted basis ${money(s.adjustedCostBasis)} (original ${money(s.costBasis)})`
            : undefined}>
          {s.rocCumulative > 0 ? money(s.rocCumulative) : '—'}
        </td>
      )}
      <td className="px-2 py-2 text-right">
        {!archived && (
          <button onClick={onEditRate} className="p-2 sm:p-1 rounded hover:bg-gray-100"
            aria-label="Edit dividend rate" title="Manual rate & frequency (used when there's no payment history)">
            <Pencil className="h-3.5 w-3.5 text-gray-300 hover:text-gray-600" />
          </button>
        )}
      </td>
    </tr>
  );
}

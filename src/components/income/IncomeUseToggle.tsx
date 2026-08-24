import { useData } from '../../contexts/DataContext';
import type { ParkedLot, ParkedPosition } from '../../lib/engine';
import { incomeUseMismatch, incomeUseOf } from '../../lib/engine';
import { cn } from '../../lib/utils';

/** Per-holding reinvest/spend toggle. Reflects the inferred default until the
 * owner overrides; a subtle dot flags when the explicit intent contradicts
 * recent dividend behavior. Only 'spend' income counts toward coverage. */
export function IncomeUseToggle({ position, lots }: { position: ParkedPosition; lots: ParkedLot[] }) {
  const { setIncomeUse } = useData();
  const use = incomeUseOf(position, lots);
  const explicit = position.incomeUse != null;
  const mismatch = incomeUseMismatch(position, lots);

  const set = (next: 'reinvest' | 'spend') => {
    // Clicking the already-inferred value clears the override back to auto.
    void setIncomeUse(position.id, !explicit && next === use ? null : next);
  };

  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 text-[10px] font-medium overflow-hidden">
      <button
        onClick={(e) => { e.stopPropagation(); set('reinvest'); }}
        className={cn('px-1.5 py-0.5', use === 'reinvest' ? 'bg-sky-50 text-sky-700' : 'text-gray-400 hover:bg-gray-50')}
        title={`Reinvest (DRIP) — compounds, not counted toward expenses${explicit ? '' : ' · inferred'}`}
      >
        DRIP
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); set('spend'); }}
        className={cn('px-1.5 py-0.5', use === 'spend' ? 'bg-green-50 text-green-700' : 'text-gray-400 hover:bg-gray-50')}
        title={`Available to spend — counts toward covering expenses${explicit ? '' : ' · inferred'}`}
      >
        Spend
      </button>
      {mismatch && (
        <span className="pr-1 text-amber-500" title="Marked spendable, but recent dividends reinvested (or vice-versa) — check your broker's DRIP setting.">•</span>
      )}
    </span>
  );
}

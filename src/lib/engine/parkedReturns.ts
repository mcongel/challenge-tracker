/** Total return per parked holding — price, income, and realized results in
 * one number, with ROC counted exactly once. Context only, never score math.
 *
 * The ROC rule: an allocated ROC dollar already lives in the return as
 * reduced basis (bigger unrealized on live lots, or bigger realized on sold
 * ones — sales record ROC-adjusted basis), so it must be SUBTRACTED from the
 * income leg or it counts twice. Overflow beyond basis reduced nothing and
 * stays income; unallocated ROC stays income until the allocator runs.
 *
 * Cross-position caveat: an ACATS transfer can leave a dividend on the
 * archived source while its basis reductions ride the destination's lots —
 * per-position attribution shifts slightly, but the pile-wide sum is exact.
 *
 * The percent is a SIMPLE return on dollars invested (original basis of live
 * lots + recorded basis of sold shares) — not time-weighted, not annualized. */

import { sum } from './money';
import type { ParkedLot } from './parkedLots';
import { aggregateLotsAdjusted } from './parkedRoc';
import type { ParkedLotAdjustment } from './parkedRoc';
import type { ParkedPosition, ParkedSale } from './types';

export interface PositionTotalReturn {
  /** Current value − ROC-adjusted basis of live lots. */
  unrealized: number;
  /** Lifetime dividends minus allocated ROC (which lives in basis instead). */
  income: number;
  /** Σ proceeds − recorded basis, known-basis sales only. */
  realized: number;
  total: number;
  /** Original basis of live lots + recorded basis of sold shares. */
  invested: number;
  /** total / invested, or null when nothing was invested. Simple, not annualized. */
  pct: number | null;
  /** Sales without a recorded basis — excluded from realized and invested. */
  unknownBasisSales: number;
}

export function positionTotalReturn(
  position: Pick<ParkedPosition, 'shares' | 'currentPrice'>,
  lots: ParkedLot[],
  adjustments: ParkedLotAdjustment[],
  sales: ParkedSale[],
): PositionTotalReturn {
  const { costBasis, adjustedCostBasis } = aggregateLotsAdjusted(lots, adjustments);
  const unrealized = position.shares * position.currentPrice - adjustedCostBasis;

  const dividends = lots.filter((l) => l.source === 'dividend');
  const lifetimeIncome = sum(dividends.map((l) => l.amount));
  const allocatedRoc = sum(
    dividends
      .filter((l) => (l.classification ?? 'unclassified') === 'return_of_capital' && l.rocAllocatedAt)
      .map((l) => Math.max(0, l.amount - (l.rocOverflow ?? 0))),
  );
  const income = lifetimeIncome - allocatedRoc;

  const known = sales.filter((s) => s.costBasis != null);
  const realized = sum(known.map((s) => s.proceeds - (s.costBasis as number)));
  const invested = costBasis + sum(known.map((s) => s.costBasis as number));
  const total = unrealized + income + realized;

  return {
    unrealized,
    income,
    realized,
    total,
    invested,
    pct: invested > 0 ? total / invested : null,
    unknownBasisSales: sales.length - known.length,
  };
}

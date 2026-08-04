import type { Trade } from './types';
import { addDays } from './dates';
import { realizedGain } from './trades';

export const WASH_SALE_WINDOW_DAYS = 31;

/**
 * Loss-sales of this ticker whose close date falls within the 31 days before
 * a proposed buy — rebuying now would disallow those losses. Only sees trades
 * recorded in the app; sales in outside accounts can't be detected.
 */
export function washSaleWarnings(trades: Trade[], ticker: string, buyDate: string): Trade[] {
  const windowStart = addDays(buyDate, -WASH_SALE_WINDOW_DAYS);
  return trades.filter(
    (t) =>
      t.ticker === ticker &&
      realizedGain(t) < 0 &&
      t.closeDate >= windowStart &&
      t.closeDate <= buyDate,
  );
}

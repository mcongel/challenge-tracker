import type { OutsideSale, Trade } from './types';
import { addDays } from './dates';
import { realizedGain } from './trades';

export const WASH_SALE_WINDOW_DAYS = 31;

/** Crypto is property, not a "security" — the wash-sale rule doesn't reach
 * it (as of 2026), so a BTC loss-and-rebuy never fires Rule 9. Revisit if
 * Congress closes the loophole. */
const CRYPTO_TICKERS = new Set(['BTC', 'BTC-USD', 'ETH', 'ETH-USD']);
export const isCryptoTicker = (ticker: string) => CRYPTO_TICKERS.has(ticker.toUpperCase());

/**
 * Loss-sales of this ticker whose close date falls within the 31 days before
 * a proposed buy — rebuying now would disallow those losses. Challenge-account
 * trades only; use washSaleConflicts for the cross-account picture.
 */
export function washSaleWarnings(trades: Trade[], ticker: string, buyDate: string): Trade[] {
  if (isCryptoTicker(ticker)) return [];
  const windowStart = addDays(buyDate, -WASH_SALE_WINDOW_DAYS);
  return trades.filter(
    (t) =>
      t.ticker === ticker &&
      realizedGain(t) < 0 &&
      t.closeDate >= windowStart &&
      t.closeDate <= buyDate,
  );
}

export interface WashSaleConflicts {
  /** Challenge-account loss-sales inside the window. */
  trades: Trade[];
  /** Recorded outside-account loss-sales inside the window (Rule 9 crosses brokerages). */
  outside: OutsideSale[];
}

/** The full Rule 9 check for a proposed buy: loss-sales of the ticker in the
 * past 31 days from the challenge account AND any recorded outside account.
 * Generic over the sale shape so callers can carry extra fields (e.g. an
 * unknown-basis flag) through the filter. */
export function washSaleConflicts<S extends OutsideSale>(
  trades: Trade[],
  outsideSales: S[],
  ticker: string,
  buyDate: string,
): { trades: Trade[]; outside: S[] } {
  if (isCryptoTicker(ticker)) return { trades: [], outside: [] };
  const windowStart = addDays(buyDate, -WASH_SALE_WINDOW_DAYS);
  return {
    trades: washSaleWarnings(trades, ticker, buyDate),
    outside: outsideSales.filter(
      (s) => s.ticker === ticker && s.loss && s.saleDate >= windowStart && s.saleDate <= buyDate,
    ),
  };
}

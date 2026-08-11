/** Return-of-capital basis adjustments for parked lots. An ROC distribution
 * reduces cost basis per share; each event's reductions are stored as rows
 * keyed to both the share lot and the dividend event, so the lot's original
 * amount is never touched and reversing an event is exact. Context only —
 * never score math. */

export interface ParkedLotAdjustment {
  id: string;
  shareLotId: string;
  /** null = carried over by an ACATS transfer, not tied to a dividend event. */
  dividendLotId: string | null;
  /** Basis reduction in dollars, ≥ 0, 6dp. */
  amount: number;
  createdAt?: string | null;
}

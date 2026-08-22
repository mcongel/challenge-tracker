/** Fund look-through (Snowball's "X-ray"): an ETF isn't one opaque position —
 * it holds sectors, and a broad fund quietly adds to your REAL semiconductor
 * concentration even when its own category isn't 'Semiconductors'. The
 * concentration cap counts that hidden exposure so the risk bucket is honest.
 *
 * CURATED BY HAND, on purpose. The owner holds a handful of ETFs whose sector
 * mix barely drifts, so a static map needs no API and no license. Refresh a
 * weight from the fund's own page or FMP's ETF sector-weightings endpoint
 * when a holding changes materially; a missing ETF simply contributes 0
 * look-through (its own category still counts as before). Weights are
 * fractions of fund value (0..1); only the semiconductor slice drives the
 * cap, but the full row is kept for the look-through display. */

export interface FundSectors {
  /** Fraction of the fund's value in semiconductors — the cap-bearing slice. */
  semiconductors: number;
  /** Optional richer breakdown for the X-ray display (fractions, ~sum to 1). */
  sectors?: Record<string, number>;
  /** When these weights were last hand-verified — a staleness cue. */
  asOf: string;
}

/** ticker → sector composition. Verify against the fund's fact sheet before
 * trusting a big number; these are the owner's held ETFs as of 2026-08. */
export const ETF_SECTOR_WEIGHTS: Record<string, FundSectors> = {
  // Pure semiconductor ETF — already categorized 'Semiconductors', so the
  // cap counts it directly; the entry is a safety net if it's ever
  // recategorized.
  SOXX: { semiconductors: 1.0, asOf: '2026-08-01' },
  // Broad tech / AI funds carry real, HIDDEN semi weight — this is the whole
  // point of look-through.
  QQQI: { semiconductors: 0.22, asOf: '2026-08-01' },
  AIPI: { semiconductors: 0.30, asOf: '2026-08-01' },
  // Energy fund — no semis; listed so it reads as verified-zero, not unknown.
  VDE: { semiconductors: 0.0, asOf: '2026-08-01' },
  // S&P 500 shadow (the benchmark's real fund) — ~7% info-tech semis.
  VOO: { semiconductors: 0.07, asOf: '2026-08-01' },
};

/** Semiconductor value hiding inside an ETF position: 0 for a fund not in the
 * map, or one already categorized 'Semiconductors' (counted directly — never
 * double-count). marketValue is the position's current value. */
export function lookThroughSemiValue(
  ticker: string,
  category: string,
  marketValue: number,
  semiCategory: string,
): number {
  if (category === semiCategory) return 0; // counted at full value directly
  const w = ETF_SECTOR_WEIGHTS[ticker]?.semiconductors;
  return w ? marketValue * w : 0;
}

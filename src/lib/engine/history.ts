import type { ParkedSale } from './types';
import type { ParkedLot } from './parkedLots';
import { roundCents } from './money';

/**
 * Value-history reconstruction: what were these holdings worth on past days?
 *
 * Share counts come from the REAL records — dated lots plus what sales
 * consumed — and prices from actual historical closes, so the line reflects
 * the market, not just the daily snapshots (which only reach back to when
 * each number started being recorded).
 */

/** One share-count change: +delta when bought (or DRIPped), −delta when sold. */
export interface ShareEvent {
  ticker: string;
  /** null = date unknown — held since before the chart's window. */
  date: string | null;
  delta: number;
}

/**
 * Share events per ticker from current lots plus sale add-backs.
 *
 * Current lots hold TODAY's shares (sales shrank them), so each sale's
 * consumption snapshot re-adds what it removed over [purchase, sale). Legacy
 * sales without a snapshot approximate: their shares count as held from the
 * window's start until the sale — right whenever the buy predates the chart,
 * which is the common case for history old enough to lack a snapshot.
 */
export function shareEvents(lots: ParkedLot[], sales: ParkedSale[], tickerOf: (lot: ParkedLot) => string | null): ShareEvent[] {
  const events: ShareEvent[] = [];
  for (const l of lots) {
    if (l.shares <= 0) continue;
    const ticker = tickerOf(l);
    if (!ticker) continue;
    events.push({ ticker, date: l.date ?? null, delta: l.shares });
  }
  for (const s of sales) {
    const slices = s.consumed?.slices;
    if (slices && slices.length > 0) {
      for (const slice of slices) {
        if (slice.sharesDelta <= 0) continue;
        events.push({ ticker: s.ticker, date: slice.date ?? null, delta: slice.sharesDelta });
        events.push({ ticker: s.ticker, date: s.date, delta: -slice.sharesDelta });
      }
    } else {
      events.push({ ticker: s.ticker, date: null, delta: s.shares });
      events.push({ ticker: s.ticker, date: s.date, delta: -s.shares });
    }
  }
  return events;
}

/** [isoDate, close] pairs per ticker, ascending — the /api/history shape. */
export type CloseSeries = Record<string, [string, number][]>;

/**
 * Daily (or weekly — whatever the closes' cadence) total value: for each
 * close date, sum shares-held-then × last close at or before it. Tickers not
 * yet listed (no close yet) contribute nothing. The axis starts at the first
 * dated event so an all-cash prehistory doesn't stretch the chart.
 */
export function reconstructValues(events: ShareEvent[], closes: CloseSeries): { date: string; value: number }[] {
  const dates = [...new Set(Object.values(closes).flatMap((s) => s.map(([d]) => d)))].sort();
  if (dates.length === 0) return [];
  const firstEvent = events.reduce<string | null>(
    (min, e) => (e.date !== null && (min === null || e.date < min) ? e.date : min),
    null,
  );

  const tickers = [...new Set(events.map((e) => e.ticker))];
  const perTicker = tickers.map((ticker) => {
    const evs = events
      .filter((e) => e.ticker === ticker)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')); // nulls (unknown) first
    const series = closes[ticker] ?? [];
    return { evs, series, ei: 0, ci: 0, shares: 0, close: null as number | null };
  });

  const out: { date: string; value: number }[] = [];
  for (const date of dates) {
    if (firstEvent !== null && date < firstEvent) continue;
    let value = 0;
    for (const t of perTicker) {
      while (t.ei < t.evs.length && (t.evs[t.ei].date === null || t.evs[t.ei].date! <= date)) {
        t.shares += t.evs[t.ei].delta;
        t.ei++;
      }
      while (t.ci < t.series.length && t.series[t.ci][0] <= date) {
        t.close = t.series[t.ci][1];
        t.ci++;
      }
      if (t.shares > 1e-9 && t.close !== null) value += t.shares * t.close;
    }
    out.push({ date, value: roundCents(value) });
  }
  return out;
}

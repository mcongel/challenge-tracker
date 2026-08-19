import { useEffect, useMemo, useState } from 'react';
import type { ParkedLot, ParkedPosition, ParkedSale } from './engine';
import { reconstructValues, shareEvents } from './engine';
import type { CloseSeries } from './engine';
import { roundCents } from './engine';
import { todayISO } from './utils';

/**
 * Reconstructed value history for a set of positions: shares held on each
 * past day (from dated lots and what sales consumed) × that day's actual
 * close from /api/history. Today's point is the LIVE total, so the line
 * always lands exactly on the number the page shows.
 *
 * Null until the price history arrives (or when it can't — offline, local
 * dev without the Pages Function); callers fall back to snapshots.
 */
export function useValueHistory(
  positions: ParkedPosition[],
  allLots: ParkedLot[],
  sales: ParkedSale[],
  liveTotal: number,
): { date: string; value: number }[] | null {
  const [series, setSeries] = useState<CloseSeries | null>(null);

  const positionIds = useMemo(() => new Map(positions.map((p) => [p.id, p.ticker])), [positions]);
  const events = useMemo(() => {
    const lots = allLots.filter((l) => positionIds.has(l.parkedPositionId));
    return shareEvents(lots, sales, (l) => positionIds.get(l.parkedPositionId) ?? null);
  }, [allLots, sales, positionIds]);

  const tickers = useMemo(
    () => [...new Set(events.map((e) => e.ticker))].sort(),
    [events],
  );
  const from = useMemo(
    () => events.reduce<string | null>(
      (min, e) => (e.date !== null && (min === null || e.date < min) ? e.date : min),
      null,
    ),
    [events],
  );

  const key = `${tickers.join(',')}|${from}`;
  useEffect(() => {
    if (tickers.length === 0 || !from) return;
    let cancelled = false;
    setSeries(null);
    void fetch(`/api/history?tickers=${tickers.join(',')}&from=${from}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { series?: CloseSeries } | null) => {
        if (!cancelled && body?.series) setSeries(body.series);
      })
      .catch(() => { /* fall back to snapshots */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    if (!series) return null;
    const values = reconstructValues(events, series);
    if (values.length === 0) return null;
    // Land the last point on today's live number (replacing a same-day close).
    const today = todayISO();
    const trimmed = values.filter((v) => v.date < today);
    return [...trimmed, { date: today, value: roundCents(liveTotal) }];
  }, [series, events, liveTotal]);
}

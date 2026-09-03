/** The quote machinery, extracted whole from DataContext: delayed quotes via
 * the Pages proxy, day-change, staleness stamps, ticker display names, and
 * the 30-minute/refocus polling loop. Owns no table state — fresh prices are
 * persisted back through the callback the provider passes in. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParkedPosition, PositionLot, WatchlistItem } from '../../lib/engine';
import { isArchivedPosition } from '../../lib/engine';

export interface QuotesEngine {
  quotes: Record<string, number>;
  dayChange: Record<string, { change: number | null; changePct: number | null }>;
  quotesAsOf: number | null;
  quotesError: boolean;
  /** First quote pass finished — success, failure, or nothing to fetch.
   * Until then, price-derived numbers are cost/stale fallbacks that would
   * repaint moments later; screens hold a placeholder instead of flashing. */
  quotesSettled: boolean;
  tickerNames: Record<string, string>;
  refreshQuotes: () => Promise<void>;
}

export function useQuotesEngine(args: {
  /** Data loaded without error — quotes wait for the ticker lists. */
  ready: boolean;
  lots: PositionLot[];
  parked: ParkedPosition[];
  watchlist: WatchlistItem[];
  isQuotable: (p: ParkedPosition) => boolean;
  persistQuotedPrices: (fresh: Record<string, { price: number }>) => Promise<void>;
}): QuotesEngine {
  const { ready, lots, parked, watchlist, isQuotable, persistQuotedPrices } = args;
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [dayChange, setDayChange] = useState<
    Record<string, { change: number | null; changePct: number | null }>
  >({});
  const [quotesAsOf, setQuotesAsOf] = useState<number | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  const [quotesSettled, setQuotesSettled] = useState(false);
  const [tickerNames, setTickerNames] = useState<Record<string, string>>({});

  const lastQuoteFetchAt = useRef(0);
  const refreshQuotes = useCallback(async () => {
    const tickers = [
      ...new Set([
        ...lots.map((l) => l.ticker),
        // Hand-priced rows (plan codes, annuity units) never join — asking
        // the market API for W146 or TRAD invites impostor listings.
        ...parked
          .filter((p) => !isArchivedPosition(p) && isQuotable(p))
          .map((p) => p.ticker),
        // Bench names too — the Watchlist's "price now" column is the point.
        ...watchlist.map((w) => w.ticker),
        'VOO',
      ]),
    ];
    if (tickers.length === 0) {
      setQuotesSettled(true);
      return;
    }
    // Chunked and parallel: one big batch can't finish inside a single Pages
    // Function invocation's budget, so it returned a partial set and the user
    // had to click "check prices" repeatedly to converge. Small chunks each
    // complete on their own; firing them together fills everything in one go.
    const CHUNK = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < tickers.length; i += CHUNK) chunks.push(tickers.slice(i, i + CHUNK));
    try {
      const bodies = await Promise.all(
        chunks.map(async (chunk) => {
          const res = await fetch(`/api/quotes?tickers=${chunk.join(',')}`);
          if (!res.ok) return null;
          return (await res.json()) as {
            quotes?: Record<string, { price: number; change?: number | null; changePct?: number | null }>;
            asOf?: number;
          };
        }),
      );
      const fresh: Record<string, { price: number; change?: number | null; changePct?: number | null }> = {};
      let asOf = Date.now();
      let anyOk = false;
      for (const body of bodies) {
        if (!body) continue;
        anyOk = true;
        Object.assign(fresh, body.quotes ?? {});
        if (body.asOf) asOf = body.asOf;
      }
      // Every chunk failed — best-effort, so turn the staleness stamp amber
      // rather than blank out prices we already had.
      if (!anyOk) {
        setQuotesError(true);
        return;
      }
      if (Object.keys(fresh).length > 0) {
        // Merge instead of replace: a chunk that misses a ticker shouldn't
        // blank out the price we already had.
        setQuotes((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.entries(fresh).map(([t, q]) => [t, q.price])),
        }));
        setDayChange((prev) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(fresh).map(([t, q]) => [
              t,
              { change: q.change ?? null, changePct: q.changePct ?? null },
            ]),
          ),
        }));
        setQuotesAsOf(asOf);
        lastQuoteFetchAt.current = Date.now();
        setQuotesError(false);
        void persistQuotedPrices(fresh);
      }
    } catch {
      // Local dev without the Pages Function, or the API is down — the UI
      // shows an amber "quotes stale" stamp instead of an error.
      setQuotesError(true);
    } finally {
      setQuotesSettled(true);
    }
  }, [lots, parked, watchlist, persistQuotedPrices, isQuotable]);

  const refreshQuotesRef = useRef(refreshQuotes);
  useEffect(() => {
    refreshQuotesRef.current = refreshQuotes;
  }, [refreshQuotes]);

  const quotesFetched = useRef(false);
  useEffect(() => {
    if (!ready || quotesFetched.current) return;
    quotesFetched.current = true;
    void refreshQuotes();
    // Names once per session — they're cached a week server-side. Hand-priced
    // codes stay out here too: "TRAD" must not label itself as a SPAC.
    const tickers = [
      ...new Set([
        ...lots.map((l) => l.ticker),
        ...parked
          .filter((p) => !isArchivedPosition(p) && isQuotable(p))
          .map((p) => p.ticker),
      ]),
    ];
    if (tickers.length > 0) {
      void fetch(`/api/names?tickers=${tickers.join(',')}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { names?: Record<string, string> } | null) => {
          if (body?.names) setTickerNames((prev) => ({ ...prev, ...body.names }));
        })
        .catch(() => {
          /* best-effort */
        });
    }
  }, [ready, refreshQuotes, lots, parked, isQuotable]);

  // Keep an open tab honest: refetch every 30 minutes (the server cache TTL)
  // and when the tab regains focus after going stale. Cache hits cost nothing.
  useEffect(() => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const FOCUS_STALE = 5 * 60 * 1000;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshQuotesRef.current();
    }, THIRTY_MIN);
    const onVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastQuoteFetchAt.current > FOCUS_STALE
      ) {
        void refreshQuotesRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { quotes, dayChange, quotesAsOf, quotesError, quotesSettled, tickerNames, refreshQuotes };
}

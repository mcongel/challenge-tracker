import { useEffect, useState } from 'react';
import type { DividendFundamentals } from './engine';

/** ticker → dividend fundamentals, one batched /api/fundamentals call per set
 * of unseen tickers (module-cached on top of the endpoint's 24h edge cache).
 * Best-effort and display-only: a missing FMP key or a failed fetch just
 * yields no insights, never an error in the UI. Tickers the vendor says pay
 * nothing are cached as null so they aren't re-requested. */
const cache = new Map<string, DividendFundamentals | null>();

export function useDividendInsights(
  tickers: string[],
): Record<string, DividendFundamentals> {
  const wanted = [...new Set(tickers)].filter((t) => /^[A-Z.-]{1,10}$/.test(t)).sort();
  const key = wanted.join(',');
  const [map, setMap] = useState<Record<string, DividendFundamentals>>({});

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      const next: Record<string, DividendFundamentals> = {};
      for (const t of wanted) {
        const v = cache.get(t);
        if (v) next[t] = v;
      }
      setMap(next);
    };
    const missing = wanted.filter((t) => !cache.has(t));
    if (missing.length === 0) { publish(); return; }
    void fetch(`/api/fundamentals?tickers=${missing.join(',')}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: Record<string, DividendFundamentals>; missing?: string[] } | null) => {
        if (!body?.data) return; // 503 (no key) / network — leave uncached, retryable
        for (const t of missing) {
          if (body.data[t]) cache.set(t, body.data[t]);
          else if ((body.missing ?? []).includes(t)) cache.set(t, null); // pays nothing
        }
      })
      .catch(() => { /* best-effort */ })
      .then(publish);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

import { useEffect, useState } from 'react';

/** ticker → vendor industry for display labels. ONE batched /api/names call
 * per set of unseen tickers (the same upstream profile lookup serves names
 * and industries — the old per-ticker /api/profile fan-out was an N+1
 * against a rate-limited vendor). Unknown/ETF tickers resolve to null and
 * render nothing. Display-only — the pile's category field stays the source
 * of truth for rule math. */
const industryCache = new Map<string, string | null>();

export function useIndustries(tickers: string[]): Record<string, string | null> {
  const wanted = [...new Set(tickers)].filter((t) => /^[A-Z.-]{1,10}$/.test(t)).sort();
  const key = wanted.join(',');
  const [map, setMap] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      const next: Record<string, string | null> = {};
      for (const t of wanted) if (industryCache.has(t)) next[t] = industryCache.get(t)!;
      setMap(next);
    };
    const missing = wanted.filter((t) => !industryCache.has(t));
    if (missing.length === 0) {
      publish();
      return;
    }
    void fetch(`/api/names?tickers=${missing.join(',')}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { industries?: Record<string, string>; missing?: string[] } | null) => {
        // Cache real answers, and nulls only for tickers the vendor answered
        // about with no profile (ETFs). A failed fetch caches nothing, so an
        // outage stays retryable instead of blanking the labels all session.
        if (!body?.industries) return;
        const noProfile = new Set(body.missing ?? []);
        for (const t of missing) {
          if (body.industries[t] !== undefined) industryCache.set(t, body.industries[t]);
          else if (noProfile.has(t)) industryCache.set(t, null);
        }
      })
      .catch(() => {
        /* best-effort */
      })
      .then(publish);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

import { useEffect, useState } from 'react';
import { fetchProfile } from './quotes';

/** ticker → vendor industry for display labels. Fetched once per session
 * per ticker (module cache) on top of the edge cache; unknown/ETF tickers
 * resolve to null and render nothing. Display-only — the pile's category
 * field stays the source of truth for rule math. */
const industryCache = new Map<string, string | null>();

export function useIndustries(tickers: string[]): Record<string, string | null> {
  const wanted = [...new Set(tickers)].filter((t) => /^[A-Z.\-]{1,10}$/.test(t)).sort();
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
    void Promise.all(
      missing.map(async (t) => {
        const p = await fetchProfile(t);
        industryCache.set(t, p?.industry ?? null);
      }),
    ).then(publish);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

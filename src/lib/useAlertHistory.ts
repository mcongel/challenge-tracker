import { useEffect, useState } from 'react';
import { db } from './db';

/** One alert episode, straight from challenge.alert_state — the rows the
 * market-alerts cron writes. An open row (no clearedAt) is still firing; a
 * null notifiedAt on an open row means the email hasn't confirmed yet and
 * the next cron run will retry it. */
export interface AlertEpisode {
  id: string;
  key: string;
  title: string;
  price: number | null;
  firedAt: string;
  clearedAt: string | null;
  notifiedAt: string | null;
}

/** Read-only fetch, on mount — alert history is reference material, not part
 * of the 20-table refresh. */
export function useAlertHistory(limit = 20): {
  episodes: AlertEpisode[] | null;
  error: string | null;
} {
  const [episodes, setEpisodes] = useState<AlertEpisode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void db()
      .from('alert_state')
      .select('*')
      .order('fired_at', { ascending: false })
      .limit(limit)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        setEpisodes(
          (data ?? []).map((r: any) => ({
            id: r.id,
            key: r.key,
            title: r.title,
            price: r.price == null ? null : Number(r.price),
            firedAt: r.fired_at,
            clearedAt: r.cleared_at ?? null,
            notifiedAt: r.notified_at ?? null,
          })),
        );
      });
    return () => { cancelled = true; };
  }, [limit]);

  return { episodes, error };
}

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Card } from './ui/Card';
import { useAlertHistory } from '../lib/useAlertHistory';
import { cn } from '../lib/utils';

/** The in-app alert log the alert_state rows were designed to become: every
 * episode the market-alerts cron fired, with its lifecycle at a glance —
 * open (still firing), cleared (re-armed), or email-pending (send failed,
 * retrying next run). Collapsed by default; this is reference, not workflow. */
export function AlertHistory() {
  const [open, setOpen] = useState(false);
  const { episodes, error } = useAlertHistory(20);

  // Nothing to show and nothing wrong — stay invisible until the first fire.
  if (!error && (episodes == null || episodes.length === 0)) return null;

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  };

  return (
    <Card className="p-4 sm:p-6 density-aware-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <BellRing className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Alert history
        </span>
        <span className="text-xs text-gray-400">
          {episodes?.length ?? 0} episode{(episodes?.length ?? 0) === 1 ? '' : 's'} · {open ? 'hide' : 'show'}
        </span>
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600">Couldn't load alert history: {error}</p>
      )}
      {open && episodes && (
        <ul className="mt-3 divide-y divide-gray-100">
          {episodes.map((e) => {
            const status = e.clearedAt
              ? { label: 'cleared', cls: 'bg-gray-100 text-text-secondary' }
              : e.notifiedAt == null
                ? { label: 'email pending', cls: 'bg-amber-50 text-amber-800' }
                : { label: 'open', cls: 'bg-green-50 text-green-700' };
            return (
              <li key={e.id} className="flex items-baseline gap-2 py-2 text-sm">
                <span className="whitespace-nowrap text-xs tabular-nums text-gray-400">
                  {fmt(e.firedAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-secondary" title={e.title}>
                  {e.title}
                </span>
                <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap', status.cls)}>
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <p className="mt-2 text-xs text-gray-400">
          One email per crossing; an episode re-arms when it clears. "Email pending" means the
          send failed and the next 30-minute check retries it.
        </p>
      )}
    </Card>
  );
}

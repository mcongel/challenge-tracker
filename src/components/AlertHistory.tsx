import { useAlertHistory } from '../lib/useAlertHistory';
import { cn } from '../lib/utils';

/** The in-app alert log the alert_state rows were designed to become: every
 * episode the market-alerts cron fired, with its lifecycle at a glance —
 * open (still firing), cleared (re-armed), or email-pending (send failed,
 * retrying next run). A plain list — the bell panel provides the frame. */
export function AlertHistoryList() {
  const { episodes, error } = useAlertHistory(20);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  };

  if (error) {
    return <p className="text-xs text-red-600">Couldn't load alert history: {error}</p>;
  }
  if (episodes == null) {
    return <p className="text-xs text-gray-400">Loading…</p>;
  }
  if (episodes.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        No email alerts yet — episodes appear here when a target, entry trigger, or calendar
        exit fires.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-gray-100">
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
      <p className="mt-2 text-xs text-gray-400">
        One email per crossing; an episode re-arms when it clears. "Email pending" means the
        send failed and the next 30-minute check retries it.
      </p>
    </>
  );
}

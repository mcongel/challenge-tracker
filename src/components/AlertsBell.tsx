import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Modal } from './ui/Modal';
import { AlertHistoryList } from './AlertHistory';
import { useActiveAlerts } from '../lib/useActiveAlerts';
import type { AppAlert } from '../lib/alerts';
import { cn } from '../lib/utils';

/** One styling map for every alert surface — the bell panel and the
 * Dashboard's act-now banners must wear the same colors. */
export const ALERT_STYLES: Record<AppAlert['kind'], string> = {
  MILESTONE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  TARGET: 'bg-green-50 text-green-700 border-green-200',
  TAX: 'bg-yellow-50 text-yellow-800 border-amber-300 border',
  CAP: 'bg-red-50 text-red-700 border-red-200',
  ENTRY: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  CALENDAR: 'bg-amber-50 text-amber-800 border-amber-200',
};

/** Chronic/contextual alerts live ONLY in the bell — the over-cap warning is
 * true for months at a time and an always-on red banner stops meaning
 * anything (owner call 2026-08-19). Act-now alerts (milestone, skim,
 * target, calendar) still banner on the Dashboard AND appear here. */
export const BELL_ONLY_KINDS: ReadonlySet<AppAlert['kind']> = new Set(['CAP', 'ENTRY']);

/** Header bell: count badge for every active alert, panel with the full list
 * plus the email-alert history. */
export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const alerts = useActiveAlerts();
  const urgent = alerts.some((a) => !BELL_ONLY_KINDS.has(a.kind));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative p-2.5 sm:p-2 rounded-md hover:bg-gray-100"
        aria-label={`Alerts (${alerts.length} active)`}
        title="Alerts"
      >
        <Bell className="h-5 w-5 text-gray-500" />
        {alerts.length > 0 && (
          <span
            className={cn(
              'absolute top-1 right-1 min-w-[1rem] h-4 px-1 rounded-full text-[10px] font-bold leading-4 text-center text-white',
              urgent ? 'bg-red-600' : 'bg-amber-500',
            )}
          >
            {alerts.length}
          </span>
        )}
      </button>
      {open && (
        <Modal isOpen onClose={() => setOpen(false)} title="Alerts">
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-400">
                Nothing firing. Targets, entry triggers, calendar exits, the quarterly skim,
                milestones, and the concentration cap all report here when they trip.
              </p>
            ) : (
              <div className="space-y-2">
                {alerts.map((a) => (
                  <Link
                    key={a.kind + a.message}
                    to={a.to}
                    onClick={() => setOpen(false)}
                    className={cn('block rounded-lg px-4 py-3 text-sm font-bold border', ALERT_STYLES[a.kind])}
                  >
                    {a.message} →
                  </Link>
                ))}
              </div>
            )}
            <div className="pt-2 border-t border-gray-100">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Email alert history
              </p>
              <AlertHistoryList />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

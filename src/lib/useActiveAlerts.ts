import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useData } from '../contexts/DataContext';
import type { AppAlert } from './alerts';
import { activeAlerts } from './alerts';
import { safeStorage, todayISO } from './utils';

/** Dismissed alert ids — a tiny shared store so the header bell and the
 * Dashboard banners react to a dismissal in the same frame. UI preference
 * only (never financial data), persisted like every other preference. A
 * dismissal lives exactly as long as its alert keeps firing: ids that stop
 * firing are pruned, so the same episode can't nag again but a NEW crossing
 * alerts fresh — the email pipeline's episode semantics. */
const DISMISSED_KEY = 'dismissedAlertIds';

function readStored(): ReadonlySet<string> {
  try {
    const stored = JSON.parse(safeStorage.get(DISMISSED_KEY) ?? 'null');
    if (Array.isArray(stored) && stored.every((x) => typeof x === 'string')) {
      return new Set(stored);
    }
  } catch { /* fall through */ }
  return new Set();
}

let dismissed: ReadonlySet<string> = readStored();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function setDismissed(next: ReadonlySet<string>) {
  dismissed = next;
  safeStorage.set(DISMISSED_KEY, JSON.stringify([...next]));
  listeners.forEach((fn) => fn());
}

export function dismissAlert(id: string): void {
  setDismissed(new Set([...dismissed, id]));
}

export function restoreDismissedAlerts(): void {
  setDismissed(new Set());
}

/** The live alert set, memoized once — the header bell and the Dashboard
 * banners must always agree. Empty until the first quote pass settles so
 * cost-fallback prices can't flash a false CAP or TARGET. Returns the
 * VISIBLE alerts (dismissed ones filtered out) plus the dismissal controls. */
export function useActiveAlerts(): {
  alerts: AppAlert[];
  dismissedCount: number;
  dismiss: (id: string) => void;
  restoreDismissed: () => void;
} {
  const {
    lots, cashEvents, trades, milestones, pileParked, carryforwards, overrides, quotes,
    concentrationCap, watchlist, loading, quotesSettled,
  } = useData();
  const today = todayISO();
  const settled = !loading && quotesSettled;
  const all = useMemo(() => {
    if (!settled) return [];
    return activeAlerts({
      lots, cashEvents, trades, milestones, parked: pileParked, carryforwards, overrides,
      quotes, concentrationCap, watchlist, today,
    });
  }, [
    settled, lots, cashEvents, trades, milestones, pileParked, carryforwards,
    overrides, quotes, concentrationCap, watchlist, today,
  ]);

  const dismissedNow = useSyncExternalStore(subscribe, () => dismissed);

  // Prune dismissals whose alert stopped firing — that episode is over, and
  // the next crossing must alert again. Only once quotes settle: the empty
  // pre-settle set must not wipe legitimate dismissals.
  useEffect(() => {
    if (!settled) return;
    const activeIds = new Set(all.map((a) => a.id));
    const kept = [...dismissedNow].filter((id) => activeIds.has(id));
    if (kept.length !== dismissedNow.size) setDismissed(new Set(kept));
  }, [settled, all, dismissedNow]);

  return {
    alerts: all.filter((a) => !dismissedNow.has(a.id)),
    dismissedCount: all.filter((a) => dismissedNow.has(a.id)).length,
    dismiss: dismissAlert,
    restoreDismissed: restoreDismissedAlerts,
  };
}

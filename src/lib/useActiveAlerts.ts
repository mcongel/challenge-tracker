import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import type { AppAlert } from './alerts';
import { activeAlerts } from './alerts';
import { todayISO } from './utils';

/** The live alert set, memoized once — the header bell and the Dashboard
 * banners must always agree. Empty until the first quote pass settles so
 * cost-fallback prices can't flash a false CAP or TARGET. */
export function useActiveAlerts(): AppAlert[] {
  const {
    lots, cashEvents, trades, milestones, pileParked, carryforwards, overrides, quotes,
    concentrationCap, watchlist, loading, quotesSettled,
  } = useData();
  const today = todayISO();
  return useMemo(() => {
    if (loading || !quotesSettled) return [];
    return activeAlerts({
      lots, cashEvents, trades, milestones, parked: pileParked, carryforwards, overrides,
      quotes, concentrationCap, watchlist, today,
    });
  }, [
    loading, quotesSettled, lots, cashEvents, trades, milestones, pileParked, carryforwards,
    overrides, quotes, concentrationCap, watchlist, today,
  ]);
}

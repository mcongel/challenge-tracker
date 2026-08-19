import { useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import { priceMapFor } from './alerts';
import {
  accountTotal, cumulativeFloor, reservedTotal, shadowValue, totalScore,
} from './engine';

/** The score family in one memo — Dashboard, Benchmark, and Milestones each
 * re-derived priceMap/account/score inline (four copies of the same
 * incantation before this existed). */
export function useScoreSummary() {
  const { lots, cashEvents, milestones, benchmarkDeposits, overrides, quotes } = useData();
  return useMemo(() => {
    const priceMap = priceMapFor(lots, overrides, quotes);
    const account = accountTotal(lots, priceMap, cashEvents);
    const vooToday = overrides['VOO'] ?? quotes['VOO'];
    return {
      priceMap,
      account,
      floor: cumulativeFloor(milestones),
      reserved: reservedTotal(cashEvents),
      score: totalScore(lots, priceMap, cashEvents, milestones),
      vooToday,
      /** null until a VOO price exists — callers show a placeholder. */
      shadow: vooToday ? shadowValue(benchmarkDeposits, vooToday) : null,
    };
  }, [lots, cashEvents, milestones, benchmarkDeposits, overrides, quotes]);
}

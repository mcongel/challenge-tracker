/** The small-table mutations — settings, watchlist, pile-tax set-asides,
 * carryforwards, price overrides, scenarios — extracted whole from
 * DataContext. Everything here either refetches ONLY its own table or
 * patches state in place; none of it needs the 20-table refresh. */

import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  Expense, IncomeScenario, PileTaxSetAside, ScenarioRotation, WatchlistItem,
} from '../../lib/engine';
import { roundCents } from '../../lib/engine';
import {
  db, expensePayload, fetchAll, incomeScenarioPayload, mapExpense, mapIncomeScenario,
  mapScenarioRotation, mapWatchlistItem, pileTaxSetAsidePayload, scenarioRotationPayload,
  watchlistItemPayload,
} from '../../lib/db';
import type { DataState } from '../DataContext';

export function useSmallTables(args: {
  incomeScenarios: IncomeScenario[];
  scenarioRotations: ScenarioRotation[];
  setState: Dispatch<SetStateAction<DataState>>;
  refresh: () => Promise<void>;
}) {
  const { incomeScenarios, scenarioRotations, setState, refresh } = args;

  const refreshSettings = useCallback(async () => {
    const client = db();
    const { data, error: err } = await fetchAll(() =>
      client.from('app_settings').select('*').order('key'),
    );
    if (err) throw err;
    setState((prev) => ({
      ...prev,
      settings: Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value])),
    }));
  }, [setState]);

  const refreshWatchlist = useCallback(async () => {
    const client = db();
    const { data, error: err } = await fetchAll(() =>
      client.from('watchlist').select('*').order('catalyst_date', { nullsFirst: false }).order('id'),
    );
    if (err) throw err;
    setState((prev) => ({ ...prev, watchlist: (data ?? []).map(mapWatchlistItem) }));
  }, [setState]);

  const refreshExpenses = useCallback(async () => {
    const client = db();
    const { data, error: err } = await fetchAll(() =>
      client.from('expenses').select('*').order('amount').order('id'),
    );
    if (err) throw err;
    setState((prev) => ({ ...prev, expenses: (data ?? []).map(mapExpense) }));
  }, [setState]);

  const addExpense = useCallback(
    async (e: Omit<Expense, 'id' | 'createdAt'>) => {
      const { error: err } = await db().from('expenses').insert(expensePayload(e));
      if (err) throw err;
      await refreshExpenses();
    },
    [refreshExpenses],
  );
  const updateExpense = useCallback(
    async (id: string, e: Omit<Expense, 'id' | 'createdAt'>) => {
      const { error: err } = await db().from('expenses').update(expensePayload(e)).eq('id', id);
      if (err) throw err;
      await refreshExpenses();
    },
    [refreshExpenses],
  );
  const deleteExpense = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('expenses').delete().eq('id', id);
      if (err) throw err;
      await refreshExpenses();
    },
    [refreshExpenses],
  );

  const updateSetting = useCallback(
    async (key: string, value: unknown) => {
      const { error: err } = await db()
        .from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() });
      if (err) throw err;
      await refreshSettings();
    },
    [refreshSettings],
  );

  /** Several settings in one atomic upsert + one refresh — a partial save
   * must not leave a mixed rate set behind. */
  const updateSettings = useCallback(
    async (entries: Record<string, unknown>) => {
      const updated_at = new Date().toISOString();
      const rows = Object.entries(entries).map(([key, value]) => ({ key, value, updated_at }));
      const { error: err } = await db().from('app_settings').upsert(rows);
      if (err) throw err;
      await refreshSettings();
    },
    [refreshSettings],
  );

  /** Bench management — plain CRUD, context only. */
  const addWatchlistItem = useCallback(
    async (w: Omit<WatchlistItem, 'id' | 'createdAt'>) => {
      const { error: err } = await db().from('watchlist').insert(watchlistItemPayload(w));
      if (err) throw err;
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  const updateWatchlistItem = useCallback(
    async (id: string, w: Omit<WatchlistItem, 'id' | 'createdAt'>) => {
      const { error: err } = await db()
        .from('watchlist').update(watchlistItemPayload(w)).eq('id', id);
      if (err) throw err;
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  const addPileTaxSetAside = useCallback(
    async (s: Omit<PileTaxSetAside, 'id'>) => {
      const { error: err } = await db().from('pile_tax_set_asides').insert(pileTaxSetAsidePayload(s));
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const deletePileTaxSetAside = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('pile_tax_set_asides').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const deleteWatchlistItem = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('watchlist').delete().eq('id', id);
      if (err) throw err;
      await refreshWatchlist();
    },
    [refreshWatchlist],
  );

  /** The January ritual: after the 1099 arrives, record (or correct) the
   * loss carried into a tax year. Null amount removes the row. */
  const setCarryforward = useCallback(
    async (taxYear: number, amount: number | null) => {
      const client = db();
      if (amount == null) {
        const { error: err } = await client
          .from('loss_carryforwards').delete().eq('tax_year', taxYear);
        if (err) throw err;
      } else {
        const { error: err } = await client
          .from('loss_carryforwards')
          .upsert({ tax_year: taxYear, amount: roundCents(amount) }, { onConflict: 'tax_year' });
        if (err) throw err;
      }
      await refresh();
    },
    [refresh],
  );

  /** Scenario tables are pure what-ifs with zero cross-effects on the rest
   * of the app — their mutations refetch only these two tables instead of
   * the full refresh. */
  const refreshScenarios = useCallback(async () => {
    const client = db();
    const [scen, rots] = await Promise.all([
      fetchAll(() => client.from('income_scenarios').select('*').order('created_at').order('id')),
      fetchAll(() => client.from('scenario_rotations').select('*').order('rotation_date').order('id')),
    ]);
    if (scen.error) throw scen.error;
    if (rots.error) throw rots.error;
    setState((prev) => ({
      ...prev,
      incomeScenarios: (scen.data ?? []).map(mapIncomeScenario),
      scenarioRotations: (rots.data ?? []).map(mapScenarioRotation),
    }));
  }, [setState]);

  const addScenario = useCallback(
    async (s: Omit<IncomeScenario, 'id' | 'createdAt'>) => {
      const { error: err } = await db().from('income_scenarios').insert(incomeScenarioPayload(s));
      if (err) throw err;
      await refreshScenarios();
    },
    [refreshScenarios],
  );

  const updateScenario = useCallback(
    async (id: string, patch: Partial<Omit<IncomeScenario, 'id' | 'createdAt'>>) => {
      const payload: Record<string, unknown> = {};
      if (patch.name !== undefined) payload.name = patch.name;
      if (patch.description !== undefined) payload.description = patch.description;
      if (patch.targetAnnualIncome !== undefined) payload.target_annual_income = patch.targetAnnualIncome;
      if (patch.targetYear !== undefined) payload.target_year = patch.targetYear;
      if (patch.isActive !== undefined) payload.is_active = patch.isActive;
      if (patch.qualifiedRate !== undefined) payload.qualified_rate = patch.qualifiedRate;
      if (patch.ordinaryRate !== undefined) payload.ordinary_rate = patch.ordinaryRate;
      if (patch.capitalGainRate !== undefined) payload.capital_gain_rate = patch.capitalGainRate;
      const { error: err } = await db().from('income_scenarios').update(payload).eq('id', id);
      if (err) throw err;
      await refreshScenarios();
    },
    [refreshScenarios],
  );

  const deleteScenario = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('income_scenarios').delete().eq('id', id);
      if (err) throw err; // rotations cascade
      await refreshScenarios();
    },
    [refreshScenarios],
  );

  const duplicateScenario = useCallback(
    async (id: string) => {
      const client = db();
      const src = incomeScenarios.find((s) => s.id === id);
      if (!src) throw new Error('Scenario not found');
      const { data, error: err } = await client
        .from('income_scenarios')
        .insert(incomeScenarioPayload({ ...src, name: `${src.name} (copy)`, isActive: false }))
        .select('id')
        .single();
      if (err) throw err;
      const rotations = scenarioRotations.filter((r) => r.scenarioId === id);
      if (rotations.length > 0) {
        const { error: rotErr } = await client.from('scenario_rotations').insert(
          rotations.map((r) => scenarioRotationPayload({ ...r, scenarioId: data.id as string })),
        );
        if (rotErr) throw rotErr;
      }
      await refreshScenarios();
    },
    [refreshScenarios, incomeScenarios, scenarioRotations],
  );

  const addRotation = useCallback(
    async (r: Omit<ScenarioRotation, 'id'>) => {
      const { error: err } = await db().from('scenario_rotations').insert(scenarioRotationPayload(r));
      if (err) throw err;
      await refreshScenarios();
    },
    [refreshScenarios],
  );

  const updateRotation = useCallback(
    async (id: string, r: Omit<ScenarioRotation, 'id'>) => {
      const { error: err } = await db()
        .from('scenario_rotations').update(scenarioRotationPayload(r)).eq('id', id);
      if (err) throw err;
      await refreshScenarios();
    },
    [refreshScenarios],
  );

  const deleteRotation = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('scenario_rotations').delete().eq('id', id);
      if (err) throw err;
      await refreshScenarios();
    },
    [refreshScenarios],
  );

  const setOverride = useCallback(
    async (ticker: string, price: number) => {
      const set_at = new Date().toISOString();
      const { error: err } = await db()
        .from('price_overrides')
        .upsert({ ticker, price, set_at });
      if (err) throw err;
      // Overrides live wholly in state.overrides — patch, don't re-pull 20 tables.
      setState((prev) => ({
        ...prev,
        overrides: { ...prev.overrides, [ticker]: price },
        overrideSetAt: { ...prev.overrideSetAt, [ticker]: set_at },
      }));
    },
    [setState],
  );

  const updateParkedPrices = useCallback(
    async (entries: { id: string; price: number }[]) => {
      if (entries.length === 0) return;
      const client = db();
      // Concurrent single-row updates, then a local patch. On any failure,
      // resync from the DB before surfacing — some rows may have written.
      const results = await Promise.all(
        entries.map((e) =>
          client.from('parked_positions').update({ current_price: e.price }).eq('id', e.id),
        ),
      );
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) {
        await refresh();
        throw firstErr;
      }
      const byId = new Map(entries.map((e) => [e.id, e.price]));
      setState((prev) => ({
        ...prev,
        parked: prev.parked.map((p) =>
          byId.has(p.id) ? { ...p, currentPrice: byId.get(p.id)! } : p,
        ),
      }));
    },
    [refresh, setState],
  );

  const setOverrides = useCallback(
    async (entries: { ticker: string; price: number }[]) => {
      if (entries.length === 0) return;
      const set_at = new Date().toISOString();
      const { error: err } = await db()
        .from('price_overrides')
        .upsert(entries.map((e) => ({ ticker: e.ticker, price: e.price, set_at })));
      if (err) throw err;
      setState((prev) => ({
        ...prev,
        overrides: {
          ...prev.overrides,
          ...Object.fromEntries(entries.map((e) => [e.ticker, e.price])),
        },
        overrideSetAt: {
          ...prev.overrideSetAt,
          ...Object.fromEntries(entries.map((e) => [e.ticker, set_at])),
        },
      }));
    },
    [setState],
  );

  const clearOverride = useCallback(
    async (ticker: string) => {
      const { error: err } = await db().from('price_overrides').delete().eq('ticker', ticker);
      if (err) throw err;
      setState((prev) => {
        const overrides = { ...prev.overrides };
        const overrideSetAt = { ...prev.overrideSetAt };
        delete overrides[ticker];
        delete overrideSetAt[ticker];
        return { ...prev, overrides, overrideSetAt };
      });
    },
    [setState],
  );

  return {
    updateSetting, updateSettings,
    addWatchlistItem, updateWatchlistItem, deleteWatchlistItem,
    addExpense, updateExpense, deleteExpense,
    addPileTaxSetAside, deletePileTaxSetAside, setCarryforward,
    refreshScenarios, addScenario, updateScenario, deleteScenario, duplicateScenario,
    addRotation, updateRotation, deleteRotation,
    setOverride, setOverrides, clearOverride, updateParkedPrices,
  };
}

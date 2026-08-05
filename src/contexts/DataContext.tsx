import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  BenchmarkDeposit,
  CashEvent,
  CloseAllocation,
  LossCarryforward,
  MilestoneRecord,
  ParkedPosition,
  PositionLot,
  Snapshot,
  Trade,
} from '../lib/engine';
import { closeShares, roundCents } from '../lib/engine';
import {
  cashEventPayload,
  db,
  lotPayload,
  mapBenchmarkDeposit,
  mapCarryforward,
  mapCashEvent,
  mapLot,
  mapMilestone,
  mapParked,
  mapSnapshot,
  mapTrade,
  milestonePayload,
  tradePayload,
} from '../lib/db';

interface DataState {
  cashEvents: CashEvent[];
  lots: PositionLot[];
  trades: Trade[];
  milestones: (MilestoneRecord & { id: string })[];
  benchmarkDeposits: BenchmarkDeposit[];
  parked: ParkedPosition[];
  snapshots: Snapshot[];
  carryforwards: LossCarryforward[];
  /** Pinned manual prices — beat API quotes until cleared. */
  overrides: Record<string, number>;
}

const EMPTY: DataState = {
  cashEvents: [],
  lots: [],
  trades: [],
  milestones: [],
  benchmarkDeposits: [],
  parked: [],
  snapshots: [],
  carryforwards: [],
  overrides: {},
};

interface DataContextValue extends DataState {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** For a Deposit, pass that day's VOO price to create the shadow twin. */
  addCashEvent: (e: Omit<CashEvent, 'id'>, vooPriceThatDay?: number) => Promise<void>;
  deleteCashEvent: (id: string) => Promise<void>;
  /** Creates the lot AND its Buy cash event. */
  addLot: (lot: Omit<PositionLot, 'id'>) => Promise<void>;
  /** FIFO (or per-lot allocated) close: trades + Sell cash event + lot updates. */
  closePosition: (
    ticker: string,
    shares: number,
    pricePerShare: number,
    closeDate: string,
    allocations?: CloseAllocation[],
  ) => Promise<void>;
  recordSplit: (ticker: string, ratio: number, date: string) => Promise<void>;
  setTradeWashSale: (id: string, washSale: boolean) => Promise<void>;
  deleteTrade: (id: string) => Promise<void>;
  updateParked: (id: string, patch: Partial<Omit<ParkedPosition, 'id'>>) => Promise<void>;
  recordMilestone: (m: MilestoneRecord) => Promise<void>;
  setOverride: (ticker: string, price: number) => Promise<void>;
  clearOverride: (ticker: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DataState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const client = db();
      const [cash, lots, trades, milestones, bench, parked, snaps, carry, overrides] =
        await Promise.all([
          client.from('cash_events').select('*').order('date').order('created_at'),
          client.from('position_lots').select('*').order('buy_date'),
          client.from('trades').select('*').order('close_date'),
          client.from('milestones').select('*').order('level'),
          client.from('benchmark_deposits').select('*').order('date'),
          client.from('parked_positions').select('*').order('ticker'),
          client.from('snapshots').select('*').order('date'),
          client.from('loss_carryforwards').select('*'),
          client.from('price_overrides').select('*'),
        ]);
      const firstError =
        cash.error ?? lots.error ?? trades.error ?? milestones.error ?? bench.error ??
        parked.error ?? snaps.error ?? carry.error ?? overrides.error;
      if (firstError) throw firstError;
      setState({
        cashEvents: (cash.data ?? []).map(mapCashEvent),
        lots: (lots.data ?? []).map(mapLot),
        trades: (trades.data ?? []).map(mapTrade),
        milestones: (milestones.data ?? []).map(mapMilestone),
        benchmarkDeposits: (bench.data ?? []).map(mapBenchmarkDeposit),
        parked: (parked.data ?? []).map(mapParked),
        snapshots: (snaps.data ?? []).map(mapSnapshot),
        carryforwards: (carry.data ?? []).map(mapCarryforward),
        overrides: Object.fromEntries(
          (overrides.data ?? []).map((r) => [r.ticker, Number(r.price)]),
        ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCashEvent = useCallback(
    async (e: Omit<CashEvent, 'id'>, vooPriceThatDay?: number) => {
      const client = db();
      const { error: err } = await client.from('cash_events').insert(cashEventPayload(e));
      if (err) throw err;
      if (e.type === 'Deposit' && vooPriceThatDay) {
        const { error: benchErr } = await client
          .from('benchmark_deposits')
          .insert({ date: e.date, amount: e.amount, voo_price_that_day: vooPriceThatDay });
        if (benchErr) throw benchErr;
      }
      await refresh();
    },
    [refresh],
  );

  const deleteCashEvent = useCallback(
    async (id: string) => {
      const client = db();
      const event = state.cashEvents.find((e) => e.id === id);
      const { error: err } = await client.from('cash_events').delete().eq('id', id);
      if (err) throw err;
      // A deposit's shadow twin goes with it (matched on date + amount).
      if (event?.type === 'Deposit') {
        const twin = state.benchmarkDeposits.find(
          (b) => b.date === event.date && b.amount === event.amount,
        );
        if (twin) await client.from('benchmark_deposits').delete().eq('id', twin.id);
      }
      await refresh();
    },
    [refresh, state.cashEvents, state.benchmarkDeposits],
  );

  const addLot = useCallback(
    async (lot: Omit<PositionLot, 'id'>) => {
      const client = db();
      const { error: err } = await client.from('position_lots').insert(lotPayload(lot));
      if (err) throw err;
      const { error: cashErr } = await client.from('cash_events').insert(
        cashEventPayload({
          date: lot.buyDate,
          type: 'Buy',
          amount: roundCents(lot.shares * lot.avgCost),
          ticker: lot.ticker,
        }),
      );
      if (cashErr) throw cashErr;
      await refresh();
    },
    [refresh],
  );

  const closePosition = useCallback(
    async (
      ticker: string,
      shares: number,
      pricePerShare: number,
      closeDate: string,
      allocations?: CloseAllocation[],
    ) => {
      const client = db();
      const result = closeShares(state.lots, ticker, shares, pricePerShare, closeDate, allocations);

      const { error: tradeErr } = await client.from('trades').insert(
        result.trades.map((t) =>
          tradePayload({
            ...t,
            costBasis: roundCents(t.costBasis),
            proceeds: roundCents(t.proceeds),
            washSale: false,
          }),
        ),
      );
      if (tradeErr) throw tradeErr;

      const before = state.lots.filter((l) => l.ticker === ticker);
      const afterById = new Map(
        result.remainingLots.filter((l) => l.ticker === ticker).map((l) => [l.id, l]),
      );
      for (const lot of before) {
        const after = afterById.get(lot.id);
        if (!after) {
          const { error: err } = await client.from('position_lots').delete().eq('id', lot.id);
          if (err) throw err;
        } else if (after.shares !== lot.shares) {
          const { error: err } = await client
            .from('position_lots')
            .update({ shares: after.shares })
            .eq('id', lot.id);
          if (err) throw err;
        }
      }

      const { error: cashErr } = await client.from('cash_events').insert(
        cashEventPayload({
          date: closeDate,
          type: 'Sell',
          amount: roundCents(result.totalProceeds),
          ticker,
        }),
      );
      if (cashErr) throw cashErr;
      await refresh();
    },
    [refresh, state.lots],
  );

  const recordSplit = useCallback(
    async (ticker: string, ratio: number, date: string) => {
      const client = db();
      const note = `${ratio}:1 split recorded ${date}`;
      for (const lot of state.lots.filter((l) => l.ticker === ticker)) {
        const { error: err } = await client
          .from('position_lots')
          .update({
            shares: lot.shares * ratio,
            avg_cost: lot.avgCost / ratio,
            thesis: lot.thesis ? `${lot.thesis} · ${note}` : note,
          })
          .eq('id', lot.id);
        if (err) throw err;
      }
      for (const p of state.parked.filter((p) => p.ticker === ticker)) {
        const { error: err } = await client
          .from('parked_positions')
          .update({
            shares: p.shares * ratio,
            avg_cost: p.avgCost / ratio,
            notes: p.notes ? `${p.notes} · ${note}` : note,
          })
          .eq('id', p.id);
        if (err) throw err;
      }
      await refresh();
    },
    [refresh, state.lots, state.parked],
  );

  const setTradeWashSale = useCallback(
    async (id: string, washSale: boolean) => {
      const { error: err } = await db().from('trades').update({ wash_sale: washSale }).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const deleteTrade = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('trades').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const updateParked = useCallback(
    async (id: string, patch: Partial<Omit<ParkedPosition, 'id'>>) => {
      const payload: Record<string, unknown> = {};
      if (patch.shares !== undefined) payload.shares = patch.shares;
      if (patch.avgCost !== undefined) payload.avg_cost = patch.avgCost;
      if (patch.currentPrice !== undefined) payload.current_price = patch.currentPrice;
      if (patch.buyDate !== undefined) payload.buy_date = patch.buyDate;
      if (patch.trimRank !== undefined) payload.trim_rank = patch.trimRank;
      if (patch.notes !== undefined) payload.notes = patch.notes;
      if (patch.category !== undefined) payload.category = patch.category;
      const { error: err } = await db().from('parked_positions').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const recordMilestone = useCallback(
    async (m: MilestoneRecord) => {
      const client = db();
      const { error: err } = await client.from('milestones').insert(milestonePayload(m));
      if (err) throw err;
      const { error: cashErr } = await client.from('cash_events').insert(
        cashEventPayload({
          date: m.dateHit,
          type: 'MilestoneBank',
          amount: m.amountBanked,
          sourceDestination: m.parkedDestination ?? 'VOO (parked pile)',
          notes: `Milestone ${m.level} banked`,
        }),
      );
      if (cashErr) throw cashErr;
      await refresh();
    },
    [refresh],
  );

  const setOverride = useCallback(
    async (ticker: string, price: number) => {
      const { error: err } = await db()
        .from('price_overrides')
        .upsert({ ticker, price, set_at: new Date().toISOString() });
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const clearOverride = useCallback(
    async (ticker: string) => {
      const { error: err } = await db().from('price_overrides').delete().eq('ticker', ticker);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const value = useMemo(
    () => ({
      ...state,
      loading,
      error,
      refresh,
      addCashEvent,
      deleteCashEvent,
      addLot,
      closePosition,
      recordSplit,
      setTradeWashSale,
      deleteTrade,
      updateParked,
      recordMilestone,
      setOverride,
      clearOverride,
    }),
    [
      state, loading, error, refresh, addCashEvent, deleteCashEvent, addLot, closePosition,
      recordSplit, setTradeWashSale, deleteTrade, updateParked, recordMilestone, setOverride,
      clearOverride,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}

/** Manual override wins (pinned); fall back to the lot's cost so unrealized reads 0, not -100%. */
export function priceFor(overrides: Record<string, number>, ticker: string, fallback: number): number {
  return overrides[ticker] ?? fallback;
}

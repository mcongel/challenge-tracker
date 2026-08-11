import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Account,
  AccountKind,
  BenchmarkDeposit,
  CashEvent,
  CloseAllocation,
  LossCarryforward,
  MilestoneRecord,
  OutsideSale,
  ParkedPosition,
  PositionLot,
  Snapshot,
  Trade,
} from '../lib/engine';
import {
  accountTotal, aggregateLots, closeShares, computeAccountCash, concentration, consumeLotsFifo,
  cumulativeFloor, LT_TAX_RATE, netContributed, ORDINARY_DIVIDEND_TAX_RATE, pileTotal,
  QUALIFIED_DIVIDEND_TAX_RATE, reservedTotal, roundCents, shadowValue, ST_TAX_RATE, totalScore,
  trimPreview,
} from '../lib/engine';
import type {
  AccountCashBreakdown, DividendClassification, DividendTaxRates, ParkedCashEvent, ParkedLot,
  ParkedLotAdjustment, ParkedSale,
} from '../lib/engine';
import { priceMapFor } from '../lib/alerts';
import { todayISO } from '../lib/utils';
import {
  cashEventPayload,
  db,
  lotPayload,
  mapParkedLot,
  parkedLotPayload,
  mapParkedSale,
  parkedSalePayload,
  mapParkedCashEvent,
  parkedCashEventPayload,
  mapParkedLotAdjustment,
  parkedLotAdjustmentPayload,
  mapAccount,
  mapBenchmarkDeposit,
  mapCarryforward,
  mapCashEvent,
  mapLot,
  mapMilestone,
  mapOutsideSale,
  mapParked,
  mapSnapshot,
  mapTrade,
  milestonePayload,
  outsideSalePayload,
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
  /** challenge.app_settings rows, key → jsonb value. */
  settings: Record<string, unknown>;
  /** Where money lives. Labels and context only — never score math. */
  accounts: Account[];
  outsideSales: OutsideSale[];
  /** Dated slices of parked positions — purchases and dividends. */
  parkedLots: ParkedLot[];
  /** The pile's own sale log — never score/YTD/tax math. */
  parkedSales: ParkedSale[];
  /** Manual cash movements in non-challenge accounts. */
  parkedCashEvents: ParkedCashEvent[];
  /** ROC basis reductions per share lot — original lot amounts stay intact. */
  parkedLotAdjustments: ParkedLotAdjustment[];
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
  settings: {},
  accounts: [],
  outsideSales: [],
  parkedLots: [],
  parkedSales: [],
  parkedCashEvents: [],
  parkedLotAdjustments: [],
};

interface DataContextValue extends DataState {
  loading: boolean;
  error: string | null;
  /** Rule 12 cap from app_settings; null (feature off) if the row is missing. */
  contributionCap: number | null;
  /** Semi/AI concentration cap (editable, default 50%). */
  concentrationCap: number;
  /** Pile capital-gains estimate rates from app_settings (defaults 21%/29%). */
  ltTaxRate: number;
  stTaxRate: number;
  /** Dividend estimate rates (informational — never the 30% reserve rule). */
  dividendTaxRates: DividendTaxRates;
  updateSetting: (key: string, value: unknown) => Promise<void>;
  /** Batch variant: one atomic upsert + one refresh for several keys. */
  updateSettings: (entries: Record<string, unknown>) => Promise<void>;
  /** Delayed API quotes (override-free). Merged view: overrides win. */
  quotes: Record<string, number>;
  /** The day's move per ticker, straight from the quote feed. */
  dayChange: Record<string, { change: number | null; changePct: number | null }>;
  quotesAsOf: number | null;
  refreshQuotes: () => Promise<void>;
  /** Company names by ticker (best-effort; ETFs may be absent). */
  tickerNames: Record<string, string>;
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
  /** Optionally finishes the story: the 25% buys VOO in the parked pile. */
  recordMilestone: (
    m: MilestoneRecord,
    voo?: { accountId: string; price: number },
  ) => Promise<void>;
  addAccount: (name: string, kind: AccountKind, broker?: string) => Promise<void>;
  addOutsideSale: (sale: Omit<OutsideSale, 'id'>) => Promise<void>;
  deleteOutsideSale: (id: string) => Promise<void>;
  /** The trim flow in one action: shrink (or remove) the parked position,
   * log the outside sale for the wash-sale radar, and optionally deposit the
   * proceeds into the challenge account (with its shadow VOO twin). */
  recordTrim: (args: {
    parkedId: string;
    shares: number;
    pricePerShare: number;
    date: string;
    depositVooPrice?: number;
  }) => Promise<void>;
  addParkedLot: (lot: Omit<ParkedLot, 'id'>) => Promise<void>;
  deleteParkedLot: (id: string) => Promise<void>;
  /** 1099 correction: change a dividend's classification; stamps reclassified_at. */
  reclassifyDividend: (
    id: string,
    classification: DividendClassification,
    exDate?: string | null,
  ) => Promise<void>;
  /** New parked holding: creates the position and its first purchase lot. */
  addParkedPosition: (args: {
    ticker: string;
    accountId: string;
    category: ParkedPosition['category'];
    date: string | null;
    shares: number;
    price: number;
    notes?: string | null;
  }) => Promise<void>;
  deleteParkedSale: (id: string) => Promise<void>;
  /** ACATS-style move between accounts: lot slices keep their original dates
   * and basis (holding periods survive a transfer), oldest lots first. Not a
   * sale — no history entry, no wash-sale involvement. */
  transferParked: (args: {
    parkedId: string;
    toAccountId: string;
    shares: number;
    date: string;
  }) => Promise<void>;
  /** Tracked cash per non-challenge account (auto-flows + manual events). */
  accountCash: (accountId: string) => AccountCashBreakdown;
  addParkedCashEvent: (e: Omit<ParkedCashEvent, 'id'>) => Promise<void>;
  deleteParkedCashEvent: (id: string) => Promise<void>;
  /** The reconcile piece: writes an adjustment for actual − tracked. */
  reconcileAccountCash: (accountId: string, actualBalance: number) => Promise<void>;
  /** History corrections: basis, term, funded flag, date, notes. */
  updateParkedSale: (
    id: string,
    patch: Partial<Pick<ParkedSale, 'date' | 'costBasis' | 'ltShares' | 'fundedChallenge' | 'notes'>>,
  ) => Promise<void>;
  /** Rows seeded from the workbook, identified by EXAMPLE in their notes. */
  exampleData: { cashEvents: CashEvent[]; lots: PositionLot[]; trades: Trade[]; total: number };
  clearExampleData: () => Promise<void>;
  setOverride: (ticker: string, price: number) => Promise<void>;
  clearOverride: (ticker: string) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DataState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [dayChange, setDayChange] = useState<
    Record<string, { change: number | null; changePct: number | null }>
  >({});
  const [quotesAsOf, setQuotesAsOf] = useState<number | null>(null);
  const [tickerNames, setTickerNames] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const client = db();
      const [
        cash, lots, trades, milestones, bench, parked, snaps, carry, overrides, settings,
        accounts, outsideSales, parkedLots, parkedSales, parkedCashEvents, parkedLotAdjustments,
      ] = await Promise.all([
        client.from('cash_events').select('*').order('date').order('created_at'),
        client.from('position_lots').select('*').order('buy_date'),
        client.from('trades').select('*').order('close_date'),
        client.from('milestones').select('*').order('level'),
        client.from('benchmark_deposits').select('*').order('date'),
        client.from('parked_positions').select('*, account:accounts(name)').order('ticker'),
        client.from('snapshots').select('*').order('date'),
        client.from('loss_carryforwards').select('*'),
        client.from('price_overrides').select('*'),
        client.from('app_settings').select('*'),
        client.from('accounts').select('*').order('name'),
        client.from('outside_sales').select('*').order('sale_date'),
        client.from('parked_lots').select('*').order('date', { nullsFirst: true }),
        client.from('parked_sales').select('*').order('date'),
        client.from('parked_cash_events').select('*').order('date'),
        client.from('parked_lot_adjustments').select('*'),
      ]);
      const firstError =
        cash.error ?? lots.error ?? trades.error ?? milestones.error ?? bench.error ??
        parked.error ?? snaps.error ?? carry.error ?? overrides.error ?? settings.error ??
        accounts.error ?? outsideSales.error ?? parkedLots.error ?? parkedSales.error ??
        parkedCashEvents.error ?? parkedLotAdjustments.error;
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
        settings: Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value])),
        accounts: (accounts.data ?? []).map(mapAccount),
        outsideSales: (outsideSales.data ?? []).map(mapOutsideSale),
        parkedLots: (parkedLots.data ?? []).map(mapParkedLot),
        parkedSales: (parkedSales.data ?? []).map(mapParkedSale),
        parkedCashEvents: (parkedCashEvents.data ?? []).map(mapParkedCashEvent),
        parkedLotAdjustments: (parkedLotAdjustments.data ?? []).map(mapParkedLotAdjustment),
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

  /**
   * Write fresh quotes back onto parked_positions.current_price for every row
   * of that ticker. The stored price is only ever a fallback (overrides and
   * live quotes win), but it's what the app and the snapshot script use when
   * the feed misses a ticker — so it must not rot into a months-old number.
   * Price belongs to the ticker, so all of its rows get the same value.
   */
  const persistQuotedPrices = useCallback(
    async (fresh: Record<string, { price: number }>) => {
      const stale = state.parked.filter((p) => {
        const quoted = fresh[p.ticker]?.price;
        // 0.5c tolerance keeps us from writing on every rounding wobble.
        return quoted !== undefined && Math.abs(quoted - p.currentPrice) > 0.005;
      });
      if (stale.length === 0) return;
      const client = db();
      for (const p of stale) {
        const price = fresh[p.ticker].price;
        const { error: err } = await client
          .from('parked_positions')
          .update({ current_price: Math.round(price * 10000) / 10000 })
          .eq('id', p.id);
        if (err) return; // best-effort; live quotes still drive the UI
      }
      await refresh();
    },
    [state.parked, refresh],
  );

  const lastQuoteFetchAt = useRef(0);
  const refreshQuotes = useCallback(async () => {
    const tickers = [
      ...new Set([...state.lots.map((l) => l.ticker), ...state.parked.map((p) => p.ticker), 'VOO']),
    ];
    if (tickers.length === 0) return;
    try {
      const res = await fetch(`/api/quotes?tickers=${tickers.join(',')}`);
      if (!res.ok) return; // quotes are best-effort; overrides and cost fallbacks cover us
      const body = (await res.json()) as {
        quotes?: Record<string, { price: number; change?: number | null; changePct?: number | null }>;
        asOf?: number;
      };
      const fresh = body.quotes;
      if (fresh) {
        // Merge instead of replace: a throttled fetch that misses a ticker
        // shouldn't blank out the price we already had.
        setQuotes((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.entries(fresh).map(([t, q]) => [t, q.price])),
        }));
        setDayChange((prev) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(fresh).map(([t, q]) => [
              t,
              { change: q.change ?? null, changePct: q.changePct ?? null },
            ]),
          ),
        }));
        setQuotesAsOf(body.asOf ?? Date.now());
        lastQuoteFetchAt.current = Date.now();
        void persistQuotedPrices(fresh);
      }
    } catch {
      // Local dev without the Pages Function, or the API is down — silently fine.
    }
  }, [state.lots, state.parked, persistQuotedPrices]);

  const refreshQuotesRef = useRef(refreshQuotes);
  useEffect(() => {
    refreshQuotesRef.current = refreshQuotes;
  }, [refreshQuotes]);

  const quotesFetched = useRef(false);
  useEffect(() => {
    if (loading || error || quotesFetched.current) return;
    quotesFetched.current = true;
    void refreshQuotes();
    // Names once per session — they're cached a week server-side.
    const tickers = [
      ...new Set([...state.lots.map((l) => l.ticker), ...state.parked.map((p) => p.ticker)]),
    ];
    if (tickers.length > 0) {
      void fetch(`/api/names?tickers=${tickers.join(',')}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { names?: Record<string, string> } | null) => {
          if (body?.names) setTickerNames((prev) => ({ ...prev, ...body.names }));
        })
        .catch(() => {
          /* best-effort */
        });
    }
  }, [loading, error, refreshQuotes, state.lots, state.parked]);

  // Keep an open tab honest: refetch every 30 minutes (the server cache TTL)
  // and when the tab regains focus after going stale. Cache hits cost nothing.
  useEffect(() => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const FOCUS_STALE = 5 * 60 * 1000;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshQuotesRef.current();
    }, THIRTY_MIN);
    const onVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastQuoteFetchAt.current > FOCUS_STALE
      ) {
        void refreshQuotesRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Daily snapshot: one row per calendar day, written on first load. Skipped
  // until a VOO price exists — recording shadowValue = 0 would poison the
  // rolling-12-month verdict. The date PK makes concurrent writes harmless.
  const mergedParked = useMemo(
    () =>
      state.parked.map((p) => {
        const effective = state.overrides[p.ticker] ?? quotes[p.ticker];
        return effective !== undefined ? { ...p, currentPrice: effective } : p;
      }),
    [state.parked, state.overrides, quotes],
  );

  const snapshotAttempted = useRef(false);
  useEffect(() => {
    if (loading || error || snapshotAttempted.current) return;
    const today = todayISO();
    if (state.snapshots.some((s) => s.date === today)) return;
    const voo = state.overrides['VOO'] ?? quotes['VOO'];
    if (!voo) return;
    snapshotAttempted.current = true;
    const priceMap = priceMapFor(state.lots, state.overrides, quotes);
    const account = accountTotal(state.lots, priceMap, state.cashEvents);
    const payload = {
      date: today,
      account_value: roundCents(account),
      banked_total: roundCents(cumulativeFloor(state.milestones)),
      reserved_total: roundCents(reservedTotal(state.cashEvents)),
      total_score: roundCents(
        totalScore(state.lots, priceMap, state.cashEvents, state.milestones),
      ),
      shadow_voo_value: roundCents(shadowValue(state.benchmarkDeposits, voo)),
      net_contributed: roundCents(netContributed(state.cashEvents)),
      parked_pile_value: roundCents(pileTotal(mergedParked)),
      semi_ai_pct: Number(concentration(mergedParked).semiPct.toFixed(6)),
    };
    void db()
      .from('snapshots')
      .upsert(payload, { onConflict: 'date', ignoreDuplicates: true })
      .then(({ error: err }) => {
        if (!err) void refresh();
      });
  }, [loading, error, state, quotes, mergedParked, refresh]);

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
      if (patch.accountId !== undefined) payload.account_id = patch.accountId;
      if (patch.dividendRate !== undefined) payload.dividend_rate = patch.dividendRate;
      if (patch.dividendFrequency !== undefined) payload.dividend_frequency = patch.dividendFrequency;
      const { error: err } = await db().from('parked_positions').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const addAccount = useCallback(
    async (name: string, kind: AccountKind, broker?: string) => {
      const { error: err } = await db()
        .from('accounts')
        .insert({ name, kind, broker: broker || null });
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const addOutsideSale = useCallback(
    async (sale: Omit<OutsideSale, 'id'>) => {
      const { error: err } = await db().from('outside_sales').insert(outsideSalePayload(sale));
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const deleteOutsideSale = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('outside_sales').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  /** Recompute a position's shares/avg_cost from its lots; a position whose
   * lots hold no shares is removed (cascade takes the lot history). */
  const recomputeParkedAggregate = useCallback(async (positionId: string) => {
    const client = db();
    const { data, error: readErr } = await client
      .from('parked_lots').select('*').eq('parked_position_id', positionId);
    if (readErr) throw readErr;
    const agg = aggregateLots((data ?? []).map(mapParkedLot));
    if (agg.shares <= 1e-9) {
      const { error: err } = await client.from('parked_positions').delete().eq('id', positionId);
      if (err) throw err;
    } else {
      const { error: err } = await client
        .from('parked_positions')
        .update({ shares: agg.shares, avg_cost: Math.round(agg.avgCost * 10000) / 10000 })
        .eq('id', positionId);
      if (err) throw err;
    }
  }, []);

  const addParkedLot = useCallback(
    async (lot: Omit<ParkedLot, 'id'>) => {
      const { error: err } = await db().from('parked_lots').insert(parkedLotPayload(lot));
      if (err) throw err;
      await recomputeParkedAggregate(lot.parkedPositionId);
      await refresh();
    },
    [refresh, recomputeParkedAggregate],
  );

  /** Change a dividend's tax character. Confirming an 'unclassified' dividend
   * is normal bookkeeping; only a change to an already-confirmed class is a
   * true post-1099 correction and gets the reclassified stamp. Shares/amount
   * untouched, so no aggregate recompute. */
  const reclassifyDividend = useCallback(
    async (id: string, classification: DividendClassification, exDate?: string | null) => {
      const prior = state.parkedLots.find((l) => l.id === id)?.classification ?? 'unclassified';
      const payload: Record<string, unknown> = { classification };
      if (prior !== 'unclassified' && prior !== classification) {
        payload.reclassified_at = new Date().toISOString();
      }
      if (exDate !== undefined) payload.ex_date = exDate;
      const { error: err } = await db().from('parked_lots').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh, state.parkedLots],
  );

  const addParkedPosition = useCallback(
    async ({
      ticker, accountId, category, date, shares, price, notes,
    }: {
      ticker: string;
      accountId: string;
      category: ParkedPosition['category'];
      date: string | null;
      shares: number;
      price: number;
      notes?: string | null;
    }) => {
      const client = db();
      const { data, error: posErr } = await client
        .from('parked_positions')
        .insert({
          ticker: ticker.toUpperCase(),
          account_id: accountId,
          category,
          shares,
          avg_cost: price,
          current_price: price,
          notes: notes ?? null,
        })
        .select('id')
        .single();
      if (posErr) throw posErr;
      const { error: lotErr } = await client.from('parked_lots').insert(
        parkedLotPayload({
          parkedPositionId: data.id,
          date,
          source: 'purchase',
          shares,
          price,
          amount: roundCents(shares * price),
        }),
      );
      if (lotErr) throw lotErr;
      await refresh();
    },
    [refresh],
  );

  const deleteParkedLot = useCallback(
    async (id: string) => {
      const lot = state.parkedLots.find((l) => l.id === id);
      if (!lot) throw new Error('Lot not found');
      const { error: err } = await db().from('parked_lots').delete().eq('id', id);
      if (err) throw err;
      await recomputeParkedAggregate(lot.parkedPositionId);
      await refresh();
    },
    [refresh, recomputeParkedAggregate, state.parkedLots],
  );

  const deleteParkedSale = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('parked_sales').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const transferParked = useCallback(
    async ({
      parkedId, toAccountId, shares, date,
    }: {
      parkedId: string;
      toAccountId: string;
      shares: number;
      date: string;
    }) => {
      const client = db();
      const p = state.parked.find((x) => x.id === parkedId);
      if (!p) throw new Error('Parked position not found');
      if (toAccountId === p.accountId) throw new Error('Pick a different destination account.');
      if (shares <= 0) throw new Error('Shares must be positive');
      if (shares > p.shares + 1e-9) {
        throw new Error(`Only ${p.shares} shares parked; cannot transfer ${shares}`);
      }
      const positionLots = state.parkedLots.filter((l) => l.parkedPositionId === parkedId);
      if (positionLots.length === 0) throw new Error('No lots to transfer — add lots first.');
      const lotIds = new Set(positionLots.map((l) => l.id));
      const positionAdjustments = state.parkedLotAdjustments.filter((a) => lotIds.has(a.shareLotId));

      const fromName = p.account;
      const { updates, deletes, adjustmentUpdates, consumed } = consumeLotsFifo(
        positionLots, shares, positionAdjustments,
      );

      // Destination position: merge into an existing one or create it.
      let destId = state.parked.find(
        (x) => x.ticker === p.ticker && x.accountId === toAccountId,
      )?.id;
      if (!destId) {
        const { data, error: posErr } = await client
          .from('parked_positions')
          .insert({
            ticker: p.ticker,
            account_id: toAccountId,
            category: p.category,
            shares: 0.00000001, // placeholder; recomputed from lots below
            avg_cost: p.avgCost,
            current_price: p.currentPrice,
            trim_rank: p.trimRank ?? null,
            dividend_rate: p.dividendRate ?? null,
            dividend_frequency: p.dividendFrequency ?? null,
            notes: p.notes ?? null,
          })
          .select('id')
          .single();
        if (posErr) throw posErr;
        destId = data.id as string;
      }

      // Recreate the slices at the destination with dates/basis/source intact.
      // Dividend tax character (classification/ex-date/reclassified/ROC stamp)
      // must survive the move — consumed slices don't carry it, the source lot
      // does. Per-slice inserts (transfers are rare) so each new lot's id is
      // known: a slice whose basis was ROC-reduced gets a carried adjustment
      // row, keeping adjusted basis honest at the destination.
      const lotById = new Map(positionLots.map((l) => [l.id, l]));
      for (const c of consumed) {
        const src = lotById.get(c.id);
        const { data: newLot, error: lotErr } = await client
          .from('parked_lots')
          .insert(
            parkedLotPayload({
              parkedPositionId: destId as string,
              date: c.date,
              source: c.source,
              shares: c.shares,
              price: c.shares > 0 ? Math.round((c.amount / c.shares) * 10000) / 10000 : null,
              amount: c.amount,
              classification: src?.classification ?? null,
              exDate: src?.exDate ?? null,
              reclassifiedAt: src?.reclassifiedAt ?? null,
              rocAllocatedAt: src?.rocAllocatedAt ?? null,
              notes: `ACATS from ${fromName} ${date}`,
            }),
          )
          .select('id')
          .single();
        if (lotErr) throw lotErr;
        const carried = Math.round((c.amount - c.adjustedAmount) * 1e6) / 1e6;
        if (carried > 0) {
          const { error: adjErr } = await client.from('parked_lot_adjustments').insert(
            parkedLotAdjustmentPayload({
              shareLotId: newLot.id as string,
              dividendLotId: null,
              amount: carried,
            }),
          );
          if (adjErr) throw adjErr;
        }
      }

      // Then shrink the source (lots and their surviving adjustment rows).
      for (const u of updates) {
        const { error: err } = await client
          .from('parked_lots').update({ shares: u.shares, amount: u.amount }).eq('id', u.id);
        if (err) throw err;
      }
      for (const a of adjustmentUpdates) {
        const { error: err } = await client
          .from('parked_lot_adjustments').update({ amount: a.amount }).eq('id', a.id);
        if (err) throw err;
      }
      if (deletes.length > 0) {
        const { error: err } = await client.from('parked_lots').delete().in('id', deletes);
        if (err) throw err;
      }
      await recomputeParkedAggregate(destId);
      await recomputeParkedAggregate(parkedId);
      await refresh();
    },
    [refresh, state.parked, state.parkedLots, state.parkedLotAdjustments, recomputeParkedAggregate],
  );

  const accountCash = useCallback(
    (accountId: string) =>
      computeAccountCash(accountId, {
        parkedCashEvents: state.parkedCashEvents,
        parkedSales: state.parkedSales,
        parkedLots: state.parkedLots,
        parked: state.parked,
        cashEvents: state.cashEvents,
      }),
    [state.parkedCashEvents, state.parkedSales, state.parkedLots, state.parked, state.cashEvents],
  );

  const addParkedCashEvent = useCallback(
    async (e: Omit<ParkedCashEvent, 'id'>) => {
      const { error: err } = await db().from('parked_cash_events').insert(parkedCashEventPayload(e));
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const deleteParkedCashEvent = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('parked_cash_events').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const reconcileAccountCash = useCallback(
    async (accountId: string, actualBalance: number) => {
      const tracked = accountCash(accountId).balance;
      const diff = roundCents(actualBalance - tracked);
      if (Math.abs(diff) < 0.005) return; // already true
      const { error: err } = await db().from('parked_cash_events').insert(
        parkedCashEventPayload({
          accountId,
          date: todayISO(),
          type: 'adjustment',
          amount: diff,
          notes: `Reconciled to actual ${roundCents(actualBalance)}`,
        }),
      );
      if (err) throw err;
      await refresh();
    },
    [refresh, accountCash],
  );

  const updateParkedSale = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ParkedSale, 'date' | 'costBasis' | 'ltShares' | 'fundedChallenge' | 'notes'>>,
    ) => {
      const payload: Record<string, unknown> = {};
      if (patch.date !== undefined) payload.date = patch.date;
      if (patch.costBasis !== undefined) payload.cost_basis = patch.costBasis;
      if (patch.ltShares !== undefined) payload.lt_shares = patch.ltShares;
      if (patch.fundedChallenge !== undefined) payload.funded_challenge = patch.fundedChallenge;
      if (patch.notes !== undefined) payload.notes = patch.notes;
      const { error: err } = await db().from('parked_sales').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const recordTrim = useCallback(
    async ({
      parkedId, shares, pricePerShare, date, depositVooPrice,
    }: {
      parkedId: string;
      shares: number;
      pricePerShare: number;
      date: string;
      depositVooPrice?: number;
    }) => {
      const client = db();
      const p = state.parked.find((x) => x.id === parkedId);
      if (!p) throw new Error('Parked position not found');
      if (shares <= 0) throw new Error('Shares must be positive');
      if (shares > p.shares + 1e-9) {
        throw new Error(`Only ${p.shares} shares parked; cannot trim ${shares}`);
      }

      // Consume lots oldest-first so remaining basis and unlock clocks stay
      // honest — and so the sale record carries the real basis and LT split.
      const positionLots = state.parkedLots.filter((l) => l.parkedPositionId === parkedId);
      const lotIds = new Set(positionLots.map((l) => l.id));
      const positionAdjustments = state.parkedLotAdjustments.filter((a) => lotIds.has(a.shareLotId));
      let costBasis: number | null = null;
      let ltShares: number | null = null;
      if (positionLots.length > 0) {
        const preview = trimPreview(positionLots, shares, pricePerShare, date, positionAdjustments);
        // ROC-adjusted basis — what the sale is actually taxed against.
        costBasis = roundCents(preview.adjustedCostBasis);
        // Undated shares count as LT, matching estimatedPileTax's documented
        // assumption (and the TrimModal estimate).
        ltShares = preview.ltShares + preview.unknownShares;
        const { updates, deletes, adjustmentUpdates } = consumeLotsFifo(
          positionLots, shares, positionAdjustments,
        );
        for (const u of updates) {
          const { error: err } = await client
            .from('parked_lots').update({ shares: u.shares, amount: u.amount }).eq('id', u.id);
          if (err) throw err;
        }
        for (const a of adjustmentUpdates) {
          const { error: err } = await client
            .from('parked_lot_adjustments').update({ amount: a.amount }).eq('id', a.id);
          if (err) throw err;
        }
        if (deletes.length > 0) {
          const { error: err } = await client.from('parked_lots').delete().in('id', deletes);
          if (err) throw err;
        }
        await recomputeParkedAggregate(parkedId);
      } else {
        // No lot history (shouldn't happen post-migration) — adjust the aggregate directly.
        const remaining = p.shares - shares;
        if (remaining > 1e-9) {
          const { error: err } = await client
            .from('parked_positions').update({ shares: remaining }).eq('id', p.id);
          if (err) throw err;
        } else {
          const { error: err } = await client.from('parked_positions').delete().eq('id', p.id);
          if (err) throw err;
        }
      }

      const { error: saleErr } = await client.from('parked_sales').insert(
        parkedSalePayload({
          ticker: p.ticker,
          accountId: p.accountId,
          date,
          shares,
          pricePerShare,
          proceeds: roundCents(shares * pricePerShare),
          costBasis,
          ltShares,
          fundedChallenge: Boolean(depositVooPrice),
        }),
      );
      if (saleErr) throw saleErr;

      if (depositVooPrice) {
        const amount = roundCents(shares * pricePerShare);
        const { error: cashErr } = await client.from('cash_events').insert(
          cashEventPayload({
            date,
            type: 'Deposit',
            amount,
            sourceDestination: `${p.ticker} trim (${p.account})`,
            accountId: p.accountId,
          }),
        );
        if (cashErr) throw cashErr;
        const { error: benchErr } = await client
          .from('benchmark_deposits')
          .insert({ date, amount, voo_price_that_day: depositVooPrice });
        if (benchErr) throw benchErr;
      }
      await refresh();
    },
    [refresh, state.parked, state.parkedLots, state.parkedLotAdjustments, recomputeParkedAggregate],
  );

  const exampleData = useMemo(() => {
    const isEx = (notes?: string | null) => Boolean(notes && notes.toUpperCase().includes('EXAMPLE'));
    const cashEvents = state.cashEvents.filter((e) => isEx(e.notes));
    const lots = state.lots.filter((l) => isEx(l.thesis));
    const trades = state.trades.filter((t) => isEx(t.notes));
    return { cashEvents, lots, trades, total: cashEvents.length + lots.length + trades.length };
  }, [state.cashEvents, state.lots, state.trades]);

  const clearExampleData = useCallback(async () => {
    const client = db();
    // Shadow twins of example deposits go too (benchmark rows carry no notes).
    const benchIds = state.benchmarkDeposits
      .filter((b) =>
        exampleData.cashEvents.some(
          (e) => e.type === 'Deposit' && e.date === b.date && e.amount === b.amount,
        ),
      )
      .map((b) => b.id);
    const wipe = async (table: string, ids: string[]) => {
      if (ids.length === 0) return;
      const { error: err } = await client.from(table).delete().in('id', ids);
      if (err) throw err;
    };
    await wipe('trades', exampleData.trades.map((t) => t.id));
    await wipe('position_lots', exampleData.lots.map((l) => l.id));
    await wipe('cash_events', exampleData.cashEvents.map((e) => e.id));
    await wipe('benchmark_deposits', benchIds);
    // Snapshots recorded while example data was loaded are fiction — the race
    // chart would keep drawing the fake numbers forever. Reset history; the
    // next app open writes a fresh snapshot from real data.
    const { error: snapErr } = await client.from('snapshots').delete().gte('date', '1900-01-01');
    if (snapErr) throw snapErr;
    snapshotAttempted.current = false;
    await refresh();
  }, [refresh, state.benchmarkDeposits, exampleData]);

  const recordMilestone = useCallback(
    async (m: MilestoneRecord, voo?: { accountId: string; price: number }) => {
      const client = db();
      const { error: err } = await client.from('milestones').insert(milestonePayload(m));
      if (err) throw err;
      const { error: cashErr } = await client.from('cash_events').insert(
        cashEventPayload({
          date: m.dateHit,
          type: 'MilestoneBank',
          amount: m.amountBanked,
          sourceDestination: m.parkedDestination ?? 'VOO (parked pile)',
          destinationAccountId: voo?.accountId ?? null,
          notes: `Milestone ${m.level} banked`,
        }),
      );
      if (cashErr) throw cashErr;

      // The banked 25% buys VOO in the pile — record the position too.
      if (voo && voo.price > 0) {
        const shares = m.amountBanked / voo.price;
        const existing = state.parked.find(
          (p) => p.ticker === 'VOO' && p.accountId === voo.accountId,
        );
        let positionId = existing?.id;
        if (!positionId) {
          const { data, error: posErr } = await client
            .from('parked_positions')
            .insert({
              ticker: 'VOO',
              account_id: voo.accountId,
              category: 'Other',
              shares,
              avg_cost: voo.price,
              current_price: voo.price,
              notes: 'Banked floors — never trim fuel',
            })
            .select('id')
            .single();
          if (posErr) throw posErr;
          positionId = data.id as string;
        }
        const { error: lotErr } = await client.from('parked_lots').insert(
          parkedLotPayload({
            parkedPositionId: positionId,
            date: m.dateHit,
            source: 'purchase',
            shares,
            price: voo.price,
            amount: roundCents(m.amountBanked),
            notes: `Milestone ${m.level} bank`,
          }),
        );
        if (lotErr) throw lotErr;
        if (existing) await recomputeParkedAggregate(positionId);
      }
      await refresh();
    },
    [refresh, state.parked, recomputeParkedAggregate],
  );

  const updateSetting = useCallback(
    async (key: string, value: unknown) => {
      const { error: err } = await db()
        .from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() });
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  /** Several settings in one atomic upsert + one refresh — a partial save
   * must not leave a mixed rate set behind. */
  const updateSettings = useCallback(
    async (entries: Record<string, unknown>) => {
      const updated_at = new Date().toISOString();
      const rows = Object.entries(entries).map(([key, value]) => ({ key, value, updated_at }));
      const { error: err } = await db().from('app_settings').upsert(rows);
      if (err) throw err;
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

  const contributionCap =
    typeof state.settings.contribution_cap === 'number' ? state.settings.contribution_cap : null;
  const concentrationCap =
    typeof state.settings.concentration_cap === 'number' ? state.settings.concentration_cap : 0.5;
  const ltTaxRate =
    typeof state.settings.lt_tax_rate === 'number' ? state.settings.lt_tax_rate : LT_TAX_RATE;
  const stTaxRate =
    typeof state.settings.st_tax_rate === 'number' ? state.settings.st_tax_rate : ST_TAX_RATE;
  const qualifiedDividendTaxRate =
    typeof state.settings.qualified_dividend_tax_rate === 'number'
      ? state.settings.qualified_dividend_tax_rate : QUALIFIED_DIVIDEND_TAX_RATE;
  const ordinaryDividendTaxRate =
    typeof state.settings.ordinary_dividend_tax_rate === 'number'
      ? state.settings.ordinary_dividend_tax_rate : ORDINARY_DIVIDEND_TAX_RATE;
  const dividendTaxRates = useMemo<DividendTaxRates>(
    () => ({
      qualified: qualifiedDividendTaxRate,
      ordinary: ordinaryDividendTaxRate,
      capitalGainDist: ltTaxRate,
    }),
    [qualifiedDividendTaxRate, ordinaryDividendTaxRate, ltTaxRate],
  );

  const value = useMemo(
    () => ({
      ...state,
      parked: mergedParked,
      quotes,
      dayChange,
      quotesAsOf,
      refreshQuotes,
      tickerNames,
      contributionCap,
      concentrationCap,
      ltTaxRate,
      stTaxRate,
      dividendTaxRates,
      updateSetting,
      updateSettings,
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
      addAccount,
      addOutsideSale,
      deleteOutsideSale,
      recordTrim,
      addParkedLot,
      deleteParkedLot,
      reclassifyDividend,
      addParkedPosition,
      deleteParkedSale,
      updateParkedSale,
      transferParked,
      accountCash,
      addParkedCashEvent,
      deleteParkedCashEvent,
      reconcileAccountCash,
      exampleData,
      clearExampleData,
      setOverride,
      clearOverride,
    }),
    [
      state, mergedParked, quotes, dayChange, quotesAsOf, refreshQuotes, tickerNames, contributionCap,
      concentrationCap, ltTaxRate, stTaxRate, dividendTaxRates, updateSetting, updateSettings,
      loading, error,
      refresh, addCashEvent, deleteCashEvent, addLot, closePosition, recordSplit,
      setTradeWashSale, deleteTrade, updateParked, recordMilestone, addAccount, addOutsideSale,
      deleteOutsideSale, recordTrim, addParkedLot, deleteParkedLot, reclassifyDividend, addParkedPosition,
      deleteParkedSale, updateParkedSale, transferParked, accountCash, addParkedCashEvent,
      deleteParkedCashEvent, reconcileAccountCash, exampleData, clearExampleData,
      setOverride, clearOverride,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}

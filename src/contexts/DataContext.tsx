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
  accountTotal, adjustmentsForLots, aggregateLots, allocateRoc,
  closeShares,
  computeAccountCash, concentration, consumeLotsFifo, cumulativeFloor, isArchivedPosition,
  LT_TAX_RATE, netContributed, ORDINARY_DIVIDEND_TAX_RATE, pileTotal,
  QUALIFIED_DIVIDEND_TAX_RATE, reservedTotal, round6, roundCents, shadowValue,
  ST_TAX_RATE, totalScore,
} from '../lib/engine';
import type {
  AccountCashBreakdown, DividendClassification, DividendTaxRates, Expense, IncomeScenario,
  ParkedCashEvent, ParkedLot, ParkedLotAdjustment, ParkedSale,
  PileTaxSetAside, ScenarioRotation, WatchlistItem,
} from '../lib/engine';
import { priceMapFor } from '../lib/alerts';
import { splitParkedPots } from '../lib/engine';
import { useQuotesEngine } from './data/useQuotesEngine';
import { useParkedSales } from './data/useParkedSales';
import { useSmallTables } from './data/useSmallTables';
import { errorMessage, todayISO } from '../lib/utils';
import {
  cashEventPayload,
  db,
  lotPayload,
  mapParkedLot,
  parkedLotPayload,
  mapParkedSale,
  mapParkedCashEvent,
  parkedCashEventPayload,
  mapParkedLotAdjustment,
  parkedLotAdjustmentPayload,
  mapIncomeScenario,
  mapScenarioRotation,
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
  mapPileTaxSetAside,
  mapExpense,
  mapWatchlistItem,
  milestonePayload,
  outsideSalePayload,
  tradePayload,
  fetchAll,
} from '../lib/db';

export interface DataState {
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
  /** When each pin was set (ISO), for staleness cues. */
  overrideSetAt: Record<string, string>;
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
  /** Transition modeler what-ifs — pure pile context, never score math. */
  incomeScenarios: IncomeScenario[];
  scenarioRotations: ScenarioRotation[];
  /** The bench: researched candidates for the next rotation. Context only. */
  watchlist: WatchlistItem[];
  pileTaxSetAsides: PileTaxSetAside[];
  expenses: Expense[];
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
  overrideSetAt: {},
  settings: {},
  accounts: [],
  outsideSales: [],
  parkedLots: [],
  parkedSales: [],
  parkedCashEvents: [],
  parkedLotAdjustments: [],
  incomeScenarios: [],
  scenarioRotations: [],
  watchlist: [],
  pileTaxSetAsides: [],
  expenses: [],
};

interface DataContextValue extends DataState {
  loading: boolean;
  error: string | null;
  /** The walls: `parked` holds every position; these split it. taxableParked
   * = everything outside retirement (income, taxes, and activity key off it);
   * pileParked = taxable minus the BTC bucket (pile screens and pile math);
   * btcParked = the bitcoin conviction bucket, its own fourth pot;
   * retirementParked = the rest. Mutations keep using `parked` — ids are ids. */
  taxableParked: ParkedPosition[];
  pileParked: ParkedPosition[];
  btcParked: ParkedPosition[];
  retirementParked: ParkedPosition[];
  retirementAccountIds: Set<string>;
  /** Rule 12 cap from app_settings; null (feature off) if the row is missing. */
  contributionCap: number | null;
  /** Semiconductor concentration cap (editable, default 50%). */
  concentrationCap: number;
  /** Pile capital-gains estimate rates from app_settings (defaults 21%/29%). */
  ltTaxRate: number;
  stTaxRate: number;
  /** Dividend estimate rates (informational — never the 30% reserve rule). */
  dividendTaxRates: DividendTaxRates;
  updateSetting: (key: string, value: unknown) => Promise<void>;
  /** Batch variant: one atomic upsert + one refresh for several keys. */
  updateSettings: (entries: Record<string, unknown>) => Promise<void>;
  /** Upsert a loss carryforward for a tax year; null amount deletes the row. */
  setCarryforward: (taxYear: number, amount: number | null) => Promise<void>;
  /** Bench CRUD — candidates for the next rotation. Context only. */
  addWatchlistItem: (w: Omit<WatchlistItem, 'id' | 'createdAt'>) => Promise<void>;
  updateWatchlistItem: (id: string, w: Omit<WatchlistItem, 'id' | 'createdAt'>) => Promise<void>;
  deleteWatchlistItem: (id: string) => Promise<void>;
  /** Living-expenses CRUD (coverage). Context only, never score math. */
  addExpense: (e: Omit<Expense, 'id' | 'createdAt'>) => Promise<void>;
  updateExpense: (id: string, e: Omit<Expense, 'id' | 'createdAt'>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  /** The reinvest/spend toggle on a holding — null reverts to inference. */
  setIncomeUse: (id: string, use: 'reinvest' | 'spend' | null) => Promise<void>;
  addPileTaxSetAside: (s: Omit<PileTaxSetAside, 'id'>) => Promise<void>;
  deletePileTaxSetAside: (id: string) => Promise<void>;
  /** Delayed API quotes (override-free). Merged view: overrides win. */
  quotes: Record<string, number>;
  /** The day's move per ticker, straight from the quote feed. */
  dayChange: Record<string, { change: number | null; changePct: number | null }>;
  quotesAsOf: number | null;
  /** Last quote fetch failed — the stamp shows amber "quotes stale". */
  quotesError: boolean;
  /** First quote pass finished (even a failed one) — until then, price-
   * derived numbers are fallbacks about to repaint; hold a placeholder. */
  quotesSettled: boolean;
  refreshQuotes: () => Promise<void>;
  /** Company names by ticker (best-effort; ETFs may be absent). */
  tickerNames: Record<string, string>;
  refresh: () => Promise<void>;
  /** For a Deposit, pass that day's VOO price to create the shadow twin. */
  addCashEvent: (e: Omit<CashEvent, 'id'>, vooPriceThatDay?: number) => Promise<void>;
  /** Date/notes corrections only — amount and type are immutable (twins,
   * balances, and reserve math key off them). A linked twin's date follows. */
  updateCashEvent: (id: string, patch: { date?: string; notes?: string | null }) => Promise<void>;
  deleteCashEvent: (id: string) => Promise<void>;
  /** Creates the lot AND its Buy cash event. */
  addLot: (lot: Omit<PositionLot, 'id'>) => Promise<void>;
  /** Deletes the lot; takes the Buy cash event too when exactly one matches. */
  deleteLot: (id: string) => Promise<{ buyEventDeleted: boolean }>;
  /** Non-monetary corrections: exit target, calendar exit, buy date, thesis. */
  updateLotDetails: (
    id: string,
    patch: { exitTarget?: number; exitDate?: string | null; buyDate?: string; thesis?: string | null },
  ) => Promise<void>;
  /** Removes the record only — MilestoneBank row and VOO lot stay. */
  deleteMilestone: (id: string) => Promise<void>;
  /** FIFO (or per-lot allocated) close: trades + Sell cash event + lot
   * updates. Fees reduce recorded proceeds — realized gain lands net. */
  closePosition: (
    ticker: string,
    shares: number,
    pricePerShare: number,
    closeDate: string,
    allocations?: CloseAllocation[],
    fees?: number,
    exitReason?: string | null,
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
  addAccount: (name: string, kind: AccountKind, broker?: string, retirementFlavor?: string) => Promise<void>;
  /** Renames/relabels are always safe (ids reference the account everywhere).
   * Kind steers ledger/pile/retirement logic — callers may only pass it for
   * an account nothing references yet (the Accounts screen enforces this). */
  updateAccount: (
    id: string,
    patch: {
      name?: string;
      broker?: string | null;
      notes?: string | null;
      kind?: AccountKind;
      retirementFlavor?: string | null;
    },
  ) => Promise<void>;
  /** Only for unreferenced accounts (no holdings, sales, or ledger rows —
   * the Accounts screen enforces this). Takes the account's own manual cash
   * movements with it; they mean nothing without their account. */
  deleteAccount: (id: string) => Promise<void>;
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
    /** Sell-side fees — sale proceeds and any funding deposit record net. */
    fees?: number;
  }) => Promise<void>;
  addParkedLot: (lot: Omit<ParkedLot, 'id'>) => Promise<void>;
  deleteParkedLot: (id: string) => Promise<void>;
  /** 1099 correction: change a dividend's classification; stamps reclassified_at.
   * Into/out of ROC also allocates or reverses basis reductions. */
  reclassifyDividend: (
    id: string,
    classification: DividendClassification,
    exDate?: string | null,
  ) => Promise<void>;
  /** Bulk 1099 confirm: same logic per dividend, one refresh at the end. */
  reclassifyDividends: (ids: string[], classification: DividendClassification) => Promise<void>;
  /** Backfill: allocate basis for ROC dividends that predate Phase 2, oldest
   * first. Idempotent per dividend; one refresh at the end. */
  allocateRocDividends: (dividendLotIds: string[]) => Promise<void>;
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
  /** The reconcile piece: writes an adjustment for actual − tracked.
   * Reports whether one was needed so a clean check can say "matches". */
  reconcileAccountCash: (
    accountId: string,
    actualBalance: number,
  ) => Promise<{ adjusted: boolean; diff: number }>;
  /** History corrections: basis, term, funded flag, date, notes. */
  updateParkedSale: (
    id: string,
    patch: Partial<Pick<ParkedSale, 'date' | 'costBasis' | 'ltShares' | 'fundedChallenge' | 'notes'>>,
  ) => Promise<void>;
  /** Exact undo of a snapshot-bearing sale: lots, basis, and ROC come back.
   * Never touches the challenge ledger. */
  undoParkedSale: (saleId: string) => Promise<void>;
  /** Edit a sale's numbers: undo + re-apply against fresh data. Optional
   * funded/notes overrides; defaults carry the old row's values. */
  editParkedSaleAmounts: (
    saleId: string,
    next: {
      shares: number;
      pricePerShare: number;
      date: string;
      fundedChallenge?: boolean;
      notes?: string | null;
    },
  ) => Promise<void>;
  /** Rows seeded from the workbook, identified by EXAMPLE in their notes. */
  exampleData: { cashEvents: CashEvent[]; lots: PositionLot[]; trades: Trade[]; total: number };
  clearExampleData: () => Promise<void>;
  setOverride: (ticker: string, price: number) => Promise<void>;
  /** Bulk pin update (the Retirement page's unit-value refresh) — one write,
   * one refresh, one shared set_at stamp. */
  setOverrides: (entries: { ticker: string; price: number }[]) => Promise<void>;
  /** Bulk per-POSITION price update (the daily balance-scaling routine) —
   * position rows only, never the global override table. One refresh. */
  updateParkedPrices: (entries: { id: string; price: number }[]) => Promise<void>;
  clearOverride: (ticker: string) => Promise<void>;
  /** Transition modeler — pure pile context, never score math. */
  addScenario: (s: Omit<IncomeScenario, 'id' | 'createdAt'>) => Promise<void>;
  updateScenario: (id: string, patch: Partial<Omit<IncomeScenario, 'id' | 'createdAt'>>) => Promise<void>;
  deleteScenario: (id: string) => Promise<void>;
  duplicateScenario: (id: string) => Promise<void>;
  addRotation: (r: Omit<ScenarioRotation, 'id'>) => Promise<void>;
  updateRotation: (id: string, r: Omit<ScenarioRotation, 'id'>) => Promise<void>;
  deleteRotation: (id: string) => Promise<void>;
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
      const [
        cash, lots, trades, milestones, bench, parked, snaps, carry, overrides, settings,
        accounts, outsideSales, parkedLots, parkedSales, parkedCashEvents, parkedLotAdjustments,
        incomeScenarios, scenarioRotations, watchlist, pileTaxSetAsides, expenses,
      // Every read pages via fetchAll — PostgREST truncates at 1000 rows
      // server-side, and a partial ledger means a silently wrong score. The
      // trailing .order('id') makes each ordering total so pages can't skip
      // or duplicate rows on ties.
      ] = await Promise.all([
        fetchAll(() => client.from('cash_events').select('*').order('date').order('created_at').order('id')),
        fetchAll(() => client.from('position_lots').select('*').order('buy_date').order('id')),
        fetchAll(() => client.from('trades').select('*').order('close_date').order('id')),
        fetchAll(() => client.from('milestones').select('*').order('level')),
        fetchAll(() => client.from('benchmark_deposits').select('*').order('date').order('id')),
        fetchAll(() => client.from('parked_positions').select('*, account:accounts(name)').order('ticker').order('id')),
        fetchAll(() => client.from('snapshots').select('*').order('date')),
        fetchAll(() => client.from('loss_carryforwards').select('*').order('tax_year')),
        fetchAll(() => client.from('price_overrides').select('*').order('ticker')),
        fetchAll(() => client.from('app_settings').select('*').order('key')),
        fetchAll(() => client.from('accounts').select('*').order('name').order('id')),
        fetchAll(() => client.from('outside_sales').select('*').order('sale_date').order('id')),
        fetchAll(() => client.from('parked_lots').select('*').order('date', { nullsFirst: true }).order('id')),
        fetchAll(() => client.from('parked_sales').select('*').order('date').order('id')),
        fetchAll(() => client.from('parked_cash_events').select('*').order('date').order('id')),
        fetchAll(() => client.from('parked_lot_adjustments').select('*').order('id')),
        fetchAll(() => client.from('income_scenarios').select('*').order('created_at').order('id')),
        fetchAll(() => client.from('scenario_rotations').select('*').order('rotation_date').order('id')),
        fetchAll(() => client.from('watchlist').select('*').order('catalyst_date', { nullsFirst: false }).order('id')),
        fetchAll(() => client.from('pile_tax_set_asides').select('*').order('date').order('id')),
        fetchAll(() => client.from('expenses').select('*').order('amount').order('id')),
      ]);
      const firstError =
        cash.error ?? lots.error ?? trades.error ?? milestones.error ?? bench.error ??
        parked.error ?? snaps.error ?? carry.error ?? overrides.error ?? settings.error ??
        accounts.error ?? outsideSales.error ?? parkedLots.error ?? parkedSales.error ??
        parkedCashEvents.error ?? parkedLotAdjustments.error ?? incomeScenarios.error ??
        scenarioRotations.error ?? watchlist.error ?? pileTaxSetAsides.error ?? expenses.error;
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
        overrideSetAt: Object.fromEntries(
          (overrides.data ?? []).filter((r) => r.set_at).map((r) => [r.ticker, r.set_at as string]),
        ),
        settings: Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value])),
        accounts: (accounts.data ?? []).map(mapAccount),
        outsideSales: (outsideSales.data ?? []).map(mapOutsideSale),
        parkedLots: (parkedLots.data ?? []).map(mapParkedLot),
        parkedSales: (parkedSales.data ?? []).map(mapParkedSale),
        parkedCashEvents: (parkedCashEvents.data ?? []).map(mapParkedCashEvent),
        parkedLotAdjustments: (parkedLotAdjustments.data ?? []).map(mapParkedLotAdjustment),
        incomeScenarios: (incomeScenarios.data ?? []).map(mapIncomeScenario),
        scenarioRotations: (scenarioRotations.data ?? []).map(mapScenarioRotation),
        watchlist: (watchlist.data ?? []).map(mapWatchlistItem),
        pileTaxSetAsides: (pileTaxSetAsides.data ?? []).map(mapPileTaxSetAside),
        expenses: (expenses.data ?? []).map(mapExpense),
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

  // The third wall: retirement positions reuse all the parked machinery but
  // never enter pile math (total, cap, trim fuel, income, taxes, snapshots).
  const retirementAccountIds = useMemo(
    () => new Set(state.accounts.filter((a) => a.kind === 'retirement').map((a) => a.id)),
    [state.accounts],
  );

  // May the quote feed price this position? The explicit flag wins; legacy
  // rows (null, pre-migration) fall back to the old wall: pile yes,
  // retirement no. Real-ticker retirement funds (JLGMX) opt in; plan codes
  // and annuity units (W146, TRAD) stay manual — their codes can collide
  // with real listings.
  const isQuotable = useCallback(
    (p: ParkedPosition) => p.liveQuotes ?? !retirementAccountIds.has(p.accountId),
    [retirementAccountIds],
  );

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
        if (isArchivedPosition(p)) return false; // archived rows don't need fresh prices
        if (!isQuotable(p)) return false; // hand-priced rows: quotes never write here
        const quoted = fresh[p.ticker]?.price;
        // 0.5c tolerance keeps us from writing on every rounding wobble.
        return quoted !== undefined && Math.abs(quoted - p.currentPrice) > 0.005;
      });
      if (stale.length === 0) return;
      const client = db();
      // All rows of a ticker share the price, so batch one UPDATE per ticker
      // and run them concurrently. Best-effort (live quotes still drive the
      // UI) — a failed batch just stays stale and retries next poll. Only
      // what persisted gets patched into state; NO full refresh here: this
      // runs on every 30-minute poll and every tab refocus.
      const byTicker = new Map<string, { price: number; ids: string[] }>();
      for (const p of stale) {
        const price = Math.round(fresh[p.ticker].price * 10000) / 10000;
        const g = byTicker.get(p.ticker);
        if (g) g.ids.push(p.id);
        else byTicker.set(p.ticker, { price, ids: [p.id] });
      }
      const persisted = new Map<string, number>();
      await Promise.all(
        [...byTicker.values()].map(async (g) => {
          const { error: err } = await client
            .from('parked_positions')
            .update({ current_price: g.price })
            .in('id', g.ids);
          if (!err) for (const id of g.ids) persisted.set(id, g.price);
        }),
      );
      if (persisted.size === 0) return;
      setState((prev) => ({
        ...prev,
        parked: prev.parked.map((p) =>
          persisted.has(p.id) ? { ...p, currentPrice: persisted.get(p.id)! } : p,
        ),
      }));
    },
    [state.parked, isQuotable],
  );

  // Quote machinery lives in its own module — the provider only wires it up.
  const {
    quotes, dayChange, quotesAsOf, quotesError, quotesSettled, tickerNames, refreshQuotes,
  } = useQuotesEngine({
    ready: !loading && !error,
    lots: state.lots,
    parked: state.parked,
    watchlist: state.watchlist,
    isQuotable,
    persistQuotedPrices,
  });

  // The pot walls — one pure split (see engine/parkedWalls.ts for the rules).
  const pots = useMemo(
    () =>
      splitParkedPots({
        parked: state.parked,
        overrides: state.overrides,
        quotes,
        retirementAccountIds,
        isQuotable,
      }),
    [state.parked, state.overrides, quotes, retirementAccountIds, isQuotable],
  );
  const { mergedParked, taxableParked, pileParked, btcParked, retirementParked } = pots;

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
      parked_pile_value: roundCents(pileTotal(pileParked)),
      semi_ai_pct: Number(concentration(pileParked).semiPct.toFixed(6)),
      retirement_value: roundCents(pileTotal(retirementParked)),
      btc_value: roundCents(pileTotal(btcParked)),
    };
    void db()
      .from('snapshots')
      .upsert(payload, { onConflict: 'date', ignoreDuplicates: true })
      .then(({ error: err }) => {
        if (!err) void refresh();
      });
  }, [loading, error, state, quotes, pileParked, btcParked, retirementParked, refresh]);

  /** Insert a Deposit cash event and its shadow-VOO twin as one converging
   * unit. Never leave a deposit without its twin — the benchmark would
   * silently understate forever — so a twin failure compensates by deleting
   * the deposit, and that compensating delete is CHECKED: if it also fails,
   * the error says exactly what row survived. No refresh — callers own it. */
  const insertDepositWithTwin = useCallback(
    async (e: Omit<CashEvent, 'id'>, vooPriceThatDay: number) => {
      const client = db();
      const { data: cashRow, error: err } = await client
        .from('cash_events')
        .insert(cashEventPayload(e))
        .select('id')
        .single();
      if (err) throw err;
      const { error: benchErr } = await client.from('benchmark_deposits').insert({
        date: e.date,
        amount: e.amount,
        voo_price_that_day: vooPriceThatDay,
        cash_event_id: cashRow.id,
      });
      if (benchErr) {
        const { error: compErr } = await client
          .from('cash_events').delete().eq('id', cashRow.id);
        if (compErr) {
          throw new Error(
            `Shadow VOO twin failed (${benchErr.message}) and the deposit could not be rolled back (${compErr.message}) — a twinless Deposit for ${e.date} may remain on the Cash Ledger. Delete it before re-adding, or the benchmark understates.`,
          );
        }
        throw new Error(
          `Shadow VOO twin failed (${benchErr.message}). The deposit was rolled back — nothing was recorded.`,
        );
      }
      return cashRow.id as string;
    },
    [],
  );

  const addCashEvent = useCallback(
    async (e: Omit<CashEvent, 'id'>, vooPriceThatDay?: number) => {
      if (e.type === 'Deposit' && vooPriceThatDay) {
        await insertDepositWithTwin(e, vooPriceThatDay);
      } else {
        const { error: err } = await db().from('cash_events').insert(cashEventPayload(e));
        if (err) throw err;
      }
      await refresh();
    },
    [refresh, insertDepositWithTwin],
  );

  /** History corrections: date and notes only. Amount and type stay immutable
   * — the shadow twin, running balance, and reserve math all key off them, so
   * a money change is delete-and-re-add. A Deposit's linked twin follows a
   * date change (the recorded VOO price stays — fix typos, don't re-date). */
  const updateCashEvent = useCallback(
    async (id: string, patch: { date?: string; notes?: string | null }) => {
      const client = db();
      const payload: Record<string, unknown> = {};
      if (patch.date !== undefined) payload.date = patch.date;
      if (patch.notes !== undefined) payload.notes = patch.notes;
      if (Object.keys(payload).length === 0) return;
      const { error: err } = await client.from('cash_events').update(payload).eq('id', id);
      if (err) throw err;
      if (patch.date !== undefined) {
        const twin = state.benchmarkDeposits.find((b) => b.cashEventId === id);
        if (twin) {
          const { error: twinErr } = await client
            .from('benchmark_deposits').update({ date: patch.date }).eq('id', twin.id);
          if (twinErr) {
            throw new Error(
              `Event updated, but its shadow twin's date didn't follow (${twinErr.message}) — retry, or the benchmark shows the purchase on the wrong day.`,
            );
          }
        }
      }
      await refresh();
    },
    [refresh, state.benchmarkDeposits],
  );

  const deleteCashEvent = useCallback(
    async (id: string) => {
      const client = db();
      const event = state.cashEvents.find((e) => e.id === id);
      // Linked twins die via the FK cascade; legacy (unlinked) twins fall
      // back to date+amount matching — and that delete is CHECKED, because a
      // silently orphaned twin inflates shadow VOO forever. A deposit that
      // HAS a linked twin must never also take the fallback: on a date+amount
      // collision it would eat another deposit's legacy twin too.
      const hasLinkedTwin = state.benchmarkDeposits.some((b) => b.cashEventId === id);
      const legacyTwin =
        !hasLinkedTwin && event?.type === 'Deposit'
          ? state.benchmarkDeposits.find(
              (b) => b.cashEventId == null && b.date === event.date && b.amount === event.amount,
            )
          : undefined;
      const { error: err } = await client.from('cash_events').delete().eq('id', id);
      if (err) throw err;
      if (legacyTwin) {
        const { error: twinErr } = await client
          .from('benchmark_deposits').delete().eq('id', legacyTwin.id);
        if (twinErr) {
          throw new Error(
            `Deposit deleted, but its shadow VOO twin (${legacyTwin.date}) failed to delete — remove it or the benchmark overstates. (${twinErr.message})`,
          );
        }
      }
      await refresh();
    },
    [refresh, state.cashEvents, state.benchmarkDeposits],
  );

  const addLot = useCallback(
    async (lot: Omit<PositionLot, 'id'>) => {
      const client = db();
      // Buy event first so the lot can carry an exact link — matching by
      // ticker+date+amount breaks the moment either side's date is edited.
      const { data: cashRow, error: cashErr } = await client
        .from('cash_events')
        .insert(
          cashEventPayload({
            date: lot.buyDate,
            type: 'Buy',
            amount: roundCents(lot.shares * lot.avgCost),
            ticker: lot.ticker,
          }),
        )
        .select('id')
        .single();
      if (cashErr) throw cashErr;
      const { error: err } = await client
        .from('position_lots')
        .insert(lotPayload({ ...lot, buyEventId: cashRow.id as string }));
      if (err) {
        const { error: compErr } = await client
          .from('cash_events').delete().eq('id', cashRow.id);
        if (compErr) {
          throw new Error(
            `Lot insert failed (${err.message}) and its Buy event could not be rolled back (${compErr.message}) — remove the ${lot.buyDate} ${lot.ticker} Buy on the Cash Ledger before retrying.`,
          );
        }
        throw err;
      }
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
      fees = 0,
      exitReason: string | null = null,
    ) => {
      const client = db();
      const result = closeShares(state.lots, ticker, shares, pricePerShare, closeDate, allocations);

      // Fees reduce proceeds (the tax treatment — realized gain drives the
      // 30% skim, so this must be exact). Scale each trade proportionally;
      // the last trade absorbs the rounding remainder so the sum is the net.
      let tradeRows = result.trades.map((t) => ({
        ...t,
        costBasis: roundCents(t.costBasis),
        proceeds: roundCents(t.proceeds),
      }));
      const gross = roundCents(tradeRows.reduce((s, t) => s + t.proceeds, 0));
      const net = roundCents(gross - fees);
      if (fees > 0 && gross > 0) {
        let allocated = 0;
        tradeRows = tradeRows.map((t, i) => {
          if (i === tradeRows.length - 1) return { ...t, proceeds: roundCents(net - allocated) };
          const p = roundCents((t.proceeds * net) / gross);
          allocated = roundCents(allocated + p);
          return { ...t, proceeds: p };
        });
      }

      try {
        // Trades are one batch insert (all-or-nothing at PostgREST), so a
        // failure below can't leave half the paper trail.
        const { error: tradeErr } = await client.from('trades').insert(
          tradeRows.map((t) => tradePayload({ ...t, washSale: false, exitReason })),
        );
        if (tradeErr) throw tradeErr;

        const before = state.lots.filter((l) => l.ticker === ticker);
        const afterById = new Map(
          result.remainingLots.filter((l) => l.ticker === ticker).map((l) => [l.id, l]),
        );
        // One batched delete + parallel updates — fewer round trips means a
        // smaller mid-failure window for the warning below to matter.
        const lotDeletes = before.filter((l) => !afterById.has(l.id)).map((l) => l.id);
        const lotUpdates = before.flatMap((l) => {
          const after = afterById.get(l.id);
          return after && after.shares !== l.shares ? [{ id: l.id, shares: after.shares }] : [];
        });
        if (lotDeletes.length > 0) {
          const { error: err } = await client.from('position_lots').delete().in('id', lotDeletes);
          if (err) throw err;
        }
        const updateResults = await Promise.all(
          lotUpdates.map(({ id, shares: s }) =>
            client.from('position_lots').update({ shares: s }).eq('id', id),
          ),
        );
        const firstUpdateErr = updateResults.find((r) => r.error)?.error;
        if (firstUpdateErr) throw firstUpdateErr;

        const { error: cashErr } = await client.from('cash_events').insert(
          cashEventPayload({
            date: closeDate,
            type: 'Sell',
            amount: net,
            ticker,
            notes: fees > 0 ? `net of $${fees.toFixed(2)} fees` : null,
          }),
        );
        if (cashErr) throw cashErr;
      } catch (err) {
        throw new Error(
          `Close failed midway (${errorMessage(err)}). Check the Trade Log and lot list for partial records before retrying — retrying blindly can duplicate trades.`,
        );
      } finally {
        // Refresh even on failure — a retry must never recompute the close
        // from stale lots. refresh() never rejects (fetch failures land in
        // the context's error banner), so no rethrow path is needed here.
        await refresh();
      }
    },
    [refresh, state.lots],
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
      if (patch.dividendGrowthPct !== undefined) payload.dividend_growth_pct = patch.dividendGrowthPct;
      if (patch.liveQuotes !== undefined) payload.live_quotes = patch.liveQuotes;
      if (patch.incomeUse !== undefined) payload.income_use = patch.incomeUse;
      const { error: err } = await db().from('parked_positions').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  /** The reinvest/spend toggle. income_use is display-only (coverage math),
   * so patch state locally instead of a full 20-table refresh. */
  const setIncomeUse = useCallback(
    async (id: string, use: 'reinvest' | 'spend' | null) => {
      const { error: err } = await db()
        .from('parked_positions').update({ income_use: use }).eq('id', id);
      if (err) throw err;
      setState((prev) => ({
        ...prev,
        parked: prev.parked.map((p) => (p.id === id ? { ...p, incomeUse: use } : p)),
      }));
    },
    [],
  );

  /** Accounts are referenced by id everywhere, so renames/relabels touch
   * nothing else. Kind steers real logic (pile vs retirement wall, ledger
   * dropdowns) — the Accounts screen only offers it for empty accounts. */
  const updateAccount = useCallback(
    async (
      id: string,
      patch: {
        name?: string;
        broker?: string | null;
        notes?: string | null;
        kind?: AccountKind;
        retirementFlavor?: string | null;
      },
    ) => {
      const payload: Record<string, unknown> = {};
      if (patch.name !== undefined) payload.name = patch.name;
      if (patch.broker !== undefined) payload.broker = patch.broker;
      if (patch.notes !== undefined) payload.notes = patch.notes;
      if (patch.kind !== undefined) payload.kind = patch.kind;
      if (patch.retirementFlavor !== undefined) payload.retirement_flavor = patch.retirementFlavor;
      if (Object.keys(payload).length === 0) return;
      const { error: err } = await db().from('accounts').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const deleteAccount = useCallback(
    async (id: string) => {
      // Belt and suspenders under the screen's own empty check: refuse when
      // anything besides the account's own manual cash movements points here.
      const referenced =
        state.parked.some((p) => p.accountId === id) ||
        state.parkedSales.some((s) => s.accountId === id) ||
        state.outsideSales.some((s) => s.accountId === id) ||
        state.cashEvents.some((e) => e.accountId === id || e.destinationAccountId === id);
      if (referenced) throw new Error('Account still has holdings, sales, or ledger history.');
      const { error: cashErr } = await db().from('parked_cash_events').delete().eq('account_id', id);
      if (cashErr) throw cashErr;
      const { error: err } = await db().from('accounts').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh, state.parked, state.parkedSales, state.outsideSales, state.cashEvents],
  );

  const addAccount = useCallback(
    async (name: string, kind: AccountKind, broker?: string, retirementFlavor?: string) => {
      const { error: err } = await db()
        .from('accounts')
        .insert({
          name, kind, broker: broker || null,
          retirement_flavor: kind === 'retirement' ? retirementFlavor || null : null,
        });
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

  /** Recompute a position's shares/avg_cost from its lots. A position whose
   * lots hold no shares survives archived at zero (its dividend history stays
   * on the Income screen). With no lots at all, a position that was ever SOLD
   * still survives as an archived shell — its closed-position record (realized
   * performance, and a home for a late dividend) belongs on the Closed
   * Positions section — while a never-sold empty position (a mistaken entry
   * whose lots were all deleted) is removed. */
  const recomputeParkedAggregate = useCallback(async (positionId: string) => {
    const client = db();
    const { data, error: readErr } = await client
      .from('parked_lots').select('*').eq('parked_position_id', positionId);
    if (readErr) throw readErr;
    const rows = (data ?? []).map(mapParkedLot);
    const agg = aggregateLots(rows);
    if (rows.length === 0) {
      const { data: posRow } = await client
        .from('parked_positions').select('ticker, account_id').eq('id', positionId).maybeSingle();
      let hasSale = false;
      if (posRow) {
        const { data: saleRows } = await client
          .from('parked_sales').select('id')
          .eq('ticker', posRow.ticker).eq('account_id', posRow.account_id).limit(1);
        hasSale = (saleRows?.length ?? 0) > 0;
      }
      if (hasSale) {
        const { error: err } = await client
          .from('parked_positions').update({ shares: 0, avg_cost: 0 }).eq('id', positionId);
        if (err) throw err;
      } else {
        const { error: err } = await client.from('parked_positions').delete().eq('id', positionId);
        if (err) throw err;
      }
    } else {
      const { error: err } = await client
        .from('parked_positions')
        .update(
          agg.shares <= 1e-9
            ? { shares: 0, avg_cost: 0 }
            : { shares: agg.shares, avg_cost: Math.round(agg.avgCost * 10000) / 10000 },
        )
        .eq('id', positionId);
      if (err) throw err;
    }
  }, []);

  const recordSplit = useCallback(
    async (ticker: string, ratio: number, date: string) => {
      const client = db();
      const note = `${ratio}:1 split recorded ${date}`;
      const lotResults = await Promise.all(
        state.lots.filter((l) => l.ticker === ticker).map((lot) =>
          client
            .from('position_lots')
            .update({
              shares: lot.shares * ratio,
              avg_cost: lot.avgCost / ratio,
              // The exit target is a price too — an unscaled target after a
              // split silences (or falsely fires) the exit alert forever.
              exit_target: lot.exitTarget / ratio,
              thesis: lot.thesis ? `${lot.thesis} · ${note}` : note,
            })
            .eq('id', lot.id),
        ),
      );
      const lotErr = lotResults.find((r) => r.error)?.error;
      if (lotErr) throw lotErr;
      // Parked positions are aggregates maintained FROM lots — the split must
      // land on the lots (basis/amount unchanged; a split moves no money) or
      // the next recompute silently reverts it and FIFO share math wedges.
      for (const p of state.parked.filter((p) => p.ticker === ticker)) {
        const positionLots = state.parkedLots.filter(
          (l) => l.parkedPositionId === p.id && l.shares > 0,
        );
        const parkedLotResults = await Promise.all(
          positionLots.map((l) =>
            client
              .from('parked_lots')
              .update({
                shares: l.shares * ratio,
                price: l.price != null ? l.price / ratio : null,
              })
              .eq('id', l.id),
          ),
        );
        const parkedLotErr = parkedLotResults.find((r) => r.error)?.error;
        if (parkedLotErr) throw parkedLotErr;
        // The aggregate scales locally — shares × ratio, avg_cost ÷ ratio
        // (lot amounts are unchanged, so this matches a recompute exactly).
        // NOT recomputeParkedAggregate: a legacy lot-less position has zero
        // lot rows, and the recompute would delete the holding outright.
        const { error: posErr } = await client
          .from('parked_positions')
          .update({
            shares: p.shares * ratio,
            avg_cost: Math.round((p.avgCost / ratio) * 10000) / 10000,
            current_price: p.currentPrice / ratio,
            notes: p.notes ? `${p.notes} · ${note}` : note,
          })
          .eq('id', p.id);
        if (posErr) throw posErr;
      }
      // A pinned manual price is a price too — left unscaled it would value
      // the doubled shares at the pre-split price and false-fire the target
      // alert against the newly scaled exit target.
      const pinned = state.overrides[ticker];
      if (pinned != null) {
        const { error: ovErr } = await client
          .from('price_overrides')
          .update({ price: pinned / ratio })
          .eq('ticker', ticker);
        if (ovErr) throw ovErr;
      }
      await refresh();
    },
    [refresh, state.lots, state.parked, state.parkedLots, state.overrides],
  );

  /** Allocate an ROC dividend's basis reductions across the position's
   * current share lots (its own DRIP lot excluded via allocateRoc's
   * excludeLotId — a distribution doesn't reduce its own reinvested shares).
   * Reads lots and adjustments fresh from the DB so sequential allocations
   * see each other's rows, and deletes any prior rows for this dividend
   * first so a retry (or a stale second tab) can never double-reduce.
   * Stores the beyond-basis overflow ON the dividend at allocation time —
   * later trims/transfers mutate the rows, so overflow must not be derived.
   * Does NOT refresh — callers do. */
  const insertRocAllocations = useCallback(
    async (divLot: Pick<ParkedLot, 'id' | 'parkedPositionId' | 'amount' | 'date'>) => {
      const client = db();
      const { error: clearErr } = await client
        .from('parked_lot_adjustments').delete().eq('dividend_lot_id', divLot.id);
      if (clearErr) throw clearErr;
      const { data: lotRows, error: lotsErr } = await client
        .from('parked_lots').select('*').eq('parked_position_id', divLot.parkedPositionId);
      if (lotsErr) throw lotsErr;
      const shareLots = (lotRows ?? []).map(mapParkedLot).filter((l) => l.shares > 0);
      let adjs: ParkedLotAdjustment[] = [];
      if (shareLots.length > 0) {
        const { data: adjRows, error: adjErr } = await client
          .from('parked_lot_adjustments')
          .select('*')
          .in('share_lot_id', shareLots.map((l) => l.id));
        if (adjErr) throw adjErr;
        adjs = (adjRows ?? []).map(mapParkedLotAdjustment);
      }
      const { allocations, overflow } = allocateRoc(shareLots, adjs, {
        amount: divLot.amount,
        date: divLot.date,
        excludeLotId: divLot.id,
      });
      if (allocations.length > 0) {
        const { error: err } = await client.from('parked_lot_adjustments').insert(
          allocations.map((x) =>
            parkedLotAdjustmentPayload({
              shareLotId: x.shareLotId,
              dividendLotId: divLot.id,
              amount: x.amount,
            }),
          ),
        );
        if (err) throw err;
      }
      const { error: stampErr } = await client
        .from('parked_lots')
        .update({ roc_allocated_at: new Date().toISOString(), roc_overflow: overflow.total })
        .eq('id', divLot.id);
      if (stampErr) throw stampErr;
    },
    [],
  );

  const addParkedLot = useCallback(
    async (lot: Omit<ParkedLot, 'id'>) => {
      const client = db();
      const { data, error: err } = await client
        .from('parked_lots')
        .insert(parkedLotPayload(lot))
        .select('id')
        .single();
      if (err) throw err;
      try {
        if (lot.source === 'dividend' && lot.classification === 'return_of_capital') {
          await insertRocAllocations({ ...lot, id: data.id as string });
        }
      } finally {
        // Even if allocation fails, the inserted lot must reach the aggregate
        // and the UI — otherwise a natural retry duplicates the dividend. The
        // failed allocation stays repairable via the unallocated badge.
        await recomputeParkedAggregate(lot.parkedPositionId);
        await refresh();
      }
    },
    [refresh, recomputeParkedAggregate, insertRocAllocations],
  );

  /** Backfill/repair: allocate basis for ROC dividends that predate Phase 2
   * or whose allocation failed midway. Oldest-first ordering is the caller's
   * job; allocation itself is idempotent. One refresh at the end. */
  const allocateRocDividends = useCallback(
    async (dividendLotIds: string[]) => {
      try {
        for (const id of dividendLotIds) {
          const divLot = state.parkedLots.find((l) => l.id === id);
          if (!divLot || divLot.classification !== 'return_of_capital') continue;
          await insertRocAllocations(divLot);
        }
      } finally {
        await refresh();
      }
    },
    [refresh, state.parkedLots, insertRocAllocations],
  );

  /** Change a dividend's tax character. Confirming an 'unclassified' dividend
   * is normal bookkeeping; only a change to an already-confirmed class is a
   * true post-1099 correction and gets the reclassified stamp. Moving into
   * ROC allocates basis reductions; moving out deletes that event's rows —
   * exact reversal. Shares/amount untouched, so no aggregate recompute.
   * No refresh — the single and bulk callers layer their own. */
  const reclassifyCore = useCallback(
    async (id: string, classification: DividendClassification, exDate?: string | null) => {
      const client = db();
      const lot = state.parkedLots.find((l) => l.id === id);
      const prior = lot?.classification ?? 'unclassified';
      const toRoc = classification === 'return_of_capital' && prior !== 'return_of_capital';
      const fromRoc = prior === 'return_of_capital' && classification !== 'return_of_capital';
      if (fromRoc) {
        // Converging order: first back to "unallocated ROC", then drop the
        // rows, then change the class. A failure at any step leaves a state
        // the (idempotent) allocate affordance or a retry repairs — never
        // orphaned reductions under a non-ROC classification.
        const { error: unstampErr } = await client
          .from('parked_lots')
          .update({ roc_allocated_at: null, roc_overflow: null })
          .eq('id', id);
        if (unstampErr) throw unstampErr;
        const { error: delErr } = await client
          .from('parked_lot_adjustments').delete().eq('dividend_lot_id', id);
        if (delErr) throw delErr;
      }
      const payload: Record<string, unknown> = { classification };
      if (prior !== 'unclassified' && prior !== classification) {
        payload.reclassified_at = new Date().toISOString();
      }
      if (exDate !== undefined) payload.ex_date = exDate;
      const { error: err } = await client.from('parked_lots').update(payload).eq('id', id);
      if (err) throw err;
      if (toRoc && lot) await insertRocAllocations(lot);
    },
    [state.parkedLots, insertRocAllocations],
  );

  const reclassifyDividend = useCallback(
    async (id: string, classification: DividendClassification, exDate?: string | null) => {
      await reclassifyCore(id, classification, exDate);
      await refresh();
    },
    [refresh, reclassifyCore],
  );

  /** 1099 season: confirm a whole filtered set at once, with ONE refresh at
   * the end — a mid-list failure refreshes too, so the survivors show.
   * Oldest-first, ALWAYS: ROC allocation caps against remaining basis, so
   * order changes which dividend eats the basis and which overflows — this
   * must match the single-row and backfill paths' convention. Rows with no
   * ROC transition are plain classification updates and go as two batched
   * writes (stamped / unstamped) instead of one round trip per dividend. */
  const reclassifyDividends = useCallback(
    async (ids: string[], classification: DividendClassification) => {
      const client = db();
      const byId = new Map(state.parkedLots.map((l) => [l.id, l]));
      const ordered = [...ids].sort(
        (a, b) => (byId.get(a)?.date ?? '').localeCompare(byId.get(b)?.date ?? ''),
      );
      const isRoc = (c: DividendClassification | null | undefined) => c === 'return_of_capital';
      const transitions: string[] = [];
      const stamped: string[] = [];
      const plain: string[] = [];
      for (const id of ordered) {
        const prior = byId.get(id)?.classification ?? 'unclassified';
        if (prior === classification) continue;
        if (isRoc(prior) !== isRoc(classification)) transitions.push(id);
        else if (prior !== 'unclassified') stamped.push(id);
        else plain.push(id);
      }
      try {
        if (plain.length > 0) {
          const { error: err } = await client
            .from('parked_lots').update({ classification }).in('id', plain);
          if (err) throw err;
        }
        if (stamped.length > 0) {
          const { error: err } = await client
            .from('parked_lots')
            .update({ classification, reclassified_at: new Date().toISOString() })
            .in('id', stamped);
          if (err) throw err;
        }
        for (const id of transitions) {
          await reclassifyCore(id, classification);
        }
      } finally {
        await refresh();
      }
    },
    [refresh, reclassifyCore, state.parkedLots],
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
      const upper = ticker.toUpperCase();
      const existing = state.parked.find((x) => x.ticker === upper && x.accountId === accountId);
      if (existing && !isArchivedPosition(existing)) {
        throw new Error(`${upper} is already held in that account — add a lot from its row instead.`);
      }
      let positionId: string;
      if (existing) {
        // Revive the archived row — its dividend history picks right back up.
        const { error: reviveErr } = await client
          .from('parked_positions')
          .update({ category, current_price: price, notes: notes ?? null })
          .eq('id', existing.id);
        if (reviveErr) throw reviveErr;
        positionId = existing.id;
      } else {
        const { data, error: posErr } = await client
          .from('parked_positions')
          .insert({
            ticker: upper,
            account_id: accountId,
            category,
            shares,
            avg_cost: price,
            current_price: price,
            // Retirement adds start manual (plan codes are the norm there);
            // real-ticker funds opt in from the edit modal.
            live_quotes: !retirementAccountIds.has(accountId),
            notes: notes ?? null,
          })
          .select('id')
          .single();
        if (posErr) throw posErr;
        positionId = data.id as string;
      }
      const { error: lotErr } = await client.from('parked_lots').insert(
        parkedLotPayload({
          parkedPositionId: positionId,
          date,
          source: 'purchase',
          shares,
          price,
          amount: roundCents(shares * price),
        }),
      );
      if (lotErr) throw lotErr;
      if (existing) await recomputeParkedAggregate(positionId);
      await refresh();
    },
    [refresh, state.parked, recomputeParkedAggregate, retirementAccountIds],
  );

  const deleteParkedLot = useCallback(
    async (id: string) => {
      const client = db();
      const lot = state.parkedLots.find((l) => l.id === id);
      if (!lot) throw new Error('Lot not found');
      // A share lot's ROC adjustment rows die with it (cascade) — the
      // dividends that funded them must drop back to "unallocated" so the
      // Income badge offers the idempotent re-spread, instead of keeping a
      // stale "allocated" stamp over silently un-reduced basis.
      // Same-position dividends only: re-spread walks the DIVIDEND's own
      // position's lots, so un-stamping a carried (ACATS'd, cross-position)
      // dividend would invite a re-spread that erases the destination
      // position's surviving reductions and dumps everything to overflow.
      const divPositionById = new Map(state.parkedLots.map((l) => [l.id, l.parkedPositionId]));
      const affectedDividends = [
        ...new Set(
          state.parkedLotAdjustments
            .filter((a) => a.shareLotId === id && a.dividendLotId != null)
            .map((a) => a.dividendLotId as string)
            .filter((divId) => divPositionById.get(divId) === lot.parkedPositionId),
        ),
      ];
      // Un-stamp FIRST: unallocated-with-lot-present is repairable (the
      // re-spread converges), but a deleted lot under stale stamps is not —
      // the delete can't be retried once the lot row is gone.
      if (affectedDividends.length > 0) {
        const { error: unstampErr } = await client
          .from('parked_lots')
          .update({ roc_allocated_at: null, roc_overflow: null })
          .in('id', affectedDividends);
        if (unstampErr) throw unstampErr;
      }
      const { error: err } = await client.from('parked_lots').delete().eq('id', id);
      if (err) throw err;
      await recomputeParkedAggregate(lot.parkedPositionId);
      await refresh();
    },
    [refresh, recomputeParkedAggregate, state.parkedLots, state.parkedLotAdjustments],
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
      const positionAdjustments = adjustmentsForLots(positionLots, state.parkedLotAdjustments);

      const fromName = p.account;
      const { updates, deletes, adjustmentUpdates, consumed, cashSpendingBasisConsumed } =
        consumeLotsFifo(positionLots, shares, positionAdjustments);

      // Destination position: merge into an existing one or create it.
      const dest = state.parked.find(
        (x) => x.ticker === p.ticker && x.accountId === toAccountId,
      );
      let destId = dest?.id;
      if (dest && isArchivedPosition(dest)) {
        // Reviving an archived row: its price froze at archive time and the
        // quote loop has been skipping it — carry the source's current price.
        const { error: priceErr } = await client
          .from('parked_positions')
          .update({ current_price: p.currentPrice })
          .eq('id', dest.id);
        if (priceErr) throw priceErr;
      }
      if (!destId) {
        const { data, error: posErr } = await client
          .from('parked_positions')
          .insert({
            ticker: p.ticker,
            account_id: toAccountId,
            category: p.category,
            shares: 0, // recomputed from lots below
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
      // Dividend tax character (classification/ex-date/reclassified/ROC stamp
      // and stored overflow) must survive the move — consumed slices don't
      // carry it, the source lot does. One ordered batch insert: PostgREST
      // returns rows in input order, so consumed[i] ↔ newLots[i].
      const lotById = new Map(positionLots.map((l) => [l.id, l]));
      const { data: newLots, error: lotErr } = await client
        .from('parked_lots')
        .insert(
          consumed.map((c) => {
            const src = lotById.get(c.id);
            return parkedLotPayload({
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
              rocOverflow: src?.rocOverflow ?? null,
              origin: 'transfer',
              notes: `ACATS from ${fromName} ${date}`,
            });
          }),
        )
        .select('id');
      if (lotErr) throw lotErr;
      const oldToNew = new Map(consumed.map((c, i) => [c.id, (newLots ?? [])[i]?.id as string]));

      // Recreate each moved slice's ROC adjustment rows at the destination,
      // event linkage intact — reversal by dividend id must keep working
      // after the move. A dividend lot moving in this same transfer maps to
      // its new id; one that stays behind (cash ROC on the archived source)
      // keeps its original id.
      const destAdjRows = consumed.flatMap((c) => {
        const srcLot = lotById.get(c.id);
        if (!srcLot) return [];
        const fraction = srcLot.shares > 0 ? c.shares / srcLot.shares : 1;
        return positionAdjustments
          .filter((a) => a.shareLotId === c.id)
          .map((a) => ({ a, amount: round6(a.amount * fraction) }))
          .filter((x) => x.amount > 0)
          .map(({ a, amount }) =>
            parkedLotAdjustmentPayload({
              shareLotId: oldToNew.get(c.id) as string,
              dividendLotId: a.dividendLotId
                ? oldToNew.get(a.dividendLotId) ?? a.dividendLotId
                : null,
              amount,
            }),
          );
      });
      if (destAdjRows.length > 0) {
        const { error: adjErr } = await client.from('parked_lot_adjustments').insert(destAdjRows);
        if (adjErr) throw adjErr;
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
      // The source's tracked cash derives "spent" from CURRENT lot amounts,
      // so shrinking them just credited the transferred basis back — but
      // ACATS moves shares, not cash. A compensating adjustment (the same
      // heal mechanism reconcile uses) keeps the original purchase spent.
      const transferredBasis = roundCents(cashSpendingBasisConsumed);
      if (transferredBasis > 0) {
        const toName = state.accounts.find((a) => a.id === toAccountId)?.name ?? 'destination';
        const { error: cashErr } = await client.from('parked_cash_events').insert(
          parkedCashEventPayload({
            accountId: p.accountId,
            date,
            type: 'adjustment',
            amount: -transferredBasis,
            notes: `ACATS to ${toName} — purchase basis stays spent here`,
          }),
        );
        if (cashErr) throw cashErr;
      }
      // A full transfer moves the holding, not just shares — transition
      // rotations that sell it must follow to the destination, or the
      // source-position delete/archive silently kills the what-if.
      if (shares >= p.shares - 1e-9) {
        const { error: rotErr } = await client
          .from('scenario_rotations')
          .update({ sell_holding_id: destId })
          .eq('sell_holding_id', parkedId);
        if (rotErr) throw rotErr;
      }
      await Promise.all([recomputeParkedAggregate(destId), recomputeParkedAggregate(parkedId)]);
      await refresh();
    },
    [refresh, state.parked, state.parkedLots, state.parkedLotAdjustments, state.accounts, recomputeParkedAggregate],
  );

  // The O(accounts × ledger) walk runs ONCE per data change, not per call —
  // Accounts, ParkedPile, and Activity all invoke accountCash inside render
  // loops, and the un-memoized version recomputed five array scans each time.
  const accountCashById = useMemo(() => {
    const args = {
      parkedCashEvents: state.parkedCashEvents,
      parkedSales: state.parkedSales,
      parkedLots: state.parkedLots,
      parked: state.parked,
      cashEvents: state.cashEvents,
    };
    const m = new Map<string, ReturnType<typeof computeAccountCash>>();
    for (const a of state.accounts) m.set(a.id, computeAccountCash(a.id, args));
    return { m, args };
  }, [
    state.accounts, state.parkedCashEvents, state.parkedSales, state.parkedLots,
    state.parked, state.cashEvents,
  ]);
  const accountCash = useCallback(
    (accountId: string) =>
      accountCashById.m.get(accountId) ?? computeAccountCash(accountId, accountCashById.args),
    [accountCashById],
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
    async (accountId: string, actualBalance: number): Promise<{ adjusted: boolean; diff: number }> => {
      const tracked = accountCash(accountId).balance;
      const diff = roundCents(actualBalance - tracked);
      const matched = Math.abs(diff) < 0.005;
      // A clean reconcile still writes its (zero) row — the "reconciled Nd
      // ago" stamp keys off these, and the cleanest reconciler must not be
      // the one nagged as never-reconciled.
      const { error: err } = await db().from('parked_cash_events').insert(
        parkedCashEventPayload({
          accountId,
          date: todayISO(),
          type: 'adjustment',
          amount: matched ? 0 : diff,
          notes: `Reconciled to actual ${roundCents(actualBalance)}${matched ? ' — matched' : ''}`,
        }),
      );
      if (err) throw err;
      await refresh();
      return { adjusted: !matched, diff: matched ? 0 : diff };
    },
    [refresh, accountCash],
  );

  // The reversible-sale machinery lives in its own module; the provider
  // wires it to state and the ledger helpers.
  const {
    deleteParkedSale, updateParkedSale, recordTrim, undoParkedSale, editParkedSaleAmounts,
  } = useParkedSales({
    parked: state.parked,
    parkedLots: state.parkedLots,
    parkedLotAdjustments: state.parkedLotAdjustments,
    refresh,
    recomputeParkedAggregate,
    insertDepositWithTwin,
    insertRocAllocations,
  });

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
    // next app open writes a fresh snapshot from real data. GUARD: only when
    // example rows actually existed — with nothing to clear this must be a
    // no-op, never a wipe of real, unreconstructable history.
    if (exampleData.total > 0) {
      const { error: snapErr } = await client.from('snapshots').delete().gte('date', '1900-01-01');
      if (snapErr) throw snapErr;
      snapshotAttempted.current = false;
    }
    await refresh();
  }, [refresh, state.benchmarkDeposits, exampleData]);

  /** Delete a lot and its Buy cash event. Linked lots (buy_event_id) delete
   * the exact row; legacy lots fall back to ticker+date+amount matching, and
   * only when both the Buy match AND the lot signature are unambiguous —
   * two same-signature lots could otherwise eat each other's Buy. Returns
   * whether the ledger row went. */
  const deleteLot = useCallback(
    async (id: string): Promise<{ buyEventDeleted: boolean }> => {
      const client = db();
      const lot = state.lots.find((l) => l.id === id);
      if (!lot) throw new Error('Lot not found');
      const amount = roundCents(lot.shares * lot.avgCost);
      let buyEventId = lot.buyEventId ?? null;
      if (!buyEventId) {
        const buyMatches = state.cashEvents.filter(
          (e) =>
            e.type === 'Buy' && e.ticker === lot.ticker && e.date === lot.buyDate &&
            Math.abs(e.amount - amount) < 0.005,
        );
        const sameSignatureLots = state.lots.filter(
          (l) =>
            l.ticker === lot.ticker && l.buyDate === lot.buyDate &&
            Math.abs(roundCents(l.shares * l.avgCost) - amount) < 0.005,
        );
        if (buyMatches.length === 1 && sameSignatureLots.length === 1) {
          buyEventId = buyMatches[0].id;
        }
      }
      const { error: err } = await client.from('position_lots').delete().eq('id', id);
      if (err) throw err;
      if (buyEventId) {
        const { error: cashErr } = await client
          .from('cash_events').delete().eq('id', buyEventId);
        if (cashErr) {
          await refresh();
          throw new Error(
            `Lot deleted, but its Buy cash event didn't delete (${cashErr.message}) — remove the ${lot.buyDate} ${lot.ticker} Buy on the Cash Ledger or account cash overstates.`,
          );
        }
      }
      await refresh();
      return { buyEventDeleted: Boolean(buyEventId) };
    },
    [refresh, state.lots, state.cashEvents],
  );

  /** Non-monetary lot corrections — target, dates, thesis. Shares and cost
   * are immutable (they anchor the Buy cash event and basis math). A linked
   * lot's Buy ledger row follows a buy-date change so the pair stays true. */
  const updateLotDetails = useCallback(
    async (
      id: string,
      patch: { exitTarget?: number; exitDate?: string | null; buyDate?: string; thesis?: string | null },
    ) => {
      const client = db();
      const lot = state.lots.find((l) => l.id === id);
      const payload: Record<string, unknown> = {};
      if (patch.exitTarget !== undefined) payload.exit_target = patch.exitTarget;
      if (patch.exitDate !== undefined) payload.exit_date = patch.exitDate;
      if (patch.buyDate !== undefined) payload.buy_date = patch.buyDate;
      if (patch.thesis !== undefined) payload.thesis = patch.thesis;
      if (Object.keys(payload).length === 0) return;
      const { error: err } = await client.from('position_lots').update(payload).eq('id', id);
      if (err) throw err;
      if (patch.buyDate !== undefined && lot?.buyEventId) {
        const { error: cashErr } = await client
          .from('cash_events').update({ date: patch.buyDate }).eq('id', lot.buyEventId);
        if (cashErr) {
          throw new Error(
            `Lot updated, but its Buy ledger row's date didn't follow (${cashErr.message}) — retry, or the ledger shows the buy on the wrong day.`,
          );
        }
      }
      await refresh();
    },
    [refresh, state.lots],
  );

  /** Remove a mis-recorded milestone. Its companion artifacts — the
   * MilestoneBank ledger row and the VOO pile lot — stay; the confirm copy
   * lists them as manual follow-ups (deleting them here would guess). */
  const deleteMilestone = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('milestones').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

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
            origin: 'milestone',
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

  /** Targeted refetches for tables with zero cross-effects — a settings or
   * watchlist edit must not re-pull the entire ledger (the full refresh is
   * 20 paged reads). Same pattern as refreshScenarios. */
  // Small-table CRUD lives in its own module.
  const {
    updateSetting, updateSettings,
    addWatchlistItem, updateWatchlistItem, deleteWatchlistItem,
    addExpense, updateExpense, deleteExpense,
    addPileTaxSetAside, deletePileTaxSetAside, setCarryforward,
    addScenario, updateScenario, deleteScenario, duplicateScenario,
    addRotation, updateRotation, deleteRotation,
    setOverride, setOverrides, clearOverride, updateParkedPrices,
  } = useSmallTables({
    incomeScenarios: state.incomeScenarios,
    scenarioRotations: state.scenarioRotations,
    setState,
    refresh,
  });

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
      taxableParked,
      pileParked,
      btcParked,
      retirementParked,
      retirementAccountIds,
      quotes,
      dayChange,
      quotesAsOf,
      quotesError,
      quotesSettled,
      refreshQuotes,
      tickerNames,
      contributionCap,
      concentrationCap,
      ltTaxRate,
      stTaxRate,
      dividendTaxRates,
      updateSetting,
      updateSettings,
      setCarryforward,
      addWatchlistItem,
      updateWatchlistItem,
      deleteWatchlistItem,
      addExpense,
      updateExpense,
      deleteExpense,
      setIncomeUse,
      addPileTaxSetAside,
      deletePileTaxSetAside,
      loading,
      error,
      refresh,
      addCashEvent,
      updateCashEvent,
      deleteCashEvent,
      addLot,
      deleteLot,
      updateLotDetails,
      closePosition,
      recordSplit,
      setTradeWashSale,
      deleteTrade,
      updateParked,
      recordMilestone,
      deleteMilestone,
      addAccount,
      updateAccount,
      deleteAccount,
      addOutsideSale,
      deleteOutsideSale,
      recordTrim,
      addParkedLot,
      deleteParkedLot,
      reclassifyDividend,
      reclassifyDividends,
      allocateRocDividends,
      addParkedPosition,
      deleteParkedSale,
      updateParkedSale,
      undoParkedSale,
      editParkedSaleAmounts,
      transferParked,
      accountCash,
      addParkedCashEvent,
      deleteParkedCashEvent,
      reconcileAccountCash,
      exampleData,
      clearExampleData,
      setOverride,
      setOverrides,
      updateParkedPrices,
      clearOverride,
      addScenario,
      updateScenario,
      deleteScenario,
      duplicateScenario,
      addRotation,
      updateRotation,
      deleteRotation,
    }),
    [
      state, mergedParked, taxableParked, pileParked, btcParked, retirementParked, retirementAccountIds,
      quotes, dayChange, quotesAsOf, quotesError, quotesSettled, refreshQuotes, tickerNames,
      contributionCap,
      concentrationCap, ltTaxRate, stTaxRate, dividendTaxRates, updateSetting, updateSettings,
      setCarryforward, addWatchlistItem, updateWatchlistItem, deleteWatchlistItem,
      addExpense, updateExpense, deleteExpense, setIncomeUse,
      addPileTaxSetAside, deletePileTaxSetAside, loading, error,
      refresh, addCashEvent, updateCashEvent, deleteCashEvent, addLot, deleteLot, updateLotDetails,
      closePosition, recordSplit,
      setTradeWashSale, deleteTrade, updateParked, recordMilestone, deleteMilestone,
      addAccount, updateAccount, deleteAccount, addOutsideSale,
      deleteOutsideSale, recordTrim, addParkedLot, deleteParkedLot, reclassifyDividend,
      reclassifyDividends,
      allocateRocDividends, addParkedPosition,
      deleteParkedSale, updateParkedSale, undoParkedSale, editParkedSaleAmounts, transferParked,
      accountCash, addParkedCashEvent,
      deleteParkedCashEvent, reconcileAccountCash, exampleData, clearExampleData,
      setOverride, setOverrides, updateParkedPrices, clearOverride, addScenario, updateScenario,
      deleteScenario, duplicateScenario,
      addRotation, updateRotation, deleteRotation,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}

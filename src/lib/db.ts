/** Row ↔ engine-type mapping. DB is snake_case; the engine is camelCase.
 * Numeric columns are coerced with Number() defensively. */
import { supabase } from './supabase';
import type {
  Account,
  BenchmarkDeposit,
  CashEvent,
  IncomeScenario,
  LossCarryforward,
  MilestoneRecord,
  OutsideSale,
  ParkedCashEvent,
  ParkedLot,
  ParkedLotAdjustment,
  ParkedPosition,
  ParkedSale,
  PileTaxSetAside,
  PositionLot,
  ScenarioRotation,
  Snapshot,
  Expense,
  Trade,
  WatchlistItem,
} from './engine';

export function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

/** PostgREST enforces max-rows (default 1000) SERVER-side — a bare select on
 * a grown table silently truncates and every score computes from a partial
 * ledger. All full-table reads page until a short page. `build` must return a
 * FRESH query per call (builders are single-use) with a total order — ties
 * broken by a unique column — so pages can't skip or duplicate rows. */
const PAGE = 1000;
type Paged<Row> = { data: Row[] | null; error: { message: string } | null };
export async function fetchAll<Row = any>(
  build: () => { range(from: number, to: number): PromiseLike<Paged<Row>> },
): Promise<Paged<Row>> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { data: rows, error: null };
  }
}

export const mapCashEvent = (r: any): CashEvent => ({
  id: r.id,
  date: r.date,
  type: r.type,
  amount: Number(r.amount),
  ticker: r.ticker,
  sourceDestination: r.source_destination,
  accountId: r.account_id,
  destinationAccountId: r.destination_account_id,
  notes: r.notes,
});

export const cashEventPayload = (e: Omit<CashEvent, 'id'>) => ({
  date: e.date,
  type: e.type,
  amount: e.amount,
  ticker: e.ticker ?? null,
  source_destination: e.sourceDestination ?? null,
  account_id: e.accountId ?? null,
  destination_account_id: e.destinationAccountId ?? null,
  notes: e.notes ?? null,
});

export const mapAccount = (r: any): Account => ({
  id: r.id,
  name: r.name,
  broker: r.broker,
  kind: r.kind,
  retirementFlavor: r.retirement_flavor ?? null,
  notes: r.notes,
});

export const mapOutsideSale = (r: any): OutsideSale => ({
  id: r.id,
  accountId: r.account_id,
  ticker: r.ticker,
  saleDate: r.sale_date,
  loss: r.loss,
  notes: r.notes,
});

export const outsideSalePayload = (s: Omit<OutsideSale, 'id'>) => ({
  account_id: s.accountId,
  ticker: s.ticker,
  sale_date: s.saleDate,
  loss: s.loss,
  notes: s.notes ?? null,
});

export const mapLot = (r: any): PositionLot => ({
  id: r.id,
  ticker: r.ticker,
  buyDate: r.buy_date,
  shares: Number(r.shares),
  avgCost: Number(r.avg_cost),
  exitTarget: Number(r.exit_target),
  exitDate: r.exit_date ?? null,
  thesis: r.thesis,
  buyEventId: r.buy_event_id ?? null,
});

export const lotPayload = (l: Omit<PositionLot, 'id'>) => ({
  ticker: l.ticker,
  buy_date: l.buyDate,
  shares: l.shares,
  avg_cost: l.avgCost,
  exit_target: l.exitTarget,
  exit_date: l.exitDate ?? null,
  thesis: l.thesis ?? null,
  buy_event_id: l.buyEventId ?? null,
});

export const mapTrade = (r: any): Trade => ({
  id: r.id,
  ticker: r.ticker,
  openDate: r.open_date,
  closeDate: r.close_date,
  costBasis: Number(r.cost_basis),
  proceeds: Number(r.proceeds),
  washSale: r.wash_sale,
  exitReason: r.exit_reason,
  notes: r.notes,
});

export const tradePayload = (t: Omit<Trade, 'id'>) => ({
  ticker: t.ticker,
  open_date: t.openDate,
  close_date: t.closeDate,
  cost_basis: t.costBasis,
  proceeds: t.proceeds,
  wash_sale: t.washSale,
  exit_reason: t.exitReason ?? null,
  notes: t.notes ?? null,
});

export const mapMilestone = (r: any): MilestoneRecord & { id: string } => ({
  id: r.id,
  level: Number(r.level),
  accountValueAtHit: Number(r.account_value_at_hit),
  dateHit: r.date_hit,
  amountBanked: Number(r.amount_banked),
  parkedDestination: r.parked_destination,
});

export const milestonePayload = (m: MilestoneRecord) => ({
  level: m.level,
  account_value_at_hit: m.accountValueAtHit,
  date_hit: m.dateHit,
  amount_banked: m.amountBanked,
  parked_destination: m.parkedDestination ?? null,
});

export const mapBenchmarkDeposit = (r: any): BenchmarkDeposit => ({
  id: r.id,
  date: r.date,
  amount: Number(r.amount),
  vooPriceThatDay: Number(r.voo_price_that_day),
  cashEventId: r.cash_event_id ?? null,
});

/** Expects rows selected with `*, account:accounts(name)`. */
export const mapParked = (r: any): ParkedPosition => ({
  id: r.id,
  ticker: r.ticker,
  accountId: r.account_id,
  account: r.account?.name ?? '',
  category: r.category,
  shares: Number(r.shares),
  avgCost: Number(r.avg_cost),
  currentPrice: Number(r.current_price),
  buyDate: r.buy_date,
  trimRank: r.trim_rank,
  dividendRate: r.dividend_rate == null ? null : Number(r.dividend_rate),
  dividendFrequency: r.dividend_frequency ?? null,
  dividendGrowthPct: r.dividend_growth_pct == null ? null : Number(r.dividend_growth_pct),
  liveQuotes: r.live_quotes ?? null,
  incomeUse: r.income_use ?? null,
  notes: r.notes,
});

export const parkedPayload = (p: Omit<ParkedPosition, 'id' | 'account'>) => ({
  ticker: p.ticker,
  account_id: p.accountId,
  category: p.category,
  shares: p.shares,
  avg_cost: p.avgCost,
  current_price: p.currentPrice,
  buy_date: p.buyDate ?? null,
  trim_rank: p.trimRank ?? null,
  dividend_rate: p.dividendRate ?? null,
  dividend_frequency: p.dividendFrequency ?? null,
  dividend_growth_pct: p.dividendGrowthPct ?? null,
  income_use: p.incomeUse ?? null,
  notes: p.notes ?? null,
});

export const mapParkedLot = (r: any): ParkedLot => ({
  id: r.id,
  parkedPositionId: r.parked_position_id,
  date: r.date,
  source: r.source,
  shares: Number(r.shares),
  price: r.price === null ? null : Number(r.price),
  amount: Number(r.amount),
  classification: r.classification,
  exDate: r.ex_date,
  reclassifiedAt: r.reclassified_at,
  rocAllocatedAt: r.roc_allocated_at,
  rocOverflow: r.roc_overflow == null ? null : Number(r.roc_overflow),
  origin: r.origin ?? null,
  notes: r.notes,
});

export const parkedLotPayload = (l: Omit<ParkedLot, 'id'>) => ({
  parked_position_id: l.parkedPositionId,
  date: l.date,
  source: l.source,
  shares: l.shares,
  price: l.price ?? null,
  amount: l.amount,
  classification: l.classification ?? null,
  ex_date: l.exDate ?? null,
  reclassified_at: l.reclassifiedAt ?? null,
  roc_allocated_at: l.rocAllocatedAt ?? null,
  roc_overflow: l.rocOverflow ?? null,
  origin: l.origin ?? null,
  notes: l.notes ?? null,
});

export const mapParkedLotAdjustment = (r: any): ParkedLotAdjustment => ({
  id: r.id,
  shareLotId: r.share_lot_id,
  dividendLotId: r.dividend_lot_id,
  amount: Number(r.amount),
  createdAt: r.created_at,
});

export const parkedLotAdjustmentPayload = (a: Omit<ParkedLotAdjustment, 'id' | 'createdAt'>) => ({
  share_lot_id: a.shareLotId,
  dividend_lot_id: a.dividendLotId ?? null,
  amount: a.amount,
});

export const mapParkedSale = (r: any): ParkedSale => ({
  id: r.id,
  ticker: r.ticker,
  accountId: r.account_id,
  date: r.date,
  shares: Number(r.shares),
  pricePerShare: Number(r.price_per_share),
  proceeds: Number(r.proceeds),
  costBasis: r.cost_basis === null ? null : Number(r.cost_basis),
  ltShares: r.lt_shares === null ? null : Number(r.lt_shares),
  fundedChallenge: r.funded_challenge,
  consumedBasis: r.consumed_basis === null ? null : Number(r.consumed_basis),
  consumed: r.consumed ?? null,
  createdAt: r.created_at ?? null,
  notes: r.notes,
});

export const parkedSalePayload = (s: Omit<ParkedSale, 'id' | 'createdAt'>) => ({
  ticker: s.ticker,
  account_id: s.accountId,
  date: s.date,
  shares: s.shares,
  price_per_share: s.pricePerShare,
  proceeds: s.proceeds,
  cost_basis: s.costBasis ?? null,
  lt_shares: s.ltShares ?? null,
  funded_challenge: s.fundedChallenge,
  consumed_basis: s.consumedBasis ?? null,
  consumed: s.consumed ?? null,
  notes: s.notes ?? null,
});

export const mapPileTaxSetAside = (r: any): PileTaxSetAside => ({
  id: r.id,
  taxYear: r.tax_year,
  date: r.date,
  amount: Number(r.amount),
  notes: r.notes,
});

export const pileTaxSetAsidePayload = (s: Omit<PileTaxSetAside, 'id'>) => ({
  tax_year: s.taxYear,
  date: s.date,
  amount: s.amount,
  notes: s.notes ?? null,
});

export const mapExpense = (r: any): Expense => ({
  id: r.id,
  name: r.name,
  amount: Number(r.amount),
  cadence: r.cadence,
  category: r.category ?? null,
  active: r.active,
  notes: r.notes ?? null,
  createdAt: r.created_at ?? null,
});

export const expensePayload = (e: Omit<Expense, 'id' | 'createdAt'>) => ({
  name: e.name,
  amount: e.amount,
  cadence: e.cadence,
  category: e.category ?? null,
  active: e.active,
  notes: e.notes ?? null,
});

export const mapIncomeScenario = (r: any): IncomeScenario => ({
  id: r.id,
  name: r.name,
  description: r.description,
  targetAnnualIncome: r.target_annual_income == null ? null : Number(r.target_annual_income),
  targetYear: r.target_year == null ? null : Number(r.target_year),
  isActive: r.is_active,
  qualifiedRate: r.qualified_rate == null ? null : Number(r.qualified_rate),
  ordinaryRate: r.ordinary_rate == null ? null : Number(r.ordinary_rate),
  capitalGainRate: r.capital_gain_rate == null ? null : Number(r.capital_gain_rate),
  createdAt: r.created_at,
});

export const incomeScenarioPayload = (s: Omit<IncomeScenario, 'id' | 'createdAt'>) => ({
  name: s.name,
  description: s.description ?? null,
  target_annual_income: s.targetAnnualIncome ?? null,
  target_year: s.targetYear ?? null,
  is_active: s.isActive,
  qualified_rate: s.qualifiedRate ?? null,
  ordinary_rate: s.ordinaryRate ?? null,
  capital_gain_rate: s.capitalGainRate ?? null,
});

export const mapScenarioRotation = (r: any): ScenarioRotation => ({
  id: r.id,
  scenarioId: r.scenario_id,
  sellHoldingId: r.sell_holding_id,
  sellShares: r.sell_shares == null ? null : Number(r.sell_shares),
  sellPct: r.sell_pct == null ? null : Number(r.sell_pct),
  cashAmount: r.cash_amount == null ? null : Number(r.cash_amount),
  rotationDate: r.rotation_date,
  buySymbol: r.buy_symbol,
  buyYieldPct: Number(r.buy_yield_pct),
  buyDividendGrowthPct: Number(r.buy_dividend_growth_pct),
  buyClassificationMix: r.buy_classification_mix ?? {},
  notes: r.notes,
});

export const scenarioRotationPayload = (r: Omit<ScenarioRotation, 'id'>) => ({
  scenario_id: r.scenarioId,
  sell_holding_id: r.sellHoldingId ?? null,
  sell_shares: r.sellShares ?? null,
  sell_pct: r.sellPct ?? null,
  cash_amount: r.cashAmount ?? null,
  rotation_date: r.rotationDate,
  buy_symbol: r.buySymbol,
  buy_yield_pct: r.buyYieldPct,
  buy_dividend_growth_pct: r.buyDividendGrowthPct,
  buy_classification_mix: r.buyClassificationMix,
  notes: r.notes ?? null,
});

export const mapParkedCashEvent = (r: any): ParkedCashEvent => ({
  id: r.id,
  accountId: r.account_id,
  date: r.date,
  type: r.type,
  amount: Number(r.amount),
  notes: r.notes,
});

export const parkedCashEventPayload = (e: Omit<ParkedCashEvent, 'id'>) => ({
  account_id: e.accountId,
  date: e.date,
  type: e.type,
  amount: e.amount,
  notes: e.notes ?? null,
});

export const mapSnapshot = (r: any): Snapshot => ({
  date: r.date,
  accountValue: Number(r.account_value),
  bankedTotal: Number(r.banked_total),
  reservedTotal: Number(r.reserved_total),
  totalScore: Number(r.total_score),
  shadowVooValue: Number(r.shadow_voo_value),
  netContributed: Number(r.net_contributed),
  parkedPileValue: Number(r.parked_pile_value),
  semiAiPct: Number(r.semi_ai_pct),
  retirementValue: r.retirement_value === null || r.retirement_value === undefined
    ? null : Number(r.retirement_value),
  btcValue: r.btc_value === null || r.btc_value === undefined ? null : Number(r.btc_value),
});

export const mapCarryforward = (r: any): LossCarryforward => ({
  taxYear: r.tax_year,
  amount: Number(r.amount),
});

export const mapWatchlistItem = (r: any): WatchlistItem => ({
  id: r.id,
  ticker: r.ticker,
  catalyst: r.catalyst,
  catalystDate: r.catalyst_date,
  entryNote: r.entry_note,
  plannedTarget: r.planned_target == null ? null : Number(r.planned_target),
  entryTrigger: r.entry_trigger == null ? null : Number(r.entry_trigger),
  notes: r.notes,
  createdAt: r.created_at,
});

export const watchlistItemPayload = (w: Omit<WatchlistItem, 'id' | 'createdAt'>) => ({
  ticker: w.ticker,
  catalyst: w.catalyst ?? null,
  catalyst_date: w.catalystDate ?? null,
  entry_note: w.entryNote ?? null,
  planned_target: w.plannedTarget ?? null,
  entry_trigger: w.entryTrigger ?? null,
  notes: w.notes ?? null,
});

/** Row ↔ engine-type mapping. DB is snake_case; the engine is camelCase.
 * Numeric columns are coerced with Number() defensively. */
import { supabase } from './supabase';
import type {
  Account,
  BenchmarkDeposit,
  CashEvent,
  LossCarryforward,
  MilestoneRecord,
  OutsideSale,
  ParkedCashEvent,
  ParkedLot,
  ParkedLotAdjustment,
  ParkedPosition,
  ParkedSale,
  PositionLot,
  Snapshot,
  Trade,
} from './engine';

export function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  bailPoint: r.bail_point === null ? null : Number(r.bail_point),
  thesis: r.thesis,
});

export const lotPayload = (l: Omit<PositionLot, 'id'>) => ({
  ticker: l.ticker,
  buy_date: l.buyDate,
  shares: l.shares,
  avg_cost: l.avgCost,
  exit_target: l.exitTarget,
  bail_point: l.bailPoint ?? null,
  thesis: l.thesis ?? null,
});

export const mapTrade = (r: any): Trade => ({
  id: r.id,
  ticker: r.ticker,
  openDate: r.open_date,
  closeDate: r.close_date,
  costBasis: Number(r.cost_basis),
  proceeds: Number(r.proceeds),
  washSale: r.wash_sale,
  notes: r.notes,
});

export const tradePayload = (t: Omit<Trade, 'id'>) => ({
  ticker: t.ticker,
  open_date: t.openDate,
  close_date: t.closeDate,
  cost_basis: t.costBasis,
  proceeds: t.proceeds,
  wash_sale: t.washSale,
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
  notes: r.notes,
});

export const parkedSalePayload = (s: Omit<ParkedSale, 'id'>) => ({
  ticker: s.ticker,
  account_id: s.accountId,
  date: s.date,
  shares: s.shares,
  price_per_share: s.pricePerShare,
  proceeds: s.proceeds,
  cost_basis: s.costBasis ?? null,
  lt_shares: s.ltShares ?? null,
  funded_challenge: s.fundedChallenge,
  notes: s.notes ?? null,
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
});

export const mapCarryforward = (r: any): LossCarryforward => ({
  taxYear: r.tax_year,
  amount: Number(r.amount),
});

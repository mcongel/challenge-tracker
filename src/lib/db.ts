/** Row ↔ engine-type mapping. DB is snake_case; the engine is camelCase.
 * Numeric columns are coerced with Number() defensively. */
import { supabase } from './supabase';
import type {
  BenchmarkDeposit,
  CashEvent,
  LossCarryforward,
  MilestoneRecord,
  ParkedPosition,
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
  notes: r.notes,
});

export const cashEventPayload = (e: Omit<CashEvent, 'id'>) => ({
  date: e.date,
  type: e.type,
  amount: e.amount,
  ticker: e.ticker ?? null,
  source_destination: e.sourceDestination ?? null,
  notes: e.notes ?? null,
});

export const mapLot = (r: any): PositionLot => ({
  id: r.id,
  ticker: r.ticker,
  buyDate: r.buy_date,
  shares: Number(r.shares),
  avgCost: Number(r.avg_cost),
  exitTarget: Number(r.exit_target),
  bailPoint: Number(r.bail_point),
  thesis: r.thesis,
});

export const lotPayload = (l: Omit<PositionLot, 'id'>) => ({
  ticker: l.ticker,
  buy_date: l.buyDate,
  shares: l.shares,
  avg_cost: l.avgCost,
  exit_target: l.exitTarget,
  bail_point: l.bailPoint,
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

export const mapParked = (r: any): ParkedPosition => ({
  id: r.id,
  ticker: r.ticker,
  account: r.account,
  category: r.category,
  shares: Number(r.shares),
  avgCost: Number(r.avg_cost),
  currentPrice: Number(r.current_price),
  buyDate: r.buy_date,
  trimRank: r.trim_rank,
  notes: r.notes,
});

export const parkedPayload = (p: Omit<ParkedPosition, 'id'>) => ({
  ticker: p.ticker,
  account: p.account,
  category: p.category,
  shares: p.shares,
  avg_cost: p.avgCost,
  current_price: p.currentPrice,
  buy_date: p.buyDate ?? null,
  trim_rank: p.trimRank ?? null,
  notes: p.notes ?? null,
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

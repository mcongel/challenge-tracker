/**
 * Restore from a challenge-tracker JSON export (the download-everything file).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore.mjs export.json [--wipe]
 *
 * Upserts every table with original ids preserved so foreign keys survive.
 * --wipe deletes existing rows first (children before parents) for a clean
 * restore onto a damaged database. Without --wipe it merges over what's there.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { TABLE_NAMES, WIPE_ORDER, pkOf } from './tables.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv[2];
const wipe = process.argv.includes('--wipe');
if (!url || !key || !file) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore.mjs export.json [--wipe]');
  process.exit(1);
}

const supabase = createClient(url, key, { db: { schema: 'challenge' } });
const dump = JSON.parse(readFileSync(file, 'utf-8'));

const get = (k) => dump[k] ?? [];

// camelCase export objects → snake_case rows, ids preserved.
const TABLES = [
  ['accounts', get('accounts').map((a) => ({
    id: a.id, name: a.name, broker: a.broker ?? null, kind: a.kind, notes: a.notes ?? null,
  })), 'id'],
  ['parked_positions', get('parked_positions').map((p) => ({
    id: p.id, ticker: p.ticker, account_id: p.accountId, category: p.category,
    shares: p.shares, avg_cost: p.avgCost, current_price: p.currentPrice,
    buy_date: p.buyDate ?? null, trim_rank: p.trimRank ?? null,
    dividend_rate: p.dividendRate ?? null, dividend_frequency: p.dividendFrequency ?? null,
    dividend_growth_pct: p.dividendGrowthPct ?? null, notes: p.notes ?? null,
  })), 'id'],
  ['parked_lots', get('parked_lots').map((l) => ({
    id: l.id, parked_position_id: l.parkedPositionId, date: l.date ?? null, source: l.source,
    shares: l.shares, price: l.price ?? null, amount: l.amount,
    classification: l.classification ?? null, ex_date: l.exDate ?? null,
    reclassified_at: l.reclassifiedAt ?? null, roc_allocated_at: l.rocAllocatedAt ?? null,
    roc_overflow: l.rocOverflow ?? null, notes: l.notes ?? null,
  })), 'id'],
  ['parked_lot_adjustments', get('parked_lot_adjustments').map((a) => ({
    id: a.id, share_lot_id: a.shareLotId, dividend_lot_id: a.dividendLotId ?? null,
    amount: a.amount,
  })), 'id'],
  ['parked_cash_events', get('parked_cash_events').map((e) => ({
    id: e.id, account_id: e.accountId, date: e.date, type: e.type, amount: e.amount,
    notes: e.notes ?? null,
  })), 'id'],
  ['parked_sales', get('parked_sales').map((s) => ({
    id: s.id, ticker: s.ticker, account_id: s.accountId, date: s.date, shares: s.shares,
    price_per_share: s.pricePerShare, proceeds: s.proceeds, cost_basis: s.costBasis ?? null,
    lt_shares: s.ltShares ?? null, funded_challenge: s.fundedChallenge,
    consumed_basis: s.consumedBasis ?? null,
    consumed: s.consumed ?? null, created_at: s.createdAt ?? undefined, notes: s.notes ?? null,
  })), 'id'],
  ['income_scenarios', get('income_scenarios').map((s) => ({
    id: s.id, name: s.name, description: s.description ?? null,
    target_annual_income: s.targetAnnualIncome ?? null, target_year: s.targetYear ?? null,
    is_active: s.isActive, qualified_rate: s.qualifiedRate ?? null,
    ordinary_rate: s.ordinaryRate ?? null, capital_gain_rate: s.capitalGainRate ?? null,
    created_at: s.createdAt ?? undefined, // list order and default selection depend on it
  })), 'id'],
  ['scenario_rotations', get('scenario_rotations').map((r) => ({
    id: r.id, scenario_id: r.scenarioId, sell_holding_id: r.sellHoldingId ?? null,
    sell_shares: r.sellShares ?? null, sell_pct: r.sellPct ?? null,
    cash_amount: r.cashAmount ?? null, rotation_date: r.rotationDate, buy_symbol: r.buySymbol,
    buy_yield_pct: r.buyYieldPct, buy_dividend_growth_pct: r.buyDividendGrowthPct,
    buy_classification_mix: r.buyClassificationMix, notes: r.notes ?? null,
  })), 'id'],
  ['outside_sales', get('outside_sales').map((s) => ({
    id: s.id, account_id: s.accountId, ticker: s.ticker, sale_date: s.saleDate,
    loss: s.loss, notes: s.notes ?? null,
  })), 'id'],
  ['cash_events', get('cash_events').map((e) => ({
    id: e.id, date: e.date, type: e.type, amount: e.amount, ticker: e.ticker ?? null,
    source_destination: e.sourceDestination ?? null, account_id: e.accountId ?? null,
    destination_account_id: e.destinationAccountId ?? null, notes: e.notes ?? null,
    created_at: e.createdAt ?? undefined, // same-date rows order by it in the app
  })), 'id'],
  ['position_lots', get('position_lots').map((l) => ({
    id: l.id, ticker: l.ticker, buy_date: l.buyDate, shares: l.shares, avg_cost: l.avgCost,
    exit_target: l.exitTarget, bail_point: l.bailPoint ?? null, thesis: l.thesis ?? null,
    buy_event_id: l.buyEventId ?? null,
  })), 'id'],
  ['trades', get('trades').map((t) => ({
    id: t.id, ticker: t.ticker, open_date: t.openDate, close_date: t.closeDate,
    cost_basis: t.costBasis, proceeds: t.proceeds, wash_sale: t.washSale,
    exit_reason: t.exitReason ?? null, notes: t.notes ?? null,
  })), 'id'],
  ['milestones', get('milestones').map((m) => ({
    id: m.id, level: m.level, account_value_at_hit: m.accountValueAtHit, date_hit: m.dateHit,
    amount_banked: m.amountBanked, parked_destination: m.parkedDestination ?? null,
  })), 'id'],
  ['benchmark_deposits', get('benchmark_deposits').map((b) => ({
    id: b.id, date: b.date, amount: b.amount, voo_price_that_day: b.vooPriceThatDay,
    cash_event_id: b.cashEventId ?? null,
  })), 'id'],
  ['snapshots', get('snapshots').map((s) => ({
    date: s.date, account_value: s.accountValue, banked_total: s.bankedTotal,
    reserved_total: s.reservedTotal, total_score: s.totalScore,
    shadow_voo_value: s.shadowVooValue, net_contributed: s.netContributed,
    parked_pile_value: s.parkedPileValue, semi_ai_pct: s.semiAiPct,
  })), 'date'],
  ['loss_carryforwards', get('loss_carryforwards').map((c) => ({
    tax_year: c.taxYear, amount: c.amount, notes: c.notes ?? null,
  })), 'tax_year'],
  ['price_overrides', get('price_overrides').map((o) => ({
    ticker: o.ticker, price: o.price,
    set_at: o.setAt ?? undefined, // the "pinned since" staleness cue reads it
  })), 'ticker'],
  ['app_settings', get('app_settings').map((s) => ({
    key: s.key, value: s.value, updated_at: s.updatedAt ?? undefined,
  })), 'key'],
  ['watchlist', get('watchlist').map((w) => ({
    id: w.id, ticker: w.ticker, catalyst: w.catalyst ?? null,
    catalyst_date: w.catalystDate ?? null, entry_note: w.entryNote ?? null,
    planned_target: w.plannedTarget ?? null, entry_trigger: w.entryTrigger ?? null,
    notes: w.notes ?? null,
    created_at: w.createdAt ?? undefined,
  })), 'id'],
];

// Drift guard: the shared roster and this file's mappers must agree — a
// table added to one but not the other means silent data loss on the next
// backup or restore, exactly when it hurts most.
{
  const mapped = new Set(TABLES.map(([t]) => t));
  const shared = new Set(TABLE_NAMES);
  const missing = [...shared].filter((t) => !mapped.has(t));
  const extra = [...mapped].filter((t) => !shared.has(t));
  if (missing.length > 0 || extra.length > 0) {
    console.error(
      `Table roster drift — missing mappers: [${missing.join(', ')}], unlisted mappers: [${extra.join(', ')}]. Fix scripts/tables.mjs and restore.mjs together.`,
    );
    process.exit(1);
  }
}

if (wipe) {
  for (const table of WIPE_ORDER) {
    const { error } = await supabase.from(table).delete().not(pkOf(table), 'is', null);
    if (error) { console.error(`wipe ${table}:`, error.message); process.exit(1); }
    console.log(`wiped ${table}`);
  }
}

for (const [table, rows, conflict] of TABLES) {
  if (rows.length === 0) { console.log(`${table}: nothing to restore`); continue; }
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
  if (error) { console.error(`${table}:`, error.message); process.exit(1); }
  console.log(`${table}: restored ${rows.length} rows`);
}
console.log('Restore complete.');

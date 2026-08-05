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
    buy_date: p.buyDate ?? null, trim_rank: p.trimRank ?? null, notes: p.notes ?? null,
  })), 'id'],
  ['parked_lots', get('parked_lots').map((l) => ({
    id: l.id, parked_position_id: l.parkedPositionId, date: l.date ?? null, source: l.source,
    shares: l.shares, price: l.price ?? null, amount: l.amount, notes: l.notes ?? null,
  })), 'id'],
  ['parked_sales', get('parked_sales').map((s) => ({
    id: s.id, ticker: s.ticker, account_id: s.accountId, date: s.date, shares: s.shares,
    price_per_share: s.pricePerShare, proceeds: s.proceeds, cost_basis: s.costBasis ?? null,
    lt_shares: s.ltShares ?? null, funded_challenge: s.fundedChallenge, notes: s.notes ?? null,
  })), 'id'],
  ['outside_sales', get('outside_sales').map((s) => ({
    id: s.id, account_id: s.accountId, ticker: s.ticker, sale_date: s.saleDate,
    loss: s.loss, notes: s.notes ?? null,
  })), 'id'],
  ['cash_events', get('cash_events').map((e) => ({
    id: e.id, date: e.date, type: e.type, amount: e.amount, ticker: e.ticker ?? null,
    source_destination: e.sourceDestination ?? null, account_id: e.accountId ?? null,
    destination_account_id: e.destinationAccountId ?? null, notes: e.notes ?? null,
  })), 'id'],
  ['position_lots', get('position_lots').map((l) => ({
    id: l.id, ticker: l.ticker, buy_date: l.buyDate, shares: l.shares, avg_cost: l.avgCost,
    exit_target: l.exitTarget, bail_point: l.bailPoint ?? null, thesis: l.thesis ?? null,
  })), 'id'],
  ['trades', get('trades').map((t) => ({
    id: t.id, ticker: t.ticker, open_date: t.openDate, close_date: t.closeDate,
    cost_basis: t.costBasis, proceeds: t.proceeds, wash_sale: t.washSale, notes: t.notes ?? null,
  })), 'id'],
  ['milestones', get('milestones').map((m) => ({
    id: m.id, level: m.level, account_value_at_hit: m.accountValueAtHit, date_hit: m.dateHit,
    amount_banked: m.amountBanked, parked_destination: m.parkedDestination ?? null,
  })), 'id'],
  ['benchmark_deposits', get('benchmark_deposits').map((b) => ({
    id: b.id, date: b.date, amount: b.amount, voo_price_that_day: b.vooPriceThatDay,
  })), 'id'],
  ['snapshots', get('snapshots').map((s) => ({
    date: s.date, account_value: s.accountValue, banked_total: s.bankedTotal,
    reserved_total: s.reservedTotal, total_score: s.totalScore,
    shadow_voo_value: s.shadowVooValue, net_contributed: s.netContributed,
    parked_pile_value: s.parkedPileValue, semi_ai_pct: s.semiAiPct,
  })), 'date'],
  ['loss_carryforwards', get('loss_carryforwards').map((c) => ({
    tax_year: c.taxYear, amount: c.amount,
  })), 'tax_year'],
  ['price_overrides', get('price_overrides').map((o) => ({
    ticker: o.ticker, price: o.price,
  })), 'ticker'],
  ['app_settings', get('app_settings').map((s) => ({ key: s.key, value: s.value })), 'key'],
];

if (wipe) {
  // Children before parents; accounts last.
  const order = [
    'parked_lots', 'parked_sales', 'outside_sales', 'cash_events', 'position_lots', 'trades',
    'milestones', 'benchmark_deposits', 'snapshots', 'loss_carryforwards', 'price_overrides',
    'parked_positions', 'app_settings', 'accounts',
  ];
  for (const table of order) {
    const pk = table === 'snapshots' ? 'date' : table === 'loss_carryforwards' ? 'tax_year'
      : table === 'price_overrides' ? 'ticker' : table === 'app_settings' ? 'key' : 'id';
    const { error } = await supabase.from(table).delete().not(pk, 'is', null);
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

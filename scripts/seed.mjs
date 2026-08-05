/**
 * One-time seed from the reference workbook, then verification.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs [--with-examples]
 *
 * Seeds the Parked Pile (real holdings, upserted by ticker+account — safe to
 * re-run). --with-examples also loads the workbook's EXAMPLE rows (NBIS lot,
 * two cash events, one benchmark deposit) into empty tables, useful for
 * checking app numbers against the workbook before real data exists.
 *
 * After seeding it re-reads everything and diffs computed totals against the
 * workbook's numbers — "import worked" as a check, not a vibe.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const withExamples = process.argv.includes('--with-examples');

const supabase = createClient(url, key, { db: { schema: 'challenge' } });

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/lib/engine/__fixtures__/parked-pile.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

async function fail(step, error) {
  console.error(`FAILED at ${step}:`, error.message ?? error);
  process.exit(1);
}

// ------------------------------------------------------------ parked pile
// Accounts are FK references; resolve fixture names to ids (creating any
// missing outside accounts first).
const accountIds = new Map();
{
  const names = [...new Set(fixture.positions.map((p) => p.account))];
  const { error: insErr } = await supabase
    .from('accounts')
    .upsert(names.map((name) => ({ name, kind: 'outside' })), {
      onConflict: 'name',
      ignoreDuplicates: true,
    });
  if (insErr) await fail('accounts upsert', insErr);
  const { data, error } = await supabase.from('accounts').select('id, name');
  if (error) await fail('accounts read', error);
  for (const a of data) accountIds.set(a.name, a.id);
}

const parkedRows = fixture.positions.map((p) => ({
  ticker: p.ticker,
  account_id: accountIds.get(p.account),
  category: p.category,
  shares: p.shares,
  avg_cost: p.avgCost,
  current_price: p.currentPrice,
  notes: p.notes ?? null,
}));

{
  const { error } = await supabase
    .from('parked_positions')
    .upsert(parkedRows, { onConflict: 'ticker,account_id' });
  if (error) await fail('parked_positions upsert', error);
  console.log(`Parked pile: upserted ${parkedRows.length} positions.`);
}

// ------------------------------------------------------------ examples
if (withExamples) {
  const seedIfEmpty = async (table, rows) => {
    const { count, error: countError } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (countError) await fail(`${table} count`, countError);
    if (count > 0) {
      console.log(`${table}: already has ${count} rows, skipping examples.`);
      return;
    }
    const { error } = await supabase.from(table).insert(rows);
    if (error) await fail(`${table} insert`, error);
    console.log(`${table}: seeded ${rows.length} example row(s).`);
  };

  await seedIfEmpty('cash_events', [
    { date: '2026-08-10', type: 'Deposit', amount: 6000, source_destination: 'Cash App sales', notes: 'EXAMPLE — initial funding from loser/dead-weight sales' },
    { date: '2026-08-12', type: 'Buy', amount: 6004.68, ticker: 'NBIS', notes: 'EXAMPLE — matches Positions example row' },
  ]);
  await seedIfEmpty('position_lots', [
    { ticker: 'NBIS', buy_date: '2026-08-10', shares: 26.6, avg_cost: 225.74, exit_target: 290, bail_point: 190, thesis: 'EXAMPLE ROW — AI infra momentum, target +28%.' },
  ]);
  await seedIfEmpty('trades', [
    { ticker: 'MU', open_date: '2026-03-02', close_date: '2026-06-15', cost_basis: 1000, proceeds: 2455.11, wash_sale: false, notes: 'EXAMPLE ROW (realized MU gain lives in Cash App, not here)' },
  ]);
  await seedIfEmpty('benchmark_deposits', [
    { date: '2026-08-10', amount: 6000, voo_price_that_day: 620 },
  ]);
}

// ------------------------------------------------------------ verify
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const checks = [];

{
  const { data, error } = await supabase.from('parked_positions').select('*');
  if (error) await fail('verify read', error);
  const value = data.reduce((s, p) => s + Number(p.shares) * Number(p.current_price), 0);
  const basis = data.reduce((s, p) => s + Number(p.shares) * Number(p.avg_cost), 0);
  const semi = data
    .filter((p) => p.category === 'Semi/AI')
    .reduce((s, p) => s + Number(p.shares) * Number(p.current_price), 0);
  const e = fixture.expected;
  checks.push(['parked market value', value, e.totalMarketValue, near(value, e.totalMarketValue)]);
  checks.push(['parked cost basis', basis, e.totalCostBasis, near(basis, e.totalCostBasis)]);
  checks.push(['Semi/AI %', semi / value, e.semiAiPct, near(semi / value, e.semiAiPct, 1e-9)]);
}

if (withExamples) {
  const { data: events } = await supabase.from('cash_events').select('*');
  const cash = events.reduce(
    (s, ev) =>
      s + (['Deposit', 'Sell', 'Dividend'].includes(ev.type) ? Number(ev.amount) : -Number(ev.amount)),
    0,
  );
  const { data: lots } = await supabase.from('position_lots').select('*');
  const positionsValue = lots.reduce((s, l) => s + Number(l.shares) * Number(l.avg_cost), 0);
  checks.push(['current cash', cash, -4.68, near(cash, -4.68, 0.005)]);
  checks.push(['account value @ entry prices', positionsValue + cash, 6000.004, near(positionsValue + cash, 6000.004, 0.005)]);
}

let ok = true;
for (const [label, got, want, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${got} (workbook: ${want})`);
  if (!pass) ok = false;
}
if (!ok) process.exit(1);
console.log('Seed verified against the workbook.');

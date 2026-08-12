/**
 * Dump every challenge table to one JSON file in the exact shape
 * scripts/restore.mjs consumes (and the in-app export produces):
 * snake_case table keys, camelCase row fields, ids preserved.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs [out.json]
 *
 * Run nightly by the GitHub Actions workflow, uploaded as a 90-day artifact.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = process.argv[2] ?? `challenge-backup-${new Date().toISOString().slice(0, 10)}.json`;
if (!url || !key) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs [out.json]');
  process.exit(1);
}

const supabase = createClient(url, key, { db: { schema: 'challenge' } });

// Same 18 tables restore.mjs handles, listed parent-first for readability.
const TABLES = [
  'accounts',
  'cash_events',
  'position_lots',
  'trades',
  'outside_sales',
  'milestones',
  'benchmark_deposits',
  'parked_positions',
  'parked_lots',
  'parked_lot_adjustments',
  'parked_sales',
  'parked_cash_events',
  'income_scenarios',
  'scenario_rotations',
  'snapshots',
  'loss_carryforwards',
  'price_overrides',
  'app_settings',
];

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const camelRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));

const dump = {};
for (const table of TABLES) {
  // .range beats the client's default 1000-row cap; these tables stay far
  // below 50k, and a truncated backup must fail loudly rather than lie.
  const { data, error } = await supabase.from(table).select('*').range(0, 49999);
  if (error) {
    console.error(`${table}: ${error.message}`);
    process.exit(1);
  }
  if ((data ?? []).length >= 50000) {
    console.error(`${table}: hit the 50k page cap — backup would be truncated. Add pagination.`);
    process.exit(1);
  }
  dump[table] = (data ?? []).map(camelRow);
  console.log(`${table}: ${dump[table].length} rows`);
}

writeFileSync(out, JSON.stringify(dump, null, 1));
console.log(`Backup written to ${out}`);

/**
 * Dump every challenge table to one JSON file in the shape
 * scripts/restore.mjs consumes (and the in-app export produces):
 * snake_case table keys, camelCase row fields, ids preserved. The dump
 * carries every column; restore writes the columns it maps (see its notes).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs [out.json]
 *
 * Run nightly by the GitHub Actions workflow, uploaded as a 90-day artifact.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { TABLE_NAMES, fetchAllRows } from './tables.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = process.argv[2] ?? `challenge-backup-${new Date().toISOString().slice(0, 10)}.json`;
if (!url || !key) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs [out.json]');
  process.exit(1);
}

const supabase = createClient(url, key, { db: { schema: 'challenge' } });

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const camelRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));

// exportedAt makes 90 days of identically-named artifacts self-identifying;
// restore reads only the table keys, so extra metadata is harmless.
const dump = { exportedAt: new Date().toISOString() };
for (const table of TABLE_NAMES) {
  let rows;
  try {
    rows = await fetchAllRows(supabase, table);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  dump[table] = rows.map(camelRow);
  console.log(`${table}: ${rows.length} rows`);
}

writeFileSync(out, JSON.stringify(dump, null, 2));
console.log(`Backup written to ${out}`);

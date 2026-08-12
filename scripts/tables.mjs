/**
 * The single list of challenge-schema tables, shared by backup.mjs and
 * restore.mjs so the roster can't drift per script. If a migration adds a
 * table, add it HERE plus a mapper in restore.mjs — restore asserts the two
 * agree and fails loudly on a mismatch.
 */
export const TABLE_NAMES = [
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

/** Wipe order for --wipe restores: children before parents; accounts last. */
export const WIPE_ORDER = [
  'scenario_rotations', 'income_scenarios',
  'parked_lot_adjustments', 'parked_lots', 'parked_sales', 'parked_cash_events',
  'outside_sales', 'cash_events', 'position_lots', 'trades',
  'milestones', 'benchmark_deposits', 'snapshots', 'loss_carryforwards', 'price_overrides',
  'parked_positions', 'app_settings', 'accounts',
];

/** Page size for full-table reads. PostgREST enforces max-rows (default
 * 1000) SERVER-side — a bigger .range cannot beat it, so callers must page
 * until a short page. */
export const PAGE = 1000;

export async function fetchAllRows(supabase, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table).select('*').range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

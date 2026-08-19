/**
 * One-time load of the TIAA retirement holdings (statement of 2026-08-18)
 * into the TIAA retirement account, then verification against the
 * statement's own totals.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-tiaa.mjs
 *
 * Mirrors the app's own Buy path: one parked_positions row plus one
 * 'purchase' lot per holding (lot date null — the real buy dates are years
 * of contributions; basis comes straight from the statement). Tickers are
 * TIAA's fund codes (W146…) as shown on their site; full fund names ride in
 * notes. TIAA Traditional has no units, so it's tracked as 1 unit at the
 * account value.
 *
 * Safe to re-run: holdings already present in the account are skipped.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const supabase = createClient(url, key, { db: { schema: 'challenge' } });

const fail = (step, error) => {
  console.error(`FAILED at ${step}:`, error.message ?? error);
  process.exit(1);
};

// Statement rows: value is what TIAA showed — used only to verify
// shares × price reproduces it.
const HOLDINGS = [
  { ticker: 'W146', name: 'TIAA Access American Funds EUPAC Fund T1', category: 'International', shares: 210.1798, price: 81.4141, basis: 16145.85, value: 17111.60 },
  { ticker: 'W156', name: 'TIAA Access Dodge & Cox International Stock T1', category: 'International', shares: 253.9946, price: 70.4887, basis: 17153.37, value: 17903.75 },
  { ticker: 'W168', name: 'TIAA Access Nomura Emerging Market T1', category: 'Emerging Markets', shares: 178.9345, price: 140.5140, basis: 25730.03, value: 25142.80 },
  { ticker: 'W157', name: 'TIAA Access Vanguard Emerging Markets Stock Index T1', category: 'Emerging Markets', shares: 380.6696, price: 44.4246, basis: 17153.35, value: 16911.10 },
  { ticker: 'W179', name: 'TIAA Access Vanguard Extended Market Index T1', category: 'US Index', shares: 617.1234, price: 73.4987, basis: 41875.87, value: 45357.77 },
  { ticker: 'W548', name: 'TIAA Access Vanguard Institutional Index Plus T1', category: 'US Index', shares: 1454.5075, price: 61.4761, basis: 78400.25, value: 89417.45 },
  { ticker: 'TRAD', name: 'TIAA Traditional — guaranteed annuity, no units; tracked as 1 unit at account value', category: 'Stable Value', shares: 1, price: 10601.69, basis: 10601.69, value: 10601.69 },
];

// ------------------------------------------------------- resolve the account
const { data: accounts, error: acctErr } = await supabase.from('accounts').select('*');
if (acctErr) fail('accounts read', acctErr);
let account = accounts.find((a) => a.kind === 'retirement' && /tiaa/i.test(a.name));
if (!account) {
  const wrongKind = accounts.find((a) => /tiaa/i.test(a.name));
  if (wrongKind) {
    fail('account resolve', new Error(
      `Account "${wrongKind.name}" exists but its kind is '${wrongKind.kind}' — ` +
      "change it to 'retirement' on the Accounts screen first.",
    ));
  }
  const { data, error } = await supabase
    .from('accounts')
    .insert({ name: 'TIAA', kind: 'retirement', broker: 'TIAA' })
    .select('*')
    .single();
  if (error) fail('account create', error);
  account = data;
  console.log("Created retirement account 'TIAA' (no flavor set — label it on the Accounts screen).");
}
console.log(`Loading into ${account.name} (${account.kind}${account.retirement_flavor ? `, ${account.retirement_flavor}` : ''}).`);

// ------------------------------------------------------------------- insert
const { data: existing, error: posErr } = await supabase
  .from('parked_positions').select('ticker').eq('account_id', account.id);
if (posErr) fail('positions read', posErr);
const held = new Set(existing.map((p) => p.ticker));

for (const h of HOLDINGS) {
  if (held.has(h.ticker)) {
    console.log(`${h.ticker}: already in the account, skipping.`);
    continue;
  }
  const avgCost = h.basis / h.shares;
  const { data: pos, error: insErr } = await supabase
    .from('parked_positions')
    .insert({
      ticker: h.ticker,
      account_id: account.id,
      category: h.category,
      shares: h.shares,
      avg_cost: avgCost,
      current_price: h.price,
      notes: h.name,
    })
    .select('id')
    .single();
  if (insErr) fail(`${h.ticker} position insert`, insErr);
  const { error: lotErr } = await supabase.from('parked_lots').insert({
    parked_position_id: pos.id,
    date: null,
    source: 'purchase',
    shares: h.shares,
    price: avgCost,
    amount: h.basis,
    notes: 'Opening load from TIAA statement 2026-08-18',
  });
  if (lotErr) fail(`${h.ticker} lot insert`, lotErr);
  console.log(`${h.ticker}: ${h.shares} units @ ${h.price} (basis ${h.basis}) — ${h.name}`);
}

// ------------------------------------------------------------------- verify
const { data: rows, error: verErr } = await supabase
  .from('parked_positions').select('*').eq('account_id', account.id);
if (verErr) fail('verify read', verErr);

let ok = true;
const near = (a, b, eps) => Math.abs(a - b) <= eps;
for (const h of HOLDINGS) {
  const p = rows.find((r) => r.ticker === h.ticker);
  if (!p) { console.log(`FAIL  ${h.ticker}: missing after insert`); ok = false; continue; }
  const value = Number(p.shares) * Number(p.current_price);
  const pass = near(value, h.value, 0.02);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${h.ticker}: value ${value.toFixed(2)} (statement: ${h.value.toFixed(2)})`);
  if (!pass) ok = false;
}
const total = rows.reduce((s, p) => s + Number(p.shares) * Number(p.current_price), 0);
const expectedTotal = HOLDINGS.reduce((s, h) => s + h.value, 0);
console.log(`Account total: ${total.toFixed(2)} (statement: ${expectedTotal.toFixed(2)})`);
if (!near(total, expectedTotal, 0.10)) ok = false;

if (!ok) process.exit(1);
console.log('TIAA holdings loaded and verified.');

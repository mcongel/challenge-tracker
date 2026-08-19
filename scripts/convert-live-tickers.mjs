/**
 * One-time conversion of retirement plan codes to real fund tickers, gated
 * on the numbers actually agreeing (statement of 2026-08-19).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/convert-live-tickers.mjs
 *
 * Requires the 20260828 live_quotes migration. For each mapping it converts
 * ONLY rows whose stored unit value is within 5% of the fund's live NAV —
 * the same plan code also labels annuity units in the ORP accounts, where
 * the unit value is NOT the NAV and quote pricing would corrupt the total.
 * Those rows are reported and left manual. Also flips Swan IRA's BTC to
 * live quotes (real bitcoin, verified against the live price the same way).
 *
 * Safe to re-run: already-converted rows no longer match any plan code.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const supabase = createClient(url, key, { db: { schema: 'challenge' } });
const QUOTES_BASE = process.env.QUOTES_BASE ?? 'https://challenge-tracker.pages.dev';

// code = the plan's fund number as loaded; ticker = the real fund.
const MAPPINGS = [
  { code: '3494', ticker: 'JLGMX', name: 'JPMorgan Large Cap Growth R6' },
  { code: 'C801', ticker: 'RPTTX', name: 'T. Rowe Price Diversified Mid Cap Growth' },
  { code: '0958', ticker: 'MSIGX', name: 'Invesco Main Street Fund A' },
  { code: '0742', ticker: 'IEOHX', name: 'Voya Large Cap Growth Port Inst' },
  { code: '0081', ticker: 'IIMOX', name: 'Voya MidCap Opportunities Port I' },
  { code: '2085', ticker: 'NAWGX', name: 'Voya Glo High Div Low Vol Prtf S' },
  { code: 'BTC', ticker: 'BTC', name: 'Bitcoin' }, // no rename — just verify + enable
];
const TOLERANCE = 0.05;

const fail = (step, error) => {
  console.error(`FAILED at ${step}:`, error.message ?? error);
  process.exit(1);
};

// Preflight: the live_quotes column must exist.
{
  const { error } = await supabase.from('parked_positions').select('id, live_quotes').limit(1);
  if (error) {
    fail('preflight', new Error(
      `${error.message} — run supabase/migrations/20260828000000_live_quotes.sql first.`,
    ));
  }
}

const res = await fetch(
  `${QUOTES_BASE}/api/quotes?tickers=${[...new Set(MAPPINGS.map((m) => m.ticker))].join(',')}`,
);
if (!res.ok) fail('quote fetch', new Error(`HTTP ${res.status}`));
const nav = Object.fromEntries(
  Object.entries((await res.json()).quotes ?? {}).map(([t, q]) => [t, q.price]),
);
console.log('Live NAVs:', JSON.stringify(nav));

const { data: accounts } = await supabase.from('accounts').select('*').eq('kind', 'retirement');
const accountName = new Map(accounts.map((a) => [a.id, a.name]));
const { data: rows, error: rowErr } = await supabase
  .from('parked_positions').select('*').in('account_id', accounts.map((a) => a.id));
if (rowErr) fail('positions read', rowErr);

for (const m of MAPPINGS) {
  const price = nav[m.ticker];
  if (!price) { console.log(`${m.ticker}: no quote — skipping mapping entirely.`); continue; }
  for (const r of rows.filter((x) => x.ticker === m.code)) {
    const acct = accountName.get(r.account_id);
    const drift = Math.abs(Number(r.current_price) - price) / price;
    if (drift > TOLERANCE) {
      console.log(
        `SKIP  ${acct} ${m.code}: unit value ${r.current_price} vs ${m.ticker} NAV ${price} ` +
        `(${(drift * 100).toFixed(0)}% apart) — annuity units, stays hand-priced.`,
      );
      continue;
    }
    // A hand-added row already bearing the real ticker in the same account
    // is a duplicate of this one — remove it (lots cascade), but only if the
    // share counts agree; anything else needs human eyes.
    if (m.code !== m.ticker) {
      const dupe = rows.find((x) => x.account_id === r.account_id && x.ticker === m.ticker);
      if (dupe) {
        const shareGap = Math.abs(Number(dupe.shares) - Number(r.shares)) / Number(r.shares);
        if (shareGap > 0.01) {
          console.log(
            `SKIP  ${acct} ${m.code}: a ${m.ticker} row already exists with different shares ` +
            `(${dupe.shares} vs ${r.shares}) — resolve by hand.`,
          );
          continue;
        }
        const { error: delErr } = await supabase.from('parked_positions').delete().eq('id', dupe.id);
        if (delErr) fail(`${m.ticker} duplicate delete`, delErr);
        console.log(`      ${acct}: removed duplicate hand-added ${m.ticker} row (${dupe.shares} sh).`);
      }
    }
    const { error: upErr } = await supabase.from('parked_positions')
      .update({
        ticker: m.ticker,
        live_quotes: true,
        current_price: Math.round(price * 10000) / 10000,
        notes: r.notes ?? m.name,
      })
      .eq('id', r.id);
    if (upErr) fail(`${m.code} -> ${m.ticker} update`, upErr);
    console.log(`OK    ${acct} ${m.code} -> ${m.ticker} @ ${price} (was ${r.current_price}) — live quotes on.`);
  }
}
console.log('Done.');

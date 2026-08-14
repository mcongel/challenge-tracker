/**
 * Market-hours alert check — the out-of-app half of the alert system. Reads
 * open lots (exit targets) and the watchlist (entry triggers), prices them
 * via the deployed quotes proxy, and prints one line per fired alert:
 *
 *   ALERT|<stable-key>|<title>
 *
 * The workflow turns each line into a GitHub issue (deduped by key in the
 * title) — GitHub's own notification email does the delivery, so there are
 * no mail credentials anywhere. Exit code stays 0 on no alerts.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/alert-check.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const quotesBase = process.env.QUOTES_BASE ?? 'https://challenge-tracker.pages.dev';
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, key, { db: { schema: 'challenge' } });

const [lotsRes, watchRes, overridesRes] = await Promise.all([
  supabase.from('position_lots').select('ticker, exit_target'),
  supabase.from('watchlist').select('ticker, entry_trigger').not('entry_trigger', 'is', null),
  supabase.from('price_overrides').select('ticker, price'),
]);
for (const r of [lotsRes, watchRes, overridesRes]) {
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
}
const lots = lotsRes.data ?? [];
const watch = watchRes.data ?? [];
const overrides = Object.fromEntries((overridesRes.data ?? []).map((r) => [r.ticker, Number(r.price)]));

const tickers = [...new Set([...lots.map((l) => l.ticker), ...watch.map((w) => w.ticker)])];
if (tickers.length === 0) {
  console.log('Nothing to watch.');
  process.exit(0);
}

let quotes = {};
try {
  const res = await fetch(`${quotesBase}/api/quotes?tickers=${tickers.join(',')}`);
  if (res.ok) {
    const body = await res.json();
    quotes = Object.fromEntries(
      Object.entries(body.quotes ?? {}).map(([t, q]) => [t, q.price]),
    );
  } else {
    console.error(`Quote fetch failed (${res.status}) — no alert check this run.`);
    process.exit(0); // quotes down is not an alert-worthy failure every 30min
  }
} catch (e) {
  console.error('Quote fetch failed — no alert check this run.', e);
  process.exit(0);
}

const priceOf = (t) => overrides[t] ?? quotes[t];
const usd = (n) => `$${Number(n).toFixed(2)}`;
let fired = 0;

// Exit targets: lowest crossed target per ticker (the first tripwire).
const lowestTarget = new Map();
for (const l of lots) {
  const target = Number(l.exit_target);
  const cur = lowestTarget.get(l.ticker);
  if (cur === undefined || target < cur) lowestTarget.set(l.ticker, target);
}
for (const [ticker, target] of lowestTarget) {
  const price = priceOf(ticker);
  if (price !== undefined && price >= target) {
    console.log(`ALERT|target-${ticker}|🎯 ${ticker} crossed its ${usd(target)} exit target (now ${usd(price)}) — sell into strength (Rule 8)`);
    fired++;
  }
}

// Entry triggers: at/below the bench price.
for (const w of watch) {
  const trigger = Number(w.entry_trigger);
  const price = priceOf(w.ticker);
  if (price !== undefined && trigger > 0 && price <= trigger) {
    console.log(`ALERT|entry-${w.ticker}|📥 ${w.ticker} hit your ${usd(trigger)} entry trigger (now ${usd(price)}) — the bench setup is live`);
    fired++;
  }
}

console.log(fired > 0 ? `${fired} alert(s) fired.` : 'No alerts.');

/**
 * Server-side daily snapshot — run by the scheduled GitHub Actions workflow
 * so history stays unbroken whether or not the app gets opened.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/daily-snapshot.ts
 *
 * Imports the real engine so the math has exactly one source of truth. Safe
 * to race with the app's own on-load write: the date PK + ignoreDuplicates
 * makes whoever's first win.
 */
import { createClient } from '@supabase/supabase-js';
import {
  accountTotal, BTC_CATEGORY, concentration, cumulativeFloor, isArchivedPosition, netContributed,
  pileTotal, reservedTotal, roundCents, shadowValue, totalScore,
} from '../src/lib/engine';
import type {
  BenchmarkDeposit, CashEvent, MilestoneRecord, ParkedPosition, PositionLot,
} from '../src/lib/engine';
import { priceMapFor } from '../src/lib/alerts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const quotesBase = process.env.QUOTES_BASE ?? 'https://challenge-tracker.pages.dev';
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, key, { db: { schema: 'challenge' } });
// Snapshot dates are the OWNER's calendar (America/New_York) — the runner is
// UTC, so a late-evening manual dispatch would otherwise stamp tomorrow and
// block the real snapshot. SNAPSHOT_DATE=YYYY-MM-DD backfills a missed day.
const today =
  process.env.SNAPSHOT_DATE ??
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const num = (v: any) => Number(v);

// PostgREST caps responses at max-rows (default 1000) SERVER-side — page
// until a short page, or a grown table silently truncates the math.
const PAGE = 1000;
async function load(table: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table).select('*').range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

async function main(): Promise<void> {
  const existing = await supabase.from('snapshots').select('date').eq('date', today);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data ?? []).length > 0) {
    console.log(`Snapshot for ${today} already exists — nothing to do.`);
    return;
  }

  const [cashRows, lotRows, milestoneRows, benchRows, allParkedRows, overrideRows, accountRows] =
    await Promise.all([
      load('cash_events'),
      load('position_lots'),
      load('milestones'),
      load('benchmark_deposits'),
      load('parked_positions'),
      load('price_overrides'),
      load('accounts'),
    ]);
  // The walls: retirement positions never enter parked_pile_value or the
  // concentration figure, and the bitcoin bucket is its own fourth pot
  // (owner decision 2026-08-19) — out of the pile, into btc_value. The BTC
  // pot spans the tax walls (owner decision 2026-08-20): a Swan IRA's BTC
  // counts in btc_value, not retirement_value. MUST mirror
  // engine/parkedWalls.splitParkedPots.
  const retirementIds = new Set(
    accountRows.filter((a) => a.kind === 'retirement').map((a) => a.id),
  );
  const taxableRows = allParkedRows.filter((r) => !retirementIds.has(r.account_id));
  const parkedRows = taxableRows.filter((r) => r.category !== BTC_CATEGORY);
  const btcRows = allParkedRows.filter((r) => r.category === BTC_CATEGORY);

  const cashEvents: CashEvent[] = cashRows.map((r) => ({
    id: r.id, date: r.date, type: r.type, amount: num(r.amount),
  }));
  const lots: PositionLot[] = lotRows.map((r) => ({
    id: r.id, ticker: r.ticker, buyDate: r.buy_date, shares: num(r.shares),
    avgCost: num(r.avg_cost), exitTarget: num(r.exit_target),
  }));
  const milestones: MilestoneRecord[] = milestoneRows.map((r) => ({
    level: num(r.level), accountValueAtHit: num(r.account_value_at_hit),
    dateHit: r.date_hit, amountBanked: num(r.amount_banked),
  }));
  const benchmarkDeposits: BenchmarkDeposit[] = benchRows.map((r) => ({
    id: r.id, date: r.date, amount: num(r.amount), vooPriceThatDay: num(r.voo_price_that_day),
  }));
  const overrides: Record<string, number> = Object.fromEntries(
    overrideRows.map((r) => [r.ticker, num(r.price)]),
  );

  // Same rule as the app: the flag wins; legacy null rows fall back to the
  // wall (pile quotes, retirement doesn't). Hand-priced plan codes and
  // annuity units (W146, TRAD) never reach the market API.
  const quotable = (r: Record<string, any>) =>
    r.live_quotes ?? !retirementIds.has(r.account_id);

  const tickers = [
    ...new Set([
      ...lots.map((l) => l.ticker),
      // Archived (zero-share) positions keep history, not quotes.
      ...allParkedRows
        .filter((r) => !isArchivedPosition({ shares: num(r.shares) }) && quotable(r))
        .map((r) => r.ticker),
      'VOO',
    ]),
  ];
  let quotes: Record<string, number> = {};
  try {
    const res = await fetch(`${quotesBase}/api/quotes?tickers=${tickers.join(',')}`);
    if (res.ok) {
      const body = (await res.json()) as { quotes?: Record<string, { price: number }> };
      quotes = Object.fromEntries(
        Object.entries(body.quotes ?? {}).map(([t, q]) => [t, q.price]),
      );
    }
  } catch (e) {
    console.warn('Quote fetch failed; falling back to overrides/stored prices.', e);
  }

  const voo = overrides['VOO'] ?? quotes['VOO'];
  if (!voo) {
    // Fail LOUDLY: a green run that silently skipped means a hole in the
    // history nobody notices until the rolling verdict is wrong. A zero
    // shadow would poison the verdict, so we can't write either — make the
    // workflow red and say exactly what to do.
    throw new Error(
      `No VOO price available (quote fetch failed and no VOO override is pinned) — no snapshot written for ${today}. Pin a VOO price on the Benchmark screen, then re-run with SNAPSHOT_DATE=${today} to backfill this day. (A red run on a US market holiday can be ignored.)`,
    );
  }

  // Hand-priced rows keep their stored price — quotes and pins are keyed by
  // ticker, which an annuity-unit row can share with a real listing.
  const toPosition = (r: Record<string, any>): ParkedPosition => ({
    id: r.id, ticker: r.ticker, accountId: r.account_id, account: '', category: r.category,
    shares: num(r.shares), avgCost: num(r.avg_cost),
    currentPrice: quotable(r)
      ? overrides[r.ticker] ?? quotes[r.ticker] ?? num(r.current_price)
      : num(r.current_price),
  });
  const parked: ParkedPosition[] = parkedRows.map(toPosition);
  const btcParked: ParkedPosition[] = btcRows.map(toPosition);
  const retirementParked: ParkedPosition[] = allParkedRows
    .filter((r) => retirementIds.has(r.account_id) && r.category !== BTC_CATEGORY)
    .map(toPosition);

  const priceMap = priceMapFor(lots, overrides, quotes);
  const account = accountTotal(lots, priceMap, cashEvents);
  const payload = {
    date: today,
    account_value: roundCents(account),
    banked_total: roundCents(cumulativeFloor(milestones)),
    reserved_total: roundCents(reservedTotal(cashEvents)),
    total_score: roundCents(totalScore(lots, priceMap, cashEvents, milestones)),
    shadow_voo_value: roundCents(shadowValue(benchmarkDeposits, voo)),
    net_contributed: roundCents(netContributed(cashEvents)),
    parked_pile_value: roundCents(pileTotal(parked)),
    semi_ai_pct: Number(concentration(parked).semiPct.toFixed(6)),
    retirement_value: roundCents(pileTotal(retirementParked)),
    btc_value: roundCents(pileTotal(btcParked)),
  };

  const { error } = await supabase
    .from('snapshots')
    .upsert(payload, { onConflict: 'date', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  console.log(`Snapshot written for ${today}:`, payload);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

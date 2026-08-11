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
  accountTotal, concentration, cumulativeFloor, isArchivedPosition, netContributed, pileTotal,
  reservedTotal, roundCents, shadowValue, totalScore,
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
const today = new Date().toISOString().slice(0, 10);

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: any) => Number(v);

async function load(table: string) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as any[];
}

async function main(): Promise<void> {
  const existing = await supabase.from('snapshots').select('date').eq('date', today);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data ?? []).length > 0) {
    console.log(`Snapshot for ${today} already exists — nothing to do.`);
    return;
  }

  const [cashRows, lotRows, milestoneRows, benchRows, parkedRows, overrideRows] =
    await Promise.all([
      load('cash_events'),
      load('position_lots'),
      load('milestones'),
      load('benchmark_deposits'),
      load('parked_positions'),
      load('price_overrides'),
    ]);

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

  const tickers = [
    ...new Set([
      ...lots.map((l) => l.ticker),
      // Archived (zero-share) positions keep history, not quotes.
      ...parkedRows
        .filter((r) => !isArchivedPosition({ shares: num(r.shares) }))
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
    console.log('No VOO price available — skipping (a zero shadow would poison the verdict).');
    return;
  }

  const parked: ParkedPosition[] = parkedRows.map((r) => ({
    id: r.id, ticker: r.ticker, accountId: r.account_id, account: '', category: r.category,
    shares: num(r.shares), avgCost: num(r.avg_cost),
    currentPrice: overrides[r.ticker] ?? quotes[r.ticker] ?? num(r.current_price),
  }));

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

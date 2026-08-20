/** Server-side balance math for the Google Sheet endpoints
 * (functions/api/sheet/*). Lives in src/lib so tsc typechecks it and so the
 * engine math is IMPORTED, never re-implemented — the sheet must show the
 * app's numbers. Pure of app/browser concerns: caller supplies the service
 * key and the quotes base URL. Read-only by construction.
 *
 * An account's balance = holdings at app pricing (override > live quote
 * where the row's liveQuotes flag allows > stored price) + tracked strategy
 * cash. That's every pot's slice in the account — per-account balances are
 * account facts, the pots are strategy lenses. Bank accounts are excluded
 * (no holdings; the sheet tracks brokerages). */
import { computeAccountCash } from './engine/parkedCash';
import type { ParkedCashEvent } from './engine/parkedCash';
import type { ParkedLot } from './engine/parkedLots';
import { isArchivedPosition } from './engine/parked';
import { roundCents } from './engine/money';
import type { CashEvent, ParkedPosition, ParkedSale } from './engine/types';

const SUPABASE_URL = 'https://mlvntnbgboinjhmavwao.supabase.co';

export interface AccountBalance {
  id: string;
  name: string;
  kind: string;
  holdings: number;
  trackedCash: number;
  total: number;
}

export async function computeSheetBalances(args: {
  serviceKey: string;
  /** Origin serving /api/quotes (the deployed app itself). */
  quotesBase: string;
}): Promise<AccountBalance[]> {
  const { serviceKey, quotesBase } = args;

  // Paged reads — PostgREST truncates at 1000 server-side.
  const read = async (table: string, select: string): Promise<Record<string, any>[]> => {
    const rows: Record<string, any>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=1000&offset=${offset}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Accept-Profile': 'challenge',
          },
        },
      );
      if (!res.ok) throw new Error(`${table}: ${res.status}`);
      const page = (await res.json()) as Record<string, any>[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };

  const [accounts, positions, lots, sales, cashEvents, parkedCash, overrides] = await Promise.all([
    read('accounts', 'id,name,kind'),
    read('parked_positions', 'id,ticker,account_id,category,shares,current_price,live_quotes'),
    read('parked_lots', 'id,parked_position_id,source,shares,price,amount,origin,notes'),
    read('parked_sales', 'id,account_id,ticker,date,shares,price_per_share,proceeds,funded_challenge,consumed_basis'),
    read('cash_events', 'id,date,type,amount,account_id,destination_account_id'),
    read('parked_cash_events', 'id,account_id,date,type,amount'),
    read('price_overrides', 'ticker,price'),
  ]);

  const retirementIds = new Set(accounts.filter((a) => a.kind === 'retirement').map((a) => a.id));
  const overrideByTicker = new Map(overrides.map((o) => [o.ticker, Number(o.price)]));
  const quotable = (r: Record<string, any>) => r.live_quotes ?? !retirementIds.has(r.account_id);
  const live = positions.filter(
    (r) => !isArchivedPosition({ shares: Number(r.shares) } as ParkedPosition),
  );

  // Live prices via the app's own proxy — best-effort, stored prices cover us.
  const tickers = [...new Set(live.filter(quotable).map((r) => r.ticker as string))];
  let quotes = new Map<string, number>();
  if (tickers.length > 0) {
    try {
      const res = await fetch(`${quotesBase}/api/quotes?tickers=${tickers.join(',')}`);
      if (res.ok) {
        const body = (await res.json()) as { quotes?: Record<string, { price: number }> };
        quotes = new Map(Object.entries(body.quotes ?? {}).map(([t, q]) => [t, q.price]));
      }
    } catch { /* stored prices cover us */ }
  }
  const priceOf = (r: Record<string, any>) =>
    quotable(r)
      ? overrideByTicker.get(r.ticker) ?? quotes.get(r.ticker) ?? Number(r.current_price)
      : Number(r.current_price);

  const holdingsByAccount = new Map<string, number>();
  for (const r of live) {
    holdingsByAccount.set(
      r.account_id,
      (holdingsByAccount.get(r.account_id) ?? 0) + Number(r.shares) * priceOf(r),
    );
  }

  // Tracked cash: the ENGINE's computeAccountCash on minimally-mapped rows.
  const cashArgs = {
    parkedCashEvents: parkedCash.map((r) => ({
      id: r.id, accountId: r.account_id, date: r.date, type: r.type, amount: Number(r.amount),
    })) as ParkedCashEvent[],
    parkedSales: sales.map((r) => ({
      id: r.id, accountId: r.account_id, ticker: r.ticker, date: r.date,
      shares: Number(r.shares), pricePerShare: Number(r.price_per_share),
      proceeds: Number(r.proceeds), fundedChallenge: r.funded_challenge,
      consumedBasis: r.consumed_basis == null ? null : Number(r.consumed_basis),
    })) as ParkedSale[],
    parkedLots: lots.map((r) => ({
      id: r.id, parkedPositionId: r.parked_position_id, date: null, source: r.source,
      shares: Number(r.shares), price: r.price === null ? null : Number(r.price),
      amount: Number(r.amount), origin: r.origin ?? null, notes: r.notes,
    })) as ParkedLot[],
    parked: positions.map((r) => ({ id: r.id, accountId: r.account_id })) as ParkedPosition[],
    cashEvents: cashEvents.map((r) => ({
      id: r.id, date: r.date, type: r.type, amount: Number(r.amount),
      accountId: r.account_id, destinationAccountId: r.destination_account_id,
    })) as CashEvent[],
  };

  return accounts
    .filter((a) => a.kind !== 'bank' && a.kind !== 'challenge')
    .map((a) => {
      const holdings = roundCents(holdingsByAccount.get(a.id) ?? 0);
      const trackedCash = roundCents(computeAccountCash(a.id, cashArgs).balance);
      return {
        id: a.id as string,
        name: a.name as string,
        kind: a.kind as string,
        holdings,
        trackedCash,
        total: roundCents(holdings + trackedCash),
      };
    })
    .sort((a, b) => b.total - a.total);
}

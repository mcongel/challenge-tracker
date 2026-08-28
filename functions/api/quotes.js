/**
 * GET /api/quotes?tickers=NBIS,MU,VOO
 *
 * Server-side quote proxy. Two sources, in order:
 *
 *   1. Yahoo Finance chart endpoint (no key). Gives the LIVE price plus the
 *      previous close, so today's change is computed from today's price.
 *   2. Finnhub (FINNHUB_API_KEY) as fallback.
 *
 * Why Yahoo first: Finnhub's free tier serves the previous session's close —
 * its `c` and `d` fields lag a full day, which made the day-change column show
 * yesterday's move — and it has no data for ETFs (SOXX, VDE, VOO) or some
 * newer listings. Finnhub stays as a safety net in case Yahoo blocks us.
 *
 * Response: { quotes: { TICKER: { price, change, changePct, at, src } },
 *             missing: [TICKER], asOf }
 */
const CACHE_TTL_SECONDS = 900; // 15 min — Yahoo costs no quota, so stay fresher
const MAX_TICKERS = 40;

/** App tickers → Yahoo symbols. The app says BTC; Yahoo says BTC-USD. Keyed
 * here (server-side) so every consumer — app, alerts function — gets the
 * alias for free. */
const YAHOO_ALIASES = { BTC: 'BTC-USD', ETH: 'ETH-USD' };
const RETRY_DELAY_MS = 1300;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get('tickers') ?? '';
  const tickers = [...new Set(
    raw.split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.-]{1,10}$/.test(t)),
  )].slice(0, MAX_TICKERS);

  if (tickers.length === 0) {
    return json({ error: 'tickers query param required' }, 400);
  }

  const cache = caches.default;
  const quotes = {};
  const missing = [];

  // Cache pass — free, and shows how many live calls remain.
  const uncached = [];
  for (const ticker of tickers) {
    const hit = await cache.match(cacheKey(ticker));
    if (hit) {
      try {
        quotes[ticker] = await hit.json();
        continue;
      } catch {
        /* fall through to a live fetch */
      }
    }
    uncached.push(ticker);
  }

  for (const ticker of uncached) {
    const quote = (await fromYahoo(ticker)) ?? (await fromFinnhub(ticker, env));
    if (!quote) {
      missing.push(ticker);
      continue;
    }
    quotes[ticker] = quote;
    // A quote missing its day-change (no previous close — the feed omits it
    // briefly around the open/pre-market) is incomplete: cache it for only a
    // minute so it refills fast, instead of pinning a "—" for the full TTL.
    const ttl = quote.change !== null ? CACHE_TTL_SECONDS : 60;
    context.waitUntil(
      cache.put(
        cacheKey(ticker),
        new Response(JSON.stringify(quote), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `s-maxage=${ttl}`,
          },
        }),
      ),
    );
  }

  return json({ quotes, missing, asOf: Date.now() });
}

async function fromYahoo(ticker) {
  try {
    const symbol = YAHOO_ALIASES[ticker] ?? ticker;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const meta = body?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number' || price <= 0) return null;
    // Dead listings: Yahoo serves years-old "quotes" for delisted share
    // classes (PRDIX: $9.84, last traded 2019). A quote older than 10 days
    // is worse than none — treat the symbol as unquoted so the app's
    // manual-price machinery owns it instead.
    if (meta.regularMarketTime && Date.now() - meta.regularMarketTime * 1000 > 10 * 86400_000) {
      return null;
    }
    const prev = typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null;
    const change = prev !== null ? price - prev : null;
    return {
      price,
      change,
      changePct: change !== null && prev ? (change / prev) * 100 : null,
      at: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
      src: 'yahoo',
    };
  } catch {
    return null;
  }
}

async function fromFinnhub(ticker, env) {
  if (!env.FINNHUB_API_KEY) return null;
  const call = () =>
    fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`);
  try {
    let res = await call();
    if (res.status === 429) {
      await sleep(RETRY_DELAY_MS);
      res = await call();
    }
    if (!res.ok) return null;
    const body = await res.json();
    // Finnhub returns c: 0 for symbols it doesn't cover.
    if (typeof body?.c !== 'number' || body.c <= 0) return null;
    return {
      price: body.c,
      change: typeof body.d === 'number' ? body.d : null,
      changePct: typeof body.dp === 'number' ? body.dp : null,
      at: body.t ? body.t * 1000 : Date.now(),
      src: 'finnhub',
    };
  } catch {
    return null;
  }
}

// v2: the shape changed (normalized quote objects, not raw upstream bodies),
// and v1 entries hold Finnhub's stale previous-close data.
const cacheKey = (ticker) => new Request(`https://quotes-cache.internal/v2/${ticker}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

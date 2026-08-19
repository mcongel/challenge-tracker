/**
 * GET /api/history?tickers=NVDA,QCOM&from=2020-01-21
 *
 * Daily/weekly closing-price history from Yahoo's chart endpoint (no key),
 * for reconstructing what a set of holdings was worth on past days. Closes
 * are split-adjusted (Yahoo v8 `close`), matching lot share counts stored in
 * current post-split terms.
 *
 * Interval picks itself from the span: over ~3 years → weekly bars keep the
 * payload sane; under → daily. History barely changes, so entries cache for
 * a day per (ticker, from, interval).
 *
 * Response: { series: { TICKER: [[isoDate, close], …] }, interval, missing: [TICKER] }
 */
const CACHE_TTL_SECONDS = 86_400;
const MAX_TICKERS = 40;
const WEEKLY_SPAN_MS = 3 * 365 * 86_400_000;

// Same alias table as quotes.js — the app says BTC, Yahoo says BTC-USD.
const YAHOO_ALIASES = { BTC: 'BTC-USD', ETH: 'ETH-USD' };
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get('tickers') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const tickers = [...new Set(
    raw.split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.\-]{1,10}$/.test(t)),
  )].slice(0, MAX_TICKERS);

  if (tickers.length === 0) return json({ error: 'tickers query param required' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ error: 'from=YYYY-MM-DD required' }, 400);

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const interval = Date.now() - fromMs > WEEKLY_SPAN_MS ? '1wk' : '1d';

  const cache = caches.default;
  const series = {};
  const missing = [];

  for (const ticker of tickers) {
    const key = cacheKey(ticker, from, interval);
    const hit = await cache.match(key);
    if (hit) {
      try {
        series[ticker] = await hit.json();
        continue;
      } catch { /* fall through to a live fetch */ }
    }
    const closes = await fromYahoo(ticker, fromMs, interval);
    if (!closes || closes.length === 0) {
      missing.push(ticker);
      continue;
    }
    series[ticker] = closes;
    context.waitUntil(
      cache.put(key, new Response(JSON.stringify(closes), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
        },
      })),
    );
  }

  return json({ series, interval, missing });
}

async function fromYahoo(ticker, fromMs, interval) {
  try {
    const symbol = YAHOO_ALIASES[ticker] ?? ticker;
    const period1 = Math.floor(fromMs / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?interval=${interval}&period1=${period1}&period2=${period2}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const result = body?.chart?.result?.[0];
    const stamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(stamps) || !Array.isArray(closes)) return null;
    const out = [];
    for (let i = 0; i < stamps.length; i++) {
      const c = closes[i];
      if (typeof c !== 'number' || c <= 0) continue; // market holidays report null
      out.push([new Date(stamps[i] * 1000).toISOString().slice(0, 10), Math.round(c * 10000) / 10000]);
    }
    return out;
  } catch {
    return null;
  }
}

const cacheKey = (ticker, from, interval) =>
  new Request(`https://history-cache.internal/v1/${ticker}/${from}/${interval}`);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

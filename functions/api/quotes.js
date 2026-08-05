/**
 * GET /api/quotes?tickers=NBIS,MU,VOO
 *
 * Server-side proxy to Finnhub (free tier, 60 calls/min) so the API key never
 * reaches the browser. Per-ticker responses are cached ~30 minutes via the
 * Cache API — this is a scoreboard, not a trading terminal.
 *
 * Env var: FINNHUB_API_KEY (Cloudflare Pages → Settings → Environment variables).
 * Response: { quotes: { TICKER: { price, at } }, missing: [TICKER], asOf }
 */
const CACHE_TTL_SECONDS = 1800;
const MAX_TICKERS = 40;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get('tickers') ?? '';
  const tickers = [...new Set(
    raw.split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.\-]{1,10}$/.test(t)),
  )].slice(0, MAX_TICKERS);

  if (tickers.length === 0) {
    return json({ error: 'tickers query param required' }, 400);
  }
  if (!env.FINNHUB_API_KEY) {
    return json({ error: 'FINNHUB_API_KEY not configured' }, 503);
  }

  const cache = caches.default;
  const quotes = {};
  const missing = [];

  await Promise.all(tickers.map(async (ticker) => {
    const cacheKey = new Request(`https://quotes-cache.internal/${ticker}`);
    let cached = await cache.match(cacheKey);
    if (!cached) {
      const upstream = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`,
      );
      if (!upstream.ok) {
        missing.push(ticker);
        return;
      }
      cached = new Response(await upstream.text(), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
        },
      });
      context.waitUntil(cache.put(cacheKey, cached.clone()));
    }
    try {
      const body = await cached.json();
      // Finnhub returns c: 0 for unknown symbols.
      if (body && typeof body.c === 'number' && body.c > 0) {
        quotes[ticker] = { price: body.c, at: body.t ? body.t * 1000 : Date.now() };
      } else {
        missing.push(ticker);
      }
    } catch {
      missing.push(ticker);
    }
  }));

  return json({ quotes, missing, asOf: Date.now() });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/quotes?tickers=NBIS,MU,VOO
 *
 * Server-side proxy to Finnhub (free tier) so the API key never reaches the
 * browser. Per-ticker responses are cached ~30 minutes via the Cache API.
 *
 * Finnhub's free tier rate-limits bursts (60/min), so uncached tickers are
 * fetched SEQUENTIALLY, with one retry after a pause on 429. Cache hits cost
 * no quota, so steady-state requests stay fast.
 *
 * Env var: FINNHUB_API_KEY (Cloudflare Pages → Settings → Environment variables).
 * Response: { quotes: { TICKER: { price, at } }, missing: [TICKER], asOf }
 */
const CACHE_TTL_SECONDS = 1800;
const MAX_TICKERS = 40;
const RETRY_DELAY_MS = 1300;

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

  const readBody = async (response, ticker) => {
    try {
      const body = await response.json();
      // Finnhub returns c: 0 for unknown/unsupported symbols.
      if (body && typeof body.c === 'number' && body.c > 0) {
        quotes[ticker] = { price: body.c, at: body.t ? body.t * 1000 : Date.now() };
        return true;
      }
    } catch {
      /* fall through to missing */
    }
    return false;
  };

  const fetchUpstream = (ticker) =>
    fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`);

  // Cache pass first — free, and tells us how many live calls remain.
  const uncached = [];
  for (const ticker of tickers) {
    const hit = await cache.match(cacheKey(ticker));
    if (hit) {
      if (!(await readBody(hit, ticker))) missing.push(ticker);
    } else {
      uncached.push(ticker);
    }
  }

  // Live pass: sequential, one retry on rate-limit.
  for (const ticker of uncached) {
    let upstream = await fetchUpstream(ticker);
    if (upstream.status === 429) {
      await sleep(RETRY_DELAY_MS);
      upstream = await fetchUpstream(ticker);
    }
    if (!upstream.ok) {
      missing.push(ticker);
      continue;
    }
    const text = await upstream.text();
    const cached = new Response(text, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
      },
    });
    const ok = await readBody(new Response(text), ticker);
    if (ok) {
      // Only cache real quotes — a cached c:0 would pin "missing" for 30 min.
      context.waitUntil(cache.put(cacheKey(ticker), cached));
    } else {
      missing.push(ticker);
    }
  }

  return json({ quotes, missing, asOf: Date.now() });
}

const cacheKey = (ticker) => new Request(`https://quotes-cache.internal/${ticker}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/names?tickers=MU,AMAT
 *
 * Company names AND industries via Finnhub's profile endpoint, proxied
 * server-side — one upstream call serves both, which halved the Finnhub
 * spend vs the old per-ticker /api/profile fan-out. Profiles barely change,
 * so each ticker caches for 7 days. Sequential with a retry on 429, same as
 * quotes. (The cache stores the raw profile2 body, so entries written before
 * industries existed already carry finnhubIndustry — no cache version bump.)
 *
 * Response: { names: { TICKER: "Micron Technology Inc" },
 *             industries: { TICKER: "Semiconductors" }, missing: [TICKER] }
 */
const CACHE_TTL_SECONDS = 7 * 24 * 3600;
const MAX_TICKERS = 40;
const RETRY_DELAY_MS = 1300;

// ETFs have no profile on Finnhub's free tier — name the held ones here.
const STATIC_NAMES = {
  SOXX: 'iShares Semiconductor ETF',
  VDE: 'Vanguard Energy Index Fund ETF',
  VOO: 'Vanguard S&P 500 ETF',
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get('tickers') ?? '';
  const tickers = [...new Set(
    raw.split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.-]{1,10}$/.test(t)),
  )].slice(0, MAX_TICKERS);

  if (tickers.length === 0) return json({ error: 'tickers query param required' }, 400);
  if (!env.FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY not configured' }, 503);

  const cache = caches.default;
  const names = {};
  const industries = {};
  const missing = [];

  const readBody = async (response, ticker) => {
    try {
      const body = await response.json();
      if (body && typeof body.finnhubIndustry === 'string' && body.finnhubIndustry.length > 0) {
        industries[ticker] = body.finnhubIndustry;
      }
      if (body && typeof body.name === 'string' && body.name.length > 0) {
        names[ticker] = body.name;
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  };

  const fetchUpstream = (ticker) =>
    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`);

  const uncached = [];
  for (const ticker of tickers) {
    if (STATIC_NAMES[ticker]) {
      names[ticker] = STATIC_NAMES[ticker];
      continue;
    }
    const hit = await cache.match(cacheKey(ticker));
    if (hit) {
      if (!(await readBody(hit, ticker))) missing.push(ticker);
    } else {
      uncached.push(ticker);
    }
  }

  for (const ticker of uncached) {
    if (!env.FINNHUB_API_KEY) {
      missing.push(ticker);
      continue;
    }
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
    const ok = await readBody(new Response(text), ticker);
    if (ok) {
      context.waitUntil(cache.put(cacheKey(ticker), new Response(text, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
        },
      })));
    } else {
      // ETFs and some listings have no profile on the free tier — that's fine.
      missing.push(ticker);
    }
  }

  return json({ names, industries, missing });
}

const cacheKey = (ticker) => new Request(`https://names-cache.internal/${ticker}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/profile?ticker=NVDA
 *
 * Company classification for the category-suggestion flow: Finnhub's
 * profile2 (free tier, key already server-side) returns an industry string
 * like "Semiconductors". ETFs and some listings have no profile — the
 * response carries industry: null and the UI falls back to manual choice.
 * Profiles barely change; cached for a week.
 *
 * Response: { ticker, name, industry } (name/industry may be null)
 */
const CACHE_TTL_SECONDS = 604800;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return json({ error: 'ticker required' }, 400);
  }
  // A missing key is a config failure, not "this ticker has no profile" —
  // a 200 here made a Cloudflare env mishap look like every ticker is an ETF.
  if (!env.FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY not configured' }, 503);

  const cache = caches.default;
  const key = new Request(`https://quotes-cache.internal/profile/v1/${ticker}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`,
    );
    if (!res.ok) return json({ error: `finnhub ${res.status}` }, 502);
    const body = await res.json();
    const payload = JSON.stringify({
      ticker,
      name: typeof body?.name === 'string' && body.name ? body.name : null,
      industry:
        typeof body?.finnhubIndustry === 'string' && body.finnhubIndustry
          ? body.finnhubIndustry
          : null,
    });
    const response = new Response(payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
      },
    });
    context.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch {
    return json({ error: 'finnhub unreachable' }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

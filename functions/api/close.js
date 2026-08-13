/**
 * GET /api/close?ticker=VOO&date=2026-08-04
 *
 * Historical daily close for the given date — or the nearest PRIOR trading
 * day when the date falls on a weekend/holiday (the response says which day
 * it actually used). Yahoo chart endpoint, no key needed. A finished day's
 * close is immutable, so responses cache for a week.
 *
 * Exists so backdated Deposits/funded trims can auto-fill the shadow-VOO
 * price instead of sending the owner to look it up by hand.
 *
 * Response: { ticker, requested, date, close }
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const CACHE_TTL_SECONDS = 604800; // 7 days — history doesn't change
const LOOKBACK_DAYS = 10; // buffer across weekends + holiday clusters

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') ?? 'VOO').trim().toUpperCase();
  const date = url.searchParams.get('date') ?? '';
  if (!/^[A-Z.\-]{1,10}$/.test(ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'ticker and date=YYYY-MM-DD required' }, 400);
  }

  const cache = caches.default;
  const key = new Request(`https://quotes-cache.internal/close/v1/${ticker}/${date}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  // period2 is exclusive-ish upstream; include the requested day fully.
  const end = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + 86400;
  const start = end - 86400 * LOOKBACK_DAYS;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!res.ok) return json({ error: 'quote source unavailable' }, 502);
    const body = await res.json();
    const result = body?.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    // Latest trading day on or before the requested date. Daily bars stamp
    // at the session open (ET) — the UTC calendar date matches the session's.
    let best = null;
    for (let i = 0; i < ts.length; i++) {
      const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      if (d <= date && typeof closes[i] === 'number' && closes[i] > 0) {
        best = { date: d, close: Math.round(closes[i] * 10000) / 10000 };
      }
    }
    if (!best) return json({ error: `no close on or before ${date}` }, 404);
    const payload = JSON.stringify({ ticker, requested: date, ...best });
    const response = new Response(payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}`,
      },
    });
    context.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch {
    return json({ error: 'fetch failed' }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

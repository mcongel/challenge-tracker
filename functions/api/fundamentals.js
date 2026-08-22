/**
 * GET /api/fundamentals?tickers=MSTR,GLW
 *
 * Dividend history + payout ratio per ticker, proxied from Financial Modeling
 * Prep (server-side key). Feeds the Income page's growth and payout-coverage
 * signals (item 3). Cached 24h at the edge — dividend schedules and TTM
 * ratios move slowly, and FMP's free tier is 250 requests/day, so caching
 * keeps a ~30-holding portfolio well under the cap.
 *
 * Response: { data: { TICKER: { annual: [{year, amount}], payoutRatio, freq } },
 *             missing: [TICKER] }
 * A missing FMP_API_KEY yields 503 (config error, not "no dividends") so the
 * client can tell "not wired up" from "this stock pays nothing".
 *
 * FREE-TIER / LICENSING NOTE: FMP's free plan is personal-use only. Fine for
 * the owner's own tracker; a commercial deployment needs a paid FMP plan.
 */
const CACHE_TTL_SECONDS = 24 * 3600;
const MAX_TICKERS = 40;
const FMP = 'https://financialmodelingprep.com/stable';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const tickers = [...new Set(
    (url.searchParams.get('tickers') ?? '')
      .split(',').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.-]{1,10}$/.test(t)),
  )].slice(0, MAX_TICKERS);
  if (tickers.length === 0) return json({ error: 'tickers query param required' }, 400);
  if (!env.FMP_API_KEY) return json({ error: 'FMP_API_KEY not configured' }, 503);

  const cache = caches.default;
  const data = {};
  const missing = [];

  for (const ticker of tickers) {
    const key = new Request(`https://fundamentals-cache.internal/v1/${ticker}`);
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.json();
      if (body && body.ok) data[ticker] = body.value;
      else missing.push(ticker);
      continue;
    }
    try {
      const [divs, ratios] = await Promise.all([
        fetch(`${FMP}/dividends?symbol=${ticker}&apikey=${env.FMP_API_KEY}`),
        fetch(`${FMP}/ratios-ttm?symbol=${ticker}&apikey=${env.FMP_API_KEY}`),
      ]);
      if (!divs.ok) { missing.push(ticker); continue; }
      const rows = await divs.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        // Real answer: this security pays no dividend. Cache the negative so
        // we don't re-ask every day.
        context.waitUntil(cache.put(key, negativeResponse()));
        missing.push(ticker);
        continue;
      }
      // Sum declared dividends per calendar year — robust to whatever cadence.
      const byYear = {};
      for (const r of rows) {
        const d = r.date ?? r.paymentDate ?? r.recordDate;
        const amt = Number(r.dividend ?? r.adjDividend ?? 0);
        if (!d || !(amt > 0)) continue;
        const y = Number(String(d).slice(0, 4));
        byYear[y] = (byYear[y] ?? 0) + amt;
      }
      const annual = Object.entries(byYear)
        .map(([year, amount]) => ({ year: Number(year), amount: Math.round(amount * 1e6) / 1e6 }))
        .sort((a, b) => a.year - b.year);

      let payoutRatio = null;
      if (ratios.ok) {
        const rr = await ratios.json();
        const row = Array.isArray(rr) ? rr[0] : rr;
        if (row) {
          // FMP has renamed this field across versions — accept any payout-ratio key.
          const k = Object.keys(row).find((x) => /payout.*ratio/i.test(x));
          const v = k ? Number(row[k]) : NaN;
          if (Number.isFinite(v)) payoutRatio = v;
        }
      }
      const value = { annual, payoutRatio, freq: rows[0]?.frequency ?? null };
      data[ticker] = value;
      context.waitUntil(cache.put(key, positiveResponse(value)));
    } catch {
      missing.push(ticker);
    }
  }

  return json({ data, missing });
}

const positiveResponse = (value) =>
  new Response(JSON.stringify({ ok: true, value }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}` },
  });
const negativeResponse = () =>
  new Response(JSON.stringify({ ok: false }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${CACHE_TTL_SECONDS}` },
  });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

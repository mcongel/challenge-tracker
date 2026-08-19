/**
 * Gate for every /api/* function. These proxy a quota-limited vendor with a
 * server-side key, so the endpoints must not be a free public quote API.
 *
 * Policy — configuration-free, and safe for every legitimate caller:
 *   - Browser requests: allowed only same-origin. A cross-site page gets 403
 *     (its Origin/Sec-Fetch-Site gives it away; same-origin app fetches pass
 *     automatically on any domain the app is served from, previews included).
 *   - Non-browser requests (no browser headers at all): allowed — the
 *     challenge-market-alerts edge function calls /api/quotes server-side
 *     and sends neither Origin nor Sec-Fetch-Site. Blanket abuse from
 *     scripts is the Cloudflare rate-limit rule's job (dashboard: a rule on
 *     /api/* — see supabase/SETUP.md).
 *   - localhost is allowed for `vite dev` against deployed functions.
 */
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite && secFetchSite === 'cross-site') {
    return forbidden();
  }

  const origin = request.headers.get('Origin');
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return forbidden();
    }
    const sameHost = originHost === url.hostname;
    const isLocal = originHost === 'localhost' || originHost === '127.0.0.1';
    if (!sameHost && !isLocal) return forbidden();
  }

  return next();
}

function forbidden() {
  return new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

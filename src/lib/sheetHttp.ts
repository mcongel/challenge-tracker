/** HTTP plumbing shared by the /api/sheet/* Pages Functions. Lives in src so
 * nothing under functions/ becomes an accidental route and tsc typechecks it. */

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function sheetJson(bodyObj: unknown, status = 200): Response {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** null = allowed; otherwise the refusal response. */
export function sheetGuard(
  env: { SHEET_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string },
  url: URL,
): Response | null {
  if (!env.SHEET_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return sheetJson({ error: 'SHEET_KEY / SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  }
  if (!safeEqual(url.searchParams.get('key') ?? '', env.SHEET_KEY)) {
    return sheetJson({ error: 'unauthorized' }, 401);
  }
  return null;
}

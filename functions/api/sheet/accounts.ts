/**
 * GET /api/sheet/accounts?key=SHEET_KEY
 *
 * The directory: every sheet-relevant account (brokerages and retirement —
 * banks and the challenge account excluded) with its balance components, as
 * CSV. Handy for discovering the exact names /api/sheet/account/<name>
 * expects, or for pulling all rows with one IMPORTDATA if you ever want a
 * spill range instead of per-cell formulas. No summary row.
 */
import { computeSheetBalances } from '../../../src/lib/sheetBalances';
import { sheetGuard, sheetJson } from '../../../src/lib/sheetHttp';

export async function onRequestGet(context: {
  request: Request;
  env: { SHEET_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
}) {
  const { request, env } = context;
  const url = new URL(request.url);
  const denied = sheetGuard(env, url);
  if (denied) return denied;

  try {
    const balances = await computeSheetBalances({
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      quotesBase: url.origin,
    });
    if (url.searchParams.get('format') === 'json') {
      return sheetJson({ accounts: balances, asOf: Date.now() });
    }
    const body = [
      'account,kind,holdings,tracked_cash,total',
      ...balances.map((b) =>
        `${b.name.replace(/[",\n]/g, ' ')},${b.kind},${b.holdings.toFixed(2)},${b.trackedCash.toFixed(2)},${b.total.toFixed(2)}`),
    ].join('\n');
    return new Response(body, {
      headers: { 'Content-Type': 'text/csv', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return sheetJson({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

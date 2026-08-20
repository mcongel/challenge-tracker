/**
 * GET /api/sheet/account/Cash%20App?key=SHEET_KEY
 *
 * ONE account's balance as a bare number — built for a single-cell
 * =IMPORTDATA() in the Google Sheet: put the formula in a cell, get that
 * account's balance (holdings at app pricing + tracked strategy cash),
 * nothing else. Name match is case-insensitive; ?field=holdings or
 * ?field=cash narrows to a component; ?format=json returns the breakdown.
 *
 * Auth: SHEET_KEY (Pages env) via ?key= — read-only balance numbers only.
 * /api/sheet/accounts lists the available names.
 */
import { computeSheetBalances } from '../../../../src/lib/sheetBalances';
import { sheetGuard, sheetJson } from '../../../../src/lib/sheetHttp';

export async function onRequestGet(context: {
  request: Request;
  env: { SHEET_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  params: { name: string };
}) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const denied = sheetGuard(env, url);
  if (denied) return denied;

  const wanted = decodeURIComponent(String(params.name ?? '')).trim().toLowerCase();
  try {
    const balances = await computeSheetBalances({
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      quotesBase: url.origin,
    });
    const hit = balances.find((b) => b.name.toLowerCase() === wanted);
    if (!hit) {
      return sheetJson(
        { error: `no account named "${params.name}"`, accounts: balances.map((b) => b.name) },
        404,
      );
    }
    if (url.searchParams.get('format') === 'json') {
      return sheetJson({ ...hit, asOf: Date.now() });
    }
    const field = url.searchParams.get('field');
    const value =
      field === 'holdings' ? hit.holdings : field === 'cash' ? hit.trackedCash : hit.total;
    return new Response(value.toFixed(2), {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return sheetJson({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

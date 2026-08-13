/** Historical close via the Pages Function. Null on any failure — local dev
 * without functions, network down, unknown ticker — callers fall back to the
 * manual look-it-up hint. `date` in the result is the trading day actually
 * used (nearest prior session when the requested date wasn't one). */
export async function fetchClose(
  ticker: string,
  date: string,
): Promise<{ close: number; date: string } | null> {
  try {
    const res = await fetch(`/api/close?ticker=${encodeURIComponent(ticker)}&date=${date}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { close?: number; date?: string };
    return typeof body.close === 'number' && body.close > 0 && typeof body.date === 'string'
      ? { close: body.close, date: body.date }
      : null;
  } catch {
    return null;
  }
}

/**
 * Market-hours alert check, fully in-house (same pattern as congel-pools'
 * sync functions): pg_cron → this function → Resend email.
 *
 * Reads open challenge lots (exit targets) and the watchlist (entry
 * triggers), prices them via the deployed quotes proxy, and diffs against
 * challenge.alert_state — the dedup/state machine. A newly firing alert
 * inserts a state row and sends ONE email; while it stays fired, silence;
 * when it stops firing, the row gets cleared_at so a later re-cross emails
 * again. State rows double as in-app alert history.
 *
 * Callers: the pg_cron scheduler (x-cron-secret) or the service role key
 * as a bearer token (manual runs / testing). Quote-feed downtime skips the
 * run — that is not an alert-worthy failure every 30 minutes.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const QUOTES_BASE = "https://challenge-tracker.pages.dev";
const EMAIL_TO = "mcongel@gmail.com";
const EMAIL_FROM = "Challenge Tracker <hello@spokenfor.money>";

const usd = (n: number) => `$${Number(n).toFixed(2)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth: cron secret header, or the service role key as a bearer token.
  const cronSecret = Deno.env.get("CRON_SYNC_SECRET");
  const provided = req.headers.get("x-cron-secret");
  const isCron = Boolean(cronSecret && provided && safeEqual(provided, cronSecret));
  const auth = req.headers.get("Authorization") ?? "";
  const isService = safeEqual(auth, `Bearer ${serviceKey}`);
  if (!isCron && !isService) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "challenge" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [lotsRes, watchRes, overridesRes, openRes] = await Promise.all([
    supabase.from("position_lots").select("ticker, exit_target"),
    supabase.from("watchlist").select("ticker, entry_trigger").not("entry_trigger", "is", null),
    supabase.from("price_overrides").select("ticker, price"),
    supabase.from("alert_state").select("id, key").is("cleared_at", null),
  ]);
  for (const r of [lotsRes, watchRes, overridesRes, openRes]) {
    if (r.error) return json({ error: r.error.message }, 500);
  }
  const lots = lotsRes.data ?? [];
  const watch = watchRes.data ?? [];
  const overrides = new Map((overridesRes.data ?? []).map((r) => [r.ticker, Number(r.price)]));
  const open = openRes.data ?? [];

  const tickers = [...new Set([...lots.map((l) => l.ticker), ...watch.map((w) => w.ticker)])];
  if (tickers.length === 0) return json({ checked: 0, fired: [], cleared: [] });

  let quotes = new Map<string, number>();
  try {
    const res = await fetch(`${QUOTES_BASE}/api/quotes?tickers=${tickers.join(",")}`);
    if (!res.ok) return json({ skipped: `quote fetch ${res.status}` });
    const body = await res.json();
    quotes = new Map(
      Object.entries(body.quotes ?? {}).map(([t, q]) => [t, (q as { price: number }).price]),
    );
  } catch (e) {
    return json({ skipped: `quote fetch failed: ${e}` });
  }
  const priceOf = (t: string) => overrides.get(t) ?? quotes.get(t);

  // What's firing right now. Exit side: the lowest crossed target per ticker
  // (the first tripwire). Entry side: price at/below the bench trigger.
  const firing = new Map<string, { title: string; price: number }>();
  const lowestTarget = new Map<string, number>();
  for (const l of lots) {
    const t = Number(l.exit_target);
    const cur = lowestTarget.get(l.ticker);
    if (cur === undefined || t < cur) lowestTarget.set(l.ticker, t);
  }
  for (const [ticker, target] of lowestTarget) {
    const price = priceOf(ticker);
    if (price !== undefined && price >= target) {
      firing.set(`target-${ticker}`, {
        title: `🎯 ${ticker} crossed its ${usd(target)} exit target (now ${usd(price)}) — sell into strength (Rule 8)`,
        price,
      });
    }
  }
  for (const w of watch) {
    const trigger = Number(w.entry_trigger);
    const price = priceOf(w.ticker);
    if (price !== undefined && trigger > 0 && price <= trigger) {
      firing.set(`entry-${w.ticker}`, {
        title: `📊 ${w.ticker} hit your ${usd(trigger)} entry trigger (now ${usd(price)}) — the bench setup is live`,
        price,
      });
    }
  }

  const openKeys = new Set(open.map((o) => o.key));
  const fired: string[] = [];
  const cleared: string[] = [];
  const emailErrors: string[] = [];

  // New fires: insert state + one email each.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  for (const [key, f] of firing) {
    if (openKeys.has(key)) continue;
    const { error } = await supabase
      .from("alert_state")
      .insert({ key, title: f.title, price: f.price });
    if (error) {
      // A unique-violation race with a concurrent run means the other run
      // owns the email — skip quietly. Anything else is worth surfacing.
      if (error.code !== "23505") emailErrors.push(`${key}: ${error.message}`);
      continue;
    }
    fired.push(key);
    if (resendKey) {
      const send = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [EMAIL_TO],
          subject: f.title,
          html:
            `<p style="font-size:16px">${f.title}</p>` +
            `<p><a href="https://challenge-tracker.pages.dev">Open the tracker</a></p>` +
            `<p style="color:#888;font-size:12px">Delayed quotes, checked every 30 minutes during market hours. ` +
            `One email per crossing — you'll be re-alerted only if it clears and crosses again.</p>`,
        }),
      });
      if (!send.ok) emailErrors.push(`${key}: resend ${send.status} ${await send.text()}`);
    } else {
      emailErrors.push(`${key}: RESEND_API_KEY not configured`);
    }
  }

  // Clears: open state rows whose condition stopped firing.
  for (const o of open) {
    if (firing.has(o.key)) continue;
    const { error } = await supabase
      .from("alert_state")
      .update({ cleared_at: new Date().toISOString() })
      .eq("id", o.id);
    if (error) emailErrors.push(`clear ${o.key}: ${error.message}`);
    else cleared.push(o.key);
  }

  return json({ checked: tickers.length, fired, cleared, errors: emailErrors });
});

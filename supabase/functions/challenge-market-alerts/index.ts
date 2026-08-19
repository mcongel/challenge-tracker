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
 * notified_at stamps the CONFIRMED send. A row whose email failed keeps
 * notified_at null and the send retries on every run while it still fires —
 * one Resend hiccup must not swallow the crossing the feature exists for.
 * Any email error also returns non-200 so a failing run is visible.
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
    supabase.from("position_lots").select("ticker, exit_target, exit_date"),
    supabase.from("watchlist").select("ticker, entry_trigger").not("entry_trigger", "is", null),
    supabase.from("price_overrides").select("ticker, price"),
    supabase.from("alert_state").select("id, key, notified_at").is("cleared_at", null),
  ]);
  for (const r of [lotsRes, watchRes, overridesRes, openRes]) {
    if (r.error) return json({ error: r.error.message }, 500);
  }
  const lots = lotsRes.data ?? [];
  const watch = watchRes.data ?? [];
  const overrides = new Map((overridesRes.data ?? []).map((r) => [r.ticker, Number(r.price)]));
  const open = openRes.data ?? [];

  const tickers = [...new Set([...lots.map((l) => l.ticker), ...watch.map((w) => w.ticker)])];

  // Quotes are best-effort: a feed outage must not silence the calendar
  // alerts (date-only) or wrongly CLEAR open price alerts.
  let quotes = new Map<string, number>();
  let quotesOk = tickers.length > 0;
  if (quotesOk) {
    try {
      const res = await fetch(`${QUOTES_BASE}/api/quotes?tickers=${tickers.join(",")}`);
      if (res.ok) {
        const body = await res.json();
        quotes = new Map(
          Object.entries(body.quotes ?? {}).map(([t, q]) => [t, (q as { price: number }).price]),
        );
      } else {
        quotesOk = false;
      }
    } catch {
      quotesOk = false;
    }
  }
  const priceOf = (t: string) => overrides.get(t) ?? quotes.get(t);

  // What's firing right now. Exit side: the lowest crossed target per ticker
  // (the first tripwire). Entry side: price at/below the bench trigger.
  // Calendar side: the earliest exit date per ticker, once it's within
  // CALENDAR_ALERT_DAYS (or blown past) — no price involved, the date is
  // the rule.
  const firing = new Map<string, { title: string; price: number | null }>();
  if (quotesOk) {
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
  }

  const CALENDAR_ALERT_DAYS = 2;
  const todayISO = new Date().toISOString().slice(0, 10);
  const daysUntil = (iso: string) =>
    Math.round((Date.parse(iso) - Date.parse(todayISO)) / 86_400_000);
  const earliestExit = new Map<string, string>();
  for (const l of lots) {
    if (!l.exit_date) continue;
    const cur = earliestExit.get(l.ticker);
    if (!cur || l.exit_date < cur) earliestExit.set(l.ticker, l.exit_date);
  }
  for (const [ticker, exitDate] of earliestExit) {
    const days = daysUntil(exitDate);
    if (days > CALENDAR_ALERT_DAYS) continue;
    const when = days < 0
      ? `was ${exitDate} — overdue, close it`
      : days === 0
        ? "is TODAY — out by the close"
        : `is ${exitDate} (${days} day${days > 1 ? "s" : ""} out)`;
    firing.set(`calendar-${ticker}`, {
      title: `⏰ ${ticker} calendar exit ${when} — never hold through the print`,
      price: null,
    });
  }

  const openByKey = new Map(open.map((o) => [o.key, o]));
  const fired: string[] = [];
  const cleared: string[] = [];
  const emailErrors: string[] = [];

  const resendKey = Deno.env.get("RESEND_API_KEY");
  /** Returns null on a confirmed send, else the error to surface. */
  const sendEmail = async (title: string): Promise<string | null> => {
    if (!resendKey) return "RESEND_API_KEY not configured";
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [EMAIL_TO],
        subject: title,
        html:
          `<p style="font-size:16px">${title}</p>` +
          `<p><a href="https://challenge-tracker.pages.dev">Open the tracker</a></p>` +
          `<p style="color:#888;font-size:12px">Delayed quotes, checked every 30 minutes during market hours. ` +
          `One email per crossing — you'll be re-alerted only if it clears and crosses again.</p>`,
      }),
    });
    return send.ok ? null : `resend ${send.status} ${await send.text()}`;
  };
  const markNotified = async (id: string) => {
    const { error } = await supabase
      .from("alert_state")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);
    if (error) emailErrors.push(`notify-stamp: ${error.message}`);
  };

  // New fires insert state THEN email, stamping notified_at only on a
  // confirmed send; an open row whose email never confirmed retries here
  // on every run while it still fires.
  for (const [key, f] of firing) {
    const existing = openByKey.get(key);
    if (existing) {
      if (existing.notified_at == null) {
        const sendErr = await sendEmail(f.title);
        if (sendErr) emailErrors.push(`${key}: ${sendErr}`);
        else {
          await markNotified(existing.id);
          fired.push(`${key} (retried)`);
        }
      }
      continue;
    }
    const { data: inserted, error } = await supabase
      .from("alert_state")
      .insert({ key, title: f.title, price: f.price })
      .select("id")
      .single();
    if (error || !inserted) {
      // A unique-violation race with a concurrent run means the other run
      // owns the email — skip quietly. Anything else is worth surfacing.
      if (error && error.code !== "23505") emailErrors.push(`${key}: ${error.message}`);
      continue;
    }
    const sendErr = await sendEmail(f.title);
    if (sendErr) emailErrors.push(`${key}: ${sendErr}`);
    else {
      await markNotified(inserted.id);
      fired.push(key);
    }
  }

  // Clears: open state rows whose condition stopped firing. With the quote
  // feed down, price-alert states are unknowable — leave them open rather
  // than "clearing" on missing data; calendar states always resolve.
  for (const o of open) {
    if (firing.has(o.key)) continue;
    if (!quotesOk && (o.key.startsWith("target-") || o.key.startsWith("entry-"))) continue;
    const { error } = await supabase
      .from("alert_state")
      .update({ cleared_at: new Date().toISOString() })
      .eq("id", o.id);
    if (error) emailErrors.push(`clear ${o.key}: ${error.message}`);
    else cleared.push(o.key);
  }

  // Non-200 on any email/stamp error — a failing alert pipeline must look
  // like a failure, not a quiet success with errors buried in the body.
  return json(
    { checked: tickers.length, quotesOk, fired, cleared, errors: emailErrors },
    emailErrors.length > 0 ? 500 : 200,
  );
});

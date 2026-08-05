# Supabase setup — one-time, Sackets project (`mlvntnbgboinjhmavwao`)

Everything lives in the `challenge` schema. Nothing here touches `public` or
any other schema.

## 1. Run the migration

Supabase dashboard → SQL Editor → paste and run
`supabase/migrations/20260804000000_init_challenge.sql`
(or `supabase db push` if you use the CLI against this project).

## 2. Expose the schema (dashboard-only step — requests 404 without it)

Dashboard → **Settings → API → Exposed schemas** → add `challenge` to the
list (keep the existing entries). Save.

## 3. Frontend env vars

Local: copy `.env.example` to `.env` and fill `VITE_SUPABASE_ANON_KEY`
(dashboard → Settings → API → anon/public key).
Cloudflare Pages: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
build environment variables.

## 4. Seed from the workbook

```
SUPABASE_URL=https://mlvntnbgboinjhmavwao.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
node scripts/seed.mjs
```

Seeds the Parked Pile (upsert — safe to re-run) and verifies computed totals
against the workbook. Add `--with-examples` to also load the workbook's
example rows (NBIS lot, cash events, MU trade, benchmark deposit) into empty
tables for end-to-end number checking; delete them from the UI when real
trading starts.

## Security notes

- RLS on every table via `challenge.is_owner()`, which requires the JWT
  email to be `mcongel@gmail.com`. Other authenticated users of the Sackets
  project (race apps) can neither read nor write anything in this schema.
  If your login email ever changes, update that function.
- The service role key is for the seed script only. Never put it in a
  `VITE_`-prefixed var, `.env` that ships, or the repo.

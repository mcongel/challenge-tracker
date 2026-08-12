# Supabase setup — Sackets project (`mlvntnbgboinjhmavwao`)

Everything lives in the `challenge` schema. Nothing here touches `public` or
any other schema — the Sackets project also hosts the race-management apps.

## 1. Run ALL migrations, in filename order

Supabase dashboard → SQL Editor → paste and run each file in
`supabase/migrations/` in ascending filename order (the timestamps sort
correctly), or with the CLI: `supabase link --project-ref mlvntnbgboinjhmavwao`
once (the link state is gitignored), then `supabase db push`:

```
20260804000000_init_challenge.sql        schema, RLS, grants
20260804200000_contribution_cap.sql
20260805000000_accounts.sql
20260805100000_full_xu.sql
20260805200000_parked_lots.sql
20260806000000_parked_sales.sql
20260806100000_concentration_cap.sql
20260806200000_parked_cash.sql
20260810000000_dividend_tracking.sql
20260811000000_dividend_frequencies.sql
20260812000000_roc_basis_and_history.sql
20260813000000_reversible_parked_sales.sql
20260814000000_transition_scenarios.sql
20260815000000_hardening.sql             benchmark twin links + backfill
20260816000000_lot_buy_link.sql          lot↔Buy links + backfill
```

New tables need three things every migration here already handles — copy the
pattern if you add one: `enable row level security`, a `create policy
owner_all … using (challenge.is_owner())`, and `grant all … to authenticated,
service_role`.

**Deploy order rule: migrate BEFORE pushing code.** The app selects from
every table at load, so new code against an old schema errors at startup.
Apply the migration to the live DB, verify, then push.

## 2. Expose the schema (dashboard-only step — requests 404 without it)

Dashboard → **Settings → API → Exposed schemas** → add `challenge` to the
list (keep the existing entries). Save.

## 3. Env vars and secrets

- Local: copy `.env.example` to `.env` and fill `VITE_SUPABASE_ANON_KEY`
  (dashboard → Settings → API → anon/public key).
- Cloudflare Pages (build env): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `FINNHUB_API_KEY` (quote fallback only; Yahoo is primary and needs no key).
- GitHub Actions (repo secrets): `SUPABASE_SERVICE_ROLE_KEY` — used by the
  daily-snapshot and nightly-backup workflows. Optional `QUOTES_BASE` env in
  the workflow if the Pages URL ever changes (defaults to production).

## 4. Seed from the workbook

```
SUPABASE_URL=https://mlvntnbgboinjhmavwao.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
node scripts/seed.mjs
```

Seeds the Parked Pile (upsert — safe to re-run) and verifies computed totals
against the workbook. Add `--with-examples` to also load the workbook's
example rows into empty tables for end-to-end number checking; delete them
from the UI when real trading starts.

## 5. Backup and restore

- Nightly backups: `.github/workflows` uploads a JSON dump of all challenge
  tables as a build artifact (90-day retention). Manual run any time:

  ```
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.mjs backup.json
  ```

- The in-app Export (header → download) produces the same shape.
- Restore (merge over what's there, or `--wipe` for a clean rebuild onto a
  damaged database — children deleted before parents, ids preserved):

  ```
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore.mjs backup.json [--wipe]
  ```

  Recovery runbook: run the migrations on a fresh schema (step 1), expose the
  schema (step 2), download the latest backup artifact, restore with
  `--wipe`, then spot-check Total Score against the last snapshot.
  Note: exports predating a migration lack its columns (they restore as
  null); the app's legacy fallbacks cover them.

## Security notes

- RLS on every table via `challenge.is_owner()`, which requires the JWT
  email to be `mcongel@gmail.com`. Other authenticated users of the Sackets
  project (race apps) can neither read nor write anything in this schema.
  If your login email ever changes, update that function.
- The service role key is for the scripts (seed/snapshot/backup/restore)
  only. Never put it in a `VITE_`-prefixed var, a `.env` that ships, or the
  repo.
- Backup artifacts are the FULL unencrypted ledger — anyone with read access
  to the repo can download them from the Actions tab. The repo must stay
  private.
- GitHub disables scheduled workflows after ~60 days without repository
  activity. If commits go quiet, glance at the Actions tab monthly — a
  `workflow_dispatch` run re-arms the schedules.

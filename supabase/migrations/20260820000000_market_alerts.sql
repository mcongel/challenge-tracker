-- Market alerts move in-house: pg_cron -> challenge-market-alerts edge
-- function -> Resend email (the congel-pools cron pattern, reusing the
-- vault's project_url + cron_sync_secret). The GitHub Action notifier is
-- retired in the same commit.

-- The dedup/state machine, one row per alert episode. An OPEN row (null
-- cleared_at) means the alert already emailed and is still firing — the
-- next crossing only emails after the previous episode clears. History
-- rows double as an in-app alert log later.
create table challenge.alert_state (
  id uuid primary key default gen_random_uuid(),
  -- Stable episode key: 'target-AFRM', 'entry-BE'.
  key text not null,
  title text not null,
  -- The price that tripped it, for the record.
  price numeric(14,4),
  fired_at timestamptz not null default now(),
  cleared_at timestamptz
);
create unique index alert_state_open_key on challenge.alert_state (key)
  where cleared_at is null;

alter table challenge.alert_state enable row level security;
create policy owner_all on challenge.alert_state
  for all using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.alert_state to authenticated, service_role;

-- Wrapper the cron job calls — reads the vault, fires an async POST at the
-- edge function with the shared x-cron-secret. Same shape as
-- invoke_mlb_standings_sync, but lives in the challenge schema.
create or replace function challenge.invoke_market_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_cron_secret text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets where name = 'project_url';

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets where name = 'cron_sync_secret';

  if v_project_url is null or v_cron_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_project_url || '/functions/v1/challenge-market-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', v_cron_secret
    ),
    body    := jsonb_build_object('triggered_by', 'cron')
  );
end;
$$;

-- Every 30 minutes through the US session (13:00-20:30 UTC covers the
-- 9:30-4 ET day; the EST months fire an extra early/late check - harmless).
-- Unschedule first so the migration re-runs safely.
select cron.unschedule(jobname)
from cron.job
where jobname = 'challenge-market-alerts';

select cron.schedule(
  'challenge-market-alerts',
  '*/30 13-20 * * 1-5',
  'select challenge.invoke_market_alerts()'
);

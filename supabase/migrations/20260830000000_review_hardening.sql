-- Hardening pass from the 2026-08-19 full code review.

-- 1) alert_state.notified_at records the CONFIRMED email send. The function
--    used to insert the state row BEFORE sending — a Resend failure left the
--    row open and suppressed that alert forever. Now it retries any open row
--    with notified_at null until a send confirms.
alter table challenge.alert_state add column notified_at timestamptz;
-- Rows from before this column existed already had their email.
update challenge.alert_state set notified_at = fired_at;

-- 2) The benchmark twin link is 1:1 by design and insertDepositWithTwin
--    assumes it — two twins on one deposit would silently overstate the
--    shadow-VOO benchmark forever. (If this fails to apply, duplicate twins
--    already exist: inspect before deleting — the benchmark math is wrong.)
alter table challenge.benchmark_deposits
  add constraint benchmark_deposits_cash_event_id_key unique (cash_event_id);

-- 3) Reserved category spellings. 'BTC' gates the fourth pot and
--    'Semiconductors' drives the concentration cap; since the category CHECK
--    was dropped for free-text sectors, a case typo would silently move a
--    holding across a wall and corrupt that day's snapshot. Canonicalize the
--    two reserved words on write; everything else stays free text.
create or replace function challenge.canonicalize_parked_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if upper(trim(new.category)) = 'BTC' then
    new.category := 'BTC';
  elsif lower(trim(new.category)) = 'semiconductors' then
    new.category := 'Semiconductors';
  end if;
  return new;
end;
$$;

drop trigger if exists parked_positions_canonical_category on challenge.parked_positions;
create trigger parked_positions_canonical_category
  before insert or update of category on challenge.parked_positions
  for each row execute function challenge.canonicalize_parked_category();

-- 4) Indexes for the hot filters — Postgres does not auto-index FKs, and
--    recomputeParkedAggregate filters parked_lots by position after every
--    lot mutation.
create index if not exists parked_lots_position_idx
  on challenge.parked_lots (parked_position_id);
create index if not exists cash_events_date_idx
  on challenge.cash_events (date);
create index if not exists position_lots_ticker_idx
  on challenge.position_lots (ticker);
create index if not exists trades_close_date_idx
  on challenge.trades (close_date);
create index if not exists parked_sales_account_date_idx
  on challenge.parked_sales (account_id, date);
create index if not exists outside_sales_ticker_date_idx
  on challenge.outside_sales (ticker, sale_date);
create index if not exists parked_cash_events_account_idx
  on challenge.parked_cash_events (account_id);

-- 5) invoke_market_alerts is SECURITY DEFINER and inherited the default
--    EXECUTE grant to PUBLIC — any holder of the anon key (it ships in the
--    browser bundle) could POST /rpc/invoke_market_alerts and trigger
--    outbound HTTP under definer privileges. Only cron (postgres) calls it.
revoke execute on function challenge.invoke_market_alerts() from public, anon, authenticated;

-- 6) Type drift: btc_value was bare numeric while every sibling column is
--    numeric(14,2).
alter table challenge.snapshots alter column btc_value type numeric(14,2);

-- Challenge Account Tracker — initial schema.
-- Lives ENTIRELY in the `challenge` schema inside the existing Sackets
-- project. Never touches public or any other schema.

create schema if not exists challenge;

-- Single-user lockdown. The Sackets project's auth serves other apps with
-- other users; a plain `auth.uid() = owner_id` policy would let any of them
-- write rows here. Locking policies to the owner's email keeps the schema
-- invisible and unwritable to everyone else. (Swap for a hardcoded UUID
-- check if you ever change login email.)
create or replace function challenge.is_owner()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'mcongel@gmail.com'
$$;

-- ---------------------------------------------------------------- tables

create table challenge.cash_events (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  type text not null check (type in
    ('Deposit','Withdrawal','Buy','Sell','Dividend','TaxSkim','MilestoneBank','Fee')),
  amount numeric(14,2) not null check (amount >= 0),
  ticker text,
  source_destination text,
  notes text,
  created_at timestamptz not null default now()
);

create table challenge.position_lots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  buy_date date not null,
  shares numeric(18,8) not null check (shares > 0),
  avg_cost numeric(14,4) not null check (avg_cost >= 0),
  -- The rule: no entry without a defined exit. Enforced here, not just in UI.
  exit_target numeric(14,4) not null,
  bail_point numeric(14,4) not null,
  thesis text,
  created_at timestamptz not null default now()
);

create table challenge.trades (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  open_date date not null,
  close_date date not null,
  cost_basis numeric(14,2) not null,
  proceeds numeric(14,2) not null,
  wash_sale boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  check (close_date >= open_date)
);

create table challenge.milestones (
  id uuid primary key default gen_random_uuid(),
  level numeric(14,2) not null unique,
  account_value_at_hit numeric(14,2) not null,
  date_hit date not null,
  amount_banked numeric(14,2) not null,
  parked_destination text
);

create table challenge.benchmark_deposits (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric(14,2) not null check (amount > 0),
  voo_price_that_day numeric(14,4) not null check (voo_price_that_day > 0)
);

create table challenge.parked_positions (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  account text not null,
  category text not null check (category in ('Semi/AI','AI-adjacent','BTC','Other')),
  shares numeric(18,8) not null check (shares > 0),
  avg_cost numeric(14,4) not null check (avg_cost >= 0),
  current_price numeric(14,4) not null default 0,
  buy_date date,
  trim_rank integer,
  notes text,
  unique (ticker, account)
);

-- One per calendar day, written on first app load. The date PK makes the
-- daily write idempotent (insert ... on conflict do nothing).
create table challenge.snapshots (
  date date primary key,
  account_value numeric(14,2) not null,
  banked_total numeric(14,2) not null,
  reserved_total numeric(14,2) not null,
  total_score numeric(14,2) not null,
  shadow_voo_value numeric(14,2) not null,
  net_contributed numeric(14,2) not null,
  parked_pile_value numeric(14,2) not null,
  semi_ai_pct numeric(8,6) not null
);

-- Net loss carried INTO tax_year from prior years, stored positive.
create table challenge.loss_carryforwards (
  tax_year integer primary key,
  amount numeric(14,2) not null check (amount >= 0),
  notes text
);

-- Manual price override: pinned — beats API quotes until the row is deleted.
create table challenge.price_overrides (
  ticker text primary key,
  price numeric(14,4) not null check (price > 0),
  set_at timestamptz not null default now()
);

-- Small editable knobs (e.g. concentration cap). One row per key.
create table challenge.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'challenge'
  loop
    execute format('alter table challenge.%I enable row level security', t);
    execute format(
      'create policy owner_all on challenge.%I for all to authenticated
         using (challenge.is_owner()) with check (challenge.is_owner())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- grants
-- PostgREST gotcha: without these grants (and the schema being listed under
-- API -> Exposed schemas in the dashboard), every request 404s or 401s.

grant usage on schema challenge to authenticated, service_role;
grant all on all tables in schema challenge to authenticated, service_role;
grant usage, select on all sequences in schema challenge to authenticated, service_role;
grant execute on all functions in schema challenge to authenticated, service_role;

alter default privileges in schema challenge
  grant all on tables to authenticated, service_role;
alter default privileges in schema challenge
  grant usage, select on sequences to authenticated, service_role;

-- Parked lots: each purchase or dividend reinvestment is its own dated slice,
-- with its own 366-day funding-unlock clock (DRIP shares are short-term for a
-- year). The position row's shares/avg_cost become aggregates maintained from
-- lots. Cash dividends log with shares = 0 — income context, never score.

create table challenge.parked_lots (
  id uuid primary key default gen_random_uuid(),
  parked_position_id uuid not null references challenge.parked_positions(id) on delete cascade,
  date date,
  source text not null check (source in ('purchase', 'dividend')),
  shares numeric(18,8) not null default 0 check (shares >= 0),
  price numeric(14,4) check (price is null or price >= 0),
  -- Cost for purchases and reinvested dividends (adds to basis); the cash
  -- amount for unreinvested dividends.
  amount numeric(14,2) not null check (amount >= 0),
  notes text,
  created_at timestamptz not null default now()
);

alter table challenge.parked_lots enable row level security;
create policy owner_all on challenge.parked_lots
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.parked_lots to authenticated, service_role;

-- Backfill: one purchase lot per existing position from its current totals.
-- Date carries over from buy_date (may be null = unknown, to be refined).
insert into challenge.parked_lots (parked_position_id, date, source, shares, price, amount)
select id, buy_date, 'purchase', shares, avg_cost, round(shares * avg_cost, 2)
from challenge.parked_positions;

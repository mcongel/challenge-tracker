-- Accounts: where money physically lives. Labels and context ONLY — no
-- account ever changes Total Score math.
--   kind 'challenge' — the trading account itself (exactly one in practice)
--   kind 'outside'   — other brokerages holding the parked pile
--   kind 'bank'      — bank accounts holding skimmed cash (tax reserve etc.)

create table challenge.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  broker text,
  kind text not null check (kind in ('challenge', 'outside', 'bank')),
  notes text,
  created_at timestamptz not null default now()
);

-- Minimal record of a sale in an outside account — just enough to enforce
-- Rule 9's cross-brokerage wash-sale window. Deliberately NOT a trade log:
-- no basis, no P&L, and never part of any score or YTD math.
create table challenge.outside_sales (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references challenge.accounts(id),
  ticker text not null,
  sale_date date not null,
  loss boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table challenge.accounts enable row level security;
alter table challenge.outside_sales enable row level security;
create policy owner_all on challenge.accounts
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
create policy owner_all on challenge.outside_sales
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.accounts, challenge.outside_sales to authenticated, service_role;

insert into challenge.accounts (name, kind, broker) values
  ('Challenge Account', 'challenge', null),
  ('Cash App', 'outside', 'Cash App'),
  ('Robinhood', 'outside', 'Robinhood'),
  ('Stash', 'outside', 'Stash'),
  ('Tax Reserve Savings', 'bank', null)
on conflict (name) do nothing;

-- Parked pile: free-text account column becomes a real reference.
insert into challenge.accounts (name, kind)
  select distinct account, 'outside' from challenge.parked_positions
on conflict (name) do nothing;

alter table challenge.parked_positions add column account_id uuid references challenge.accounts(id);
update challenge.parked_positions p set account_id = a.id
  from challenge.accounts a where a.name = p.account;
alter table challenge.parked_positions alter column account_id set not null;
alter table challenge.parked_positions drop constraint parked_positions_ticker_account_key;
alter table challenge.parked_positions add constraint parked_positions_ticker_account_id_key
  unique (ticker, account_id);
alter table challenge.parked_positions drop column account;

-- Cash events: a transfer has two ends. Source (Deposits: where the money
-- came from) and destination (TaxSkim/MilestoneBank/Withdrawal: where it
-- went). Both optional; free-text source_destination remains for non-account
-- provenance ("paycheck").
alter table challenge.cash_events add column account_id uuid references challenge.accounts(id);
alter table challenge.cash_events add column destination_account_id uuid references challenge.accounts(id);

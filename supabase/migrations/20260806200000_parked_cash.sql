-- Per-account cash ledger for the pile's brokerages (and banks): the manual
-- half of tracked cash. Trades, dividends, trims, and challenge deposits
-- auto-flow in the app's math; this table holds what only the owner knows —
-- external deposits, withdrawals, interest, fees, and reconcile adjustments.
-- Context only: never Total Score, never the skim.

create table challenge.parked_cash_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references challenge.accounts(id),
  date date not null,
  type text not null check (type in ('deposit', 'withdrawal', 'interest', 'fee', 'adjustment')),
  -- Positive with typed direction; adjustments alone may be signed either way
  -- (they're the reconcile-to-actual correction).
  amount numeric(14,2) not null check (type = 'adjustment' or amount >= 0),
  notes text,
  created_at timestamptz not null default now()
);

alter table challenge.parked_cash_events enable row level security;
create policy owner_all on challenge.parked_cash_events
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.parked_cash_events to authenticated, service_role;

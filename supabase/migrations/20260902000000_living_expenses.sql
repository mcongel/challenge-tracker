-- Living-expenses coverage (owner decision 2026-08-24): the pile becomes an
-- income engine that pays the bills. Expenses are matched against SPENDABLE
-- after-tax dividend income, cheapest bill first (the debt-snowball method),
-- so income "fills" the ladder and the next target is always the next-
-- cheapest gap. Pure pile-side context — never score or challenge math.

-- One row per recurring or one-off cost. Amount is normalized to monthly in
-- the engine per cadence.
create table challenge.expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(14,2) not null check (amount > 0),
  cadence text not null default 'monthly' check (cadence in ('monthly', 'annual', 'once')),
  -- Optional free-text grouping (Housing, Food, ...). Coverage snowballs by
  -- amount, not category, so this is display-only.
  category text,
  -- Inactive expenses stay for the record but drop out of coverage.
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table challenge.expenses enable row level security;
create policy owner_all on challenge.expenses
  for all using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.expenses to authenticated, service_role;

-- Per-holding intent: is this position's dividend REINVESTED (still growing
-- the snowball) or taken as cash AVAILABLE to spend? Only 'spend' income
-- counts toward covering expenses. Null = infer from the position's recent
-- dividend history (DRIP lots carry a reinvest price; cash lots don't).
alter table challenge.parked_positions
  add column income_use text check (income_use in ('reinvest', 'spend'));

-- Tag an actual withdrawal to the expense it paid, and whether it came from
-- accumulated dividend income or from principal (a drawdown). Only meaningful
-- on withdrawal-type rows; null everywhere else, so existing rows are
-- untouched. (Phase 3 UI writes these; the column ships now so the model is
-- stable.)
alter table challenge.parked_cash_events
  add column expense_id uuid references challenge.expenses(id) on delete set null,
  add column funded_from text check (funded_from in ('income', 'principal'));

create index if not exists parked_cash_events_expense_idx
  on challenge.parked_cash_events (expense_id);

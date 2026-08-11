-- Retirement transition modeler (Phase 3): what-if scenarios that rotate
-- parked-pile growth holdings into income assets across the owner's
-- 2028–2032 retirement window. Pure pile context — never score, YTD, or
-- tax-skim math. Rates are fractions (0.15 = 15%); buy_classification_mix is
-- percent points summing to 100 (e.g. {"ordinary": 40, "return_of_capital": 60}).

-- Existing income holdings compound in projections (deferred from Phase 1).
alter table challenge.parked_positions add column dividend_growth_pct numeric(8,6);

-- Notional entry mode stores a derived per-share price; 4dp truncation would
-- stop shares × price reproducing the entered total on fractional shares.
-- 8dp keeps the round-trip exact for any realistic share count. position_lots
-- has no amount column so avg_cost IS the basis; the parked price columns are
-- re-read by sale edits (undo + re-apply recomputes proceeds from them).
alter table challenge.position_lots alter column avg_cost type numeric(18,8);
alter table challenge.parked_lots alter column price type numeric(18,8);
alter table challenge.parked_sales alter column price_per_share type numeric(18,8);

create table challenge.income_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  target_annual_income numeric(14,2)
    check (target_annual_income is null or target_annual_income > 0),
  target_year int,
  is_active boolean not null default false,
  -- Per-scenario tax overrides (retired brackets differ from working ones);
  -- null falls back to the app_settings rates.
  qualified_rate numeric(8,6)
    check (qualified_rate is null or (qualified_rate >= 0 and qualified_rate < 1)),
  ordinary_rate numeric(8,6)
    check (ordinary_rate is null or (ordinary_rate >= 0 and ordinary_rate < 1)),
  capital_gain_rate numeric(8,6)
    check (capital_gain_rate is null or (capital_gain_rate >= 0 and capital_gain_rate < 1)),
  created_at timestamptz not null default now()
);

create table challenge.scenario_rotations (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references challenge.income_scenarios(id) on delete cascade,
  -- null = new cash (cash_amount required instead).
  sell_holding_id uuid references challenge.parked_positions(id) on delete cascade,
  sell_shares numeric(18,8) check (sell_shares is null or sell_shares > 0),
  sell_pct numeric(8,6) check (sell_pct is null or (sell_pct > 0 and sell_pct <= 1)),
  cash_amount numeric(14,2) check (cash_amount is null or cash_amount > 0),
  rotation_date date not null,
  buy_symbol text not null,
  buy_yield_pct numeric(8,6) not null check (buy_yield_pct >= 0),
  buy_dividend_growth_pct numeric(8,6) not null default 0,
  buy_classification_mix jsonb not null default '{"qualified": 100}',
  notes text,
  constraint rotation_sell_spec check (
    (sell_holding_id is null and cash_amount is not null
      and sell_shares is null and sell_pct is null)
    or (sell_holding_id is not null and cash_amount is null
      and ((sell_shares is null) <> (sell_pct is null)))
  )
);
create index scenario_rotations_scenario_idx on challenge.scenario_rotations (scenario_id);

alter table challenge.income_scenarios enable row level security;
create policy owner_all on challenge.income_scenarios
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.income_scenarios to authenticated, service_role;

alter table challenge.scenario_rotations enable row level security;
create policy owner_all on challenge.scenario_rotations
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.scenario_rotations to authenticated, service_role;

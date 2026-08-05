-- The pile's own sale log: every parked-pile sale with real numbers —
-- proceeds, cost basis from the lots actually consumed (FIFO), and the
-- long-term share split. Its OWN tracking, walled off from the score: these
-- never touch Total Score, challenge YTD, or the tax skim.

create table challenge.parked_sales (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  account_id uuid not null references challenge.accounts(id),
  date date not null,
  shares numeric(18,8) not null check (shares > 0),
  price_per_share numeric(14,4) not null check (price_per_share >= 0),
  proceeds numeric(14,2) not null check (proceeds >= 0),
  -- Nullable: backfilled legacy trims have no reconstructable basis.
  cost_basis numeric(14,2),
  -- Shares that were long-term (>365 days) at sale; null = unknown.
  lt_shares numeric(18,8),
  funded_challenge boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

alter table challenge.parked_sales enable row level security;
create policy owner_all on challenge.parked_sales
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.parked_sales to authenticated, service_role;

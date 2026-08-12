-- The bench. Rule 7's rotation ("sell, then rotate to the next setup")
-- assumes the next setup is already researched when the exit hits — this
-- table is where those candidates wait: the catalyst, its date, the entry
-- zone, and the exit target written BEFORE the entry exists. Context only,
-- never score math.
create table challenge.watchlist (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  -- The thesis: what's supposed to move it (earnings, launch, ruling…).
  catalyst text,
  catalyst_date date,
  -- Free text — "55-58 on a pullback" beats false numeric precision here.
  entry_note text,
  -- The Rule 8 discipline, drafted early: the target you'd write at open.
  planned_target numeric(14,4),
  notes text,
  created_at timestamptz not null default now()
);

alter table challenge.watchlist enable row level security;
create policy owner_all on challenge.watchlist
  for all using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.watchlist to authenticated, service_role;

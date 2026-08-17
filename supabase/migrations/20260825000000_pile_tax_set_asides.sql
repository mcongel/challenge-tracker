-- The pile-taxes card estimates what to set aside; this table records what
-- actually WAS. One row per transfer of real dollars earmarked for the
-- pile's tax bill (notes say where the money physically sits). Pure
-- record-keeping on the pile side of the wall — never score math, never the
-- challenge account's 30% reserve.
create table challenge.pile_tax_set_asides (
  id uuid primary key default gen_random_uuid(),
  tax_year int not null,
  date date not null,
  amount numeric(14,2) not null check (amount > 0),
  notes text
);

alter table challenge.pile_tax_set_asides enable row level security;
create policy owner_all on challenge.pile_tax_set_asides
  for all using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.pile_tax_set_asides to authenticated, service_role;

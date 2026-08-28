-- Four owner_all policies were created without a "to authenticated" clause,
-- so Postgres defaulted them to public (which includes anon). Harmless in
-- practice — anon has no grants in this schema and is_owner() requires the
-- owner's JWT email — but it reads as anon-writable to every security scan
-- and breaks the pattern the other 18 tables follow. Align the roles;
-- predicates are unchanged.
alter policy owner_all on challenge.alert_state to authenticated;
alter policy owner_all on challenge.expenses to authenticated;
alter policy owner_all on challenge.pile_tax_set_asides to authenticated;
alter policy owner_all on challenge.watchlist to authenticated;

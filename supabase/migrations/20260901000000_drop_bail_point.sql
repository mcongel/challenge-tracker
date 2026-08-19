-- Retire position_lots.bail_point for good. The bail point was dropped as a
-- requirement in Rules v3 (owner decision 2026-08-05, "full Xu" — do not
-- restore it), but the column kept being mapped, written, split-scaled, and
-- restored for weeks after. The code references are gone as of this commit.
--
-- DEPLOY ORDER (reversed from the usual rule, because this DROPS a column):
-- deploy the code that stops writing bail_point FIRST, then apply this.
-- Applying it while the previous build is live breaks every lot insert.
alter table challenge.position_lots drop column bail_point;

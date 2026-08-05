-- Full Xu (owner decision 2026-08-05): exits are target-only — the bail point
-- requirement is dropped. Column kept nullable for history; new positions
-- won't set it.
alter table challenge.position_lots alter column bail_point drop not null;

-- How a lot's shares arrived: 'purchase' spent this account's cash;
-- 'transfer' moved shares in via ACATS (no cash); 'milestone' was bought
-- with challenge money. Account-cash math previously inferred this from the
-- free-text notes prefix — editing a note silently changed the balance, and
-- two readers of the convention had already drifted apart.
--
-- NULLABLE by design: null = infer from notes (the legacy fallback). Undo
-- snapshots written before this column restore lots without an origin, and
-- the fallback keeps them classified correctly.
alter table challenge.parked_lots add column origin text
  check (origin in ('purchase', 'transfer', 'milestone'));

update challenge.parked_lots set origin = 'transfer'  where notes ~ '^ACATS from ';
update challenge.parked_lots set origin = 'milestone' where notes ~ '^Milestone ';

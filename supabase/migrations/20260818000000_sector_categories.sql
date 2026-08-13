-- Categories become real sectors (owner decision 2026-08-12). The four
-- strategy buckets did two jobs badly; now the label is the actual sector
-- (vendor-informed, freely editable) and the rules key off two reserved
-- values: 'Semiconductors' drives the concentration cap, 'BTC' marks the
-- bitcoin conviction bucket (never trim fuel). Edge cases stay curated by
-- hand — NBIS remains in Semiconductors by thesis, not by vendor label.
alter table challenge.parked_positions
  drop constraint if exists parked_positions_category_check;

-- Remap the existing rows. Everything the owner had in Semi/AI keeps its
-- cap membership (that WAS the curation); the rest take their real sectors.
update challenge.parked_positions set category = 'Semiconductors' where category = 'Semi/AI';
update challenge.parked_positions set category = 'Automobiles' where ticker = 'TSLA';
update challenge.parked_positions set category = 'Media' where ticker = 'GOOGL';
update challenge.parked_positions set category = 'Retail' where ticker = 'AMZN';
update challenge.parked_positions set category = 'Electrical Equipment' where ticker = 'GLW';
update challenge.parked_positions set category = 'Technology' where ticker = 'CRM';
update challenge.parked_positions set category = 'Energy' where ticker = 'VDE';
update challenge.parked_positions set category = 'Income ETF' where ticker = 'QQQI';
update challenge.parked_positions set category = 'Preferred Income' where ticker in ('SATA', 'STRC');
update challenge.parked_positions set category = 'Aerospace' where ticker = 'SPCX';
-- Any straggler in the retired bucket falls back to Other.
update challenge.parked_positions set category = 'Other' where category = 'AI-adjacent';

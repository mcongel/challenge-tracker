-- Dividend lots learn what kind of income they are. Brokers reclassify
-- distributions on the 1099 after year end, so reclassified_at records when we
-- corrected the books; ex_date is optional context. A payment that splits
-- across classifications is simply multiple dividend lots on the same date.
-- Positions gain a manual income estimate (annual $/share + frequency) for
-- projecting payers with no payment history yet. Tax-rate constants move into
-- app_settings so estimates stop hardcoding brackets. All of this is parked
-- pile context only — none of it touches score, YTD, or the tax skim.

alter table challenge.parked_lots
  add column classification text check (classification in
    ('qualified', 'ordinary', 'return_of_capital', 'capital_gain_dist', 'unclassified')),
  add column ex_date date,
  add column reclassified_at timestamptz;

-- Classification only means something on dividend rows.
alter table challenge.parked_lots
  add constraint parked_lots_classification_dividend_only
  check (classification is null or source = 'dividend');

-- Backfill: existing dividends are visibly 'unclassified' (flagged in the UI,
-- estimated at the qualified rate until corrected).
update challenge.parked_lots set classification = 'unclassified'
where source = 'dividend' and classification is null;

alter table challenge.parked_positions
  add column dividend_rate numeric(14,4)
    check (dividend_rate is null or dividend_rate >= 0),
  add column dividend_frequency text check (dividend_frequency in
    ('monthly', 'quarterly', 'semiannual', 'annual'));

insert into challenge.app_settings (key, value) values
  ('qualified_dividend_tax_rate', to_jsonb(0.15)),
  ('ordinary_dividend_tax_rate', to_jsonb(0.24)),
  ('lt_tax_rate', to_jsonb(0.21)),
  ('st_tax_rate', to_jsonb(0.29))
on conflict (key) do nothing;

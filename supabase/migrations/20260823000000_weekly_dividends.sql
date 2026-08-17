-- Weekly joins the frequency enum (weekly-pay income ETFs). Sub-monthly
-- cadences still project as monthly aggregates in the engine; this only
-- widens what the manual-estimate dropdown may store.

alter table challenge.parked_positions
  drop constraint parked_positions_dividend_frequency_check;

alter table challenge.parked_positions
  add constraint parked_positions_dividend_frequency_check
  check (dividend_frequency in
    ('daily', 'weekly', 'semimonthly', 'monthly', 'quarterly', 'semiannual', 'annual'));

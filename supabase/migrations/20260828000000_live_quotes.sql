-- Some retirement rows are real funds with real tickers (JLGMX, RPTTX) whose
-- daily NAV the quote feed can price. Most are not: plan codes (W146, 3494)
-- and annuity units whose unit value is not the fund's NAV — and codes can
-- collide with real listings (TRAD the annuity vs TRAD the SPAC).
-- live_quotes marks, per position, whether the quote feed may price it.
-- Pile rows keep quoting as always (default true); existing retirement rows
-- start manual and opt in one by one via the edit modal.
alter table challenge.parked_positions
  add column live_quotes boolean not null default true;

update challenge.parked_positions
  set live_quotes = false
  where account_id in (select id from challenge.accounts where kind = 'retirement');

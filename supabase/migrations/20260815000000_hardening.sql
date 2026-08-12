-- Hardening sweep: benchmark twins get a real link to their deposit.
-- Twin matching by date+amount is ambiguous (two equal same-day deposits)
-- and silently orphans rows; the FK makes create/delete exact, and a cash
-- event deleted by any path takes its shadow twin with it. Legacy rows stay
-- null and fall back to date+amount matching.
alter table challenge.benchmark_deposits
  add column cash_event_id uuid references challenge.cash_events(id) on delete cascade;

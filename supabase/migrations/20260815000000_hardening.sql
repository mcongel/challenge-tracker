-- Hardening sweep: benchmark twins get a real link to their deposit.
-- Twin matching by date+amount is ambiguous (two equal same-day deposits)
-- and silently orphans rows; the FK makes create/delete exact, and a cash
-- event deleted by any path takes its shadow twin with it.
alter table challenge.benchmark_deposits
  add column cash_event_id uuid references challenge.cash_events(id) on delete cascade;

-- Backfill existing twins. Within a (date, amount) group the legacy twins
-- are interchangeable, so any bijection is correct — pair them by row order.
-- Twins with no matching Deposit stay null; the app keeps its date+amount
-- fallback for those (and for restores of pre-link exports).
with deposits as (
  select id, date, amount,
         row_number() over (partition by date, amount order by id) as rn
  from challenge.cash_events
  where type = 'Deposit'
),
twins as (
  select id, date, amount,
         row_number() over (partition by date, amount order by id) as rn
  from challenge.benchmark_deposits
  where cash_event_id is null
)
update challenge.benchmark_deposits b
set cash_event_id = d.id
from twins t
join deposits d on d.date = t.date and d.amount = t.amount and d.rn = t.rn
where b.id = t.id;

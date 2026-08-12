-- Quality-of-life sweep: position lots get a real link to their Buy cash
-- event, the same cure the benchmark twins got. Matching by
-- ticker+date+amount breaks as soon as either side's date is edited (both
-- edit paths now exist) and can silently pair the WRONG rows when two equal
-- buys share a day. Legacy lots stay null and fall back to fuzzy matching.
alter table challenge.position_lots
  add column buy_event_id uuid references challenge.cash_events(id) on delete set null;

-- Backfill existing lots. Within a (ticker, date, amount) group the Buy
-- events are interchangeable, so any bijection is correct — pair by row
-- order. Lots with no matching Buy stay null.
with buys as (
  select id, ticker, date, amount,
         row_number() over (partition by ticker, date, amount order by id) as rn
  from challenge.cash_events
  where type = 'Buy'
),
lots as (
  select id, ticker, buy_date,
         round(shares * avg_cost, 2) as cost,
         row_number() over (
           partition by ticker, buy_date, round(shares * avg_cost, 2) order by id
         ) as rn
  from challenge.position_lots
  where buy_event_id is null
)
update challenge.position_lots p
set buy_event_id = b.id
from lots l
join buys b on b.ticker = l.ticker and b.date = l.buy_date and b.amount = l.cost and b.rn = l.rn
where p.id = l.id;

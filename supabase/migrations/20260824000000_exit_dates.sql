-- Calendar exits: the other half of the exit plan. The price target has an
-- alert; the "out by Aug 26, never hold through the print" date lived only
-- in the owner's head. Optional per lot; the alert pipeline (in-app +
-- market-alerts edge function) fires as the date closes in.
alter table challenge.position_lots
  add column exit_date date;

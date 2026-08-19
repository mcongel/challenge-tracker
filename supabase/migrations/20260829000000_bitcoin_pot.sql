-- The fourth pot (owner decision 2026-08-19): the bitcoin conviction bucket
-- (category 'BTC' — BTC itself plus thesis members like MSTR and BTCI)
-- leaves the parked pile's total, concentration figure, and chart, and gets
-- its own daily value. Income, Pile Taxes, and Activity still count it —
-- the split is strategy, not tax. Null on days before the split, when
-- bitcoin rode inside parked_pile_value.
alter table challenge.snapshots
  add column btc_value numeric;

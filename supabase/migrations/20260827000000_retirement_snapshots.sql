-- Retirement value joins the daily snapshot — the owner types balances in
-- daily, so history captures itself. Nullable: rows before the retirement
-- feature simply have no value, and charts skip them.
alter table challenge.snapshots
  add column retirement_value numeric(14,2);

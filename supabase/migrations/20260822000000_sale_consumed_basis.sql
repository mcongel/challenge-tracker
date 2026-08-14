-- Fix: selling never un-spends the purchase.
--
-- When a sale consumes lots, the lots' amounts shrink by the consumed basis
-- (that is how remaining basis and unlock clocks stay honest). But the
-- account-cash formula summed CURRENT lot amounts as "cash spent on buys" —
-- so every lot-consuming sale phantom-credited its cost basis back to
-- tracked cash. Discovered 2026-08-14: Cash App tracked 623.94 vs actual
-- 499.96, off by exactly the 123.98 of basis the day's MU trim consumed.
--
-- consumed_basis stores each sale's RAW cash-spending basis (unadjusted,
-- purchase lots only — DRIP and ACATS/milestone lots never brought cash in).
-- computeAccountCash adds it back to the purchases leg. Undo deletes the
-- sale row, so the add-back reverses with it.
alter table challenge.parked_sales
  add column consumed_basis numeric(14,2);

-- Backfill: ONLY the one consuming sale recorded after its account's last
-- reconcile (MU 0.51571 sh on 2026-08-14 — took 123.98 from the Nov 2025
-- lot). Every earlier consuming sale predates a reconcile adjustment that
-- already absorbed its shrinkage; backfilling those would double-count.
update challenge.parked_sales
  set consumed_basis = 123.98
  where id = 'b6ceb668-ca75-44cf-9848-ebad4fef9884';

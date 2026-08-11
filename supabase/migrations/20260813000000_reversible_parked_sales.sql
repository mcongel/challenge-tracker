-- Reversible sales: a snapshot of exactly what each sale consumed (position
-- metadata, per-lot slices with pre-sale absolutes and removed deltas, and
-- per-ROC-event adjustment detail), written at sale time. Undo restores lots
-- and basis exactly; edit = undo + re-apply. Null = legacy sale recorded
-- before snapshots existed — those stay field-edit-only. Undo never touches
-- the challenge ledger (cash_events / benchmark_deposits).
alter table challenge.parked_sales add column consumed jsonb;

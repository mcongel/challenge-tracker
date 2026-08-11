-- Phase 2: lot-level ROC basis adjustment + archived (zero-share) positions.
--
-- Return-of-capital distributions reduce cost basis per share. Adjustments
-- live in their own table so the lot's original amount is never touched
-- (original basis stays recoverable) and deleting or reclassifying the
-- dividend reverses its reductions exactly via cascade/delete. A position may
-- now survive at zero shares so its dividend history stops being destroyed
-- by full trims and transfers. All still parked-pile context — never score,
-- YTD, or tax-skim math.

-- (B) Positions survive at zero shares to keep dividend history.
alter table challenge.parked_positions drop constraint parked_positions_shares_check;
alter table challenge.parked_positions add constraint parked_positions_shares_check
  check (shares >= 0);

-- (A) Per-event, per-lot basis reductions.
create table challenge.parked_lot_adjustments (
  id uuid primary key default gen_random_uuid(),
  share_lot_id uuid not null references challenge.parked_lots(id) on delete cascade,
  -- null = carried over by an ACATS transfer, not tied to a dividend event.
  dividend_lot_id uuid references challenge.parked_lots(id) on delete cascade,
  -- 6dp: ROC events split across many lots go sub-cent; rounding to cents
  -- per row would drift the reconstructed basis.
  amount numeric(16,6) not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index parked_lot_adjustments_share_idx
  on challenge.parked_lot_adjustments (share_lot_id);
create index parked_lot_adjustments_dividend_idx
  on challenge.parked_lot_adjustments (dividend_lot_id);

alter table challenge.parked_lot_adjustments enable row level security;
create policy owner_all on challenge.parked_lot_adjustments
  for all to authenticated using (challenge.is_owner()) with check (challenge.is_owner());
grant all on challenge.parked_lot_adjustments to authenticated, service_role;

-- Distinguishes "ROC not yet allocated" (backfill badge in the UI) from
-- "allocated, possibly zero rows because basis was already exhausted".
alter table challenge.parked_lots add column roc_allocated_at timestamptz;

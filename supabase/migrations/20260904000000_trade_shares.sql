-- Per-trade share count, so the trade log can show buy and sell PRICES, not
-- just the dollar basis and proceeds. Each trade row is one FIFO lot slice of
-- a close, so buy price = cost_basis / shares and sell price = proceeds / shares.
--
-- Nullable on purpose: rows closed before this column existed can't have their
-- share count recovered from basis + proceeds alone (either price would do it,
-- but neither is stored), so they stay NULL and the UI shows "—" for prices.
alter table challenge.trades
  add column if not exists shares numeric(18,8) check (shares is null or shares > 0);

comment on column challenge.trades.shares is
  'Shares in this per-lot close. Buy price = cost_basis/shares, sell price = proceeds/shares. NULL for pre-2026-09-04 rows.';

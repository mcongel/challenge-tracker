-- Two small columns that close the trading loop.
--
-- watchlist.entry_trigger: the numeric price that turns "212 on pullback"
-- from a note into an alert — the entry-side twin of the exit target.
alter table challenge.watchlist
  add column entry_trigger numeric(14,4) check (entry_trigger > 0);

-- trades.exit_reason: one tap of self-knowledge at close time. Free text by
-- design (the UI offers target_hit / calendar / early / thesis_broke) — the
-- pattern card reads it to say whether written targets are calibrated.
alter table challenge.trades
  add column exit_reason text;

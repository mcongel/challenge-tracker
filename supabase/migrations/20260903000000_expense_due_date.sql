-- Month-accurate coverage (Phase 2): an annual bill lands in its real month
-- and a one-off on its real date, so the monthly surplus/shortfall view is
-- honest instead of smearing everything into a flat line. Nullable — a
-- monthly expense ignores it (hits every month); an annual with no month
-- falls back to spreading evenly (the engine's documented fallback).
alter table challenge.expenses add column due_date date;

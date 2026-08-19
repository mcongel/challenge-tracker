# Archive — spent one-time scripts

These ran once against the live database on their stated dates and are kept
for the record only. Do NOT re-run them: `convert-live-tickers.mjs` deletes
`parked_positions` rows (cascading their lots) as part of its conversion.

- `seed-tiaa.mjs` — TIAA statement load, 2026-08-18
- `convert-live-tickers.mjs` — annuity-unit → live-ticker conversion, 2026-08-19

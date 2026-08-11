# CLAUDE.md — Challenge Account Tracker

## What this project is
A personal trading scoreboard app for Mark's swing-trading "challenge account." The full product spec is in `SPEC.md` — read it before making any change. The strategy rules in the spec are the product; do not "simplify" them away.

## Context you need
- The reference implementation is `Challenge_Account_Tracker.xlsx`. When in doubt about a calculation, the workbook wins. App math must reproduce workbook math on the same inputs.
- The design was worked out in a long strategy conversation in Claude (claude.ai). Key decisions already made — do not relitigate:
  - Total Score = account + banked floors + tax reserved. Banked money never returns to trading.
  - Milestone ratchet: nothing skimmed below $100k; 25% banked at $100k and each double after.
  - Quarterly 30% tax reserve on net realized gains, non-negotiable, no off switch.
  - Parked pile is context only, walled off from all score/benchmark math.
  - Benchmark = shadow VOO purchases per deposit, compared against Total Score.
  - Positions require an exit target at entry — target only, "full Xu" (owner decision 2026-08-05 superseding the earlier target+bail rule; do not restore the bail point). One stock at a time: warn, don't block. Warn on wash-sale-window rebuys.
- $1M is an aspiration label, never a pass/fail. UI language should reflect "final height is the prize."

## Stack
- React, deployed on Cloudflare Pages. Owner's usual pipeline: VS Code + GitHub + Cloudflare Pages.
- Persistence: the owner's EXISTING **Sackets** Supabase project (ref `mlvntnbgboinjhmavwao`). His layout: SpokenFor.money has its own separate Supabase project; everything else shares the Sackets project, including this app. New schema `challenge`, existing Sackets project auth. See spec for the exposed-schema and role-grant gotchas — handle them in migrations/setup, not by trial and error. Never create, modify, or drop anything outside the `challenge` schema; the project hosts the owner's race-management and other apps.
- Prices: delayed quotes via a Cloudflare Pages Function proxying a free market-data API (see spec's "Price updates"); API key server-side only; manual override always available.
- Design bar: `DESIGN.md` is a binding part of the spec. The look and feel is inherited from the owner's app SpokenFor.money via reference files in `/design-reference` — extract those tokens before writing any UI. Never invent a second design language.

## Conventions
- Money as decimals, positive amounts + typed direction (see CashEvent in spec).
- Dates ISO strings. Long-term threshold: holding > 365 days (longTermDate = buyDate + 366).
- Keep components small; one screen per route matching the eleven screens in the spec.
- Test the calculation layer against the workbook's example rows before building UI on top of it.

## Working style
- Owner is a 24-year IT veteran (ColdFusion/C#/Oracle/JS day job, ships side projects solo). Be direct, skip beginner explanations, propose then build.
- Small commits, working state at each one. Deploy early to Cloudflare Pages and iterate live.

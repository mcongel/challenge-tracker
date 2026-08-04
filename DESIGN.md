# DESIGN.md — The Design Bar

This file plays the role Bolt's upfront prompt played: it sets the aesthetic and quality bar BEFORE any code is written, so polish is designed in rather than patched on. Treat every statement here as a requirement.

## The one-sentence brief

This app is a **sibling of SpokenFor.money** — same family, same face, different job. A user of SpokenFor should land in this app and feel at home instantly; the only new thing should be what it's about (a trading scoreboard), never how it looks or behaves.

## Design system: inherit, don't invent

The visual system is NOT defined in this file — it is defined by the SpokenFor.money codebase. This repo contains a `/design-reference` folder holding copies of SpokenFor's design source of truth (see "Setup" below). Before building any UI:

1. Read everything in `/design-reference` first: the Tailwind config (or theme file), global CSS, and the sample components.
2. Extract the tokens — colors, font families and scale, spacing, border radii, shadows, button/input/card styles — into this project's theme so both apps share the same values.
3. Reuse SpokenFor's component patterns wherever an equivalent exists: cards, stat blocks, tables, forms, banners, nav. Build new components only for concepts SpokenFor doesn't have (milestone banner, floor staircase, VOO race), and build those FROM the inherited tokens.
4. When anything in this file conflicts with what the SpokenFor reference shows, **SpokenFor wins.** This document defers to the family look on all visual questions.

### Setup (owner task, one time)
Copy into `/design-reference` from the SpokenFor repo: `tailwind.config.*` (or the theme/tokens file), the global stylesheet(s), and 3–5 representative components — ideally the dashboard stat display (the Current Balance / Spoken For / Not Spoken For blocks), the forecast timeline table, a form, and a primary button/CTA. These are reference copies, read-only; never import from them directly.

## What carries over conceptually from SpokenFor

SpokenFor's signature is **one big honest number with supporting numbers beneath it** (Not Spoken For, flanked by Current Balance and Spoken For). This app has the exact same shape: **Total Score**, flanked by account value / banked floors / tax reserved. Render it with the same stat-block pattern.

Likewise, SpokenFor's forecast timeline (dated rows, running balance beside each) is the visual grammar for this app's Cash Ledger and Trade Log: dated rows, running figures, flagged special rows (lowest point → milestone hit).

## Non-negotiables (the anti-generic clause)

- No cookie-cutter output. If a screen would look at home in a CRUD tutorial, redesign it using the family system.
- Production-worthy at every commit: real empty states, loading states, and error states on every screen from the first version. Match how SpokenFor handles these if the reference shows it.
- Numbers are the heroes: tabular figures for all money values, money right-aligned in tables, labels small and muted. Hero numbers at display scale.

## Signature moments (where the drama budget goes)

Same moments as before, now rendered in the family style:

- **Total Score on the Dashboard** — the SpokenFor stat-block pattern, biggest element on any screen.
- **Milestone hit** — the app's championship moment: a full-width banner in the family's alert/emphasis styling with the exact skim amount ("BANK $25,000 NOW"), persistent until the banking event is recorded. The one place animation is encouraged.
- **Banked floors** — a filled step/staircase visualization climbing toward $1M, built from family colors; the floor only rises.
- **The VOO race** — a simple You-vs-Shadow comparison (two-line chart or head-to-head bars), lead legible at a glance.

## Component and interaction standards

- Tables: sticky headers, hover row highlight, right-aligned tabular numbers. Sorting where useful (Positions by unrealized %, Parked Pile by days-to-unlock). Timeline-style rows follow SpokenFor's forecast table pattern.
- Forms: inline validation in the family style; the Positions form visibly enforces the exit-target/bail-point rule.
- Alerts/badges: reuse SpokenFor's badge/pill treatment (its "Charged"/"Reserved"/"Lowest point" row flags are the model). Wash-sale warnings appear at the moment of entry.
- Timestamps wherever prices appear ("prices as of 4:02 PM").
- Responsive: desktop-first, fully usable on a phone; tables collapse to cards on narrow viewports, matching SpokenFor's mobile behavior.

## Voice and microcopy

- SpokenFor's voice is the model: plain, confident, slightly wry, anti-jargon ("Your bank balance is lying to you"). This app speaks the same way, in the strategy's vocabulary: "banked," "the floor," "everything rides," "funding unlocked," "the honest test."
- $1M is always labeled "aspiration." Success language centers Total Score.
- After any closed trade with |gain| > 25% and after any milestone banking, surface a quiet link: "Read the rules."

## What to avoid

- Inventing a second design language. Any color, font, radius, or shadow not traceable to the SpokenFor reference needs a reason.
- Light-gray admin-template defaults, untouched component-library styling, emoji in UI chrome, rainbow chart palettes, anything resembling a generic dashboard template.


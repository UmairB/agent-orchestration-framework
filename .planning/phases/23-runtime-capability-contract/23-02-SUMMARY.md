---
phase: 23
plan: 2
type: summary
wave: 2
name: "Apply/render hard gate and BDD coverage"
status: complete
completed: 2026-05-12
---

# Phase 23 Wave 2 Summary: Apply/Render Hard Gate And BDD Coverage

## Completed

- Added apply preflight validation so invalid configs fail before render planning, generated writes, or lock updates.
- Added a defensive render guard that prevents direct Codex command rendering if validation is bypassed.
- Updated render-plan coverage for stale `.codex/commands/*` cleanup after source config correction, including drift protection.
- Added Node BDD and PowerShell parity scenarios for Codex command rejection, apply-time no-write behavior, Claude-only command rendering, and simple argument marker rejection.
- Updated README guidance so commands are documented as Claude-only and Codex behavior is authored as explicit skills.

## Requirements

- RTS-01, RTS-02, RTS-03: covered.
- SIMPLE-01, SIMPLE-02, SIMPLE-03: covered.

## Verification

- `npm run test:unit` passed.
- `npm test` passed.
- `npm run test:integration:ps` passed. The PowerShell run still prints an environment profile warning for missing `posh-git`, but exits successfully.

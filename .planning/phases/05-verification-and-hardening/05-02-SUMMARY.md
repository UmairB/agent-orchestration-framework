---
phase: 5
plan: 2
status: complete
completed: 2026-05-07
---

# Phase 5 Wave 2 Summary: Setup UI Request Hardening And Cross-Platform UI Build Wrapper

## Implemented

- Centralized setup UI JSON error responses in `src/setup-ui.mjs`.
- Added JSON body parsing that distinguishes malformed JSON, empty JSON, oversized bodies, and request failures.
- Hardened config resource routes with URL kind/id validation and route/payload mismatch rejection.
- Kept and hardened old `GET/POST /api/items` catalog endpoints with practical v1 validation.
- Hardened static path resolution for traversal and invalid percent-encoding.
- Expanded setup UI API/static tests in `test/setup-ui.test.mjs`.
- Added `scripts/ui-build.mjs` to run TypeScript and Vite through Node entry points.
- Updated root `package.json` so `npm run ui:build` uses the wrapper and `npm run check` uses `scripts/check.mjs` to run tests, child-process smoke, and UI build without nested npm shim calls.
- Updated README with setup UI hardening posture, compatibility notes, smoke test, UI build wrapper, direct fallback commands, and full check command.

## Browser Smoke

- Browser smoke remains optional for final verification. API-level server tests plus UI build are the fallback evidence if browser tooling is unavailable.

## Verification

- `npm run test:unit` — passed.
- `npm test` — passed.
- `npm run ui:build` — passed.
- `npm run check` — passed.
- Final full command sweep recorded in `05-VERIFICATION.md`.

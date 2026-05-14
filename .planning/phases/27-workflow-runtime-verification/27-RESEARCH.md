# Phase 27 Research: Verification Surface

**Date:** 2026-05-14
**Status:** Complete

## Existing Coverage

- Phase 23 added BDD coverage for Codex command rejection and Claude-only command rendering.
- Phase 24 added BDD coverage for workflow-backed Claude command and Codex skill wrappers.
- Phase 25 added BDD coverage for valid and invalid `{{skills.*}}` and `{{workflows.*}}` references.
- Phase 26 added setup UI API BDD coverage for workflow-backed resource saves.

## Verification Strategy

- Use a disposable project with source `.aof/` files that resemble the GSD audit milestone shape.
- Validate and apply through the real CLI.
- Inspect generated Claude command, Codex skill, and Codex workflow files for runtime-specific paths.
- Run the repo-wide `npm run check` gate plus PowerShell parity.

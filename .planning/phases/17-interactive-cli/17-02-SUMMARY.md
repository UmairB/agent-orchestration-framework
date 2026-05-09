# Phase 17 Plan 17-02 Summary: Interactive Asset Creation Flow

**Completed:** 2026-05-09

## Changes

- Added `aof add` wizard support for project skill, command, agent, and rule assets.
- Added `aof global add` wizard support for global skill, agent, and rule assets.
- Prompted for asset kind, id, runtimes, description, and optional initial body.
- Preserved explicit command forms such as `aof add skill code-review --codex`.
- Added deterministic `AOF_TEST_RESOURCE_INPUT` coverage for prompt and BDD tests.

## Verification

- `npm run test:unit`
- `npm test`
- `npm run test:integration:ps`

---
phase: 6
plan: 2
subsystem: cli-scaffold
tags:
  - cli
  - scaffold
  - bdd
key-files:
  created:
    - src/scaffold.mjs
    - .planning/phases/06-cli-lifecycle-commands/06-02-SUMMARY.md
  modified:
    - src/cli.mjs
    - test/integration/cli.feature
requirements-completed:
  - CLI-05
completed: 2026-05-07
---

# Phase 6 Plan 2: File-Backed Scaffold Command Summary

`aof add` now scaffolds file-backed `.aof/` source assets and updates `.aof/aof.config.json` through a script-friendly command surface.

## What Changed

- Added `src/scaffold.mjs` for reusable scaffold behavior.
- Added `aof add <kind> <id>` routing.
- Generated minimal built-in skeletons for `skill`, `command`, `agent`, and `rule`.
- Wrote scaffolded bodies to `.aof/assets/<plural>/<id>/<BODYFILE>`.
- Updated `.aof/aof.config.json` with file-backed resource metadata.
- Preserved existing config packages/items/runtimes and unrelated fields where practical.
- Added collision protection for existing config resources and asset files.
- Added `--force` replacement behavior for same kind/id scaffold collisions.
- Added BDD scenarios for skill scaffolding, collision failure/force replacement, and rule scaffolding.

## Verification

| Command | Result |
|---------|--------|
| `npm run test:unit` | Passed |
| `npm test` | Passed |

## Deviations from Plan

The plan listed `src/config-editor.mjs` as a possible modified file. The implementation reused existing model/path behavior and did not need to change that file.

## Self-Check: PASSED

- `aof add <kind> <id>` creates source files under `.aof/assets/...`.
- Config entries use file-backed `path` metadata rather than inline body text.
- Missing required arguments fail with usage guidance.
- Collisions fail by default.
- `--force` replacement is covered.


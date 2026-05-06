---
phase: 01-aof-workspace-model
plan: 03
subsystem: runtime-guidance
tags: [claude, codex, rules, agents-md, docs, bdd]
requires:
  - phase: 01-aof-workspace-model
    provides: "Central asset model and runtime capability table"
provides:
  - "Claude .claude/rules/*.md guidance mapping"
  - "Codex AGENTS.md guidance mapping"
  - "Documentation for .aof workspace and runtime rule distinction"
affects: [phase-2-rendering, phase-4-ui]
tech-stack:
  added: []
  patterns:
    - "Natural-language rule guidance is separate from Codex execution-policy rules"
key-files:
  created: []
  modified: [src/adapters.mjs, README.md, test/adapters.test.mjs, test/integration/cli.feature, test/integration/cli.mjs]
key-decisions:
  - "Claude rule assets render to .claude/rules/*.md"
  - "Codex rule assets render to AGENTS.md or nested AGENTS.md"
  - "Codex .codex/rules/*.rules remains a separate future execution-policy asset type"
patterns-established:
  - "Runtime guidance mapping is verified through BDD and unit tests"
requirements-completed: [WORK-01, WORK-02, ASST-01, ASST-02, ASST-03, ASST-04, ASST-05, RTOV-01, RTOV-02, RTOV-03]
duration: 55min
completed: 2026-05-06
---

# Phase 1 Plan 03: Rule Mapping And Documentation Summary

**Claude rules and Codex AGENTS guidance mapping with `.aof` workspace documentation**

## Performance

- **Duration:** 55 min
- **Started:** 2026-05-06T15:39:30+01:00
- **Completed:** 2026-05-06T16:34:43+01:00
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Updated adapter rendering so shared `rule` assets render to Claude `.claude/rules/<id>.md`.
- Updated Codex `rule` handling so natural-language guidance renders to `AGENTS.md` or nested `AGENTS.md`, not `.codex/rules/*.rules`.
- Updated README to document `.aof/aof.config.json`, `.aof/aof.lock.json`, assets, runtime overrides, `aof migrate`, and BDD expectations.
- Added BDD coverage proving Claude/Codex rule mapping and the Codex execution-policy distinction.

## Task Commits

1. **Rule mapping, docs, and verification coverage** - `381234c` (feat)

**Plan metadata:** included in this summary commit.

## Files Created/Modified

- `src/adapters.mjs` - Runtime-aware `rule` output paths and content rendering.
- `README.md` - `.aof` workspace, migration, overrides, and rule docs.
- `test/adapters.test.mjs` - Unit coverage for rule guidance rendering.
- `test/integration/cli.feature` - BDD coverage for rule runtime behavior.
- `test/integration/cli.mjs` - `.aof rule config` fixture.

## Decisions Made

None beyond the decisions already locked in `01-CONTEXT.md`.

## Deviations from Plan

The implementation was committed as one cohesive Phase 1 implementation commit. No behavioral deviations from the plan.

**Total deviations:** 1 protocol deviation.
**Impact on plan:** No functional impact.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The runtime guidance model is ready for Phase 2 rendering and lock-state expansion.

---
*Phase: 01-aof-workspace-model*
*Completed: 2026-05-06*

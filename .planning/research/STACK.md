# Stack Research: v1.8 AOF Boards Dogfood UAT

**Project:** AOF
**Domain:** Local developer-tool task boards backed by GSD planning state
**Researched:** 2026-05-18
**Confidence:** HIGH for local implementation, MEDIUM for UAT risk prioritization

## Current Stack

No new dependency is required for this milestone. The dogfood pass should use the existing AOF stack and treat dependency changes as out of scope unless a confirmed UAT failure cannot be fixed without one.

| Area | Current implementation | v1.8 use |
|------|------------------------|----------|
| CLI | Node.js 20+ ESM in `src/cli.mjs` | Exercise every `aof boards` command involved in real milestone work. |
| Board state | Canonical JSON under `.aof/boards/<id>/` | Keep the live `coordination` board as project state. |
| Board index | Generated `.aof/cache/boards/index.json` | Rebuild and validate stale-cache behavior during UAT. |
| GSD backend | `src/backends/gsd-backend.mjs` over `src/gsd-sdk-adapter.mjs` | Attach v1.8 roadmap, assert milestone binding, sync phases to tasks, and run safe assignments. |
| Runtime fallback | `src/gsd-runtime-fallback.mjs` | Validate labels and failure behavior when runtime handoff is needed. |
| Board execution | `src/board-execution.mjs` calling SDK `runPhase()` | Exercise through a safe phase task or fixture-style update when a live run would be too risky. |
| Setup UI API | `src/setup-ui.mjs` board endpoints | Verify board create/show/sync/repair/task/assignment/execution flows through HTTP. |
| Frontend | React/Vite `ui/src/main.tsx` with board mode | Use `aof boards ui` to inspect real board usability and state clarity. |
| Tests | `test/boards.test.mjs`, `test/integration/features/boards.feature`, setup UI tests | Add regression coverage for every confirmed UAT failure. |

## Stack Additions

Recommended: none.

Potential additions should be rejected unless tied to a hard finding:

- Browser automation is useful for visual UAT, but the milestone can start with API-level UI checks and targeted manual inspection.
- Additional persistence is out of scope; file-backed board state is the product contract being tested.
- New package installs are out of scope under supply-chain rules unless explicitly approved.

## Integration Points

1. `aof boards create coordination ...` has already produced `.aof/boards/coordination/BOARD.json` with GSD execution provider, Codex runtime, and pending milestone attachment.
2. The new v1.8 roadmap must be attached with `aof boards milestone attach coordination --milestone v1.8 --roadmap .planning/ROADMAP.md`.
3. Sync must run with the explicit milestone argument: `aof boards sync coordination --milestone v1.8`.
4. UI and CLI must agree on board state, task counts, binding status, execution status, and next actions.
5. Confirmed failures should land in source/tests, not only in planning notes.

## What Not To Add

- Do not add a separate task backend for v1.8. The point is to validate the real GSD backend.
- Do not create disposable shadow board state. The user chose a real board.
- Do not widen runtime scope beyond Claude Code and Codex.
- Do not make the UI execute unrelated asset/package actions.

## Sources

- `src/boards.mjs`
- `src/cli.mjs`
- `src/board-execution.mjs`
- `src/gsd-runtime-fallback.mjs`
- `src/setup-ui.mjs`
- `ui/src/main.tsx`
- `test/boards.test.mjs`
- `test/integration/features/boards.feature`
- `.aof/boards/coordination/BOARD.json`

---
*Research completed: 2026-05-18*

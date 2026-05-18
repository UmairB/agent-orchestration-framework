# Architecture Research: v1.8 AOF Boards Dogfood UAT

**Domain:** File-backed local board management with typed GSD integration
**Researched:** 2026-05-18
**Confidence:** HIGH

## Current Architecture

The board feature is organized as a thin CLI/UI layer over canonical file state and a small backend abstraction. This milestone should validate that architecture under real use rather than adding a new architecture path.

## Major Components

1. **Canonical board state** — `.aof/boards/<id>/BOARD.json`, task JSON, execution JSON.
2. **Board domain module** — `src/boards.mjs` owns create, attach, sync, repair, doctor, validation, and index behavior.
3. **Execution module** — `src/board-execution.mjs` owns agent discovery, phase assignment, `runPhase()` calls, execution records, and task execution summaries.
4. **Backend seam** — `src/backends/gsd-backend.mjs` adapts typed SDK calls for state, roadmap, milestone assertion, sync, and assignment capability.
5. **Runtime fallback** — `src/gsd-runtime-fallback.mjs` exists only for interactive milestone continuation when typed state is not enough.
6. **CLI surface** — `src/cli.mjs` exposes `aof boards ...` command flows and structured JSON errors.
7. **Setup UI API and frontend** — `src/setup-ui.mjs` exposes board HTTP routes; `ui/src/main.tsx` provides board mode UI.
8. **Planning bridge** — `.aof/skills/aof-board-milestone-bridge` is injected for the roadmapper so the real board can be attached/synced after roadmap creation.

## Data Flow

```text
User confirms milestone
  -> GSD writes .planning/PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md
  -> roadmapper bridge attaches .aof/boards/coordination to v1.8
  -> aof boards sync coordination --milestone v1.8 creates phase tasks
  -> CLI/UI update canonical task state
  -> assignment writes execution JSON and updates task summary
  -> doctor/validate/index confirm state health
```

## Existing Live State

The live board currently exists:

- Board id: `coordination`
- Objective: `Plan a coordinated milestone`
- Execution provider: `gsd`
- Runtime: `codex`
- Milestone status: `waiting_for_user`
- Binding: `pending-attachment`
- Sync command: `aof boards sync coordination`

This is an ideal v1.8 dogfood anchor. The roadmap should include a phase that attaches this board to v1.8 and syncs it after roadmap approval.

## Build Order Implications

1. Define requirements and roadmap first; sync cannot be meaningful until phases exist.
2. Attach the live board to `v1.8` after roadmap approval.
3. Sync the live board and validate generated phase tasks.
4. Use CLI and UI on the synced board.
5. Exercise assignment/execution on a safe phase task or bounded run.
6. Fix confirmed issues and add regression coverage.
7. Close with a UAT log and verification matrix.

## Architecture Checks For v1.8

- Board sync must never silently use the wrong milestone.
- The UI must not hide the distinction between pending, attached, synced, drift, and error binding states.
- `aof boards doctor --json` should expose enough structured information to script UAT assertions.
- Runtime fallback output must remain clearly labeled as fallback.
- The internal bridge skill must remain internal and not be rendered as a normal AOF asset.

## Sources

- `src/boards.mjs`
- `src/backends/gsd-backend.mjs`
- `src/board-execution.mjs`
- `src/gsd-runtime-fallback.mjs`
- `src/cli.mjs`
- `src/setup-ui.mjs`
- `ui/src/main.tsx`
- `.aof/boards/coordination/BOARD.json`

---
*Architecture research completed: 2026-05-18*

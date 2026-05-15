# Phase 30 Research: Agent Assignment And Execution

## Existing Surface

- Board state is stored under `.aof/boards/<board-id>/`.
- Board tasks are canonical JSON files under `.aof/boards/<board-id>/tasks/<task-id>.json`.
- Board indexes are rebuildable cache data under `.aof/cache/boards/index.json`.
- Objective breakdown already creates tasks with `refs` metadata, including phase references.
- The setup UI server exposes board creation, task creation, status movement, validation, and index rebuild APIs.
- CLI board commands are grouped under `aof boards`.

## Required Model

Phase 30 needs execution state without coupling board state directly to GSD internals. The v1 provider is GSD, but task state should remain provider-neutral enough to swap execution frameworks later.

Use:

- `assignedAgent` on task JSON for compact assignment state.
- `execution` on task JSON for compact current execution state.
- `.aof/boards/<board-id>/executions/<task-id>.json` for detailed execution records, attempts, logs, provider refs, handoff context, and resume pointers.

## Provider Boundary

The GSD provider should translate a task phase reference into the expected ceremony sequence:

- `$gsd-discuss-phase <phase>`
- `$gsd-plan-phase <phase>`
- `$gsd-execute-phase <phase>`

Phase 30 should not try to run an interactive GSD session inside tests. The start operation can create a durable execution attempt and command log that marks the workflow as started. Lifecycle updates can then move execution through `waiting_for_user`, `blocked`, `failed`, or `complete`.

## Validation

Assignment must:

- Load available agents from `.aof/aof.config.json`.
- Reject unknown agents.
- Require a phase reference for the GSD provider.
- Move board task status to `in_progress` while execution is queued/running/waiting.
- Move board task status to `blocked` when execution is failed or blocked.
- Move board task status to `done` when execution is complete.

## UI Contract

Phase 30 should expose data and APIs that allow Phase 31 to stream or poll console state:

- list agents
- assign task
- read execution record
- update execution status/log context

The UI does not need full streaming transport in this phase; it needs stable file/API state to consume.

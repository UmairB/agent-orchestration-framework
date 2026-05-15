# Phase 28 Wave 1 Summary: Board/task Schema And Canonical File Layout

## Status

Completed on 2026-05-15.

## Delivered

- Added `src/boards.mjs` as the shared canonical board/task state module.
- Stored boards under `.aof/boards/<board-id>/BOARD.json`.
- Stored tasks under `.aof/boards/<board-id>/tasks/<task-id>.json`.
- Added fixed board lifecycle statuses: `backlog`, `ready`, `in_progress`, `blocked`, and `done`.
- Added board create/list/show/archive and task add/move operations.
- Added task history for creation and status changes.

## Verification

- Covered by `npm run test:unit`.
- Reverified by `npm test`, `npm run test:integration:ps`, and `npm run check`.

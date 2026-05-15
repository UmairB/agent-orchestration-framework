---
phase: 29
name: "GSD Objective Breakdown"
type: research
status: completed
autonomous: true
---

# Phase 29 Research: GSD Objective Breakdown

## Existing Foundation

- Phase 28 added `src/boards.mjs` with canonical board/task state under `.aof/boards`.
- `addTask()` already supports structured `refs`, so generated tasks can retain objective and artifact provenance.
- CLI board commands are routed under `aof boards ...`, making `aof boards breakdown ...` the least surprising namespace.
- Setup UI board APIs are backend-only in Phase 28; Phase 29 can remain CLI-first and let Phase 31 expose this visually later.

## Proposed Model

```text
.aof/boards/<board-id>/
  proposals/
    <proposal-id>.json
```

Proposal fields:

- `id`
- `boardId`
- `objective`
- `status`: `proposed` or `applied`
- `refreshOf`
- `tasks[]`: generated task drafts
- `refs`: source objective and planning artifact references
- timestamps

## CLI Contract

- `aof boards breakdown <board-id> --objective <text>`
- `aof boards breakdown show <board-id> <proposal-id>`
- `aof boards breakdown apply <board-id> <proposal-id>`
- `aof boards breakdown refresh <board-id> <proposal-id> [--objective <text>]`

## Risk Notes

- The implementation should not claim deep AI planning. The deterministic breakdown is a local GSD-style task scaffold that can be replaced by richer GSD integration later.
- Collision protection matters more than clever generation. Silent overwrite would break GSD-04.

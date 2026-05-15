# Phase 28: Board And Task State Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 28-board-and-task-state-foundation
**Areas discussed:** Task file layout, Lifecycle model, Index/cache contract, CLI/API surface, Links to GSD artifacts, Archival/removal semantics

---

## Task File Layout

| Option | Description | Selected |
|--------|-------------|----------|
| `.planning/boards/` | Board files and task files under GSD planning state. | |
| `.aof/tasks/` or `.aof/boards/` | Treat task management as AOF product state, separate from GSD planning artifacts. | ✓ |
| Hybrid planning canonical plus AOF cache | Canonical boards/tasks in `.planning/boards/`, generated AOF-facing index under `.aof/cache/tasks/`. | |
| Something else | Freeform alternative. | |

**User's choice:** `.aof/boards`.
**Notes:** User clarified that `.planning` is for GSD and AOF should not interfere with its structure.

---

## Lifecycle Model

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed default columns | `backlog`, `ready`, `in_progress`, `blocked`, `done`. | ✓ |
| Per-board configurable columns | Each board defines its own columns. | |
| Fixed defaults plus optional display labels | Stable internal statuses with board-specific labels. | |
| Something else | Freeform alternative. | |

**User's choice:** Fixed default columns.
**Notes:** Stable statuses support later execution and UI progress behavior.

---

## Index/cache Contract

| Option | Description | Selected |
|--------|-------------|----------|
| `.aof/cache/boards/index.json`, stale is blocking | Validation fails when cache is stale. | |
| `.aof/cache/boards/index.json`, stale is warning-only | Cache is generated and rebuildable; canonical files remain usable. | ✓ |
| No persisted index in Phase 28 | Build an in-memory index on every API call. | |
| Something else | Freeform alternative. | |

**User's choice:** Generated index with stale warning-only.
**Notes:** Avoids false blockers during early UAT while preserving canonical file correctness.

---

## CLI/API Surface

| Option | Description | Selected |
|--------|-------------|----------|
| New `aof boards ...` namespace | Board-centered commands with tasks nested under boards. | ✓ |
| New `aof tasks ...` namespace | Task-centered commands with boards as filter/grouping. | |
| Setup UI API only in Phase 28 | Defer CLI until later. | |
| Under `aof project ...` | Treat boards as project metadata. | |

**User's choice:** New `aof boards ...` namespace.
**Notes:** Boards are the product object; tasks hang off boards.

---

## Links To GSD Artifacts

| Option | Description | Selected |
|--------|-------------|----------|
| Structured optional refs | Task metadata can include refs like roadmap phase, plan file, requirement IDs, source objective ID. | |
| Freeform links only | Labels and paths without semantic validation. | |
| No GSD links in Phase 28 | Defer all artifact linkage to Phase 29. | |
| Structured refs plus GSD integration investigation | Use structured refs and investigate GSD skills/hooks before execution integration. | ✓ |

**User's choice:** Structured refs plus GSD integration investigation.
**Notes:** User pointed to GSD configuration docs. We checked that GSD documents `agent_skills` and hook toggles, but not a generic custom lifecycle-hook API. User concluded skills look like the right extension point.

---

## Archival/removal Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Archive board, preserve task history | Board disappears from active views, but canonical history remains. | ✓ |
| Delete only empty boards | Non-empty boards must be archived. | |
| Hard delete allowed with `--force` | Explicit destructive removal. | |
| Archive non-empty boards; delete empty boards | Preserve history where it matters, cleanup empty boards. | |

**User's choice:** Archive board, preserve task history.
**Notes:** Phase 28 should avoid destructive board deletion as the normal path.

---

## the agent's Discretion

- Exact board/task JSON shape under `.aof/boards`.
- Exact diagnostic code names.
- Exact setup UI API route names.
- Exact `aof boards index` flag behavior, as long as stale cache is warning-only.

## Deferred Ideas

- Objective breakdown, automatic execution, full UI, global sync, SQLite canonical storage, custom board columns, and configurable execution policy remain later-phase or future scope.

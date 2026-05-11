# Phase 21: Project And Diagnostics Commands - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 21-Project And Diagnostics Commands
**Areas discussed:** Project Meaning, Command Scope, Catalog Boundary

---

## Project Meaning

| Option | Description | Selected |
|--------|-------------|----------|
| Config namespace | Keep `aof config ...` as the user-facing name for inspection and diagnostics. | |
| Project namespace | Use `aof project ...` for the current repository's AOF workspace, config, lock, migration, and health. | yes |

**Notes:** The user asked what "project" means. We clarified that it means the current repository's AOF setup and health, distinct from `assets` and `packages`. The user agreed with this framing.

---

## Command Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Keep top-level diagnostics | Leave `aof validate`, `aof doctor`, and `aof migrate` executable. | |
| Full project namespace migration | Move project inspection, validation, diagnostics, and migration to `aof project ...`; keep only `aof init` top-level. | yes |

**Notes:** Phase 18 already locked the no-legacy-alias direction. Phase 21 should implement the accepted project namespace in one pass.

---

## Catalog Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Reintroduce catalog commands | Restore catalog-backed commands or discovery behavior now. | |
| Keep catalog removed | Keep catalog disabled until a coherent catalog product path is intentionally designed. | yes |

**Notes:** Catalog commands must have no SQLite side effects. Project/global `.aof` source assets are the active source model.

---

## the agent's Discretion

- Planner may decide implementation wave boundaries.
- Planner may decide internal helper extraction strategy.
- Planner must preserve externally visible behavior required by the Phase 18 CLI and BDD contracts.

## Deferred Ideas

- Live repository verification remains Phase 22.
- Catalog/SQLite-backed discovery remains deferred.

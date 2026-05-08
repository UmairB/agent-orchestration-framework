# Phase 11: Global Library Workspace - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 11-Global Library Workspace
**Areas discussed:** Global Home Shape, CLI Command Shape, Global Config Model, Validation Behavior

---

## Global Home Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror project workspace | Use the same shape as projects: `~/.aof/aof.config.json`, `~/.aof/assets/skills/...`, `~/.aof/assets/agents/...`, `~/.aof/assets/rules/...`. | yes |
| Global-only library shape | Use a simpler shape like `~/.aof/skills/...`, `~/.aof/agents/...`, `~/.aof/rules/...`. | |
| You decide | Let the planner choose based on reuse and migration cost. | |

**User's choice:** Mirror project workspace.
**Notes:** User selected the recommended reuse-oriented shape.

---

## CLI Command Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Use `--global` on existing commands | Examples: `aof add skill reviewer --global`, `aof validate --global`, maybe `aof list --global`. | |
| Add explicit `aof global ...` commands | Examples: `aof global add skill reviewer`, `aof global list`, `aof global validate`. | yes |
| Both, with one canonical | Support `aof global ...` as documented path and allow `--global` only where it cannot be confused. | |
| You decide | Let the planner choose the safest shape. | |

**User's choice:** Add explicit `aof global ...` commands.
**Notes:** This avoids overloading existing `--global` runtime-output semantics.

---

## Global Config Model

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, `~/.aof/aof.config.json` | Global assets are registered in a global config, just like project assets. | yes |
| No, discover files directly | AOF scans `~/.aof/assets/...` and derives assets from folders/files. | |
| Hybrid | `aof.config.json` is canonical, but commands can repair or import orphaned asset folders later. | |
| You decide | Let the planner choose. | |

**User's choice:** Yes, `~/.aof/aof.config.json`.
**Notes:** This matches the mirrored workspace decision and keeps global assets explicit.

---

## Validation Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Only when referenced by a project | Project `validate` fails only for global assets the project actually uses; `aof global validate` checks the whole global library. | yes |
| Always fail project validation | Any malformed asset in `~/.aof` fails project validation, even if unused. | |
| Warning unless referenced | Unreferenced malformed global assets show as warnings in project diagnostics; referenced malformed assets fail. | |
| You decide | Let the planner choose. | |

**User's choice:** Only when referenced by a project.
**Notes:** Keeps project validation scoped while preserving whole-library validation through `aof global validate`.

---

## the agent's Discretion

- Exact helper names, module boundaries, and command output wording.
- Exact `aof global ...` subcommand details, provided the explicit namespace is preserved.

## Deferred Ideas

- Project references, global rendering, associated helper-file rendering, and setup UI global editing are later v1.2 phases.

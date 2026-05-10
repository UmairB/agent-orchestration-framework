# Phase 18: Command Contract Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 18-Command Contract Audit
**Areas discussed:** Top-Level Commands, Assets Namespace, Packages Namespace, Removed Commands, Output And Help Contract

---

## Top-Level Commands

| Option | Description | Selected |
|--------|-------------|----------|
| Keep many top-level verbs | Preserve existing top-level commands such as `add`, `apply`, `validate`, `doctor`, and `install`. | |
| Namespace by product area | Keep `aof init` top-level and move product work under `project`, `assets`, and `packages`. | yes |
| Use `workspace` instead of `project` | Put diagnostics and migration under `aof workspace ...`. | |

**User's choice:** Namespace by product area, with `project` for project-level operations.
**Notes:** User wants AOF to do more things in the future, so command names should be namespaced now.

---

## Assets Namespace

| Option | Description | Selected |
|--------|-------------|----------|
| `aof assets add --global ...` | Treat global as a scope flag inside the assets product area. | yes |
| `aof assets global add ...` | Treat global as a sub-namespace under assets. | |
| Keep `aof global ...` | Preserve global as a top-level namespace. | |

**User's choice:** Use `--global` as a scope flag.
**Notes:** Accepted asset commands include add/list/show/remove/use/unuse/apply/validate/clean/ui. `aof assets apply` applies to configured runtimes by default.

---

## Packages Namespace

| Option | Description | Selected |
|--------|-------------|----------|
| `aof integrations ...` | Name GSD and similar tooling as integrations. | |
| `aof packages ...` | Name managed tooling/package intent as packages. | yes |
| Keep `aof install gsd` | Preserve current install command. | |

**User's choice:** Use `aof packages ...`.
**Notes:** User specifically preferred `aof packages add gsd`. Package add declares intent; package install executes installer commands.

---

## Removed Commands

| Option | Description | Selected |
|--------|-------------|----------|
| Keep legacy aliases | Preserve old commands as aliases with deprecation guidance. | |
| Full rewrite, no aliases | Removed commands do not execute. | yes |
| Hybrid compatibility | Keep aliases temporarily for some commands. | |

**User's choice:** Full rewrite with no legacy support.
**Notes:** Helpful failure text is allowed as long as removed commands do not execute or alias.

---

## Output And Help Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Syntax-only help | Show every command signature without workflow examples. | |
| Product-area help | Group by project setup, assets, packages, and diagnostics with examples. | yes |
| Minimal output | Keep success/errors terse. | |

**User's choice:** Product-area help and clear command output.
**Notes:** Success output should state what changed and the next useful command. Dry-run output should say no writes/no network where applicable.

---

## the agent's Discretion

- Exact non-controversial flag spelling can be settled during planning if it preserves accepted semantics.
- Planner should derive BDD coverage from the accepted command table.

## Deferred Ideas

- Catalog/SQLite product path.
- Hosted discovery/distribution.
- UI-driven execution.

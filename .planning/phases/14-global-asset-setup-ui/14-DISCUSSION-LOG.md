# Phase 14: Global Asset Setup UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 14-Global Asset Setup UI
**Areas discussed:** Scope Switch, Global Asset Kinds, Project References, Source Labels, Associated Files, API Shape, Validation

---

## Scope Switch

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level Project / Global toggle | User explicitly switches between repo `.aof` and `~/.aof`. | yes |
| Mixed asset list | Project and global assets appear in one list with badges. | |
| Separate URL/app | Global editor is a separate UI route or process. | |

**Selected outcome:** Use a top-level Project / Global toggle.
**Notes:** Scope confusion is the main UI pitfall; a visible mode switch is safer than a mixed list.

---

## Global Asset Kinds

| Option | Description | Selected |
|--------|-------------|----------|
| Skills, agents, rules | Match v1.2 global library requirement. | yes |
| All resource kinds including commands | Let global commands be edited too. | |
| Skills only | Keep UI surface minimal for first pass. | |

**Selected outcome:** Support global skills, agents, and rules.
**Notes:** Commands can remain project-local unless they fall out naturally from generic editor reuse.

---

## Project References

| Option | Description | Selected |
|--------|-------------|----------|
| “Use in this project” action | Global asset action writes project `globalRefs`. | yes |
| Copy into project | Creates a project-local duplicate of the global asset. | |
| Manual JSON editing only | User edits `globalRefs` in raw JSON. | |

**Selected outcome:** Add a reference action that writes `globalRefs` without copying.
**Notes:** This preserves the user’s reference-first decision.

---

## Project View Labels

| Option | Description | Selected |
|--------|-------------|----------|
| Separate project-local and referenced-global sections | Referenced globals are read-only in project scope. | yes |
| Single editable list with source badges | Global references appear alongside local resources. | |
| Hide referenced globals | Only show project-local assets in setup UI. | |

**Selected outcome:** Show referenced globals separately and read-only in Project scope.
**Notes:** Remove-reference is allowed; editing global source happens in Global scope.

---

## Associated Files UI

| Option | Description | Selected |
|--------|-------------|----------|
| Basic path list plus text editor | Explicitly edit helper files for global skills. | yes |
| Directory scanner | UI discovers and adds files automatically. | |
| Binary upload/file manager | UI supports arbitrary files. | |
| No associated-file UI | Leave helper files CLI/manual only. | |

**Selected outcome:** Add basic global skill associated-file editing.
**Notes:** Keep Phase 13 safety constraints: explicit paths, text content, no scans, no symlinks.

---

## API Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit scope in route or payload | Endpoints encode `project` vs `global`. | yes |
| Separate servers | Run different setup UI instances for project and global editing. | |
| Infer from active UI state only | Client tracks scope, server remains project-only. | |

**Selected outcome:** Use explicit API scope while preserving existing project endpoints.
**Notes:** This keeps tests and future clients less ambiguous.

---

## Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Return structured diagnostics on save | Match current setup UI validation behavior. | yes |
| Save then warn | Persist invalid edits and rely on review later. | |
| Client-only validation | Avoid server validation for UI saves. | |

**Selected outcome:** Save APIs return structured diagnostics.
**Notes:** Global edits validate global config; project reference edits validate missing refs and conflicts.

---

## the agent's Discretion

- Exact route names and payload shapes.
- Exact layout of Project / Global switch and referenced-global section.
- Exact associated-file editor layout.
- Whether global command editing is omitted or left available through reused internals but hidden from the primary UI.

## Deferred Ideas

- UI execution of CLI commands.
- Global command editing as a committed user-facing scope.
- Binary associated files.
- Implicit associated-file discovery.
- Project overrides or vendoring of global assets.


# Phase 12: Project Reference Rendering - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 12-Project Reference Rendering
**Areas discussed:** Reference Syntax, Ownership, Conflict Policy, Rendering And Lock Scope

---

## Reference Syntax

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level `globalRefs` | Project config lists global references separately from local resources, e.g. `{ "kind": "skill", "id": "shared-review" }`. | yes |
| `resources[].source = "global"` | Put references inside `resources` as resource entries that point to global source. | |
| String shorthand | Use entries like `"skill:shared-review"` or `"shared-review"`. | |
| Copy full resource | Copy global resource metadata into project `resources`. | |

**Selected outcome:** Use top-level `globalRefs`.
**Notes:** This preserves a clean source boundary and avoids confusing local source assets with references.

---

## Ownership And Overrides

| Option | Description | Selected |
|--------|-------------|----------|
| Global asset owns body and overrides | Project only references the asset; global runtime overrides apply. | yes |
| Project may override referenced global assets immediately | Add project-local override semantics for global references in Phase 12. | |
| Copy-on-reference | Create a local editable snapshot when the project adds a global asset. | |

**Selected outcome:** Global asset owns body and overrides for Phase 12.
**Notes:** Project-local customization of global assets is useful later, but it needs explicit ownership rules.

---

## Conflict Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Error on local/global same `kind:id` | Require the user to rename or remove one source. | yes |
| Local wins | Render local resources over global references silently. | |
| Global wins | Render global references over local resources silently. | |
| Runtime-specific precedence | Decide by runtime target. | |

**Selected outcome:** Error on local/global same `kind:id`.
**Notes:** Silent precedence would make generated output hard to audit.

---

## Missing Or Broken Global References

| Option | Description | Selected |
|--------|-------------|----------|
| Only referenced global assets affect project validation | Missing or malformed referenced assets fail; unrelated global drafts do not. | yes |
| Whole global library affects project validation | Any malformed global asset fails every project. | |
| Warnings for missing references | Project validation succeeds but warns. | |

**Selected outcome:** Only referenced global assets affect project validation.
**Notes:** Carries forward the Phase 11 validation boundary.

---

## Rendering And Lock Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve global source metadata through render planning | Lock entries record global source scope and identity. | yes |
| Flatten global assets into local resources before rendering | Simpler render path, but loses source scope unless restored later. | |
| Store source scope only in diagnostics | Generated files render, but lock state remains ambiguous. | |

**Selected outcome:** Preserve global source metadata through render planning.
**Notes:** This directly satisfies lock traceability and keeps diagnostics explainable.

---

## the agent's Discretion

- Exact resolver module name and helper boundaries.
- Exact JSON field names inside lock resource metadata, provided `scope: "global"` or equivalent is stable.
- Exact human output wording for diagnostics and inspection.

## Deferred Ideas

- Project-local overrides for global references.
- Global reference version pins.
- Vendoring/copy workflows.
- Associated helper-file rendering.
- Setup UI reference controls.

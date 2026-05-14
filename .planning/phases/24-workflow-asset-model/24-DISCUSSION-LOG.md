# Phase 24: Workflow Asset Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 24-Workflow Asset Model
**Areas discussed:** workflow declaration, source layout, generated runtime paths, wrapper binding, wrapper body defaults, argument metadata, validation strictness, global workflows

---

## Discussion Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| All areas | Covers the full workflow asset contract so planning has enough direction. | ✓ |
| Core only | Discuss workflow declaration and wrapper binding, leaving arguments mostly to planning. | |
| Arguments only | Focus on workflow-backed argument metadata and runtime-specific behavior. | |

**User's choice:** all
**Notes:** User wanted the complete workflow model discussed before context was written.

---

## Workflow Declaration

| Option | Description | Selected |
|--------|-------------|----------|
| New `workflows` section | Top-level `workflows: [{ id, path, runtimes }]`; clean separation from simple resources. | ✓ |
| New resource kind | `resources: [{ kind: "workflow", id, path }]`; reuses resource validation/rendering shape. | |
| Wrapper-local workflow file | Commands/skills point at workflow path directly without first-class declaration. | |

**User's choice:** New `workflows` section.
**Notes:** Keeps workflows distinct from directly invoked assets.

---

## Workflow Source Layout

| Option | Description | Selected |
|--------|-------------|----------|
| `.aof/workflows/<id>.md` | Flat and direct. | |
| `.aof/assets/workflows/<id>/WORKFLOW.md` | Mirrors current asset directories and leaves room for associated files later. | ✓ |
| `.aof/workflows/<id>/WORKFLOW.md` | Separate from assets, but still gives each workflow a folder. | |

**User's choice:** `.aof/assets/workflows/<id>/WORKFLOW.md`.
**Notes:** Aligns with existing file-backed asset organization.

---

## Generated Runtime Paths

| Option | Description | Selected |
|--------|-------------|----------|
| Runtime workflow namespace | `.claude/workflows/<id>.md` and `.codex/workflows/<id>.md`. | |
| GSD-style package namespace | `.claude/get-shit-done/workflows/<id>.md` and `.codex/get-shit-done/workflows/<id>.md`. | |
| AOF-owned runtime namespace | `.claude/aof/workflows/<id>.md` and `.codex/aof/workflows/<id>.md`. | ✓ |

**User's choice:** AOF-owned runtime namespace.
**Notes:** User initially selected bare runtime workflow namespace, then corrected it to `.claude/aof/workflows`, etc. This makes generated workflow ownership explicit and avoids implying native runtime workflow support.

---

## Wrapper Binding

| Option | Description | Selected |
|--------|-------------|----------|
| `workflow: "<id>"` | Concise binding on the wrapper asset. | ✓ |
| `workflowRef: "<id>"` | More explicit reference naming. | |
| Body placeholder only | Infer binding from `{{workflows.<id>}}` in body. | |

**User's choice:** `workflow: "<id>"`.
**Notes:** Placeholder expansion remains separate from the binding model.

---

## Wrapper Body Model

| Option | Description | Selected |
|--------|-------------|----------|
| Wrapper body remains explicit | User writes the Claude command body or Codex skill body. | |
| AOF auto-generates wrapper body | Body becomes optional and AOF writes standard workflow guidance. | |
| Hybrid | Body optional; generated default when absent, explicit body wins. | ✓ |

**User's choice:** Hybrid.
**Notes:** Supports quick setup and runtime-specific customization.

---

## Workflow-Backed Arguments

| Option | Description | Selected |
|--------|-------------|----------|
| On the workflow | Workflow owns the argument schema and wrappers inherit it. | |
| On the wrapper asset | Each command/skill owns its own argument contract. | |
| Both, with wrapper override | Workflow defines shared args; wrapper customizes runtime-facing presentation. | ✓ |

**User's choice:** Both, with wrapper override.
**Notes:** Shared workflow owns logical inputs; wrappers can adapt wording for Claude/Codex.

---

## Argument Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single freeform argument string | Equivalent to `$ARGUMENTS` / `{{GSD_ARGS}}`. | |
| Named argument list | `arguments: [{ name, description, required }]`. | |
| Both | `argumentHint` plus optional named args. | ✓ |

**User's choice:** Both.
**Notes:** AOF should render argument metadata/guidance but not parse or execute invocation arguments.

---

## Validation Strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Strict workflow reference only | `workflow` must point to an existing workflow that targets the wrapper runtime. | |
| Strict plus argument consistency | Also validate wrapper argument overrides only reference workflow-declared args. | ✓ |
| Loose first pass | Only check workflow exists; defer runtime/argument consistency. | |

**User's choice:** Strict plus argument consistency.
**Notes:** Validation should catch missing workflow references, runtime mismatches, and invalid argument overrides.

---

## Default Wrapper References

| Option | Description | Selected |
|--------|-------------|----------|
| Use path placeholder | Generated wrapper includes `{{workflows.<id>}}`. | |
| Use resolved runtime path directly | Generated wrapper contains `.claude/aof/workflows/<id>.md` or `.codex/aof/workflows/<id>.md`. | ✓ |
| Use semantic instruction only | Generated wrapper says to follow the shared workflow without exposing a path. | |

**User's choice:** Use resolved runtime path directly.
**Notes:** Generated output should be immediately usable by the runtime.

---

## Global Workflow Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Project-local only | Workflows live in project `.aof/`; global workflow references come later. | |
| Project + global | Global library can define workflows and projects can reference them immediately. | ✓ |
| Schema-compatible only | Design for global workflows later but do not implement global rendering yet. | |

**User's choice:** Project + global.
**Notes:** Global workflows should work through `globalRefs`, validation, rendering, source scope, and lock traceability.

---

## the agent's Discretion

- Exact names and structure for simple named argument metadata can be finalized during planning.
- Exact generated default wrapper prose can be chosen during implementation as long as it includes resolved workflow paths and runtime-appropriate argument guidance.

## Deferred Ideas

- `{{skills.<id>}}` and `{{workflows.<id>}}` placeholder expansion remains Phase 25.
- Setup UI mode controls remain Phase 26.
- Live GSD-style UAT remains Phase 27.

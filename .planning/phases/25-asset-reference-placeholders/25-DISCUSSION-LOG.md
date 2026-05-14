# Phase 25: Asset Reference Placeholders - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 25-Asset Reference Placeholders
**Areas discussed:** Placeholder Syntax Scope, Runtime Path Semantics, Reference Validation Rules, Allowed Placeholder Surfaces

---

## Placeholder Syntax Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Strict plural namespaces | Support only `{{skills.<id>}}` and `{{workflows.<id>}}`; simplest to validate and document. | ✓ |
| Alias-heavy syntax | Also support singular aliases or runtime-qualified aliases; more flexible but increases ambiguity. | |
| Agent discretion | Let the implementation choose. | ✓ |

**User's choice:** Use best judgment and sensible defaults.
**Notes:** Locked strict plural namespaces because the user previously preferred `{{skills.ci}}` and wants to avoid Codex command ambiguity.

---

## Runtime Path Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Generated file paths | Expand placeholders to `.codex/skills/<id>/SKILL.md`, `.claude/aof/workflows/<id>.md`, etc. | ✓ |
| Invocation strings | Expand to assistant invocation syntax such as slash commands or skill names. | |
| Mixed by kind | Paths for workflows, invocations for skills/commands. | |

**User's choice:** Use best judgment and sensible defaults.
**Notes:** Selected generated file paths because Phase 24 wrappers already use resolved workflow paths, and file paths are deterministic across validation/rendering.

---

## Reference Validation Rules

| Option | Description | Selected |
|--------|-------------|----------|
| Validate per effective runtime | Validate references against each runtime where the referencing text can render. | ✓ |
| Validate only during apply | Defer some failures until selected runtime apply. | |
| Warning-only | Warn for mismatches but still render. | |

**User's choice:** Use best judgment and sensible defaults.
**Notes:** Selected validation-first behavior because prior phases require apply to fail before writes for invalid config.

---

## Allowed Placeholder Surfaces

| Option | Description | Selected |
|--------|-------------|----------|
| Resource bodies and overrides | Minimal scope; covers most immediate use cases. | |
| Resource bodies, overrides, and workflow bodies | Covers workflows as shared process text without touching project docs. | ✓ |
| Every text primitive | Also include project docs and all expanded primitives. | |

**User's choice:** Use best judgment and sensible defaults.
**Notes:** Selected resource bodies, runtime overrides, and workflow bodies. Project docs remain deferred unless implementation finds a low-risk tested path.

---

## the agent's Discretion

- Exact helper/module split for placeholder extraction and rendering.
- Exact stable diagnostic code names.
- Exact BDD fixture structure.

## Deferred Ideas

- `{{commands.<id>}}`.
- Project-doc placeholder expansion unless explicitly tested in Phase 25.
- Setup UI insertion controls.
- Live UAT against GSD-style examples.


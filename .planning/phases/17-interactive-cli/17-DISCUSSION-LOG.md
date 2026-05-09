# Phase 17: Interactive CLI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 17-Interactive CLI
**Areas discussed:** Prompt Experience, Catalog Defaults, Implementation Boundary

---

## Prompt Experience

| Option | Description | Selected |
|--------|-------------|----------|
| Typed readline prompts | Keep comma-separated text input. | no |
| Keyboard-driven prompts | Arrow keys, checkbox toggles, Enter confirm. | yes |

**Selected outcome:** Create a future phase for a proper interactive CLI.

---

## Catalog Defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Built-in repo defaults | Seed project-context, prime, code-reviewer, and gsd. | no |
| Empty repo init | Project starts empty; user creates project/global assets explicitly. | yes |

**Selected outcome:** Interactive CLI must not reintroduce repo defaults.

---

## Implementation Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Do in Phase 16 hardening | Replace prompt stack immediately. | no |
| Separate Phase 17 | Plan and implement interactive CLI after hardening fix. | yes |

**Selected outcome:** Phase 17 is proposed for interactive CLI work.

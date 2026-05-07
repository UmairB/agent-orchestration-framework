# Phase 4: UI Configuration Editor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07T00:00:00+01:00
**Phase:** 4-UI Configuration Editor
**Areas discussed:** Editor shape, Asset editing flow, Runtime targets and overrides, Capability warnings, Write behavior and validation

---

## Editor Shape

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Main editor experience | Asset workspace; Config builder; JSON-adjacent | Asset workspace |
| Workspace organization | By kind tabs; Single searchable list; Project sections | By kind tabs |
| Empty selection state | Kind overview; Create form; Whole config summary | Kind overview |
| Full-project review location | Dedicated Review tab; Always-visible side panel; Modal before save | Dedicated Review tab |

**User's choice:** Asset workspace with kind tabs, kind overview empty state, and dedicated Review tab.
**Notes:** The selected path keeps editing focused while giving project-wide validation and capability visibility a clear home.

---

## Asset Editing Flow

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Kind differences | Shared editor with kind-specific fields; Separate editor per kind; Basic editor plus raw advanced fields | Shared editor with kind-specific fields |
| Body editing | Inline markdown editor; Metadata first, body drawer; File path only | Inline markdown editor |
| Kind-specific guidance | Field hints and examples; No guidance; Rich help panels | Field hints and examples |
| Duplicate/copy behavior | Create and edit only; Duplicate asset; Template from catalog | Create and edit only |

**User's choice:** Shared editor with kind-specific fields, inline markdown body editing, concise hints/examples, and create/edit only.
**Notes:** Duplicate and template creation were intentionally kept out of Phase 4 scope.

---

## Runtime Targets And Overrides

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Runtime targeting UI | Runtime checklist in the detail editor; Runtime matrix view; Review tab only | Runtime checklist in the detail editor |
| Override editing location | Per-runtime override sections; Side-by-side runtime columns; Separate override modal | Per-runtime override sections |
| Empty override behavior | Hidden until enabled; Always visible empty fields; Auto-create when edited | Hidden until enabled |
| Body override support | Yes, body override editor; Metadata overrides only; Defer body overrides | Yes, body override editor |

**User's choice:** Runtime checklist plus collapsible enabled-only override sections, including body override support.
**Notes:** Disabled/empty overrides should not be written.

---

## Capability Warnings

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Capability status display | Inline runtime badges; Validation messages only; Dedicated capability panel | Inline runtime badges |
| Mapped capability treatment | Visible caution, not an error; Treat as normal support; Require confirmation | Visible caution, not an error |
| Save behavior for unsupported/future capabilities | Block invalid saves only; Warn only, never block; Block all non-native statuses | Block invalid saves only |
| Project-wide capability summary | Review tab; Kind overview only; No project-wide summary | Review tab |

**User's choice:** Inline badges, mapped-as-caution behavior, block only invalid saves, and project-wide capability summary in Review.
**Notes:** This aligns with the central capability status model from Phase 1.

---

## Write Behavior And Validation

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Save model | Explicit Save per asset; Auto-save; Save all changes | Explicit Save per asset |
| Validation timing | Live plus save gate; On save only; Review tab only | Live plus save gate |
| Save output | Config metadata plus file-backed asset body; Single config file only; Body files only | Config metadata plus file-backed asset body |
| UI execution actions | No execution, show next commands only; Dry-run button only; Apply/install buttons | No execution, show next commands only |

**User's choice:** Explicit per-asset save, live validation plus save gate, file-backed `.aof/` writes, and no UI execution.
**Notes:** Review can show CLI next commands but must not run them.

---

## the agent's Discretion

No areas were delegated to the agent's discretion.

## Deferred Ideas

- Duplicate/copy asset behavior.
- Creating assets from catalog templates.
- UI execution of dry-run, apply, init, or install.

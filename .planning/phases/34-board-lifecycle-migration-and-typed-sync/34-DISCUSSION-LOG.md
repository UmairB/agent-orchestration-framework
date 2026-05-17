# Phase 34: Board Lifecycle Migration And Typed Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 34-Board Lifecycle Migration And Typed Sync
**Areas discussed:** Sync contract and errors, Board binding state, v1.6 migration behavior, Minimal UI display

---

## Sync Contract And Errors

| Option | Description | Selected |
|--------|-------------|----------|
| Hard fail with `MILESTONE_MISSING_ARG` | Missing `--milestone` fails with structured error and exact next command. | ✓ |
| Warn and infer only when exactly one milestone exists | More convenient but weakens the explicit contract. | |
| Agent decides | Planner chooses the strictest implementation consistent with requirements. | |

**User's choice:** Hard fail with `MILESTONE_MISSING_ARG`.
**Notes:** User then selected the recommended strict defaults for the rest of this area: SDK `RoadmapAnalysis` only, no markdown fallback, `--dry-run --json` reports `create | keep | drift` without writes, and re-sync marks `synced` only after all writes succeed.

---

## Board Binding State

| Option | Description | Selected |
|--------|-------------|----------|
| `gsd.milestone.binding.status` canonical | New code gates readiness on binding status; legacy milestone status remains compatibility/display. | ✓ |
| Keep `gsd.milestone.status` primary | Less churn but mixes runtime creation state with typed SDK binding state. | |
| Agent decides | Planner chooses least disruptive migration path. | |

**User's choice:** `gsd.milestone.binding.status` is canonical.
**Notes:** User selected recommended options for all binding questions: minimal status set, stable hash of normalized phase identity list for fingerprint, and persisted `error` state for partial sync failures.

---

## v1.6 Migration Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-bind only on exactly one strong match | Safe auto-repair using stored roadmap path or phase fingerprint. | ✓ |
| Auto-bind to current milestone if one active milestone exists | Convenient but risks wrong binding. | |
| Never auto-bind | Safest but less helpful for v1.6 upgrades. | |

**User's choice:** Auto-bind only on exactly one strong match.
**Notes:** Ambiguity includes multiple candidates, no candidate, fingerprint mismatch, or unmappable roadmap path. Validation warns for missing milestone id during deprecation; sync still hard-fails. Repair normalizes old sync commands once bound.

---

## Minimal UI Display

| Option | Description | Selected |
|--------|-------------|----------|
| Show binding status next to existing milestone status | Compact additive UI display; no new route or interaction. | ✓ |
| Replace milestone status with binding status | Cleaner but hides runtime creation state during migration. | |
| Do not change UI in Phase 34 | Smaller scope but misses roadmap UI hint. | |

**User's choice:** Show binding status next to existing milestone status.
**Notes:** User selected compact status labels for drift/error, no new setup UI routes, and no visual polish beyond utilitarian text.

---

## the agent's Discretion

- Helper structure and exact implementation decomposition are left to planning as long as the locked behavior is preserved.
- Planner may choose the smallest internal shape for binding helpers but should not introduce the Phase 35 backend seam early.

## Deferred Ideas

- Full doctor diagnostics and detailed error explanations remain Phase 38.
- BoardBackend extraction remains Phase 35.
- Runtime fallback hardening remains Phase 37.
- Rich UI treatment beyond compact text is deferred.


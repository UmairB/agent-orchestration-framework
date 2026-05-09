# Phase 15: Global Asset Verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 15-Global Asset Verification
**Areas discussed:** Verification Scope, Required Commands, Coverage Audit, Hardening Bias, PowerShell Parity, Milestone Audit, Deferred Scope

---

## Verification Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full v1.2 slice | Verify global workspace, refs, rendering, lock, files, and UI. | yes |
| Only new Phase 15 tests | Add a few tests without auditing prior coverage. | |
| Feature expansion | Add new global asset behavior during verification. | |

**Selected outcome:** Verify the full v1.2 global asset slice.

---

## Required Commands

| Option | Description | Selected |
|--------|-------------|----------|
| Unit, UI build, Node BDD, PowerShell BDD | Run all milestone-relevant checks. | yes |
| Unit and Node BDD only | Skip UI build and PowerShell parity. | |
| Manual verification only | Do not require automated command evidence. | |

**Selected outcome:** Require `npm run test:unit`, `npm run ui:build`, `npm test`, and `npm run test:integration:ps` on Windows.

---

## Coverage Audit

| Option | Description | Selected |
|--------|-------------|----------|
| Requirement matrix | Map all v1.2 requirements to coverage evidence. | yes |
| Narrative summary only | Summarize coverage without a matrix. | |
| No audit artifact | Rely on passing tests. | |

**Selected outcome:** Add a phase-local coverage matrix.

---

## Hardening Bias

| Option | Description | Selected |
|--------|-------------|----------|
| Add tests/docs unless a real code gap appears | Keep Phase 15 focused on verification. | yes |
| Add proactive refactors | Use closeout to clean implementation internals. | |
| Add new features | Expand milestone scope. | |

**Selected outcome:** Add code only for concrete defects or verification gaps.

---

## PowerShell Parity

| Option | Description | Selected |
|--------|-------------|----------|
| Required on Windows | Treat PowerShell parity as v1.2 closeout evidence. | yes |
| Optional | Run only if convenient. | |
| Deferred | Leave for a later hardening milestone. | |

**Selected outcome:** PowerShell integration is required.

---

## Milestone Audit

| Option | Description | Selected |
|--------|-------------|----------|
| Produce v1.2 audit and archives | Record shipped behavior, risks, deferrals, and next candidates. | yes |
| Verification file only | Skip milestone audit. | |
| Archive later | Defer closeout documents. | |

**Selected outcome:** Create milestone audit and archive snapshots.

---

## Deferred Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Keep major future work deferred | Hosted distribution, sync, versioning, vendoring, runtime expansion, UI execution. | yes |
| Pull one future item into Phase 15 | Add a small feature before closeout. | |

**Selected outcome:** No new feature scope in Phase 15.


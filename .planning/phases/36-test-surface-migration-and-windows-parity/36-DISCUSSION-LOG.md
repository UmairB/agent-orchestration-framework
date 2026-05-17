# Phase 36: Test Surface Migration And Windows Parity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 36-test-surface-migration-and-windows-parity
**Areas discussed:** Fixture Harness Shape, BDD SDK Path Scope, Windows Parity Boundary, v1.6 Migration Fixture, Line Ending Guard

---

## Fixture Harness Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Raw captured fixtures with small scenario overrides | `MockGSDTools` loads captured files while allowing edge-case overrides. | ✓ |
| Raw captured fixtures only | Highest fidelity, but every edge case needs a full fixture directory. | |
| Programmatic fixtures only | Fastest to write, but weaker against real SDK/process-output drift. | |

**User's choice:** Raw captured fixtures with small scenario overrides.
**Notes:** User selected recommended options for all fixture harness follow-ups: add named fixture env plus optional JSON overrides, inject at adapter boundary from `test/support/`, and fail strictly on unknown calls.

---

## BDD SDK Path Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Clone only SDK-relevant GSD board scenarios | Add SDK siblings for sync/attach/repair/assignment flows only. | ✓ |
| Clone every board scenario | Max parity, but noisy for CRUD paths that do not touch SDK. | |
| One broad SDK smoke scenario | Fastest, but weaker TEST-03 traceability. | |

**User's choice:** Clone only SDK-relevant GSD board scenarios.
**Notes:** User selected recommended follow-ups: explicit SDK fixture steps, preserve fallback scenarios as-is, and assert both user-visible output and persisted binding fields.

---

## Windows Parity Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Focused SDK smoke subset in PowerShell | Keep Windows verification useful without duplicating all Node SDK BDD coverage. | ✓ |
| Full SDK sibling suite in PowerShell | Maximum parity, but likely slow and duplicative. | |
| Node-only SDK BDD, PowerShell only line-ending/fingerprint checks | Faster, but weaker against Windows CLI/env behavior. | |

**User's choice:** Focused SDK smoke subset in PowerShell.
**Notes:** User selected recommended follow-ups: runner-created path-with-spaces temp project, UNC/BOM deferred to Phase 38 doctor warnings, and a dedicated `test:integration:sdk-contract` script.

---

## v1.6 Migration Fixture

| Option | Description | Selected |
|--------|-------------|----------|
| Realistic legacy board with existing phase tasks | Includes missing milestone id, old sync command, roadmap path, and phase tasks. | ✓ |
| Minimal legacy BOARD.json only | Easier, but weaker for the real migration failure mode. | |
| Multiple fixtures: minimal and realistic | Strongest but more maintenance. | |

**User's choice:** Realistic legacy board with existing phase tasks.
**Notes:** User selected recommended follow-ups: BDD repair then sync, store canonical fixture files only, and include happy auto-bind plus ambiguous no-guess coverage.

---

## Line Ending Guard

| Option | Description | Selected |
|--------|-------------|----------|
| Cover `.aof/**/*.json`, `.planning/**/*.md`, fixtures, and feature files | Protects board fingerprints and BDD fixture stability. | ✓ |
| Cover only roadmap-required paths | Minimal but leaves fixtures/features open to CRLF churn. | |
| Cover every text file in the repo | Strongest normalization but too broad for this phase. | |

**User's choice:** Cover `.aof/**/*.json`, `.planning/**/*.md`, fixtures, and feature files.
**Notes:** User selected recommended follow-ups: add fingerprint parity unit test, normalize fingerprint inputs in code, and avoid broad renormalization churn.

---

## the agent's Discretion

- Exact helper/module names for `MockGSDTools`.
- Exact BDD scenario names and step wording.
- Exact local helper structure for fingerprint normalization.

## Deferred Ideas

- Phase 37 owns runtime fallback hardening.
- Phase 38 owns doctor warnings for UNC/BOM and SDK/tools version drift diagnostics.
- Full PowerShell duplication of all SDK BDD siblings is deferred.
- Broad repo-wide line-ending renormalization is deferred.


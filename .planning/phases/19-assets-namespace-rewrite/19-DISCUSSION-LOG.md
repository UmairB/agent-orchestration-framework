# Phase 19: Assets Namespace Rewrite - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 19-Assets Namespace Rewrite
**Areas discussed:** Migration Scope

---

## Migration Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Partial migration | Implement the most important `aof assets ...` commands first while leaving old top-level commands working temporarily. | |
| Full migration | Implement the complete assets namespace in Phase 19 and remove old asset-related top-level execution paths. | yes |

**User's choice:** Full migration.
**Notes:** Phase 18 already locked the command contract. The user confirmed Phase 19 should not re-open those product decisions and should migrate the assets namespace fully.

---

## the agent's Discretion

- Planner may decide implementation wave boundaries.
- Planner may decide internal helper extraction strategy.
- Planner must preserve externally visible behavior required by the Phase 18 CLI and BDD contracts.

## Deferred Ideas

- Package namespace work remains Phase 20.
- Project diagnostics and migration work remains Phase 21.
- Live repository verification remains Phase 22.

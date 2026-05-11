# Phase 20: Packages Namespace Rewrite - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 20-Packages Namespace Rewrite
**Areas discussed:** Migration Scope, Package Boundary, Installer Safety

---

## Migration Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Partial migration | Add `aof packages add gsd` first while leaving old `aof install gsd` behavior available. | |
| Full migration | Implement package declaration, inspection, validation, install, and lock replay under `aof packages ...` without restoring old install aliases. | yes |

**Notes:** Phase 18 locked a full rewrite with no legacy aliases. Phase 19 already removed old `install` execution paths, so Phase 20 should expose the replacement namespace rather than re-enabling old behavior.

---

## Package Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Treat GSD as an asset | Model GSD setup as a skill/command/agent asset. | |
| Treat GSD as a managed package | Keep GSD as tooling/framework package intent under `.aof.packages`. | yes |

**Notes:** GSD may install runtime-specific assistant framework files, but it is not itself an AOF source asset. The package namespace owns declaration and installer execution.

---

## Installer Safety

| Option | Description | Selected |
|--------|-------------|----------|
| Add implies install | `aof packages add gsd` also runs or offers to run installer code. | |
| Explicit install only | `aof packages add gsd` only writes config; `aof packages install gsd` is the first network/package-code boundary. | yes |

**Notes:** Dry-runs must preview without network execution. Non-dry-run install must print exact command/source/runtime/scope and package-code warning before execution.

---

## the agent's Discretion

- Planner may decide wave boundaries.
- Planner may decide helper extraction strategy.
- Planner must preserve the Phase 18 package CLI contract and existing GSD installer semantics.

## Deferred Ideas

- Catalog/SQLite/package discovery remains deferred.
- Project namespace cleanup remains Phase 21.
- Live repository verification remains Phase 22.

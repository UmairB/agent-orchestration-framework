---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 34 · Global Mesh Work Store — State

## Progress

- Framed `2026-07-04` by `aof:add-milestone` from the operator request to make recent mesh work
  global: mesh work is machine-wide on the control node; work changes should propagate to global AOF
  state only when mesh support is enabled; node details should be recorded globally; `aof mesh ui`
  becomes global by default with `--local` as the workspace-only view.

- Refined `2026-07-04` by `aof:refine 34` — Decide + Break-down. Memory recall surfaced the milestone
  12 global-store lesson: route global state through `defaultGlobalWorkspaceDir` / `AOF_GLOBAL_HOME`, never
  a hard-coded home. Codebase graph built successfully (**1301 nodes / 3515 edges, egress none**) and
  informed the story cut: store/path substrate, propagation, node descriptors, and UI scope are separate
  seams. Produced [ARCHITECTURE.md](ARCHITECTURE.md), [RESEARCH.md](RESEARCH.md), [DESIGN.md](DESIGN.md),
  and four story spines. Milestone → **in-progress**.

- Contracted `2026-07-04` by `aof:refine 34/00` — authored four `@executable` task features for the global store substrate (path geometry, SQLite open/migrate/refusal, rebuildable workspace projection, query API) and two structural fitness units (`acd-global-mesh-paths-home`, `acd-global-store-no-native-dep`).

- Contracted `2026-07-04` by `aof:refine 34/01` — authored four `@executable` task features for mesh-enabled propagation (explicit enablement predicate, post-mutation publish, publish-failure isolation, launcher convergence) and two structural fitness units (`acd-global-propagation-single-predicate`, `acd-global-publisher-single-seam`).

- Contracted `2026-07-04` by `aof:refine 34/02` — authored four `@executable` task features for global node/workspace descriptors (node materialization, workspace membership, credential redaction, freshness/query API) and two structural fitness units (`acd-global-node-descriptors-redact-secrets`, `acd-global-node-registry-projection-only`).

- Contracted `2026-07-04` by `aof:refine 34/03` — authored four `@executable` task features for mesh UI global scope (CLI scope selection, API scope switch, visible Global/Local UI states, empty/error/health states) and three structural fitness units (`acd-mesh-ui-global-default`, `acd-mesh-ui-local-filter-preserves-status`, `acd-mesh-ui-scope-visible`).

- [x] **00 · global store substrate** — contract authored (`tasks/00`–`03` + two fitness units); ready for build
- [x] **01 · mesh-enabled work propagation** — contract authored (`tasks/00`–`03` + two fitness units); ready for build
- [x] **02 · global node registry** — contract authored (`tasks/00`–`03` + two fitness units); ready for build
- [x] **03 · mesh UI global scope** — contract authored (`tasks/00`–`03` + three fitness units); ready for build

## Notes & decisions in flight

- **ADR-001:** global mesh state lives under `globalWorkspacePaths().workspaceDir/mesh`, honoring
  `AOF_GLOBAL_HOME`.
- **ADR-002:** global propagation is gated by explicit `config.mesh.enabled === true`; empty `mesh: {}`
  stays inert.
- **ADR-003:** SQLite is a rebuildable projection, not the canonical work source, and must not add a new
  native npm dependency.
- **ADR-004:** propagation is snapshot-based and idempotent through one shared publisher.
- **ADR-005:** node/workspace details are materialized as global JSON descriptors as well as indexed rows.
- **ADR-006:** `aof mesh ui` is global by default; `--local` is the current-workspace filter.

## Verification

- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — global/default UI and `--local` filter verified on at least two workspaces

---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 34 · Global Mesh Work Store — Architecture Decisions

> Inputs: `SPEC.md` (machine-wide mesh work visibility for the control node; global propagation only when
> mesh support is enabled; node details in the global AOF folder; `aof mesh ui` global by default and
> `--local` scoped to the current workspace), the current mesh substrate from milestones 22, 25, 26, 27,
> and the fabric-native redesign in milestone 33.
>
> Prior-lesson recall surfaced the global-store precedent from milestone 12: global state must derive from
> `defaultGlobalWorkspaceDir` / `AOF_GLOBAL_HOME`, never from a hard-coded `~/.aof` string. This milestone
> applies that precedent directly.
>
> Codebase graph grounding: `aof graph build src` completed at refine time with **1301 nodes / 3515 edges,
> egress none**. `aof graph impact` reported:
> - `src/mesh-ui-serve.mjs` has one dependent (`src/cli.mjs`) and imports `asset-base.mjs`,
>   `command-core.mjs`, and `work.mjs`. The UI default can change at the serve face without cutting through
>   the whole work engine, as long as data still enters through a narrow query surface.
> - `src/workspace.mjs` has 16 dependents and already owns `globalWorkspacePaths()`. Global mesh path
>   geometry belongs here or beside it, not in individual commands.
> - `src/work.mjs` has 19 dependents and owns work-stream reads plus `loadWorkspace`. Work propagation must
>   use a shared projection writer, not one-off writes spread across command modules.
> - `src/commands/mesh-identity.mjs` and `src/mesh-issuance.mjs` already depend on mesh/node/run state.
>   Node/workspace registry updates should reuse those data seams, not introduce a second identity model.

---

## ADR-001: Global mesh state lives under the global AOF workspace home; path geometry is derived from `globalWorkspacePaths()`, never hard-coded

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The requirement is machine-wide state: every mesh-enabled workspace on the control node should
contribute to one global work plane. AOF already has a global workspace home through `globalWorkspacePaths()`
and `defaultGlobalWorkspaceDir()`, with `AOF_GLOBAL_HOME` relocation support. Milestone 12 made store-first
global tooling depend on that seam.

**Decision.**
- The global mesh root is `<globalWorkspacePaths().workspaceDir>/mesh`.
- The work projection lives under `<global>/mesh/work/`.
- Node/workspace descriptors live under `<global>/mesh/nodes/` and `<global>/mesh/workspaces/`.
- No module may derive this with `os.homedir()` or a literal `~/.aof`; all paths route through a single
  global mesh path helper.

**Consequences.**
- Tests can relocate the whole global mesh store with `AOF_GLOBAL_HOME`, matching the existing global asset
  and managed-tool store precedent.
- The global store is machine-wide for the current user account, not repository-local and not system-wide
  across users.

---

## ADR-002: Mesh enablement is explicit; global propagation is gated and non-mesh workspaces remain local-only

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The current repository can contain `mesh: {}` without being a working mesh participant. Using
"mesh object exists" as the propagation gate would silently globalize ordinary workspaces.

**Decision.**
- Introduce an explicit enablement predicate: a workspace is mesh-enabled when `config.mesh.enabled === true`.
- For back-compat during the transition, a workspace with a configured fabric (`config.mesh.fabric`) or a
  hydrated `config.mesh.nodeId` may be treated as mesh-capable by doctor/migration guidance, but the global
  propagation writer uses the explicit predicate.
- Non-mesh work commands keep today's local-only behaviour and do not create global mesh store files.

**Consequences.**
- Operators opt into machine-wide visibility deliberately.
- Empty `mesh: {}` remains inert.
- `work doctor` should warn when a workspace appears mesh-configured but has not opted into global
  propagation, so migration is visible rather than surprising.

---

## ADR-003: The global work store is a rebuildable SQLite projection, not the canonical source of truth

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The canonical authored work records already live in each workspace's `work.dir`. A global store
must support cross-workspace query and UI speed, but it must not become a second editable work stream that can
drift from the record docs. The user proposed SQLite; the codebase currently has no SQLite npm dependency.

**Decision.**
- The global store is a projection. Canonical records remain the workspace `wiki/work` item docs plus mesh
  run/issuance records.
- The projection engine may use SQLite only through a runtime-provided SQLite implementation or another
  no-new-dependency path. This milestone must not add a native SQLite package just to create the store.
- If SQLite is unavailable in the packaged runtime, the projection layer refuses with a structured,
  actionable error rather than falling back silently to a different authority model.
- The store has a schema version table and a rebuild path that can delete/recreate derived rows from a
  workspace snapshot.

**Consequences.**
- Corruption recovery is simple: rebuild the projection from registered workspaces.
- Concurrency is handled at the projection boundary, not by editing canonical docs through SQLite.
- The implementation must include migration/rebuild tests, not just happy-path query tests.

---

## ADR-004: Propagation is snapshot-based and idempotent; work writers call one shared publisher

**Status:** Accepted
**Date:** 2026-07-04

**Context.** Work changes can originate through `aof work` commands, run lifecycle commands, mesh issuance,
or direct file edits later observed by a launcher/sync loop. A hook per command would drift quickly.

**Decision.**
- Add one projection publisher that takes a loaded workspace and writes an idempotent snapshot for that
  workspace into the global store.
- Commands that already mutate work/run/mesh records call the publisher after a successful mutation when
  the workspace is mesh-enabled.
- The mesh launcher/sync loop may also call the publisher periodically so direct record-doc edits converge
  without requiring every write path to be perfect on day one.

**Consequences.**
- Propagation is at-least-once and idempotent, not event-sourced.
- Failed global projection writes must not corrupt the local work command result; they surface as warnings
  or doctor findings, because canonical local writes already succeeded.

---

## ADR-005: Node details are persisted as global descriptors, with SQLite as index and JSON as operator-readable outline

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The user explicitly asked for control and worker node details to be outlined in the global AOF
folder. A pure SQLite file would be queryable but not inspectable.

**Decision.**
- Store the query index in SQLite.
- Also materialize operator-readable JSON descriptors under `<global>/mesh/nodes/<nodeId>.json` and
  `<global>/mesh/workspaces/<workspaceId>.json`.
- Node descriptors include node id, role hints, hostname, fabric address when known, last seen, capabilities,
  and workspace membership. Sensitive credentials are never copied into the global descriptor.

**Consequences.**
- Operators can inspect global mesh state without a special database browser.
- The JSON descriptors are derived artifacts; the SQLite projection remains the query surface.

---

## ADR-006: `aof mesh ui` reads the global projection by default; `--local` is an explicit workspace filter

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The current `mesh-ui-serve.mjs` loads the current workspace and invokes `mesh:status`. The new
operator question is machine-wide: "what work exists across this control node?"

**Decision.**
- `aof mesh ui` serves global mode by default and queries the global projection.
- `aof mesh ui --local` keeps the existing focused workflow by applying a current-workspace filter.
- The serve face stays a thin UI/API layer. It must not import low-level work/run/mesh writers; it talks to
  a query surface.

**Consequences.**
- The CLI parsing change is intentionally user-visible.
- Existing local diagnostics remain available through `--local`.
- UI tests must assert both the default global scope and the local filter.

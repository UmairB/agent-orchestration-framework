---
type: story
number: 01
slug: fleet-status
title: "The fleet data model + the aof mesh status CLI mirror — mesh:status extended to aggregate nodes + presence/staleness + registered boards + per-board active runs"
parent: 25
status: done
owner: product-owner
created: 2026-07-01
updated: 2026-07-02
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
  Break-down stage (aof:refine 25): the user story + the ownership map are set; the task
  `.feature` contract is authored later via Three Amigos (`aof:refine 25/01`).
-->
# 01 · The fleet data model + the `aof mesh status` CLI mirror

## User story

As a node operator who wants ONE command that answers *"what is the whole fleet doing right now"* — the nodes,
whether each is live or stale, and every board being worked on with its run state — without opening a browser,
I want **`mesh:status` extended into the fleet aggregate**: nodes (`readNodeRecords`) + presence & staleness
(`readPresenceRecord` / `isNodeStale`) + registered boards (`readRegistry`, the m24 roster, absence-tolerant)
+ each board's active runs (m21's `work:run-status` READ), rendered as the **`aof mesh status` CLI mirror**,
so that the fleet view has ONE registered data command (ADR-002) that **BOTH faces consume** — the CLI mirror
here and the web surface (story 02) — with **no second data path**, and it **degrades gracefully** to the
node roster (a single-node fleet) when the m24 registry seam is not yet present.

<!-- This story owns the FLEET DATA MODEL — the registered command both faces close over. It is additive on
     the spine: mesh:status already reads node records + presence/staleness (m22/23); this ADDS the `boards`
     projection. Graph seam: commands/mesh-identity.mjs (hosts mesh:status) ← command-core, mesh-heartbeat →
     mesh-store, mesh-presence. Fully PARALLEL with story 00. Build-able + testable NOW against a single-node
     fleet — the m24 `readRegistry` seam is a graceful-degrade dependency, NOT a hard block. -->

## Tasks

Contract authored `2026-07-02` via Three Amigos (`aof:refine 25 --autonomous` cascade). All 5 flags resolved;
suite green. **Dev-locked aggregate shape** — the boards entry is `{ ref, owner, activeRuns }` (`ref` = board
slug, `owner` = single nodeId first-wins, `activeRuns` = running run ids); enumerated as the **union** of
`registry.boards[] ∪ every roster[].boards[]` (never-drop); an ownerless board **omits** the `owner` key (not
`null`, the m23 never-beat idiom); non-local boards resolve via THIS node's local work-stream seam
(`readActiveRuns(listItems(ws))`, ENOENT→[]).

- [x] **[00 · the boards projection](tasks/00_boards-projection.feature)** `@cli @work @distribution @executable` —
      `mesh:status` gains a `boards` key additively over the frozen `{ nodes }`: each registered board joined with
      its owner (roster join) + its running run ids (m21 read, `state === "running"` the sole in-flight state).
      Multi-board-per-node fan-out, zero-board node, several running runs per board, the 5-state active boundary,
      the pure read.
- [x] **[01 · the `aof mesh status` render](tasks/01_mesh-status-render.feature)** `@cli @work @distribution @executable` —
      one line per node (the m23 locked `<node> — <token>` liveness render) + a boards section (owner + running
      count, zero-count listed not dropped); the `"No nodes in the mesh roster."` line stays the nodes-half text
      while the boards section still renders below it; `--json` emits the clean `{ nodes, boards }` aggregate,
      never mixing the friendly line into the machine face.
- [x] **[02 · graceful degradation](tasks/02_graceful-degradation.feature)** `@cli @work @distribution @executable` —
      registry absent / torn / foreign-shaped / empty all degrade to an empty boards projection while the node
      roster renders in full; a stale node still renders with its board; an ownerless board (torn half-sync)
      lists without an owner. **Dev-corrected constraint:** `readRegistry` tolerates only ENOENT (a
      parseable-wrong or unparseable registry currently *throws*), so the boards projection must own its **own**
      try/catch + shape-guard — pinned here, owed at build.

_Fitness function this story owns (arch-test — structural invariant, never a `.feature`):_

- [ ] **`acd-mesh-ui-single-data-command`** (ADR-002/003, WRITE now — phase 1, absence-tolerant) — `mesh:status`
      is the SINGLE fleet-aggregate command: no module OTHER than `commands/mesh-identity.mjs` co-reads
      `readRegistry` alongside `readNodeRecords`/`readPresenceRecord` (no second fleet-data path). Phase 2
      (guarded by `existsSync(mesh-ui-serve.mjs)`, story 02's module) tightens to "the web face reaches fleet
      data ONLY via `invoke('mesh:status')`" — GREEN now, tightening automatically when the face lands.

_Rides (unchanged):_ **`acd-mesh-command-cli-bijection`** — `mesh:status` is already a registered `mesh:*`
command with a dispatch branch + clean `--json`; the additive extension keeps it green.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-002** (the fleet data model is ONE
registered command; both faces consume it through the registry; degrades when the m24 registry seam is absent)
and [DESIGN.md](../../DESIGN.md) (the `aof mesh status` CLI-mirror columns; a possible CLI `boards` column is a
**task-feature outcome**, cross-referenced, not a design mock).

**Dependencies:** none within the milestone — fully independent, **parallel with story 00**. Consumes the
**m24 story-00 `readRegistry` seam** (covered by the milestone's `depends: 24`); because the read is
absence-tolerant it is **not hard-blocked** on m24 landing — it builds + tests today against a single-node
fleet. Story 02 (`aof mesh ui`) depends on THIS story for the `mesh:status` fleet aggregate it renders.

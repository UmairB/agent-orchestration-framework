---
type: story
number: 00
slug: assignment-record-and-verb
title: "Assignment record + assign/withdraw verb — an operator assigns a resolvable work ref to a named worker, recorded as a first-class assignment in the global store, with the control-side repo-availability gate"
parent: 35
status: done
owner: product-owner
created: 2026-07-08
updated: 2026-07-09
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 00 · Assignment record + assign/withdraw verb — the dispatch fact, recorded

## User story

As a **control-node operator**, I want to hand a specific work item to a specific worker with one
command — `aof mesh assign <ref> --to <nodeId>` — and have that assignment recorded as a durable,
first-class fact in the machine-wide global store, so that the dispatch intent survives (it is never
wiped by a converge tick), exactly one node is ever running a given item, and I can see who was told to
run what — before any transport or execution exists.

<!-- The FOUNDATION story: it establishes the data contract (the assignment record + its named-producer
     lifecycle enum) and the operator entry point (the verb) that stories 01/02/03 all build on. No
     transport, no worktree, no UI here — just the record, the verb, the store table, and the control-side
     gates. Everything downstream references the assignmentId this story mints and the frozen record shape
     this story freezes. -->

## Tasks

<!-- Contract authored `2026-07-08` via `aof:refine 35 --autonomous` (Three Amigos: PO headline scenarios
     inline + aof-qa Examples/case matrix + an aof-developer feasibility pass). All `@executable` over the
     v3 store + a hermetic AOF_GLOBAL_HOME (the m34 store-test precedent) — this story has no cross-machine
     surface. Structural invariants live in arch-tests (see Fitness units), never as behaviour scenarios. -->

- [x] [`tasks/00_assignment-record.feature`](tasks/00_assignment-record.feature) — `@executable` — the
  frozen 10-key assignment record assembler + the single-source-of-truth state→producer enum; the additive
  `global_assignments` table (schema v2→v3) with dedicated single-row writers; an assignment survives a full
  `publishWorkspaceSnapshot` cycle byte-identical (ADR-001).
- [x] [`tasks/01_assign-verb.feature`](tasks/01_assign-verb.feature) — `@executable` —
  `aof mesh assign <ref> --to <nodeId>`: resolve the ref exactly, mint an `assigned` record targeting the
  node; the store uniqueness invariant (a second **active** assignment on the same `(workspaceId, itemRef)`
  is refused with a coded `assignment-already-active` naming the holder, minting nothing); the single
  `--json` envelope (ADR-003).
- [x] [`tasks/02_withdraw.feature`](tasks/02_withdraw.feature) — `@executable` —
  `aof mesh assign <ref> --withdraw` flips the active assignment's `state → withdrawn` (a state write, never
  a row delete); idempotent-safe on an already-withdrawn one; a benign null on a never-assigned ref (nothing
  fabricated) — mining the retired `mesh-issue-withdraw` semantics onto the store (ADR-001/003).
- [x] [`tasks/03_repo-availability-gate.feature`](tasks/03_repo-availability-gate.feature) — `@executable` —
  the control-side "does `<nodeId>` actually have this repo" gate (resolved via `global_node_workspaces` +
  the node's `mesh.repo.published`, 34/ADR-010) and the "is `<nodeId>` a real target" check; a miss surfaces
  a **loud coded refusal** (`assignment-repo-unavailable` / unknown-target), never an opaque success
  (34/ADR-008 visibility).

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) — this story arms:

- `acd-no-git-bus-return` (ADR-003) — no `src/` module imports/creates `mesh-lease.mjs` / `mesh-issuance.mjs`
  / `mesh-sync.mjs` / `commands/mesh-issue.mjs` / a `leaseClaimPath`. The rebuild uses no git-bus.
- `acd-assignment-state-has-producer` (ADR-001 / R2·m20) — every assignment state maps to exactly one named
  producer in a single source-of-truth enum; no producerless state.
- `acd-assignment-record-frozen` (ADR-001) — the assembler returns EXACTLY
  `[assignmentId, itemRef, workspaceId, targetNodeId, issuer, state, runId, assignedAt, updatedAt, reclaimedAt]`, in order.
- `acd-assignments-survive-snapshot` (ADR-001) — no snapshot-path statement touches `global_assignments`; an
  inserted assignment survives a publish cycle byte-identical.
- `acd-assignment-arbitration-store-not-git` (ADR-003) — arbitration is the store uniqueness query, not a
  git/lease read.
- `acd-assignment-target-not-connected-loud` (ADR-002/34-ADR-008) — control-side half: an assign to an
  unknown/ineligible target emits a coded, operator-visible refusal, never a silent return.

## Notes

Inherits [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-001** (record + named-producer enum + the new v3
table + dedicated writers, NEVER the snapshot seam), **ADR-003** (store-uniqueness arbitration; the git-bus
stays dead), and the control-side half of **ADR-002/004**'s loud-miss discipline. Inherits
[SECURITY.md](../../SECURITY.md) T3 (repo-availability as a security control) and T6 (the record carries
`issuer`/`targetNodeId` provenance the later stories authenticate against).

**Dependencies:** none — this is the foundational floor. Stories 01, 02, 03 all depend on this story's frozen
record shape + `global_assignments` table + `assignmentId`.

**Store fact (from RESEARCH.md):** the global store rides Node's experimental `node:sqlite`
(`global-work-store.mjs:68`) — the v3 migration is an additive `CREATE TABLE IF NOT EXISTS` inside the
existing `migrateSchema` transaction + the `aof_schema` version bump; a v2 store migrates forward, a v3 store
already refuses a v2 build (`schema-unsupported` guard).

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: all four tasks stay `@executable` — the smallest story, mechanically.** No retag. Every seam is
present and fixturable over a hermetic `AOF_GLOBAL_HOME` + injected clock (the m34 global-store test
convention).

- **v3 migration is additive + mechanical.** Bump `GLOBAL_WORK_SCHEMA_VERSION` (`global-work-store.mjs:7`,
  2→3) and add `CREATE TABLE IF NOT EXISTS global_assignments …` inside the existing `migrateSchema`
  `BEGIN IMMEDIATE`/`COMMIT` block (`:89-179`). The `existing > version` guard (`:29-37`) is exactly the
  "a v3 store already refuses a v2 build" seam. `publishWorkspaceSnapshot` (`:181-249`) is confirmed to touch
  ONLY `workspaces`/`work_items`/`projection_*` — the snapshot-survival grep (no `… global_assignments`) is
  clean.
- **Uniqueness invariant is plain SQL** — `SELECT … WHERE workspace_id=? AND item_ref=? AND state IN
  ('assigned','accepted','running')`; no lease/git dependency exists to entangle with.
- **The repo-availability gate's data is live:** `global_node_workspaces` join at
  `global-node-registry.mjs:141-143`; `mesh.repo.published` written by `commands/mesh-repo.mjs:33-50` — both
  fixturable by seeding rows/config directly.
- **`aof mesh assign` registration:** a **CLI-only nested verb OUTSIDE the bijection** (ADR-007) — a new
  `if (subcommand === "assign") { await meshAssignCommand(rest); return; }` branch in `cli.mjs`'s
  `meshCommand` (above the unknown-sub fallthrough, the `mesh repo`/`mesh ui` idiom), calling a new
  `src/commands/mesh-assign.mjs` (core kept out of `cli.mjs`, unit-testable — the `mesh-repo.mjs` precedent).
  Do NOT register a `mesh:assign` id in `command-core.mjs` (the `--to`/`--withdraw` flags don't fit the
  single-positional `meshVerbCli` face; keeping it CLI-only leaves `acd-mesh-command-cli-bijection` untouched).
- **Net-new infra:** only the v3 store fixture (a mechanical extension of the existing v2 pattern).
- **Build-order:** foundational, no deps. Nothing in `src/` references `global_assignments` today — clean floor.

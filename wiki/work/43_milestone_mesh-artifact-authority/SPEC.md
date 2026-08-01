---
type: milestone
number: 43
slug: mesh-artifact-authority
title: "Mesh artifact authority — the cache is the read surface"
status: not-started
owner: product-owner
created: 2026-08-01
updated: 2026-08-01
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 43 · Mesh artifact authority — the cache is the read surface

## Objective

A work item worked by a worker node is currently readable on the control node only by accident,
and only for a while. This milestone makes the control node's SQLite cache the **one read
surface** for work-item state and artifact content, fed by whichever node authored the change,
and makes an assigned item **exclusively owned** for the duration of its phase.

The measured disease is not staleness — it is staleness that is *actively republished over live
truth on a timer*:

| The mechanic | Where |
|---|---|
| The worker streams its worktree state while a run is live | [mesh-launcher.mjs:1448](../../../src/mesh-launcher.mjs#L1448) |
| …but only **four** files ride the wire: `SPEC.md`, `STORY.md`, `VERIFICATION.md`, `RETROSPECTIVE.md` | `WORK_ITEM_DOC_FILES`, [global-work-store.mjs:17](../../../src/global-work-store.mjs#L17) |
| …and never `tasks/*.feature` — *"the features live in the worker's worktree and are not streamed yet"* | [tasks.mjs:15](../../../src/commands/tasks.mjs#L15) |
| The control launcher republishes the workspace on a cadence | [mesh-launcher.mjs:732](../../../src/mesh-launcher.mjs#L732) |
| …which **wholesale-deletes `work_items` and rebuilds it from the control's own disk** | [global-work-store.mjs:431](../../../src/global-work-store.mjs#L431), [:417](../../../src/global-work-store.mjs#L417) |
| On a successful push the worker deletes its worktree | [mesh-worker-execution.mjs:2664](../../../src/mesh-worker-execution.mjs#L2664) |

While a run is live the two writers alternate and the last tick wins. After settle the worker
never ticks again, so the control's stale disk wins **permanently** — the item reverts to its
pre-run scaffold with the work invisible on a branch nothing on the control node ever fetches
(the only `git fetch` in `src/` is worker-side worktree construction,
[mesh-worktree.mjs:155](../../../src/mesh-worktree.mjs#L155)).

Only five commands consult the worker's view at all (`list`, `doc`, `run-status`, `continue`, and
`tasks` for existence). `next` is `nextWork(ws.workDir, scope)` — pure disk
([next.mjs:25](../../../src/commands/next.mjs#L25)) — as are `validate`, `doctor`, `find`, the
graph verbs, and `resolve.mjs`, which most read commands sit on.

**The end state:** every reader answers from the cache; every writer — worker *or* control —
publishes into it; an item under assignment cannot be written by anyone else; and nothing is
silently overwritten by a checkout that never ran the work.

## Scope

In scope:

- **The exclusive item lock** — an active assignment locks the item at *execution scope*, against
  a second assignment, against a local run mint, and against control-side mutation. Operator
  decision (2026-08-01): control-side changes are refused while a phase is in flight and allowed
  only at a **gate** (no active assignment), which is also the only safe moment for an insert.
- **Write-triggered artifact sync** — a Claude Code `PostToolUse` hook makes the worker report
  each artifact write as it happens, rather than being discovered by a periodic re-scan. The
  streamed file set widens from the four-name whitelist to every artifact a reader needs
  (`tasks/*.feature`, `ARCHITECTURE.md`, `DESIGN.md`, `RESEARCH.md`, `STATE.md`, ADRs).
- **The cache as the read surface** — `work_items` and the artifact tables stop being rebuilt
  from control disk; readers move off `listItems`/`findWork`/`nextWork` onto the cache; the
  control node publishes its own lifecycle writes through the same seam every other node uses.
- **Staleness, never eviction** — cached rows carry `syncedAt` + the reporting node; past the
  window they are marked stale, never deleted. The board renders a stale badge and a **Resync**
  action that requests a fresh push from the owning node.
- **Gate-time propagation, control → worker** — a dispatch brings the item's existing branch up to
  the directive's pinned base commit before the agent starts, so a control-side edit made at a
  gate reaches a *continuing* item.

Out of scope:

- **Concurrent workers on one item** — explicitly deferred (operator, 2026-08-01). The lock's
  whole premise is one holder; multi-holder arbitration is a later milestone if ever.
- **Reading git for artifacts.** The cache is fed by the wire, not by fetching branches. Git stays
  the transport for *structure* (the branch, the base-commit pin) and the durable history of the
  work; it is never a read path for item state.
- **Landing run-settled docs on the default branch** (m42's open branch-cure row) — **superseded**.
  It existed to make the control's disk current for disk-based readers; this milestone removes the
  disk-based readers instead. See [42's ROADMAP](../42_structural-overhaul/ROADMAP.md).
- **Structural operations moving off disk.** `work-reindex` renames real folders, `validate`/`doctor`
  check folder↔frontmatter *consistency*, `work-upgrade` rewrites templates in place — the disk is
  the subject of those operations, not a stale copy of a fact. They stay local, and each publishes
  its result into the cache.

## Stories

<!-- Populated at the Break-down stage (refine). -->

- [ ] `43_story_item-lock` — an assignment exclusively owns its item at execution scope; second
      assignment, local run mint and control-side mutation all refused, coded and loud, until the
      next gate.
- [ ] `43_story_artifact-sync-on-write` — the `PostToolUse` hook + thin-enqueue body + daemon-side
      batched send; the artifact set widens to everything a reader reads; the periodic tick is
      retained as the reconciliation backstop.
- [ ] `43_story_cache-read-surface` — the cache becomes authoritative: the wholesale rebuild from
      control disk stops, the control publishes its own writes through the shared seam, and the
      disk-based readers migrate.
- [ ] `43_story_staleness-and-resync` — `syncedAt` + reporting node on every cached artifact, the
      staleness window, the board's stale badge and the Resync action.
- [ ] `43_story_gate-propagation` — a dispatch fast-forwards an existing item branch to the pinned
      base commit, so control-side gate edits reach a continuing item without a branch switch or a
      pull into a live tree.

## Dependencies

- **42 · Structural overhaul** — this milestone is built on wave (d)'s seams and would be
  unimplementable without them: the effects ledger and its four transition seams own the
  cascades this work declares; `transitionRunStart` is the single mint door the lock hangs on;
  `effects/stores.mjs`'s fact/projection classification is the thing being *revised* (the streamed
  mirrors were already classified facts — `work_items` is the projection that must stop being
  rebuilt from disk); and the **base-commit pin** (`50c2c82`) is the control→worker propagation
  mechanism the gate story extends.
- **The item-branch derivation** (`87a7f39`) — `aof/mesh/<ref>` is the branch the gate story
  fast-forwards; without one derivable branch per item there is no stable line to advance.

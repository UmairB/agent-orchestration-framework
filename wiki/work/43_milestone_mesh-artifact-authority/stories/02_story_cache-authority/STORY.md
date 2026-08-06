---
type: story
number: 02
slug: cache-authority
title: "The authority cut — work_items stops being a disk-rebuilt projection and becomes a provenance-stamped, row-upserted FACT written through ONE seam both the control node and every worker use, with deletion by author retraction"
parent: 43
status: done
owner: product-owner
created: 2026-08-01
updated: 2026-08-02
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 02 · The authority cut — the cache stops being rebuilt from control disk

## User story

As the **operator watching a work item that a remote worker is building**,
I want the control node's cache to **keep whatever the authoring node reported**, instead of being
wholesale-deleted and rebuilt from the control node's own stale disk on every propagation tick,
so that a worker's work stops being **actively republished over live truth on a timer** — the item no
longer reverts to its pre-run scaffold the moment the worker settles and stops ticking, which today makes
the stale side win **permanently**.

<!-- This is the milestone's central cut and the second of the two risk-carrying cores (ADR-009 wave 1).
     It is ~3 modules and high risk; the 18-site reader migration that used to share a story with it is
     now story 06, so this change is reviewable as a single-subject diff. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` **ADR-004**. The disease, measured: `publishWorkspaceSnapshot`
(`src/global-work-store.mjs:436-504`) calls `wholesaleDelete(db, "work_items", workspaceId)` at **`:459`**
and re-`INSERT`s every row from the **calling node's own local disk slice**, inside one `BEGIN IMMEDIATE`;
the control launcher runs it on a cadence (`mesh-launcher.mjs:732`). *(Note: SPEC/STATE's `:417`/`:431`
citations are stale — `:459-460` is the measured location.)*

1. **`work_items` is reclassified `projection` → `fact`** in `src/effects/stores.mjs`, naming its writer
   module explicitly. **The reclassification IS the enforcement**: `wholesaleDelete` (`:45-61`) already
   throws before running when the target table is not classified `"projection"`, so the rebuild cannot
   survive the reclassification **even by accident**. No new mechanism is invented — the registry m42
   built for exactly this gates exactly this.
2. **ONE shared row-level upsert seam**, the **structural twin of `upsertWorkItemContent`**
   (`global-work-store.mjs:636-679`, which already stamps `node_id`/`updated_at` and already has exactly
   one writer). Both writers use it:
   - the **control node's** publish (`publishWorkspaceSnapshot`) calls it with its own node id;
   - the **worker's** delta (`applyDeltaFrame`, `src/control-stream-server.mjs:177-202`) calls it with the
     **connection-authenticated** node id — never a self-reported one, the same rule
     `applyWorktreeContentFrame` already keeps.
3. **Contention is resolved by the ADR-003 lock, not by a timestamp race.** While an assignment covers a
   ref's execution scope, an upsert for that ref is accepted **only from the holder**. Outside a lock,
   last-write-wins by `syncedAt`. The control's periodic tick therefore **skips held refs and counts the
   skips**; an operator-initiated control-side mutation of a held ref is refused with
   `item-locked-by-assignment` — the same guard, not a second rule.
4. **Deletion is by AUTHOR RETRACTION — never a sweep, never time.** A publishing node passes the full
   ref set it is authoritative for, and the seam deletes rows where
   `node_id = <this node> AND ref NOT IN <that set>`. **A node may retract only what it itself authored;
   it may never delete another node's row, and no deletion may ever be predicated on a timestamp.** A ref
   first authored by the control and later reported by a worker carries the **worker's** `node_id` and
   therefore survives a control-side delete — correct, because the worker's copy is the live one.
5. **`applyDeltaFrame` collapses to a call.** Its read-merge-republish dance exists only to feed the
   wholesale writer; with a row upsert it passes the delta rows straight through. This also **retires its
   P0.3 hazard** — *"one partial delta rolls back the ENTIRE `BEGIN IMMEDIATE` txn and silently drops
   every OTHER item in the same frame"* — because there is no longer a whole-workspace transaction for one
   bad row to abort.
6. **The alternation ends structurally, demonstrably.** The behavioural proof (the ADR's own prose fitness
   criterion): publish → stream a worker delta → publish again, and assert the **worker's row survives**.
   And: an item settled by a worker still reads correctly on the control **after the worktree is deleted**
   (`mesh-worker-execution.mjs:2664`) — the case that fails permanently today.
7. **The deliberate-removal path is NAMED.** A workspace's rows can still be removed on purpose
   (unregistering a workspace), but only through an explicitly named path, **never through the publish
   tick**. That path must be named by this story, because the sweep it used to ride is gone.

## Tasks

<!-- Authored at `aof:refine 43 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of the other stories' tasks. -->

- [x] `00_work-items-is-a-fact-not-a-rebuilt-projection` — the publish tick completes without sweeping
      `work_items`, and a wholesale delete of it is refused with `fact-table-wholesale-delete`, while
      `projection_errors` stays a rebuilt projection. (AC1)
- [x] `01_one-upsert-seam-stamped-by-the-writing-node` — one row-level upsert seam serves both writers,
      stamping the control's own id on its publish and the **connection-authenticated** id on a worker's
      frame, whatever the frame self-reports. (AC2)
- [x] `02_author-retraction-is-the-only-deletion` — a node removes only rows it authored and no longer
      claims; another node's row, a partial report and the passage of time never delete anything. (AC4)
- [x] `03_alternation-proof-the-worker-row-survives` — publish → stream a worker delta → publish again,
      and the worker's row survives; a settled item still reads correctly after the worktree is deleted
      and the worker stops ticking. (AC6)
- [x] `04_contention-is-decided-by-the-assignment-lock` — a held ref is written only by its holder: the
      periodic tick skips and **counts** the skips, an operator's control-side mutation is refused with
      `item-locked-by-assignment`, and at a gate the same verb is accepted. (AC3)
- [x] `05_frames-land-row-by-row-no-collateral-rollback` — one unstorable row in a frame is skipped and
      counted while every other row in that frame lands, and a worker's snapshot frame removes nothing
      it did not carry (the P0.3 retirement). (AC5)
- [x] `06_deliberate-workspace-row-removal` — one explicitly named, operator-initiated path clears a
      workspace's whole cache footprint; no publish tick ever does, including when the publishing node's
      own disk read fails. (AC7)
- [x] `07_own-disk-read-primitive-unchanged` — a node still reads its own disk to report its own state
      (the worker's frame-building read included), and no reader migrates onto the cache in this story.
- [ ] `08_cross-machine-cache-authority-soak` — `@manual`: on two real machines, a settled item still
      reads correctly on the control long after the real worktree is gone and the real cadence has run.

## Notes

- **Dependency shape (ADR-009):** wave 1, parallel with `01_story_item-lock` (disjoint files). This story
  owns the **shared upsert seam**, which stories 03, 04 and 06 all consume — one owner, three consumers,
  which is the shape that keeps those three independent of each other.
- **Schema v8 moved HERE at refine (ADR-010 R-D2, superseding ADR-009's placement).** The Three Amigos
  found a hard sequencing defect: AC4's retraction predicate reads `work_items.node_id`, a column ADR-009
  had landing in `43/04` (wave 2) — *after* this wave-1 story. That is not an observability gap; the
  predicate has no column to read, and roughly half this story's scenarios were unimplementable. The
  guarded `ALTER` **and the write-side stamping** are therefore owned here (the columns are the shape this
  story's own upsert seam produces); `43/04` keeps everything **read-side** — the mapper, the predicate,
  the wire envelope, never-evict, Resync and the UI. The `04 → 02` dependency edge already existed and is
  now load-bearing.
- The arch-test `acd-work-items-single-writer` is committed **green today** (every `work_items`
  INSERT/UPDATE/DELETE lives in exactly one module) and **arms at the reclassification**: once
  `effects/stores.mjs` classifies `work_items` as `fact`, no `wholesaleDelete(db, "work_items"` call may
  exist anywhere.
- **TWO PRE-EXISTING ARCH-TESTS WILL FAIL AT THIS STORY'S CUT — budget for them (found by the developer
  amigo at refine).** Both are green today, are owned by no story, and encode the very behaviour this
  story removes:
  - `test/arch/acd-fact-projection-split.test.mjs` contradicts this story three times — `:139` *requires*
    the `work_items` sweep to exist, `:148` *requires* `tableClass("work_items") === "projection"`, and
    `:137`'s unanchored `rawSweeps` regex will additionally match the new retraction `DELETE`. All three
    must be updated in the same change as the reclassification, or CI goes red at the cut.
  - `test/arch/acd-work-list-contract.test.mjs:122` is an `assert.deepEqual(keys, CONTRACT_FIELDS)` — an
    **exact key-set equality** on the CLI's emitted JSON, which forbids the "additive optional keys" both
    `43/04` and `43/06` assume. ADR-010 R4.1 settles the cure: the envelope rides the **HTTP face**
    (`/api/work/list` → `{ items, stalenessSeconds }`) while `work list --json` stays a byte-identical flat
    array, so this contract is not broken at all — but the story must not casually add a key to it.
- **Where story 01's control-side-mutation guard belongs, so wave 1 stays parallel.** ADR-004 routes that
  refusal into this story's upsert seam, which would serialise `01` behind `02`. The developer amigo found
  a better home that keeps them disjoint: `effects/stream-transitions.mjs`'s `transitionStreamReindexed` —
  the single seam both insert call sites (`insert-shared.mjs:274,599`) already route through, which already
  takes `workspace` and already imports `resolveWorkspaceId`, and which **no other story touches**.
- **`wholesaleDelete` is module-private** (`global-work-store.mjs:51`) and after the cut has no
  `work_items` caller at all — task `00`'s four rows need a litmus channel that survives that.
- **`applyDeltaFrame(store, frame, { now })` never receives `options.nodeId`** today, unlike
  `applyWorktreeContentFrame`. AC2 reads as though it were already plumbed; it is one destructure, but it
  is not free.
- `readWorkspaceProjectionItems` (`global-work-store.mjs:539`) is **not** a reader that must migrate — it
  is how a node reads its own disk to report its own state, and is what the WORKER uses to build the frame
  it streams. The read primitive is not the disease; the wholesale delete-and-rebuild wrapped around it is.

---
type: story
number: 01
slug: notion-projection-sync
title: "The aof → Notion projection + one-way sync — milestone→page, story→sub-task, status-map, --dry-run, idempotent update-in-place"
parent: 17
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-27
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · The aof → Notion projection + one-way sync (the milestone's core behaviour)

## User story

As the product owner who finishes a story and wants the team's Notion board to reflect it without retyping,
I want `aof work integrations notion sync-work <milestone>` to project the on-disk milestone onto its existing
Notion board page and each story onto a same-database sub-task, push each item's aof status to the board's
mapped status option, create the page on first run and update it in place thereafter (no duplicates), and
let `--dry-run` preview that exact diff without touching Notion,
so that the Notion board matches the on-disk stream after one command — created-then-updated-in-place,
one-way (disk always wins), never half-written on a missing mapping, and previewable before it writes.

<!-- This is the milestone's core behaviour (ADR-003 projection · consumes ADR-001 mapping + ADR-002
     envelope + ADR-004 config/CLI-spawn seam). It fills the `run` body of `notion:sync-work` with the
     pure projection + the apply-over-CLI layer. It owns the observable `.feature` outcomes (live rows
     @manual — they need a real Notion token/workspace, RESEARCH §A2/A6). It owns NO contract freezing
     (story 00), NO descriptor/schema/doctor (story 02), NO arch-tests (story 03). -->

## Tasks

<!-- Contract authored at the Three Amigos stage (`aof:refine 17 --autonomous`, 2026-06-25): PO headline
     Scenarios + aof-qa Examples tables/tagging + aof-developer feasibility. Each task is one `.feature`
     under tasks/; the box is ticked when its `@executable` feature is green (at `aof:continue`) — the
     live-Notion rows are `@manual` (real token + workspace). Structural invariants (one-way,
     never-half-write, never-touch-schema) live in ARCHITECTURE.md fitness functions (story 03), NOT here.
     Tags `@cli @adapter @work-stream`. -->

- [x] [`tasks/00_projection-plan.feature`](tasks/00_projection-plan.feature) — the pure
  `projectMilestone({items,config,mapping})` → a `SyncPlan`: milestone→page op, story→sub-task op
  (self-relation to the milestone page id), status→board option via `statusMap`, `op` ∈
  create/patch/noop/skip from the sidecar lookup + status match. (5 scenarios, `@executable`) — ADR-003
- [x] [`tasks/01_first-run-creates-resync-updates.feature`](tasks/01_first-run-creates-resync-updates.feature)
  — first sync creates each page + records the binding; a second sync over unchanged disk is all
  `unchanged`/`noop` (no duplicate); a moved status patches in place. The create→record→patch-in-place
  MECHANIC is `@executable` over the injected spawn seam (3 scenarios, no token —
  test/notion-apply-idempotent.test.mjs); the LIVE `ntn api` round-trip rows stay `@manual` (3 scenarios,
  live Notion workspace). — ADR-003
- [x] [`tasks/02_dry-run-zero-calls.feature`](tasks/02_dry-run-zero-calls.feature) — `--dry-run` computes +
  prints the full per-item diff and issues ZERO Notion calls (the sidecar makes the preview exact); the
  dry-run plan equals the plan the real sync would apply. (4 scenarios, `@executable`) — ADR-003
- [x] [`tasks/03_status-map-and-honest-skip.feature`](tasks/03_status-map-and-honest-skip.feature) — a mapped
  option projects to that board option; an aof status with no `statusMap` entry (e.g. `in-review`) is an
  honest `skip` + `reason` computed before any write, never a guessed value. (4 scenarios, `@executable`) — ADR-003/004
- [ ] [`tasks/04_one-way-disk-wins.feature`](tasks/04_one-way-disk-wins.feature) — a Notion-side divergence
  is overwritten from disk on the next sync; the on-disk record is unchanged (no Notion value read back).
  (2 scenarios, **`@manual`** — live Notion workspace) — ADR-003

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): **ADR-003** (the projection — milestone→board
page, story→same-database sub-task via the `§A3` self-relation set by page-id, aof status→a board option via
the MANDATORY config `statusMap` with an honest skip on a missing option, addressed by `data_source_id` per
`§A7`; `--dry-run` = zero Notion calls; one-way disk→Notion, Notion never authoritative), consuming
**ADR-001** (`resolvePageId`/`recordPageId`) and **ADR-002** (the `run` body + envelope) and **ADR-004**
(the Notion-CLI spawn seam + the configured-but-unreachable honest-failure rule, `RESEARCH §A6` 429/Retry-After).

This story **owns**: `src/notion/projection.mjs` (PURE — `(items, config, mapping) → SyncPlan`, no Notion
call) and `src/notion/sync.mjs` (APPLIES the plan over story 02's CLI spawn seam — create/patch pages, record
bindings), and the create/patch/skip body of `notion:sync-work`'s `run`. It authors the task `.feature`
outcomes, gating the live-Notion rows `@manual`.

**Independent because** the projection is a pure function of the traversal + config + sidecar — it consumes
story 00's frozen envelope + mapping and never edits them. Its only sibling coupling is the **name of the
Notion-CLI binary** (story 02's `NOTION_DESCRIPTOR`), which is an injectable spawn seam — so this story builds
in parallel against a stubbed CLI and only the `@manual` live round-trip ultimately needs story 02's real
binary. **On the critical path** with story 00 (it is the behaviour the milestone exists to deliver), but it
fans out in parallel with story 02.

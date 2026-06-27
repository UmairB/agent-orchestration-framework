---
type: story
number: 01
slug: projection-and-multiboard-sidecar
parent: 18
status: done
owner: product-owner
created: 2026-06-26
updated: 2026-06-27
---
# 01 · Projection routing + multi-board sidecar — the consumption side

## User story

As an operator syncing routed milestones, I want the pure aof→Notion projection to **read each milestone's
routing** (from story 00's resolver) and **address its chosen board** — nesting the milestone under its
parent page via that board's `relationProperty`, while a milestone with **no descriptor / no parent** still
projects **top-level on the default board, byte-for-byte as milestone 17** — and I want the derived page-id
sidecar to hold bindings for **more than one board at once**, so two milestones routed to **different
boards** each land in the right place after one `sync-work` and neither sync clobbers the other's bindings.

<!-- The CONSUMPTION side of milestone 18 (ARCHITECTURE.md ADR-003/005): the projection consumes story 00's
     `resolveNotionRouting` to pick the board connection + the relation parent page id, and `mapping.mjs`
     (the 3-importer hub: notion-sync-work, projection, sync) gets the multi-board coexistence fix. No
     descriptor / no parent ⇒ the m17 op verbatim (the no-regression invariant). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 18 --autonomous`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. The STRUCTURAL invariants — board
     resolution + default fallback (FF-C), the projection-side no-Notion-read / descriptor-committed
     guarantees (FF-A/FF-D halves), and the re-pointed sidecar round-trip — are the milestone's ARCH-TESTS
     (ARCHITECTURE.md §Fitness functions), AUTHORED in story 02. These features carry only OBSERVABLE
     behaviour, verified against the PURE projection plan (no live Notion — finding NTN-V1 keeps the
     live lane deferred). -->

- [x] **00 · [projection-board-routing](tasks/00_projection-board-routing.feature)** — `projectMilestone`
  reads routing via story 00's resolver and addresses the **chosen board's** `dataSourceId`/connection; a
  milestone whose descriptor names `board: X` produces a plan whose `dataSourceId` is **X's**; an **absent
  descriptor** ⇒ the **default** board and a plan **byte-for-byte identical** to the m17 projection (the
  no-regression arm); the sidecar read for the plan is scoped to the **routed** board's `dataSourceId`.
- [x] **01 · [projection-parent-nesting](tasks/01_projection-parent-nesting.feature)** — a milestone with a
  `parent` (a raw page-id **or** a key resolving in its board's `parents`) carries a **relation to that
  parent page id** through the board's `relationProperty` (the same property a story uses), so the board
  nests `parent → milestone → story`; an **absent or unresolvable** parent ⇒ **no relation** + an honest
  `reason` (the milestone projects **top-level**, never a relation to a fabricated id); stories still carry
  the §A3 self-relation to their milestone.
- [x] **02 · [multiboard-sidecar-coexistence](tasks/02_multiboard-sidecar-coexistence.feature)** — the v2
  per-data-source sidecar shape: a binding recorded under board A and a binding recorded under board B
  **coexist** in one `.aof/notion.work-map.json` (recording B leaves A's bucket untouched — the clobber is
  gone); a ref resolves **only** under its own data-source (two boards never collide); a **v1 single-board**
  file migrates on first read (its entries become that data-source's bucket), and the first record rewrites
  it in v2 shape.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): **ADR-003** (`resolveNotionRouting` — board
→ connection, parent → relation parent page id, default fallback, AOF.md-class first-class) · **ADR-005**
(the multi-board sidecar: re-key `mapping.mjs` to `{ version:2, boards: { "<dsId>": { entries } } }`,
`readMapping`/`recordPageId` operate per-bucket, v1 migrates additively — the page-id binding stays derived
and git-ignored) · **ADR-006** (one-way preserved — the projection makes no Notion read; the only egress is
the unchanged `create`/`update` in `sync.mjs`).

This story **owns** `projection.mjs` (the routing read + parent nesting), `mapping.mjs` (the v2 multi-board
shape + v1 migration), and the `dataSourceId`-threading in `sync.mjs` / `notion-sync-work.mjs`. It
**consumes** story 00's `resolveNotionRouting` reader.

**Independent because** its surface is the projection + sidecar — distinct files from story 00's authoring
seam, coupled only through the resolver's public contract (board connection + parent page id). The
no-regression arm (absent descriptor ⇒ m17 verbatim) makes it safe to land without touching any routed item.
**Build-order: after story 00** (it imports the resolver), before story 02 (whose `parseFrontmatter` revert
needs routing to already flow through the descriptor, not frontmatter).

**Feasibility (developer amigo seat — confirmed at Contract): BUILDABLE with build-notes only (no contract
change).** The projection (`src/notion/projection.mjs`) and the sidecar (`src/notion/mapping.mjs`, the
3-importer hub) are the exact files to change. **Build notes:** (1) **Thread the per-routing `dataSourceId`**
in `src/commands/notion-sync-work.mjs` only — resolve routing ONCE on the milestone
(`const routing = resolveNotionRouting(milestoneItem, notionConfig)`), then `readMapping(projectRoot,
routing.board.dataSourceId)` (was `notionConfig.dataSourceId`, line 150), and pass `config: routing.board` +
the resolved `parentPageId` into `projectMilestone` (153) and `applyPlan` (157-163). (2) **`src/notion/sync.mjs`
needs ZERO change** — it already takes the dataSourceId from `plan.dataSourceId` into `recordPageId`, so the
v2 bucket write is automatic. (3) **`mapping.mjs` v2 re-shape** — `readMapping` returns `boards[dsId]?.entries`
as `{ entries }` (the projection's `mapping.entries` contract is preserved); `recordPageId` re-parses the WHOLE
file and merges into `boards[dsId].entries`, leaving other buckets untouched; v1 read path:
`parsed.version < 2 && parsed.dataSourceId === dsId ⇒ parsed.entries` is that bucket (else a miss — the
cross-board guard). (4) **No old-shape consumer breaks** — the only in-source reader of `mapping.dataSourceId`
is `projection.mjs:161` (keep `readMapping` echoing the requested dsId, or take it from `routing.board`); the
m17 tests that seed `{version:1,…}` rely on the v1-migration read path. **Two cross-story contract touchpoints
with story 00** (already reflected in the features): `resolveNotionRouting().board` exposes the FULL per-board
connection (not just a key), and its `reason` string names the unresolvable parent key. The milestone + its
stories share ONE board within a sync-work (a relation can't cross databases) — confirmed; no per-story board.

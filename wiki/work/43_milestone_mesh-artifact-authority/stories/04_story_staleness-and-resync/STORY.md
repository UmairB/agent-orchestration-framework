---
type: story
number: 04
slug: staleness-and-resync
title: "Staleness, never eviction — schema v8 stamps every cached row with who reported it and when, ONE strict-> predicate decides freshness on both sides of the wire, the board renders a stale badge and a Resync action, and no deletion may ever be predicated on time"
parent: 43
status: in-review
owner: product-owner
created: 2026-08-01
updated: 2026-08-03
depends: [43/02]
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 04 · Staleness, never eviction

## User story

As the **operator reading a cached copy of a work item that some other node authored**,
I want every row and artifact to say **who reported it and when**, and to be **marked stale rather than
deleted** once it ages past the window — with a **Resync** action that asks the owning node for a fresh
push,
so that I can tell an authoritative copy from an old one **at a glance instead of by inference**, and so
that a TTL can never destroy the mesh's only readable copy: after settle the artifacts exist in exactly two
places — the pushed branch and this cache — and this milestone deliberately does not read git.

<!-- The never-evict rule is settled operator policy (STATE, 2026-08-01), and ADR-006 expresses it
     STRUCTURALLY rather than by convention: no DELETE against the three cache tables may be predicated on
     a time column. Combined with ADR-004's reclassification, the only sanctioned removal in the whole
     cache is author retraction — predicated on authorship, never on age. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` **ADR-006** and `DESIGN.md` (whose binding checklists are the conformance
source of truth for this story's UI — no mock was elicited; see Notes).

1. **Schema v8 is INHERITED, not owned (ADR-010 R-D2).** The guarded, idempotent
   `ALTER TABLE … ADD COLUMN` that takes `GLOBAL_WORK_SCHEMA_VERSION` 7 → 8 and adds `node_id` +
   `updated_at` to `work_items`, together with the **write-side stamping**, moved to
   `02_story_cache-authority` at refine — its retraction predicate cannot read a column that does not
   exist. This story owns everything **read-side** from those columns down: the mapper, the predicate, the
   wire envelope, never-evict, Resync and the UI. `work_item_docs`/`work_item_runs` need **no** migration
   at all: they have carried `node_id` + `updated_at` per row since schema v5.
2. **Existing rows read NULL and render `unknown`** — a *designed state*, not a gap. **Backfilling a
   fabricated timestamp is forbidden**: it would assert a freshness nobody observed. A missing `syncedAt`
   yields `unknown`, never `stale`.
3. **STORAGE names mirror the sibling tables (`node_id`, `updated_at`); WIRE names are DESIGN's
   (`reportedBy`, `syncedAt`).** A reader joining `work_items`, `work_item_docs` and `work_item_runs` must
   not meet two column names for one fact. The storage→wire mapping has **one home** — the row mapper — and
   is applied identically to rows and to artifacts.
4. **ONE staleness predicate per runtime boundary, and the boundary is explicit.** In `src/`: the shared
   `isStale` (`src/mesh-presence.mjs:398-408`, strict `>`, injected clock) — no cache-freshness code in
   `src/` hand-rolls a timestamp comparison. In `ui/`: **exactly one** module evaluates freshness
   (`ui/src/board/freshness.mjs`), pure, framework-free, **`now` passed in and no clock of its own**, using
   **strict `>`** so both sides agree at the threshold instant. *Two staleness predicates that can disagree
   about the same instant is a defect, not a variant.*
5. **The THRESHOLD NUMBER is never duplicated.** Configured once in `src/`, it travels on the list envelope
   as `stalenessSeconds`; `ui/` carries **no default and no literal**. When the wire does not carry it, the
   legend degrades **to words, never to a guessed number**.
6. **Both grains of staleness are on the wire, because DESIGN renders both** — the ROW's freshness from
   `work_items.updated_at`, each ARTIFACT's from its own `work_item_docs.updated_at`: *a doc can be older
   than the row that names it.* One predicate, two subjects.
7. **The stale badge is a fifth ramp, not a variant of an existing one** — a dashed-outline pill
   (`◌ stale · 12m ago`), `muted-foreground`, sized **below** the status chip so **status outranks
   freshness**. Stale is `muted`, **never `destructive`** (which stays reserved for `blocked`/`failed`).
   Placement is immediately **left** of the status chip with the chip keeping its right-edge anchor, so
   **nothing moves at the threshold** and the m03 header baselines survive.
8. **The crossing is clock-driven, not fetch-driven** — load-bearing, because the board only re-polls while
   something is executing, so a settled stale item would otherwise **never grow a badge**. It rides the
   existing 1s cosmetic tick: the badge appears within 1s, with no network, no animation and no reflow.
9. **Resync has one door, on the detail panel's provenance line, only while stale** — never on lane or
   overview cards, which are themselves `<button>`s (m38/ADR-012 forbids nesting interactive elements), and
   not in the ActionsStrip (work-stream verbs, not view repair).
10. **The offline-owner case is DESIGNED, not left as an error path.** The item is stale precisely because
    the owner stopped reporting, so "request a fresh push" can plausibly get no answer. Rules: the button
    reports the **call**, the provenance line reports the **data**; there is **no success toast** — the badge
    clearing and the age resetting are the only proof a push landed; acks decay after exactly one poll
    interval while **facts persist**; **muted = the world did not answer, destructive = the request was
    rejected**; Resync is **never pre-disabled on presence** (attempt-then-report is one rule for both
    surfaces); and in-flight is **bounded**.
11. **Attribution is always-on where there is room, on-demand where there is not.** The provenance line
    renders for **every** cache-published item (not only executing ones), with control-authored rows reading
    `(this node)`; per-doc provenance sits at the top of the doc body; the fleet card carries badge +
    `title` only, because that region's geometry is fitness-locked.
12. **The TTL NEVER evicts, expressed structurally.** No `DELETE` against `work_items` / `work_item_docs` /
    `work_item_runs` may be predicated on a time column, anywhere.
13. **Accessibility:** the badge is **never colour-only** (the word and glyph carry it; the dashed border is
    declared decorative); a glyph-only form must be `role="img"` + `aria-label`; Resync **names its object**
    (`Resync <ref> from <node>`), carries `aria-busy` **and** a changed visible label; the message slot is a
    permanently-present `aria-live="polite"` region while the badge is deliberately **not** announced;
    target size ≥24×24.

## Tasks

<!-- Authored at `aof:refine 43 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of the other stories' tasks.

     THE SPLIT follows the story's two subjects. Tasks 00-02 are the DATA LAYER (`@cli`): the schema, the
     wire, the predicate and the never-evict rule. Tasks 03-09 are the UI (`@ui`): the ramp, the badge,
     attribution, Resync, the legend and the two review gates. 43/02's upsert seam is the only dependency
     that crosses out of this story. -->

- [x] `00_schema-v8-provenance-columns.feature` — opening a v7 store lands `node_id` + `updated_at` on
      `work_items` through a guarded, idempotent, in-place `ALTER`, leaves every existing row intact and
      unstamped, and touches neither content table. (AC 1, AC 2)
- [x] `01_cached-rows-carry-provenance.feature` — every row and artifact the read surface serves carries
      who reported it and when, under storage names in the store and wire names on the response, with the
      configured window stated once and the frozen CLI array contract unbroken. (AC 3, AC 5, AC 6)
- [x] `02_stale-marks-never-evicts.feature` — the shared strict-`>` predicate judges the row and each
      artifact separately at the boundary, a missing instant reads `unknown` rather than `stale`, and an
      ancient row is marked stale yet stays fully readable — removal is by author retraction, never by age.
      (AC 2, AC 4, AC 6, AC 12)
- [x] `03_freshness-ramp-and-stale-badge.feature` — one headless ramp module emits the three states, the
      board paints `stale` as a dashed `muted` pill left of the right-anchored status chip, and the badge
      appears within one second of the crossing off the cosmetic tick with zero network. (AC 4, AC 7, AC 8)
- [x] `04_provenance-line-and-node-attribution.feature` — the provenance line renders for every
      cache-published item with `(this node)` for control-authored rows, each doc body states its own
      provenance above the markdown, and the retired "documents aren't bridged" notice survives only as the
      reworded cache-miss placeholder. (AC 2, AC 11)
- [x] `05_resync-requests-fresh-push.feature` — one Resync door, on the provenance line, only while stale;
      it reports the call and never the data, so there is no success toast and the badge clearing is the
      only confirmation; the in-flight state is bounded on both legs. (AC 9, AC 10)
- [x] `06_resync-owner-unreachable.feature` — DESIGN's seven Resync states as a table: muted when the world
      did not answer and destructive only when the request was rejected, acknowledgements decaying while
      facts persist, never pre-disabled on presence, and the cached copy never hidden by a failure. (AC 10)
- [x] `07_freshness-legend-documents-the-window.feature` — both legends gain a Freshness block painting the
      real badge and stating the configured window from the wire, degrading to words — never to a guessed
      number — when the wire does not carry it. (AC 5)
- [x] `08_staleness-a11y-contract.feature` — the ramp's programmatic accessibility contract: the word
      `stale` always carries the meaning, a glyph-only badge is `role="img"` + `aria-label`, Resync names
      its object and agrees visibly and programmatically about being busy, and the permanent polite live
      region announces outcomes while the crossing is deliberately silent. (AC 13)
- [ ] `09_staleness-visual-review.feature` — `@uat`: a person judges that the ramp reads as degraded rather
      than broken, region by region against DESIGN's binding checklists, at 1280/768/390 (+360 fleet),
      including the measured no-movement and ≥24×24 target-size clauses. (AC 7, AC 10, AC 11, AC 13)

## Notes

- **Dependency shape (ADR-009 as revised by ADR-010):** wave 2, parallel with stories 03 and 05. Depends on
  `43/02` for both the upsert seam **and** the v8 columns (the schema move — see AC1). This is the only
  story that touches `ui/`, which is what keeps it independent of its wave-2 siblings.
- **THIS STORY MUST BUILD THREE THINGS NOTHING IN THE REPO PROVIDES — they are deliverables, not
  assumptions (confirmed by the developer amigo at refine, and ruled in scope by ADR-010 R4.2/R4.4/R4.5).**
  They dominate the story's cost and should be started during wave 1 rather than discovered in wave 2:
  1. **A board-side headless mount harness (~1.5–2.5 days).** `test/support/fleet-app-harness.mjs:28`
     hard-binds `FLEET_TSX`; nothing in the repo mounts `Board.tsx`. ~300 of its 432 lines are
     surface-agnostic and should be extracted into a shared core. Net-new work is stubs for `TerminalDock`
     (which alone pulls `@xterm/*` ×3 and the board subtree's only `@/` alias, `TerminalDock.tsx:22`) and
     `lucide-react`, plus board accessors. **Tasks 03–08 (79 scenarios) rest on it.**
  2. **The Resync control-side transport (~2 days).** Nothing today carries a node→node "push me your
     state" request. ADR-010 R4.2 defines it as `work:resync` + `POST /api/work/resync` over the existing
     directive channel, with codes `resync-no-owner` / `resync-owner-not-connected` /
     `resync-owner-unreachable` plus a timeout. **`src/mesh-recovery-push.mjs` is the exact precedent**: a
     CLI writes a `requested` row into a lazily-created additive table (**no schema bump**), the control
     tick dispatches a down-frame to a connected admitted peer, the worker replies with a result frame —
     and its four states map 1:1 onto DESIGN's Resync table, including `owner unreachable`.
  3. **A `Board.tsx`-root 1s clock.** The cosmetic tick exists only inside `DetailPanel.tsx:588-595` (in
     `RunsSection`, not the header) and `Fleet.tsx:73,144-147` — not at the item-surface level the lane,
     overview and header badges need. DESIGN's badge-within-1s-with-no-network is load-bearing, so this is
     required rather than optional.
- **No mock was elicited** — this refine ran `--autonomous` with no operator present. Per ADR-003 that makes
  DESIGN.md's **binding checklists the conformance source of truth** for all three surfaces (stale badge,
  Resync action, node attribution). If the operator later exports a mock, commit it under the milestone's
  `mocks/` dir and reference it from DESIGN.md as the surface's source of truth.
- **The data ask DESIGN forces, and this story discharges:** `work_items` has no provenance columns today,
  the board wire carries no `syncedAt`, and `reportedBy` is set only on worker-*inserted* child rows.
- **Invariants that are NOT scenarios** (they live in `acd-cache-staleness-single-predicate`, already green):
  "there is exactly one staleness predicate / one threshold" is a *sameness* property a scenario can only
  ever sample at one instant; and the **never-evict ratchet** (no time-predicated DELETE) is an *absence*.
  Task 02 carries the never-evict rule's **observable** half instead — an ancient row is still readable.
- `RemoteContentNotice` is retired by this milestone — its "documents aren't bridged" copy becomes false
  once the cache is the read surface. Task 04 asserts the retirement and the reworded cache-miss
  placeholder; **serving the doc body itself is story 06's** `cached-doc-attribution.feature`.
- **The a11y lane is currently OFF in this repo** (`.aof/aof.config.json` has no `a11y` domain), so the
  accessibility criteria bind the **design-conformance review** and a `@uat` scenario rather than an
  automated axe run. Task 08 carries the programmatic half (roles, names, live regions — ordinary DOM
  assertions, not an axe scan); task 09 carries the perceptual half.
- **The three carrier questions QA raised are now SETTLED (ADR-010 R4.1/R4.3):**
  (a) **`stalenessSeconds` rides the HTTP face, not the CLI** — `/api/work/list` returns
  `{ items, stalenessSeconds }`, while `work:list`'s result and `work list --json`'s flat array stay
  **byte-identical**. This matters beyond tidiness: `test/arch/acd-work-list-contract.test.mjs:122` is an
  `assert.deepEqual(keys, CONTRACT_FIELDS)` exact key-set equality that would have failed on any added CLI
  key. Per-row `syncedAt`/`reportedBy` ride the rows themselves.
  (b) **The acknowledgement decay is a TIMER, not a poll-driven event** — and a Resync in flight
  additionally **arms a bounded poll** for its watch window. Without that, "no answer" would be
  structurally guaranteed rather than measured, because the board schedules no list poll while nothing is
  executing — which is exactly the settled-stale case Resync exists for.
  (c) The two in-flight bounds stay **tuning constants, deliberately not pinned** by the architect: task 05
  requires them bounded and distinguishable, and DESIGN supplies the defaults (10s request, 3 poll
  intervals) for the Three Amigos to fix at build time.

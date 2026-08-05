---
type: story
number: 06
slug: cache-read-surface
title: "The readers migrate — a new cache-first seam beside the work.mjs god-node, staged chokepoint-first through commands/resolve.mjs's 8 dependents, with the worker-side and structural readers PINNED to disk by positive assertion and doctor keeping one snapshot with a cache status overlay"
parent: 43
status: in-review
owner: product-owner
created: 2026-08-01
updated: 2026-08-05
depends: [43/02, 43/03, 43/04]
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 06 · The readers migrate onto the cache

## User story

As **anyone reading work-item state on the control node** — through `next`, `find`, `list`, `doc`,
`tasks`, `run-status` or the board —
I want every control-side reader to answer **from the cache**, with each row saying which side answered it,
so that the milestone's end state actually holds at the surface the operator touches: *every reader answers
from the cache*. Today only five commands consult the worker's view at all; `next` is pure disk
(`commands/next.mjs:25`), as are `validate`, `doctor`, `find`, the graph verbs, and `resolve.mjs` — which
most read commands sit on.

<!-- Wave 3, last on purpose. This is the widest and most mechanical change in the milestone, and it is
     only CORRECT once the cache is authoritative (story 02) and provenance-stamped (story 04): migrating
     readers onto a cache the control tick is still clobbering would ship a regression. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` **ADR-005**, as corrected by **ADR-010 R6.3**. RESEARCH's exhaustive grep
replaces STATE's summary figure of "25 sites across 18 modules": there are **33 real call sites across 21
modules** (three files were verified false positives), in three categories — **(a)** control-side, must
migrate: **12 modules / 17 sites**; **(b)** worker-side, must NOT migrate: 2 modules / 7 sites;
**(c)** structural, stays on disk: **7 modules / 9 sites**.

*(QA caught one mis-classification at refine: `promote-gap-to-chore:95` reads `listItems` as
`defaultAt(workDir)` to count top-level items and pick an **insert position** for a folder it then creates
on disk via the m41 reindex engine. That is a structural-placement read — a cache-derived count would land
the insert past the end of the real stream and leave a numbering gap. It moved from (a) to (c), and is now
**positively pinned** in `acd-cache-read-surface-boundary`.)*

1. **A NEW module, `src/work-read.mjs`, is the cache-first read seam.** It exposes cache-first equivalents
   of `listItems` / `findWork` / `nextWork` / `listStream`, each returning rows stamped with provenance
   (`reportedBy`, `syncedAt`).
2. **The dependency direction is FIXED: `work-read.mjs` imports `work.mjs`; `work.mjs` NEVER imports
   `work-read.mjs`** — m41/ADR-001's rule reused verbatim, for the same reason: `src/work.mjs` is the
   **37-importer god-node** and its blast radius must not grow. The seam needs its readers, not the reverse.
3. **Cache-first with disk FALLBACK, not cache-only.** A control node that has never published (a fresh
   workspace, a torn store) must still answer. The fallback is an **explicit, reported degrade path, not a
   silent one** — and every row says which side answered it, which is the same fact DESIGN renders.
4. **The migration is STAGED, chokepoint-first — four stages, not one big bang:**
   - **Stage 0** — the seam exists and is tested against a fixture, with **no call site moved**. Zero blast
     radius.
   - **Stage 1** — **`commands/resolve.mjs` moves.** One edit; `continue`, `doc`, `feedback`,
     `run-complete`, `run-retry`, `run-start`, `run-status` and `tasks` all migrate behind it (graph-cited:
     **8 dependents**, and it imports only `work.mjs`). This is the milestone's single largest behavioural
     change **and it is one file**.
   - **Stage 2** — the remaining control-side leaves, in any order, **each independently revertible**:
     `next`, `find`, `list`, `run-start:119`, `mesh-heartbeat`, `promote-gap-to-chore`, `notion-associate`,
     `notion/sync-work`, `memory/local-indexing`, `mesh-assignment`, `mesh-assignment-reclaim`, and
     `mesh-launcher`'s **injected** default (`:390`, wired at `:493` — it migrates by swapping a default,
     not by editing a call site).
   - **Stage 3** — the boundary is **fitness-locked in BOTH directions**.
5. **The non-migration is asserted POSITIVELY, not merely left alone.** The worker-side reads
   (`mesh-worker-execution` ×5, `global-work-store:601`) and the structural reads (`work-reindex` ×3,
   `insert-shared` ×4, `work-upgrade:106`, `effects/table:258`, `effects/reconcile:75`) **MUST keep
   importing `work.mjs`'s disk readers.** A later well-meaning *"finish the migration"* that moved a worker
   onto the control's cache would make **a worker read someone else's opinion of its own checkout**. A
   negative-only guard cannot catch that; a positive assertion can.
6. **`work-doctor` keeps ONE snapshot; the snapshot BUILDER gains a status overlay.** This settles the one
   ambiguity RESEARCH could not, and consciously **departs from STATE's prose list** (which named
   `work-doctor` among the modules that must move) while honouring SPEC's out-of-scope bullet (the disk is
   the *subject* of doctor's checks):
   - `doctorWork` still builds its snapshot **once** from disk — folder identity, frontmatter, orphans,
     folder mtime. Its pure-group architecture is untouched, which was the blocker: it hands the snapshot to
     pure `(snapshot, ctx) => Finding[]` groups, so splitting the snapshot's *source* per group would be an
     architecture change to doctor.
   - Before the groups run, the builder **overlays cache-authoritative STATUS** onto each row, stamping
     `statusFrom: "cache" | "disk"`. `statusCoherenceGroup` / `lifecycleCompletenessGroup` then read the
     authoritative status **without changing their source or their signature**.
   - `freshnessGroup` stays **disk-only and explicitly so** — it is a folder-mtime probe with no cache
     equivalent.
   - **Why doctor must not simply "move":** for a worker-authored item, control disk holds only the stale
     scaffold, so a naive disk-status doctor would report a **false finding against every remote item**. The
     overlay is what stops the migration turning doctor into noise. A genuine divergence — for a ref the
     control itself last reported — remains a real finding, and `node_id` is what distinguishes the two
     cases.
   - **The overlay is PER-FACT, and an incomplete overlay is reported, not guessed (ADR-010 R6.1).** QA
     found that overlaying *status* alone creates a new false-finding class one group over:
     `lifecycleCompletenessGroup` reads `status × docs × children`, so a worker-authored milestone reported
     `done` would fire `missing-verification` + `missing-retrospective` + `milestone-no-stories` against
     **every** remote milestone. Gating those findings on `statusFrom === "disk"` was rejected (doctor would
     go blind on remote items). Instead each fact — status, docs, children — overlays independently, and
     when status is cache-authoritative while docs/children fell back to disk, the three lifecycle findings
     are **suppressed and replaced by ONE `cache-incomplete` finding naming the node**. This is why this
     story now depends on `43/03`: the docs/children overlay needs the artifacts that story streams.

## Tasks

<!-- Authored at `aof:refine 43 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of the other stories' tasks.

     The split follows ADR-005's four migration STAGES (00 = stage 0, 01 = stage 1, 02 = stage 2,
     03 = stage 3's behavioural half) plus doctor's overlay as its own subject (04) — that is the
     reviewable seam AND the build order. 05 is the deferred human gate on a real two-machine mesh.
     Stage 3's SOURCE-level positive assertion is NOT a task: it lives in the arch-test
     `acd-cache-read-surface-boundary` (ARCHITECTURE's "invariants moved out of the feature layer"). -->

- [ ] `tasks/00_seam-answers-cache-first-with-reported-fallback.feature` — the seam answers cache-first with per-row provenance, degrades to disk explicitly (miss / never-published / torn store), and moves no call site: every existing reader answers exactly as before.
- [ ] `tasks/01_resolve-chokepoint-moves-eight-commands.feature` — one edit to `commands/resolve.mjs` migrates all eight dependents, so a remote-authored story whose worktree is gone reads correctly through `doc`, `tasks` and `run-status` — and the leaves demonstrably have NOT moved.
- [ ] `tasks/02_control-side-leaves-migrate-independently.feature` — the remaining control-side leaves migrate one at a time, completing the six-surface headline (`next`/`find`/`list` join `doc`/`tasks`/`run-status`) while every disk-known ref's answer stays byte-identical.
- [ ] `tasks/03_worker-and-structural-readers-stay-on-disk.feature` — the boundary holds behaviourally: a worker reports its own worktree (never the control's copy of it), and every structural operation renames/rewrites the folders actually on disk.
- [ ] `tasks/04_doctor-one-snapshot-with-cache-status-overlay.feature` — doctor keeps one disk snapshot with a cache STATUS overlay, so a worker-authored item draws no false finding while a divergence on a ref this node itself reported still does.
- [ ] `tasks/05_remote-authored-read-surface-soak.feature` — `@manual` — the real two-machine mesh: a milestone worked on a REAL worker reads correctly on the control node after the worktree is deleted, and does not revert while the republish tick runs on.

## Notes

- **Dependency shape (ADR-009):** **wave 3, last on purpose.** Depends on `43/02` (the cache must actually
  be authoritative) and `43/04` (rows must be provenance-stamped, since the seam returns `reportedBy` /
  `syncedAt` on every row).
- **The invariant that is NOT a scenario:** "no reader outside the sanctioned worker/structural set imports
  the disk readers" is a **source fact**, not a behaviour — it lives in `acd-cache-read-surface-boundary`
  (committed green today, pinning the worker/structural readers **positively**, and arming on the seam
  landing).
- `readWorkspaceProjectionItems` (`global-work-store:539`) is **dual-use and is not a reader that must
  migrate**: it is how a node reads its own disk to report its own state.
- **Out of scope, by SPEC:** structural operations moving off disk. `work-reindex` renames real folders,
  `validate`/`doctor` check folder↔frontmatter *consistency*, `work-upgrade` rewrites templates in place —
  the disk is the **subject** of those operations, not a stale copy of a fact. They stay local, and each
  publishes its result into the cache.

### Open questions raised at refine by QA (routed, not decided here)

- **`promote-gap-to-chore:95` may be mis-classified as a control-side reader.** Its `listItems` call is
  `defaultAt(workDir)` — it COUNTS top-level items to choose the append position for a chore folder it
  then CREATES ON DISK via the m41 reindex engine. That is a structural-placement read, and by SPEC's own
  out-of-scope bullet the disk is its subject; a cache-derived count would land the insert past the end of
  the real stream and leave a numbering gap. `tasks/02` asserts the OUTCOME (gapless, `validate` green) so
  it is green either way — **the classification is the architect's to confirm.**
- **The REACH-THROUGH.** A cache-answered row's `dir` names a folder that is not on this node. Every reader
  that reaches THROUGH a row into its folder is affected: `tasks` (`tasks/*.feature`), `run-start:119` (run
  records), `memory/local-indexing:596` (item markdown), `notion/sync-work:121` (milestone docs), and the
  two WRITE doors `feedback` / `run-start` (which append to a record doc and mint a run record under
  `item.dir`). `tasks/01` and `tasks/02` assert: never crash, never fabricate a path, never silently return
  an unmarked empty answer, and — for the write doors — **refuse coded and write nothing**. Whether the
  write doors should instead scaffold on demand is a **PO decision**, and the scenario is the place to
  change it.
- **The overlay creates a NEW false-finding class in `lifecycleCompletenessGroup`.** The overlay makes
  STATUS cache-authoritative while the doc-presence and children maps stay DISK-derived — so a
  worker-authored milestone reported `done` fires `missing-verification` + `missing-retrospective` +
  `milestone-no-stories` against every remote milestone. Two candidate cures (overlay the doc/children maps
  from the cache too, since 43/03 streams exactly those artifacts; or gate those findings on
  `statusFrom === "disk"`) — **the architect's call.** `tasks/04` asserts the outcome, so it is green under
  either cure and red under neither.
- **A divergence finding needs a MESSAGE contract.** ADR-005 says `node_id` distinguishes a false status
  finding from a real one; the Finding shape is `{ code, severity, path, message }` and carries no
  provenance field. The finding's message must therefore NAME the node that last reported the authoritative
  status, or the two cases are black-box indistinguishable and `tasks/04`'s decisive pair cannot be
  asserted at all.
- **The reported degrade has no reader.** `reportDegrade` writes a coded JSONL line into the `degrade`
  sink, but `aof mesh logs` admits only procs `mesh-serve` / `mesh-ui`. Admitting `degrade` would make
  ADR-005's "explicit, reported degrade path" operator-visible rather than only file-visible.

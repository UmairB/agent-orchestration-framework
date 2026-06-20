---
doc: verification
ref: "05"
verified: 2026-06-19
verdict: "milestone accepted — seam (00–02) + memory-hooks (03) all done; hooks wired and proven over the live stream"
---
# 05 · Work Memory — Verification

> **Reopened 2026-06-19.** This record verifies and accepts the **seam** — stories `00`–`02`. After
> acceptance the milestone was reopened to add story `03_story_memory-hooks` (wire the seam into
> `refine`/`continue`/`verify`), because a callable seam nothing invokes leaves the objective unmet.
> Stories `00`–`02` stay accepted; story `03`'s evidence is appended here when it is built and verified.

Verification lanes in scope: **`@executable` (13) + `@manual` (1)**. There are **zero `@uat`**
scenarios — memory is a CLI/foundational subsystem with no human-judgement surface — so no human
sign-off lane applies and the user is not pulled in. No UI / `DESIGN.md`, so no design-conformance
lens.

## Verification evidence

- **`@executable` suite — green.** `npm test` → 518 ok / 0 not-ok (exit 0); `npm run test:unit` →
  539 ok / 0 not-ok (exit 0). Story behaviours are exercised by `test/work-memory-seam.test.mjs`
  (story 00), `test/memory-indexing.test.mjs` (story 01), `test/memory-retrieval.test.mjs` (story 02),
  and `test/memory-integration.test.mjs` (the wired CLI→seam→local→disk stack).
  verifies → all 13 `@executable` task features under `stories/*/tasks/*.feature`.
- **Fitness functions — green.** The 6 ADR arch-tests `test/arch/acd-memory-*.test.mjs` all pass:
  `acd-memory-backend-interface`, `acd-memory-backend-selection` (ADR-002),
  `acd-memory-derived-index` (ADR-001+005), `acd-memory-index-location` (ADR-005),
  `acd-memory-ranking` (ADR-006), `acd-memory-recall-contract` (ADR-004). The review-gate rewording
  of `acd-memory-ranking` test 3 (now asserts the honest combined-signal property, not
  length-normalisation in isolation) is confirmed green.
  verifies → the structural invariants in [ARCHITECTURE.md](ARCHITECTURE.md) `## Fitness functions`.
- **`@manual` — live-stream corpus (agent-run observation).** Procedure: ran the real
  `aof work memory reindex --all` (local backend) over the live `wiki/work` stream into a temp
  project root — the derived index landed only in the temp `.aof/`; **nothing was written into the
  repo's `.aof/`** (it stays git-ignored regardless). Result: `recordCount = 34 = 4 lesson(s) +
  30 adr(s)`, an **exact match** to ground truth computed independently from the `.md` files
  (`## R<n>` headings across RETROSPECTIVE files = 4; `## ADR-NNN` headings across ARCHITECTURE files
  = 30). Sampled record `source` (`path:line`) values resolve to the live headings (spot-checked
  R1 → `01_milestone_acd-asset-bundle/RETROSPECTIVE.md:12`, R2 → `…/RETROSPECTIVE.md:27`).
  verifies → `01_story_local-backend-indexing/tasks/05_live-stream-corpus.feature`.
- **Objective met (end-to-end demonstration).** Against the same live index:
  `recall "requiring grep fitness function smell"` ranks **R1** (a milestone-01 lesson) **#1 at
  16.96**, well above the ADRs (~3.8); `recall "pin line endings cross platform"` ranks **R2 #1 at
  21.64** at its real RETROSPECTIVE source; `brief` reports "4 lesson(s), 30 adr(s)" + lessons-by-area
  seam-side. The spike's F1 inversion does **not** recur (lessons rank first), so a lesson first
  written in milestone N reaches a decision-maker building milestone N+1 — the milestone's objective.

## Validate gate

`aof:validate 05` → **PASS**. CLI `aof work validate 05` exits 0 and the whole-stream
`aof work validate` exits 0 (folder↔frontmatter, closed tag vocabulary incl. the new `@memory`
domain, depends graph). Agent layer clean: every `@executable` scenario is backed by a green test
module; the single `@manual` row is discharged above with a `verifies →` pointer; no `@uat` row owed;
no dangling `@finding-<id>`; litmus clean (Then-steps assert observable CLI/file outcomes — record
counts, ranked order, JSON shape — not implementation or visual fidelity).

## Accept decision

**Accepted — 2026-06-19.** Gate `aof:validate 05` is PASS, the `@executable` + fitness + `@manual`
lanes are all green, and **no blocker finding is open** (none were raised in verification; the
review-gate frictions were resolved before this gate and distilled into
[RETROSPECTIVE.md](RETROSPECTIVE.md)). All three stories are `done`, so the milestone is accepted:
`SPEC.md status: done`, its `## Stories` boxes ticked, `STATE.md` compacted. No human `@uat` lane
existed, so no user sign-off was required. Milestone 05 is a leaf — **no milestone `depends:` on it** —
so accepting it unblocks nothing downstream; it completes the work-memory seam for the later semantic
(MemPalace) backend and the deferred read/write hooks to build on.

---

# Story 03 (memory-hooks) — Verification

Verified 2026-06-19 (`aof:verify 05/03`) — the story the milestone reopened for. Lanes in scope:
**`@executable` (tasks 00 + 04) + `@manual` (tasks 01 / 02 / 03)**, **zero `@uat`**. No UI / `DESIGN.md`,
so no design-conformance lens. With story 03 accepted, all four stories are `done` and the milestone
closes (this evidence is the appendix the seam-close record reserved above).

## Verification evidence

- **`@executable` suite — green.** `npm test` → 611 ok / 0 not-ok (exit 0); `npm run test:unit` →
  632 ok / 0 not-ok (exit 0). Story-03 behaviours: `test/memory-recall-block.test.mjs` (task 00 — the
  injection render, 5 scenarios: bounded to the hook limit, scope-filtered before render, highest-first,
  each line carries `id (m<item>) · kind · area · title · source` with colliding ids kept distinct, empty
  recall → empty block) and `test/memory-hooks-inert.test.mjs` (task 04 — 7 cases: refine/continue read
  hook + ingest write hook are silent no-ops under `none` AND `absent`, end-to-end clean). Both modules
  are wired into both runners (`scripts/test*.mjs`).
  verifies → `00_recall-block-injectable.feature`, `04_hooks-inert-when-memory-off.feature`.
- **Fitness functions — green.** All 6 ADR arch-tests `test/arch/acd-memory-*.test.mjs` pass in the run;
  notably `acd-memory-backend-selection` (ADR-002) stays green — the no-op-when-off guard rides on the
  `none` backend and **no bundled prompt branches on the backend name** (the hooks run the verb
  unconditionally; absence ≡ `none` makes it inert).
  verifies → the structural invariants in [ARCHITECTURE.md](ARCHITECTURE.md) `## Fitness functions`.
- **`@manual` 01 — refine read hook (architect role-scope) — discharged (agent-run).** Procedure: in a
  throwaway project root (`memory.backend: "local"`, `work.dir` → the live `wiki/work`; the derived index
  landed **only** in the temp `.aof/` — the repo's `.aof/` was never written), ran the architect's wired
  step `aof work memory recall "<decision keywords>" --area architecture --block`. Result: a compact block
  — **every line an `architecture`-area record**, ordered highest-relevance first, capped at `HOOK_LIMIT`
  (5; `--limit 3` → 3), one line per record as `id (m<item>) · kind · area · title · source`. It surfaced
  `R2 (m05)` ("a fitness function … must neutralise the others or it proves the wrong property") and
  `R1 (m02)` ("a test that asserts a string/fixture shaped to pass proves the shape, not the effect") — a
  near-miss + blocker an architect authoring ADRs would heed. Wiring confirmed in
  `src/bundle/commands/refine.md` (recall before any ADR is authored; acknowledge surfaced near-misses in
  ARCHITECTURE/STATE).
  verifies → `01_refine-read-hook.feature`.
- **`@manual` 02 — continue read hook (developer domain + near-miss) — discharged (agent-run).** Procedure:
  same live root, ran the developer's wired step `aof work memory recall "<domain keywords>" --kind
  near-miss --block`. Result: the block held **only `near-miss` records** (the `--kind` pre-filter is
  hard), highest-first, bounded; it surfaced `R2 (m01)` ("content-addressed artifacts must pin line
  endings or cross-platform CI hashes diverge") — exactly the class of gotcha the milestone objective
  named. Wiring confirmed in `src/bundle/commands/continue.md` (recall before build).
  verifies → `02_continue-read-hook.feature`.
- **`@manual` 03 — verify ingest write hook — discharged (agent-run + count assertion).** Procedure: at
  this Accept, **after** the milestone's `RETROSPECTIVE.md` was extended with **R5** (the story-03
  colliding-ids lesson, triaged below), ran the wired `aof work memory ingest` over the live stream.
  Result: `status` recordCount went **47 → 48** (the new R5 folded in); a recall over R5's terms ranks it
  **#1** in the injected block — `R5 (m05) · near-miss · code · …` at its live source
  `05_milestone_work-memory/RETROSPECTIVE.md:88` (spot-checked: line 88 is the R5 heading). So a lesson
  written at this Accept is recallable at the next milestone's decision points. Wiring confirmed in
  `src/bundle/commands/verify.md` (ingest after RETROSPECTIVE is written, before the Feedback section is
  archived).
  verifies → `03_verify-ingest-write-hook.feature`.
- **Portability no-op — corroborated live (beyond the fixtures).** Against the **repo's own** config (no
  `memory` key ≡ `none`, ADR-002), the read hook surfaced an **empty block and exited 0**, and `ingest`
  reported `recordCount 0` writing **no index file** (repo `.aof/` unpolluted). This is task 04's guarantee
  observed on the real project, not only the unit fixtures: a project that never opts in is byte-for-byte
  unaffected.

## Findings

- **F1 · injection block dropped milestone provenance (colliding ids).** Observed: the first
  `renderRecallBlock` led each line with a bare record `id`, but ids collide across milestones
  (`R1`/`R2`/`ADR-002` recur), so a real recalled block held indistinguishable `R1 · near-miss · …`
  lines — the agent could not tell which milestone a lesson came from. **Type:** design-gap (render
  correctness). **Severity:** blocker-to-usability (the block is unusable, though the suite was green).
  **Triage (PO):** fixed at the **story-03 review gate, before `in-review`** — the id field is now
  `id (m<item>)` and the task-00 `@executable` fixture switched to colliding ids matched by `source`;
  behavioural (real-corpus) review caught what structural review (unique-id fixtures) missed.
  **Routed-to:** `aof-developer` (fix landed) + distilled into [RETROSPECTIVE.md](RETROSPECTIVE.md) **R5**.
  **Status:** closed. No open finding remains.

## Validate gate

`aof:validate 05` → **PASS** (with story 03 in scope). CLI `aof work validate 05` and the whole-stream
`aof work validate` both exit 0 (folder↔frontmatter, closed tag vocabulary incl. `@memory`, depends
graph). Agent layer clean: each story-03 `@executable` scenario is backed by a green wired test module
(tasks 00, 04); each `@manual` scenario (01/02/03) is discharged above with a `verifies →` pointer and a
recorded procedure + result; **zero `@uat`** owed; no dangling `@finding-<id>` (F1 closed); litmus clean —
Then-steps assert observable CLI/file outcomes (block line shape, scope filter, `recordCount`, ranked
order, exit codes, no-file-written), never prompt text or visual fidelity (the read hooks are verified by
agent observation that recall ran and was considered, **not** by grepping a prompt for "recall").

## Accept decision (story 03 → milestone close)

**Accepted — 2026-06-19.** The gate is PASS, the `@executable` + fitness + all three `@manual` lanes are
green/discharged, and **no blocker finding is open** (F1 was resolved before `in-review`). Story
`03_story_memory-hooks` → `status: done` and its `SPEC.md` `## Stories` box is ticked. With all four
stories `done`, the milestone is accepted: `SPEC.md status: done`, `STATE.md` compacted, and the STATE
`## Feedback (for retro)` note graduated into RETROSPECTIVE **R5** then archived. No human `@uat` lane
existed, so no user sign-off was required. Milestone 05 is a leaf — accepting it unblocks nothing
downstream; it makes the seam **used** (recall at `refine`/`continue`, ingest at `verify`), so the
objective — "a lesson written in milestone N reaches the decision-maker in N+1" — now fires automatically
in the loop, not only when a human runs the verb.

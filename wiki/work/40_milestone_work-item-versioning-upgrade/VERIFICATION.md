---
doc: verification
milestone: 40
verified: 2026-07-17
verifier: aof:verify
verdict: in-progress
---
<!--
  Milestone VERIFICATION.md — the verification record. Pointers, not restatements.
  Only sections with content are written (absence of a section is information).
  Accumulated per-story as each is accepted; the milestone verdict lands when all stories are done.
-->
# 40 · Work-item versioning & the upgrade path — Verification

Lanes detected per story from the task feature tags. Story 01's three task features are **`@executable`
only** — no `@manual`, no `@uat`, no UI/`DESIGN.md` surface — so the human-acceptance step and the
design-conformance review are both out of scope for it.

## Verification evidence

### Story 01 · version stamp & reader (accepted 2026-07-17)

- **`@executable` suite green** — the story's 26 scenarios (`00_reader-schema-and-provenance` 8/8,
  `01_new-items-born-stamped` 5/5, `02_transform-scoped-writer-body-preserving` 13/13) pass, driven
  through the real reader API + the real `work:insert-milestone`/`work:insert-story` scaffold path
  against the committed templates. *verifies →* `stories/01_story_version-stamp-and-reader/tasks/*.feature`.
- **Both armed fitness functions green** — `acd-work-item-schema-single-constant` (the constant is a
  monotonic int; missing `schema` reads 0; the registry-max half stays guard-if-present until story 02)
  and `acd-migration-writer-body-preserving` (now hardened to exercise `applyItemFrontmatter` itself —
  body byte-identity while the frontmatter block is rewritten, a frontmatter-looking body line survives
  verbatim). Confirmed via a focused run of the 31 affected cases → 31/31.
- **Structural review PASS** (aof-architect) — `src/work.mjs` is purely additive (91 insertions, 0
  deletions; `aof graph impact` unchanged at 3 deps, no new import edge, no `work-upgrade.mjs`
  dependency); the writer rewrites only the `---…---` block byte-preserving the body; the born-stamp is
  on the true canonical bundle-template scaffold path; `acd-bundle-manifest-hashes` stays green.
- **Behavioural review PASS** (aof-qa) — 26/26 scenario→test mapping faithful, litmus-honest (every
  Then observes the reader return / on-disk bytes / a real CLI scaffold, no source-read), contract not
  weakened (body-byte-identity is a genuine byte compare; `schema: 2` reads 2 un-clamped; `aofVersion`
  equals the runtime `packageVersionString()`, not a pinned literal).
- **`aof work validate 40/01` → PASS** (exit 0, `[]`) — folder↔frontmatter, tag vocabulary, depends
  graph clean.

### Story 02 · migration registry & `aof upgrade` (accepted 2026-07-17)

- **`@executable` suite green** — the story's 24 scenarios (`00_registry-contiguous-chain` 5/5,
  `01_upgrade-dry-run-then-apply` 5/5, `02_upgrade-idempotent` 4/4, `03_stamp-transform` 6/6 executable,
  `04_reconstructed-marker` 4/4) pass, driven against fixture streams + real `aof upgrade`/`aof work
  upgrade` CLI spawns. *verifies →* `stories/02_story_migration-registry-and-upgrade/tasks/*.feature`.
- **`@manual` — the live-stream backstamp (the milestone's headline delivery).** Ran `aof upgrade` over
  the aof repo's own stream: **170 record docs** at schema 0 stamped to `schema: 1` + `aofVersion: 0.1.0`
  through the `stamp-0-to-1` transform. **Procedure + result:** `aof upgrade --dry-run --json` reported
  170/170 pending → `aof upgrade` applied → `git diff --shortstat` = **170 files, 340 insertions, 0
  deletions** (exactly the two frontmatter keys per item; every authored body byte-identical — the
  ADR-004 bound held on the live stream) → `aof work validate` (whole stream) = `[]` green → a second
  `aof upgrade --dry-run` = **0 pending** (idempotent). Committed as `2a8f9dd`. *verifies →*
  `03_stamp-transform-backstamps-unstamped.feature` `@manual`.
- **Four armed fitness functions green** — `acd-upgrade-idempotent`, `acd-upgrade-engine-blast-radius`
  (`work.mjs` never imports the engine — graph-confirmed), `acd-reconstructed-marker-expressible`, and
  `acd-work-item-schema-single-constant` (registry-max === constant, now armed).
- **Structural review PASS** (aof-architect) — the three modified registry-guard tests
  (`acd-work-command-cli-bijection`, `acd-work-command-route-coverage`, `command-core-contract`) are
  **honest additive registration** of the genuinely-wired `work:upgrade` command (an `argsFor` probe
  case, a precedented `BOARD_DEFERRED` carve-out, the forced `WORK_IDS` exact-bijection entry) — no
  assertion weakened; all frontmatter writes go only through `applyItemFrontmatter`; the reconstructed
  marker is readiness-only (no reconstructing transform ships).
- **Behavioural review PASS** (aof-qa) — 24/24 coverage faithful, the `@manual` correctly deferred (a
  live non-mutating dry-run confirmed 170/170 still pending pre-backstamp — not silently applied),
  litmus-honest, idempotency byte-compared, the newer-than-build refusal a genuine whole-run refusal.
- **`aof work validate 40/02` → PASS** (exit 0, `[]`).

### Story 03 · staleness in validate (accepted 2026-07-17)

- **`@executable` suite green** — the 4 scenarios / 6 assertions (`00_validate-flags-behind-item-naming-upgrade`)
  pass: an item behind the current schema (unstamped→0, or `schema: 0`) is flagged with a `{path, problem}`
  finding whose message names the literal `aof upgrade` and identifies it as "behind the current schema";
  a `schema: 1` item is not flagged; an up-to-date stream stays `[]`; the finding is deterministic
  (byte-identical across runs) and enumerates no pending transforms. *verifies →*
  `stories/03_story_validate-staleness/tasks/00_*.feature`.
- **Whole-stream regression** — `aof work validate` (no scope) over the real repo → `[]` (all 170 record
  docs are schema 1 after story 02's backstamp), so the live check correctly reports zero staleness.
- **The ripple reviewed PASS** — structural (aof-architect): born-stamp completion for uat/spike/chore
  templates (+ `.aof` copies + a genuine content-hash manifest regeneration) and migrate-folder's native
  renders is correct + consistent; the validateWork change is additive with no new import edge
  (graph-confirmed); all bundle/blast-radius guards green. Behavioural (aof-qa): **all 17 fixture edits
  are honest current-item stamping — none hid a staleness/unstamped test, no assertion weakened**; story
  02's deliberately-unstamped fixtures were untouched; the 14 ripple-touched modules pass 250/250 in
  isolation.
- **`aof work validate 40/03` → PASS** (exit 0, `[]`).

## Findings

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| F-40-01 | Full-suite `memory-integration: status (real backend) agrees with the reindex it just built` fails `363 !== 370`: milestone 39's 7 `OUTCOME.md` records are counted in `recordCount` but the memory `status` verb has no `outcomes` bucket (only `lessons`/`adrs`/`summaries`), so the test's `lessons + adrs == recordCount` invariant is stale. Root-caused at the source (the 7 excess records are all `39_.../OUTCOME.md`). | pre-existing regression | non-blocker (for m40) | milestone 39 gap — `status` should count `outcomes` and the integration invariant should be `lessons + adrs + summaries + outcomes == recordCount`; NOT introduced by and NOT fixable within m40 story 01 (which never touches the memory index path — confirmed by both reviewers) | milestone 39 / a memory-`status` follow-up | open (deferred) |

<!-- F-40-01 is deliberately NOT triaged into a m40 @bug task: it is out of m40's scope (m39's delivery
     memory), and editing a milestone-39 integration test to accommodate m40 would be sweeping unrelated
     work into this milestone. Recorded here as the learnable trace of a discovered-during-m40 defect. -->

## Accept decision

**Story 01 — accepted (2026-07-17).** Its `@executable` contract and both armed fitness functions are
green, structural + behavioural review PASS, and the scoped `aof work validate 40/01` gates clean. The
one full-suite failure (F-40-01) is a confirmed pre-existing milestone-39 regression with zero overlap
with story 01's surface, so it does not gate this story.

**Story 02 — accepted (2026-07-17).** Its 24 `@executable` scenarios + the `@manual` live-stream
backstamp (170 items → schema 1, purely additive, validate-green, idempotent) + four armed fitness
functions are green; structural + behavioural review PASS (the registry-guard edits confirmed honest
additive registration); scoped `aof work validate 40/02` clean. The milestone stays `in-progress`
(stories 03–04 remain). Note: with the live stream now backstamped to schema 1, story 03's staleness
check will report zero staleness on the up-to-date stream — the correct post-backstamp state.

**Story 03 — accepted (2026-07-17).** Its 4 `@executable` scenarios are green, the cross-cutting ripple
(born-stamp completion + ~17 fixture stamps) reviewed PASS as legitimate (no hidden failure, no weakened
assertion), whole-stream + scoped validate clean. The milestone stays `in-progress` (story 04 remains).

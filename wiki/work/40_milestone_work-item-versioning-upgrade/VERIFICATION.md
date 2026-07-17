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
with story 01's surface, so it does not gate this story. The milestone stays `in-progress` (stories
02–04 remain).

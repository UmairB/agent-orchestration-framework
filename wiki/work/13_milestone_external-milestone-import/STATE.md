---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 13 · External Milestone Import — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-22` (`aof:add-milestone`).
- Broken down + contracts authored `2026-06-22` (`aof:refine 13 --autonomous`) into **four** stories
  (00 spine → 01/02 fan out, 03 fitness). Status → `in-progress`. See `SPEC §Stories`, `ARCHITECTURE.md`
  (5 ADRs + fitness table), and each `STORY.md`.
  - **00 · import-command-and-materialize** — not-started; 4 tasks authored (Three Amigos).
  - **01 · source-shape-recovery** — not-started; 3 tasks authored.
  - **02 · import-into-memory** — not-started; 3 tasks authored.
  - **03 · import-fitness** — not-started; 6 arch-tests tracked (no `.feature`).
- Built + reviewed `2026-06-23` (`aof:continue 13`). Stories serialised on the spine + the shared
  test-registry (`scripts/test.mjs`): **00 → 01 → 02 → 03**. All `@executable` scenarios + the six
  fitness arch-tests green (`npm test`: **1151 ok, 0 not-ok**). Structural review (architect, via the
  story-03 fitness pass) found **no ADR invariant violation**; behavioural (qa) = **PASS-WITH-NITS**;
  craft (code-review) = **PASS-WITH-NITS**. All confirmed review fixes applied (see `§Feedback`). Story
  status → `in-review` (each `STORY.md`). **Awaiting `aof:verify 13`** for acceptance + sign-off.
  - **00 · import-command-and-materialize** — `in-review`; 4/4 task features green. Owns the
    `import:milestone` command (`src/commands/import-milestone.mjs`, registered in `command-core.mjs`),
    the `aof import` CLI dispatch (`cli.mjs`), the read-only source seam (`src/import/source.mjs`), the
    materialize writer + `.aof/imports/` store geometry (`src/import/{materialize,store}.mjs`), and the
    recovery + reindex SEAMS the siblings filled.
  - **01 · source-shape-recovery** — `in-review`; 3/3 task features green (aof-structured + arbitrary +
    the 2³ absence truth table). Filled `src/import/recovery.mjs`. `@manual` real-world-repo recovery
    DEFERRED (no example repos supplied — see `§Default decisions` + `§Feedback`).
  - **02 · import-into-memory** — `in-review`; 3/3 task features green. Extended `buildRecords`' scan to
    the import store + the leg-aware `source` resolver (`src/memory/local-indexing.mjs`) and wired the
    import→backend-`reindex` trigger. `@manual` graphify-backend recall DEFERRED (needs the live binary).
    **The load-bearing "import reaches memory" win.**
  - **03 · import-fitness** — `in-review`; 6/6 arch-tests green + registered, each proven non-vacuous
    (`test/arch/acd-import-*.test.mjs`).
- **Accepted `2026-06-23` (`aof:verify 13`).** `@executable` suite + the six fitness arch-tests green
  (`npm test`: **1151 ok / 0 not-ok**); the agent-run `@manual` lanes passed on a **real external repo** —
  recovery holds on `octocat/Spoon-Knife` (README→intent, 3 real commits→lessons, no fabricated decisions),
  the source is byte-untouched after import, and **import reaches memory** end-to-end (imported precedent
  recalled first through the unchanged verb). Two `@manual` slices deferred, neither a blocker: the
  remote-URL transport leg (`remote-source-unsupported` 501 — F13-1) and the graphify-extraction window
  (environment-bound). `aof:validate 13` **PASS**. All four stories → `done`; the milestone → `done`.
  Lessons distilled to `RETROSPECTIVE.md` (R1–R7). Evidence + findings in `VERIFICATION.md`.
- **Re-opened `2026-06-25` → `in-progress`.** Dogfooding the import on the voice-vox **pay-guard** testbed
  surfaced the gap milestone 14 had named + deferred: pay-guard's milestones are **intent-only** (a `## Goal`
  + `## Scope`, no `ARCHITECTURE.md`/`RETROSPECTIVE.md`), so each import materialized only `SPEC.md` (legible,
  not indexed — ADR-001) and contributed **zero** records — its intent was invisible to recall. Added one
  story to take the deferred 13×14 follow-up.
  - **04 · import-digest** — `done`. **ADR-006**: an import that recovers intent but no decisions/outcomes
    ALSO emits an `AOF.md` digest (milestone-14's doc type), each `## ` section indexed by the EXISTING
    `parseAof` → one `summary` record (zero-record case only; absence is information; byte-identical re-import).
    **ADR-007** enriched the digest to the canonical identity+provenance frontmatter (`importedAt` confined to
    the non-record-source digest, so ADR-005 byte-identity holds). Touches `src/import/materialize.mjs`
    (`renderDigest`) + recovery's `recovered.meta` + one line in `scanImportStore`. **No new parser/record
    shape/store.** Built + reviewed `2026-06-25`; `@executable` (`test/import-digest.test.mjs`, 6/6) + the
    seventh fitness arch-test (`acd-import-digest-recallable`) green. See ARCHITECTURE **ADR-006/007**.
- **Re-accepted `2026-06-25` (`aof:verify 13`).** `@executable` suite + all **seven** fitness functions green
  (`npm test`: **1247 ok / 0 not-ok**; the count grew from milestones 15–17 in flight — every milestone-13 test
  green within it). The story-04 agent-run `@manual` dogfood proof PASSES through the **real** `import:milestone`
  command + recovery engine: an intent-only source (pay-guard shape) materializes an `AOF.md` digest whose
  `## ` sections recall through the unchanged verb — zero records before story 04. `aof:validate 13` **PASS**.
  Story 04 → `done`; all stories done → the milestone → `done`. Lessons distilled to `RETROSPECTIVE.md`
  **R8–R9** (dogfood a thin source; identity+provenance frontmatter from the first cut); `aof work memory
  ingest` run (no-op, backend `none`). Evidence + the re-accept decision in `VERIFICATION.md`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Framing decisions (2026-06-22, via add-milestone Q&A):**
  - **Import target = knowledge / memory only** — an imported milestone is reference grounding, *not*
    a managed work item. No refine/continue/verify over it.
  - **Unstructured-source handling** — working hypothesis is to materialize a normalized
    `SPEC.md` + `OUTPUT.md` per imported milestone and index *those*. User flagged this as "not sure";
    the exact artifact shape is an open `refine` decision, not locked here.
  - **Refresh model = one-time snapshot** — re-run to refresh; no live sync / change-detection.
- **Resolved at refine `2026-06-22` (ARCHITECTURE.md, 5 ADRs):**
  - **Artifact shape (was "not sure")** → ADR-001: a **pair** — a recovered `SPEC.md` (legible intent,
    *not* indexed) + an `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped knowledge artifact reusing the 05
    heading conventions. **No new `OUTPUT.md` doc type and no new parser** — the EXISTING
    `parseArchitecture`/`parseRetrospective` index it (the `05/ADR-007` localised-additive bar is met by
    *reusing*, not adding). The "not sure" hypothesis is superseded by this.
  - **Command name + surface** → ADR-002: top-level `aof import milestone <repo> <selector>`, registered
    `import:milestone` Command, read-only via the `planning-init` `git`-argv-spawn idiom, with `--dry-run`.
  - **Index path** → ADR-003: feeds the **existing** 05/10 store by **extending the indexer scan** to the
    import store — confirmed, NOT a new store; graphify reached only by the backend via the 09 commands.
  - **Where artifacts live** → ADR-004: a dedicated `.aof/` import store outside `workDir`, git-ignored,
    non-`NN_type_slug` — so the work-item resolver never treats an import as managed/refinable work.

## Default decisions taken (autonomous `2026-06-22`)

<!-- `--autonomous` documented defaults for non-critical open questions. None is a blocking unknown or an
     unsafe/irreversible decision; each is recorded here and is cheap to revisit at build. -->

- **Example repos not yet collected — proceeded on a default.** The user offered example source repos at
  framing to ground the recovery heuristics on real shapes. None were provided by this autonomous refine,
  and collecting them is **not blocking** the doc-producing breakdown/contract stage: aof's own structure
  is the canonical aof-shaped fixture (this repo), and arbitrary-repo recovery (README + `docs/` + ADRs +
  git log) is a well-understood shape. **Default:** story 01 designs recovery against (a) an aof-shaped
  fixture + (b) a generic arbitrary-repo fixture, and **the user's real example repos are collected at
  `aof:continue 13/01`** to refine the heuristics against real shapes before the arbitrary-source recovery
  is locked. Story 01's STORY.md + its `tasks/01_recovers-arbitrary-repo.feature` (@manual for a
  real-world repo) carry this forward. _Revisit if the example repos reveal a source shape the generic
  fallback does not cover._
- **Merged the architect's proposed story 03 (graphify-path confirmation) into 03 · import-fitness** — the
  architect flagged it as an optional merge; the graphify interaction reduces to the
  `acd-import-no-graphify-spawn` arch-test, so it needs no separate production story. Final breakdown is
  four stories (mirrors 05's and 10's four).

## Feedback (for retro)

<!-- Archived at Accept (`aof:verify 13`, 2026-06-23 → R1–R7; re-open re-accept 2026-06-25 → R8–R9): the
     raw build/review notes graduated into RETROSPECTIVE.md, exactly as durable decisions graduate into ADRs.
     Kept as a pointer here, never restated — the lessons live in RETROSPECTIVE.md. -->

- Distilled into `RETROSPECTIVE.md` **R1–R7**: R1 user-controlled-URL must not inherit the constant-URL
  `shell:true` git idiom (security); R2 win32 `git` `shell:true` word-splits a multi-word arg + silent
  no-op; R3 a non-fatal `catch` must still log; R4 an off-topic-exclusion test must assert a TRUE
  zero-scoring record (m05 recall is ranked top-N, not thresholded) — also VERIFICATION F13-2; R5 promised
  real-world fixtures never arrived, so real-shape validation slipped to verify on a generic substitute;
  R6 a deferred transport leg should narrow its advertised surface, not 501 on the URL the help promises
  (→ VERIFICATION F13-1); R7 the ADR-004 category boundary rests on TWO independent facts (store geometry +
  `slugifySource`), not the folder prefix alone.
- Re-open (story 04) distilled into **R8–R9**: R8 happy-path fixtures hide whole input classes — the
  intent-only zero-record gap was invisible until dogfooding on a real spec-only source (pay-guard), extending
  R5; R9 a derived `.md` a human/tool will read needs identity+provenance frontmatter from the first cut
  (→ ADR-007).

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `npm test`: 1151 ok / 0 not-ok at verify `2026-06-23`; **1247 / 0** at the
  re-open re-accept `2026-06-25` (higher count = milestones 15–17 in flight; every milestone-13 test green)
- [x] Fitness functions green — the **seven** `test/arch/acd-import-*.test.mjs` registered + green (the six +
  `acd-import-digest-recallable`)
- [x] `@manual` assessed at verify (`VERIFICATION.md`): real-world arbitrary recovery (Spoon-Knife),
  source-untouched, and import-reaches-memory recall **PASS** on a real external repo; remote-URL transport
  deferred (F13-1) + graphify-extraction window environment-bound — neither a blocker (no `@uat` lane exists).
- [x] Re-open story 04 `@manual` (`VERIFICATION.md`, 2026-06-25): intent-only import → recallable `AOF.md`
  digest proven end-to-end through the **real** `import:milestone` command + recovery engine.

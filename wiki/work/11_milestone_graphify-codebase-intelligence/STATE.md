---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 11 · Graphify Codebase Intelligence — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- **Framed 2026-06-21** (`aof:shatter wiki/planning/PRD-graphify-integration.md`) → `not-started`.
  Spine only (SPEC objective + scope). A consumer milestone of the graphify arc — fans out from the
  09 foundation, in parallel with 10.
- **Refined 2026-06-22** (`aof:refine 11 --autonomous`) → `in-progress`. Architect authored
  [ARCHITECTURE.md](ARCHITECTURE.md) (6 ADRs + a 4-row fitness table); broken into **four** stories
  (00 spine; 01/02 the two prompt-wiring seams; 03 fitness). Contracts authored for 00/01/02 via Three
  Amigos (PO scenarios + aof-qa examples/tagging + aof-developer feasibility); 03 is fitness-only (no
  `.feature`). No researcher (09 done, contract known; 10 already proved the codebase build) and no
  designer (no UI). **Next:** `aof:continue 11` to build the wiring + the arch-tests.
- **Built + reviewed 2026-06-22** (`aof:continue 11`) → all four stories `in-review`. **ZERO production
  code** (ADR-002 held): the surface is the root `.gitignore` line (`graphify-out/`), the three bundle-prompt
  seams (`aof-architect.md` `<codebase-graph-grounding>`, `refine.md` step-2 boundary step, `code-review.md`
  step-3 triage step), the derived `bundle/manifest.json` regen, and the four `test/arch/acd-codebase-*`
  fitness tests (15 assertions, registered in `scripts/test.mjs`). **Full suite 1082 ok / 0 fail.**
  **Review verdicts — architect: CONFORMS** (6/6 ADRs; arch-tests faithful + non-vacuous; **dogfooded the
  new grounding live** — built a 275-node/549-edge graph over `src/`, queried it, read the markdown answer
  directly, aof never parsed it). **QA: PASS** (zero defects; contract↔seam fidelity confirmed; the
  @executable git-ignore facts verified directly). No blocking findings; one craft typo was already clean.
  **Next:** `aof:verify 11` — the `@manual` agent-observed sign-offs (architect cites graph coupling in a
  real review; refine draws a boundary from coupling; code-review surfaces a triage queue on a real PR; the
  no-op-when-absent + freshness + rebuildable observables) need the live binary + an agent and are recorded
  there.
- **Verified + accepted 2026-06-23** (`aof:verify 11`) → **`done`**. graphify 0.8.44 live, so the `@manual`
  lanes ran for real (not restated). `@executable` suite **1130 ok / 0 fail**; the four fitness arch-tests
  GREEN (15 assertions); the repo-root `graphify-out/` git-ignore resolves to root. `@manual`: a live
  `aof-architect` cited graph-derived coupling in a real structural review (**CONFORMS**); the refine +
  code-review seams carry the full convention and their `graph:query`/`graph:triage` mechanisms were
  confirmed live (triage queue legible but empty — 0 open PRs). `aof work validate` **PASS**. No `@uat`
  (no UI). Two non-blocker findings logged + deferred: **F11-1** (`graph:build` swallows graphify's exit
  status → opaque ENOENT; routed to the 09 build command) and **F11-2** (the no-op clause covers only
  `graphify-missing`, not a present-but-failing cold build over a docs-bearing `src/`; routed to the 11
  convention text). See [VERIFICATION.md](VERIFICATION.md); lessons distilled to
  [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4). All four stories `done`; milestone `done`.
- **RE-OPENED 2026-06-23** (accept retracted) → back to `in-progress`. The accept was premature: it
  certified prompt-text presence + a hand-instructed agent demo, not VALUE. Honest re-assessment
  (VERIFICATION `## AC re-assessment`): everything 11 delivered was trivial (a gitignore line) or
  vacuous-on-value (arch-tests asserting word-presence); the running agents got the FUZZY `graph:query`
  (similarity-seeded noise), and the m10 integrated payoff is broken (F11-4 shared-graph collision).
- **ADR-007 — a REAL consumer shipped 2026-06-23.** Superseded ADR-002's "zero production code": added
  **`aof graph impact`** (`src/commands/graph-impact.mjs`) — a DETERMINISTIC, edge-based coupling lookup
  (exact dependents + dependencies from `graph.json`, via the pure normalizer; no spawn, no LLM). Wired it
  as the **primary** grounding step in all three agent seams (architect/refine/code-review), demoting the
  fuzzy query to a hint. Registered + CLI dispatch + a NON-VACUOUS value test (`test/graph-impact.test.mjs`,
  6 cases) + the four `acd-codebase-grounding-*` arch-tests amended to ADR-007. **Full suite 1166 ok / 0
  fail.** A live `aof-architect` dogfooded it on the change itself: used `graph impact` to prove the
  negative coupling fact "`graph-impact.mjs` does NOT reach the spawn driver" (a fuzzy query can't prove an
  absence), returned CONFORMS, **and caught a real gap** — the bijection arch-test didn't cover the new
  `impact` verb (now fixed). **The running agent genuinely benefited.**
- **Remaining (milestone STAYS `in-progress`):** F11-6 — aof doesn't dogfood its own `.claude/` (stale,
  untracked, NOT bundle-rendered), so aof's OWN agents don't yet carry the `impact` step (downstream
  projects get it via `aof work update`); F11-4 — the m10 re-rank collision. No premature re-accept.

## Default decisions taken at refine — graduated to ADRs at accept

<!-- The four `--autonomous` refine defaults (documented for review) were reviewed at the continue + verify
     gates and stand as Accepted ADRs; compacted to a pointer per the accept discipline (durable decisions
     graduate into ARCHITECTURE.md, the blow-by-blow archives). -->

- Grounding-delivery = agent-consumed command OUTPUT, never parsed (**ADR-001**); pure prompt-wiring / zero
  production code (**ADR-002**); build-fresh-at-the-decision-point freshness (**ADR-003**); codebase build
  scope = the source root (**ADR-005**). See [ARCHITECTURE.md](ARCHITECTURE.md) — all Accepted.

## Feedback (for retro) — archived at accept

<!-- The raw refine/build notes that lived here were triaged at aof:verify (2026-06-23) and have graduated
     to RETROSPECTIVE.md R1–R4 (and, where applicable, to VERIFICATION findings F11-1/F11-2/F11-3). Archived
     per the compaction discipline (lessons graduate exactly as durable decisions graduate into ADRs). -->

- Lessons distilled → [RETROSPECTIVE.md](RETROSPECTIVE.md): **R1** no-op-when-absent must cover
  present-but-failing (F11-2); **R2** wrap-a-subprocess commands must check exit status, not read output
  blind (F11-1); **R3** `graph:query` is similarity-seeded — phrase around concrete symbols, treat as
  advisory; **R4** verify a wrapped tool's actual arg-mapping/corpus-shape at refine, not the verb name.
- Carry-forward (cross-milestone, non-blocker): `.aof/aof.memory.graphify.index.json` (m10's memory store)
  is still un-ignored at the repo root — VERIFICATION **F11-3**, routed to milestone-10 hygiene.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Origin (2026-06-21).** Shattered from [PRD-graphify-integration.md](../../planning/PRD-graphify-integration.md).
  The highest-leverage consumer: a codebase graph grounding the architect (structural review), refine
  (story boundaries), and code-review (PR-impact triage) — reached through the 09 graph commands.
- **Carry-forward to refine.** The win is the *wiring* into refine / continue / code-review (the 05
  story-03 "wire the seam into the loop" precedent), not graph availability alone. Hold the line on
  advisory-only — no automated gate or merge acts on graph findings.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — 1130 ok / 0 fail ([VERIFICATION.md](VERIFICATION.md))
- [x] Fitness functions green — the four `acd-codebase-*` arch-tests (15 assertions)
- [x] `@manual` signed off — architect coupling **CONFORMS** live; convention + seams confirmed (F11-1/F11-2 deferred)

---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  COMPACTED at Accept 2026-06-25: durable decisions graduated to ADR-001..006 (ARCHITECTURE.md),
  lessons to RETROSPECTIVE.md R1–R5, evidence to VERIFICATION.md — the blow-by-blow is archived
  there, not restated.
-->
# 15 · Work Doctor Core — State

## Progress

<!-- Story-by-story roll-up; the source of truth for each story's status is its own STORY.md frontmatter. -->

- **Framed 2026-06-25** (`aof:shatter`) from
  [PRD-work-artifact-health.md](../../planning/PRD-work-artifact-health.md) (origin). The work stream had a
  validity lane (`aof work validate`) but no cross-item **health** lane; this milestone adds `work:doctor`,
  mirroring the config `validate`/`doctor` split. Depends on **08 · cli-command-core**.
- **Refined 2026-06-25** (`aof:refine 15 --autonomous`) — architect recorded **ADRs 001–006**
  ([ARCHITECTURE.md](ARCHITECTURE.md)); broken into **four independent stories** (00 spine · 01/02/03 fan
  out), contracts authored (Three Amigos). Memory recall ran empty (backend `none`). Build order 00 → {01,02,03}.
- **Built + reviewed 2026-06-25** (`aof:continue 15`) — built in order 00 → {01,02,03}; suite green between
  waves. Story 00 shipped the engine (`src/work-doctor.mjs`: `doctorWork` + the `CHECK_GROUPS` registry +
  snapshot-with-mtime-probe + injectable clock), the command (`src/commands/doctor.mjs`), the CLI +
  `/api/work/doctor` faces, the generalised bijection tests + four fitness functions, and two seed groups; 01
  appended coherence + lifecycle-completeness (`work-doctor-coherence.mjs`); 02 appended freshness +
  structural-integrity (`work-doctor-freshness.mjs`, + `work.roadmap` schema key); 03 wired the keystone.
  Review gate **QA PASS / architect PASS-WITH-FINDINGS (all minor) / craft no-blockers**; minor findings fixed
  in one pass (de-dupe key separator → NUL; determinism fitness grep extended to the GROUP modules; zoneless
  date-time parses as UTC; stream-level findings reported regardless of scope; symlink-recursion guard). Suite
  **1233 ok / 0 not ok**. Durable decisions live in **ADR-001..006**; process lessons graduated to
  **RETROSPECTIVE.md R1–R5**.
- **Verified + accepted 2026-06-25** (`aof:verify 15`) — `@executable`-only milestone (no `@manual`/`@uat`, no
  UI). Suite **1233 ok / 0 not ok** + all five m15 fitness functions green (ADR-001 envelope · ADR-002 `--strict`
  exit matrix · ADR-003 determinism + no-wall-clock · ADR-005 registry-derived route↔command bijection · 15-03
  keystone). Real-stream smoke confirmed the green is honest end-to-end (doctor surfaces 53 advisory warnings /
  0 errors across the stream; `--strict` → exit 1). The deferred QA flag (`mtime-ahead-of-updated` date-only-vs-
  timed semantics) confirmed against its pinned `@executable` Examples. `aof:validate 15` gate **PASS** (validity
  + health lanes); no blocker finding open. All four stories done → **milestone accepted**. Evidence + accept
  decision → [VERIFICATION.md](VERIFICATION.md).
  - **00** done · **01** done · **02** done · **03** done.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `npm test` → 1233 ok / 0 not ok (2026-06-25).
- [x] Fitness functions green — ADR-001 envelope, ADR-002 `--strict` exit, ADR-003 determinism + no-wall-clock,
      ADR-005 both registry-derived bijections (+ the third `WORK_IDS` site), 15-03 keystone.
- [x] No `@manual` / `@uat` / UI lanes in scope — foundational/technical milestone; agent-runnable smoke recorded
      in VERIFICATION instead. Accepted via `aof:verify 15`.

<!-- ARCHIVED at accept (2026-06-25): the `## Notes & decisions in flight` (incl. the ADR-004 ROADMAP
     folder-first default), the build blow-by-blow, and the `## Feedback (for retro)` notes have all graduated —
     the decisions into ADR-001..006 (ARCHITECTURE.md), the lessons into RETROSPECTIVE.md R1–R5, the evidence
     into VERIFICATION.md. History is preserved there; not duplicated here.
     Forward note: **16 · context-budget-lint** depends on this milestone — it appends a doc-bloat check-GROUP
     into the ADR-003 `CHECK_GROUPS` registry (no new command), so R1's three-place bijection caveat does not
     apply to it; R3's family-glob determinism guard does. -->

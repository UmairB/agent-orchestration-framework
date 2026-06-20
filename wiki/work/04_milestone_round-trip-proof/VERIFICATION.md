---
doc: verification
---
<!--
  Milestone VERIFICATION.md — answers ONE question: is it truly done, and on what evidence?
  Owner: aof:verify. Pointers, not restatements. Findings live HERE, never in a task folder.
  Write only sections that have content (absence of a section is information).
-->
# 04 · Round-trip Proof — Verification

## Verification evidence

All milestone-04 lanes are green — **49/49** scenarios + fitness functions, **0** milestone-04 failures.

- **`@executable` suite** — `node scripts/test-unit.mjs` → **702 ok / 0 not ok** (fully green).
  `node scripts/test.mjs` is also fully green (**777 ok / 0 not ok**, confirmed deterministic across
  re-runs). _During the verify sweep it transiently showed 9 `acd-headroom-*` failures that did **not**
  reproduce — see Finding F-01 (withdrawn): milestone 06 is built + accepted with all 5 headroom fitness
  functions green, and they are isolated (`mkdtemp` + explicit `targetDir`)._ No milestone-04 lane ever failed.
  - Harness BDD (story 00, tasks 00–02) — `test/roundtrip-harness.test.mjs` green.
    _verifies →_ `stories/00_story_roundtrip-harness/tasks/{00_isolated-repo,01_real-install,02_seed-sample-milestone}.feature`
  - Install-proof (13 cases) — `test/roundtrip-install-proof.test.mjs` green.
    _verifies →_ `stories/01_story_install-proof/tasks/{00_renders-bundle,01_work-lock-section,02_verbs-resolve}.feature`
  - Loop-proof spine (21 cases: 13 `validate` + 8 `next`) — `test/roundtrip-loop-proof.test.mjs` green.
    _verifies →_ `stories/02_story_loop-proof/tasks/{00_validate-gates,01_next-orders}.feature`
- **Fitness functions** — all four green:
  `acd-roundtrip-isolation` (ADR-001), `acd-roundtrip-reuses-shipped-code` (ADR-002/003),
  `acd-roundtrip-harness-contract` (ADR-005), and the `acd-roundtrip-registration` no-drift meta-test.
  _verifies →_ `ARCHITECTURE.md` § Fitness functions + `stories/00_story_roundtrip-harness/tasks/03_register-arch-tests.feature`
- **Structural gate** — `aof work validate` → **PASS — work stream is well-formed** (exit 0).
- **`@uat` (`02_roundtrip-signoff`)** — the irreducibly agent-driven loop sign-off (ADR-003).
  Procedure, captured evidence, and sign-off live in [UAT.md](UAT.md). **Pending the human** — the
  milestone's single gate. _verifies →_ `stories/02_story_loop-proof/tasks/02_roundtrip-signoff.feature`

No `@manual` (agent-runnable) scenarios in scope; no UI surface (no `DESIGN.md`), so no design-conformance lane.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F-01 | **WITHDRAWN — false alarm.** During the sweep `node scripts/test.mjs`/`check.mjs` transiently showed 9 `acd-headroom-*` failures; I mis-diagnosed them as milestone-06 "RED-until-built" tests registered prematurely. In fact **milestone 06 is built and accepted** (`aof:verify 06`, 2026-06-20) with all 5 headroom fitness functions green, and on re-run the suite is **777 ok / 0 not ok** (deterministic across two runs). The headroom tests are isolated (`mkdtemp` + explicit `targetDir`), so they don't depend on dev-repo state. The transient was not reproducible (likely a stale Node/module or run state during the classifier-outage window). | (none — non-issue) | n/a | none — withdrawn after investigation; watch for flakiness if it recurs | — | withdrawn |
| F-02 | **@uat finding (round-trip, real adopting repo `voice-vox-cadence`).** `aof work init` establishes **no `.gitignore` baseline**. The notion of an aof-managed `.gitignore` exists but is split + never wired into init: `workspace-writer.mjs` writes one for the *global* workspace (`/work/`); `render-plan.mjs` supports a `gitignore` resource *kind* (no-clobber guard) but the work bundle ships no such member; `memory/local-indexing.mjs` `ensureGitignored()` idempotently appends `.aof/aof.memory.index.json` — but only lazily on `reindex`/`ingest`, not at install. Latent correctness gap: a user who commits after a memory run-before-append could commit the **derived** index (ADR-001 duplicate-authoritative-copy violation). Design intent per the code: `.aof/` and rendered `.claude/aof-*` members are **tracked**; only the derived memory index is ignored. | installer / design-gap | non-blocker (for 04) | route to 01 — **PO decision (2026-06-20): do NOT rely on / mutate the repo-root `.gitignore`; `aof work init` writes a self-contained nested `.gitignore` inside `.aof/` (concrete: ignore the derived `aof.memory.index.json`), and potentially one inside `.claude/` (scope TBD by architect — what, if anything, there is transient vs the committed install).** Supersedes the root-append in `memory/local-indexing.mjs` `ensureGitignored()` (which should also move to the nested `.aof/.gitignore`). | 01 · ACD Asset Bundle + work init/update | open (non-blocking) |

F-01 is withdrawn (a non-reproducible transient; the suite is green). **F-02 → 01** is the one real
finding: per ADR-004 the round-trip routes the installer gap back to its owning milestone — `aof work
init` should own the `.gitignore` baseline at install via a **self-contained nested `.aof/.gitignore`**
(PO decision), not the repo-root file. It was **implemented at the user's direction** after accept (see
Accept decision). No milestone-04 lane ever failed; `aof work validate` PASSes.

## Accept decision

**ACCEPTED — 2026-06-20.** All milestone-04 `@executable` lanes + fitness functions green;
`aof work validate 04` PASS; `aof:validate 04` PASS (traceability + litmus clean). The `@uat`
round-trip was driven in a **real adopting repo** and signed off **ACCEPT** by the user
([UAT.md](UAT.md)). Stories 00/01/02 set `done`; milestone `done`. Findings: **F-01 withdrawn** (a
non-reproducible transient; suite is green at 777/0 and milestone 06 is accepted). **F-02** (the one real
finding) was **implemented after accept at the user's direction**: `aof work init` now writes a
self-contained nested `.aof/.gitignore` (new `src/aof-gitignore.mjs`), and the memory backend's
git-ignore moved from the repo-root append to that nested file; `node scripts/test.mjs` → 777 ok / 0
not ok and `node scripts/test-unit.mjs` → 705 ok / 0 not ok with the change + new coverage.

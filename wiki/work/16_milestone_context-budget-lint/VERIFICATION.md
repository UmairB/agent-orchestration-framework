---
doc: verification
---
<!--
  Milestone VERIFICATION.md — answers ONE question: is it truly done, and what is the evidence?
  Written by aof:verify. Pointers, not restatements: each check names what it verifies and where the
  proof lives. Only sections with content are written (absence of a section is information).
-->
# 16 · Context-Budget Lint — Verification

Lanes in scope: **`@executable` only**. No `@manual`, no `@uat`, no DESIGN surface — this is a
foundational/technical milestone (one pure check-group plugged into the milestone-15 engine), so the
human-acceptance lane is correctly skipped and there is no design-conformance render. Verified by
`aof:verify 16` on 2026-06-25.

## Verification evidence

| Evidence | Result | verifies → |
|---|---|---|
| **Full automated suite** (`node ./scripts/test.mjs`) | **1247 ok, 0 not ok**, exit 0 | the whole regression sweep is green with the new group wired into the live `CHECK_GROUPS` registry |
| **`@executable` behaviour** — 7 scenarios / 32 Examples rows | all green (`doctor/16-00/budget …`) | `stories/00_story_doc-bloat-check-group/tasks/00_doc-over-budget.feature`, `…/01_configurable-budget.feature` → `test/doctor-context-budget.test.mjs` |
| **Fitness function — envelope conformance** (ADR-004) | green (`arch/16 ADR-004: every doc-over-budget finding is exactly { code, severity, path, message }, severity warn, anchored at the over-budget FILE`) | `test/arch/acd-context-budget-finding.test.mjs` |
| **Fitness function — config-sourced / no baked-in literal** (ADR-005) | green (both assertions: `budgetGroup` body holds no budget-magnitude literal; same SPEC flips finding↔no-finding low vs high budget) | `test/arch/acd-context-budget-config-sourced.test.mjs` |
| **Inherited invariant — determinism + no-wall-clock** (ADR-001/003, auto-covered by module name `work-doctor-budget.mjs`) | green (`arch/15 ADR-003: doctorWork is byte-identical across two runs`; `… NO doctor module reads the wall-clock … across the work-doctor* family`) | `test/arch/acd-doctor-engine-determinism.test.mjs` (unchanged) |
| **Inherited invariant — no-new-door bijection** (m15/ADR-005; m16 adds no `work:*` command) | green (route-coverage + cli-bijection sets) | `test/arch/acd-work-command-route-coverage.test.mjs`, `test/arch/acd-work-command-cli-bijection.test.mjs` (unchanged) |
| **End-to-end through the unchanged surface** — `node src/cli.mjs work doctor --json` over THIS repo | the check fires through the live `aof work doctor` face, emitting a single `doc-over-budget` warn finding in the frozen `{ code, severity, path, message }` envelope (see Findings F1) | the SPEC's "an outsider can verify it … surfaces a severity-tagged, coded doc-bloat finding through the unchanged `aof work doctor` surface" — demonstrated live, not just over fixtures |

m16's own context docs are all within their default budgets (SPEC 80 ≤ 300 · ARCHITECTURE 426 ≤ 700 ·
STORY 101 ≤ 150), so the milestone does not trip its own check.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| **F1** | Live `aof work doctor` over this repo surfaces one real `doc-over-budget` finding: `02_milestone_planning-init/ARCHITECTURE.md` is **725 lines, over the 700-line budget**. The default budget (700) is the contract value (ADR-005); the calibration survey in ADR-005 / STATE under-counted, claiming "zero findings over this repo today" while m02 sits 25 lines over. | calibration / non-blocker | warn | **non-blocker** — the check is working **as designed**: the code correctly implements the contract and a `warn` on the single longest ADR log in the repo is honest signal, not a defect in m16's deliverable. The open question is whether 725 (m02) is genuine bloat to trim or the architecture default should be recalibrated (e.g. 750). | **RETROSPECTIVE.md** (the decision belongs to the retro; already raised as STATE `## Feedback (for retro)`) | deferred — does not block acceptance |

No blocker finding is open.

## Accept decision

**ACCEPTED** — milestone 16, story 00 (`2026-06-25`, `aof:verify 16`).

- `@executable` suite + all fitness functions + inherited invariants **green** (1247 ok / 0 not ok).
- No `@manual` / `@uat` lanes — no human gate to broker; not pestered.
- Gate `aof work validate 16` → **PASS** (and the whole stream → PASS); test-traceability + litmus hold.
- The only finding (F1) is a **non-blocker** calibration item routed to the retrospective — it is the
  check working correctly, not a defect.

Story 00 → `done`; milestone SPEC → `done` (its single story is done).

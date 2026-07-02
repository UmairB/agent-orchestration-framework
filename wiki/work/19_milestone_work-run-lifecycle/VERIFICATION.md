---
type: verification
milestone: "19"
slug: work-run-lifecycle
verifier: QA
date: 2026-06-29
verdict: PASS (behavioural)
---

# Verification — milestone 19 · work-run-lifecycle

Black-box behavioural review of both stories as built. Verdict per feature below.
The `@executable` suite for all six task features is green (47/47 traceability
tests). No `@uat` / `@manual` / `@bug` scenarios exist; the a11y lane is OFF
(`work.tags.domains` carries no `"a11y"`), so no a11y check was run. No surface to
render, so no Playwright/`toHaveScreenshot` harness was in play.

## Per-feature behavioural verdict

| Feature | Verdict |
| --- | --- |
| 00 run-record-store | COVERED |
| 01 state-machine | COVERED |
| 02 derived-log-lifecycle | COVERED |
| 01/00 run-commands | COVERED |
| 01/01 cli-face | COVERED |
| 01/02 lifecycle-survives-restart | COVERED |

Coverage detail (the matrices the review called out specifically):
- 5×5 = 25-cell transition grid: COVERED cell-for-cell (`run-store-state-machine`
  iterates STATES×STATES and pins `legalCount === 5` against the exact legal set).
- Illegal-transition matrix (re-complete each terminal to every terminal incl.
  self + running self-loop + running→queued): all 14 rows COVERED, each asserting
  the persisted file is **byte-unchanged** via a real before/after `readFile`.
- sessionId Outline (both rows), run-complete ambiguity matrix (4 rows),
  run-start exact-resolver matrix (7 rows incl. `1`→ref-not-found), run-complete
  exact-resolver matrix (3 rows), CLI error matrix (6 rows incl. `bogus` AND `""`):
  all COVERED.
- Anti-gaming checks PASS: brief round-trip asserts both `deepEqual` AND
  `JSON.stringify` equality (key-order preserved) for flat AND depth-3 nested
  briefs — verified non-vacuous (a reorder breaks the stringify assert). "Writes
  nothing" re-reads file bytes before/after. "Frontmatter untouched" re-reads the
  record doc byte-for-byte.
- Restart is REAL: `run-lifecycle-restart` uses `spawnSync` of the real
  `bin/aof.mjs` — the read happens in a genuinely fresh OS process, not an
  in-memory store. The survives-restart scenario pins every frozen field (runId,
  state, outcome, attempt, sessionId, byte-equal brief, createdAt, itemRef).
- CLI single-envelope discipline: each error row asserts exactly one parseable
  JSON `{ ok:false, error, code:<code> }` on stdout with the right code and a
  non-zero exit; the discipline scenario additionally asserts trimmed stdout
  starts `{` / ends `}` (no human line). Confirmed live for `bogus` and `""`.

## Findings

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| F-19-01 | STATE.md §Verification carries `- [ ] @manual signed off — see UAT.md`, but no feature has a `@manual`/`@uat` scenario and no `UAT.md` exists. Stale template checkbox — there is no human-acceptance lane for this milestone. | design-gap (process) | low | retro — STATE template should drop the `@manual`/UAT line when a milestone ships zero `@manual` scenarios | author/retro | open |
| F-19-02 | `run-commands` "two running runs / first runId → completes that run as done" asserts the named run completed but does NOT assert the OTHER running run stayed `running` (unambiguous resolution touched only the target). Faithful to the feature text (which says only "completes that run as done"), so not a contract gap — a hardening opportunity. | enhancement | low | optional — add a "the sibling run is still running" assertion; flag the scenario text as under-specified for the retro | QA (own follow-on) / author | open |

Neither finding blocks acceptance. Behavioural verdict: **PASS**.

## Mis-specification flags (for retro — no feature edits proposed)
- `run-commands` ambiguity-matrix row (F-19-02): the "completes that run" rows
  under-specify the sibling-run invariant. The behaviour is correct as built; the
  scenario text could pin it.

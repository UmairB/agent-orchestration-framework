---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 21 · Board Run Observability — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-27` by `aof:shatter` from [PRD-work-run-orchestration](../../planning/PRD-work-run-orchestration.md)
  (the observability consumer).
- Refined `2026-06-30` by `aof:refine 21`: Decide docs authored — [ARCHITECTURE.md](ARCHITECTURE.md)
  (ADR-001 read route, ADR-002 read-mostly rerun, ADR-003 envelope/guard additivity + the fitness table)
  and [DESIGN.md](DESIGN.md) (the three surfaces, conformance source of truth =
  [mocks/work-board-runs.dc.html](mocks/work-board-runs.dc.html), the operator-supplied claude.ai/design
  export). Partitioned into **two** independent stories — `00 · run-observability` (read/render),
  `01 · rerun-affordance`. Both `not-started`; milestone → `in-progress`.
- Contract authored `2026-06-30` by `aof:refine 21 --autonomous` (cascade — Decide + Break-down were
  already complete, so this pass fanned out the Three Amigos over both stories). Five task `.feature`s
  authored (3 + 2), each behaviour tagged to one verification lane (`@executable` route + pure modules,
  `@manual` rendered surfaces, `@uat` the live launch / non-tearing poll); the structural invariants stay
  in the fitness table (no invariant-as-scenario). Both stories → `in-progress`. No blocking unknown or
  unsafe decision surfaced — nothing stopped early. Next: `aof:continue 21`.
- Built + reviewed `2026-06-30` by `aof:continue 21` (orchestrated; both stories built together since they
  co-locate in `DetailPanel.tsx`/`Board.tsx` and story 01 observes story 00's read-model — a one-directional
  dependency, so serialised, not worktree-split). Landed: the additive `GET /api/work/run-status` thin route
  (ADR-001); the pure `runs.mjs` (relative-time, current-run selection, the run-state chip ramp, the rerun
  verb, the in-flight predicate) + `runs.d.mts`; the RUNS tab / Current-run strip / newest-first history /
  poll-refresh / `↻ Rerun` affordance in `DetailPanel.tsx`; the lane-card in-flight pulse dot
  (`Board.tsx` probe + `BoardLanes.tsx`); `workApi.runStatus` + the `RunRecord` wire type. Fitness: the
  `acd-work-command-route-coverage` carve-out shrank (`run-status` left `BOARD_DEFERRED`) and
  `acd-board-write-isolation` was EXTENDED (not duplicated) over the run/rerun surface — three guards stay
  green untouched, no new arch-test file (ADR-003). **All `@executable` green (1534 unit, 0 failures); UI
  `tsc -b` clean.** Review: `aof-architect` → **CONFORMS** (all five ADR-003 invariants hold); `aof-qa` →
  coverage complete + contracts correct; `aof-designer` (rendered surfaces via Playwright → judged against
  the committed mock) → **CONFORMS**; craft pass → no blockers. Both stories → `in-review`. Next:
  `aof:verify 21`.
- **Accepted + compacted `2026-06-30` by `aof:verify 21`.** Both stories `done`; milestone `status: done`.
  Whole suite green (1535 `ok` / 0 fail); UI `tsc -b` clean; all `@executable` route + pure-module scenarios
  and all four fitness functions green (route-coverage bijection re-tightened — `run-status` left
  `BOARD_DEFERRED`; write-isolation EXTENDED; no-core-import re-asserted; list-contract untouched).
  `aof work validate` → **PASS**. The rendered `@manual` surfaces (1/2/3) were **operator-confirmed** live
  (board served at `:4178`, runs seeded via `work:run-start`/`run-complete`); the build-time design review had
  already judged **CONFORMS**. **`@uat` lane DEFERRED** by operator choice (no live agent provider this
  session) — two scenarios (non-tearing poll; real-launch rerun) recorded as an open non-blocker. One finding:
  **F1** — the all-`#1` attempt reading is faithful (fresh `run-start` ⇒ attempt 1), but DESIGN surface 1's
  "ordinal you count by" rationale doesn't survive the fresh-rerun path → non-blocking design-gap routed to
  `aof-designer`. Accept rationale → [VERIFICATION.md §Accept decision](VERIFICATION.md); process lessons
  distilled → [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4) and folded into memory (`work memory ingest`).
  Durable decisions live in [ARCHITECTURE.md](ARCHITECTURE.md) (ADR-001/002/003); the blow-by-blow above is
  the archived narrative.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- ~~Blocked until milestone 19 (work-run-lifecycle) lands the run records + registered `work:run-*`
  commands.~~ **Unblocked** — milestone 19 is `done` (the run-store + the three `work:run-*` commands are
  registered in the command core; the graph confirms `command-core.mjs` already imports `run-status.mjs`).
  Parallel-eligible with milestone 20.
- The three open-for-refine questions are **resolved** in the Decide docs:
  - ~~which run projection the board reads (and via which command)~~ → the already-registered
    `work:run-status` (`{ ref, runs[] }`), via one additive thin route `GET /api/work/run-status?ref=`;
    current-run state is the latest/in-flight element of the same `runs[]` (no second command). (ADR-001.)
  - ~~how the rerun affordance threads m20's fresh-vs-resume choice~~ → **read-mostly preserved**
    (operator's explicit choice): the rerun reuses the m03 ADR-006 terminal launch — `work:run-start`
    runs *inside the agent session*; the board adds **zero** new write. m21 ships the **fresh** path; m20's
    resume is a pure additive delta (the same forward-stability discipline by which m19 reserved `queued`).
    (ADR-002.)
  - ~~confirming the additive board envelope stays within the frozen m03 shapes + the m08 bijection /
    no-core-import guards~~ → confirmed: purely additive — no new arch-test file; the `15/ADR-005`
    route↔command bijection re-tightens (`run-status` leaves `BOARD_DEFERRED`) and `acd-board-write-isolation`
    is extended; three guards stay green untouched. (ADR-003.)

## Verification

<!-- Pointers, not restatements. Accepted 2026-06-30 — see VERIFICATION.md + §Accept decision. -->
- [x] `@executable` suite green — `board-run-status/00` (4 route) + `board-runs/00`+`01`+`01-rerun` (pure modules); full suite 1535 ok / 0 fail; UI `tsc -b` clean.
- [x] Fitness functions green — route-coverage bijection re-tightened (`run-status` left `BOARD_DEFERRED`) + write-isolation EXTENDED; no-core-import + list-contract green untouched.
- [x] `@manual` rendered surfaces (1/2/3) operator-confirmed live + build-time design **CONFORMS** — see [VERIFICATION.md §Rendered evidence](VERIFICATION.md).
- [ ] `@uat` DEFERRED (operator choice; no live agent provider) — non-tearing poll + real-launch rerun, open non-blocker (VERIFICATION §User sign-off).

<!-- §Feedback (for retro) ARCHIVED at Accept (2026-06-30): its four notes graduated into
     RETROSPECTIVE.md — R1 (the F1 attempt-ordinal design-gap), R2 (the lane-dot vs RUNS-poll freshness
     asymmetry), R3 (the fixed-width-panel tab-clip the rendered review caught), R4 (the QA-hardened pure
     read-model assertions) — plus the recall→build confirmation (19/R1 honoured: the route-coverage
     carve-out + write-isolation EXTEND) folded into the RETROSPECTIVE preamble. All folded into memory via
     `work memory ingest`. Lessons have a durable home; the running notes are retired. -->

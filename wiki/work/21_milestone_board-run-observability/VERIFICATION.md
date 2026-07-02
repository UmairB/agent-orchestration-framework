---
doc: verification
---
<!--
  Milestone VERIFICATION.md — the verification record for milestone 21.
  Owner: the verify orchestration. Write only sections that have content (absence is information).
  Evidence = pointers + procedure + result, never a restatement of the scenario.
-->
# 21 · Board Run Observability — Verification

## Verification evidence

The automated + agent-run lanes, executed at `aof:verify 21` on `2026-06-30`. All green; no human required.

### `@executable` suite — green (1535 ok / 0 fail; UI `tsc -b` clean)

- **Procedure:** `node ./scripts/test.mjs` (full suite) + `npx tsc -b` in `ui/`.
- **Result:** 1535 ok, 0 not-ok, exit 0; UI type-check exit 0.

| Evidence | verifies → |
|---|---|
| `board-run-status/00` — the route returns the item's runs through the registry; empty history is `{ ref, runs: [] }`, not an error; an unresolvable ref is a not-found, not a crash; the read changes no files. | story 00 / `00_runs-render-from-run-status.feature` `@executable` (4 route scenarios) |
| `board-runs/00` — `createdAt → "12m ago"/"1h ago"/"yesterday"/"2d ago"` relative formatter; history ordered newest-first **without mutating** the shared read-model. | story 00 / `00_runs-render-from-run-status.feature` `@executable` (relative-time outline) |
| `board-runs/01` — `selectCurrentRun` picks the single in-flight `running` (wins over recency), else most-recent by `createdAt` (tie-broken by runId), `null` for empty; the 5-state chip ramp (queued/running+pulse/done+✓/failed/cancelled); unknown state → quiet muted chip + not-in-flight (forward-compatible). | story 00 / `01_current-run-highlighted.feature` `@executable` (selection + chip ramp + unknown-state) |
| `board-runs/01-rerun` — `rerunVerb` resolves to a fresh `work:run-start` for the selected ref; `isInFlight` is true exactly when a `queued|running` run exists. | story 01 / `00_rerun-launches-terminal.feature` + `01_rerun-disabled-while-running.feature` `@executable` |

### Fitness functions — green (the structural deliverable)

| Fitness (arch-test) | Disposition | Result |
|---|---|---|
| `acd-work-command-route-coverage` | **EXTENDED** — `run-status` dropped from `BOARD_DEFERRED` (`= new Set(["run-start","run-complete","run-retry"])`); the `15/ADR-005` route↔command bijection re-tightens and hits `/api/work/run-status?ref=…`. | green |
| `acd-board-write-isolation` | **EXTENDED** — "the run READ route + the rerun affordance add no new board write and no command-CLI shell-out (milestone 21, ADR-002/ADR-003)". | green |
| `acd-work-ui-no-core-import` | re-asserted — `board-ui.mjs` reaches run state only through `command-core.mjs`; no `run-store.mjs` / `commands/run-*.mjs` import. | green |
| `acd-work-list-contract` | untouched — the additive route does not alter the frozen 7-field `work list --json` contract. | green |

verifies → ARCHITECTURE fitness table #1/#2/#4/#5 (ADR-001/002/003). Structural residue confirmed against the
source: the route exists at `src/board-ui.mjs:68` (`GET /api/work/run-status` → `invoke("work:run-status", {ref}, ctx)`,
zero operation logic, no path projection).

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F1 | A history of board reruns reads `#1 / #1 / #1` — every row shows attempt `#1`. This is **faithful rendering** of the m19 schema: a fresh `work:run-start` is always `attempt: 1` ([run-store.mjs:229-235](../../../src/run-store.mjs#L229-L235)); the number increments only on `work:run-retry`. But m21's `↻ Rerun` resolves to a **fresh** start ([runs.mjs:115-117](../../../ui/src/board/runs.mjs#L115-L117)), so the board's own rerun workflow never produces an ascending attempt — contradicting DESIGN surface 1's rationale that `#attempt` is "the human-meaningful ordinal the operator counts by" (example `#5`). The bold leading identity token is non-distinguishing across a fresh-rerun history (only `sess·…` + relative time disambiguate). Ascending attempts only appear once m20's resume/retry verb lands. | **design-gap** | non-blocking (faithful render; structural deliverable sound) | aof-designer to set the DESIGN.md rule — reconcile surface 1's attempt-ordinal rationale with the fresh-rerun reality (accept #1-repeats + lean on session/time, or reconsider the leading token, or scope the "count by" claim to m20's resume lineage). | open (non-blocking) |

<!-- The rendered `@manual` surfaces (DESIGN surfaces 1–3) and the two `@uat` scenarios are handed to the
     operator as a live verification script (board served at :4178). Their results + sign-off land below
     once reported.

     Already evidenced by the operator's RUNS-tab screenshot (story 21/00, populated): the Current-run strip
     pins the running run (pulsing teal chip · #attempt · sess·e5f6…); the History lists prior runs
     newest-first as bordered rows (#attempt · chip · sess·… · relative time); the chip IS the outcome
     (done = teal ✓, failed = red dot, no second badge); ↻ Rerun is greyed with "a run is in progress" while
     a run is in flight; the poll affordance reads "⟳ refreshed just now"; the story tab set is
     STORY · TASKS · RUNS. → covers @manual scenarios a/b/d(story)/e/g of stories 00. -->

## Rendered evidence (operator-confirmed)

The operator served the board (`aof work board`, `http://127.0.0.1:4178`), seeded throwaway runs on story
`21/00` (two terminal + one in-flight via `work:run-start`/`run-complete` — pure record ops, no agent), and
inspected the populated RUNS tab. Confirmed against DESIGN surfaces 1/2/3:

- **Current-run strip (surface 2)** — pins the in-flight run as a pulsing teal `running` chip · `#attempt` ·
  truncated `sess·e5f6…`; the `⟳ refreshed just now` poll affordance sits bottom-right. *verifies →* story 00 /
  `01_current-run-highlighted.feature` `@manual` (strip pins latest), `02_runs-poll-refresh.feature` `@manual`
  (no stream chrome — the only refresh control is `⟳ refreshed Ns ago`).
- **History (surface 1)** — newest-first bordered rows, each `#attempt` (mono bold) · run-state chip ·
  `sess·…` · relative time; `runId`/`brief` not shown. *verifies →* story 00 /
  `00_runs-render-from-run-status.feature` `@manual` (newest-first rows).
- **Chip is the outcome (surface 1)** — `done` = teal ✓ chip, `failed` = red dot chip; no second outcome
  badge. *verifies →* story 00 / `00_runs-render-from-run-status.feature` `@manual` (outcome reads through chip).
- **Rerun disabled-while-running (surface 3)** — `↻ Rerun` greyed with the `a run is in progress` hint while a
  run is in flight, subordinate to the header primary, stays visible. *verifies →* story 01 /
  `01_rerun-disabled-while-running.feature` `@manual` (greyed + hint).
- **Story tab set** — `STORY · TASKS · RUNS`. *verifies →* story 00 /
  `00_runs-render-from-run-status.feature` `@manual` (tab set per type, story row).

The all-`#1` attempt reading was reviewed live and adjudicated **faithful, not a defect** (fresh
`work:run-start` ⇒ `attempt 1`; ordering is by recency, not by the attempt number) — recorded as the
non-blocking design-gap **F1** above.

## User sign-off

The operator (umair.butt@hotmail.co.uk), acting as the human acceptance authority, **signed off** on
`2026-06-30` to accept milestone 21 on the strength of: the green `@executable` + fitness lane, the
operator-confirmed rendered surfaces above, and the build-time design-conformance **CONFORMS** (STATE
`2026-06-30` build entry — `aof-designer` judged the rendered surfaces against `mocks/work-board-runs.dc.html`).

**`@uat` lane — DEFERRED by operator choice** (no live agent provider wired this session). Two scenarios
remain to confirm in a real-provider environment, recorded as an **open non-blocker**, not a finding:
- story 00 / `02_runs-poll-refresh.feature` `@uat` — a silent poll updates run state without tearing down a
  live terminal.
- story 01 / `00_rerun-launches-terminal.feature` `@uat` — `↻ Rerun` mints a fresh run that appears via the
  next `/api/work/run-status` poll.

## Accept decision

**ACCEPTED** (`2026-06-30`). Gate: `aof work validate` → **PASS** (work stream well-formed). No blocker finding
open (F1 is a non-blocking design-gap routed to `aof-designer`). Both stories' `@executable` features are green
and reviewed (STATE build entry: architect **CONFORMS**, QA coverage complete, designer **CONFORMS**); the
rendered `@manual` surfaces are operator-confirmed; the `@uat` lane is deferred to a live-provider environment
by the operator's explicit choice. Stories 00 + 01 → `done`; milestone 21 → `done`.

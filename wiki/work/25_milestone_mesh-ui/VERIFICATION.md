---
doc: verification
---
# 25 · Mesh UI — Verification

## Verification evidence

The `@executable` suite + fitness functions are green; the story-02 `@manual` browser lane was run
against a served fleet (no `@uat` scenarios exist across the milestone, so no human gate). Evidence:

| Lane | Command / procedure | Result | verifies → |
|---|---|---|---|
| `@executable` suite | `node scripts/test.mjs` | **exit 0 — 1836 ok / 0 not ok** | every `@executable` scenario across stories 00/01/02 |
| Fitness functions (m25) | in-suite `test/arch/*` | green — `acd-work-ui-rename-complete` (XOR), `acd-mesh-ui-no-core-import` / `-single-server` / `-write-isolation` / `-single-data-command`, carried board guards + `acd-mesh-command-cli-bijection` | ARCHITECTURE ADR-001…004 invariants |
| traceability — boards projection | in-suite `mesh-fleet-boards-projection` | green (re-authored to the ADR-005 owner-presence seam) | `01/tasks/00_boards-projection` |
| traceability — CLI render | in-suite `mesh-status-fleet-render` | green (owner-presence run count) | `01/tasks/01_mesh-status-render` |
| traceability — graceful degradation | in-suite `mesh-fleet-graceful-degradation` | green | `01/tasks/02_graceful-degradation` |
| traceability — fleet serve / read-only / CLI face | in-suite `mesh-ui-serve` / `mesh-ui-read-only-contract` / `mesh-ui-cli-face` | green | `02/tasks/00,05` + the `aof mesh ui` verb |
| `@manual` browser lane (story 02) | `aof mesh ui` served against a planted 5-node/6-board fixture; QA drove curl + Playwright | **PASS** (see below) | `02/tasks/01,02,03,04,05` (all `@manual`) |
| live validator | `aof work validate` | **PASS (exit 0)** | the stream is well-formed |

**`@manual` browser lane — QA verdict PASS** (read-only fleet surface, agent-run — no human):

| Scenario | Result | verifies → |
|---|---|---|
| write-method rejected (POST/PUT/PATCH/DELETE `/api/mesh/status`) | `405` + `allow: GET, HEAD`, `{code:"method-not-allowed"}` | `02/tasks/05` |
| no `/api/work` face; `GET /api/mesh/status` → `{nodes,boards}` | `/api/work/list` → `404`; status → `200` | `02/tasks/00,05` |
| no mutating control on the page | exactly 7 interactives = 1 ⟳ refresh + 3 local drill-in links + 3 peer drill-in buttons; no assign/route/issue/revoke/start/stop, no editable field, no terminal | `02/tasks/05` |
| drill-in two-case split | LOCAL board → real `<a href="/?mode=board">`; PEER board → `<button>` (no href) copying `aof work ui`, owner named on tile — never a dead-end | `02/tasks/03` |
| refresh re-polls in place, non-tearing | ⟳ issues a 2nd `GET /api/mesh/status`; no "Loading fleet…" flash; view stays mounted | `02/tasks/04` |
| no event stream | `wsOpens: []`; only wire request is the poll `GET`; fleet source opens no EventSource/WebSocket | `02/tasks/04` |

## Design conformance

**Verdict: CONFORMS** (design surface 1 — `aof mesh ui`). The built surface was rendered via
`npx playwright screenshot` against a served fleet fixture (mac-studio = this node) at the **390 / 768 /
1280** breakpoints plus the **empty-fleet** and **nodes-no-boards** states, and the read-only
`aof-designer` judged the screenshots region-by-region against the committed mock
([mocks/Mesh.dc.html](mocks/Mesh.dc.html)) + the DESIGN binding checklist:

- **Top bar · Nodes region + card anatomy · node-presence ramp · Boards region + tile · empty/no-boards
  states · responsive reflow — all CONFORMS.** The three read-only ramps stay distinct; **stale is
  secondary-grey, not destructive-red**; the read-only rail holds (no mutating affordance on screen).
- **The ADR-005 reduced board chip is present and correct-by-design** — running boards paint a teal
  `running` chip; idle-owner boards read `No runs yet`; **no terminal chips** (`done`/`failed`/`queued`)
  on the fleet tile (those are a drill-in concern). Judged against the reduced chip per the DESIGN
  annotation, not the mock's aspirational terminal chips.
- The additive `· N offline` summary segment was **folded into the DESIGN checklist** (item 2) at the
  judge's suggestion — an honest extension surfacing the no-presence count, not a divergence.

Renders: `fleet-1280.png` / `fleet-768.png` / `fleet-390.png` / `fleet-empty.png` / `fleet-noboards.png`
(session scratchpad — the conformance evidence the designer judged).

## Findings

The three build-review findings carried into verify are **all RESOLVED** here; QA/designer surfaced only
non-blocking observations. No blocker finding is open.

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F1 | boards `activeRuns` had no runtime producer (`<workDir>/<slug>/` dead-`[]` in production) — the boards half showed every board idle while the nodes half showed real runs | contract / data-model | blocker-to-`done` | fix | [ADR-005](ARCHITECTURE.md) — board `activeRuns` = owner's synced `presence.activeRuns`; `mesh:status` + `01/tasks/00,01` + `02/tasks/02` run-seam scenarios + their tests re-authored | **RESOLVED** (suite green) |
| gap-A | fleet run chip could not carry the full m21 terminal ramp (aggregate carries a per-node running set, not per-board terminal state) | design-gap | non-blocker | designer set the rule | DESIGN surface 1 annotated — **reduced running/idle fleet chip**; full ramp is a drill-in concern | **RESOLVED** |
| gap-B | no "this node" tag + no local-vs-peer drill-in split (aggregate carried no locality marker) | design-gap | non-blocker | designer set the rule | `mesh:status` emits an additive `local` marker (pure read off `config.mesh.nodeId`); UI renders the THIS NODE tag + the task-03 local→link / peer→hint split | **RESOLVED** |
| obs-1 | `POST /api/mesh/issue` / `/api/mesh/assign` return `404` (no route), not the `405` task-05's outline literalises | test wording | non-blocker | defer | task 05 Examples wording (m27 owns these verbs) — 404-for-nonexistent satisfies "rejected without state change" | deferred |
| obs-2 | after ~6 min a served fixture's heartbeats age to stale (the UI renders the server-derived `stale` fact faithfully) | fixture-timing | non-blocker | none | not a UI defect — re-seed before a stable live render | noted |

## Accept decision

**ACCEPT.** All three stories are built, reviewed, and verified: the `@executable` suite is green
(1836 ok / 0 not ok), every m25 fitness gate holds, the story-02 `@manual` browser lane is PASS, the
design-conformance verdict is CONFORMS, and `aof work validate` is PASS. The three carried findings
(F1, design-gap A, design-gap B) are resolved; no blocker finding is open. Stories 00/01/02 → `done`,
milestone 25 → `done`.

---
doc: verification
updated: 2026-06-23
---
<!--
  Milestone VERIFICATION.md — the record doc for aof:verify. Answers ONE question: is this milestone
  truly done, with evidence? Write only the sections that have content (absence of a section is
  information). Findings live here, never in a task folder.
-->
# 11 · Graphify Codebase Intelligence — Verification

Verified `2026-06-22` (`aof:verify 11`). graphify **0.8.44** present (PATH `~/.local/bin/graphify` +
`~/.aof/tools` store; `aof project doctor` → `managed-tool: graphify is present from the store`), so the
`@manual` lanes were run **live**, not restated. No `@uat` scenarios exist (technical milestone, no UI) →
no human-acceptance lane. No DESIGN surface → no design-conformance lane.

## Verification evidence

### @executable — automated suite + fitness functions (GREEN)

- **Full suite green.** `node scripts/test.mjs` → **1130 ok / 0 fail** (exit 0). The canonical runner
  (NOT the stale `scripts/test-unit.mjs`). _verifies → the milestone's `@executable` regression sweep._
- **The four fitness arch-tests run inside the suite — 15 assertions, all GREEN** (story 03):
  - `acd-codebase-grounding-no-parse` — 4 assertions (each seam RUNs+READs; explicit no-parse directive;
    no aof-side parse; no new `graph.json`/`normalizeGraph` reader). _verifies → ADR-001 / story 03._
  - `acd-codebase-grounding-via-commands` — 3 assertions (sole `graphify` spawn stays `src/graphify.mjs`;
    no new graph-reaching module; seams invoke `aof graph build/query/triage`). _verifies → ADR-002/005._
  - `acd-codebase-grounding-advisory` — 4 assertions (each seam frames advisory; no pipe into
    gate/merge/`autoComplete`; triage = ranking context never auto-block; no status/work auto-write).
    _verifies → ADR-004 / story 03._
  - `acd-codebase-graph-derived` — 4 assertions (repo-ROOT `.gitignore` carries `graphify-out/`;
    `check-ignore -v` resolves to root; seams build-before-query; freshness surfaced). _verifies → ADR-003._
- **Git-ignore facts confirmed directly** (story 00 task 00 `@executable`): `.gitignore:4` carries
  `graphify-out/`; `git check-ignore -v` resolves **all** of `graphify-out/` · `graphify-out/graph.json` ·
  `graphify-out/graph.html` to `.gitignore:4` (the ROOT, defeating m10's in-dir-file vacuity trap);
  `git ls-files graphify-out/` is empty (nothing tracked). _verifies → 00/00 git-ignore scenarios._

### @manual — agent-runnable, run live (graphify 0.8.44)

- **Build-fresh + freshness visible** (00/01). `aof graph build src --json` → `nodeCount:275`,
  `edgeCount:549`, `builtAt:2026-06-22T22:47:47.920Z`, `egress:"none"`, plus graphify's scan stdout. The
  `builtAt`/`egress`/counts are read back from the `BuildResult` — freshness is **visible**, never
  silently stale. _verifies → 00/01 "graph built fresh, freshness visible"._
- **Legible output, aof never parses it** (00/01, 01/00, 01/01). `aof graph query "…"` returns BFS
  markdown (e.g. seeded on the real `COMMANDS registry [src=command-core.mjs community=1]` node with
  `--calls`/`--references` edges). The agent reads it as natural-language context; the no-parse property
  is CI-pinned by `acd-codebase-grounding-no-parse`. _verifies → 00/01, 01 legible-output scenarios._
- **Architect cites graph-derived coupling in a real structural review — CONFORMS** (01/00). Spawned
  `aof-architect` followed its own wired `<codebase-graph-grounding>` convention against the live binary:
  built fresh (`builtAt 2026-06-22T22:49:40.110Z`, egress none, 275/549), queried coupling (5 phrasings),
  and returned a verdict **citing graph-derived coupling** — the `COMMANDS registry` convergence hub
  (community 1), the three graph faces co-resident in community 0 with `command-core.mjs`/`graphify.mjs`,
  `cli.mjs` coupling inward to the registry and **never directly to `graphify.mjs`**, and the
  single-graphify-spawn-site invariant (09/ADR-002) **holding** (graph cross-checked against grep:
  `src/graphify.mjs:135/160/188` are the only graphify spawns). Advisory-only honoured (verdict is the
  architect's judgment; nothing auto-failed). Verdict: **CONFORMS** — the live mechanism delivers legible
  coupling the architect cites, aof never parsing it. _verifies → 01/00 (both review entry points inherit
  the one agent-prompt edit)._
- **Refine boundary-coupling seam** (01/01). `refine.md` step 2 carries the build-fresh → `aof graph
  query` → follow-coupling → cite → advisory → no-op step (run-unconditionally, mirroring the step-1
  memory-recall hook). The grounding **mechanism** is the same `graph:query` the architect exercised live
  above; the end-to-end refine-run observable was dogfooded at build (STATE §Progress). _verifies → 01/01
  seam present + faithful; mechanism live-confirmed._
- **Code-review PR-impact triage seam** (02/00). `code-review.md` step 3 carries the build-fresh → `aof
  graph triage` (plain = `prs --triage` ranked queue; `--pr N` = single-PR drill-down, stated honestly per
  `src/graphify.mjs:180-187`) → READ opaque markdown → advisory (merge gate unchanged; explicit
  no-wire into `work.codeReview.autoComplete`) → no-op step. Live `aof graph triage` returned legible
  ranked-queue markdown — *"base: main · 0 PRs · No actionable PRs to triage."* Mechanism **CONFORMS**;
  the "for a real PR" content is **unobservable now** (0 open PRs against `main` to rank). _verifies →
  02/00 seam present + faithful; mechanism live-confirmed; content inconclusive absent an open PR._
- **Derived / disposable / rebuildable** (00/00 `@manual`). Deleting `graphify-out/` removed no committed
  fact (nothing under it is tracked; no work record depends on it) and a **code-only** corpus rebuilds
  **keylessly** from source alone (`aof graph build src/commands` → 44 nodes/54 edges, egress none, exit
  0). The derived/disposable/no-authoritative-fact property **holds**. CAVEAT (finding F-2): a cold
  `aof graph build src` over aof's **docs-bearing** `src/` does NOT reproduce keylessly — see Findings.
  _verifies → 00/00 derived/rebuildable (with the F-2 caveat on cold docs)._

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| **F11-1** | `graph:build` ignores graphify's non-zero exit status: `runGraphifyBuild` returns `status` (`src/graphify.mjs:142`) but `src/commands/graph-build.mjs:119` reads `graph.json` unconditionally, so a present-but-failing build surfaces a raw `ENOENT: … graph.json` instead of graphify's real cause (e.g. "no LLM API key found … pass `--backend`"). An agent following the grounding convention sees an opaque ENOENT, not actionable guidance. | bug (robustness/honesty) | non-blocker | **defer to backlog** (a milestone-09 `graph:build` fix — outside 11's zero-production-code scope, ADR-002; advisory-only degrades gracefully so it does not block 11's acceptance). A `@bug` fast-follow against the 09 build command. | milestone 09 area (`graph:build` error surfacing) | open (deferred) |
| **F11-2** | A cold `aof graph build src` over aof's **docs-bearing** source root fails: graphify finds **33 docs** (`src/bundle/**/*.md` prompts) needing semantic extraction → "no LLM API key found" (exit 1, no `graph.json`); only a warm/incremental `graphify-out/` cache or `--backend` succeeds. The convention's **no-op clause covers only the `graphify-missing` miss (binary absent), not a present-but-failing build** — so on a cold checkout of a docs-bearing repo the documented grep-and-infer fallback is not pattern-matched by the agent. (Code-only `src/` cold builds keylessly — F-2 is the docs interaction.) | gap (convention completeness + build-target choice) | non-blocker | **defer to backlog** (a prompt refinement: broaden the no-op clause from "graphify absent" to "graph unavailable for ANY reason — absent OR build/query failed", and note a docs-bearing `src/` needs `--backend` for a cold build, or default the build scope to a code-only target). Advisory-only means the practical outcome is the designed no-op (agent proceeds on grep-and-infer), reached via a messier error than intended. | milestone 11 convention (story-00 grounding text) — backlog refinement | open (deferred) |
| **F11-3 (carry-forward)** | `.aof/aof.memory.graphify.index.json` is still un-ignored at the repo root (`git check-ignore` → exit 1) — milestone 10's graphify memory store. OUT of 11's scope (not a codebase-graph artifact); re-confirmed at verify. | info (cross-milestone hygiene) | non-blocker | defer (a root `.gitignore` line, or extend 10's gitignore seam) | milestone 10 hygiene | open (deferred) |

No **blocker** finding is open → the gate may proceed. F11-1/F11-2 are robustness/craft refinements to
the 09 build path and the 11 convention text; neither invalidates a load-bearing 11 deliverable (the
convention, the three seams, the four arch-tests, and the git-ignore are all present + GREEN, and the
live grounding mechanism CONFORMS), and the advisory-only invariant means a failed graph **never blocks
the agent** — the worst case is "no grounding this run; proceed on grep-and-infer", the milestone's
designed no-op degradation.

## Accept decision — RETRACTED 2026-06-23 (milestone RE-OPENED)

**The 2026-06-23 ACCEPT was premature and is retracted.** What the verification actually proved was
**prompt-text presence + a mechanism that CAN run**, NOT that the milestone delivers value:

- The four arch-tests assert the bundled prompts CONTAIN the grounding words (string presence). They are
  **vacuous on value** — they cannot tell whether an agent gets useful grounding.
- The one "live CONFORMS" was an `aof-architect` I spawned with a prompt that **explicitly instructed it
  to follow the convention**. That demonstrates the mechanism, not that aof's own agents use it unprompted.
- aof does **not** dogfood the seams (they render only into `src/bundle/`, not aof's own `.claude/`), and
  aof's `memory.backend` is `none` — so **nothing in aof exercises this milestone's output**.
- The integrated payoff (graphify recall, m10) is **broken** by a shared-`graphify-out/graph.json`
  collision: the codebase grounding (`graph build .`) and the memory backend (`graph build wiki/work`)
  write the SAME file, so recall re-ranks work-stream records against the codebase graph (0 matching
  nodes → base ranking) while falsely reporting `graph-ranked`. Proven on let-shield + cadence: graphify
  recall === local recall, identical scores. → new blocker finding **F11-4**.

**Honest verdict:** the milestone shipped a working `aof graph` toolchain (m09) consumable as prompt
text, but produced **no demonstrated value to the aof toolchain itself**. Re-opened to fix that — see
`## AC re-assessment` and `## Value gap + plan`.

## Findings (added at re-open)

| id | observed | type | severity | status |
|---|---|---|---|---|
| **F11-4** | The memory backend (m10) and the codebase grounding (m11) both write `graphify-out/graph.json` with DIFFERENT corpora (work-stream vs codebase). Whichever built last wins; recall reads the wrong graph, re-ranks against 0 matching nodes, and falsely reports `graph-ranked`. graphify recall === local recall (identical scores, let-shield + cadence). The memory re-rank — the headline integrated payoff of the arc — does nothing. | bug (integration) | **blocker** | open |
| **F11-5** | The four story-03 arch-tests assert bundled-prompt STRING PRESENCE only. They pass without any evidence the grounding changes an agent decision — vacuous on the milestone's actual value claim. The `@manual` value scenarios were "signed off" via a hand-instructed agent demo. | gap (verification) | blocker (for re-accept) | open |

## AC re-assessment (honest — does each acceptance criterion deliver value?)

| Story / AC | Lane | Delivered? | Real value? |
|---|---|---|---|
| 00/00 `graphify-out/` git-ignored at root | @executable | ✅ yes | trivial (one gitignore line) |
| 00/00 graph rebuildable / derived | @manual | ✅ yes | trivial (it's disposable) |
| 00/01 grounding convention (build→query→cite→advisory→no-op) | @manual | prompt text shipped | **unproven** — no agent shown to benefit unprompted |
| 01/00 architect cites graph coupling | @manual | mechanism runs | **unproven** — only via a hand-instructed demo |
| 01/01 refine draws boundaries from coupling | @manual | prompt text shipped | **unproven** — never actually run |
| 02/00 code-review surfaces triage queue | @manual | prompt text shipped | **unproven** — queue empty; never exercised on a real PR |
| 03 four arch-tests (15 assertions) | @executable | ✅ green | **vacuous on value** — assert word-presence only |
| (arc) graphify recall actually re-ranks | — | — | **BROKEN** (F11-4) |

**Net:** everything actually *delivered* is either trivial (a gitignore line) or vacuous-on-value (tests
that check the prompt contains certain words). Every value-bearing AC is unproven, and the integrated
payoff is broken. This is the gap to close before any re-accept.

## Value delivered at re-open (2026-06-23) — ADR-007: `graph:impact`

The re-open shipped a **real consumer** of the graph, superseding ADR-002's "zero production code":

- **`aof graph impact <paths…>`** (`src/commands/graph-impact.mjs`, registered in the 08 core; CLI
  dispatch in `cli.mjs`): a DETERMINISTIC, edge-based coupling lookup — each file's exact **dependents**
  (blast-radius) and **dependencies**, computed from `graph.json`'s edges via the pure normalizer (no
  spawn, no LLM, no markdown parse). Proven on real aof code: `command-core.mjs` → its exact 4 dependents
  + 12 dependencies; `graph-build.mjs` → exact 3 imports + 1 dependent. This is the reliable signal the
  fuzzy similarity-seeded `graph:query` could not give.
- **The three agent seams now lead with `aof graph impact`** on the files under review / in the diff / at
  each candidate boundary — `graph:query`/`triage` demoted to optional fuzzy hints. So a running
  architect/refine/code-review agent that follows its prompt gets exact coupling.
- **A NON-VACUOUS value test** (`test/graph-impact.test.mjs`, 6 cases): asserts `computeImpact` returns
  EXACT dependents/dependencies + the build-first precondition — the thing the old word-presence
  arch-tests could not. The four `acd-codebase-grounding-*` arch-tests are amended to ADR-007 (allow-list
  `graph-impact.mjs`; seams must use `aof graph impact`; advisory + no-spawn still enforced). **Full suite
  1166 ok / 0 fail.**

This addresses F11-5 (vacuous verification → a real value test) and gives the milestone an actual,
demonstrable deliverable. **It does NOT yet close everything** — see F11-6.

## Remaining before re-accept

| id | observed | type | severity | status |
|---|---|---|---|---|
| **F11-4** | The m10 memory backend re-ranks against the shared `graphify-out/graph.json` (codebase graph), falsely reports `graph-ranked`. Untouched by the re-open (m10 scope). | bug (integration) | blocker | open |
| **F11-6** | aof does not DOGFOOD its own bundle: `.claude/agents/*.md` are a stale (28-line vs 55-line), untracked, hand-maintained set NOT rendered from `src/bundle/`. So aof's OWN running agents do not carry the `graph:impact` step — only downstream projects (via `aof work update`) get it. The "running agents benefit" claim is proven for the COMMAND + downstream seams, but aof-on-aof needs the dogfood. | gap (dogfood) | blocker (for re-accept) | open |

**Status: milestone stays `in-progress`.** A real, tested consumer now exists (value delivered), but
re-accept requires closing F11-6 (dogfood so aof's own agents benefit) and an unprompted live-agent proof,
and ideally F11-4 (the m10 re-rank). No premature "done" this time.

## Re-verification — 2026-07-03 (`aof:verify 11 --reverify`) — re-open CLEARED, ACCEPTED

The re-open's two hard bars — **F11-6 (dogfood)** and the **unprompted live-agent value proof** — are now
met on the tree; F11-4 is re-triaged (m10-scope, the "ideally"). This is NOT a repeat of the retracted
2026-06-23 accept: that one certified word-presence + a hand-instructed demo; this one has a **genuine,
unprompted value demonstration** + a real dogfood, each verified below.

### F11-6 (dogfood) — CLOSED
aof now eats its own grounding. `.claude/agents/aof-architect.md` is **bundle-rendered** from
`src/bundle/agents/aof-architect.md` (differs only in generated frontmatter; the `<codebase-graph-grounding>`
body is byte-identical) and carries the `aof graph impact` step; `.claude/commands/aof/refine.md` +
`code-review.md` carry it too. `aof work update --dry-run` → **0 drift, 35 in-sync "keep"** — aof's OWN
running agents/commands now carry the `impact` grounding, not just downstream projects.
_verifies → the dogfood claim in `## AC re-assessment` + F11-6._

### F11-5 (unprompted live-agent value proof) — CLOSED
A live `aof-architect` was spawned on a plain structural-review task (two m27 modules) with **zero mention
of graph / impact / grounding**. Unprompted, it ran `aof graph build src` (fresh: 1295 nodes / 3522 edges)
then `aof graph impact` on the modules, and **grounded its entire verdict on exact graph-derived coupling
edges** — proving `src/work.mjs` carries zero mesh edges, distinguishing comment-citations from real
imports, ruling out cycles, and catching a real bijection-coverage gap via the negative-coupling fact a
fuzzy query cannot prove. The grounding demonstrably CHANGED the analysis (structural facts no eyeball read
supplies). This is the demonstrable value the re-open demanded. _verifies → the "running agents benefit"
value claim; `@manual` unprompted-agent-observed._

### F11-4 — re-triaged to deferred non-blocker (→ m10)
Still present: the graphify memory backend (`src/memory/graphify-backend.mjs`, work-stream corpus) and the
codebase build (`aof graph build src`) both resolve `<projectRoot>/graphify-out/graph.json`, so whichever
built last wins and a cross-use recall re-ranks against the wrong corpus. This is an **m10 memory-backend
path concern**, not m11's codebase-grounding value (which is proven independently). The re-accept bar lists
it as "ideally" — **deferred, routed to m10** (fix: give the memory backend a distinct graph output path,
e.g. `graphify-out/memory/graph.json`, so the two corpora never collide).

### `@executable` gate — GREEN (2221 ok / 0 fail)
Confirmed in isolation on the current tree. The four `acd-codebase-grounding-*` arch-tests +
`test/graph-impact.test.mjs` (the non-vacuous ADR-007 value test) are green.

### Finding logged (non-blocker → m28)

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| **F11-7** | Under CONCURRENT test runs, a mesh test writes THIS machine's real node record to the real `.aof/mesh/nodes/<nodeId>.json` (m28's in-progress `meshDir` relocation `.mesh/` → `.aof/mesh/`, `mesh-store.mjs:50-66`), so parallel `node scripts/test.mjs` invocations collide and 10-28 mesh-substrate tests (issuance-record/00, issuance-add-only-merge/02, mesh-store, mesh-ui) flake. Green in ISOLATION (2221/0); the failures were an artifact of running multiple suites at once during this verify. | test-isolation (hermeticity under concurrency) | non-blocker (green in isolation) | **defer → m28** (the relocation's own verify): make the mesh tests hermetic — no test may resolve `aofHome`/`meshDir` to the real repo `.aof`; a fixture must always inject `projectRoot`/`aofDir`. | milestone 28 (`meshDir` relocation verify) | open (deferred) |

## Accept decision — RE-ACCEPTED (2026-07-03)

The 2026-06-23 retraction is **cleared**. m11's value is now genuinely demonstrated (F11-5 unprompted proof
+ F11-6 dogfood + the ADR-007 `graph:impact` value test), the `@executable` gate is green in isolation,
`aof work validate` PASS, and **no blocker finding is open** (F11-4 → m10, F11-7 → m28, both non-blocking
and out of m11's scope). All four stories → `done`; milestone → `done`.

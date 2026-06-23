---
doc: verification
ref: "09"
verified: 2026-06-22
verdict: "milestone accepted — all five stories done; `@executable` suite + the six ADR-006 fitness functions green; the live `@manual` lanes (binary-resolution, build, query, triage, MCP round-trip) pass against the store-provisioned graphify 0.8.44; two blocker findings caught at this gate (F1 fitness-hermeticity regression from milestone 12; F2 build `--out` driver defect) were FIXED and re-verified green; F3 (hyperedge key) deferred non-blocker to the backlog"
---
# 09 · Graphify Command Core — Verification

Verification lanes in scope: **`@executable`** (the spine + faces + MCP routing), **`@manual`** (the
live-binary lanes deferred to verify — driver build/cwd 00/02, query/triage 00/03, binary-resolution
01/00, MCP round-trip 04/01), and **fitness functions** (story 03 / ADR-006, the six `acd-graph-*`
arch-tests). There are **zero `@uat`** scenarios — this is a foundational/technical milestone
(graphify-as-commands; no human-judgement surface), so the human-acceptance step is skipped and the user
is not pulled in. **No `DESIGN.md` / UI surface** (the rendered faces are a skill + an MCP config entry,
not a visual surface), so the design-conformance lens does not apply.

Environment for the live lanes: `uv` 0.9.26, Python 3.12.5, Node v22.22.2; graphify **0.8.44** is
provisioned in the managed tool store at `~/.aof/tools/graphify/0.8.44/Scripts/graphify.exe` (installed
by milestone 12's `aof project provision graphify`). The store-first resolver (milestone-12 ADR-004)
finds it; no PATH/global graphify is present.

## Verification evidence

- **`@executable` suite — green.** `node ./scripts/test.mjs` → **990 ok / 0 not-ok (exit 0)**. Includes
  the new `@finding-F2` build-argv regression guard (below).
  verifies → the `@executable` rows across `stories/0{0,1,2,4}/tasks/*.feature`.
- **Fitness functions — green (the load-bearing deliverable, ADR-006).** `node ./scripts/check.mjs` →
  **991 ok / 0 not-ok (exit 0)**. All six `acd-graph-*` arch-tests pass, including the three
  binary-absent rows that were RED at the start of this gate (now hermetic — see F1).
  verifies → the structural invariants in [ARCHITECTURE.md](ARCHITECTURE.md) ADR-006 `## Fitness functions`.
- **Binary resolution + doctor (live) — PASS** _(01/00 @manual; 01/01 confirmed live)_.
  `resolveGraphifyBinary({pathValue:"", useLocator:false})` → `{found:true, source:"store",
  path:"…\.aof\tools\graphify\0.8.44\Scripts\graphify.exe", version:"0.8.44"}` (the "reported version"
  row). `aof project doctor` → `ok: managed-tool - graphify is present from the store (version 0.8.44)`.
  verifies → 01/00 @manual "a present graphify binary resolves to a structured hit".
- **Live build + cwd discipline — PASS (after the F2 fix)** _(00/02 @manual)_. `aof graph build
  <fixture-folder> --json` (target ≠ projectRoot) → a success BuildResult `{graphPath, nodeCount:5,
  edgeCount:5, hyperedgeCount:0, backend:null, egress:"none"}`; graphify's own stdout reports `wrote
  C:\Source\umair\aof\graphify-out\graph.json` — i.e. **under the project root**, not the target. The
  file exists at `<projectRoot>/graphify-out/graph.json`, and `aof graph query "what calls main" --json`
  immediately after resolves against it (the #756 cwd discipline holds end-to-end). The egress=`none`
  row is read **live** from the BuildResult (offline, no backend, AST-only → zero network).
  verifies → 00/02 "aof graph build writes graph.json under the project root with graph-derived counts" +
  "a query after a build finds the graph".
- **Live query — PASS** _(00/03 @manual)_. `aof graph query "what calls main" --json` → a single-pass
  JSON object with keys **exactly `[question, stdout, graphPath]`**, the opaque BFS markdown carried in
  `stdout`, and **no `nodes`/`edges`** (the ADR-001 opaque contract holds).
  verifies → 00/03 "aof graph query --json returns the opaque answer and a graph handle".
- **Live triage — PASS** _(00/03 @manual)_. The `prs` verb EXISTS in 0.8.44 (hidden from `--help` but
  functional). `aof graph triage --json` → `[mode, stdout, graphPath]`, `mode:"triage"`, **no `prs`
  field**; `aof graph triage --mode conflicts --json` → `mode:"conflicts"`, same shape.
  verifies → 00/03 "aof graph triage --json returns the opaque queue and the mode".
- **Live MCP face round-trip — PASS** _(04/01 @manual)_. Driving `aof graph serve` over stdio JSON-RPC:
  `initialize` → serverInfo `aof-graph`, protocol `2024-11-05`; `tools/list` → `[graph_build, graph_query,
  graph_triage]`; `tools/call graph_query {question:"what calls main"}` with a built graph → `isError:false`,
  result keys `[question, stdout, graphPath]` (no nodes/edges), `stdout` carrying graphify's real BFS
  answer — i.e. produced by `invoke("graph:query")` behind the registry. With **no** graph present, the
  same call → a clean MCP tool error (`isError:true`, `code: no-graph`) and the server stays up.
  verifies → 04/01 "an agent reaches the graph through the live MCP face" + "a precondition failure is a
  clean MCP tool error".
- **Missing-graph precondition (live, CLI) — PASS** _(00/03 @executable, confirmed live)_. `aof graph
  query/triage --json` with no built graph → a single JSON envelope `{ok:false, error, code:"no-graph"}`
  (exit 1) surfaced before any graphify spawn.
- **Normalizer against the REAL 0.8.44 graph.json — PASS (with F3 caveat).** The live `extract` output
  is NetworkX node-link with top-level keys `directed, multigraph, graph, nodes, links, hyperedges,
  built_at_commit`; `normalizeGraph` read `links` (not `edges`), produced `nodes=5 edges=7`, and
  preserved `confidence:"EXTRACTED"` / `confidenceScore`. **Caveat (F3):** the live tool emits
  `hyperedges` at **top-level** while the normalizer reads `raw.graph.hyperedges` — see F3.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| F1 | `check.mjs` exit 1 — 3 absent-path tests assert `resolveGraphifyBinary()` → `found:false` but got `found:true` on this machine: they passed `{pathValue:"", useLocator:false}` but did **not** isolate the store root, so the store-first resolver (milestone-12 ADR-004) consulted the real `~/.aof/tools/graphify` (provisioned by milestone 12) and found it. **No product defect** — the resolver is correct; the tests were non-hermetic. | regression / test-hermeticity | blocker | new `@bug` (+`@finding-F1`) — isolate the store root in the 3 absent assertions via an injected empty `AOF_GLOBAL_HOME`. Origin is milestone-12's store-first retrofit. | developer | **FIXED & re-verified 2026-06-22** — `test/graph-binary-provisioning.test.mjs` (×2) + `test/arch/acd-graph-binary-absent.test.mjs` now inject a fresh empty `AOF_GLOBAL_HOME`; assertions unchanged; check.mjs green (991/0). |
| F2 | `aof graph build <fixture>` → ENOENT `<projectRoot>/graphify-out/graph.json`; graphify 0.8.44 `extract <path>` writes to **`<path>/graphify-out/`** (the `--out` default is `<path>`, the target), not `<cwd>/graphify-out/`. The #756 `cwd=projectRoot` workaround fixes the READ verbs (query/path/explain) but NOT `extract`'s WRITE location, so build landed the graph under the target and the build→query chain broke for any target ≠ projectRoot. | product defect (driver) | blocker | new `@bug` (+`@finding-F2`) — `runGraphifyBuild` pins `--out projectRoot`; re-run the 00/02 @manual lane; amend ADR-002. | developer | **FIXED & re-verified 2026-06-22** — `src/graphify.mjs` extracts a pure `graphifyBuildArgs(input, projectRoot)` that pins `--out projectRoot` (egress gating preserved); `@executable` guard added in `test/graph-command-core.test.mjs`; ADR-002 amended; live build now writes under projectRoot and query finds it. |
| F3 | Live 0.8.44 emits `hyperedges` at **top-level** (`raw.graph` is `{}`), but `normalizeGraph` reads `raw.graph.hyperedges` → hyperedges silently dropped and `hyperedgeCount` reads 0. The committed fixture nests under `graph.hyperedges`, so the @executable A2 test is green against a shape that doesn't match the live tool. (Populated hyperedge shape not directly observed — my fixture produced 0 hyperedges; inferred from the top-level empty key + empty `graph`.) | product defect (normalizer) + fixture-reality mismatch | non-blocker (build/query/triage core works; hyperedges are enrichment) | **defer to backlog** — read top-level `hyperedges` with a `graph.hyperedges` fallback; update the committed fixture to the real shape; confirm the populated location against a codebase that yields hyperedges. | backlog | open (deferred) |

## Validate gate

`aof:validate 09` → keystone `aof work validate 09` = **PASS — 09 is well-formed** (folder↔frontmatter,
the closed tag vocabulary, the `depends: [08]` graph). The acceptance gate is now met: the `@executable`
+ fitness lanes are green (990 / 991, 0 fail) and **no blocker finding is open** (F1 + F2 fixed and
re-verified; F3 is a deferred non-blocker). Test-traceability: every `@manual` lane has an evidence row
above; no `@uat` sign-off row is owed.

## Accept decision

**Accepted — 2026-06-22.** Gate `aof:validate 09` is PASS, the `@executable` + six ADR-006 fitness
functions are green (990 / 991, 0 fail), every live `@manual` lane passes against the store-provisioned
graphify 0.8.44, and **no blocker finding is open**. This gate did its job twice over: the `@manual`
lanes exercised the query / triage / MCP / binary-resolution surfaces live, and caught two breakages a
green `@executable` suite alone could not — **F2**, a build path that misrouted its own output against
the real 0.8.44 binary, and **F1**, a fitness suite red on any machine where graphify is provisioned in
the store (a milestone-12 store-first-retrofit regression). Both were fixed within this cycle and
re-verified; **F3** (hyperedges read from the wrong key) is deferred to the backlog. All five stories are
`done`, so the milestone is accepted: `SPEC.md status: done`, its `## Stories` boxes ticked, `STATE.md`
compacted. No human `@uat` lane existed, so no user sign-off was required. The contract —
graphify-as-commands — is now the deliverable both consumer milestones (10, 11) build on.

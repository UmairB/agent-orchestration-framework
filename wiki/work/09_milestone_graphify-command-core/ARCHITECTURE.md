---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 09 · Graphify Command Core — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — graphify exposed *as registered command-core
> commands*, the milestone-08 contract applied to a net-new operation surface; the carry-forward
> Python-binary install decision) and `STATE.md` (`§Carry-forward to refine`: the two load-bearing
> decisions — graph command verbs + result shape, and the Python-binary install path). ADRs cite these
> as `SPEC §…` / `STATE §…`, and cite the researcher's `RESEARCH.md` as `RESEARCH §A…I` / `§A1…A8`.
> The seam this milestone EXTENDS is milestone 08's frozen command core: the
> `{ id, input, run, cli } → result` registry (`08/ADR-002`), the route↔command↔CLI bijection +
> import-guard fitness pattern (`08/ADR-004`), and the real code — `src/command-core.mjs`
> (`getCommand`/`listCommands`/`invoke`, `COMMANDS`, `ctx = { workspace }`), `src/commands/*.mjs`
> (one module per command), and the `test/arch/*` source-grep / registry-import / CLI-spawn idiom.
> This milestone does NOT re-litigate the boundary model (08/ADR-001) or the registry shape (08/ADR-002);
> it registers a NEW command family into the SAME core and inherits 08's guarantees.
>
> **Prior-lesson recall.** `aof work memory recall "graphify command core driver python install
> provisioning" --area architecture` returned an EMPTY block — no near-miss to honour or depart from.
> Decisions below stand on RESEARCH + the 08 contract alone.

## ADR-001: The graphify operation surface registers THREE commands into the milestone-08 core — `graph:build` / `graph:query` / `graph:triage` — with frozen ids, input schemas, and basis-neutral result shapes

**Status:** Accepted
**Date:** 2026-06-21

**Context.** graphify is a net-new operation surface, and the SPEC's whole thesis (`SPEC §Objective`:
"new ops arrive as commands first") is that it arrives as registered commands in the SAME
`src/command-core.mjs` registry milestone 08 froze — not as a parallel mechanism. The verb set is the
first crux. `RESEARCH §A/B` is unambiguous on two hazards: (1) graphify's *skill slash-form*
(`/graphify ./raw`) does NOT match the *installed binary*, which is subcommand-only (`graphify ./raw`
errors); aof must bind to the subcommand binary, never the slash-form. (2) The exact subcommand set
**drifts by version** (issues #277/#514 report documented-but-missing verbs) — so the aof verb set must
be a STABLE, small façade that the driver maps onto whatever the pinned binary actually exposes, not a
1:1 mirror of graphify's CLI. graphify's real verbs cluster into three aof-meaningful operations:
*build the graph* (`graphify extract <path>`), *ask the graph* (`query`/`path`/`explain` — all read the
same `graph.json`), and *PR impact* (`prs --triage`/`prs --conflicts` — flag-selected modes of one
`prs` verb, `RESEARCH §B`). `prs --triage` is deliberately a SEPARATE aof verb from `query` because its
result is a PR-ranked review queue, not a graph traversal, and — load-bearing — `RESEARCH §H` confirms
triage is NOT exposed by graphify's MCP server, so it can only be driven via the CLI.

**The result-shape crux (resolved here).** `RESEARCH §C` is the decisive constraint: graphify has **no
stable `--json`** for `query`/`path`/`explain`/`prs`; their stdout is human markdown that drifts. The
ONLY stable machine artifact is **`graph.json`** (NetworkX `node_link_data`, `RESEARCH §D`). Therefore
the command RESULT must be **derived from `graph.json`**, never parsed out of graphify's markdown
stdout. The markdown stdout is carried only as an opaque human-facing secondary field
(`stdout: string`), never destructured for data. This is the graphify analogue of 08/ADR-002's
"basis-neutral result + face adapter" keystone: the *command* is canonical (graph-derived data, raw
absolute paths), and human rendering / path display is a face concern.

**Amendment (2026-06-21, Three-Amigos feasibility).** A pre-authoring feasibility pass caught a
contradiction in the original `graph:query`/`graph:triage` result shapes: they claimed graph-DERIVED
structured fields (`nodes`/`edges` = "the subgraph the query *touched*"; `prs: TriagedPr[]`) that are
**not derivable from `graph.json` alone**. `graph.json` is the WHOLE graph (`RESEARCH §D`); knowing
which nodes graphify's *answer* touched, or producing a ranked PR queue, lives ONLY in graphify's
markdown stdout — which this very ADR (and ADR-006 inv. 5) forbid parsing, and which `RESEARCH §H`
confirms has no MCP/JSON path for triage. As written, no honest implementation could satisfy the
contract without violating the no-stdout-parsing invariant. **Resolution:** `query` and `triage` carry
NO graph-derived structured fields. Their per-call answer (the touched subgraph, the triage queue) is
graphify's markdown, carried **opaque** in `stdout`; the only structured handle either returns is
`graphPath` — a raw absolute to the WHOLE normalized `graph.json` for any consumer that wants structure.
A consumer wanting structured whole-graph data reads `graph:build`'s `BuildResult`/`graphPath` (or a
future `graph:read`), NOT `query`. A structured triage queue awaits an upstream graphify `--json` /
MCP `triage_prs` tool (absent today, `RESEARCH §H`); until then the field is not invented. The frozen
contract block below is updated IN PLACE to this shape — it remains the single source of truth. The
result-from-graph.json invariant (ADR-006 inv. 5) is unchanged in spirit and simplifies in fact:
`build`'s structured counts/shape come from `graph.json`; `query`/`triage` carry `stdout` opaque +
`graphPath`, never parsed.

**Decision.** Three commands register into `src/command-core.mjs` (added to `COMMANDS`), one module each
under `src/commands/`: **`graph:build`**, **`graph:query`**, **`graph:triage`**. Each is the 08 frozen
shape `{ id, input, run, cli }`; `run(input, ctx)` calls the graphify driver (ADR-002), normalizes its
output, and returns **basis-neutral** data — any filesystem path is a raw absolute (the `projectRoot`
and the `graph.json` path), never relativised inside `run`. Path display and markdown rendering are CLI
face adapters, exactly as 08/ADR-002 mandates. The CLI grows a top-level `aof graph <verb>` dispatch
(sibling to `aof work`), each `argv → invoke("graph:…", input, ctx) → render`/`--json`.

**The locked command/result contract (frozen 2026-06-21):**

```js
// THE THREE REGISTERED GRAPH COMMANDS (extend 08's COMMANDS array; ids are graph:*).
// Every path field is a RAW ABSOLUTE (basis-neutral, per 08/ADR-002). `stdout` is graphify's
// human markdown carried OPAQUELY — never parsed for data (RESEARCH §C). Where a result carries
// graph-derived STRUCTURED data it is ALWAYS from graph.json (RESEARCH §D), never from stdout —
// that is graph:build (BuildResult counts/shape). query/triage carry NO graph-derived structured
// field: their per-call answer is the opaque `stdout`, plus `graphPath` to the WHOLE graph.json
// (amended 2026-06-21, Three-Amigos feasibility — see ADR-001 amendment).

//  graph:build   input { path, backend?, tokenBudget?, offline? }   → BuildResult
//      path        — the folder to graph (raw absolute; driver cwd's into projectRoot, RESEARCH §I).
//      backend?    — "claude"|"gemini"|"openai"|"kimi"|"deepseek"|"ollama"|null  (RESEARCH §F).
//                    NULL/absent = code-only/offline: NO backend, NO key, zero egress (RESEARCH §E/§F).
//      tokenBudget?, offline? — threaded through to graphify; offline:true forbids a network backend.
//      BuildResult { graphPath, projectRoot, nodeCount, edgeCount, hyperedgeCount,
//                    builtAt, backend, egress: "none"|"docs-media", stdout }
//        graphPath   — raw absolute path to <projectRoot>/graphify-out/graph.json (RESEARCH §I).
//        egress      — "none" when no doc/media extraction occurred; "docs-media" when the
//                      backend hop ran. aof NEVER widens this (ADR-005); code/AST stays local.

//  graph:query   input { question, strategy?, budget? }             → QueryResult
//      strategy?   — "dfs"|"bfs"|null ; budget? — number (RESEARCH §B).
//      QueryResult { question, stdout, graphPath }    (amended 2026-06-21, Three-Amigos feasibility)
//        stdout      — graphify's human markdown ANSWER, carried OPAQUE (RESEARCH §C). This IS the
//                      result; the "subgraph the query touched" lives only in this markdown and is NOT
//                      re-derivable from graph.json (the WHOLE graph) — so NO per-query nodes/edges.
//        graphPath   — raw absolute to the WHOLE normalized graph.json, for a consumer that wants
//                      structure (read it via the ADR-003 normalizer — that is graph:build/read's
//                      contract, NOT query's). query returns NO graph-derived structured field.

//  graph:triage  input { mode?, pr? }                               → TriageResult
//      mode?       — "triage"|"conflicts"|null (default "triage") ; pr? — a PR number for `prs N`.
//      TriageResult { mode, stdout, graphPath }       (amended 2026-06-21, Three-Amigos feasibility)
//        stdout      — graphify's triage QUEUE markdown, carried OPAQUE. Triage has NO MCP tool and no
//                      stable --json (RESEARCH §H/§C), so a structured prs[] is NOT derivable without
//                      parsing stdout (forbidden) — the queue is the opaque markdown. NO prs[] field;
//                      a structured triage awaits an upstream graphify --json / triage_prs MCP tool.
//        graphPath   — raw absolute to the WHOLE normalized graph.json (same handle as query).

// NORMALIZED GRAPH SHAPES (ADR-003 owns the graph.json → aof normalization; RESEARCH §D):
//   GraphNode { id, label, fileType, sourceFile, community, normLabel }
//   GraphEdge { source, target, relation, confidence, confidenceScore }
//                confidence ∈ {EXTRACTED|INFERRED|AMBIGUOUS}; confidenceScore set only for INFERRED.
//   Hyperedges (3+ nodes, graph.hyperedges) are normalized SEPARATELY, never flattened into edges.

// PATH-DISPLAY / MARKDOWN are FACE adapters (08/ADR-002), not command logic:
//   cli --json : graphPath/projectRoot relativised to process.cwd() (path.relative, OS sep).
//   cli render : prints the opaque `stdout` markdown for humans + a one-line graph summary.
```

**Alternatives considered.**
- *Parse graphify's markdown stdout into the result* — rejected by `RESEARCH §C`: the stdout is
  human/markdown with no stable `--json` and drifts by version; a parser would be a perpetual
  liability. The graph is the contract; stdout is opaque.
- *One `graph:run` command with a `verb` discriminator* — rejected: it would collapse three distinct
  input/result shapes (build writes a graph; query reads it; triage ranks PRs) behind one schema,
  defeating the 08 bijection's per-command CLI form and making the input contract a union. Three
  commands keep each independently testable and CLI-dispatchable (mirrors 08's one-module-per-command).
- *Mirror graphify's full verb list (`extract`/`query`/`path`/`explain`/`add`/`watch`/`prs`/…) 1:1 as
  aof commands* — rejected by `RESEARCH §A`: that surface drifts by version and includes
  documented-but-missing verbs. aof exposes a small, stable façade (build/query/triage); the driver
  maps it onto the pinned binary's real verbs and absorbs the drift in ONE place (ADR-002).
- *Invent a `@graph` tag domain for these commands* — rejected: the tag vocabulary in
  `.aof/aof.config.json work.tags` is CLOSED and `aof:validate` enforces it; there is no `@graph`. The
  commands tag under existing vocabulary (the driver is `@adapter`; see the return).

**Consequences.** Story 00 builds the three `src/commands/graph-*.mjs` + the driver (ADR-002) and adds
the `aof graph` dispatch; the contract above is frozen the moment 00 lands, and stories 01/02/03 consume
it without renegotiation. The result is graph-derived, so a query is only meaningful AFTER a build —
`graph:query`/`graph:triage` fail clearly when no `graphify-out/graph.json` exists (this is an
operational precondition the driver surfaces, distinct from the binary-absent guard, ADR-004). The three
commands inherit 08/ADR-004's bijection automatically — extended by this milestone's own fitness suite
(ADR-006).

**Invariant.** Where a `graph:*` result carries graph-derived structured data it is derived from
`graph.json`, never from graphify's markdown stdout — concretely, `graph:build`'s `BuildResult`
counts/shape come from `graph.json`; `graph:query`/`graph:triage` carry `stdout` OPAQUE plus
`graphPath`, and parse stdout for NOTHING (amended 2026-06-21, Three-Amigos feasibility). Enforced by
`acd-graph-result-from-graphjson` (ADR-006).

## ADR-002: ONE driver module `src/graphify.mjs` is the sole place graphify is spawned; it resolves the binary off PATH, cwd's into the project root, pins a graphify version, and is the only seam provisioning (story 01) implements against

**Status:** Accepted
**Date:** 2026-06-21

**Context.** A `graph:*` command's `run` cannot spawn graphify inline: `RESEARCH §A/I` make the spawn
non-trivial in three ways that must be solved in ONE place, not three. (1) **Binary resolution** — the
install spec is PyPI `graphifyy` but the invoked binary is `graphify` (single-y); `RESEARCH §G` flags
this name asymmetry as load-bearing. (2) **Working-directory bug #756** (`RESEARCH §I`,
assumption A5): `query`/`path`/`explain` hardcode `<cwd>/graphify-out/graph.json` and IGNORE
`GRAPHIFY_OUT` — so the driver MUST `cwd` into the project root that owns `graphify-out/` before any
query-family verb; it cannot redirect via env. (3) **Verb drift** (`RESEARCH §A`, assumption A3): the
real subcommand set is version-dependent, so the contract is only stable against a PINNED graphify
version, and the build verb (`extract`, unconfirmed) must be derived live, not trusted from docs. All
three are spawn-seam concerns; scattering them across three command modules would triplicate the
fragility and give the binary-absent guard (ADR-004) and the no-direct-spawn guard (ADR-006) three
surfaces to police instead of one.

**Decision.** A single new module **`src/graphify.mjs`** (the graphify adapter; matches the house
flat-`src/` layout — `frameworks.mjs`/`adapters.mjs`/`work.mjs` are flat, so the driver is too, NOT
`src/adapters/graphify.mjs`). It is the **ONLY place in the codebase that spawns the graphify binary**.
It exposes a small surface the `graph:*` commands call — `resolveGraphifyBinary()`,
`runGraphifyBuild()`, `runGraphifyQuery()`, `runGraphifyTriage()` — and owns:
- **Binary resolution** — locates the `graphify` (single-y) executable on PATH (the seam story 01's
  provisioning + doctor implement against). Returns a structured `{ found:false }` when absent rather
  than spawning a missing binary (feeds ADR-004's clean-failure guard). Stores BOTH names where a lock/
  doctor entry is written: spec `graphifyy`, binary `graphify` (`RESEARCH §G`).
- **The cwd discipline** — every query-family spawn runs with `cwd = ctx.workspace.projectRoot` so
  graphify finds `<projectRoot>/graphify-out/graph.json` (#756, `RESEARCH §I`). Build writes under the
  same root. The driver NEVER relies on `GRAPHIFY_OUT`.
- **Version pinning** — the driver pins a graphify version (the version the contract is verified
  against) and treats the verb mapping as version-gated (`RESEARCH §A`); an unexpected version is a
  doctor warning (ADR-004), not a silent mismap.
- **Normalization** — reading `graph.json` and producing the ADR-003 normalized shapes; the markdown
  stdout passes through opaque (ADR-001).

`graph:*` commands import ONLY this driver for graphify access; no command, face, or other module spawns
graphify directly.

**The locked driver seam (frozen 2026-06-21):**

```js
// src/graphify.mjs — the SOLE graphify spawn site. graph:* commands call these; nothing else
// spawns graphify (ADR-006 guard). Provisioning + doctor (story 01) implement against
// resolveGraphifyBinary; they do NOT spawn graphify to do graph work.

resolveGraphifyBinary()      → { found:true, binary:"graphify", version, path } | { found:false, hint }
//   hint = "Install graphify: `uv tool install graphifyy` then `graphify install`." (RESEARCH §G)
//   NEVER spawns a build/query when found:false — returns the structured miss (ADR-004).

runGraphifyBuild(input, { projectRoot })   → { graphPath, stdout, stats }
runGraphifyQuery(input, { projectRoot })   → { stdout, graphPath }          // cwd = projectRoot (#756)
runGraphifyTriage(input, { projectRoot })  → { stdout, graphPath }          // cwd = projectRoot (#756)
readGraph(graphPath) → { nodes, links, hyperedges }   // raw graph.json (ADR-003 normalizes)

// PINNED_GRAPHIFY_VERSION — the version the contract is verified against; verb mapping is gated on it.
```

**Alternatives considered.**
- *Spawn graphify inline in each command's `run`* — rejected: triplicates the #756 cwd discipline, the
  binary-resolution miss-path, and the version pinning, and gives the no-direct-spawn guard (ADR-006)
  three surfaces. One driver is one place to police and one place to fix when graphify drifts.
- *Set `GRAPHIFY_OUT` to redirect graphify's output dir* — rejected by `RESEARCH §I` (#756): graphify
  ignores `GRAPHIFY_OUT` for the query family; the env is a dead end. cwd-into-projectRoot is the only
  working strategy until PR #758 lands (assumption A5, re-verify on upgrade).
- *Use graphify's MCP server (`python -m graphify.serve`) as the driver transport instead of the CLI* —
  rejected: the MCP server is graph.json-bound and read-only (the 9 tools of `RESEARCH §H`) and does NOT
  expose PR triage — so build and triage need the CLI regardless. Driving two transports doubles the
  spawn surface. The CLI is the single driver transport; the MCP server is a rendered FACE (ADR-005),
  not aof's own driver.
- *`src/adapters/graphify.mjs` (a nested adapters dir)* — rejected for house consistency: `src/` is
  flat (`adapters.mjs` is itself a flat file); the driver is `src/graphify.mjs`.

**Consequences.** Story 00 owns `src/graphify.mjs` and the three commands together (the driver and the
commands it serves are one contract). Story 01's provisioning + doctor implement against
`resolveGraphifyBinary` — they share the binary-name knowledge (`graphifyy`↔`graphify`) but never spawn
graphify to do graph work. The driver is the choke point the privacy boundary (ADR-005) and the
no-direct-spawn / result-from-graphjson guards (ADR-006) all anchor on.

## ADR-003: The `graph.json` normalization reads NetworkX `nodes`/`links` (NOT `edges`), preserves `confidence`/`confidenceScore`, and handles `graph.hyperedges` separately — keyed by the load-bearing spelling, asserted against a real fixture

**Status:** Accepted
**Date:** 2026-06-21

**Context.** ADR-001 makes the result graph-derived; this ADR pins HOW. `RESEARCH §D` is precise and
the key spelling is load-bearing: `graph.json` is NetworkX `node_link_data` with top-level arrays
**`nodes`** and **`links`** — `links`, NOT `edges` (NetworkX remaps edges→links for portability). An
edge carries `source`/`target`/`relation` (verb phrase: `calls`/`imports`/`implements`/
`semantically_similar_to`), `confidence` (`EXTRACTED`/`INFERRED`/`AMBIGUOUS`), and `confidence_score`
(float, set only on INFERRED). A node carries `id`/`label`/`file_type`/`source_file`/`community`/
`norm_label`. **Hyperedges (3+ nodes) live separately under `G.graph["hyperedges"]`, NOT in `links`** —
flattening them into pairwise `links` would corrupt the graph (`RESEARCH §D` constraint). `id` is the
stable join key. Reading `edges` instead of `links`, or dropping `confidence`, or flattening
hyperedges, are silent-corruption bugs the contract must forbid.

**Decision.** The driver's normalizer (in `src/graphify.mjs`, ADR-002) reads the top-level **`links`**
key for edges (a missing `links` with a present `edges` is treated as a graph-format error, surfaced —
never a silent empty graph), preserves `confidence` + `confidenceScore` on every normalized edge so
downstream consumers (milestones 10/11) can filter INFERRED/AMBIGUOUS, and normalizes `graph.hyperedges`
into a SEPARATE `hyperedges` field — never merged into `edges`. The normalized shapes are the
`GraphNode`/`GraphEdge` of ADR-001's contract block. This is verified by a fixture-driven contract test
against a real committed `graph.json` (`RESEARCH §A1/A2` — CI-testable `@executable`), which asserts the
`links`-not-`edges` spelling and the hyperedge separation.

**Alternatives considered.**
- *Read `edges` (the intuitive name)* — rejected/forbidden by `RESEARCH §D`: NetworkX `node_link_data`
  emits `links`. Reading `edges` yields a silently empty edge set. The fixture test pins `links`.
- *Drop `confidence`/`confidence_score` to simplify the edge shape* — rejected: milestones 10/11 need to
  filter INFERRED/AMBIGUOUS edges (`RESEARCH §D` constraint); discarding confidence is lossy at the
  contract boundary, where it is most expensive to recover.
- *Flatten hyperedges into pairwise edges* — rejected by `RESEARCH §D`: n-ary hyperedges are not
  pairwise; flattening corrupts the graph semantics. They are a separate normalized field.

**Consequences.** Story 00 ships the normalizer + the `graph.json` fixture; story 03 owns the fitness
test that the spelling and hyperedge separation hold. The committed fixture is the contract's anchor: if
a graphify upgrade changes the `node_link_data` shape, the fixture test fails loudly (the desired
behaviour — `RESEARCH §A1` flags the spelling as something to assert against a real `graph.json`).

**Invariant.** The normalizer reads `links` (not `edges`), preserves `confidence`/`confidenceScore`, and
keeps `hyperedges` separate. Enforced by `acd-graph-json-normalization` (ADR-006).

## ADR-004: graphify is provisioned assets-only with an `aof project doctor` binary check — NOT by generalizing the npx installer; the load-bearing npx installer (`src/frameworks.mjs`) stays untouched

**Status:** Accepted
**Date:** 2026-06-21

**Context.** This is the milestone's load-bearing carry-forward (`STATE §Carry-forward`,
`SPEC §Scope`): graphify is a **Python** tool (PyPI `graphifyy`, binary `graphify`, `requires-python
>=3.10`, installed via `uv tool install graphifyy` then `graphify install`, `RESEARCH §G`), but aof's
installer `src/frameworks.mjs` is **npx-only** — `planFrameworkInstall` hardcodes
`["npx", packageName, runtimeFlag, scopeFlag]` (line 66) and the only known framework is GSD. The npx
lane structurally cannot install a Python tool. Two options: **(A)** generalize `src/frameworks.mjs`
with a Python/uv/pipx provider lane, or **(B)** assets-only provisioning (graphify ships its OWN skill +
MCP, `RESEARCH §H`) + an `aof project doctor` check that the `graphify` binary is present, with install
guidance. `RESEARCH §G` strongly favours B: aof drives the *published* tool (it does not own/vendor it,
`SPEC §Out of scope`); the npx installer cannot do Python; B keeps the load-bearing installer untouched.
The doctor seam already exists — `doctorConfig` in `src/config-inspect.mjs:229` returns a `checks[]`
array (`config-valid`/`generated-output-drift`/`adapter-degradation`/…) surfaced by `aof project doctor`
(`cli.mjs:1435`); adding a graphify check is additive.

**Decision.** **Option B.** aof does NOT touch `src/frameworks.mjs`; the npx lane is unchanged. graphify
is provisioned as follows: aof renders graphify's skill + MCP assets through the existing asset/lock
machinery (ADR-005), and adds a **`graphify-binary`** check to `doctorConfig`'s `checks[]`. The check
calls the driver's `resolveGraphifyBinary()` (ADR-002):
- binary present → `severity: "ok"`, message includes the resolved version;
- binary absent → `severity: "warning"` (not "error" — a project may legitimately not graph), message =
  the install guidance `uv tool install graphifyy` then `graphify install` (`RESEARCH §G`);
- version probe unavailable → the check **degrades clearly** (reports "present, version unknown") rather
  than failing — because the exact version/health command is a **live-only assumption** (`RESEARCH §A4`:
  docs do not confirm `graphify --version`; a `.graphify_version` file is mentioned). The check is
  designed to be honest about what it could not determine, never to crash or to assert a version it did
  not observe.

This is the documented DEFAULT decision the PO surfaces for review.

**Alternatives considered.**
- *(A) Generalize `src/frameworks.mjs` with a Python/uv/pipx provider lane* — REJECTED for this
  milestone, recorded as the heavier alternative and the future graduation path. Rejected because: (i)
  it modifies the load-bearing npx installer for one tool aof drives-but-does-not-own (`SPEC §Out of
  scope` forbids owning graphify); (ii) graphify already ships its own skill + MCP installer (`graphify
  install`, `RESEARCH §H`) — aof re-rendering Python provisioning duplicates it; (iii) the npx env
  hardening (`SAFE_NPM_EXEC_ENV`) is npm-specific and would not transfer. **Graduation path:** if a
  future milestone needs aof to *manage* the graphify install lifecycle (pin/upgrade/lock the Python
  binary the way it locks npx packages), generalize the installer THEN — the doctor check is the seam
  that would gate it, and `resolveGraphifyBinary` already stores both names for a future lock entry.
- *Doctor check as an `error` when the binary is absent* — rejected: a project that never graphs should
  still be "healthy"; absence is a `warning` with guidance, not a hard failure. (A `graph:*` command
  invoked without the binary DOES fail clearly — that is ADR-001/ADR-002's command-level guard,
  distinct from the doctor's project-health check.)
- *Assume `graphify --version` exists and hard-read it* — rejected by `RESEARCH §A4`: the version
  command is unconfirmed (live-only). The check degrades to "present, version unknown" rather than
  crashing on an absent flag.

**Consequences.** `src/frameworks.mjs` is provably untouched by this milestone (a fitness guard,
ADR-006). Story 01 implements `resolveGraphifyBinary` (against the ADR-002 seam) and wires the
`graphify-binary` check into `doctorConfig`. Because the version/health probe is a live-only assumption
(`RESEARCH §A4/A5/A7`), story 01's doctor behaviour against a real binary is a `@manual`/doctor-confirmed
sign-off, while the check's *degrade-clearly* structure (warning + guidance + version-unknown branch) is
CI-assertable with the binary stubbed absent.

**Invariant.** No aof code path provisions graphify by spawning npx, and `src/frameworks.mjs` gains no
Python/uv/pipx lane in this milestone. Enforced by `acd-graphify-no-npx-install` (ADR-006).

## ADR-005: graphify's skill + MCP server are rendered FACES through the EXISTING asset/lock/drift machinery; they invoke `aof graph <verb>`, never graphify directly, and aof does NOT re-expose graphify's own MCP verbatim

**Status:** Accepted
**Date:** 2026-06-21

**Context.** `SPEC §Scope` requires a graphify skill + MCP face that invoke the aof graph commands (not
graphify directly), rendered through the existing asset/lock/drift machinery into `claude`/`codex`. The
real seam: `renderConfigOutputs` (`src/adapters.mjs:31`) renders `resources` (skills/rules) and
`mcpServers` (`renderRuntimeConfigOutputs` → `.mcp.json` for claude via `claudeMcpJson`, `config.toml`
for codex via `codexConfigToml`) into the configured runtimes, each output hashed (`hashContent`) and
tracked through the lock so `aof project doctor`'s `generated-output-drift` check
(`config-inspect.mjs:269`) flags edits. graphify SHIPS its own skill (`SKILL.md` +
`.cursor/rules/graphify.mdc`) and its own MCP server (`python -m graphify.serve`, 9 read tools,
`RESEARCH §H`) — but two facts forbid re-exposing them verbatim: (1) graphify's skill instructs the
agent to run the SLASH-FORM `/graphify …` (the surface that diverges from the binary, `RESEARCH §A`) —
an aof face must instead drive `aof graph <verb>`; (2) graphify's MCP exposes 9 read tools but **PR
triage is NOT among them** (`RESEARCH §H`) — so re-exposing graphify's MCP would silently drop a
capability aof's command surface has. The aof face must front aof's OWN commands.

**Decision.** aof authors graphify faces as ITS OWN assets in `.aof/` config, rendered through the
existing machinery (no new render path):
- a **skill** resource whose body instructs the agent to call `aof graph build/query/triage` (the aof
  CLI), NOT `/graphify` slash-form and NOT graphify's binary — rendered by `renderedResource`
  (`adapters.mjs`) into `claude`/`codex` like any other skill;
- an **MCP server** declared in config `mcpServers` whose `command`/`args` launch an **aof-fronted**
  server (one that calls `invoke("graph:…")` behind the registry, the in-process core), rendered into
  `.mcp.json`/`config.toml` by `renderRuntimeConfigOutputs`. aof does NOT declare graphify's own
  `python -m graphify.serve` as the MCP — that would re-expose graphify's 9 tools verbatim (missing
  triage) and bypass the command core.

Both flow through the existing lock/hash/drift machinery unchanged, so `aof project doctor` reports
drift on the rendered graphify faces exactly as for any asset. The faces are thin: they invoke the
registered commands, carrying NO graphify-spawn of their own (that is the driver's sole job, ADR-002).

**Amendment (2026-06-21, Three-Amigos feasibility + PO split).** A pre-authoring feasibility pass
(developer seat) caught that the "no new render path" framing above is true for the rendered config
ENTRY but false for the SERVER it points at. The Decision's MCP bullet conflated two things: (a) the
rendered `mcpServers` config entry whose `command`/`args` target an aof-fronted server — this IS free on
the existing machinery (`renderRuntimeConfigOutputs` → `.mcp.json`/`config.toml`, hashed + drift-tracked
like any asset), exactly as written; and (b) the aof-fronted server runtime that entry launches — which
does NOT exist. A repo-wide grep confirms aof ships **no MCP server runtime today**: no
`@modelcontextprotocol/*` dependency, no `setRequestHandler`/`StdioServerTransport`/`new Server(` in
`src/`, and no `aof … serve` command. The milestone-08 core is in-process only (CLI + board-UI faces,
never an MCP transport). So standing up that server is **net-new work materially larger than authoring a
rendered asset** — an MCP SDK dependency + a stdio `Server` whose tool handlers map `tools/call` →
`invoke("graph:…")` + an `aof graph serve` launch command — not a render at all.
**The PO split (`aof:refine 09 --autonomous`).** Story **02** keeps the rendered skill + the rendered
MCP **config entry** (both free on the existing machinery, as the Decision states). The **net-new MCP
server runtime** moves to story **04 (mcp-server-runtime)**: a stdio `aof graph serve` server whose tool
handlers map `tools/call` → `invoke("graph:…")`, and which the story-02 config entry's `command`/`args`
target. The live "agent reaches the graph through the MCP face" end-to-end likewise moves to story 04.
**The boundary the original Decision asserts is UNCHANGED and extends to the new server:** story 04
introduces aof's FIRST MCP transport, but it is a thin transport FACE over the 08 core — it reaches the
graph ONLY through `invoke("graph:…")`, exactly as the CLI and board faces do, and it NEVER spawns
graphify itself (graphify is spawned only from `src/graphify.mjs`, ADR-002). Therefore ADR-006 inv. 2
(no-face-spawn) extends to the server module / the `aof graph serve` path, and the
`acd-graph-no-face-spawn` arch-test greps it too (see ADR-006 inv. 2 amendment). The original Decision
text above stands; this amendment refines only the "no new render path" framing — true for the config
entry, false for the server.

**Amendment (2026-06-21, build — hand-rolled MCP server, ratified).** Story 04 shipped the MCP server runtime (`src/graph-mcp-server.mjs`) as a **minimal hand-rolled stdio JSON-RPC 2.0 server with no `@modelcontextprotocol/sdk` dependency** — chosen to preserve aof's lean, supply-chain-tight posture (3 runtime deps), and ratified at build review; this SUPERSEDES the prior amendment's "introduces an MCP SDK dependency" ESTIMATE (the dependency was never taken). The swap-to-SDK path stays contained: `handleMcpMessage` is the pure request-router (message in → response out, no I/O) and `serveStdio` is the only I/O shell, so adopting the SDK later would replace the shell and re-wire the router without touching the graph boundary. That boundary — the one ADR-005 and ADR-006 inv. 2 actually require — is HONOURED: the server reaches the graph ONLY via `invoke("graph:…")`, imports neither `src/graphify.mjs` nor `child_process`, and spawns nothing.

**Alternatives considered.**
- *Render graphify's shipped skill + `python -m graphify.serve` MCP verbatim* — rejected: the shipped
  skill drives the slash-form (binary-divergent, `RESEARCH §A`) and the shipped MCP omits PR triage
  (`RESEARCH §H`); both bypass aof's command core, the exact side-channel `SPEC §Objective` forbids.
- *Build a NEW render path for graphify faces* — rejected: `renderConfigOutputs` already renders skills
  and MCP servers with lock/drift tracking; a parallel path would escape the drift machinery and
  duplicate `adapters.mjs`. The faces are ordinary config resources.
- *Skip the MCP face; ship only the skill* — rejected by `SPEC §Scope` (the face set is skill + MCP).
  The MCP face is what lets an agent query the graph as tools; it must front `aof graph` so the 9-tool/
  triage asymmetry of graphify's own MCP does not leak.

**Consequences.** Story 02 authors the graphify skill + MCP face as `.aof/` resources and verifies they
render through `renderConfigOutputs` into both runtimes with drift tracking. The faces invoke
`aof graph …`; the no-direct-spawn guard (ADR-006) proves no face spawns graphify. Because the faces are
ordinary assets, the existing asset tests and the doctor drift check cover them for free.

**Invariant.** No rendered face (skill/MCP config entry/board) AND no MCP **server runtime** (the
story-04 `aof graph serve` module, amended 2026-06-21) spawns graphify directly; faces and the server
reach the graph ONLY through `invoke("graph:…")` / `aof graph <verb>`, and graphify is spawned ONLY from
`src/graphify.mjs`. Enforced by `acd-graph-no-face-spawn` (ADR-006).

## ADR-006: The graphify structural guarantees are SIX fitness functions extending the 08 bijection — registration+CLI, no-face-spawn, binary-absent-clean-failure, privacy-no-widening, result-from-graphjson, and no-npx-install — each a `test/arch/*` arch-test, RED until built

**Status:** Accepted
**Date:** 2026-06-21

**Context.** This is the load-bearing deliverable, mirroring 08/ADR-004: the contract (ADR-001), the
driver (ADR-002), the normalization (ADR-003), the install decision (ADR-004), and the faces (ADR-005)
are durable only if ENFORCED. The guarantees are structural facts over the registry, the spawn surface,
the import graph, and `graph.json` — so they are fitness functions here, NOT Gherkin scenarios (the
observable counterparts — "`aof graph build` builds a real graph", "`aof graph query` answers a
question against it" — are task `.feature` files over the real graphify binary, authored by stories
00/01, and gated `@manual` where they need the live binary, `RESEARCH §A3/A4/A5`). The house idiom is
the 08 one: registry import + source-grep (call-form-not-comment discipline) + CLI spawn-and-parse +
fixture-driven contract test. **RED-until-built is correct now**: `src/graphify.mjs` and
`src/commands/graph-*.mjs` do not exist; the tests reference them and fail cleanly until story 00/01/02
land.

**Decision.** Six invariants, six arch-tests under `test/arch/`:

1. **Graph commands registered + CLI bijection (the 08 bijection, extended).** `graph:build`/
   `graph:query`/`graph:triage` are in the SAME `listCommands()` registry, each with a non-null `cli`
   adapter (`cli.argv`/`cli.render` functions) AND a reachable `aof graph <verb>` dispatch branch.
   Proven by importing the registry + source-grepping the `graph` dispatch in `cli.mjs` + a CLI
   spawn-and-parse smoke (the 08 `acd-work-command-cli-bijection` idiom, applied to `graph:*`).

2. **No face spawns graphify directly (ADR-005's guard; amended 2026-06-21, PO split).** No
   rendered-face surface (the skill/MCP asset bodies, the board, `setup-ui.mjs`), no
   `src/commands/graph-*.mjs`, AND no MCP **server runtime** (the story-04 `aof graph serve` server
   module under `src/`) spawns graphify; the only `spawn`/`spawnSync`/`exec` of the `graphify` binary in
   the codebase is in `src/graphify.mjs`. The MCP server is a thin transport face: its `tools/call`
   handlers map to `invoke("graph:…")`, never to a graphify spawn (ADR-005 amendment). Proven by
   source-grep (comments/strings discounted per house discipline): grep all of `src/` — INCLUDING the
   MCP server module — for a `graphify` spawn → assert the ONLY match is `src/graphify.mjs`.

3. **Binary-absent clean failure (ADR-002/ADR-004's guard).** `resolveGraphifyBinary()` returns a
   structured `{ found:false, hint }` when graphify is absent (never throws an opaque ENOENT), and a
   `graph:*` command (or the `graphify-binary` doctor check) surfaces it as a clear,
   guidance-bearing failure — never silently. Proven by importing the driver with PATH stubbed empty
   and asserting the structured miss + the install hint, and asserting the doctor check degrades to a
   `warning` (not a crash).

4. **Privacy boundary not widened (ADR-001/ADR-005's guard).** No aof code path sends source code / AST
   to a backend: aof only ever passes graphify a `--backend` + a folder path; the egress is exactly
   graphify's own doc/media hop, unmodified. Proven structurally: source-grep `src/graphify.mjs` (and
   the command modules) asserting (a) the code-only/offline build path passes NO backend/key (a
   null/absent `backend` ⇒ no `--backend` flag), and (b) aof never reads source-file CONTENTS to ship
   anywhere — it passes graphify a PATH and lets graphify do the local AST extraction (`RESEARCH §E/F`).

5. **Result derived from graph.json, not stdout (ADR-001's invariant; amended 2026-06-21).** Where a
   `graph:*` result carries graph-derived structured data it comes from the normalized `graph.json`,
   never from stdout; and `query`/`triage` carry NO graph-derived structured field — only opaque
   `stdout` + `graphPath`. Proven by the fixture contract test (ADR-003): feed a real `graph.json` + a
   captured markdown `stdout` through the normalizer and assert the `nodes`/`edges`/`hyperedges` come
   from `graph.json` (correct `links` spelling, confidence preserved, hyperedges separate) and that the
   markdown is NOT parsed for those fields; AND assert the `graph:query`/`graph:triage` results expose
   no graph-structured field beyond `graphPath` (their answer is `stdout`, opaque) — so there is no
   stdout-parsing surface to drift.

6. **No npx install of graphify; the npx installer untouched (ADR-004's invariant).** No aof code
   provisions graphify via npx, and `src/frameworks.mjs` gains no Python/uv/pipx lane in this milestone.
   Proven by source-grep: `frameworks.mjs` has no `graphify`/`uv`/`pipx`/`pip install` reference and its
   spawn argv[0] stays `npx`; no module spawns `npx graphifyy`.

These are structural (over the registry, the spawn surface, the import graph, `graph.json`, the
installer) — fitness functions, here, not task scenarios. Their observable counterparts are stories
00/01's `.feature` files over the real binary.

**Alternatives considered.**
- *Fold the graph guards into the 08 `acd-work-command-cli-bijection` test* — rejected: 08's bijection
  is parameterised on the work surface; the graph guards (no-face-spawn, privacy, graph.json
  normalization, no-npx) are graphify-specific structural facts that earn their own named tests so the
  fitness table indexes one reviewable contract per invariant (mirrors 08's four-test split).
- *Make no-face-spawn a runtime assertion (throw if a face spawns graphify)* — rejected (same reasoning
  as 08/ADR-004): a runtime throw catches it late; an arch-test fails on the diff that introduces the
  drift. The source-grep is the braces.
- *Assert the privacy boundary only behaviourally (run an offline build, observe no network)* —
  partially adopted as a `@manual`/sandboxed `.feature` (`RESEARCH §A8`), but the STRUCTURAL guard
  (no aof path ships source contents; offline build passes no backend) is the fitness function — it
  fails in CI on the diff, where the behavioural offline run cannot run in CI without the binary.

**Consequences.** Story 03 authors all six arch-tests against the FROZEN driver/registry (story 00);
they are RED until 00/01/02 land, then GREEN and load-bearing. Story 03's "contract" IS this ADR — it has
no `.feature` pass of its own (mirrors 08/03 and the milestone-08 fitness-only story). Any future change
that adds a graph face spawning graphify, a `graph:*` command without a CLI form, a result parsed from
stdout, a source-code egress, or an npx install of graphify fails CI loudly.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is correct now: src/graphify.mjs and src/commands/graph-*.mjs do not exist yet;
     the graphify faces are not authored; the doctor check is not wired. The tests reference them and
     fail cleanly until stories 00/01/02 land. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Graph commands registered + CLI bijection.** `graph:build`/`graph:query`/`graph:triage` are in the SAME `listCommands()` registry, each with a non-null `cli` adapter and a reachable `aof graph <verb>` dispatch branch — no graph command the CLI cannot run (the 08 bijection, extended to `graph:*`). | `test/arch/acd-graph-command-cli-bijection.test.mjs` (import the registry; assert the three `graph:*` commands carry `cli.argv`/`cli.render` functions; source-grep the `graph` dispatch in `cli.mjs` for a branch per verb; CLI spawn-and-parse `aof graph {build,query,triage} --json` against a fixture — the `acd-work-command-cli-bijection` idiom applied to graph) | RED until `src/commands/graph-*.mjs` register and `cli.mjs` dispatches `aof graph <verb>` | ADR-001, ADR-006 (inv. 1) |
| **No face spawns graphify directly** (amended 2026-06-21, PO split). The only `spawn`/`spawnSync`/`exec` of the `graphify` binary anywhere in `src/` is in `src/graphify.mjs`; no skill/MCP/board face, no `graph:*` command, AND no MCP **server runtime** (the story-04 `aof graph serve` server module) spawns graphify — the server's `tools/call` handlers map to `invoke("graph:…")`, never a graphify spawn. | `test/arch/acd-graph-no-face-spawn.test.mjs` (source-grep all of `src/` — call-form, comments/strings discounted, INCLUDING the MCP server module — for a `graphify` binary spawn; assert the ONLY file with one is `src/graphify.mjs`; assert the graph command modules + the graphify face assets + the `aof graph serve` server module spawn nothing) | RED until `src/graphify.mjs` exists and is the sole spawn site | ADR-002, ADR-005, ADR-006 (inv. 2) |
| **Binary-absent clean failure.** `resolveGraphifyBinary()` returns a structured `{ found:false, hint }` (with the `uv tool install graphifyy` guidance) when graphify is absent — never an opaque ENOENT; a `graph:*` command and the `graphify-binary` doctor check surface it clearly (doctor degrades to `warning`, never crashes). | `test/arch/acd-graph-binary-absent.test.mjs` (import the driver with PATH stubbed empty; assert the structured `{found:false}` + the install hint; assert `doctorConfig`'s `graphify-binary` check returns `severity:"warning"` with guidance, never throws; assert the version-unknown branch degrades clearly per RESEARCH §A4) | RED until `resolveGraphifyBinary` + the doctor check exist | ADR-002, ADR-004, ADR-006 (inv. 3) |
| **Privacy boundary not widened.** No aof code path ships source code / AST to a backend; aof passes graphify a `--backend` + a folder PATH only, and a null/absent backend ⇒ NO `--backend` flag, zero egress (code/AST stays local — RESEARCH §E/F). aof never reads source-file contents to send anywhere. | `test/arch/acd-graph-privacy-boundary.test.mjs` (source-grep `src/graphify.mjs` + the graph command modules: assert the offline/code-only path passes no backend/key when `backend` is null/absent; assert aof passes a path to graphify and reads NO source-file contents for egress; the egress is graphify's own doc/media hop, unmodified) | RED until `src/graphify.mjs` exists | ADR-001, ADR-005, ADR-006 (inv. 4) |
| **Result derived from graph.json, not stdout** (amended 2026-06-21, Three-Amigos feasibility). Where a `graph:*` result carries graph-derived structured data (`graph:build`'s `nodes`/`edges`/`hyperedges` counts/shape) it is normalized from `graph.json` (NetworkX `links` NOT `edges`; `confidence`/`confidenceScore` preserved; `graph.hyperedges` kept separate); graphify's markdown `stdout` is carried opaque and never parsed for data. `graph:query`/`graph:triage` carry NO graph-derived structured field — only opaque `stdout` + `graphPath`. | `test/arch/acd-graph-json-normalization.test.mjs` (fixture-driven: feed a real committed `graph.json` + a captured markdown stdout through the normalizer; assert edges come from the `links` key — a `links`-absent/`edges`-present graph is a surfaced format error; assert `confidence`/`confidenceScore` survive; assert `graph.hyperedges` normalize SEPARATELY, never flattened into edges; assert the structured fields are NOT derived from stdout; AND assert `QueryResult`/`TriageResult` expose no graph-structured field beyond `graphPath` — RESEARCH §A1/A2 `@executable`) | RED until the normalizer + the `graph.json` fixture exist | ADR-001, ADR-003, ADR-006 (inv. 5) |
| **No npx install of graphify; npx installer untouched.** No aof code provisions graphify via npx, and `src/frameworks.mjs` gains no Python/uv/pipx lane in this milestone — the load-bearing npx installer is unchanged (assets-only + doctor, ADR-004 Option B). | `test/arch/acd-graphify-no-npx-install.test.mjs` (source-grep `src/frameworks.mjs`: no `graphify`/`graphifyy`/`uv`/`pipx`/`pip install` reference, spawn argv[0] stays `npx`; source-grep the codebase: no module spawns `npx graphifyy`) | GREEN now (`frameworks.mjs` is npx-only today) and must STAY green — a regression guard that Option B keeps the installer untouched | ADR-004, ADR-006 (inv. 6) |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 08's split):
     - REGISTRATION+BIJECTION, NO-FACE-SPAWN, BINARY-ABSENT-CLEAN-FAILURE, PRIVACY-NO-WIDENING,
       RESULT-FROM-GRAPHJSON, NO-NPX-INSTALL are structural invariants over the registry / spawn surface
       / import graph / graph.json / installer → arch-tests (this table). They are the milestone's
       load-bearing deliverable (story 03 — no .feature pass of its own, mirroring 08/03).
     - The OBSERVABLE end-to-end behaviours — "`aof graph build <folder>` builds a real graph.json",
       "`aof graph query` answers a question against it", "the rendered skill/MCP invoke `aof graph …`",
       "`aof project doctor` reports the binary present against a live install" — belong in task .feature
       files authored by stories 00/01/02 over the REAL graphify binary, and are gated @manual where they
       need the live binary or its unconfirmed verb/version surface (RESEARCH §A3/A4/A5/A7).
     - The path-display divergence (cli --json relativises graphPath/projectRoot to cwd; render prints
       opaque markdown) is a FACE adapter (ADR-001, inheriting 08/ADR-002) — proven by the CLI --json
       contract test, not a fitness function of its own. -->

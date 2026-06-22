---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 10 · Graphify Memory Backend — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — graphify as a *selectable backend behind
> `aof work memory`*, filling the semantic-backend slot 05 reserved, reached only through the 09 graph
> commands, "no bespoke second integration") and `STATE.md` (`§Carry-forward to refine`: the
> derived-index invariant for the graph backend + the one open question — graph scope = work stream
> only, or + codebase). ADRs cite these as `SPEC §…` / `STATE §…`, the researcher's `RESEARCH.md` as
> `RESEARCH §A…O` / `§AA1…AA13`, and the runnable pre-refine spike's `spike/FINDINGS.md` + its real
> `spike/graphify-out/graph.json` as `SPIKE Fn`. This milestone consumes TWO frozen contracts WHOLE and
> re-opens neither: milestone **05** (the memory seam — `memory.backend` selection read in ONE place
> `05/ADR-002`; the backend interface `{name, recall, reindex, status}` `05/ADR-003`; the `RecallResult`
> `05/ADR-004`; the `MemoryRecord` with a resolving `source:line` + the derived-index invariant
> `05/ADR-005`; scoped + length-normalised ranking `05/ADR-006`; source set = RETROSPECTIVE R-entries +
> ARCHITECTURE ADRs `05/ADR-007`) and milestone **09** (the `graph:build/query/triage` commands —
> `query`/`triage` carry OPAQUE stdout, parsing FORBIDDEN `09/ADR-001`; `src/graphify.mjs` is the SOLE
> graphify spawn site, `input.backend → --backend` `09/ADR-002`; the `graph.json` normalization
> `09/ADR-003`; assets-only provisioning + the `graphify-binary` doctor check + `resolveGraphifyBinary()`
> structured miss `09/ADR-004`; faces/server never spawn graphify, never widen egress `09/ADR-005`; the
> six fitness functions `09/ADR-006`). The real code these ADRs build against was read at `file:line`:
> `src/work-memory.mjs` (the seam — `BACKEND_REGISTRY`, `selectBackendName`, `ctx = {workDir,
> projectRoot, configMemory}`), `src/memory/local-indexing.mjs` + `local-retrieval.mjs` (the 05
> parsers/ranking this milestone REUSES — `buildRecords`, `MEMORY_RECORD_FIELDS`, `applyScope`,
> `rankRecords`, the injectable `ctx.records`), `src/memory/none-backend.mjs` (the degrade shape),
> `src/command-core.mjs` (`invoke(id, input, ctx)`, `ctx = {workspace}`), `src/commands/graph-build.mjs`
> (`NETWORK_BACKENDS`/`LOCAL_BACKENDS`/`classifyEgress`), `src/graphify.mjs`
> (`normalizeGraph`/`readGraph`/`graphJsonPath`/`graphifyBuildArgs`), and `schemas/aof.schema.json`
> (`$defs/memory`, enum `["local","none"]`).
>
> **Prior-lesson recall.** `aof work memory recall "graphify memory backend graph-grounded recall
> derived index claude-cli" --area architecture --block` returned an EMPTY block — no near-miss to
> honour or depart from (memory backend is `none`, so recall is the no-op `none` backend; the very gap
> this milestone exists to fill). Decisions below stand on the 05/09 frozen contracts + RESEARCH + the
> SPIKE alone.

## ADR-001: Records come from milestone-05's markdown parsers; the graphify graph is a file-level relatedness/ranking SIGNAL over those records — graphify is NOT the record store

**Status:** Accepted
**Date:** 2026-06-22

**Context.** The milestone's name promises "graph-grounded recall," and the naive reading is "the
records come FROM the graph." Two independently-confirmed facts forbid that reading. (1) **No structured
records out of graphify.** `09/ADR-001` froze `graph:query`/`graph:triage` so their `stdout` is
graphify's human markdown carried OPAQUE and **parsing it is FORBIDDEN**; the only structured handle
either verb returns is `graphPath`, a path to the WHOLE `graph.json` (`RESEARCH §D`). So a backend
cannot obtain `MemoryRecord`s from a query — the only structured surface is `readGraph` + `normalizeGraph`
over `graph.json`. (2) **Graph nodes carry FILE-LEVEL provenance only.** The canonical node schema is
`{id, label, file_type, source_file, community, norm_label}` with NO line/section/anchor field
(`RESEARCH §C`); the real spike `graph.json` confirms it empirically — every one of its 5 nodes carries
`source_location: null` (`SPIKE F6`). A document node maps back to a FILE (`source_file`), never to a
1-based line within it. But `05/ADR-005` makes `MemoryRecord.source = "<workRelPath>:<1-based line>"`
that **MUST resolve to live text** — the load-bearing spine of the derived-index invariant
(`src/memory/local-indexing.mjs:125/166` build it from a per-section heading line). The best a
graph-node→record mapping could yield is `<source_file>:1` (or no line), which FAILS that guarantee.
So the graph cannot SUPPLY the frozen records; mapping graph nodes → records is blocked (`RESEARCH §F`
option (b); `SPIKE F6` — "the graph is a ranking layer, never the record source").

**Decision.** The graphify backend's records come from milestone-05's existing markdown parsers,
UNTOUCHED, and the graphify graph is layered on top purely as a **file-level relatedness/ranking signal**:
- **Records** are produced by REUSING `buildRecords(only, ctx)` and the `parseRetrospective` /
  `parseArchitecture` parsers from `src/memory/local-indexing.mjs` — the exact same RETROSPECTIVE
  R-entries + ARCHITECTURE ADRs the local backend indexes (`05/ADR-007`), each a frozen `MemoryRecord`
  with a resolving `source:line` (the derived-index invariant holds **unchanged** because the provenance
  spine is the 05 parser, not the graph).
- **Re-ranking** uses the normalized `graph.json` (`normalizeGraph` → `{nodes, edges, hyperedges}`,
  `09/ADR-003`) as an ADDITIONAL signal over the candidate records: node `community` co-membership,
  `semantically_similar_to` / inferred edges (`confidence`/`confidenceScore` preserved), god-node
  centrality (edge degree), joined to records by **`source_file`** — the only key both share, since the
  join is necessarily file-level (`RESEARCH §C`, `SPIKE F6`; `source_file`-keyed, not graph-`id`-keyed,
  because the LLM assigns node ids and they can drift across rebuilds — `SPIKE` open questions).
- **"Graph-grounded recall" is therefore DEFINED as "graph-reranked recall over 05's records"** — the
  graph boosts/reorders records whose FILE is graph-central or graph-related to the query, on top of 05's
  scoped + length-normalised base ranking (`05/ADR-006`).

This is reconciliation option (a) of `RESEARCH §F`, the only option that keeps `source:line`
unconditionally safe (`SPIKE F6`). It satisfies frozen `05/ADR-003/004/005/006/007` byte-for-byte: the
backend is a `{name, recall, reindex, status}` module; `recall` returns the frozen `RecallResult` of
`MemoryRecord`s + `score`; every `source` resolves; scope is the same hard pre-filter; the graph is an
extra ranking term, not a new record shape.

**Locked contract this ADR satisfies (FROZEN by 05 — inherited, NOT re-opened):**

```js
// 05/ADR-005 MemoryRecord.source — the spine this milestone preserves through the 05 parser:
//   "source": "<work-relative path>:<1-based line>"   // MUST resolve to live text
// 05/ADR-004 RecallResult — the graphify backend's recall returns EXACTLY this shape:
//   { query, scope, records: [ MemoryRecord & { score:number } ], text }
// The graph contributes ONLY to `score` (a re-rank term); it adds NO field to MemoryRecord and
// changes NO field's meaning. Records ⇐ buildRecords() (05 parsers). Graph ⇐ normalizeGraph(graph.json).
// Join key = MemoryRecord.source's <path> (file) ↔ GraphNode.sourceFile. NEVER graph-id-keyed.
```

**Alternatives considered.**
- *Map `graph.json` document-nodes → `MemoryRecord`s (records FROM the graph)* — REJECTED, blocked by
  file-level provenance (`RESEARCH §F` option (b); `SPIKE F6`): nodes carry no line, so `source` degrades
  to `<file>:1` and fails `05/ADR-005`'s resolve-to-a-per-entry-line invariant; and the node fields
  (`label`/`file_type`) are not aof's record taxonomy (`recordType`/`kind`/`area`/`owner`/…), so the
  records would be LLM-summarised prose, not source-traceable text — a second strain on the derived-index
  invariant.
- *Build the graph over a generated one-file-per-record corpus (`RESEARCH §F` option (c))* — REJECTED for
  this milestone: it gives a clean 1:1 node↔record join but at the highest egress (ships a per-record
  corpus) and the most machinery (a second derived layer), and the `source:line` guarantee STILL rests on
  the 05 parser (aof must keep that mapping regardless) — so the graph is a ranking layer in (c) exactly
  as in (a), at strictly higher cost. (a) is (c) without the redundant corpus.
- *Skip records entirely and return `graph:query`'s markdown as the recall text* — REJECTED: it returns
  no structured `records[]` (violates `05/ADR-004`), no resolving `source` (violates `05/ADR-005`), and
  would force parsing the opaque stdout (`09/ADR-001` FORBIDS it).

**Consequences.** The backend is a thin composition of two frozen, independently-built halves: the 05
parsers (already shipped) for records, and a new pure re-ranker over `normalizeGraph`'s output for the
graph signal. The re-ranker is a pure function of `(records, normalizedGraph, query, scope)` — fixture
testable against a committed `graph.json` with NO live binary (`RESEARCH §AA2/AA3`; the spike's real
`graph.json` is a ready fixture). The graph's coarse (file-level) grain is an accepted limitation: it
cannot distinguish two ADRs in the same file by graph signal — but it never needs to, because the 05
base ranking already orders within-file and the graph only reweights across files.

**Invariant.** The graphify backend's `recall` returns records produced by the 05 parsers (each with a
resolving `source:line`), never records synthesised from `graph.json` nodes; the graph contributes only
to `score`. A fresh `reindex` rebuilds both the records (from `.md`) and the graph (a derived artifact),
and every record's `source` resolves to live text. Enforced by `acd-graphify-records-from-parsers` and
`acd-graphify-derived-index` (ADR-006).

## ADR-002: The backend reaches graphify ONLY through milestone-09's registered `graph:*` commands via `invoke(...)` — never `src/graphify.mjs`, never a graphify spawn; the seam-bridge constructs a `{workspace}`-shaped ctx from the memory ctx

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `SPEC §Objective/§Dependencies` is explicit: the backend "reaches graphify **through the
registered graph commands from milestone 09** — no bespoke second integration." `09/ADR-002` already made
`src/graphify.mjs` the SOLE place graphify is spawned, and `09/ADR-006` inv. 2 (the `acd-graph-no-face-spawn`
guard) asserts the only `graphify` spawn in `src/` is there. A second integration — a memory backend that
imported `src/graphify.mjs` or spawned graphify itself — would (a) duplicate the #756 cwd discipline,
binary resolution, and version pinning `09/ADR-002` centralises, and (b) give the no-direct-spawn guard a
second surface to police. The backend must go through the command core, exactly as the CLI, board, and
MCP-server faces do.

There is ONE real integration seam to resolve, and it is a `ctx`-shape mismatch. The memory seam hands a
backend `ctx = {workDir, projectRoot, configMemory}` (`src/work-memory.mjs:346`). But command-core's
`invoke(id, input, ctx)` expects `ctx = {workspace}` where `workspace` is the `loadWorkspace` result
`{workDir, config, projectRoot, configPath}` (`src/command-core.mjs:20-24`; `graph:build`'s `run` reads
`ctx.workspace.projectRoot`, `src/commands/graph-build.mjs:66`). The backend cannot pass its own memory
ctx straight to `invoke` — it must construct the `{workspace}`-shaped ctx the graph command needs.

**Decision.** The graphify backend module imports `invoke` from `src/command-core.mjs` and reaches the
graph ONLY through it; it imports NEITHER `src/graphify.mjs` NOR `node:child_process`, and spawns nothing.
- **`reindex(only, ctx)`** does two things: (1) rebuilds the 05 records by calling the reused
  `buildRecords(only, ctx)` / writing the same derived index (ADR-001), and (2) (re)builds the graph by
  calling `invoke("graph:build", { path, backend }, graphCtx)` over the work-stream corpus (the
  `workDir` directory of `.md` files), where `backend` is the extraction backend of ADR-003 and `path` is
  the work stream. The returned `BuildResult.graphPath` (a raw absolute) is where the graph landed.
- **`recall(query, scope, opts, ctx)`** reads the normalized graph by `readGraph(graphPath)` →
  `normalizeGraph(...)` **via the path the build returned / `graphJsonPath(projectRoot)`** — reading the
  on-disk `graph.json` artifact is NOT a graphify spawn and NOT forbidden (it is exactly what
  `09/ADR-001` permits: structure comes from `graph.json`, never from `graph:query`'s opaque stdout). It
  then runs the ADR-001 re-ranker over the 05 records + the normalized graph.
- **The seam-bridge (the one real integration seam).** The backend constructs the `{workspace}` ctx the
  graph command needs from the memory ctx it was handed: `graphCtx = { workspace: { workDir:
  ctx.workDir, projectRoot: ctx.projectRoot, config: <the loaded config>, configPath: <…> } }`. The
  memory ctx already carries `workDir`/`projectRoot`; the `config`/`configPath` are obtained the same way
  the seam's CLI wrapper obtains them — from `loadWorkspace` (the backend may be handed the full workspace
  on `ctx`, OR call `loadWorkspace(projectRoot)` lazily; story 00 picks the lighter wiring, but the
  CONTRACT is: the backend builds a `{workspace}` ctx and calls `invoke("graph:…")`, it never reaches
  around the command core). Reading the resulting `graph.json` uses `graphJsonPath`/`readGraph`/
  `normalizeGraph` — pure file/parse helpers, not spawns.

**Locked seam this ADR satisfies (the graphify backend's ONLY graphify access):**

```js
// The graphify backend reaches graphify EXCLUSIVELY through command-core invoke — no second integration.
import { invoke } from "../command-core.mjs";       // the ONLY door to graphify
// FORBIDDEN in this module: import "../graphify.mjs"; import "node:child_process"; any graphify spawn.

// reindex: rebuild records (05 parsers) + (re)build the graph through the 09 command.
//   await invoke("graph:build", { path: workDir, backend: extractionBackend }, { workspace })
// recall: read the on-disk graph.json artifact (NOT a spawn, NOT graph:query) + re-rank.
//   normalizeGraph(readGraph(graphJsonPath(projectRoot)))   // structure from graph.json (09/ADR-001)
// Seam-bridge: memory ctx {workDir, projectRoot, configMemory} → graph ctx { workspace:{workDir,
//   projectRoot, config, configPath} }. The backend BUILDS the {workspace} ctx; it never bypasses invoke.
```

**Alternatives considered.**
- *Import `src/graphify.mjs` directly (call `runGraphifyBuild`/`readGraph` straight)* — REJECTED: it is
  the "bespoke second integration" `SPEC §Objective` forbids; it bypasses the `graph:build` command's
  egress classification, offline guard, and binary-absent guard (`09/ADR-004`); and it adds a second
  graphify-touching surface the no-direct-spawn guard must learn. Going through `invoke("graph:build")`
  inherits all of those for free. (Reading `graph.json` via the driver's PURE `readGraph`/`normalizeGraph`
  helpers is permitted — they spawn nothing; only the SPAWN seam is exclusive to the command.)
- *Drive `graph:query` for recall and use its markdown* — REJECTED: `09/ADR-001` carries the stdout opaque
  and FORBIDS parsing it; `graph:query` ignores 05's scope filters entirely (`RESEARCH §D`); structure
  must come from `graph.json` (ADR-001).
- *Pass the memory `ctx` straight to `invoke`* — REJECTED: shape mismatch — `graph:build`'s `run` reads
  `ctx.workspace.projectRoot`; a bare `{workDir, projectRoot, configMemory}` would make
  `ctx.workspace` undefined and throw. The seam-bridge is the honest fix.

**Consequences.** Story 00 owns the backend module + the seam-bridge + `reindex`; story 01 owns the
re-ranker `recall` reads the graph for. The backend never appears in the `acd-graph-no-face-spawn` denial
set because it spawns nothing — but a NEW fitness function (`acd-graphify-backend-via-command`) asserts
the module imports `command-core` and NOT `src/graphify.mjs`/`child_process`, pinning the
no-second-integration boundary structurally. The backend inherits the graph command's binary-absent
behaviour (ADR-004) automatically because it calls the guarded command, not the raw driver.

## ADR-003: Selection registers `"graphify"` in the `$defs/memory` enum (one line, the single reviewable touchpoint); the extraction backend defaults to `claude-cli` (surfaced + opt-in), and `src/commands/graph-build.mjs` learns the `claude-cli` value — egress stays honestly `docs-media`

**Status:** Accepted
**Date:** 2026-06-22

**Context.** Three coupled choices live here. (1) **Selection.** `05/ADR-002` made `memory.backend` an
enum read in ONE place (`selectBackendName`, `src/work-memory.mjs:42`), and growing the enum by one line
is "a deliberate, reviewable touchpoint." The schema enum is `["local", "none"]` today
(`schemas/aof.schema.json:417`); registering graphify is exactly one enum value + one `BACKEND_REGISTRY`
line. (2) **The extraction backend.** Building a prose graph over the `.md` work stream REQUIRES an LLM
pass — Pass 3, the only producer of prose nodes (`RESEARCH §A`); there is NO zero-egress build that yields
useful nodes. The privacy-cleanest credential posture is graphify's **native `claude-cli` backend**
(`RESEARCH §J`, `SPIKE F4`): it drives `claude -p` over the user's existing Claude subscription with NO
`ANTHROPIC_API_KEY`, no third-party key, no shim — and the 09 driver already threads `input.backend →
--backend` (`src/graphify.mjs:113-117`), so selecting it is a one-token change. The spike CONFIRMED it
end-to-end on real data with zero env vars and est. cost $0.0000 (`SPIKE F4`). (3) **The classification
gap.** `src/commands/graph-build.mjs:30-31` hardcodes `LOCAL_BACKENDS = {ollama}` and `NETWORK_BACKENDS =
{claude, gemini, openai, kimi, deepseek}` — **neither knows `claude-cli`**, so today it falls through to
`isNetworkBackend == true` by accident (`RESEARCH §M`, `SPIKE` open Q).

**Decision.**
- **Register `"graphify"`** as the third `memory.backend` enum value (`schemas/aof.schema.json`
  `$defs/memory` → `["local", "none", "graphify"]`) + one `BACKEND_REGISTRY` line in `src/work-memory.mjs`
  (lazy dynamic import, like `local`). Nothing else in the seam changes — `MEMORY_VERBS`, argv parsing,
  rendering are untouched (`RESEARCH §AA1`). An unknown backend name still fails the schema enum (the
  `05/ADR-002` guarantee).
- **The extraction backend defaults to `claude-cli`**, and it is **SURFACED and opt-in** — aof NEVER
  silently defaults to a network-egressing backend (`09/ADR-005` + the PRD privacy constraint). The
  `graphify` memory backend selection (config) is itself the opt-in act; the build's `--backend
  claude-cli` is surfaced in the `BuildResult` (`backend: "claude-cli"`, `egress: "docs-media"`) and in
  `status`/doctor (ADR-004). The model is tunable via graphify's own `GRAPHIFY_CLAUDE_CLI_MODEL`
  (`RESEARCH §J/N`; default Opus, `haiku`/`sonnet` cheaper) — a knob, not an aof contract.
- **Record the honest egress distinction (the most important nuance, `RESEARCH §M`).** `claude-cli` is
  **credential-local** (no metered key; billed to the plan; auth via the existing subscription) but
  **NOT data-local — the prose IS still sent to Anthropic for inference**. "Keep it within Claude" is true
  for AUTH and BILLING, false for DATA RESIDENCY. The ONLY fully on-box (data-resident) alternative is
  **`ollama`**, at a quality/structure cost (`RESEARCH §M/N`). aof states this plainly and does not
  pretend `claude-cli` is on-box.
- **Teach `src/commands/graph-build.mjs` the `claude-cli` value** so the classification is honest by
  KNOWLEDGE, not by accident: `claude-cli` joins the network-egressing set (`isNetworkBackend("claude-cli")
  === true` — it DOES cross the network; billed-to-plan is orthogonal to egress), and `classifyEgress
  ("claude-cli") === "docs-media"` (the doc/media hop RAN — exactly as for `claude`/`ollama`;
  `09/ADR-001/005` "report that the hop ran, never re-classify by reachability"). The reachability is
  local-subscription, but the EGRESS is real, and the egress field reports the egress (`RESEARCH §AA12`).

**Locked contract this ADR touches (the ONE schema line + the classification):**

```jsonc
// schemas/aof.schema.json  $defs/memory.backend.enum  (05/ADR-002 — grows by ONE reviewable line):
//   "enum": ["local", "none", "graphify"]
```
```js
// src/commands/graph-build.mjs — claude-cli becomes a KNOWN value (no longer network-by-accident):
//   NETWORK_BACKENDS now includes "claude-cli"   // crosses the network (billed-to-plan ≠ on-box)
//   classifyEgress("claude-cli") === "docs-media" // the hop RAN; reachability ≠ egress (09/ADR-001/005)
//   ollama remains the ONLY LOCAL (data-resident) backend; it is STILL egress:"docs-media" (hop ran).
```

**Alternatives considered.**
- *Default the extraction backend to `ollama` (fully on-box)* — REJECTED as the DEFAULT (kept as the
  documented data-resident alternative): `ollama` trades extraction quality/structure-adherence for
  locality (`RESEARCH §M/N`; the spike's claude-cli run produced a richer 11-node graph vs ollama's
  smaller models). `claude-cli` is the best DEFAULT for graph quality with the cleanest credential
  posture; `ollama` is the opt-out for users who require data residency. Both are surfaced; neither is
  silent.
- *Default to `claude` + `ANTHROPIC_BASE_URL`→local shim* — REJECTED as redundant (`RESEARCH §J/L`,
  `SPIKE F2-F4`): graphify's native `claude-cli` does in-process what a `/v1/messages` shim does over
  HTTP, with no anthropic SDK extra (`SPIKE F3`), no dummy key, no env wiring. The shim remains documented
  as the generic-gateway fallback, not adopted.
- *Leave `claude-cli` unmodelled (network-by-accident)* — REJECTED: `RESEARCH §M` — the value must be
  KNOWN so the classification is by enumeration, not by fall-through; an unmodelled value is a latent bug
  the moment the fall-through default changes.
- *No enum change — accept any backend string* — REJECTED by `05/ADR-002`: an unregistered backend must
  fail validation, not fail at dispatch with an opaque error; the enum keeps the registered set
  self-documenting (`RESEARCH §AA1`).

**Consequences.** Story 02 owns the schema enum line, the `BACKEND_REGISTRY` line, the `claude-cli`
classification in `graph-build.mjs`, and the `status`/doctor surfacing of the chosen extraction backend +
its honest egress label. The `acd-graph-privacy-boundary` (09 inv. 4) guard is unaffected — aof still
passes graphify a `--backend` + a path and reads no source contents to ship. A new fitness function
(`acd-graphify-backend-classified`) pins `classifyEgress("claude-cli") === "docs-media"` and
`isNetworkBackend("claude-cli") === true` and the enum's `graphify` registration. Live confirmation that
`--backend claude-cli` runs keyless against the pinned binary is `RESEARCH §AA9` `@manual` (CI asserts
only the aof side — the argv shape + the enum + the classification).

## ADR-004: Binary-absent recall degrades to the 05 local index (records WITHOUT graph re-ranking), never crashes; the graph signal is the only thing lost — recall/brief stay live, reindex/status report the miss honestly

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `memory.backend = graphify` with no graphify binary present must degrade cleanly, never
crash (`SPEC §Scope`: "a graceful no-op / fallback when graphify's binary is unavailable"). The
mechanisms already exist (`RESEARCH §G`): `resolveGraphifyBinary()` returns a structured `{found:false,
hint}` and NEVER throws (`09/ADR-004`), and the `graph:build` command surfaces it as a clear
`graphify-missing` (424) error BEFORE any spawn (`src/commands/graph-build.mjs:83-86`). Two degrade
targets are available (`RESEARCH §G`): (i) a none-shaped EMPTY `RecallResult`, or (ii) fall back to the 05
local index if one exists. The decisive observation is ADR-001: **the records come from the 05 parsers
regardless of the graph** — so when the graph is absent, the records are STILL recallable; only the
graph re-ranking term is missing. Returning empty would needlessly discard recall the backend can still
serve.

**Decision.** Binary-absent (or graph-not-built-yet) degrades to **un-graph-ranked recall over the 05
records** — the graph signal is the ONLY thing lost. Per verb:
- **`recall`** — produce the 05 records (via the reused parsers / the on-disk index, exactly as the local
  backend does), apply the 05 scope pre-filter + base length-normalised ranking (`05/ADR-006`), and
  return the frozen `RecallResult` WITHOUT the graph re-rank term. Every record still carries a resolving
  `source:line`. The result carries a `status`/diagnostic signal that the graph signal was unavailable
  (so the degrade is visible, not silent), but it is a valid, non-empty recall. It NEVER throws.
- **`brief`** — composed seam-side over `recall` (`05/ADR-003`); it inherits the same degrade for free
  (un-graph-ranked, still populated).
- **`reindex`** — rebuild the 05 records (the part that needs no binary) and ATTEMPT the graph build via
  `invoke("graph:build")`; when the binary is absent the command's structured `graphify-missing` miss is
  caught and surfaced as a clear "records rebuilt; graph skipped (graphify binary absent — <hint>)"
  outcome, NOT a crash. The records ARE rebuilt; only the graph is skipped.
- **`status`** — reports the backend (`graphify`), the record count, AND the graph state (built / not
  built / binary absent + the install hint), degrading like local's `status` which never throws on an
  absent store (`src/memory/local-indexing.mjs:245`). The `graphify-binary` doctor check (`09/ADR-004`)
  remains the project-health surface; `status` is the backend-introspection surface.

**Alternatives considered.**
- *None-shaped EMPTY `RecallResult` on binary-absent (`RESEARCH §G` option (i))* — REJECTED: it discards
  recall the backend can still serve. Because records come from the 05 parsers (ADR-001), the absence of
  the binary costs only the graph RE-RANK, not the records themselves; returning empty would make
  `memory.backend = graphify` strictly worse than `local` whenever graphify is uninstalled, for no reason.
  Falling back to un-graph-ranked recall is the natural graceful degrade and keeps the backend a strict
  superset of local.
- *Throw / hard-fail when the binary is absent* — REJECTED by `SPEC §Scope` (graceful) and the seam's
  no-error-path posture (`runMemory` renders whatever the backend returns, `src/work-memory.mjs:308-327`);
  a crash on a missing optional tool is exactly what `09/ADR-004` designed the structured miss to avoid.
- *Silently fall back with no signal* — REJECTED: the degrade must be VISIBLE (a `status`/diagnostic
  field), so an operator can tell graph-grounded recall silently became keyword recall — the honest-degrade
  discipline `09/ADR-004` established for the doctor check.

**Consequences.** Story 02 owns the binary-absent fallback wiring across the four verbs + the `status`
graph-state surface. The fallback REUSES the 05 retrieval (`rankRecords` over records — a pure function,
already shipped) so it is nearly free. A fitness function (`acd-graphify-binary-absent-degrades`) imports
the backend with `resolveGraphifyBinary` stubbed `{found:false}` (mirroring the 09 `acd-graph-binary-absent`
idiom) and asserts `recall`/`brief`/`reindex`/`status` all return their chosen shape WITHOUT throwing, and
that `recall` still returns the 05 records with resolving `source:line`.

## ADR-005: The derived-index invariant for the graphify backend — both the records AND the graph are fully rebuildable from `.md` source; the backend holds no fact absent from its `.md`

**Status:** Accepted
**Date:** 2026-06-22

**Context.** This is the load-bearing carry-forward (`STATE §Carry-forward`, `SPEC §Scope`): memory is a
**derived index** — rebuildable from the `.md` source, holding no fact absent from it — because a second
copy is the drift vector ACD exists to defend against (`05/ADR-001`). The graphify backend has TWO
derived artifacts now, and BOTH must obey the invariant: (1) the records (from the 05 parsers — already
guaranteed by `05/ADR-005`, the spine ADR-001 preserves), and (2) the graph itself (`graphify-out/
graph.json` — a derived artifact `reindex` reconstructs by `invoke("graph:build")`). The graph adds NO
authoritative fact: it only re-ranks records that themselves trace to `source:line`; even the LLM's
inferred edges are a relatedness signal over files, never a new recallable fact (a record the user could
not find at a `path:line`).

**Decision.** Both artifacts are derived and reconstructible:
- **Records** trace to `source:line` via the 05 parsers (ADR-001) — `05/ADR-005`'s derived-index
  invariant holds unchanged: a fresh `reindex` reproduces the identical record set, and every `source`
  resolves to live text.
- **The graph** is a derived artifact under `graphify-out/` (where `graph:build` writes it,
  `src/graphify.mjs:54`), reconstructed by `reindex`'s `invoke("graph:build")`. It is **git-ignored**
  (consistent with `09` writing it under `graphify-out/` and with `05/ADR-005`'s git-ignore discipline
  for the derived index) — committing it would make the graph an authoritative second copy, the exact
  `05/ADR-001` violation. The graph holds no fact the records do not; it is a pure ranking layer
  (ADR-001), disposable and rebuildable.
- **Nothing the backend recalls exists only in the graph.** Every recalled record is a 05 record with a
  resolving `source`. The graph cannot smuggle in an untraceable fact, because the graph is never a
  record source (ADR-001's invariant) — it only reorders records that already trace to source.

**Alternatives considered.**
- *Treat the graph as an authoritative store (commit it; recall facts from it)* — REJECTED: it is the
  authoritative-second-copy failure mode `05/ADR-001` names, and ADR-001 already forbids records-from-the-
  graph on the orthogonal provenance ground. The graph is derived, git-ignored, disposable.
- *Skip the derived-index fitness function for the graph (rely on 05's for records)* — REJECTED: 05's
  fitness covers the RECORDS, but the graphify backend adds the graph as a new derived layer; the
  invariant must explicitly assert the graph is git-ignored and rebuildable and that recall holds no
  graph-only fact — mirroring 05's `acd-memory-derived-index`, extended to the graph layer.

**Consequences.** Story 00 ensures `graphify-out/` is git-ignored as part of the backend (reusing the
`05`/`09` git-ignore discipline). The fitness function `acd-graphify-derived-index` mirrors 05's: build
the backend's records into a temp store, assert every record's `source:line` resolves, assert a second
`reindex` reproduces the identical record set, and assert no recalled record lacks a resolving `source`
(no graph-only fact). The graph-build half is `@manual` (needs the live binary, `RESEARCH §AA5`); the
records + git-ignore half is `@executable`.

**Invariant.** Both the records and the graph are rebuildable from `.md` source; the graph is git-ignored
and disposable; every recalled record traces to a resolving `source:line`, and the backend recalls no
fact present only in the graph. Enforced by `acd-graphify-derived-index` (ADR-006), mirroring 05's
`acd-memory-derived-index`.

## ADR-006: Graph scope is the work stream only; codebase-graph grounding stays milestone 11

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `STATE §Carry-forward` names the one open scope question: graph scope = work stream only, or
work stream + codebase. `SPEC §Scope` is explicit: "Codebase-graph grounding for the ACD agents …
is milestone 11 (both 10 and 11 consume 09 independently)" — codebase grounding is OUT OF SCOPE here.
The work stream (`wiki/work/**` — the RETROSPECTIVE R-entries + ARCHITECTURE ADRs the 05 parsers already
read) is the corpus the records come from (ADR-001), so grounding the recall in a graph over THAT corpus
is the coherent, self-contained unit: the graph and the records describe the same files.

**Decision.** The graphify backend builds and grounds against a graph over the **work stream only**
(`workDir` / `wiki/work/**`) — the same directory `buildRecords` scans (`src/memory/local-indexing.mjs:184`)
and the same source set `05/ADR-007` froze. `reindex`'s `invoke("graph:build", { path: <work stream> })`
targets the work stream; the re-ranker joins graph nodes to records by `source_file` within it (ADR-001).
**Codebase-graph grounding is deferred to milestone 11**, which consumes the same 09 commands
independently. This is the documented DEFAULT decision the PO surfaces for review.

**Alternatives considered.**
- *Work stream + codebase in this milestone* — REJECTED by `SPEC §Scope` (codebase grounding is 11) and
  on coherence grounds: the records come from the work stream (`05/ADR-007`); grounding them in a codebase
  graph would join records to nodes that have NO `source_file` overlap with the records' source files,
  making the file-level join (ADR-001's only available key) mostly empty — the codebase graph would not
  re-rank the work-stream records it has no files in common with. Work-stream-only keeps the join
  meaningful.
- *Leave scope unpinned (decide per-build)* — REJECTED: a documented default is required for the PO/SPEC;
  an unpinned scope would let story 01's re-ranker and story 00's build target diverge on what corpus the
  graph covers.

**Consequences.** Story 00's `reindex` targets the work stream; story 01's re-ranker joins within it.
Milestone 11 extends to the codebase against the same 09 commands without re-litigating this — the scope
is a build-target choice, not an architectural fork. No separate fitness function (the scope is a default
config decision, not a structural invariant); it is honoured by story 00 wiring `path: workDir`.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is correct now: the graphify backend module does not exist yet; the enum still
     reads ["local","none"]; graph-build.mjs does not know "claude-cli". The tests reference them and
     fail cleanly until stories 00/01/02 land. The 05 idioms (acd-memory-derived-index,
     acd-memory-backend-selection/interface, acd-memory-recall-contract) and the 09 idioms
     (acd-graph-binary-absent, acd-graph-no-face-spawn) are the house patterns these mirror. -->

| Invariant | Enforced by (arch-test `test/arch/acd-*.test.mjs`) | State now | From |
|---|---|---|---|
| **Records come from the 05 parsers, NOT graph nodes.** The graphify backend's `recall` returns records produced by `buildRecords`/`parseRetrospective`/`parseArchitecture` (each a frozen `MemoryRecord` with a resolving `source:line`), never records synthesised from `graph.json` nodes; the graph contributes only to `score`. | `test/arch/acd-graphify-records-from-parsers.test.mjs` (run the backend's `recall` over a committed `graph.json` fixture + the 05 parser records; assert every record matches `MEMORY_RECORD_FIELDS` and carries a `source` that resolves to live text; assert the re-ranker is a pure function of (records, normalizedGraph, …) that adds NO field to `MemoryRecord` — the `acd-memory-recall-contract` idiom, applied to the graphify backend) | RED until the graphify backend module + re-ranker exist | ADR-001 |
| **Derived-index invariant (records + graph).** A fresh `reindex` reproduces the identical 05 record set, every record's `source:line` resolves to live text, the graph (`graphify-out/`) is git-ignored + rebuildable, and `recall` holds no fact present only in the graph. | `test/arch/acd-graphify-derived-index.test.mjs` (build the backend's records into a temp store; for each record split `source` into `path:line`, read the file, assert the line resolves; assert a second `reindex` yields the identical record set; assert `graphify-out/` is git-ignored — the `acd-memory-derived-index` idiom, extended to assert the graph layer is derived/ignored, never a record source) | RED until `reindex` + git-ignore wiring exist (graph-build half `@manual`, RESEARCH §AA5) | ADR-001, ADR-005 |
| **Reach graphify ONLY via the 09 commands.** The graphify backend module imports `invoke` from `command-core.mjs` and reaches graphify exclusively through `invoke("graph:…")`; it imports NEITHER `src/graphify.mjs` NOR `node:child_process`, and spawns nothing — no bespoke second integration. | `test/arch/acd-graphify-backend-via-command.test.mjs` (source-grep the backend module: assert it imports `command-core.mjs`; assert it does NOT import `../graphify.mjs` or `node:child_process`; assert no `spawn`/`spawnSync`/`exec` call-form; assert its graphify access is `invoke("graph:…")` — complements the 09 `acd-graph-no-face-spawn` guard, which already proves the only `graphify` spawn in src/ is `src/graphify.mjs`) | RED until the graphify backend module exists | ADR-002 |
| **Backend selection enum + single read.** `graphify` is registered in the `$defs/memory.backend` enum AND `BACKEND_REGISTRY`; `config.memory?.backend` is still read in exactly one place (`selectBackendName`); an unregistered name fails the schema enum. | `test/arch/acd-graphify-backend-selection.test.mjs` (validate `{memory:{backend:"graphify"}}` against the schema → passes; validate `{backend:"mempalace"}` → fails the enum; assert `BACKEND_REGISTRY` carries a `graphify` loader; grep the seam → `config.memory?.backend` read only in `selectBackendName` — the `acd-memory-backend-selection`/`acd-memory-backend-interface` idioms, extended to `graphify`) | RED until the enum line + the registry line land | ADR-003 (05/ADR-002) |
| **Never-silently-default-to-network; `claude-cli` classified honestly.** `classifyEgress("claude-cli") === "docs-media"` (the doc/media hop ran) and `isNetworkBackend("claude-cli") === true` (it crosses the network; billed-to-plan ≠ on-box); `ollama` stays the only LOCAL backend (still `egress:"docs-media"`); the extraction backend is surfaced in the result/status, never a silent network default. | `test/arch/acd-graphify-backend-classified.test.mjs` (pure-function test over `src/commands/graph-build.mjs`: assert `classifyEgress("claude-cli") === "docs-media"`, `isNetworkBackend("claude-cli") === true`, `isNetworkBackend("ollama") === false`; assert the graphify backend surfaces the chosen extraction backend + its egress label in `status`/the result — RESEARCH §AA12 `@executable`; the data-residency claim itself is `@manual`/privacy review) | RED until `graph-build.mjs` learns `"claude-cli"` and the backend surfaces it | ADR-003 |
| **Binary-absent degrades, never crashes.** With graphify absent, `recall`/`brief` return un-graph-ranked recall over the 05 records (records still carry resolving `source:line`), `reindex` rebuilds records + skips the graph with a clear signal, and `status` reports the graph state — none throws. | `test/arch/acd-graphify-binary-absent-degrades.test.mjs` (import the backend with `resolveGraphifyBinary` stubbed `{found:false}`; assert `recall`/`brief`/`reindex`/`status` return without throwing; assert `recall` still returns the 05 records with resolving `source:line` and a diagnostic that the graph signal was unavailable — the 09 `acd-graph-binary-absent` idiom, applied to the backend) | RED until the binary-absent fallback wiring exists | ADR-004 |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors 05/09's split):
     - RECORDS-FROM-PARSERS, DERIVED-INDEX, VIA-COMMAND, SELECTION-ENUM, CLAUDE-CLI-CLASSIFIED,
       BINARY-ABSENT-DEGRADES are structural invariants over the backend module / the import graph /
       the schema / the egress classifier / graph.json → arch-tests (this table). They are the
       milestone's load-bearing deliverable (story 03 — no .feature pass of its own, mirroring 05/03 and
       09/03).
     - The OBSERVABLE end-to-end behaviours — "with memory.backend=graphify, recall over a real built
       graph re-ranks the 05 records by file relatedness", "reindex builds a real graph.json over the
       work stream via claude-cli with no key", "status reports the graph built/egress" — belong in task
       .feature files authored by stories 00/01/02 over the REAL graphify binary + a logged-in Claude
       Code, gated @manual where they need the live binary / subscription auth (RESEARCH §AA5/AA9/AA11).
     - The graph re-rank vs the 05 base ranking is a RANKING-ORDER assertion over a fixture graph.json +
       fixture records (no binary) — story 01's @executable contract test, not a fitness function. -->

## Proposed story partition

<!-- ADVISORY — the PO finalises (lifts into the SPEC `## Stories` + STORY.md files). The partition
     minimises cross-story coupling: stories couple ONLY through the frozen 05/09 contracts + this
     milestone's ADRs, exactly as 05 split seam/indexing/retrieval/fitness and 09 split
     command/provisioning/faces/fitness. -->

- **00 · graphify-backend-module** — *Goal:* the graphify memory backend satisfying the frozen 05
  interface `{name, recall, reindex, status}` (`05/ADR-003`): the `BACKEND_REGISTRY` + `$defs/memory`
  enum wiring (ADR-003), `reindex` rebuilding the 05 records (REUSING `buildRecords`) + (re)building the
  graph via `invoke("graph:build")` over the work stream (ADR-002, ADR-006), the seam-bridge that
  constructs the `{workspace}` ctx, and the git-ignored `graphify-out/` derived-index discipline
  (ADR-005). *Builds against:* `05/ADR-003` (interface), `09/ADR-001/002` (the `graph:build` command +
  `graphJsonPath`/`readGraph`/`normalizeGraph`), `command-core.invoke`. *Independent because:* it owns
  the module shape + the graph BUILD path; it consumes the re-ranker (story 01) only through ADR-001's
  pure-function contract (records + normalizedGraph → re-ranked records), which it can stub, and it
  freezes the `invoke("graph:build")` integration the other stories assume.

- **01 · graph-grounded-reranking** — *Goal:* the graph-grounded re-ranker `recall` reads — a pure
  function over the normalized `graph.json` (`normalizeGraph`'s `{nodes, edges, hyperedges}`) joined to
  the 05 records by `source_file`, layering community co-membership / `semantically_similar_to` edges /
  god-node centrality onto the 05 base ranking (`05/ADR-006`), returning the frozen `RecallResult`
  (`05/ADR-004`). *Builds against:* `09/ADR-003` (the normalized graph shape — the spike's real
  `graph.json` is the fixture), `05/ADR-004/005/006` (RecallResult, MemoryRecord, base ranking),
  ADR-001 (the re-rank-not-replace contract). *Independent because:* it is a PURE function of (records,
  normalizedGraph, query, scope) — fixture-testable with NO binary and NO module-00 wiring; it touches no
  spawn, no config, no command core. Couples to 00 only through ADR-001's function signature.

- **02 · extraction-posture-and-fallback** — *Goal:* the `claude-cli` extraction-backend default
  (surfaced + opt-in, ADR-003), the `src/commands/graph-build.mjs` `claude-cli` classification
  (`isNetworkBackend`/`classifyEgress`, ADR-003), the binary-absent fallback across `recall`/`brief`/
  `reindex`/`status` (degrade to un-graph-ranked 05 recall, ADR-004), and the `status`/doctor surfacing
  of the chosen extraction backend + its honest egress label. *Builds against:* `09/ADR-004`
  (`resolveGraphifyBinary` structured miss + the `graphify-binary` doctor check), `09/ADR-001/005` (the
  egress model), ADR-003/ADR-004. *Independent because:* the classification is a pure-function change to
  `graph-build.mjs`; the fallback REUSES the 05 `rankRecords` (already shipped) and the 09 structured
  miss; it consumes story 00's module surface and story 01's re-ranker only through their frozen
  signatures (it stubs the binary absent and asserts the degrade, never needing the live build).

- **03 · graphify-memory-fitness** — *Goal:* the six arch-tests of the fitness table above
  (`acd-graphify-records-from-parsers`, `-derived-index`, `-backend-via-command`, `-backend-selection`,
  `-backend-classified`, `-binary-absent-degrades`), mirroring 05/03 and 09/03 — a fitness-only story
  with **no `.feature` of its own**; its contract IS ADR-006's table. *Builds against:* the FROZEN module
  (story 00), re-ranker (story 01), and classification/fallback (story 02) surfaces; the 05/09 arch-test
  idioms. *Independent because:* it authors only `test/arch/*` tests against the frozen contracts; it
  writes no production code and the tests are RED-until-built by design (they reference the
  stories-00/01/02 surfaces and fail cleanly until those land), so it can be authored in parallel against
  the frozen ADRs.

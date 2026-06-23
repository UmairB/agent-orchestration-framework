---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 11 · Graphify Codebase Intelligence — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — a codebase-graph surface reached through the
> 09 commands, consumed by THREE agent decision points (architect structural review / refine
> story-boundary drawing / code-review PR-impact triage); the **wiring into the bundled
> `refine`/`continue`/`code-review` commands** is the load-bearing deliverable, not graph availability;
> the surface is **advisory and derived-from-source** — no auto-act/gate/merge/work-mutation) and
> `STATE.md` (`§Carry-forward to refine`: the win is the WIRING, not availability; hold the advisory-only
> line). ADRs cite these as `SPEC §…` / `STATE §…`.
>
> This milestone consumes TWO frozen contracts WHOLE and **re-litigates neither**. Milestone **09** (the
> graph command core): `graph:build`/`graph:query`/`graph:triage` register into the 08 core; `query`/
> `triage` carry graphify's human markdown in `stdout` carried **OPAQUE — parsing it is FORBIDDEN**, the
> only structured handle being `graphPath` → the WHOLE `graph.json` (`09/ADR-001`); `src/graphify.mjs` is
> the SOLE graphify spawn site, and `readGraph`/`normalizeGraph`/`graphJsonPath` are pure file reads, NOT
> spawns, and ARE permitted (`09/ADR-002`); the normalized `GraphNode`/`GraphEdge` shapes (`09/ADR-003`);
> assets-only provisioning + `resolveGraphifyBinary()`'s structured `{found:false,hint}` miss + the
> `graphify-binary` doctor check (`09/ADR-004`); faces/MCP-server never spawn graphify and never widen
> egress, reaching the graph ONLY via `invoke("graph:…")` (`09/ADR-005`); the six fitness functions +
> the house arch-test idiom (`09/ADR-006`). And the SIBLING consumer milestone **10** (graphify memory
> backend) is the closest template for ADR/fitness/partition structure — but its consumer differs
> load-bearingly from 11's (ADR-001 below). The real code read at `file:line`: `src/graphify.mjs`
> (`resolveGraphifyBinary`/`runGraphify*`/`graphifyBuildArgs`, the pure re-export of
> `readGraph`/`normalizeGraph`/`graphJsonPath` from `graph-normalize.mjs`),
> `src/commands/graph-build.mjs` (the `BuildResult { graphPath, projectRoot, nodeCount, edgeCount,
> hyperedgeCount, builtAt, backend, egress, stdout }`, the `no-graph`/`graphify-missing` guards,
> `classifyEgress`), `graph-query.mjs`/`graph-triage.mjs` (`{question|mode, stdout, graphPath}`, the
> build-first `no-graph` precondition), `src/graph-mcp-server.mjs` (the in-process MCP face fronting
> `invoke("graph:…")`), `src/work-memory.mjs` (`renderRecallBlock`/`HOOK_LIMIT`/`--block` — the 05/03
> injection precedent), and the wiring TARGETS read whole: `src/bundle/commands/refine.md` (step 1
> "Decide" carries the existing memory-recall hook; step 2 "Break down" is where boundary grounding
> goes), `src/bundle/agents/aof-architect.md` (the structural-review + story-boundary agent prompt,
> inherited by BOTH `continue` and `code-review`), `src/bundle/commands/continue.md` (step 3 "Review →
> aof-architect (structural)"), `src/bundle/commands/code-review.md` (step 3 "Review", where the PR diff
> is handed to aof-architect).
>
> **Prior-lesson recall.** `aof work memory recall "graphify codebase intelligence wire graph into agent
> loop structural review story boundaries PR triage advisory" --area architecture --block` returned an
> **EMPTY block** — no near-miss to honour or depart from (the PO's run at PO scope was likewise empty).
> Decisions below stand on the 09 frozen contract, the 05/03 + 10 precedents, and the SPEC alone.

## ADR-001: Grounding reaches the three consumers as agent-consumed command OUTPUT (`graph:query` answers, `graph:triage` queue), legible-to-an-agent and NEVER parsed by aof — NOT structured `graph.json` reads; because 11's consumers are LLM AGENTS, where 10's was a PROGRAM

**Status:** Accepted
**Date:** 2026-06-22

**Context.** This is the milestone's load-bearing crux and the one decision that distinguishes 11 from
its sibling 10. `SPEC §Objective/§Scope` names three consumers of the codebase graph — the **architect**
(structural review), **refine** (story-boundary drawing), and **code-review** (PR-impact triage). The
question is HOW the graph's signal reaches each. Two delivery models exist, and 09 froze the constraint
that forces the choice: `09/ADR-001` carries `graph:query`/`graph:triage` `stdout` **OPAQUE — parsing it
is FORBIDDEN** — the only structured handle is `graphPath` → the WHOLE `graph.json`, normalized via the
pure `readGraph`/`normalizeGraph` (`09/ADR-002/003`).

The decisive observation is the **consumer type**, and it inverts 10's reasoning. Milestone **10's**
consumer was a **program** — the re-ranker, a pure function that had to do arithmetic over node
`community` / edge `confidence` / centrality (`10/ADR-001`). A program cannot read prose; it REQUIRED the
structured `graph.json` and structurally COULD NOT use `graph:query`'s opaque markdown (`10/ADR-002`'s
"drive `graph:query` for recall" alternative was rejected on exactly this ground). Milestone **11's**
consumers are **LLM agents** (`aof-architect` reviewing structure; the refine/PO drawing boundaries; the
code-review reviewer ranking a PR). An agent CAN read and reason over natural language: `graph:query`'s
answer ("`auth.mjs` calls into `session.mjs` and `token.mjs`; `billing.mjs` is a god-node with 14
inbound edges") and `graph:triage`'s ranked-queue markdown are *exactly* the legible artifact an agent
consumes directly. That is precisely the shape graphify ships its skill + MCP face for (`09/ADR-005`),
and the shape the 09 commands were frozen to emit (`09/ADR-001`'s opaque-`stdout` answer IS the answer).

**Decision.** The codebase-graph grounding reaches all three consumers as **agent-consumed command
OUTPUT**, legible-to-an-agent and **NEVER parsed by aof**:
- the **architect** and **refine** consume `graph:query`'s markdown answer about coupling/structure (who
  calls/imports whom; god-nodes; community membership) — they read it as context and reason over it;
- **code-review** consumes `graph:triage`'s ranked-queue markdown (which changed nodes are highest-impact
  / most-coupled) when handing the PR diff to the reviewer.

This honours `09/ADR-001`'s no-parse invariant **for free**: aof never destructures the markdown into a
data shape; the markdown flows from the registered command's `stdout` into the agent's context as text,
and the *agent* (not aof code) interprets it. No seam in 11 reads `graph.json` for structure — there is
no program consumer here that needs `normalizeGraph`'s arithmetic. (Were a future seam to need structured
graph data — e.g. a deterministic CI gate ranking files by centrality — it would read `graph.json` via
the pure `readGraph`/`normalizeGraph`, exactly as 10 does; but NO 11 seam needs that, and ADR-004 forbids
any 11 seam feeding a gate regardless, so the legible-output path is the whole of 11.)

**The grounding-delivery contract (frozen):**

```text
CONSUMER                 GROUNDING SOURCE              SHAPE                       PARSED BY aof?
architect (struct rev)   graph:query <coupling Q>      opaque markdown answer       NO (agent reads it)
refine (story boundary)  graph:query <coupling Q>      opaque markdown answer       NO (agent reads it)
code-review (PR impact)  graph:triage [--pr N]         opaque ranked-queue markdown NO (agent reads it)

  The agent runs `aof graph query|triage` (or calls the aof MCP graph_query/graph_triage tool,
  09/ADR-005) and READS the result. aof code never destructures `stdout` into a data field. The only
  structured handle a command returns (graphPath) is NOT read by any 11 seam — 11 has no program consumer.
```

**Alternatives considered.**
- *Read `graph.json` structurally (10's path — `readGraph`/`normalizeGraph`)* — REJECTED for 11: it is
  the right tool for a PROGRAM consumer (10's re-ranker) and the WRONG tool for an AGENT consumer. An
  agent reasons over prose natively; forcing aof to normalize the graph and re-serialise it for the agent
  would (a) build a structured-consumption surface no 11 seam needs, (b) duplicate what graphify's
  query/triage already render in agent-legible form, and (c) invite a tempting future where aof parses
  that structure into a gate — the exact `09/ADR-001` no-parse line and this milestone's advisory-only
  line (ADR-004). The legible-output path is strictly simpler and inherits the no-parse invariant free.
- *Parse `graph:query`/`graph:triage` markdown into structured fields aof injects* — REJECTED outright by
  `09/ADR-001`: parsing the opaque stdout is FORBIDDEN; the markdown drifts by graphify version and has
  no stable `--json`. The markdown is consumed by the AGENT, never by aof.
- *Have aof synthesise its own coupling summary from `graph.json` and inject a compact block (the 05/03
  `renderRecallBlock` analogue)* — REJECTED: `renderRecallBlock` was needed in 05/03 because recall's
  consumer needed a BOUNDED projection of a structured `RecallResult[]`; here the graph command already
  emits an agent-legible answer, so a parallel aof-side renderer would re-derive (and risk drifting from)
  what `graph:query` already says, and would re-introduce a parse of `graph.json` that no 11 seam
  otherwise needs. The command output IS the block.

**Consequences.** Every 11 seam is prompt wiring that has an agent RUN a registered 09 command and READ
its output (ADR-002). No 11 module reads `graph.json`, parses markdown, or imports `normalizeGraph` — so
11 adds no new structured-consumption surface and inherits the 09 no-parse invariant by construction. The
re-litigation surface with 10 is nil: 10 owns the structured program path (memory re-rank over the work
stream); 11 owns the legible agent path (codebase grounding into review/refine). They share only the 09
commands.

**Invariant.** No 11 seam parses `graph:query`/`graph:triage` `stdout` into a data shape, and no 11 seam
reads `graph.json` for structure — the grounding is agent-consumed command output. Enforced by
`acd-codebase-grounding-no-parse` (ADR-006 inv. 1).

## ADR-002: Milestone 11 is PURE PROMPT-WIRING over the EXISTING 09 commands — the agents run `aof graph build/query/triage` themselves and reason over the legible output; aof adds NO new grounding helper/command/render. The minimal surface that keeps the invariants enforceable

**Status:** Accepted
**Date:** 2026-06-22

**Context.** The code-vs-prompt seam, decided explicitly and leaning minimal (`SPEC §Scope`: the wiring
is the deliverable; `STATE §Carry-forward`: the win is the hooks, not availability). Two shapes are
possible. **(A) Pure prompt-wiring** over the existing 09 commands: the bundled command prompts +
`aof-architect` agent prompt instruct the agent to run `aof graph build/query/triage` and consider the
legible output — mostly `@manual`, exactly like the 05/03 read hooks (which were prompt steps in
`refine.md`/`continue.md` whose only `@executable` code was the `--block` render). **(B) A thin aof
grounding helper/command** that composes build+query (or build+triage) into one call for the loop —
making advisory-only / no-op-when-absent / freshness `@executable` like 10 composed `graph:build` into
its `reindex`. The weighing: the milestone-08 ethos is "thin faces over registered commands"; 05/03 added
only the `--block` render and otherwise wired prompts; a new composed surface risks **gold-plating**
because the agents can already run `aof graph build` then `aof graph query` themselves (the commands
already self-guard — `no-graph` build-first precondition, `graphify-missing` binary-absent miss, all in
`graph-query.mjs`/`graph-build.mjs`); BUT a thin composed surface would make the invariants enforceable
in CI rather than only by prompt content.

The decisive observations against a new surface, here:
1. **The agent IS the composition.** ADR-001 makes the consumer an agent that reads command output. An
   agent running `aof graph build <repo>` then `aof graph query "<coupling Q>"` and reading the answer is
   the WHOLE mechanism. A helper that did `build; query` for it would save the agent one tool-call and
   buy nothing else — the agent must still read and reason over the answer (which the helper cannot do
   for it). This is the gold-plating the milestone-08 ethos warns against.
2. **The invariants 11 actually adds are over PROMPT CONTENT and the SPAWN/PARSE surface, not over a new
   module.** The advisory-only line (ADR-004) and the no-parse line (ADR-001) are enforced by asserting
   **no NEW aof code reaches the graph any way except the 09 commands / the MCP face**, and **no 11 seam
   wires `graph:*` output into a gate** — both of which are structural facts about the EXISTING surface
   (the 09 spawn-site guard already pins the spawn surface; 11 adds NO module to it), checkable by
   arch-test WITHOUT a new helper. A composed helper would be a NEW surface the no-spawn / no-parse guards
   must then also police — strictly more surface for no enforcement gain.
3. **The freshness discipline is a PROMPT step, not a code path (ADR-003).** "Build fresh at the decision
   point" is the agent running `aof graph build` first; the `builtAt`/`egress`/counts it reads back are
   already in the 09 `BuildResult` render. No helper is needed to surface freshness — the existing
   `graph:build` already surfaces it.

**Decision.** Milestone 11 is **pure prompt-wiring over the existing 09 commands. aof adds NO new
production module, command, helper, or render.** The seams are bundled-prompt edits only:
- `src/bundle/agents/aof-architect.md` gains a structural-grounding step: during structural review AND
  story-boundary drawing, run `aof graph build <repo root or src>` then `aof graph query "<coupling
  question>"` (or call the aof MCP `graph_query` tool, `09/ADR-005`) and cite the graph-derived coupling
  — inherited by BOTH `continue` step 3 and `code-review` step 3 (which both spawn `aof-architect`).
- `src/bundle/commands/refine.md` **step 2 "Break down"** gains the coupling-grounding step (mirroring the
  shape of step 1 "Decide"'s existing memory-recall hook): before drawing story boundaries, consult the
  graph for real coupling so boundaries follow real dependencies.
- `src/bundle/commands/code-review.md` **step 3 "Review"** gains the `graph:triage` PR-impact step: when
  spawning `aof-architect` on the PR diff, surface the triage queue as ranking context.
- `src/bundle/commands/continue.md` **step 3** inherits the architect grounding via the agent prompt — no
  edit beyond what the agent prompt carries (the seam is the agent, not the command).

The bundle ships these prompts to every project via `aof work init`, exactly as 05/03's hooks ship
(`05/03 STORY.md` — "portability is the point"). The grounding is a **silent no-op when graphify is
absent**: the agent runs `aof graph build`, the command returns the structured `graphify-missing` miss
(`09/ADR-004`, already wired), the agent notes "graph unavailable" and proceeds on grep-and-infer exactly
as today — no block, no crash, no prompt noise (mirroring 05/03's task-04 hooks-inert-when-off).

**Alternatives considered.**
- *(B) A thin `aof graph ground`/`graph:ground` composed command (build+query/triage for the loop)* —
  REJECTED as gold-plating for 11's agent consumer: the agent already composes the two existing commands
  and must read the answer itself regardless (ADR-001); the composition saves a tool-call and adds a NEW
  module the no-spawn/no-parse/advisory guards must police, for no enforcement gain (the invariants are
  over prompt content + the existing spawn/parse surface, not over a new module). RECORDED as the heavier
  alternative and the **graduation path**: if a future milestone needs the grounding *outside* an agent
  (a deterministic CI step that must build-then-query without an LLM in the loop), THAT is when a composed
  command earns its place — it would read `graph.json` structurally (10's path) and be `@executable`
  end-to-end. 11 has no such consumer.
- *(A′) Pure prompt-wiring with a small `--block`-style render of the graph answer (the 05/03 render
  analogue)* — REJECTED: 05/03 needed `renderRecallBlock` because its source was a structured
  `RecallResult[]` needing a bounded projection; here the source is already agent-legible markdown
  (ADR-001), so a render would re-derive what `graph:query` already emits. No render; the command output
  is the context.
- *Wire the grounding only into `continue`/`code-review` and skip the `aof-architect` agent prompt* —
  REJECTED: the architect grounding belongs in the AGENT prompt so it is inherited by both review entry
  points (continue + code-review) with one edit; duplicating it per-command would drift the two copies.
  Refine's boundary grounding is command-specific (refine has no aof-architect-review step at break-down),
  so it lives in `refine.md`.

**Consequences.** 11 ships zero production code — it is bundled-prompt edits + the fitness arch-tests
(ADR-006). The seams couple ONLY through the frozen 09 command contract and the bundled-prompt
convention. Story 00 owns the shared prompt convention + the no-op-when-absent discipline + the advisory
boundary + the freshness discipline (the contract the seam stories consume); stories 01/02 are the two
prompt-wiring seams; story 03 is the fitness table. Because there is no new module, the `@executable`
surface of 11 is exactly the arch-tests (prompt-content + spawn/parse-surface assertions); the
behavioural "agent cited graph-derived coupling in a real review / drew a boundary from coupling /
surfaced a triage queue for a real PR" is `@manual` (it needs the live binary + an agent), exactly the
05/03 read-hook split.

**Invariant.** Milestone 11 adds NO new production module that reaches the graph; the loop reaches the
graph ONLY through the registered 09 commands / the aof MCP face — 11 introduces no new graphify spawn
site and no new graph-reaching module. Enforced by `acd-codebase-grounding-via-commands` (ADR-006 inv. 2).

## ADR-003: Freshness is a build-fresh-at-the-decision-point prompt discipline over `graph:build` (which returns `builtAt`/`egress`/counts); the codebase graph is a git-ignored, derived artifact under `graphify-out/` — rebuilt, never silently served stale

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `SPEC §Scope`: the consumed graph is "built from current source via 09's commands; staleness
is visible, not silently served." The codebase graph is a DERIVED artifact (consistent with 09 writing it
under `graphify-out/` and 10/ADR-005's git-ignore + rebuildable discipline): it holds no authoritative
fact, it is reconstructed by `graph:build`, and it must reflect CURRENT source at the moment an agent
reasons over it. Two mechanisms exist (`SPEC §Scope` names both): (i) **build-fresh at the decision
point** — the agent runs `aof graph build <repo>` first, and `graph:build` returns `builtAt` (an ISO
timestamp), `egress`, and the node/edge/hyperedge counts in its `BuildResult` (read at
`src/commands/graph-build.mjs:126-136`), surfaced in the render; or (ii) **read-existing + surface age** —
reuse a prior `graphify-out/graph.json` and report how old it is. A real gap surfaced during this review:
`graphify-out/` is **NOT currently git-ignored** (`git check-ignore graphify-out` → miss; the session's
`git status` shows it `?? untracked`) — so without discipline the derived codebase graph could be
committed, becoming the authoritative-second-copy drift vector `10/ADR-005` (and `05/ADR-001` behind it)
exist to forbid.

**Decision.** Freshness is a **build-fresh-at-the-decision-point prompt discipline** over the existing
`graph:build`:
- the architect / refine / code-review grounding steps (ADR-002) **build the graph as the first step of
  the grounding** — `aof graph build <repo root or src>` — so the queried graph reflects current source
  at the moment the agent reasons over it. `graph:build` already returns `builtAt`/`egress`/counts; the
  agent reads them back from the command render, so freshness is **visible** (the agent sees when it was
  built and what egressed), not silently served.
- because building can be expensive, the discipline is "build-then-query at the decision point", and a
  seam MAY reuse an existing `graphify-out/graph.json` ONLY by **surfacing its age** (the `builtAt` /
  file mtime) so staleness is visible — never silently serving an old graph as if current. The default is
  build-fresh; reuse is the opt-in that must surface age.
- **`graphify-out/` is git-ignored** — the codebase graph is a derived, disposable, rebuildable artifact
  holding no authoritative fact (it only grounds agent judgment, ADR-004); committing it would make it an
  authoritative second copy (the `10/ADR-005` / `05/ADR-001` violation). Story 00 closes the
  currently-open git-ignore gap as part of the freshness/derivation discipline.

**Alternatives considered.**
- *Read-existing-only, never auto-build (rely on a separately-maintained graph)* — REJECTED: it makes
  staleness the DEFAULT (an agent would reason over whatever graph happens to be on disk, however old),
  contradicting `SPEC §Scope`'s "built from current source … not silently served". Build-fresh is the
  default; read-existing is permitted only with age surfaced.
- *Commit `graphify-out/graph.json` so the graph is always available without a build* — REJECTED: it is
  the authoritative-second-copy drift vector `10/ADR-005`/`05/ADR-001` forbid; a committed graph goes
  stale silently against the source it claims to describe. The graph is derived and git-ignored.
- *A freshness TTL / cache-invalidation mechanism in aof code* — REJECTED as gold-plating (ADR-002): it is
  a code surface for a property a prompt step ("build first") already secures, and it has no consumer (no
  11 seam reuses a cached graph deterministically). Freshness is build-fresh-at-the-point + age-on-reuse.

**Consequences.** No freshness code is added (consistent with ADR-002's no-new-module decision) — the
discipline is the build-first prompt step + the `git-ignore` of `graphify-out/`. Story 00 owns both. The
`builtAt`/`egress`/counts the agent reads are already in the 09 `BuildResult`; 11 surfaces them, it does
not compute them.

**Invariant.** The codebase graph is a git-ignored derived artifact under `graphify-out/`, rebuilt from
current source via `graph:build`; no 11 seam commits it or serves it stale without surfacing its age.
Enforced by `acd-codebase-graph-derived` (ADR-006 inv. 4).

## ADR-004: The grounding is ADVISORY-ONLY — read-and-inject into agent CONTEXT only; NO `graph:*` output feeds a gate, merge, status-write, or work-mutation. The agent decides; the graph informs

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `SPEC §Out of scope` is explicit and `STATE §Carry-forward` holds the line: "Auto-acting on
graph findings — advisory only; no automated gate, merge, or work mutation. The agent decides; the graph
informs." This is the boundary that keeps the codebase graph a GROUNDING surface and not a control
surface. The temptation is real and must be structurally forbidden: once `graph:triage` ranks a PR, a
naive next step is to auto-block the merge on a high-impact node; once `graph:query` reports tight
coupling, a naive step is to auto-fail the review or auto-rewrite a story boundary. Each of those would
turn an advisory signal into an automated act on a derived (and, per ADR-003, possibly stale) artifact —
exactly what the SPEC forbids.

**Decision.** The grounding is **read-and-inject into agent CONTEXT only**:
- the architect/refine/code-review steps RUN a `graph:*` command and READ its output as context for the
  agent's judgment (ADR-001/002). The agent then decides (writes the review verdict / draws the boundary /
  ranks the PR) using its OWN judgment, informed by — not dictated by — the graph.
- **NO `graph:*` output feeds a gate / merge / status-write / work-mutation.** Concretely, no 11 seam
  wires `graph:query`/`graph:triage`/`graph:build` output into: a CI gate or pass/fail check; a
  `code-review` merge decision (`work.codeReview.autoComplete`); a `STORY.md`/`SPEC.md`/`STATE.md` status
  write; or any `aof work` item mutation. The triage queue in `code-review.md` step 3 is **ranking
  context for the reviewer**, never an auto-block input; the merge gate stays exactly what
  `code-review.md` step 6 already is (CI-green + no blocking finding), with graph findings flowing through
  the same human/agent-judged finding path, never a separate automated graph-gate.

**Alternatives considered.**
- *Auto-block a merge / auto-fail a review on a high-impact triage rank or tight coupling* — REJECTED by
  `SPEC §Out of scope`: it makes a derived, possibly-stale (ADR-003) advisory signal an automated control,
  the exact failure mode the milestone forbids. Graph findings inform the agent; the agent's verdict
  (judged, not computed) is what gates.
- *Auto-rewrite a story boundary from `graph:query` coupling at refine* — REJECTED: refine's boundary is a
  PO/architect judgment the graph INFORMS (`SPEC §Objective`: "boundaries follow real coupling"); the
  graph does not author the partition. The agent draws it, citing the graph.
- *Write the graph finding into `STATE.md`/`STORY.md` automatically* — REJECTED: a status/work write is a
  work-mutation `SPEC §Out of scope` forbids; the agent may cite a graph finding in its prose verdict
  (human-authored narrative), but no seam auto-mutates a work record from graph output.

**Consequences.** The advisory boundary is the most important invariant 11 adds, and it is enforced
structurally: the prompt seams inject graph output into agent CONTEXT and the arch-test asserts no 11 seam
pipes `graph:*` output into a gate/merge/status-write/work-mutation (a prompt-content + wiring assertion,
checkable without the binary). This is the line that keeps 11 a grounding milestone, not a
graph-driven-automation milestone.

**Invariant.** No `graph:*` output (from any 11 seam) feeds a gate, merge, status-write, or work-mutation;
the grounding is read-and-inject into agent context only. Enforced by `acd-codebase-grounding-advisory`
(ADR-006 inv. 3).

## ADR-005: The loop reaches the codebase graph ONLY through the registered 09 commands / the aof MCP face / the pure `readGraph` reads — never a bespoke graphify spawn; 11 adds NO new spawn site (inherits 09/ADR-005 inv. 2). Scope = the CODEBASE (repo root / `src`), distinct from 10's work-stream scope

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `SPEC §Objective`: the grounding is "reached through the registered graph commands
(milestone 09), never a bespoke agent-side integration." `09/ADR-002` made `src/graphify.mjs` the SOLE
graphify spawn site, and `09/ADR-005` inv. 2 (`acd-graph-no-face-spawn`) already asserts the only
`graphify` spawn in `src/` is there — extending to the MCP server runtime. A second integration — an 11
seam that spawned graphify itself or imported `src/graphify.mjs`'s spawn helpers — would duplicate the
#756 cwd discipline / binary resolution / version pinning that 09 centralises, and give the no-spawn guard
a second surface to police. Two further facts: (1) ADR-002 makes 11 pure prompt-wiring with NO new module,
so 11 adds no spawn site by construction — but the invariant must be stated so a FUTURE 11-area change
that adds a module cannot quietly add one; (2) the CODEBASE scope is the load-bearing distinction from
10. Milestone **10** scoped the graph to the WORK STREAM (`wiki/work/**`, `10/ADR-006`) because its
records came from there. Milestone **11**'s scope is the **CODEBASE** — `graph:build { path: <repo root
or src> }` — because the consumers reason about source-code coupling (calls/imports), which lives in the
code, not the work docs. Both reach the same 09 commands; only the build `path` differs.

**Decision.**
- The loop reaches the codebase graph **ONLY through the registered 09 commands** (`aof graph
  build/query/triage`, via the CLI the agent invokes) **or the aof MCP face** (`graph_build`/`graph_query`/
  `graph_triage` tools fronting `invoke("graph:…")`, `09/ADR-005`) **or the pure `readGraph`/
  `normalizeGraph` reads** (permitted file reads, NOT spawns — though ADR-001 means no 11 seam needs
  them). **11 adds NO new graphify spawn site** and NO new graph-reaching module — it inherits `09/ADR-005`
  inv. 2 unchanged, and the `acd-graph-no-face-spawn` guard continues to assert the sole `graphify` spawn
  in `src/` is `src/graphify.mjs` (11 adds nothing to that denial set; the prompt seams spawn nothing —
  they instruct the AGENT to run the CLI command).
- **Scope = the codebase.** The grounding steps build over the **repo root (or `src`)** — `graph:build {
  path: <repo root or src> }` — distinct from 10's work-stream scope. This is a build-`path` choice
  (`SPEC §Scope`: "query / triage over the repo"), not an architectural fork; the same 09 commands serve
  both scopes. (Whether the precise build target is the repo root or `src/` is a tuning detail for the
  prompt step, surfaced for the PO/Three-Amigos; the architectural fact is "codebase, not work stream".)

**Alternatives considered.**
- *An 11 seam imports `src/graphify.mjs` / spawns graphify directly* — REJECTED: it is the "bespoke
  agent-side integration" `SPEC §Objective` forbids and the second spawn surface `09/ADR-005` exists to
  prevent. The loop goes through the registered command (which the agent runs) — inheriting the binary
  resolution / cwd / egress / binary-absent guards for free.
- *Scope the graph to the work stream like 10* — REJECTED: 11's consumers reason about SOURCE-CODE
  coupling (calls/imports between modules), which lives in the codebase; a work-stream graph would not
  answer "what does `auth.mjs` couple to". The codebase scope is the whole point (`SPEC §Objective`:
  "a real call / dependency graph replaces guesswork").

**Consequences.** Because 11 is pure prompt-wiring (ADR-002), this invariant is satisfied by construction
— there is no 11 module to spawn anything. The arch-test is therefore primarily a **regression guard**: it
re-asserts (via the existing `acd-graph-no-face-spawn` idiom, extended) that 11 added no new spawn site
and no new graph-reaching module, so a future change in the 11 area that tried to add one fails CI. The
codebase scope is honoured by the prompt step's `graph:build` target.

**Invariant.** 11 adds no new graphify spawn site and no new graph-reaching module; the loop reaches the
codebase graph only via the 09 registered commands / the aof MCP face / the pure `readGraph` reads, and
the build scope is the codebase. Enforced by `acd-codebase-grounding-via-commands` (ADR-006 inv. 2,
shared with ADR-002) + the existing `acd-graph-no-face-spawn` regression guard.

## ADR-006: The codebase-intelligence structural guarantees are FOUR fitness functions — no-parse, via-commands (no new spawn/module), advisory-only, derived/git-ignored — each a `test/arch/acd-*.test.mjs` arch-test; mirroring 09/03 & 10/03, with no `.feature` pass of its own

**Status:** Accepted
**Date:** 2026-06-22

**Context.** Mirrors `09/ADR-006` and `10/ADR-006`: the contracts (ADR-001 no-parse legible-output;
ADR-002 pure-prompt-wiring/no-new-module; ADR-003 freshness/derived; ADR-004 advisory-only; ADR-005
via-commands/codebase-scope) are durable only if ENFORCED. The guarantees are structural facts over the
bundled prompt content, the spawn/parse surface, the import graph, and the git-ignore set — so they are
fitness functions, NOT Gherkin scenarios. The observable counterparts ARE `@manual` (they need the live
graphify binary + an agent): the architect citing graph-derived coupling in a real review; refine drawing
a boundary from coupling; code-review surfacing a triage queue for a real PR. The house idiom is the
09/10 one: source-grep (call-form / prompt-content, comments discounted) + a bundled-prompt-content check.
**RED-vs-GREEN now:** the prompt seams do not exist yet, so the prompt-content assertions are RED until
stories 01/02 wire them; the no-new-spawn / no-new-module assertions are GREEN regression-guards (11 adds
nothing, and they assert it STAYS that way); the git-ignore assertion is RED until story 00 adds
`graphify-out/` to `.gitignore` (it is currently un-ignored — see ADR-003).

**Decision.** Four invariants, four arch-tests under `test/arch/`:

1. **No-parse / legible-output (ADR-001's invariant).** No 11 seam parses `graph:query`/`graph:triage`
   `stdout` into a data shape, and no 11 seam reads `graph.json` for structure — the grounding is
   agent-consumed command output. Proven by source-grep: the bundled prompt seams instruct the agent to
   RUN `aof graph query|triage` and READ the output (no aof-side `JSON.parse`/regex over the markdown), and
   no 11-introduced module imports `normalizeGraph`/`readGraph` or reads `graph.json` (11 adds no module —
   the assertion is that none appears).

2. **Reached only via the 09 commands; no new spawn site / no new graph-reaching module (ADR-002/ADR-005's
   invariant).** The loop reaches the codebase graph only through the registered 09 commands / the aof MCP
   face / the pure `readGraph` reads; 11 adds NO new graphify spawn site and NO new graph-reaching module.
   Proven by source-grep (extends the existing `acd-graph-no-face-spawn` idiom): the only `graphify` spawn
   in `src/` remains `src/graphify.mjs`, and 11 added no `src/` module that spawns graphify or reaches the
   graph by any path other than `invoke("graph:…")` / the CLI / the pure reads — a GREEN regression guard
   (11 is prompt-only).

3. **Advisory-only / no auto-act (ADR-004's invariant).** No `graph:*` output from any 11 seam feeds a
   gate / merge / status-write / work-mutation; the grounding is read-and-inject into agent context only.
   Proven by source-grep over the bundled seams: the architect/refine/code-review grounding steps inject
   graph output into agent CONTEXT (a "consider / cite" instruction), and no seam pipes `graph:*` output
   into a CI gate, the `code-review` merge decision, or a `STATE.md`/`STORY.md` status/work write — the
   triage queue is ranking context for the reviewer, never an auto-block input.

4. **Codebase graph is derived + git-ignored (ADR-003's invariant).** The codebase graph is a git-ignored,
   rebuildable artifact under `graphify-out/`, built fresh from current source; no 11 seam commits it or
   serves it stale without surfacing age. Proven by asserting `graphify-out/` is git-ignored (`git
   check-ignore`, the `10/ADR-005` `acd-graphify-derived-index` git-ignore idiom) and that the freshness
   prompt step builds-then-queries (a prompt-content check that the grounding builds before it queries).

These are structural (over prompt content / the spawn-parse surface / the import graph / the git-ignore
set) — fitness functions, here, not task scenarios. Their observable counterparts are `@manual` (story
01/02's behaviour over the real binary + an agent).

**Alternatives considered.**
- *Fold 11's guards into the 09 `acd-graph-no-face-spawn` test* — PARTIALLY adopted: inv. 2 EXTENDS that
  existing guard (it is the natural home for "no new spawn site"). But the no-parse, advisory-only, and
  derived/git-ignored guards are 11-specific facts over the BUNDLED PROMPT seams + the git-ignore set, so
  they earn their own named tests, indexing one reviewable contract per invariant (mirrors 09/10's split).
- *Make advisory-only a runtime assertion (throw if graph output reaches a gate)* — REJECTED (same as
  09/ADR-006): a runtime throw catches it late; an arch-test fails on the diff that wires the gate. The
  source-grep is the braces.
- *Skip a fitness test and rely on the `@manual` observable that "the agent only advised"* — REJECTED: the
  advisory-only boundary (`SPEC §Out of scope`) is the milestone's load-bearing invariant; it must fail in
  CI on the diff that turns a graph finding into an auto-act, not only in a manual review of agent
  behaviour.

**Consequences.** Story 03 authors the four arch-tests against the FROZEN seam convention (story 00) and
the wired seams (stories 01/02); it has no `.feature` pass of its own (its contract IS this table,
mirroring 09/03 and 10/03). The no-new-spawn / no-new-module guard is GREEN now and must STAY green; the
prompt-content + git-ignore guards are RED until 00/01/02 land, then GREEN and load-bearing. Any future
change that parses graph markdown, adds a bespoke graphify spawn, wires a graph finding into a gate, or
commits the codebase graph fails CI loudly.

## ADR-007: SUPERSEDES ADR-002's "pure prompt-wiring / zero production code" — milestone 11 adds a real consumer, `graph:impact`: a DETERMINISTIC, edge-based coupling command (exact dependents + dependencies from graph.json's edges) that the RUNNING agents invoke, replacing the fuzzy `graph:query` as the primary grounding signal

**Status:** Accepted (re-open 2026-06-23) — **supersedes ADR-002; amends ADR-001 and the ADR-006 fitness table**
**Date:** 2026-06-23

**Context.** The milestone was accepted on 2026-06-23 and then RE-OPENED the same day (see VERIFICATION
`## Accept decision — RETRACTED`): ADR-002 chose **pure prompt-wiring, zero production code** — so 11
added no consumer that DOES anything; it only added words to bundled prompts that ship to other repos.
Worse, when an agent followed those words, the grounding step it ran was `aof graph query "<NL question>"`
— a **similarity-seeded BFS** that seeds onto doc nodes and needs re-phrasing (the R3 lesson, re-confirmed
live: "what does command-core.mjs couple to" seeded on `commandError()` and returned 31 vaguely-related
nodes). So the RUNNING agents — the whole point ("augment aof work") — got fuzzy noise, not coupling fact.
Meanwhile the graph already holds **exact, deterministic import/call edges** (`doc.mjs → errors.mjs`,
`feedback.mjs → errors.mjs`, …) — the precise answer was sitting unread in `graph.json`.

ADR-002's reasoning ("the agent IS the composition; a helper buys nothing") was **wrong about value**: it
optimised for a minimal enforceable surface and delivered a milestone with no demonstrable benefit. The
re-assessment (VERIFICATION `## AC re-assessment`) found everything 11 actually delivered was trivial (a
gitignore line) or vacuous-on-value (arch-tests asserting prompt STRING PRESENCE). A milestone whose thesis
is "ground the agents in real coupling" must SHIP that coupling reliably, not a fuzzy hint behind a prompt.

**Decision.** Milestone 11 **adds a real production consumer of the graph**: the `graph:impact` command
(`src/commands/graph-impact.mjs`, registered into the 08 core), and **rewires the three agent seams to use
it as the primary grounding step**.
- `aof graph impact <paths…>` returns, for each file, its **dependents** (`imported/called by ←` — the
  blast-radius) and **dependencies** (`imports/calls →`), computed DETERMINISTICALLY from the normalized
  graph's edges (the pure `computeImpact`). No fuzz, no LLM, no spawn.
- It reads the **STRUCTURED** `graph.json` via the pure `readGraph`/`normalizeGraph` — the `09/ADR-001`
  PERMITTED handle, the SAME read 10's memory backend uses — **NOT** graphify's opaque markdown stdout
  (that no-parse line stands). So this **amends ADR-001**'s 11-specific clause "no 11 seam reads
  `graph.json`" (an ADR-002 artifact): reading the structured graph via the pure normalizer is exactly how
  a non-fuzzy consumer must work, and it is permitted.
- The seams (`aof-architect.md`, `refine.md` step 2, `code-review.md` step 3) now run `aof graph impact
  <the files under review / in the diff / at each candidate boundary>` as the **primary** signal; the fuzzy
  `graph:query`/`graph:triage` is demoted to an optional secondary "hint, not fact". This is what makes the
  RUNNING architect/refine/code-review agents get reliable coupling instead of noise.

**Consequences.**
- 11 is **no longer zero-production-code**. The no-spawn invariant (ADR-005) STILL holds — `graph:impact`
  reaches the graph via the pure file read, not a graphify spawn (`src/graphify.mjs` remains the sole spawn
  site). The advisory-only invariant (ADR-004) STILL holds — `impact` returns coupling FACTS the agent
  ranks/reasons over; no seam wires its output into a gate/merge/work-mutation.
- The ADR-006 fitness table is **amended**: `graph-impact.mjs` joins the graph-reader / graph-reaching
  allow-lists in `acd-codebase-grounding-no-parse` + `acd-codebase-grounding-via-commands`; the seam
  assertions now require `aof graph impact` (the primary) and frame `graph:query` as a fuzzy hint. A NEW,
  NON-VACUOUS value test (`test/graph-impact.test.mjs`) asserts `computeImpact` returns EXACT coupling — the
  thing the old arch-tests could not (they checked word-presence).
- aof must DOGFOOD this to benefit on itself (it does not render its own `.claude/` from the bundle today —
  a separate gap, VERIFICATION F11-6); downstream projects get it via `aof work update`.

**Alternatives considered.**
- *Keep ADR-002 (prompt-wiring only), just improve the query phrasing* — REJECTED: the query is
  fundamentally similarity-seeded; no phrasing makes it the deterministic "what couples to X" the agent
  needs. The exact answer requires reading the edges, which requires a real command.
- *Compute impact inside graphify (a new graphify verb)* — REJECTED: graphify already emitted the edges in
  `graph.json`; aof computes the projection deterministically over the data it already has, no new spawn,
  no egress, fully testable.

**Invariant.** `graph:impact` is deterministic and edge-derived: for a built graph it returns exactly the
dependents/dependencies implied by the edges (no fuzz). It reads the structured graph via the pure
normalizer (no spawn, no markdown parse) and feeds no gate. Enforced by `test/graph-impact.test.mjs`
(value) + the amended `acd-codebase-grounding-*` arch-tests (allow-list + advisory + seam-uses-impact).

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-vs-GREEN now: the bundled prompt seams do not exist yet (RED until 01/02 wire them);
     graphify-out/ is NOT yet git-ignored (RED until 00); the no-new-spawn/no-new-module guard is GREEN
     (11 adds nothing — a regression guard it STAYS so). The 09 idiom (acd-graph-no-face-spawn) and the
     10 idiom (acd-graphify-derived-index git-ignore) are the house patterns these mirror. -->

| Invariant | Enforced by (arch-test `test/arch/acd-*.test.mjs`) | State now | From |
|---|---|---|---|
| **No-parse / legible-output.** No 11 seam parses `graph:query`/`graph:triage` `stdout` into a data shape, and no 11 seam reads `graph.json` for structure — the grounding is agent-consumed command OUTPUT (an agent CAN read graphify's markdown answer; 10's PROGRAM consumer could not, hence its structured reads). Honours `09/ADR-001`'s no-parse invariant for free. | `test/arch/acd-codebase-grounding-no-parse.test.mjs` (source-grep the bundled seams `refine.md`/`code-review.md`/`aof-architect.md`: the grounding steps instruct the agent to RUN `aof graph query\|triage` and READ the output — no aof-side `JSON.parse`/regex over the markdown; assert no 11-introduced `src/` module imports `normalizeGraph`/`readGraph` or reads `graph.json` — 11 adds no such module) | RED until the seams are wired (01/02); the no-module half is GREEN (11 adds no module) | ADR-001 (inv. 1) |
| **Reached only via the 09 commands; no new spawn site / no new graph-reaching module.** The loop reaches the codebase graph only through the registered 09 commands / the aof MCP face / the pure `readGraph` reads; 11 adds NO new graphify spawn site and NO new graph-reaching module (inherits `09/ADR-005` inv. 2). Scope = the codebase (`graph:build { path: <repo root or src> }`), distinct from 10's work-stream scope. | `test/arch/acd-codebase-grounding-via-commands.test.mjs` (extend the `acd-graph-no-face-spawn` idiom: assert the only `graphify` spawn in `src/` remains `src/graphify.mjs`; assert 11 added no `src/` module reaching the graph by any path other than `invoke("graph:…")`/the CLI/the pure reads; assert the bundled seams invoke `aof graph build/query/triage`, never a bespoke graphify spawn) | GREEN now (11 is prompt-only — a regression guard it STAYS so); the seam-invokes-`aof graph` half is RED until 01/02 | ADR-002, ADR-005 (inv. 2) |
| **Advisory-only / no auto-act.** No `graph:*` output from any 11 seam feeds a gate / merge / status-write / work-mutation; the grounding is read-and-inject into agent CONTEXT only. The agent decides; the graph informs. | `test/arch/acd-codebase-grounding-advisory.test.mjs` (source-grep the bundled seams: the grounding steps inject graph output into agent context — a "consider/cite" instruction; assert no seam pipes `graph:*` output into a CI gate, the `code-review` merge decision/`work.codeReview.autoComplete`, or a `STATE.md`/`STORY.md` status/work write; the `code-review` triage queue is ranking context for the reviewer, never an auto-block input) | RED until the seams are wired (01/02) | ADR-004 (inv. 3) |
| **Codebase graph is derived + git-ignored.** The codebase graph is a git-ignored, rebuildable artifact under `graphify-out/`, built fresh from current source via `graph:build` (which returns `builtAt`/`egress`/counts); no 11 seam commits it or serves it stale without surfacing age. | `test/arch/acd-codebase-graph-derived.test.mjs` (assert `graphify-out/` is git-ignored — the `10/ADR-005` `acd-graphify-derived-index` git-ignore idiom, `git check-ignore`; assert the freshness prompt step builds-then-queries — a prompt-content check that the grounding builds before it queries, surfacing `builtAt`/`egress`) | RED until story 00 git-ignores `graphify-out/` (currently un-ignored) and the freshness step is wired | ADR-003 (inv. 4) |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors 09/10's split):
     - NO-PARSE, VIA-COMMANDS (no new spawn/module), ADVISORY-ONLY, DERIVED/GIT-IGNORED are structural
       invariants over the bundled prompt content / the spawn-parse surface / the import graph / the
       git-ignore set → arch-tests (this table). They are the milestone's load-bearing deliverable
       (story 03 — no .feature pass of its own, mirroring 09/03 and 10/03).
     - The OBSERVABLE end-to-end behaviours — "aof-architect cites graph-derived coupling in a real
       structural review", "refine draws a story boundary from real coupling", "code-review surfaces a
       graph:triage queue for a real PR", "the grounding is a silent no-op when graphify is absent" —
       belong in task .feature files authored by stories 01/02 over the REAL graphify binary + an agent,
       gated @manual where they need the live binary / an agent (the 05/03 read-hook split: prompt
       wiring + agent-observed @manual, with no @executable render of its own because the command output
       IS the context — ADR-001/ADR-002).
     - The no-op-when-absent behaviour reuses the EXISTING graphify-missing structured miss (09/ADR-004,
       already wired into graph-build/query): the agent runs the build, reads the miss, proceeds on
       grep-and-infer. It is @manual (agent-observed), mirroring 05/03's task-04 hooks-inert-when-off
       (whose @executable half existed only because there was a render to no-op; here there is none). -->

## Proposed story partition

<!-- ADVISORY — the PO finalises (lifts into the SPEC `## Stories` + STORY.md files, runs Three Amigos).
     The partition minimises cross-story coupling: stories couple ONLY through the frozen 09 command
     contract + the bundled-prompt convention + this milestone's ADRs, exactly as 09 split
     command/provisioning/faces/fitness and 10 split module/reranker/posture/fitness. Because 11 is pure
     prompt-wiring (ADR-002), the stories are bundled-prompt edits + the fitness arch-tests — NO
     production code. -->

- **00 · grounding-convention-and-discipline (spine)** — *Goal:* freeze the shared grounding mechanism the
  seam stories consume — the bundled-prompt convention for "build-fresh-then-query/triage, read the
  legible output, cite it" (ADR-001/ADR-002), the freshness/derivation discipline (build-first; surface
  age on reuse; **git-ignore `graphify-out/`** — closing the currently-open gap, ADR-003), the
  advisory-only boundary (read-and-inject into context, no auto-act, ADR-004), and the no-op-when-absent
  gate (the existing `graphify-missing` structured miss → agent proceeds on grep-and-infer, ADR-002).
  *Builds against:* `09/ADR-001` (opaque-stdout/no-parse), `09/ADR-004` (the binary-absent structured
  miss), `09/ADR-005` (reach via commands/MCP), `10/ADR-005` (the git-ignore/derived discipline); this
  milestone's ADR-001..005. *Independent because:* it owns the shared CONVENTION + the git-ignore + the
  boundary — the contract the seam stories paste into their respective prompts; it touches no consumer
  seam, so 01 and 02 consume it without renegotiating freshness/advisory/no-op. *@manual/@executable:* the
  git-ignore of `graphify-out/` is `@executable` (a CI-checkable structural fact); the convention itself is
  the shared prompt text the seams adopt (verified by the fitness arch-tests, story 03), and is otherwise
  `@manual`-observed (an agent following the convention).

- **01 · architect + refine coupling grounding** — *Goal:* wire the two COUPLING consumers — the
  `aof-architect` agent prompt (`src/bundle/agents/aof-architect.md`, inherited by BOTH `continue` step 3
  and `code-review` step 3) gains the structural-review + story-boundary coupling-grounding step (run
  `aof graph build <repo>` then `aof graph query "<coupling Q>"`, cite the graph-derived coupling); AND
  `refine.md` **step 2 "Break down"** gains the coupling-grounding step so story boundaries follow real
  coupling (mirroring step 1 "Decide"'s existing memory-recall hook shape). *Builds against:* story-00's
  convention (build-fresh/advisory/no-op/legible-output); `09/ADR-001` (read the opaque answer, never
  parse); ADR-001/ADR-002. *Independent because:* BOTH wired seams consume the SAME coupling signal
  (`graph:query`) and the SAME story-00 convention; neither touches the PR-impact path (02). The two edits
  (agent prompt + refine command) ship together because they are the same coupling consumer wired at two
  prompt sites, and they are independent of 02's triage path. *@manual/@executable:* the wiring is prompt
  text (no `@executable` render — the command output IS the context, ADR-002); the observable "architect
  cites graph-derived coupling in a real review / refine draws a boundary from coupling" is `@manual` (live
  binary + agent), mirroring 05/03's read-hook tasks.

- **02 · code-review PR-impact triage** — *Goal:* wire `code-review.md` **step 3 "Review"** to surface the
  `graph:triage` PR-impact ranking as context when spawning `aof-architect` on the PR diff (run `aof graph
  triage [--pr N]`, surface the ranked queue as ranking context — never an auto-block input, ADR-004).
  *Builds against:* story-00's convention; `09/ADR-001` (the triage queue is opaque markdown, read by the
  agent, never parsed); `09/ADR-005` (triage is CLI-only / via the command); ADR-001/ADR-004.
  *Independent because:* it touches ONLY `code-review.md` step 3 and consumes the `graph:triage` signal,
  which neither the architect nor refine coupling seam (01) uses; it shares only story-00's convention.
  *@manual/@executable:* prompt text (no `@executable` render); the observable "code-review surfaces a
  triage queue for a real PR" is `@manual` (live binary + a real PR + an agent).

- **03 · codebase-intelligence fitness** — *Goal:* the four arch-tests of the fitness table above
  (`acd-codebase-grounding-no-parse`, `acd-codebase-grounding-via-commands`,
  `acd-codebase-grounding-advisory`, `acd-codebase-graph-derived`), mirroring 09/03 & 10/03 — a
  fitness-only story with **no `.feature` of its own**; its contract IS ADR-006's table. *Builds against:*
  the FROZEN convention (story 00) + the wired seams (stories 01/02); the 09/10 arch-test idioms
  (`acd-graph-no-face-spawn` for the spawn-surface extension, `acd-graphify-derived-index` for the
  git-ignore idiom). *Independent because:* it authors only `test/arch/*` tests against the frozen
  contracts and writes no production code; the no-new-spawn/no-new-module guard is GREEN-now (regression),
  the prompt-content + git-ignore guards are RED-until-built by design (they reference the stories-00/01/02
  seams and fail cleanly until those land), so it can be authored in parallel against the frozen ADRs.
  *@manual/@executable:* the arch-tests are `@executable` (CI structural facts); the observable agent
  behaviours they backstop are `@manual` and live in stories 01/02 (not story 03).

# PRD — Graphify Integration

> Planning PRD for the graphify-into-aof arc. Upstream of ACD: this document is the seam
> `aof:shatter` consumes to lay out the milestone roadmap. Source tool under integration:
> [safishamsi/graphify](https://github.com/safishamsi/graphify).

## Objective

**Objective.** Make graphify — a Python tool that turns a codebase into a queryable knowledge
graph (`graph.json` / `graph.html` / `GRAPH_REPORT.md`, AST-extracted via tree-sitter, distributed
as a Claude/Cursor *skill + MCP server*, with `prs --triage` impact analysis) — a first-class
capability inside aof, exposed **the way milestone 08 mandates: as registered aof CLI commands**.
graphify's operations (build / query / triage, and the memory verbs) land in the command core with
stable `--json` contracts; the aof CLI is the single source of truth that drives the graphify Python
tool, and **every other consumer — Claude's rendered skill, graphify's MCP server, the board UI, the
ACD agents — is a thin face that invokes those commands**, never a side-channel that calls graphify
directly. On that contract the arc delivers two value axes. First, **distribution**: any aof project
adopts graphify through aof's existing asset/lock machinery, rendering a skill + MCP face that calls
the aof graph commands. Second, **consumption**: aof's *own* ACD loop gets smarter by reading the
graph through those same commands — recall behind `aof work memory` becomes graph-grounded, and the
architect/developer agents gain codebase grounding for structural review, story-boundary drawing,
and PR-impact triage. The arc is foundation-first: the command core is the enabler both consumers
build on, so it ships first and the two consumer seams fan out from it.

## Context & Constraints

- **CLI-as-contract is the spine (milestone 08).** Milestone 08 establishes that the aof CLI is the
  single source of truth for every operation — each is a registered command with a machine-readable
  `--json` contract, and the UI/artifacts are thin faces that may only invoke registered commands.
  Its own scope note pins the rule this arc must obey: *"new ops added later simply must arrive as
  commands first."* So graphify operations are authored **as command-core commands**, and the
  rendered Claude skill, MCP server, and board UI are faces over them. This makes 08 a precedent (and
  dependency) the foundation milestone inherits rather than re-litigates.
- **The npx assumption is load-bearing and graphify breaks it.** aof's package installer
  (`src/frameworks.mjs`) hardcodes `npx <pkg> <runtimeFlag> <scopeFlag>`; the only known framework is
  GSD (`get-shit-done-cc`). graphify is Python (pip / pipx / uv) and ships as a skill + MCP server.
  So "add graphify" is **not** a one-line config entry — the foundation milestone must either
  generalize the installer seam beyond npx, or deliberately ship graphify as skill + MCP **assets**
  and record how the Python binary is provisioned (with a `doctor` check that it is present). Either
  way the *operations* are exposed as aof commands; the install path is how the binary behind those
  commands gets onto the machine.
- **aof already has the seams the consumers plug into.** `aof work memory` (milestone 05) was built
  backend-agnostic *on purpose* — its SPEC explicitly reserves the slot: "richer semantic backends
  (e.g. MemPalace) plug in behind the same verbs later without touching a single agent prompt."
  graphify is a concrete candidate for that slot. The ACD architect/developer agents already own
  structural review and story-boundary work; a codebase graph is grounding they currently lack.
- **The derived-index invariant must hold.** Any graph aof consumes is a *derived* artifact,
  rebuildable from source (the work-stream `.md` files and/or the codebase) — never an authoritative
  second copy. This is the same single-source-of-truth constraint milestone 05 enforced.
- **Privacy boundary is graphify's, not ours to weaken.** graphify keeps code local (AST extraction
  is offline); only docs/media go to a configured LLM backend. aof's integration must surface and
  respect that boundary, never silently widen it.

## Scope

### In scope

- graphify's operations as **registered command-core commands** (the milestone-08 contract) — graph
  build / query / triage with stable `--json` shapes — with the aof CLI driving the graphify Python
  tool, plus the skill + MCP + board faces that invoke those commands, rendered through the existing
  asset/lock/drift machinery, and the Python-install story resolved as a deliberate, recorded decision
  (generalize the installer, or assets-only + provisioning check).
- graphify as a selectable backend behind `aof work memory`, conforming to the milestone-05 backend
  interface and preserving the derived-index invariant — recall answered through the graph commands.
- A codebase-graph intelligence surface the ACD architect/developer agents consume during structural
  review, refine (story boundaries), and code-review (PR-impact triage) — advisory, derived from
  source, and reached through the registered commands rather than a bespoke agent-side integration.

### Out of scope

- Vendoring or forking graphify's source — aof integrates the published tool, it does not own it.
- Replacing aof's zero-dependency local memory backend — it stays the default; graphify is an opt-in
  alternative behind the same verbs.
- Auto-acting on graph findings — the ACD-loop surface is advisory grounding for agents, not an
  automated gate that mutates work or merges PRs on its own.
- New aof runtimes beyond those already supported (`claude`, `codex`).
- Any change to graphify's own privacy model or LLM-backend configuration.

## Milestones

> Foundation-first: the first chunk is the enabler; the two consumer chunks each depend on it and are
> otherwise independent of each other (parallel-eligible once the foundation lands).

- **graphify-command-core** — the foundation. Expose graphify's operations as registered command-core
  commands (graph build / query / triage) with stable `--json` contracts, the aof CLI driving the
  graphify Python tool; render the skill + MCP + board faces that invoke those commands; resolve the
  Python-binary install story (generalize `frameworks.mjs` beyond npx, or assets-only with a `doctor`
  provisioning check). This is the contract the other two consume. **Depends on milestone 08
  (cli-command-core)** — it authors graphify ops into the command core 08 establishes.
- **graphify-memory-backend** — feed aof's memory. A graphify backend behind `aof work memory`
  (recall / brief / ingest / reindex / status) that answers via the graph commands over
  `wiki/work/**` (and optionally the codebase), conforming to the milestone-05 backend interface and
  the derived-index invariant. **Depends on the graphify-command-core foundation and on milestone 05
  (work-memory).**
- **graphify-codebase-intelligence** — feed the ACD loop. Wire a codebase knowledge graph into the
  agents' workflow through the registered commands: the architect reads it during structural review,
  refine reads it when drawing independent story boundaries, and code-review surfaces graphify's
  PR-impact triage. Advisory and derived-from-source. **Depends on the graphify-command-core
  foundation** (independent of the memory backend — both consume the foundation).

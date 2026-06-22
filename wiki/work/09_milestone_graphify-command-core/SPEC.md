---
type: milestone
number: 09
slug: graphify-command-core
title: "Graphify Command Core — graphify arrives as aof commands"
status: in-progress
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
depends: [08]
origin: wiki/planning/PRD-graphify-integration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 09 · Graphify Command Core — graphify arrives as aof commands

## Objective

Establish [graphify](https://github.com/safishamsi/graphify) — a Python tool that turns a codebase
into a queryable knowledge graph (`graph.json` / `graph.html` / `GRAPH_REPORT.md`, AST-extracted via
tree-sitter, with `prs --triage` impact analysis) — as a first-class aof capability by authoring its
operations **as registered command-core commands**. This is the milestone-08 contract applied to a
net-new operation surface: graphify's operations (graph build / query / triage — exact verbs pinned
at refine) become registered commands with stable, machine-readable (`--json`) contracts; the aof CLI
is the single source of truth that drives the graphify Python tool; and **the rendered Claude skill,
graphify's MCP server, and the board UI are thin faces that may only invoke those commands** — never
side-channels that call graphify directly. This is the "new ops arrive as commands first" rule
milestone 08 names, made real on its first new surface.

Because graphify is Python (pip / pipx / uv) while aof's installer is npx-only
(`src/frameworks.mjs` hardcodes `npx <pkg>`), this milestone also resolves **how the binary behind
the commands is provisioned** — either by generalizing the installer seam beyond npx, or by shipping
graphify as skill + MCP assets with a `aof project doctor` provisioning check — recorded as an ADR so
the follow-on milestones inherit a deliberate decision.

An outsider can verify the objective is met when: `aof graph <verb> --json` builds a graph over a real
folder and answers a query against it; the board/skill/MCP faces invoke the registered commands rather
than calling graphify directly; and a fitness/doctor check fails if graphify's binary is absent or a
face bypasses the command core. The contract — graphify-as-commands — is the deliverable both
consumer milestones (10, 11) build on.

## Scope

In scope:
- **The graphify command surface in the command core** — build / query / triage (verbs pinned at
  refine), each a registered command with an input/result shape and a `--json` contract; the CLI a
  thin `argv → command → result` face, per the milestone-08 command-core pattern.
- **The aof↔graphify driver** — the adapter a command uses to run the graphify Python tool and
  normalize its `graph.json` / report output into the command's result shape (so faces consume aof's
  contract, not graphify's raw output).
- **The Python-binary install decision** — generalize `src/frameworks.mjs` beyond npx (a Python /
  pipx / uv installer path) **or** assets-only provisioning with an `aof project doctor` check;
  captured as the milestone ADR.
- **The rendered faces** — a graphify skill + MCP server asset that invoke the aof graph commands
  (not graphify directly), rendered through the existing asset / lock / drift machinery into the
  configured runtimes (`claude`, `codex`).

Out of scope:
- **Consuming the graph inside aof's own loop** — the `aof work memory` backend (milestone 10) and
  the ACD-agent grounding (milestone 11) are separate milestones that build on this command contract.
- **Vendoring or forking graphify's source** — aof drives the published tool; it does not own it.
- **Changing graphify's privacy model or LLM-backend config** — surfaced and respected, never modified
  (AST extraction stays local; only docs/media reach graphify's configured backend).
- **New aof runtimes** beyond `claude` / `codex`.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 09.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-21` (`aof:refine 09 --autonomous`) into **five** stories — **00 is the spine; 01 / 02
/ 03 / 04 fan out from its frozen contract in parallel** (the critical path is 00 only). See
[ARCHITECTURE.md](ARCHITECTURE.md) (6 ADRs, ADR-001/005/006 amended at the Three-Amigos pass) and
[RESEARCH.md](RESEARCH.md) for what each consumes. The load-bearing carry-forward decisions are resolved:
the graph command verbs + result shape (ADR-001, derived from `graph.json` since graphify has no stable
`--json`) and the Python-binary install path (**ADR-004 — Option B: assets-only + an `aof project doctor`
check; the npx installer untouched**). A Three-Amigos finding split the MCP face: the rendered config entry
stays in 02, the net-new aof MCP **server runtime** became **story 04** (PO decision; see STATE). Contracts
authored `2026-06-21` (Three Amigos: PO scenarios + QA examples/tagging + developer feasibility) for
00/01/02/04; 03's contract is ADR-006 itself (six arch-tests, no `.feature` pass).

- [ ] **00 · [graph-command-core](stories/00_story_graph-command-core/STORY.md)** — the three `graph:*`
  commands + the sole graphify driver (`src/graphify.mjs`); freezes the command/result contract (ADR-001)
  and the driver seam (ADR-002/003). The spine. 4 tasks. _in-review_
- [ ] **01 · [binary-provisioning](stories/01_story_binary-provisioning/STORY.md)** — the install decision
  made real: `resolveGraphifyBinary` + the `graphify-binary` `aof project doctor` check (ADR-004); the npx
  installer untouched. Consumes 00. 2 tasks. _in-review_
- [ ] **02 · [rendered-faces](stories/02_story_rendered-faces/STORY.md)** — the graphify skill + the MCP
  **config entry** through the existing asset/lock/drift machinery, invoking `aof graph <verb>` (ADR-005).
  Consumes 00's frozen verb surface. 2 tasks. _in-review_
- [ ] **03 · [graph-fitness](stories/03_story_graph-fitness/STORY.md)** — the six enforcing arch-tests
  (ADR-006 — the load-bearing deliverable). Asserts against 00; five RED-until-built, no-npx GREEN now.
  6 arch-tests. _in-review_
- [ ] **04 · [mcp-server-runtime](stories/04_story_mcp-server-runtime/STORY.md)** — the net-new aof MCP
  server (`aof graph serve`) whose tools answer via `invoke("graph:…")` behind the registry; the runtime the
  02 config entry targets (ADR-005 amended). Consumes 00. 2 tasks. _in-review_

## Dependencies

- **08 · cli-command-core** — graphify's operations are authored *into* the command core that 08
  establishes; this is the first net-new operation surface to arrive "as commands first" under 08's
  contract, so it inherits 08's registry / result shape and its no-UI-bypass fitness guarantee rather
  than re-litigating them.

---
type: story
number: 02
slug: rendered-faces
title: "Rendered faces — the graphify skill + MCP config entry, through the existing asset/lock/drift machinery, invoking aof graph"
parent: 09
status: in-review
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
---
# 02 · Rendered faces — the graphify skill + MCP face over the aof graph commands

## User story

As an agent runtime (`claude` / `codex`) that should be able to reach the graph,
I want a graphify skill and MCP face rendered through aof's existing asset/lock/drift machinery, each instructing the agent to call `aof graph build/query/triage` — never graphify's slash-form skill and never graphify's own `python -m graphify.serve` MCP directly,
so that every consumer reaches the graph through aof's registered command core (the single source of truth), the 9-tool/triage asymmetry of graphify's own MCP cannot leak, and the faces are drift-tracked like any other rendered asset.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 09/02`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [skill-face-renders](tasks/00_skill-face-renders.feature)** — the graphify **skill** resource renders into `claude`/`codex` through `renderConfigOutputs`, instructs `aof graph <verb>` (not `/graphify`, not the binary), and is hash/lock/drift-tracked like any asset. _@executable green._
- [x] **01 · [mcp-face-renders](tasks/01_mcp-face-renders.feature)** — the graphify **MCP config entry** renders into `.mcp.json` (claude) / `config.toml` (codex), points `command`/`args` at the aof-fronted server (not `python -m graphify.serve`), and is drift-tracked. _@executable green. (The server runtime the entry launches is **story 04** — this task is the rendered entry only.)_

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-005** the rendered-faces decision;
**ADR-001** the frozen `aof graph` verb surface the faces invoke). This story **owns**: the graphify skill
+ MCP face authored as aof's OWN `.aof/` config resources, rendered by the existing `renderConfigOutputs`
(`renderedResource` for the skill, `renderRuntimeConfigOutputs` → `claudeMcpJson`/`codexConfigToml` for the
MCP) in [adapters.mjs](../../../../../src/adapters.mjs) — no new render path. It does **not** author the
`graph:*` commands or the driver (story 00), the doctor check (story 01), or the arch-tests (story 03), and
it carries **no graphify spawn of its own** (the driver is the sole spawn site, ADR-002).

**Independent because** it consumes only story 00's frozen `aof graph` verb surface and the existing
asset/lock/drift machinery — and produces rendered assets no sibling consumes. The faces are ordinary config
resources, so the existing asset tests and the `generated-output-drift` doctor check cover them; rendering
both faces into both runtimes is fully `@executable`. **Scope note (resolved 2026-06-21):** this story is the
rendered skill + the rendered MCP **config entry** only; the **net-new aof MCP server runtime** the entry
launches is **story 04** (mcp-server-runtime) — the live agent-reaches-the-graph end-to-end moved there.

**Feasibility (developer amigo seat — confirmed at Contract):** **Buildable as written, after the split.**
The skill (task 00) is an ordinary `.aof/` skill resource — `renderConfigOutputs` → `renderedResource`
([adapters.mjs:184](../../../../../src/adapters.mjs)) already renders skills into `.claude`/`.codex` with
hash/lock/drift tracking; a body instructing `aof graph build/query/triage` (not `/graphify`) needs **no new
render path**. The MCP config entry (task 01) is equally bounded: `renderRuntimeConfigOutputs`
([adapters.mjs:85](../../../../../src/adapters.mjs)) + `claudeMcpJson` → `.mcp.json` and `codexConfigToml` →
`config.toml`, drift-tracked — the three `@executable` scenarios assert only the *rendered config* (the
entry exists, points at the aof-fronted server not `python -m graphify.serve`, drifts on edit), never a
running server.

**Why the split (the load-bearing finding, now resolved):** a repo-wide grep confirmed aof ships **no MCP
server runtime** — no `@modelcontextprotocol/*` dependency, no `setRequestHandler`/`StdioServerTransport`/
`new Server(` in `src/`, no `aof mcp serve`/`aof graph serve` command. The 08 core is in-process only (CLI +
board-UI faces, never an MCP transport). So the config entry can point `command`/`args` at a server that
does not yet exist — building that server (MCP SDK dep + a stdio `Server` whose handlers call
`invoke("graph:…")` + a launch command) is **materially larger than "author an asset"**, so it was lifted
into **story 04** (PO decision, `aof:refine 09 --autonomous`). Story 02 stays the thin rendered-faces story
the SPEC intends.

---
type: story
number: 04
slug: mcp-server-runtime
title: "The aof MCP server runtime — aof graph serve, a stdio MCP face that answers tool calls via invoke(graph:…)"
parent: 09
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
# 04 · The aof MCP server runtime — the server the rendered MCP entry launches

## User story

As an agent runtime that reaches the graph through the MCP face story 02 renders,
I want aof to actually ship the MCP server that the rendered `mcpServers` entry points at — an `aof graph serve` stdio server whose graph tools answer each call by `invoke("graph:…")` behind the in-process registry,
so that the MCP face is a working face over the command core (not a config entry pointing at a binary that does not exist), and the agent reaches the graph through aof's single source of truth — never graphify directly.

<!-- Split out of story 02 at refine (PO decision, aof:refine 09 --autonomous): the rendered MCP CONFIG
     ENTRY is story 02 (free on the existing machinery); the SERVER RUNTIME the entry launches is net-new
     work (a new MCP-SDK dependency + a stdio transport) and earns its own story. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 09/04`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [serve-entrypoint](tasks/00_serve-entrypoint.feature)** — `aof graph serve` launches a stdio MCP server that advertises the graph tools; it is exactly the command/args the story-02 rendered MCP entry targets. _@executable green (incl. a serveStdio over-pipe test)._
- [x] **01 · [tools-front-the-registry](tasks/01_tools-front-the-registry.feature)** — each MCP tool call is answered by `invoke("graph:…")` behind the in-process registry; the server reaches the graph through the command core and **never spawns graphify itself** (ADR-006 inv. 2). _@executable green; live agent end-to-end @manual (verify)._

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-005** the rendered-faces decision —
amended to record this runtime; **ADR-001** the frozen `graph:*` verbs the tools wrap; **ADR-006 inv. 2**
the no-face-spawn guard the server must honour). This story **owns**: the net-new aof MCP server — an
MCP-SDK dependency, a stdio `Server` whose tool handlers call `invoke("graph:…")`, and the `aof graph serve`
launch command in [cli.mjs](../../../../../src/cli.mjs) that the story-02 rendered entry's `command`/`args`
target. The server reaches the graph **only** through the in-process registry (`invoke`) — it carries **no
graphify spawn of its own** (the driver `src/graphify.mjs` is the sole spawn site, ADR-002/ADR-006 inv. 2).

**Independent because** it consumes only story 00's frozen registry surface (`invoke("graph:…")`) — the same
contract the CLI and board faces consume — and the agreed `aof graph serve` command name that story 02's
config entry targets. It produces a transport face no sibling's internals depend on; 02 (the config entry)
and 04 (the server) can be built in parallel once both honour that shared command name. Building the server
is `@executable` at the in-process seam (a tool call routes to `invoke`, list-tools advertises the graph
tools, the server never spawns graphify); the live agent-over-stdio round-trip is `@manual`.

**Feasibility (developer amigo seat — confirmed at Contract):** **Net-new but bounded — this is the work the
load-bearing finding sized.** aof ships no MCP runtime today (repo-wide grep: no `@modelcontextprotocol/*`
dep, no `setRequestHandler`/`StdioServerTransport`/`new Server(` in `src/`, no `aof … serve` command), so
this story adds: (1) the MCP SDK dependency; (2) a stdio `Server` registering graph tools whose handlers map
`tools/call` → `invoke("graph:…", input, { workspace })` and project the result to an MCP tool response; (3)
the `aof graph serve` dispatch branch (sibling to the other `aof graph` verbs). The in-process seam (handler
→ `invoke`) is unit-testable without a live agent — the `@executable` core; only the stdio round-trip with a
real runtime is `@manual`. The server inherits ADR-006 inv. 2 (no-face-spawn) by construction: it reaches
the graph through `invoke`, exactly as the CLI face does, and never touches the graphify binary.

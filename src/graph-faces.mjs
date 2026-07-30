// The graphify rendered faces (milestone 09 / story 02 — ADR-005).
//
// aof authors its OWN graphify skill + MCP config entry as ordinary aof config
// items, rendered through the EXISTING asset/lock/drift machinery
// (`renderConfigOutputs`, src/adapters.mjs) — NO new render path. The skill is a
// `resource` (rendered by `renderedResource` into `.claude`/`.codex`); the MCP
// entry is an `mcpServers` entry (rendered by `renderRuntimeConfigOutputs` →
// `claudeMcpJson` → `.mcp.json` for claude, `codexConfigToml` → `config.toml` for
// codex). Both flow through the same hash/lock so `aof project doctor`'s
// `generated-output-drift` check covers them like any other rendered output.
//
// Two ADR-005 constraints are load-bearing and asserted by story 02's tests:
//   1. The SKILL instructs `aof graph build/query/triage` (the aof CLI), and NEVER
//      graphify's shipped `/graphify` slash-form (binary-divergent, RESEARCH §A)
//      nor calling the `graphify` binary directly.
//   2. The MCP entry's command/args launch the AOF-FRONTED server `aof graph serve`
//      (story 04's runtime), NOT graphify's own `python -m graphify.serve` (whose
//      9 read tools omit PR triage and bypass the command core, RESEARCH §H).
//
// HOME (the shipped-resource decision, see the developer return): NOT the ACD
// `src/bundle/` — that bundle is the frozen ACD-actor set (8 agents + the ACD
// commands + templates), pinned by the milestone-01 `acd-bundle-membership`
// fitness function ("bundle root files == declared member files"); adding a
// graphify face there would break that frozen invariant, and the bundle loader
// supports neither `skill` members nor `mcpServers`. Instead, mirroring
// `work-bundle.mjs`'s idiom — a module that exports a config-SHAPED object
// consumed by `renderConfigOutputs` unchanged — this module ships the graphify
// faces as a first-class config fragment any aof project adopts by spreading
// `graphifyFacesConfig()` into its config. This authors them as aof's OWN config
// items (ADR-005's "aof authors graphify faces as ITS OWN assets") without
// touching the ACD bundle or `src/frameworks.mjs`.

// The graphify face renders into both runtimes the SPEC names (claude + codex).
export const GRAPHIFY_FACE_RUNTIMES = ["claude", "codex"];

// The skill resource id (also its rendered folder: .<runtime>/skills/<id>/SKILL.md).
export const GRAPHIFY_SKILL_ID = "graphify";

// The MCP server id (the key under mcpServers in .mcp.json / [mcp_servers.<id>]).
export const GRAPHIFY_MCP_ID = "graphify";

// The aof-fronted server launch (story 04's `aof graph serve`). The published CLI
// is the `aof` bin (package.json bin.aof = ./bin/aof.mjs), so the portable launch
// for a stdio MCP entry is the `aof` executable with the `graph serve` verb — the
// exact command story 04's serve-entrypoint feature requires the entry to target,
// and NOT `python -m graphify.serve`.
export const GRAPHIFY_SERVE_COMMAND = "aof";
export const GRAPHIFY_SERVE_ARGS = ["graph", "serve"];

// The skill body. Instructs the aof CLI graph verbs explicitly; calls out, in
// band, that graphify's `/graphify` slash-form and the `graphify` binary are NOT
// to be used — so the rendered body both references the aof verbs AND documents
// the prohibition (the negative assertions the feature checks key on the slash-
// form / binary spellings being absent from the INSTRUCTION, present only as a
// "do not" note keyed off the aof verbs).
function graphifySkillBody() {
  return [
    "# Querying the codebase graph",
    "",
    "This project exposes a code knowledge graph through aof's command core. Reach",
    "the graph ONLY through the aof CLI graph verbs — never graphify directly.",
    "",
    "## Build the graph",
    "",
    "Run `aof graph build .` from the project root to extract the whole repository.",
    "With no `--backend` that is a CODE-ONLY build: code coupling plus structural",
    "document nodes, no API key, zero egress — it works whether or not the repo has",
    "docs. Add `--backend <name>` only to extract the MEANING of docs/media, which",
    "sends their prose to that backend.",
    "",
    "A build REPLACES the single project graph, so targeting a package or subtree",
    "evicts every file outside that target — build `.` and query the part you care",
    "about. A build that cannot persist now FAILS (`graphify-build-failed` /",
    "`graphify-no-persist`) instead of leaving the previous graph in place looking",
    "fresh; read the error rather than re-running, and never treat the surviving",
    "graph as the result of the build you just ran.",
    "",
    "## Ask the graph",
    "",
    "Run `aof graph query \"<question>\"` to ask a question against the built graph",
    "(optionally `--strategy dfs|bfs`). The answer is graphify's markdown, surfaced",
    "as-is; `graphPath` points at the whole normalized graph for structured reads.",
    "",
    "For the exact coupling of specific files use `aof graph impact <file> ...`. It",
    "reports the artifact's own `builtAt`, so check that first — and note that a file",
    "the graph does not cover comes back `present: false`, which means UNKNOWN",
    "coupling (a coverage gap), never \"this file has no coupling\".",
    "",
    "## Triage pull requests",
    "",
    "Run `aof graph triage` for the PR review queue (or `--mode conflicts`). Triage",
    "is reachable only through the aof CLI — it has no MCP tool of its own.",
    "",
    "## Do NOT bypass the aof command core",
    "",
    "- Always invoke `aof graph build`, `aof graph query`, and `aof graph triage`.",
    "- Do NOT call the graphify executable directly, and do NOT use graphify's own",
    "  skill invocation form. aof's verbs are the single source of truth; the",
    "  graphify CLI surface drifts by version and omits PR triage from its server.",
    ""
  ].join("\n");
}

// The graphify skill as an aof `resource` (skill kind). Rendered by
// `renderedResource` into .claude/skills/graphify/SKILL.md and
// .codex/skills/graphify/SKILL.md through the existing machinery — no new path.
export function graphifySkillResource() {
  return {
    kind: "skill",
    id: GRAPHIFY_SKILL_ID,
    name: "graphify",
    description: "Query the codebase knowledge graph through aof graph build/query/triage.",
    runtimes: [...GRAPHIFY_FACE_RUNTIMES],
    body: graphifySkillBody()
  };
}

// The graphify MCP face as an aof `mcpServers` entry (stdio transport). Rendered
// by `renderRuntimeConfigOutputs` → `claudeMcpJson` (.mcp.json) / `codexConfigToml`
// (config.toml). command/args launch the AOF-FRONTED `aof graph serve` server
// (story 04), NOT `python -m graphify.serve`.
export function graphifyMcpServer() {
  return {
    id: GRAPHIFY_MCP_ID,
    transport: "stdio",
    command: GRAPHIFY_SERVE_COMMAND,
    args: [...GRAPHIFY_SERVE_ARGS],
    runtimes: [...GRAPHIFY_FACE_RUNTIMES]
  };
}

// The shipped graphify faces as a config-SHAPED fragment, consumed by
// `renderConfigOutputs` unchanged (the `work-bundle.mjs` idiom). Any aof project
// adopts the graphify faces by spreading this into its config's resources +
// mcpServers.
export function graphifyFacesConfig() {
  return {
    resources: [graphifySkillResource()],
    mcpServers: [graphifyMcpServer()]
  };
}

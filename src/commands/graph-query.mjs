// graph:query — ask the graph a question (ADR-001, amended 2026-06-21). graphify
// has no stable --json for query (RESEARCH §C), so the answer is graphify's human
// markdown carried OPAQUE in `stdout`; the only structured handle is `graphPath`
// (the WHOLE normalized graph.json). query carries NO per-query nodes/edges — the
// "subgraph the query touched" lives only in the markdown and is NOT re-derivable
// from graph.json (the whole graph), so it is not invented.
//
//   input  { question, strategy?, budget? }
//   result QueryResult { question, stdout, graphPath }
//
// Operational PRECONDITION (ADR-001, @executable): a query is only meaningful
// AFTER a build. If <projectRoot>/graphify-out/graph.json does not exist, `run`
// throws a clear build-first error (code "no-graph") BEFORE any spawn — fires
// independent of whether the binary is even present, so it is deterministically
// CI-checkable. The success spawn is @manual (needs the live binary).
import { existsSync } from "node:fs";
import { commandError } from "./errors.mjs";
import { runGraphifyQuery, graphJsonPath } from "../graphify.mjs";
import { relativiseGraphPath } from "./graph-shared.mjs";

export const graphQueryCommand = {
  id: "graph:query",
  input: {
    type: "object",
    properties: {
      question: { type: "string" },
      strategy: { type: "string" },
      budget: { type: "number" },
    },
    required: ["question"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const projectRoot = ctx.workspace.projectRoot;
    const graphPath = graphJsonPath(projectRoot);

    // The missing-graph precondition, surfaced BEFORE any graphify spawn: a query
    // with no built graph fails clearly with a guidance-bearing build-first error
    // (never a crash, never an empty success). This is the CI-testable @executable
    // path; it fires whether or not the binary is present.
    if (!existsSync(graphPath)) {
      throw commandError(
        "No graph found — a graph must be built first (run `aof graph build <folder>`).",
        "no-graph",
        424
      );
    }

    // Success path (@manual — needs the live binary). cwd = projectRoot (#756).
    const queried = runGraphifyQuery(
      { question: input.question, strategy: input.strategy, budget: input.budget },
      { projectRoot }
    );
    return {
      question: input.question,
      stdout: queried.stdout,
      graphPath,
    };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; graphVerbCommand's cli.mjs ladder branch is deleted.
    route: ["graph", "query"],
    spec: {
      usage: 'aof graph query "<question>" [--strategy dfs|bfs] [--budget N] [--json]',
      flags: {
        strategy: { type: "string", description: "traversal strategy (dfs|bfs)" },
        budget: { type: "string", description: "node budget for the traversal" },
      },
    },

    // `aof graph query "<question>" [--strategy dfs|bfs] [--budget N]`.
    argv: (positionals, options = {}) => {
      const input = { question: positionals[0] };
      if (options.strategy) input.strategy = options.strategy;
      if (options.budget != null) input.budget = Number(options.budget);
      return input;
    },

    // Human render: graphify's opaque markdown answer + a one-line summary.
    render(result) {
      return result.stdout ? `${result.stdout}\nQuery: ${result.question}` : `Query: ${result.question}`;
    },

    // --json face projection: relativise graphPath to cwd (08/ADR-002).
    json: (result) => relativiseGraphPath(result),
  },
};

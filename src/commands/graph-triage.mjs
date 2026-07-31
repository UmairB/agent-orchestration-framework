// graph:triage — rank PRs against the graph (ADR-001, amended 2026-06-21). Triage
// has NO MCP tool and no stable --json (RESEARCH §H/§C), so a structured prs[] is
// NOT derivable without parsing stdout (forbidden) — the queue is graphify's
// triage markdown, carried OPAQUE in `stdout`; the only structured handle is
// `graphPath` (the WHOLE normalized graph.json). NO prs[] field is invented.
//
//   input  { mode?, pr? }   — mode ∈ {triage|conflicts} (default triage); pr = a PR number
//   result TriageResult { mode, stdout, graphPath }
//
// Same missing-graph PRECONDITION as query (ADR-001, @executable): if
// <projectRoot>/graphify-out/graph.json does not exist, `run` throws a clear
// build-first error (code "no-graph") BEFORE any spawn. The success spawn is
// @manual (needs the live binary).
import { existsSync } from "node:fs";
import { commandError } from "../command-error.mjs";
import { runGraphifyTriage, graphJsonPath } from "../graphify.mjs";
import { relativiseGraphPath } from "./graph-shared.mjs";

export const graphTriageCommand = {
  id: "graph:triage",
  input: {
    type: "object",
    properties: {
      mode: { type: "string" },
      pr: { type: "number" },
    },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const projectRoot = ctx.workspace.projectRoot;
    const graphPath = graphJsonPath(projectRoot);
    const mode = input.mode === "conflicts" ? "conflicts" : "triage";

    // The missing-graph precondition, surfaced BEFORE any graphify spawn (the
    // CI-testable @executable path; fires whether or not the binary is present).
    if (!existsSync(graphPath)) {
      throw commandError(
        "No graph found — a graph must be built first (run `aof graph build <folder>`).",
        "no-graph",
        424
      );
    }

    // Success path (@manual — needs the live binary). cwd = projectRoot (#756).
    const triaged = runGraphifyTriage({ mode, pr: input.pr }, { projectRoot });
    return {
      mode,
      stdout: triaged.stdout,
      graphPath,
    };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; graphVerbCommand's cli.mjs ladder branch is deleted.
    route: ["graph", "triage"],
    spec: {
      usage: "aof graph triage [--mode triage|conflicts] [--pr N] [--json]",
      flags: {
        mode: { type: "string", description: "triage mode (triage|conflicts)" },
        pr: { type: "string", description: "pull-request number to triage" },
      },
    },

    // `aof graph triage [--mode triage|conflicts] [--pr N]`.
    argv: (positionals, options = {}) => {
      const input = {};
      if (options.mode) input.mode = options.mode;
      if (options.pr != null) input.pr = Number(options.pr);
      return input;
    },

    // Human render: graphify's opaque triage-queue markdown + a one-line summary.
    render(result) {
      return result.stdout ? `${result.stdout}\nTriage mode: ${result.mode}` : `Triage mode: ${result.mode}`;
    },

    // --json face projection: relativise graphPath to cwd (08/ADR-002).
    json: (result) => relativiseGraphPath(result),
  },
};

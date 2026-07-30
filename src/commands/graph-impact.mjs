// graph:impact — the DETERMINISTIC, file-anchored coupling lookup the running ACD
// agents consume (milestone 11, re-open / ADR-007). Where `graph:query` is a fuzzy,
// similarity-seeded NL traversal (legible but unreliable — it seeds on doc nodes and
// needs re-phrasing), `graph:impact` answers the one question a reviewing/refining
// agent actually has, EXACTLY: "for these files, what do they import/call
// (dependencies) and what imports/calls them (dependents / blast-radius)?" — computed
// straight from the graph EDGES, no LLM, no spawn, no fuzz.
//
//   input  { paths: string[] }            // the files the agent is reviewing/changing
//   result ImpactResult { graphPath, files: [{ file, dependencies[], dependents[] }] }
//
// It reads the STRUCTURED graph.json via the pure `normalizeGraph` (09/ADR-001's
// PERMITTED structured handle — the SAME read 10's memory backend uses), NOT the
// forbidden opaque markdown stdout. It is NOT a graphify spawn (graph.json is a file
// read; 09/ADR-002) — so it adds NO new spawn site. ADVISORY: it returns coupling
// FACTS the agent reasons over; it feeds no gate/merge (ADR-004 still holds).
//
// PRECONDITION (ADR-001, @executable): a graph must be built first. If
// <projectRoot>/graphify-out/graph.json is absent, `run` throws a build-first
// "no-graph" error BEFORE any read — deterministically CI-checkable, no binary needed.
import { existsSync } from "node:fs";
import { commandError } from "./errors.mjs";
import { readGraph, normalizeGraph, graphJsonPath } from "../graph-normalize.mjs";
import { relativiseGraphPath } from "./graph-shared.mjs";

// Compute, for the given target file set, the cross-file dependencies (edges OUT of a
// target node) and dependents (edges INTO a target node) — deduped, self-file dropped.
// Pure over the normalized graph; the whole testable core (no fs, no spawn).
export function computeImpact(graph, paths) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  // Normalize requested paths to the graph's separator convention (graphify writes
  // POSIX-style source_file). Match on suffix so an agent may pass an absolute or a
  // repo-relative path; the graph stores repo-relative POSIX paths.
  const wanted = paths.map((p) => p.replace(/\\/g, "/"));
  const matchFile = (sourceFile) =>
    wanted.find((w) => sourceFile === w || sourceFile.endsWith(`/${w}`) || w.endsWith(`/${sourceFile}`));

  return wanted.map((requested) => {
    // The node ids whose source_file resolves to this requested path.
    const fileNodes = graph.nodes.filter((n) => {
      if (!n.sourceFile) return false;
      const sf = n.sourceFile.replace(/\\/g, "/");
      return sf === requested || sf.endsWith(`/${requested}`) || requested.endsWith(`/${sf}`);
    });
    const ids = new Set(fileNodes.map((n) => n.id));
    const resolvedFile = fileNodes[0]?.sourceFile ?? requested;

    const dependencies = new Set();
    const dependents = new Set();
    for (const edge of graph.edges) {
      const src = byId.get(edge.source);
      const tgt = byId.get(edge.target);
      if (!src || !tgt) continue;
      const srcFile = src.sourceFile?.replace(/\\/g, "/");
      const tgtFile = tgt.sourceFile?.replace(/\\/g, "/");
      // OUT edge: a node in this file points at another file → a dependency.
      if (ids.has(edge.source) && tgtFile && tgtFile !== resolvedFile) dependencies.add(tgtFile);
      // IN edge: another file points at a node in this file → a dependent.
      if (ids.has(edge.target) && srcFile && srcFile !== resolvedFile) dependents.add(srcFile);
    }
    return {
      file: resolvedFile,
      present: fileNodes.length > 0,
      dependencies: [...dependencies].sort(),
      dependents: [...dependents].sort(),
    };
  });
}

export const graphImpactCommand = {
  id: "graph:impact",
  input: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" } },
    },
    required: ["paths"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const projectRoot = ctx.workspace.projectRoot;
    const graphPath = graphJsonPath(projectRoot);

    // Build-first precondition, surfaced BEFORE any read (mirrors graph:query). A
    // deterministic, binary-independent @executable path.
    if (!existsSync(graphPath)) {
      throw commandError(
        "No graph found — a graph must be built first (run `aof graph build <folder>`).",
        "no-graph",
        424
      );
    }
    if (!Array.isArray(input.paths) || input.paths.length === 0) {
      throw commandError("graph:impact needs at least one path (the file[s] to analyse).", "no-paths", 400);
    }

    // Pure structured read (09/ADR-001's permitted handle) — NOT a spawn, NOT a
    // markdown parse. The same read 10's backend uses.
    const graph = normalizeGraph(readGraph(graphPath));
    const files = computeImpact(graph, input.paths);
    return { graphPath, files };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; graphVerbCommand's cli.mjs ladder branch is deleted.
    route: ["graph", "impact"],
    spec: {
      usage: "aof graph impact <path> [<path> ...] [--json]",
      flags: {},
    },

    // `aof graph impact <path> [<path> ...]`.
    argv: (positionals) => ({ paths: positionals }),

    // Human render: per file, the deterministic dependents (blast-radius) + deps.
    render(result) {
      const lines = [];
      for (const f of result.files) {
        lines.push(`# ${f.file}${f.present ? "" : "  (not in graph — build over its folder?)"}`);
        lines.push(`  imported/called by ← (${f.dependents.length}) ${f.dependents.join(", ") || "(none)"}`);
        lines.push(`  imports/calls      → (${f.dependencies.length}) ${f.dependencies.join(", ") || "(none)"}`);
      }
      return lines.join("\n");
    },

    // --json face: relativise graphPath to cwd (08/ADR-002); files are repo-relative.
    json: (result) => relativiseGraphPath(result),
  },
};

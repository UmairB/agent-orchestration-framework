// graph:build — build the queryable graph from a folder (ADR-001). Spawns the
// pinned graphify binary (via the ADR-002 driver — the ONLY spawn site), reads
// the resulting graph.json, and returns a BuildResult whose counts are derived
// from the graph (RESEARCH §C/§D), NEVER parsed from graphify's markdown stdout.
//
//   input  { path, backend?, tokenBudget?, offline? }
//   result BuildResult { graphPath, projectRoot, nodeCount, edgeCount,
//                        hyperedgeCount, builtAt, backend, egress, stdout }
//
// Paths are RAW ABSOLUTE (basis-neutral, 08/ADR-002); the CLI face relativises
// for display. `egress` reports whether the doc/media backend HOP ran: "none"
// when no backend (code/AST only, fully local), "docs-media" when ANY --backend
// ran — aof reports "the hop ran", never re-classifies by network reachability,
// never widens graphify's own egress (ADR-005). When the binary is absent, `run`
// throws a structured graphify-missing error (ADR-002/004) BEFORE any spawn.
import path from "node:path";
import { commandError } from "./errors.mjs";
import {
  resolveGraphifyBinary,
  runGraphifyBuild,
  readGraph,
  normalizeGraph,
  graphJsonPath,
} from "../graphify.mjs";

// Backend classification (RESEARCH §F). A NETWORK backend reaches a remote API
// (claude/gemini/openai/kimi/deepseek); ollama is LOCAL (runs on-box). The
// distinction drives the ADR-001 offline guard ONLY — it is NOT the egress field:
// egress reports whether the doc/media HOP ran, regardless of locality (ADR-005).
const NETWORK_BACKENDS = new Set(["claude", "gemini", "openai", "kimi", "deepseek"]);
const LOCAL_BACKENDS = new Set(["ollama"]);

// True when `backend` names a backend that crosses the network (a remote API).
// null/absent/local (ollama) → false. Unknown names are treated as NETWORK
// (fail-closed: an unrecognised backend is assumed to egress until proven local).
export function isNetworkBackend(backend) {
  if (backend == null) return false;
  if (LOCAL_BACKENDS.has(backend)) return false;
  return true;
}

// classifyEgress(backend) → the egress field for a BuildResult (ADR-001/ADR-005).
// "none" when NO backend ran (code/AST only, fully local); "docs-media" when ANY
// --backend drove the doc/media hop — ollama INCLUDED, because the hop RAN even
// though it ran locally. Locality is a SEPARATE privacy property, never folded
// into egress; aof reports "the hop ran", never re-classifies by reachability.
export function classifyEgress(backend) {
  return backend == null ? "none" : "docs-media";
}

export const graphBuildCommand = {
  id: "graph:build",
  input: {
    type: "object",
    properties: {
      path: { type: "string" },
      backend: { type: "string" },
      tokenBudget: { type: "number" },
      offline: { type: "boolean" },
    },
    required: ["path"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const projectRoot = ctx.workspace.projectRoot;
    const backend = input.backend ?? null;

    // ADR-001 enforcement: offline:true FORBIDS a network backend. Reject BEFORE
    // any spawn (and before the binary check) with a structured conflict error.
    // offline:true + ollama (local) or + no backend is allowed — the hop, if any,
    // never leaves the box. An unknown backend is treated as network (fail-closed).
    if (input.offline === true && isNetworkBackend(backend)) {
      throw commandError(
        `offline:true forbids the network backend "${backend}" (only the local "ollama" backend or no backend may run offline).`,
        "offline-backend-conflict",
        409
      );
    }

    // Guard the binary-absent path BEFORE any spawn (ADR-002/004): surface a
    // clear, guidance-bearing failure (the install hint), never an opaque ENOENT.
    const resolved = resolveGraphifyBinary();
    if (!resolved.found) {
      throw commandError(resolved.hint, "graphify-missing", 424);
    }

    // Spawn the pinned binary via the sole driver seam (cwd = projectRoot, #756).
    const built = runGraphifyBuild(
      { path: input.path, backend, tokenBudget: input.tokenBudget },
      { projectRoot }
    );

    // Counts come from graph.json (ADR-001 invariant), never from stdout.
    const normalized = normalizeGraph(readGraph(built.graphPath));

    // egress: "none" when no backend ran (code/AST only); "docs-media" when ANY
    // --backend drove the doc/media hop (ADR-001/005). ollama is still
    // "docs-media" — the hop RAN; locality is a separate privacy property.
    const egress = classifyEgress(backend);

    return {
      graphPath: graphJsonPath(projectRoot),
      projectRoot,
      nodeCount: normalized.nodes.length,
      edgeCount: normalized.edges.length,
      hyperedgeCount: normalized.hyperedges.length,
      builtAt: new Date().toISOString(),
      backend,
      egress,
      stdout: built.stdout,
    };
  },

  cli: {
    // `aof graph build <folder> [--backend X] [--token-budget N] [--offline]`.
    argv: (positionals, options = {}) => {
      const input = { path: positionals[0] };
      if (options.backend) input.backend = options.backend;
      if (options.tokenBudget != null) input.tokenBudget = Number(options.tokenBudget);
      if (options.offline) input.offline = true;
      return input;
    },

    // Human render: the opaque graphify markdown + a one-line graph summary.
    render(result) {
      const summary = `Built ${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.hyperedgeCount} hyperedges (egress: ${result.egress}).`;
      return result.stdout ? `${result.stdout}\n${summary}` : summary;
    },

    // --json face projection: relativise the raw absolute paths to cwd, mirroring
    // work:next (cli.mjs). The structured result is otherwise the BuildResult.
    json: (result) => relativisePaths(result),
  },
};

// Relativise graphPath/projectRoot to process.cwd() for the CLI --json face
// (08/ADR-002 path-display projection). Leaves every other field untouched.
function relativisePaths(result) {
  const out = { ...result };
  if (typeof out.graphPath === "string") out.graphPath = path.relative(process.cwd(), out.graphPath);
  if (typeof out.projectRoot === "string") out.projectRoot = path.relative(process.cwd(), out.projectRoot);
  return out;
}

// graph:build — build the queryable graph from a folder (ADR-001). Spawns the
// pinned graphify binary (via the ADR-002 driver — the ONLY spawn site), reads
// the resulting graph.json, and returns a BuildResult whose counts are derived
// from the graph (RESEARCH §C/§D), NEVER parsed from graphify's markdown stdout.
//
//   input  { path, backend?, tokenBudget?, offline?, outRoot? }
//   result BuildResult { graphPath, projectRoot, nodeCount, edgeCount,
//                        hyperedgeCount, builtAt, backend, egress, unchanged, stdout }
//
// Paths are RAW ABSOLUTE (basis-neutral, 08/ADR-002); the CLI face relativises
// for display. `egress` reports whether the doc/media backend HOP ran: "none"
// when no backend (code/AST only, fully local), "docs-media" when ANY --backend
// ran — aof reports "the hop ran", never re-classifies by network reachability,
// never widens graphify's own egress (ADR-005). When the binary is absent, `run`
// throws a structured graphify-missing error (ADR-002/004) BEFORE any spawn.
import path from "node:path";
import { commandError } from "../command-error.mjs";
import {
  resolveGraphifyBinary,
  runGraphifyBuild,
  readGraph,
  normalizeGraph,
  graphJsonPath,
} from "../graphify.mjs";

// Backend classification (RESEARCH §F). A NETWORK backend reaches a remote API
// (claude/gemini/openai/kimi/deepseek/claude-cli); ollama is LOCAL (runs on-box).
// The distinction drives the ADR-001 offline guard ONLY — it is NOT the egress
// field: egress reports whether the doc/media HOP ran, regardless of locality
// (ADR-005).
//
// `claude-cli` is graphify's native credential-local default (10/ADR-003): it
// shells the user's logged-in `claude -p` (no metered ANTHROPIC_API_KEY; billed to
// the plan). It is registered here BY KNOWLEDGE so the classification is by
// enumeration, not by the unknown-name network fall-through: billed-to-plan is
// orthogonal to egress — the prose IS still sent to Anthropic for inference, so it
// DOES cross the network (isNetworkBackend === true). It is NOT data-local; `ollama`
// remains the ONLY data-resident (on-box) backend. Both still egress "docs-media"
// (the doc/media hop ran) — locality is a separate privacy property (ADR-005).
const NETWORK_BACKENDS = new Set(["claude", "claude-cli", "gemini", "openai", "kimi", "deepseek"]);
const LOCAL_BACKENDS = new Set(["ollama"]);

// True when `backend` names a backend that crosses the network (a remote API).
// null/absent/local (ollama) → false. A KNOWN network backend (NETWORK_BACKENDS,
// claude-cli INCLUDED — 10/ADR-003) is classified network by ENUMERATION, never by
// accident. An UNKNOWN name still falls closed to NETWORK (an unrecognised backend
// is assumed to egress until proven local) — but the known set is the by-knowledge
// path, so adding claude-cli to NETWORK_BACKENDS makes its classification a
// deliberate fact, not a fall-through the moment the default ever changes.
export function isNetworkBackend(backend) {
  if (backend == null) return false;
  if (LOCAL_BACKENDS.has(backend)) return false;
  if (NETWORK_BACKENDS.has(backend)) return true;
  return true; // fail-closed: unknown names are assumed to egress until proven local
}

// True when `backend` is a KNOWN network backend (registered in NETWORK_BACKENDS),
// i.e. its network classification is BY KNOWLEDGE, not by the unknown-name
// fall-through. `isNetworkBackend` returns true for BOTH a known-network name and an
// unknown one (fail-closed); this distinguishes them so the 10/ADR-003 contract —
// "claude-cli is network by enumeration" — is observable, not merely incidental.
export function isKnownNetworkBackend(backend) {
  return backend != null && NETWORK_BACKENDS.has(backend);
}

// classifyEgress(backend) → the egress field for a BuildResult (ADR-001/ADR-005).
// "none" when NO backend ran (code/AST only, fully local); "docs-media" when ANY
// --backend drove the doc/media hop — ollama INCLUDED, because the hop RAN even
// though it ran locally. Locality is a SEPARATE privacy property, never folded
// into egress; aof reports "the hop ran", never re-classifies by reachability.
export function classifyEgress(backend) {
  return backend == null ? "none" : "docs-media";
}

// readBuiltGraph(graphPath) — the normalizing read of the artifact a build just
// verified, and the build's LAST honesty check. Exported pure (the graphifyBuildArgs /
// classifyEgress idiom) so the failure path is drivable without the live binary: a real
// spawn would simply overwrite any corrupt fixture, so this cannot be reached through
// `invoke` at all.
//
// The driver can only see THAT a file exists. Here we find out whether it is a graph. A
// zero exit over a truncated, corrupt or unparseable artifact is a failed build however
// cheerful the process was — and this is the honest remnant of the artifact-unchanged
// guard it replaces: it asserts a USABLE graph, rather than guessing at staleness from
// mtimes graphify deliberately does not update. Structured, so the caller sees a build
// failure instead of a SyntaxError escaping as a stack trace.
export function readBuiltGraph(graphPath) {
  try {
    return normalizeGraph(readGraph(graphPath));
  } catch (error) {
    throw commandError(
      `graphify exited successfully but ${graphPath} is not a readable graph: ${error.message}`,
      "graphify-no-persist",
      424
    );
  }
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
      outRoot: { type: "string" },
    },
    required: ["path"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const projectRoot = ctx.workspace.projectRoot;
    // The artifact root: the directory whose graphify-out/graph.json this build writes
    // and reports. Defaults to projectRoot — the CODEBASE graph every graph:impact /
    // graph:query read resolves. An in-process caller building a DIFFERENT graph over
    // the same repo (the memory backend's work-stream graph) passes its own root so the
    // replacing extraction cannot evict the codebase graph. Not a CLI flag: the CLI face
    // has exactly one graph, and a user-supplied root would put the artifact somewhere
    // the query family cannot find (#756).
    const outRoot = input.outRoot ?? projectRoot;
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

    // Spawn the pinned binary via the sole driver seam (cwd = projectRoot, #756;
    // the artifact lands under outRoot).
    const built = runGraphifyBuild(
      { path: input.path, backend, tokenBudget: input.tokenBudget },
      { projectRoot, outRoot }
    );

    // Counts come from graph.json (ADR-001 invariant), never from stdout.
    const normalized = readBuiltGraph(built.graphPath);

    // egress: "none" when no backend ran (code/AST only); "docs-media" when ANY
    // --backend drove the doc/media hop (ADR-001/005). ollama is still
    // "docs-media" — the hop RAN; locality is a separate privacy property.
    const egress = classifyEgress(backend);

    return {
      graphPath: graphJsonPath(outRoot),
      projectRoot,
      nodeCount: normalized.nodes.length,
      edgeCount: normalized.edges.length,
      hyperedgeCount: normalized.hyperedges.length,
      builtAt: built.builtAt,
      backend,
      egress,
      // true when graphify found nothing to change and left the artifact untouched —
      // a SUCCESS meaning "the graph is already current", not a soft failure. Surfaced
      // so a caller can distinguish it from a rebuild without re-stat'ing anything.
      unchanged: built.unchanged,
      stdout: built.stdout,
    };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; graphVerbCommand's cli.mjs ladder branch is deleted.
    route: ["graph", "build"],
    spec: {
      usage: "aof graph build <folder> [--backend claude] [--token-budget N] [--offline] [--json]",
      flags: {
        backend: { type: "string", description: "graphify backend (e.g. claude)" },
        tokenBudget: { type: "string", description: "token budget for the build" },
        offline: { type: "boolean", description: "build without network egress" },
      },
    },

    // `aof graph build <folder> [--backend X] [--token-budget N] [--offline]`.
    argv: (positionals, options = {}) => {
      const input = { path: positionals[0] };
      if (options.backend) input.backend = options.backend;
      if (options.tokenBudget != null) input.tokenBudget = Number(options.tokenBudget);
      if (options.offline) input.offline = true;
      return input;
    },

    // Human render: the opaque graphify markdown + a one-line graph summary. An
    // untouched artifact says so in plain words — "already current" is the honest
    // reading of graphify's no-topology-change no-op, and stating it stops the next
    // reader from mistaking a steady state for a build that quietly did nothing.
    render(result) {
      const verb = result.unchanged ? "Already current at" : "Built";
      const summary = `${verb} ${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.hyperedgeCount} hyperedges (egress: ${result.egress}, built ${result.builtAt}).`;
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

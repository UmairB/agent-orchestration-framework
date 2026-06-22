// src/graphify.mjs — the graphify adapter (ADR-002): the SOLE place in the
// codebase that spawns the graphify binary. The graph:* commands call these
// helpers; nothing else (no face, no MCP server runtime, no command module)
// spawns graphify directly — the no-direct-spawn fitness guard (ADR-006 inv. 2)
// asserts the only `graphify` spawn in src/ is here.
//
// This module owns the three spawn-seam concerns RESEARCH flagged, in ONE place:
//   (1) Binary resolution — the install spec is PyPI `graphifyy` (double-y) but
//       the invoked binary is `graphify` (single-y) (RESEARCH §G). As of
//       milestone-12 ADR-004, graphify resolves STORE-FIRST: resolveGraphifyBinary
//       DELEGATES to tool-store.mjs's resolveManagedBinary, which checks the managed
//       store copy (~/.aof/tools/graphify/<version>/{Scripts|bin}/graphify[.exe])
//       BEFORE falling back to the PATH walk (the 09 behaviour, now inside the
//       shared resolver). It still probes the version, degrading to `version: null`
//       when the flag is absent (RESEARCH §A4) rather than ever throwing, and a
//       total miss is still the frozen `{found:false,hint}` no-throw contract
//       (09/ADR-002) — only the hint changes, now naming `aof project provision
//       graphify`.
//   (2) The #756 cwd discipline (RESEARCH §I) — query/path/explain hardcode
//       `<cwd>/graphify-out/graph.json` and IGNORE GRAPHIFY_OUT, so every spawn
//       runs with `cwd = projectRoot`; the driver never redirects via env.
//   (3) Version pinning — PINNED_GRAPHIFY_VERSION is the version the contract is
//       verified against; the verb mapping is gated on it (and is the store-key
//       version the store-first resolver looks up).
//
// The pure, fully-testable core here is `normalizeGraph` (ADR-003): it reads the
// NetworkX `node_link_data` `links` key (NOT `edges`), preserves
// confidence/confidenceScore (score present ONLY for INFERRED), maps node fields
// to camelCase, and keeps `graph.hyperedges` SEPARATE. The spawn helpers need the
// live binary, so they are exercised only by @manual scenarios (no CI test).
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveManagedBinary } from "./tool-store.mjs";

// The two names RESEARCH §G flags as load-bearing: install via the PyPI package
// `graphifyy` (double-y), invoke the `graphify` binary (single-y). A doctor/lock
// entry stores BOTH; the resolver returns the binary name it actually found.
export const GRAPHIFY_SPEC = "graphifyy";
export const GRAPHIFY_BINARY = "graphify";

// The version the command contract is verified against (RESEARCH §G desk-checked
// 0.8.44, 2026-06-19). The verb mapping is gated on this; an unexpected installed
// version is a doctor warning (ADR-004), never a silent mismap.
export const PINNED_GRAPHIFY_VERSION = "0.8.44";

// The on-disk graph artifact, relative to the project root (RESEARCH §D/§I).
const GRAPH_OUT_DIR = "graphify-out";
const GRAPH_JSON = "graph.json";

// Resolve <projectRoot>/graphify-out/graph.json — the one stable machine artifact
// every graph op reads. Raw absolute (basis-neutral, 08/ADR-002).
export function graphJsonPath(projectRoot) {
  return path.join(projectRoot, GRAPH_OUT_DIR, GRAPH_JSON);
}

// --------------------------------------------------------------- resolution ---

// resolveGraphifyBinary(options?) — the binary-resolution seam (ADR-002), now
// RE-POINTED STORE-FIRST (milestone-12 ADR-004). It DELEGATES to tool-store.mjs's
// resolveManagedBinary, keyed on graphify's name/pinned-version/binary, so the
// managed store copy (~/.aof/tools/graphify/<version>/{Scripts|bin}/graphify[.exe])
// wins over a stray global, and on a store miss it falls back to the SAME PATH walk
// the 09 resolver did (now living inside the shared resolver). Every graphify spawn
// (runGraphifyBuild/Query/Triage) and the doctor check resolve through this one seam.
//
// The FROZEN contract the graph commands depend on is preserved (09/ADR-002):
//   - a found result carries { found:true, binary, path, version } (the additive
//     `source:"store"|"path"` field is fine — callers ignore it);
//   - a total miss is the structured { found:false, hint } and NEVER throws (no
//     opaque ENOENT). Only the hint changes — it now names `aof project provision
//     graphify` (the lifecycle command, ADR-003/ADR-004), not the old two-step
//     manual install.
//   - the version probe degrades to `version: null` on a missing flag / non-zero
//     exit (RESEARCH §A4) — callers render "present, version unknown".
//
// `options` forwards the resolver's injectable seams so callers (and tests) can
// drive store/PATH/probe hermetically without mutating process-global state:
//   options.env        — the env the store root derives from (AOF_GLOBAL_HOME).
//   options.platform   — the platform shaping the exe path (Scripts/.exe vs bin).
//   options.pathValue  — the PATH string to scan on the store-miss fallback.
//   options.useLocator — whether to consult the OS locator (`where`/`which`).
//   options.probe      — an injected `<bin> --version` probe (default: live spawn).
// The production call passes nothing and behaves exactly as the 09 resolver did,
// plus the store-first prefix.
export function resolveGraphifyBinary(options = {}) {
  return resolveManagedBinary({
    name: GRAPHIFY_BINARY,
    version: PINNED_GRAPHIFY_VERSION,
    binary: GRAPHIFY_BINARY,
    ...options,
  });
}

// ------------------------------------------------------------------ spawns ----
// The build/query/triage spawns need the LIVE binary, so they are exercised only
// by @manual scenarios (task 02 / 03 success rows) — no CI test. They are
// implemented honestly against the documented verbs (RESEARCH §B) but must NEVER
// spawn when the binary is absent (ADR-004): callers guard with
// resolveGraphifyBinary() first and throw a structured graphify-missing error.

// graph build — `graphify extract <path> [--backend X] [--token-budget N]`
// (RESEARCH §B). cwd = projectRoot so the artifact lands under
// <projectRoot>/graphify-out/ (#756, RESEARCH §I). A null/absent backend passes
// NO --backend flag → code/AST only, zero egress (privacy boundary, ADR-005).
export function runGraphifyBuild(input, { projectRoot }) {
  const resolved = resolveGraphifyBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const args = ["extract", input.path];
  if (input.backend) {
    args.push("--backend", input.backend);
  }
  if (input.tokenBudget != null) {
    args.push("--token-budget", String(input.tokenBudget));
  }
  const result = spawnSync(resolved.path, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return {
    graphPath: graphJsonPath(projectRoot),
    stdout: result.stdout ?? "",
    status: result.status,
  };
}

// graph query — `graphify query "<question>" [--dfs|--bfs] [--budget N]`
// (RESEARCH §B). cwd = projectRoot (#756). stdout is graphify's human markdown,
// carried opaque (RESEARCH §C); the structured handle is graphPath.
export function runGraphifyQuery(input, { projectRoot }) {
  const resolved = resolveGraphifyBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const args = ["query", input.question];
  if (input.strategy === "dfs") args.push("--dfs");
  if (input.strategy === "bfs") args.push("--bfs");
  if (input.budget != null) args.push("--budget", String(input.budget));
  const result = spawnSync(resolved.path, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    graphPath: graphJsonPath(projectRoot),
  };
}

// graph triage — `graphify prs --triage` / `prs --conflicts` / `prs N`
// (RESEARCH §B/§H — triage has no MCP tool, so it must drive the CLI). cwd =
// projectRoot (#756). stdout is the triage-queue markdown, carried opaque.
export function runGraphifyTriage(input, { projectRoot }) {
  const resolved = resolveGraphifyBinary();
  if (!resolved.found) {
    const error = new Error(resolved.hint);
    error.code = "graphify-missing";
    throw error;
  }
  const args = ["prs"];
  if (input.pr != null) {
    args.push(String(input.pr));
  } else if (input.mode === "conflicts") {
    args.push("--conflicts");
  } else {
    args.push("--triage");
  }
  const result = spawnSync(resolved.path, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    graphPath: graphJsonPath(projectRoot),
  };
}

// --------------------------------------------------------------- read graph ---

// readGraph(graphPath) — parse the raw graph.json (NetworkX node_link_data). The
// ADR-003 normalizer (normalizeGraph) does the shaping; this is the bare read.
export function readGraph(graphPath) {
  const raw = readFileSync(graphPath, "utf8");
  return JSON.parse(raw);
}

// ------------------------------------------------------------- normalization --
// The pure, fully-testable @executable core (ADR-003). The key spelling is
// load-bearing: NetworkX node_link_data emits top-level `nodes` and `links`
// (links, NOT edges — NetworkX remaps edges→links for portability). Reading
// `edges` would yield a silently empty edge set — the bug this forbids.

// normalizeGraph(raw) → { nodes, edges, hyperedges }. Throws a surfaced
// graph-format error when `links` is absent but `edges` is present (a future
// graphify shape change), rather than returning a silently empty edge set.
export function normalizeGraph(raw) {
  if (!raw || typeof raw !== "object") {
    const error = new Error("graph.json is not an object.");
    error.code = "graph-format";
    throw error;
  }

  const hasLinks = Array.isArray(raw.links);
  const hasEdges = Array.isArray(raw.edges);

  // The load-bearing format guard: a `links`-absent + `edges`-present graph is a
  // SURFACED format error (graphify changed its node_link_data shape), never a
  // silent empty edge set (ADR-003 / RESEARCH §D).
  if (!hasLinks && hasEdges) {
    const error = new Error(
      "graph.json carries an `edges` array but no `links` array — expected NetworkX node_link_data (`links`, not `edges`)."
    );
    error.code = "graph-format";
    throw error;
  }

  const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode) : [];
  const edges = hasLinks ? raw.links.map(normalizeEdge) : [];

  // Hyperedges (3+ nodes) live separately under graph.hyperedges and must NEVER
  // be flattened into pairwise edges (RESEARCH §D constraint).
  const rawHyperedges = raw.graph && Array.isArray(raw.graph.hyperedges) ? raw.graph.hyperedges : [];
  const hyperedges = rawHyperedges.map(normalizeHyperedge);

  return { nodes, edges, hyperedges };
}

// Node fields → camelCase GraphNode, keyed on the stable `id` join key
// (RESEARCH §D): id/label/file_type/source_file/community/norm_label.
function normalizeNode(node) {
  return {
    id: node.id,
    label: node.label,
    fileType: node.file_type,
    sourceFile: node.source_file,
    community: node.community,
    normLabel: node.norm_label,
  };
}

// Edge fields → GraphEdge (RESEARCH §D): source/target/relation/confidence, plus
// confidenceScore present ONLY for INFERRED. graphify sets confidence_score only
// on INFERRED edges; an INFERRED edge that omits the float must normalize to an
// ABSENT confidenceScore, NEVER a fabricated 0.
function normalizeEdge(edge) {
  const normalized = {
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    confidence: edge.confidence,
  };
  // Preserve confidenceScore only when graphify actually provided a numeric score
  // (INFERRED). Absent/undefined/null → omit the field entirely (never 0).
  if (typeof edge.confidence_score === "number") {
    normalized.confidenceScore = edge.confidence_score;
  }
  return normalized;
}

// Hyperedges normalize as a separate shape; carry the member node ids + any
// relation/label, never merged into the pairwise edge list.
function normalizeHyperedge(hyperedge) {
  return {
    nodes: Array.isArray(hyperedge.nodes) ? [...hyperedge.nodes] : [],
    relation: hyperedge.relation,
    ...(hyperedge.id != null ? { id: hyperedge.id } : {}),
  };
}

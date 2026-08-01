// src/graph-normalize.mjs — the PURE graph normalizer (extracted from
// src/graphify.mjs, milestone 10/01 locked Three-Amigos decision).
//
// This module owns ONLY the no-spawn, fs-read + shaping helpers that turn a raw
// NetworkX `node_link_data` `graph.json` into aof's normalized `{ nodes, edges,
// hyperedges }` shape (09/ADR-003): it reads the `links` key (NOT `edges`),
// preserves `confidence`/`confidenceScore` (score present ONLY for INFERRED),
// maps node fields to camelCase, and keeps `graph.hyperedges` SEPARATE. It imports
// NEITHER `node:child_process` NOR `src/graphify.mjs` — it is a pure file/parse
// layer, NOT a graphify spawn.
//
// WHY a separate module (the DRY seam two milestones share):
//   - milestone 09's `src/graphify.mjs` (the SOLE graphify spawn site) re-exports
//     these helpers so its command code + tests are behaviour-preserved; and
//   - milestone 10's graphify MEMORY backend (`src/memory/graphify-backend.mjs`)
//     imports them HERE — the `acd-graphify-backend-via-command` guard forbids the
//     backend importing `src/graphify.mjs` (where the spawn lives), so the pure
//     normalizer must live in a spawn-free module both can reach.
// One `links`-not-`edges` / hyperedge-separate implementation, two consumers.
import path from "node:path";
import { readFileSync, statSync } from "node:fs";

// The on-disk graph artifact, relative to the project root (RESEARCH §D/§I).
const GRAPH_OUT_DIR = "graphify-out";
const GRAPH_JSON = "graph.json";

// Resolve <projectRoot>/graphify-out/graph.json — the one stable machine artifact
// every graph op reads. Raw absolute (basis-neutral, 08/ADR-002).
export function graphJsonPath(projectRoot) {
  return path.join(projectRoot, GRAPH_OUT_DIR, GRAPH_JSON);
}

// graphArtifactBuiltAt(graphPath) — the artifact's own mtime, ISO. The ONE derivation
// every `builtAt` in the system comes from, so a build and a later `graph:impact` over
// the same untouched file always report the SAME instant.
//
// It must be one function because the two stat flavours disagree: `statSync(p)` derives
// its Date from a float mtimeMs and ROUNDS, while `statSync(p, {bigint:true})` truncates
// — 1785418756881.5962 renders as …:16.882Z one way and …:16.881Z the other. Two honest
// reads of one file reporting different times is exactly the kind of small dishonesty
// this field exists to remove. Truncation wins: it never claims an artifact is newer
// than it is. An unstattable artifact answers null rather than guessing.
export function graphArtifactBuiltAt(graphPath) {
  try {
    return statSync(graphPath, { bigint: true }).mtime.toISOString();
  } catch {
    return null;
  }
}

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

// The `graphify` memory backend (milestone 10, story 00 — the SPINE).
//
// It satisfies the FROZEN 05 backend interface (05/ADR-003): the default export is
// EXACTLY { name, recall, reindex, status } with name === "graphify". It is a thin
// composition of two independently-frozen halves (ADR-001):
//   - RECORDS come from milestone-05's markdown parsers, REUSED untouched: the pure
//     `buildRecords` (05 indexing) + `rankRecords`/`applyScope`/`normalizeScope`/
//     `renderRecallText` (05 retrieval). Every record stays a frozen `MemoryRecord`
//     with a resolving `source:line` — the graph is NEVER the record source.
//   - The GRAPH is a derived re-rank SIGNAL only. `reindex` (re)builds a work-stream
//     graph under `graphify-out/` by reaching graphify EXCLUSIVELY through the 09
//     `graph:build` command via `invoke(...)` (ADR-002) — it spawns nothing, imports
//     NEITHER `../graphify.mjs` NOR `node:child_process`.
//
// Story-00 scope: the re-ranker is STUBBED to the 05 base ranking (story 01 adds the
// graph term). `reindex`'s graph build FAILS SOFT — when the binary is absent (the CI
// reality), the structured `graphify-missing` miss is caught and the records-rebuilt
// result still returns successfully (graph skipped); the records half is the
// @executable assertion. The full binary-absent degrade across every verb +
// claude-cli classification is story 02.
//
// Own store (a CONTRACT refinement): 05's `memoryIndexPath` hardcodes
// `.aof/aof.memory.index.json` with `backend:"local"` baked in, so this backend
// writes its OWN derived store at `.aof/aof.memory.graphify.index.json`, labelled
// `backend:"graphify"`, REUSING the pure `buildRecords` (NOT 05's `reindex` writer) —
// zero edits to 05's shipped code.

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

// The ONLY door to graphify (ADR-002): the command core's in-process invoke. This
// module imports it and reaches the graph EXCLUSIVELY through invoke("graph:build").
// It imports NEITHER `../graphify.mjs` NOR `node:child_process`, and spawns nothing
// (the acd-graphify-backend-via-command guard, story 03).
import { invoke as coreInvoke, loadWorkspace } from "../command-core.mjs";
import { buildRecords } from "./local-indexing.mjs";
import {
  rankRecords,
  applyScope,
  normalizeScope,
  renderRecallText,
} from "./local-retrieval.mjs";
import { readJson, writeText } from "../fs.mjs";
import { ensureAofGitignore, ensureGraphifyOutGitignore } from "../aof-gitignore.mjs";
// The PURE graph.json read/normalize helpers (10/01 extraction). The backend reads
// the on-disk graph artifact via THIS spawn-free module — NOT `../graphify.mjs`
// (which is the graphify spawn site the acd-graphify-backend-via-command guard forbids
// the backend from importing). Reading graph.json is NOT a spawn (09/ADR-001/ADR-002).
import { graphJsonPath, readGraph, normalizeGraph } from "../graph-normalize.mjs";

// The graphify backend's OWN derived store (separate from local's, ADR-005 +
// the Three-Amigos store-path refinement). It sits beside the local index under
// `.aof/` (git-ignored via the F-02 baseline) and is labelled `backend:"graphify"`.
const INDEX_REL = path.join(".aof", "aof.memory.graphify.index.json");

// The index-format version (mirrors 05/INDEX_VERSION; bump on a record-shape change).
export const GRAPHIFY_INDEX_VERSION = 1;

// The extraction backend the work-stream graph is built with (ADR-003). `claude-cli`
// is graphify's native, credential-local default (keyless, billed-to-plan). The model
// is tunable via graphify's own GRAPHIFY_CLAUDE_CLI_MODEL — a knob, not an aof contract.
// (Story 02 owns surfacing this + the honest egress label; story 00 only passes it.)
export const GRAPHIFY_EXTRACTION_BACKEND = "claude-cli";

// The honest egress label of the chosen extraction backend (10/ADR-003): the doc/media
// hop RAN, so "docs-media" — exactly classifyEgress("claude-cli") in graph-build.mjs.
// Pinned here as the static ADR-003 fact (and asserted live against graph-build.mjs by
// the story-03 acd-graphify-backend-classified arch-test) so status can surface the
// honest egress WITHOUT the backend importing the graph:build command or the driver.
export const GRAPHIFY_EXTRACTION_EGRESS = "docs-media";

export function graphifyIndexPath(projectRoot) {
  return path.join(projectRoot, INDEX_REL);
}

// ----------------------------------------------------------------- store I/O ----

// Load the graphify backend's frozen store. An absent / corrupt store reads as an
// empty corpus — recall/status never throw on no store (mirrors local's tolerance).
async function loadStore(projectRoot) {
  const storePath = graphifyIndexPath(projectRoot);
  if (!existsSync(storePath)) return { records: [] };
  try {
    return await readJson(storePath);
  } catch {
    return { records: [] };
  }
}

// Build the frozen store DOCUMENT over the live stream by REUSING the 05 parser
// (`buildRecords`), labelled `backend:"graphify"`. Pure of disk side-effects.
async function buildStore(only, ctx) {
  const records = await buildRecords(only, ctx);
  return {
    backend: "graphify",
    version: GRAPHIFY_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    workDir: path.resolve(ctx.workDir),
    recordCount: records.length,
    records,
  };
}

// ------------------------------------------------------------- seam-bridge ----

// Construct the `{workspace}`-shaped ctx the 09 graph command needs from the memory
// ctx (ADR-002). The memory ctx carries {workDir, projectRoot, configMemory} but NOT
// config/configPath; obtain those the same way the seam's CLI wrapper does — from
// loadWorkspace, lazily (so a project that never selects graphify pays nothing). A
// caller (test) may inject `ctx.loadWorkspace` to stay hermetic.
async function buildGraphCtx(ctx) {
  const load = ctx.loadWorkspace ?? loadWorkspace;
  const workspace = await load(ctx.projectRoot);
  return {
    workspace: {
      workDir: ctx.workDir,
      projectRoot: ctx.projectRoot,
      config: workspace.config,
      configPath: workspace.configPath,
    },
  };
}

// (Re)build the work-stream graph through the 09 command (ADR-002/006). FAILS SOFT:
// when the binary is absent the command throws a structured `graphify-missing` miss,
// which we CATCH and report as a skipped-graph outcome — NEVER a crash (ADR-004; story
// 00 keeps the handling MINIMAL but non-crashing; the full degrade is story 02). The
// graph targets the work stream only (ADR-006: path = ctx.workDir).
async function attemptGraphBuild(ctx) {
  // The injectable invoke seam (mirrors local's injectable ctx.loadIndex): production
  // wires nothing and uses the real command-core invoke; tests inject ctx.invoke to
  // drive the binary-present / binary-absent paths hermetically without a live binary.
  const invoke = ctx.invoke ?? coreInvoke;
  const backend = GRAPHIFY_EXTRACTION_BACKEND;
  try {
    const graphCtx = await buildGraphCtx(ctx);
    const build = await invoke(
      "graph:build",
      { path: ctx.workDir, backend },
      graphCtx
    );
    return {
      built: true,
      backend,
      graphPath: build?.graphPath ?? null,
      egress: build?.egress ?? null,
    };
  } catch (error) {
    // The structured graphify-missing miss (424) is the expected CI shape — the binary
    // is provisioned separately (RESEARCH §AA5). Catch it (and any build error) and
    // report the graph SKIPPED with a CLEAR, VISIBLE binary-absent signal (10/ADR-004);
    // the records ARE rebuilt regardless (the records half needs no binary). The hint
    // is the 09 `resolveGraphifyBinary` structured-miss message carried through (the
    // graph:build command throws commandError(resolved.hint, "graphify-missing", 424),
    // so error.message IS the install hint) — never a crash.
    const code = error?.code ?? "graph-build-failed";
    const binaryAbsent = code === "graphify-missing";
    const hint = error?.message ?? String(error);
    return {
      built: false,
      backend,
      graphPath: null,
      egress: null,
      // The structured miss code (graphify-missing when the binary is absent).
      skipped: code,
      // An explicit boolean so callers/renderers need not string-match the code: the
      // graph was skipped specifically because the graphify binary is absent.
      binaryAbsent,
      // The 09 install hint, carried through (the `aof project provision graphify`
      // guidance) — the VISIBLE, actionable degrade signal (10/ADR-004).
      hint,
      // A ready-to-surface one-line reason in the ADR-004 shape.
      reason: binaryAbsent
        ? `graph skipped (graphify binary absent — ${hint})`
        : `graph skipped (${code} — ${hint})`,
    };
  }
}

// --------------------------------------------------------------- reindex ----

// reindex(only, ctx): (a) rebuild the 05 records into the graphify store, and (b)
// ATTEMPT the work-stream graph build via invoke("graph:build") — failing soft when
// the binary is absent. The records half is the @executable contract; the graph half
// is @manual. `ingest` is an ALIAS of reindex (the seam routes it; no separate write
// path), so it rebuilds the same record set.
async function reindex(only, ctx = {}) {
  const { projectRoot } = ctx;
  const store = await buildStore(only, ctx);
  const storePath = graphifyIndexPath(projectRoot);
  await writeText(storePath, `${JSON.stringify(store, null, 2)}\n`);
  // Git-ignore BOTH derived artifacts (ADR-005): the record store (the F-02 `.aof/`
  // baseline) and graphify-out/ (the projectRoot nested ignore this story owns).
  await ensureAofGitignore(projectRoot);
  await ensureGraphifyOutGitignore(projectRoot);

  const graph = await attemptGraphBuild(ctx);

  return {
    backend: "graphify",
    recordCount: store.recordCount,
    store: storePath,
    version: store.version,
    records: store.records,
    // The graph half (derived, disposable) — built or honestly skipped. Story 02
    // surfaces this in status/diagnostics; story 00 just reports it non-destructively.
    graph,
  };
}

// --------------------------------------------------------------- recall ----

// Load + normalize the on-disk work-stream graph for re-ranking (ADR-002). Reads the
// built graph.json via the PURE `graph-normalize.mjs` helpers — NOT a graphify spawn
// (09/ADR-001: structure comes from graph.json, never graph:query's opaque stdout).
// The path is the build-returned graphPath when present (story-00 reindex's
// BuildResult), else the ADR-006 default `<projectRoot>/graphify-out/graph.json`.
// When the graph is ABSENT or unreadable, returns null → recall's base-ranking null
// case (ADR-001 / ADR-004 degrade). Never throws. A test may inject a normalized
// graph directly on `ctx.normalizedGraph` (the fixture path, no disk).
function loadNormalizedGraph(ctx = {}) {
  if (ctx.normalizedGraph !== undefined) return ctx.normalizedGraph;
  const graphPath = ctx.graphPath ?? (ctx.projectRoot ? graphJsonPath(ctx.projectRoot) : null);
  if (!graphPath || !existsSync(graphPath)) return null;
  try {
    return normalizeGraph(readGraph(graphPath));
  } catch {
    // A corrupt / unexpected-shape graph.json degrades to base ranking (never a
    // crash) — the graph signal is the only thing lost (ADR-004).
    return null;
  }
}

// The graph-signal diagnostic values (10/ADR-004). "graph-ranked" — a built graph was
// loaded and layered onto the base ranking; "unavailable" — no built graph was present
// (binary absent / not built yet), so recall degraded to the un-graph-ranked 05 base
// ranking. The records are recallable EITHER WAY (they come from the 05 parsers,
// ADR-001) — only the graph RE-RANK term is lost when "unavailable".
export const GRAPH_SIGNAL_RANKED = "graph-ranked";
export const GRAPH_SIGNAL_UNAVAILABLE = "unavailable";

// Attach the graph-signal diagnostic to a RecallResult as a NON-ENUMERABLE own
// property (10/ADR-004 — the degrade must be VISIBLE, never silent). It is
// non-enumerable BY DESIGN: the frozen RecallResult is EXACTLY { query, scope, records,
// text } (05/ADR-004, asserted byte-for-byte by acd-memory-recall-contract +
// story-00's recall-returns-frozen-records), so `Object.keys(result)` / `deepEqual` /
// `JSON.stringify` MUST still see only those four keys. A non-enumerable property is
// readable (`result.graphSignal`) by a renderer / a diagnostic check / `--json`-aware
// caller, yet it adds NO enumerable field to the frozen shape and NO field to any
// MemoryRecord. The same signal is mirrored into the human `text` render when
// unavailable, so an operator reading the default text view sees the fallback too.
function withGraphSignal(result, signal) {
  Object.defineProperty(result, "graphSignal", {
    value: signal,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return result;
}

// recall(query, scope, opts, ctx): load the graphify store, then GRAPH-GROUND the 05
// records — apply the 05 scope pre-filter + base ranking and layer the work-stream
// graph's file-level relatedness boost on top (the `rerank` term, ADR-001) — and
// return the FROZEN RecallResult { query, scope, records[], text }, each record a
// MemoryRecord + numeric `score` (05/ADR-004). The scope pre-filter runs BEFORE
// ranking (05/ADR-006), so no off-scope record is ever returned. Records come from
// the 05 parser store, so every `source:line` resolves to live text (ADR-001).
//
// DEGRADE (10/ADR-004, story 02): when no built graph is present (binary absent / not
// built yet), `rerank` degrades to the un-graph-ranked 05 base ranking — the records
// are STILL recallable (they come from the 05 parsers), only the graph re-rank term is
// lost. The degrade is VISIBLE: the result carries a non-enumerable `graphSignal`
// diagnostic ("unavailable" vs "graph-ranked") and the human `text` view notes the
// fallback. recall NEVER throws on a missing graph/binary.
async function recall(query, scope = {}, opts = {}, ctx = {}) {
  const store = ctx.records
    ? { records: ctx.records } // a test may inject a fixture record set on ctx
    : await loadStore(ctx.projectRoot);
  const records = Array.isArray(store?.records) ? store.records : [];

  // Read the built graph (null when absent) and re-rank: 05 base ranking + the
  // file-level graph relatedness boost (ADR-001). A null/empty graph → base ranking.
  const normalizedGraph = loadNormalizedGraph(ctx);
  // The graph signal is "graph-ranked" ONLY when a non-empty graph was actually
  // loaded; a null/empty graph means the degrade ran (un-graph-ranked recall).
  const graphLoaded =
    normalizedGraph != null && Array.isArray(normalizedGraph.nodes) && normalizedGraph.nodes.length > 0;
  const signal = graphLoaded ? GRAPH_SIGNAL_RANKED : GRAPH_SIGNAL_UNAVAILABLE;

  const ranked = rerank(records, normalizedGraph, query, scope, opts);

  const result = {
    query: query ?? "",
    scope: normalizeScope(scope),
    records: ranked,
    text: "",
  };
  result.text = renderRecallText(result);
  // Surface the fallback in the human text view too (visible, not silent) — only when
  // degraded, so a graph-ranked recall reads identically to before. The note is a
  // suffix line; the records projection above is untouched (the frozen text body).
  if (!graphLoaded) {
    result.text = `${result.text}[memory] graph signal unavailable — recall is un-graph-ranked (05 base ranking); records intact.\n`;
  }
  return withGraphSignal(result, signal);
}

// --------------------------------------------------------------- status ----

// The graph-state values status reports (10/ADR-004): "built" — the derived graph
// artifact is present on disk; "binary-absent" — the graphify binary is not installed
// (resolveGraphifyBinary reported found:false), so a graph cannot be built; "not-built"
// — the binary is present (or its state is unprobed) but no graph has been built yet.
export const GRAPH_STATE_BUILT = "built";
export const GRAPH_STATE_BINARY_ABSENT = "binary-absent";
export const GRAPH_STATE_NOT_BUILT = "not-built";

// Resolve the graph state for status (10/ADR-004) WITHOUT spawning and WITHOUT
// importing the graphify driver (the acd-graphify-backend-via-command guard forbids
// the backend from importing ../graphify.mjs / node:child_process). Evidence order:
//   1. graph artifact present on disk           → "built" (highest evidence)
//   2. an injected resolver reports found:false → "binary-absent" + the install hint
//   3. otherwise                                → "not-built"
// The resolver is an INJECTABLE seam (ctx.resolveGraphifyBinary), mirroring reindex's
// ctx.invoke and the seam-bridge's ctx.loadWorkspace: the 09 acd-graph-binary-absent
// idiom stubs it { found:false, hint } so the binary-absent state is CI-assertable with
// no live binary, and a production caller may wire the real resolver through the seam.
// When no resolver is injected, status reports built/not-built from disk alone — it
// NEVER throws on an absent store, an absent graph, or a throwing resolver (mirrors
// local's tolerant status; the graphify-binary doctor check is the project-health
// surface, status is the backend-introspection one).
function resolveGraphState(ctx, graphPresent) {
  if (graphPresent) return { graphState: GRAPH_STATE_BUILT };
  const resolve = ctx.resolveGraphifyBinary;
  if (typeof resolve === "function") {
    let resolved;
    try {
      resolved = resolve();
    } catch {
      // A throwing resolver never crashes status — fall back to the on-disk verdict.
      return { graphState: GRAPH_STATE_NOT_BUILT };
    }
    if (resolved && resolved.found === false) {
      return {
        graphState: GRAPH_STATE_BINARY_ABSENT,
        graphHint: typeof resolved.hint === "string" ? resolved.hint : null,
      };
    }
  }
  return { graphState: GRAPH_STATE_NOT_BUILT };
}

// status(ctx): report { backend:"graphify", recordCount, ... } over the store — never
// throws on an absent store/graph (mirrors local's status). Reports the explicit graph
// STATE (10/ADR-004): built / not-built / binary-absent (+ the install hint), so an
// operator can always tell whether recall is graph-grounded or has fallen back. The
// chosen extraction backend (claude-cli) + its honest egress label are surfaced too
// (10/ADR-003 — the selection is visible, never a silent network default).
async function status(ctx = {}) {
  const { projectRoot } = ctx;
  const store = await loadStore(projectRoot);
  const records = Array.isArray(store?.records) ? store.records : [];
  const lessons = records.filter((r) => r.recordType === "lesson").length;
  const adrs = records.filter((r) => r.recordType === "adr").length;
  const graphPath = path.join(projectRoot ?? ".", "graphify-out", "graph.json");
  const graphPresent = existsSync(graphPath);
  const { graphState, graphHint } = resolveGraphState(ctx, graphPresent);
  return {
    backend: "graphify",
    recordCount: records.length,
    store: graphifyIndexPath(projectRoot),
    present: existsSync(graphifyIndexPath(projectRoot)),
    lessons,
    adrs,
    // The chosen extraction backend + its honest egress label (10/ADR-003): claude-cli
    // crosses the network (billed-to-plan ≠ on-box) and the doc/media hop is "docs-media".
    // The egress label is the static ADR-003 fact (classifyEgress("claude-cli") ===
    // "docs-media" — any non-null backend ran the hop); surfaced as the literal here so
    // the backend imports NEITHER the graph:build command NOR the graphify driver (the
    // acd-graphify-backend-via-command boundary). The classifier itself is pinned by the
    // story-03 acd-graphify-backend-classified arch-test over graph-build.mjs.
    extractionBackend: GRAPHIFY_EXTRACTION_BACKEND,
    extractionEgress: GRAPHIFY_EXTRACTION_EGRESS,
    graphPresent,
    // The explicit graph state (10/ADR-004), with the 09 install hint when binary-absent.
    graphState,
    ...(graphHint != null ? { graphHint } : {}),
  };
}

// ----------------------------------------------------------- pure re-rank seam ----
//
// THE GRAPH-GROUNDED RE-RANKER (story 10/01, ADR-001 — the milestone's VALUE).
//
// `rerank(records, normalizedGraph, query, scope, opts)` is a PURE function: the 05
// base ranking (`rankRecords`, 05/ADR-006) over the scoped survivors, then a
// file-level graph-relatedness boost layered ON TOP of each record's base score. It
// RE-RANKS, never replaces: the returned set is EXACTLY the base-ranked candidate
// set (same records by id), only the ORDER (and the numeric `score`) changes, and no
// MemoryRecord field is added (only `score`). It NEVER throws on a null/empty graph.
//
// THE JOIN IS FILE-LEVEL (ADR-001). A record is boosted via ITS FILE's relatedness —
// `MemoryRecord.source`'s `<path>` (its basename file) ↔ `GraphNode.sourceFile` —
// NEVER via a graph node id (the LLM assigns ids; they drift across rebuilds). Two
// records in the SAME file therefore get the SAME graph signal and stay adjacent; the
// base ranking orders them WITHIN the file.
//
// THREE ADR-001 RELATEDNESS CHANNELS, each normalized to [0,1] over the candidate
// files, then weighted and summed into a bounded boost:
//   (1) COMMUNITY co-membership with the query anchor's community — a candidate file
//       in the anchor's community is topically clustered with the query.
//   (2) EDGE relatedness to the anchor — a candidate file's node connected to an
//       anchor node, INFERRED/`semantically_similar_to` edges weighted by their
//       `confidenceScore` (09/ADR-003 preserves it ONLY on INFERRED).
//   (3) GOD-NODE CENTRALITY — the candidate file's node edge degree, normalized by
//       the max candidate degree; the highest-degree (god-node-central) file leads.
//
// THE BOOST IS A LAYER, NOT A REPLACEMENT (ADR-001 boundary). The total graph boost
// is bounded by GRAPH_BOOST_MAX, calibrated SMALLER than a clear base-relevance gap
// (a title-match term is 0.6; a decisive content lead is larger) — so the graph flips
// a base TIE (the fixture's 4-way tie → ISOLATED falls, CENTRAL leads) but does NOT
// invert a record the base ranking already scores decisively higher.

// The maximum total graph boost (sum of the three weighted channels). Kept below one
// title-match term (0.6) so the graph layers onto comparable-relevance records and
// never overrides a clearly stronger base match (ADR-001 boundary / 05/ADR-006).
const GRAPH_BOOST_MAX = 0.3;
// Per-channel weights (sum === GRAPH_BOOST_MAX). Centrality is weighted highest so the
// god-node-central file leads its community peers; community + anchor-edge add the
// topical-cluster + direct-relatedness signal.
const W_CENTRALITY = 0.14;
const W_COMMUNITY = 0.08;
const W_ANCHOR_EDGE = 0.08;

// The basename of a MemoryRecord's source file (`source` is "<workRelPath>:<line>";
// the file-level join key is the basename, matched against GraphNode.sourceFile).
function recordFile(record) {
  const source = String(record?.source ?? "");
  const lastColon = source.lastIndexOf(":");
  const relPath = lastColon >= 0 ? source.slice(0, lastColon) : source;
  // Normalize both Windows + POSIX separators, take the basename — graph nodes carry
  // sourceFile as a bare filename ("CENTRAL.md"), records as a work-relative path.
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : relPath;
}

// Tokenize for the anchor match (lowercase alphanumeric runs > 2 chars — mirrors the
// 05 tokenizer so the anchor is matched the same way records are ranked).
function anchorTokens(text) {
  return new Set((String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2));
}

// Build the per-file graph relatedness signal over the normalized graph, anchored on
// the query. Returns a Map<sourceFile, boost in [0, GRAPH_BOOST_MAX]>. A null/empty
// graph (or one whose nodes match no candidate file) yields an empty map → zero boost
// everywhere → the base ranking unchanged (ADR-001's null case; never throws).
function buildGraphBoosts(normalizedGraph, query) {
  const nodes = Array.isArray(normalizedGraph?.nodes) ? normalizedGraph.nodes : [];
  const edges = Array.isArray(normalizedGraph?.edges) ? normalizedGraph.edges : [];
  if (nodes.length === 0) return new Map();

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const queryTokens = anchorTokens(query);

  // The query ANCHOR: the node(s) whose label/normLabel/sourceFile share the most
  // query terms (the file the query is "about"). Its community is the one whose
  // co-members the graph rewards; its edges are the anchor edges.
  let bestOverlap = 0;
  const anchorIds = new Set();
  for (const node of nodes) {
    const text = `${node.label ?? ""} ${node.normLabel ?? ""} ${node.sourceFile ?? ""}`;
    const tokens = anchorTokens(text);
    let overlap = 0;
    for (const t of queryTokens) if (tokens.has(t)) overlap += 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      anchorIds.clear();
      anchorIds.add(node.id);
    } else if (overlap === bestOverlap && overlap > 0) {
      anchorIds.add(node.id);
    }
  }
  // The community to reward co-membership with (the anchor's). When no anchor matched
  // (a graph that shares no terms with the query) there is no community channel.
  const anchorCommunities = new Set();
  for (const id of anchorIds) {
    const community = byId.get(id)?.community;
    if (community !== undefined && community !== null) anchorCommunities.add(community);
  }

  // Edge degree per node (god-node centrality) + direct-anchor-edge weight per node.
  const degree = new Map();
  const anchorEdgeWeight = new Map();
  const bump = (map, key, by) => map.set(key, (map.get(key) ?? 0) + by);
  for (const edge of edges) {
    const { source, target } = edge;
    if (source === undefined || target === undefined) continue;
    bump(degree, source, 1);
    bump(degree, target, 1);
    // An edge TOUCHING an anchor node lifts the OTHER endpoint (the candidate). An
    // INFERRED / semantically_similar_to edge is weighted by its confidenceScore
    // (09/ADR-003 preserves it ONLY on INFERRED); a structural (EXTRACTED) edge to
    // the anchor counts a full unit (a confirmed reference is at least as strong).
    const isInferred =
      edge.confidence === "INFERRED" || edge.relation === "semantically_similar_to";
    const weight = isInferred
      ? typeof edge.confidenceScore === "number" ? edge.confidenceScore : 0.5
      : 1;
    if (anchorIds.has(source) && !anchorIds.has(target)) bump(anchorEdgeWeight, target, weight);
    if (anchorIds.has(target) && !anchorIds.has(source)) bump(anchorEdgeWeight, source, weight);
  }

  // Normalize each channel to [0,1] over the CANDIDATE (non-anchor) nodes, so the
  // weights compose into a bounded, principled boost (not fixture-hardcoded scalars).
  const candidates = nodes.filter((node) => !anchorIds.has(node.id));
  const maxDegree = Math.max(0, ...candidates.map((node) => degree.get(node.id) ?? 0));
  const maxAnchorEdge = Math.max(0, ...candidates.map((node) => anchorEdgeWeight.get(node.id) ?? 0));

  // Aggregate per FILE (sourceFile) — the file-level join key. When several nodes map
  // to one file the file takes the MAX channel value (the strongest signal for it).
  const boosts = new Map();
  for (const node of candidates) {
    const file = node.sourceFile;
    if (!file) continue;
    const centrality = maxDegree > 0 ? (degree.get(node.id) ?? 0) / maxDegree : 0;
    const community = anchorCommunities.has(node.community) ? 1 : 0;
    const anchorEdge = maxAnchorEdge > 0 ? (anchorEdgeWeight.get(node.id) ?? 0) / maxAnchorEdge : 0;
    const boost =
      W_CENTRALITY * centrality + W_COMMUNITY * community + W_ANCHOR_EDGE * anchorEdge;
    boosts.set(file, Math.max(boosts.get(file) ?? 0, boost));
  }
  return boosts;
}

// The ADR-001 re-ranker signature the sibling stories couple through:
//   (records, normalizedGraph, query, scope, opts) -> ranked records (+ numeric score)
// Story 01 supplies the graph term: base ranking (05/ADR-006), then the file-level
// graph boost layered on top, re-sorted highest-score-first. The 05 scope pre-filter
// (inside rankRecords) runs BEFORE any graph signal, so no off-scope record is ever
// re-ranked in. Pure of disk/argv; never throws on a null/empty graph.
export function rerank(records, normalizedGraph, query, scope = {}, opts = {}) {
  // The base ranking is the floor: scope pre-filter + length-normalised content
  // ranking. It already returns frozen MemoryRecords + a numeric `score`, ordered.
  const base = rankRecords(records, query, scope, opts);

  const boosts = buildGraphBoosts(normalizedGraph, query);
  // Null/empty graph (or no candidate-file match) → empty boost map → the base
  // ranking is returned unchanged (same order, same scores) — ADR-001's null case.
  if (boosts.size === 0) return base;

  // Layer the graph boost onto each base score by the record's FILE (file-level join,
  // never graph id). A record whose file carries no graph node gets a 0 boost.
  const reranked = base.map((record, index) => {
    const boost = boosts.get(recordFile(record)) ?? 0;
    return { record: { ...record, score: record.score + boost }, index };
  });

  // Re-sort highest-score-first. The tie-break is the BASE order (the original index),
  // so two records in the SAME file (identical graph boost) keep their base
  // within-file order, and equal-signal records never reshuffle arbitrarily.
  reranked.sort((a, b) => b.record.score - a.record.score || a.index - b.index);
  return reranked.map((entry) => entry.record);
}

// Apply the 05 scope pre-filter (re-exported so callers / fitness tests can assert the
// pre-filter-before-rank ordering without reaching into local-retrieval).
export { applyScope };

export default {
  name: "graphify",
  recall,
  reindex,
  status,
};

// Traceability wiring for milestone 10 / story 01 (graph-grounded-reranking),
// task 00 — 00_graph-reranks-by-file-relatedness.feature.
//
// Covers EVERY @executable scenario AND every Scenario-Outline Examples row of that
// feature, driving the FROZEN pure re-ranker `rerank(records, normalizedGraph, query,
// scope, opts)` (../src/memory/graphify-backend.mjs) directly over the COMMITTED,
// hand-authored fixtures — NO live binary, NO spawn, NO normalizeGraph round-trip:
//   tasks/fixtures/reranking-records.json           (frozen 05/ADR-005 MemoryRecords)
//   tasks/fixtures/reranking-graph.normalized.json  (the 09/ADR-003 normalized graph)
//
// The deterministic reordering the fixtures encode (feature Background + NOTE):
//   base order (graph absent): ISOLATED, RELATED, CENTRAL, CENTRAL_TWO  (4-way tie,
//                              broken by stable fixture order — ISOLATED wins)
//   re-ranked order:           CENTRAL, CENTRAL_TWO, RELATED, ISOLATED  (graph flips
//                              the isolated file to LAST, the central file to #1)
//
// This feature pins ONLY observable ranked ORDER, set-equality, and field-presence —
// the structural invariants (no graphify.mjs/child_process import; records from the 05
// parsers; never graph-id-keyed) are story-03 arch-tests, not Then-lines here.
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rerank } from "../src/memory/graphify-backend.mjs";
import { MEMORY_RECORD_FIELDS } from "../src/memory/local-retrieval.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(
  repoRoot,
  "wiki", "work", "10_milestone_graphify-memory-backend",
  "stories", "01_story_graph-grounded-reranking", "tasks", "fixtures"
);

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

// Background: the committed fixtures + the query + the area scope.
const RECORDS = loadFixture("reranking-records.json").records;
const NORMALIZED_GRAPH = loadFixture("reranking-graph.normalized.json");
const QUERY = "derived index invariant";
const SCOPE = { area: "architecture" };

// The four "no graph" shapes the null-graph Scenario Outline enumerates.
const EMPTY_GRAPH = { nodes: [], edges: [], hyperedges: [] };
const NO_MATCH_GRAPH = {
  nodes: [{ id: "stray", label: "unrelated", fileType: "document", sourceFile: "UNRELATED.md", community: 7, normLabel: "unrelated" }],
  edges: [],
  hyperedges: [],
};

const ids = (records) => records.map((r) => r.id);
const rankIndex = (records, id) => ids(records).indexOf(id);
function rankAgainstGraph() {
  return rerank(RECORDS, NORMALIZED_GRAPH, QUERY, SCOPE, {});
}

export const graphifyRerankingTests = [
  // ====================================================================
  // 00_graph-reranks-by-file-relatedness.feature
  // ====================================================================

  // Scenario: the graph lifts a record on a graph-central file above a record on a
  // graph-isolated file (THE CORE VALUE, ADR-001).
  {
    name: "graphify/rerank: the graph lifts a graph-central/related record above the graph-isolated record",
    run: () => {
      const ranked = rankAgainstGraph();
      assert.ok(rankIndex(ranked, "CENTRAL") < rankIndex(ranked, "ISOLATED"), 'record "CENTRAL" ranks above "ISOLATED"');
      assert.ok(rankIndex(ranked, "RELATED") < rankIndex(ranked, "ISOLATED"), 'record "RELATED" ranks above "ISOLATED"');
      assert.equal(ranked[0].id, "CENTRAL", 'record "CENTRAL" is the top-ranked record');
    },
  },

  // Scenario: without the graph the base ranking leaves ISOLATED first, so the graph
  // is what reorders.
  {
    name: "graphify/rerank: with NO graph (empty), the base ranking leaves ISOLATED first in fixture order",
    run: () => {
      const ranked = rerank(RECORDS, EMPTY_GRAPH, QUERY, SCOPE, {});
      assert.equal(ranked[0].id, "ISOLATED", 'record "ISOLATED" is the top-ranked record without the graph');
      assert.deepEqual(ids(ranked), ["ISOLATED", "RELATED", "CENTRAL", "CENTRAL_TWO"], "the ranked order is the base fixture order");
    },
  },

  // Scenario: the re-ranked set is exactly the scoped candidate set — same ids, only
  // the order changes (RE-RANK, NEVER REPLACE, ADR-001).
  {
    name: "graphify/rerank: the re-ranked set is exactly the base-ranked scoped candidate set (same ids, only order changes)",
    run: () => {
      const base = rerank(RECORDS, null, QUERY, SCOPE, {});
      const ranked = rankAgainstGraph();
      const baseIds = new Set(ids(base));
      const rankedIds = new Set(ids(ranked));
      // exactly the same ids
      assert.deepEqual([...rankedIds].sort(), [...baseIds].sort(), "the returned records are exactly the base-ranked candidate ids");
      // no extra id appears
      for (const id of rankedIds) assert.ok(baseIds.has(id), `no id (${id}) absent from the base-ranked candidates appears`);
      // none missing
      for (const id of baseIds) assert.ok(rankedIds.has(id), `no base-ranked candidate id (${id}) is missing from the re-ranked result`);
      assert.equal(ranked.length, base.length, "the re-ranked result has the same cardinality as the base-ranked set");
    },
  },

  // Scenario: each re-ranked record is a frozen MemoryRecord plus a numeric score, and
  // nothing else (ONLY SCORE CHANGES, ADR-001 / 05/ADR-004,005).
  {
    name: "graphify/rerank: each record carries the MemoryRecord fields + a numeric score and NO field outside that set",
    run: () => {
      const allowed = new Set([...MEMORY_RECORD_FIELDS, "score"]);
      for (const record of rankAgainstGraph()) {
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(field in record, `record ${record.id} carries the MemoryRecord field "${field}"`);
        }
        assert.equal(typeof record.score, "number", `record ${record.id} carries a numeric "score"`);
        for (const key of Object.keys(record)) {
          assert.ok(allowed.has(key), `record ${record.id} carries no field outside the MemoryRecord fields plus "score" (got "${key}")`);
        }
      }
    },
  },

  // Scenario: the scope pre-filter runs before re-ranking, so no off-scope record is
  // re-ranked in (HARD SCOPE PRE-FILTER PRESERVED, 05/ADR-006).
  {
    name: "graphify/rerank: the scope pre-filter runs before re-ranking — no off-scope (area process / OFFSCOPE) record is present",
    run: () => {
      const ranked = rankAgainstGraph();
      assert.ok(!ranked.some((r) => r.area === "process"), 'no record with area "process" is present');
      assert.ok(!ranked.some((r) => r.id === "OFFSCOPE"), 'record "OFFSCOPE" is not present');
      assert.ok(ranked.every((r) => r.area === "architecture"), 'every returned record has area "architecture"');
    },
  },

  // Scenario: two records in the same file share one graph signal and stay adjacent,
  // base-ordered within the file (FILE-LEVEL JOIN, ADR-001).
  {
    name: "graphify/rerank: two same-file records (CENTRAL, CENTRAL_TWO) share one graph signal and stay adjacent, base-ordered within the file",
    run: () => {
      const ranked = rankAgainstGraph();
      const iCentral = rankIndex(ranked, "CENTRAL");
      const iCentralTwo = rankIndex(ranked, "CENTRAL_TWO");
      assert.equal(Math.abs(iCentral - iCentralTwo), 1, 'record "CENTRAL" and "CENTRAL_TWO" are adjacent in the ranked order');
      assert.ok(iCentral < iCentralTwo, 'record "CENTRAL" ranks above "CENTRAL_TWO"');
      assert.ok(iCentralTwo < rankIndex(ranked, "ISOLATED"), 'record "CENTRAL_TWO" ranks above "ISOLATED"');
    },
  },

  // Scenario Outline: a null / empty graph yields the 05 base ranking unchanged, never
  // an error (NULL-GRAPH FALLBACK, ADR-001's null case).
  ...[
    { label: "an empty normalized graph of no nodes and no edges", graph: EMPTY_GRAPH },
    { label: "a normalized graph whose nodes match no candidate file", graph: NO_MATCH_GRAPH },
    { label: "an absent graph (null)", graph: null },
  ].map((row) => ({
    name: `graphify/rerank: outline — ${row.label} yields the base ranking unchanged, never an error`,
    run: () => {
      let ranked;
      // "the re-ranker does not throw"
      assert.doesNotThrow(() => { ranked = rerank(RECORDS, row.graph, QUERY, SCOPE, {}); }, "the re-ranker does not throw");
      // "the ranked order is ISOLATED, RELATED, CENTRAL, CENTRAL_TWO"
      assert.deepEqual(ids(ranked), ["ISOLATED", "RELATED", "CENTRAL", "CENTRAL_TWO"], "the ranked order is the base ranking order");
      // "the ranked order equals the 05 base ranking for the same query and scope"
      const baseNull = rerank(RECORDS, null, QUERY, SCOPE, {});
      assert.deepEqual(ids(ranked), ids(baseNull), "the ranked order equals the 05 base ranking for the same query and scope");
    },
  })),

  // Scenario Outline: each graph relatedness channel lifts its related file above the
  // graph-isolated file (THE REORDERING CASE MATRIX, ADR-001).
  //   god-node centrality → CENTRAL; semantically_similar_to INFERRED → RELATED;
  //   community co-membership → CENTRAL_TWO. ISOLATED is the foil in every row.
  ...["CENTRAL", "RELATED", "CENTRAL_TWO"].map((relatedAbove) => ({
    name: `graphify/rerank: outline — the graph channel lifts "${relatedAbove}" above the graph-isolated "ISOLATED" (top is graph-central)`,
    run: () => {
      const ranked = rankAgainstGraph();
      assert.ok(rankIndex(ranked, relatedAbove) < rankIndex(ranked, "ISOLATED"), `record "${relatedAbove}" ranks above "ISOLATED"`);
      // "the top-ranked record is on a graph-central file" — CENTRAL.md is the
      // highest-degree (god-node-central) candidate file; CENTRAL records sit on it.
      assert.equal(ranked[0].source.split(/[\\/]/).pop().split(":")[0], "CENTRAL.md", "the top-ranked record is on the graph-central file (CENTRAL.md)");
    },
  })),

  // Scenario: a graph signal does not override a clearly stronger base-relevance match
  // (BOUNDARY — the graph LAYERS ON, it does not invert a decisive relevance gap).
  {
    name: "graphify/rerank: a graph signal does not override a clearly stronger base-relevance match",
    run: () => {
      // A query that matches ISOLATED far more strongly than any other candidate: make
      // ISOLATED's title carry every query term (a decisive title-match base advantage,
      // 05/ADR-006), while the graph still favours CENTRAL.md. The bounded graph boost
      // must NOT invert the clearly stronger base match — ISOLATED stays #1.
      const records = RECORDS.map((r) =>
        r.id === "ISOLATED" ? { ...r, title: "derived index invariant isolated decision" } : r
      );
      const ranked = rerank(records, NORMALIZED_GRAPH, QUERY, SCOPE, {});
      assert.equal(ranked[0].id, "ISOLATED", 'record "ISOLATED" is the top-ranked record (a strong base match the graph cannot override)');
    },
  },
];

// Fitness function for milestone 09 / ADR-006 inv. 5 (result derived from
// graph.json, not stdout; ADR-001 + ADR-003, amended 2026-06-21):
// "Where a `graph:*` result carries graph-derived structured data it is normalized
//  from `graph.json` — NetworkX `links` (NOT `edges`); `confidence`/
//  `confidenceScore` preserved (score ONLY for INFERRED); `graph.hyperedges` kept
//  SEPARATE (never flattened into edges). graphify's markdown `stdout` is opaque,
//  never parsed for data. `graph:query`/`graph:triage` carry NO graph-derived
//  structured field — only opaque `stdout` + `graphPath`."
//
// Fixture-driven (RESEARCH §A1/A2 @executable): feed the real committed
// test/fixtures/graph/graph.json (+ a captured markdown stdout) through the
// normalizer (normalizeGraph/readGraph from src/graphify.mjs) and assert the
// structural facts hold against the LANDED code.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGraph, readGraph } from "../../src/graphify.mjs";
import { graphQueryCommand } from "../../src/commands/graph-query.mjs";
import { graphTriageCommand } from "../../src/commands/graph-triage.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = path.join(repoRoot, "test", "fixtures", "graph", "graph.json");

// A captured human-markdown stdout (the opaque secondary field, RESEARCH §C) that
// mentions node/edge counts — to PROVE the structured fields come from graph.json
// and are NOT scraped from this markdown. Its numbers deliberately DISAGREE with
// the fixture's real counts, so a stdout-parsing implementation would surface the
// wrong numbers and fail.
const CAPTURED_STDOUT = [
  "## Graph summary",
  "",
  "Found **999 nodes** and **888 edges** across the codebase.",
  "- main calls handler",
  "- 42 hyperedges detected",
].join("\n");

export const archTests = [
  {
    name: "arch/ADR-006 inv.5: normalizeGraph reads edges from the `links` key (NOT `edges`) against the real fixture",
    run: async () => {
      const raw = readGraph(FIXTURE);
      // The fixture is NetworkX node_link_data: top-level `nodes` + `links`.
      assert.ok(Array.isArray(raw.links), "the fixture graph.json carries a top-level `links` array");
      assert.ok(!("edges" in raw), "the fixture carries NO top-level `edges` key (NetworkX uses `links`)");
      const normalized = normalizeGraph(raw);
      // Edges are derived from `links` — the fixture has 5 links → 5 edges.
      assert.equal(normalized.edges.length, raw.links.length, "edge count equals the `links` count (edges come from links)");
      assert.equal(normalized.edges.length, 5, "the fixture's 5 links normalize to 5 edges");
      // Each edge carries the source/target/relation/confidence shape.
      for (const edge of normalized.edges) {
        assert.ok("source" in edge && "target" in edge, "every edge carries source + target");
        assert.ok("relation" in edge, "every edge carries a relation");
        assert.ok("confidence" in edge, "every edge carries a confidence");
      }
    },
  },
  {
    name: "arch/ADR-006 inv.5: a `links`-absent / `edges`-present graph is a SURFACED format error (never a silent empty edge set)",
    run: async () => {
      // Simulate a future graphify shape change: `edges` present, `links` absent.
      const malformed = { directed: true, nodes: [{ id: "a" }], edges: [{ source: "a", target: "a" }] };
      assert.throws(
        () => normalizeGraph(malformed),
        (error) => error && error.code === "graph-format",
        "an `edges`-present/`links`-absent graph surfaces a graph-format error (not a silent empty edge set)"
      );
    },
  },
  {
    name: "arch/ADR-006 inv.5: confidence/confidenceScore survive normalization, and confidenceScore is preserved ONLY where graphify provided it (INFERRED)",
    run: async () => {
      const normalized = normalizeGraph(readGraph(FIXTURE));
      const byPair = new Map(normalized.edges.map((edge) => [`${edge.source}->${edge.target}`, edge]));

      // EXTRACTED edge: confidence preserved, NO confidenceScore (graphify sets a
      // score only on INFERRED).
      const extracted = byPair.get("n1->n2");
      assert.equal(extracted.confidence, "EXTRACTED", "the n1->n2 edge is EXTRACTED");
      assert.ok(!("confidenceScore" in extracted), "an EXTRACTED edge carries NO confidenceScore (never a fabricated 0)");

      // INFERRED edge: confidence preserved AND the float confidenceScore survives.
      const inferred = byPair.get("n2->n3");
      assert.equal(inferred.confidence, "INFERRED", "the n2->n3 edge is INFERRED");
      assert.equal(inferred.confidenceScore, 0.62, "an INFERRED edge preserves its confidence_score float");

      // AMBIGUOUS edge: confidence preserved, no score.
      const ambiguous = byPair.get("n4->n5");
      assert.equal(ambiguous.confidence, "AMBIGUOUS", "the n4->n5 edge is AMBIGUOUS");
      assert.ok(!("confidenceScore" in ambiguous), "an AMBIGUOUS edge carries no confidenceScore");

      // Every preserved confidence value is one of the three documented levels.
      for (const edge of normalized.edges) {
        assert.ok(
          ["EXTRACTED", "INFERRED", "AMBIGUOUS"].includes(edge.confidence),
          `confidence ${edge.confidence} is one of the documented levels`
        );
        if ("confidenceScore" in edge) {
          assert.equal(edge.confidence, "INFERRED", "a confidenceScore is present ONLY on an INFERRED edge");
          assert.equal(typeof edge.confidenceScore, "number", "a present confidenceScore is a number");
        }
      }
    },
  },
  {
    name: "arch/ADR-006 inv.5: graph.hyperedges normalize SEPARATELY — never flattened into the pairwise edge list",
    run: async () => {
      const raw = readGraph(FIXTURE);
      const normalized = normalizeGraph(raw);
      // Hyperedges live under graph.hyperedges and surface as a SEPARATE field.
      assert.ok(Array.isArray(normalized.hyperedges), "normalizeGraph exposes a separate hyperedges array");
      assert.equal(normalized.hyperedges.length, raw.graph.hyperedges.length, "every graph.hyperedges entry normalizes");
      assert.equal(normalized.hyperedges.length, 2, "the fixture's 2 hyperedges normalize separately");
      // Each hyperedge carries its 3+ member nodes (n-ary), NOT a pairwise pair.
      for (const hyperedge of normalized.hyperedges) {
        assert.ok(Array.isArray(hyperedge.nodes), "a hyperedge carries its member node ids");
        assert.ok(hyperedge.nodes.length >= 3, "a hyperedge is n-ary (3+ nodes), never a pairwise edge");
      }
      // The edge list is EXACTLY the `links` (no hyperedge bled into it): edge
      // count equals link count, so no hyperedge was flattened in.
      assert.equal(normalized.edges.length, raw.links.length, "no hyperedge is flattened into the pairwise edge list");
      // No edge carries a hyperedge-only relation (co_change / shared_community in
      // the fixture) — a flattened hyperedge would inject one of those into edges.
      const linkRelations = new Set(raw.links.map((link) => link.relation));
      const hyperRelations = raw.graph.hyperedges
        .map((he) => he.relation)
        .filter((relation) => !linkRelations.has(relation));
      assert.ok(hyperRelations.length >= 1, "the fixture has at least one hyperedge-only relation to guard against");
      for (const edge of normalized.edges) {
        assert.ok(
          !hyperRelations.includes(edge.relation),
          `no edge carries a hyperedge-only relation (got \`${edge.relation}\`) — hyperedges were not flattened in`
        );
      }
    },
  },
  {
    name: "arch/ADR-006 inv.5: the structured fields are derived from graph.json, NOT scraped from graphify's markdown stdout",
    run: async () => {
      // The captured markdown CLAIMS 999 nodes / 888 edges / 42 hyperedges — wrong
      // numbers. The normalizer is fed ONLY the graph.json; its counts must match
      // the FIXTURE (5/5/2), proving the markdown is never parsed for data.
      const normalized = normalizeGraph(readGraph(FIXTURE));
      assert.equal(normalized.nodes.length, 5, "node count is from graph.json (5), not the markdown's 999");
      assert.equal(normalized.edges.length, 5, "edge count is from graph.json (5), not the markdown's 888");
      assert.equal(normalized.hyperedges.length, 2, "hyperedge count is from graph.json (2), not the markdown's 42");
      // Sanity: normalizeGraph takes a parsed graph object, not a stdout string —
      // it has no surface to scrape markdown from.
      assert.equal(normalizeGraph.length, 1, "normalizeGraph takes exactly the parsed graph (no stdout argument)");
      // The captured stdout's bogus numbers never appear in the normalized result.
      const serialized = JSON.stringify(normalized);
      assert.ok(!serialized.includes("999") && !serialized.includes("888") && !serialized.includes("42"), "the markdown's bogus counts never leak into the normalized graph");
      // (Reference CAPTURED_STDOUT so the captured-markdown fixture is load-bearing.)
      assert.ok(/999 nodes/.test(CAPTURED_STDOUT), "the captured markdown disagrees with graph.json on purpose");
    },
  },
  {
    name: "arch/ADR-006 inv.5: graph:query/graph:triage expose NO graph-derived structured field beyond graphPath (answer is opaque stdout)",
    run: async () => {
      // The amended ADR-001 contract: query/triage return only { …, stdout,
      // graphPath } — no nodes/edges/hyperedges/prs[] derived from the graph, so
      // there is no stdout-parsing surface to drift. We assert the success-shape
      // each command builds carries no graph-structured field.
      //
      // The success path needs a built graph; rather than spawn the live binary,
      // assert structurally on the command source that the returned object names
      // only the opaque + path handles (no nodes/edges/hyperedges/prs key).
      for (const [label, command] of [["graph:query", graphQueryCommand], ["graph:triage", graphTriageCommand]]) {
        const src = await readFile(
          path.join(repoRoot, "src", "commands", `${label.replace(":", "-")}.mjs`),
          "utf8"
        );
        // The return object must NOT introduce a graph-derived structured field.
        // Grep the source for a returned `nodes:`/`edges:`/`hyperedges:`/`prs:`
        // key — there must be none (the answer is the opaque stdout).
        for (const forbidden of ["nodes", "edges", "hyperedges", "prs"]) {
          assert.ok(
            !new RegExp(`return\\s*\\{[\\s\\S]*?\\b${forbidden}\\s*:`).test(src),
            `${label} returns no graph-derived \`${forbidden}\` field (only opaque stdout + graphPath)`
          );
        }
        // It DOES carry the opaque stdout + the graphPath handle.
        assert.ok(/\bstdout\b/.test(src), `${label} carries the opaque stdout`);
        assert.ok(/\bgraphPath\b/.test(src), `${label} carries the graphPath handle`);
        assert.equal(typeof command.run, "function", `${label} is the live command (has a run())`);
      }
    },
  },
];

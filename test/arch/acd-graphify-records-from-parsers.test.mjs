// Fitness function for milestone 10 / ADR-001:
// "The graphify backend's `recall` returns records produced by the 05 markdown
//  parsers (each a frozen `MemoryRecord` with a resolving `source:line`), NEVER
//  records synthesised from `graph.json` nodes; the graph contributes ONLY to
//  `score`. The re-ranker is a PURE function of (records, normalizedGraph, query,
//  scope) that re-ranks-not-replaces: the returned set is exactly the base-ranked
//  candidate set (same record ids), only the ORDER and the numeric `score` change,
//  and NO field is added to a MemoryRecord beyond `score`."
//
// Mirrors the 05 `acd-memory-recall-contract` idiom, applied to the graphify backend.
// Two halves, BOTH CI-able with NO live binary:
//   (a) records-from-the-05-parsers: build the graphify store over a temp .md stream
//       via the REAL backend `reindex` (records ⇐ buildRecords, the 05 parser), then
//       `recall` over it with a committed normalized graph.json injected — assert every
//       returned record carries exactly MEMORY_RECORD_FIELDS + a numeric score, and its
//       `source` (path:line) resolves to live text whose heading NAMES the record id
//       (the F-1 strength; a graph node could only yield <file>:1, never this).
//   (b) graph-contributes-only-to-score: drive the pure re-ranker over the committed
//       fixtures with the graph PRESENT vs ABSENT — the record-id SET is identical
//       (re-rank, never source-from-graph), only score/order differ, and no record
//       carries a field outside MEMORY_RECORD_FIELDS ∪ {score}.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import graphifyBackend, { rerank } from "../../src/memory/graphify-backend.mjs";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_DIR = path.join(
  repoRoot,
  "wiki", "work", "10_milestone_graphify-memory-backend",
  "stories", "01_story_graph-grounded-reranking", "tasks", "fixtures"
);
function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

// A self-authored retro/arch pair so the records genuinely come from the 05 parser and
// every source:line resolves to a real heading line naming the record (R<n>/ADR-NNN).
function retroFor(n) {
  return `---
doc: retrospective
ref: "${n}"
---
# ${n} · Stream ${n} — Retrospective

## R1 — Derived index invariant lesson for milestone ${n}

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** the derived index invariant held in ${n}.
- **Why:** because records trace to source.
- **Lesson:** the distilled derived index invariant gist for ${n}.
`;
}
function archFor(n) {
  return `---
doc: architecture
---
# ${n} · Stream ${n} — Architecture Decisions

## ADR-001: A derived index decision in milestone ${n}

**Status:** Accepted
**Date:** 2026-06-22

**Context.** context for the derived index invariant in ${n}.

**Decision.** the derived index decision gist for ${n}.

**Invariant.** the derived index invariant for ${n}.
`;
}

async function tempStream(milestones = ["00", "01"]) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-records-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  for (const n of milestones) {
    const dir = path.join(workDir, `${n}_milestone_stream-${n}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "RETROSPECTIVE.md"), retroFor(n), "utf8");
    await writeFile(path.join(dir, "ARCHITECTURE.md"), archFor(n), "utf8");
  }
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir };
}

// The CI reality: graphify's binary is absent → graph:build throws graphify-missing.
// reindex catches it and still rebuilds the records (the records half needs no binary).
function missingBinaryInvoke() {
  return async () => {
    const error = new Error("graphify binary not found — run `aof project provision graphify`.");
    error.code = "graphify-missing";
    throw error;
  };
}
function fakeLoadWorkspace(projectRoot) {
  return async () => ({
    config: { name: "demo", resources: [], memory: { backend: "graphify" } },
    configPath: path.join(projectRoot, ".aof", "aof.config.json"),
    projectRoot,
    workDir: path.join(projectRoot, "wiki", "work"),
  });
}

const ids = (records) => records.map((r) => r.id);

export const archTests = [
  {
    name: "arch/graphify-records-from-parsers: recall returns frozen MemoryRecords (exactly MEMORY_RECORD_FIELDS + score) whose source:line resolves to live text naming the record",
    run: async () => {
      const { projectRoot, workDir } = await tempStream(["00", "01"]);
      const ctx = {
        workDir,
        projectRoot,
        configMemory: { backend: "graphify" },
        invoke: missingBinaryInvoke(),
        loadWorkspace: fakeLoadWorkspace(projectRoot),
        // Inject a committed normalized graph so a graph signal IS present (so the test
        // is NOT merely the degrade path) — yet the records still come from the parsers.
        normalizedGraph: loadFixture("reranking-graph.normalized.json"),
      };
      // Records ⇐ the 05 parser (buildRecords), written to the graphify store.
      const reindexed = await graphifyBackend.reindex(null, ctx);
      assert.ok(reindexed.recordCount > 0, "the 05 parser produced records into the graphify store");

      // recall over the store (records loaded from disk, NOT from the graph).
      const result = await graphifyBackend.recall("derived index invariant", { area: "architecture" }, {}, ctx);
      assert.ok(Array.isArray(result.records) && result.records.length > 0, "recall returns a non-empty records array");

      const allowed = new Set([...MEMORY_RECORD_FIELDS, "score"]);
      for (const record of result.records) {
        // Exactly the frozen MemoryRecord fields + a numeric score, and NOTHING else —
        // the graph added no field; the record is not a graph node in disguise.
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(field in record, `record ${record.id} carries the frozen MemoryRecord field "${field}"`);
        }
        assert.equal(typeof record.score, "number", `record ${record.id} carries a numeric score`);
        for (const key of Object.keys(record)) {
          assert.ok(allowed.has(key), `record ${record.id} carries no field outside MEMORY_RECORD_FIELDS ∪ {score} (got "${key}")`);
        }

        // The source:line resolves to LIVE TEXT whose heading NAMES the record id — the
        // 05/ADR-005 spine. A record SYNTHESISED from a graph node could only carry
        // <source_file>:1 (graph nodes have source_location:null), which would NOT name
        // the record at a per-entry heading line. So this assertion structurally proves
        // the records come from the parsers, not the graph.
        const lastColon = record.source.lastIndexOf(":");
        assert.ok(lastColon > 0, `record ${record.id} source has a :line suffix (${record.source})`);
        const relPath = record.source.slice(0, lastColon);
        const lineNo = Number.parseInt(record.source.slice(lastColon + 1), 10);
        assert.ok(Number.isInteger(lineNo) && lineNo >= 1, `record ${record.id} line is a positive int`);
        const absPath = path.join(workDir, relPath);
        assert.ok(existsSync(absPath), `record ${record.id} source file exists: ${relPath}`);
        const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
        assert.ok(lineNo <= lines.length, `record ${record.id} line ${lineNo} within file`);
        assert.ok(
          lines[lineNo - 1].includes(record.id),
          `record ${record.id}'s source line is its own heading (got: "${lines[lineNo - 1]}") — a graph node could only yield <file>:1`
        );
      }
    },
  },
  {
    name: "arch/graphify-records-from-parsers: the graph contributes ONLY to score — the re-ranked id SET is exactly the base set (re-rank, never source-from-graph)",
    run: () => {
      // The pure re-ranker over the committed fixtures: with the graph PRESENT vs the
      // graph NULL, the record-id SET is identical — the graph re-orders/re-scores the
      // 05 records, it never adds, removes, or synthesises a record. (If the graph were
      // the record source, the present-graph set could differ from the null-graph set.)
      const RECORDS = loadFixture("reranking-records.json").records;
      const GRAPH = loadFixture("reranking-graph.normalized.json");
      const QUERY = "derived index invariant";
      const SCOPE = { area: "architecture" };

      const base = rerank(RECORDS, null, QUERY, SCOPE, {});
      const withGraph = rerank(RECORDS, GRAPH, QUERY, SCOPE, {});

      assert.deepEqual(
        [...new Set(ids(withGraph))].sort(),
        [...new Set(ids(base))].sort(),
        "the graph-re-ranked id set is exactly the base-ranked id set (same records, no graph-synthesised record)"
      );
      assert.equal(withGraph.length, base.length, "same cardinality with vs without the graph");

      // The graph DID change something (the order) — otherwise the test would be a
      // tautology that any no-op re-ranker passes. The fixture is designed so the graph
      // flips the base stable-order winner (ISOLATED) to LAST.
      assert.notDeepEqual(ids(withGraph), ids(base), "the graph re-ranks the order (a real, non-tautological signal)");
      assert.equal(withGraph[0].id, "CENTRAL", "the graph lifts the graph-central record to the top");
      assert.equal(base[0].id, "ISOLATED", "without the graph, the base stable order leaves ISOLATED first");

      // Every re-ranked record is still a frozen MemoryRecord + score, nothing else —
      // and every id is one of the input records (no graph node leaked in as a record).
      const inputIds = new Set(ids(RECORDS));
      const allowed = new Set([...MEMORY_RECORD_FIELDS, "score"]);
      for (const record of withGraph) {
        assert.ok(inputIds.has(record.id), `record ${record.id} is one of the 05 input records (not a graph node)`);
        for (const field of MEMORY_RECORD_FIELDS) assert.ok(field in record, `record ${record.id} carries "${field}"`);
        assert.equal(typeof record.score, "number", `record ${record.id} carries a numeric score`);
        for (const key of Object.keys(record)) {
          assert.ok(allowed.has(key), `record ${record.id} carries no field outside MEMORY_RECORD_FIELDS ∪ {score} (got "${key}")`);
        }
      }
    },
  },
];

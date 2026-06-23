// Fitness function for milestone 10 / ADR-004 (the 09 acd-graph-binary-absent idiom,
// applied to the memory backend):
// "With the graphify binary ABSENT (resolveGraphifyBinary stubbed { found:false }, and
//  graph:build throwing the structured `graphify-missing` miss), the graphify backend
//  DEGRADES, never crashes: `recall` / `brief` / `reindex` / `status` all return WITHOUT
//  throwing; `recall` still returns the 05 records (each a frozen MemoryRecord with a
//  resolving `source:line`), un-graph-ranked, plus a VISIBLE diagnostic (`graphSignal`)
//  that the graph signal was unavailable; `reindex` rebuilds the records and skips the
//  graph with a clear binary-absent hint; `status` reports the binary-absent graph state."
//
// HERMETIC (no live binary): the absent state is driven through the backend's injectable
// seams (the 09 idiom of stubbing resolveGraphifyBinary) — `ctx.resolveGraphifyBinary`
// returns { found:false, hint } (status reads it) and `ctx.invoke` throws the structured
// graphify-missing (424) miss graph:build raises when the binary is absent (reindex
// catches it). A reindex first populates the 05 record store (the records half needs no
// binary), so recall/brief have records to degrade over.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import graphifyBackend, {
  GRAPH_SIGNAL_UNAVAILABLE,
  GRAPH_STATE_BINARY_ABSENT,
} from "../../src/memory/graphify-backend.mjs";
import { briefDigest } from "../../src/work-memory.mjs";

const MEMORY_RECORD_KEYS = [
  "recordType", "id", "item", "itemSlug", "title",
  "area", "stage", "kind", "owner", "status", "summary", "text", "source",
];

const INSTALL_HINT = "Run `aof project provision graphify` to install graphify into the managed tool store.";
// The 09 acd-graph-binary-absent idiom: resolveGraphifyBinary reports a STRUCTURED miss.
const ABSENT_RESOLVER = () => ({ found: false, hint: INSTALL_HINT });
// graph:build throws the structured graphify-missing (424) — exactly
// src/commands/graph-build.mjs's commandError(resolved.hint, "graphify-missing", 424).
function missingBinaryInvoke() {
  return async () => {
    const error = new Error(INSTALL_HINT);
    error.code = "graphify-missing";
    error.status = 424;
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

**Decision.** the decision gist for ${n}.

**Invariant.** the invariant for ${n}.
`;
}

async function tempStream(milestones = ["00", "01"]) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-absent-"));
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

// The binary-absent ctx, reachable both ways the verbs need it: reindex's graph:build
// via ctx.invoke (throws graphify-missing) and status's ctx.resolveGraphifyBinary.
function absentCtx(projectRoot) {
  return {
    workDir: path.join(projectRoot, "wiki", "work"),
    projectRoot,
    configMemory: { backend: "graphify" },
    invoke: missingBinaryInvoke(),
    loadWorkspace: fakeLoadWorkspace(projectRoot),
    resolveGraphifyBinary: ABSENT_RESOLVER,
  };
}

// Background: a reindex has populated the 05 record store (the records half needs no
// binary), so recall/brief have records to degrade over — itself a degrade (the graph
// build is skipped), asserted to not throw below.
async function backgroundReindexed(milestones = ["00", "01"]) {
  const { projectRoot, workDir } = await tempStream(milestones);
  const ctx = absentCtx(projectRoot);
  await graphifyBackend.reindex(null, ctx);
  return { projectRoot, workDir, ctx };
}

async function assertSourceResolves(record, workDir) {
  const lastColon = record.source.lastIndexOf(":");
  const relPath = record.source.slice(0, lastColon);
  const line = Number.parseInt(record.source.slice(lastColon + 1), 10);
  const absPath = path.join(workDir, relPath);
  assert.ok(existsSync(absPath), `source file ${relPath} exists for ${record.id}`);
  const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
  assert.ok(line >= 1 && line <= lines.length, `source line ${line} in range for ${record.id}`);
  assert.ok(
    lines[line - 1].includes(record.id),
    `source ${record.source} resolves to live text naming ${record.id} (got: "${lines[line - 1]}")`
  );
}

export const archTests = [
  {
    name: "arch/graphify-binary-absent: recall does NOT throw and still returns the 05 records (frozen, source resolves) un-graph-ranked + a visible graph-unavailable diagnostic",
    run: async () => {
      const { ctx, workDir } = await backgroundReindexed();
      let result;
      await assert.doesNotReject(
        async () => { result = await graphifyBackend.recall("derived index invariant", {}, {}, ctx); },
        "recall never throws when the graphify binary is absent"
      );
      assert.ok(Array.isArray(result.records) && result.records.length > 0, "recall still returns the (non-empty) 05 records");
      for (const record of result.records) {
        for (const key of MEMORY_RECORD_KEYS) {
          assert.ok(key in record, `record ${record.id} carries the frozen MemoryRecord field "${key}"`);
        }
        await assertSourceResolves(record, workDir);
      }
      // The frozen RecallResult shape stays exactly { query, scope, records, text } — the
      // diagnostic is additive (non-enumerable), not a 5th enumerable key.
      assert.deepEqual(Object.keys(result).sort(), ["query", "records", "scope", "text"], "the RecallResult stays exactly { query, scope, records, text }");
      // The VISIBLE degrade diagnostic (ADR-004 — the degrade must not be silent).
      assert.equal(result.graphSignal, GRAPH_SIGNAL_UNAVAILABLE, "the result carries graphSignal=unavailable (the graph signal was unavailable)");
      assert.match(result.text, /graph signal unavailable/i, "the human text view notes the un-graph-ranked fallback");
    },
  },
  {
    name: "arch/graphify-binary-absent: brief does NOT throw and inherits the same degrade — a populated, un-graph-ranked digest",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      // brief is composed seam-side over recall (no separate interface method): reach
      // backend.recall the same way the seam does, then derive the digest.
      let recalled;
      await assert.doesNotReject(
        async () => { recalled = await graphifyBackend.recall("", {}, { limit: Infinity }, ctx); },
        "brief's underlying recall never throws when the binary is absent"
      );
      const digest = briefDigest(recalled.records ?? [], {});
      assert.ok(digest.lessonCount + digest.adrCount > 0, "the brief digest is populated from the un-graph-ranked recall");
      assert.ok(typeof digest.text === "string" && digest.text.length > 0, "the digest renders a non-empty text view");
      assert.equal(recalled.graphSignal, GRAPH_SIGNAL_UNAVAILABLE, "the inherited recall is un-graph-ranked (graphSignal=unavailable)");
    },
  },
  {
    name: "arch/graphify-binary-absent: reindex does NOT throw — records rebuilt, graph skipped with a clear binary-absent hint",
    run: async () => {
      const { projectRoot } = await tempStream(["00", "01"]);
      const ctx = absentCtx(projectRoot);
      let result;
      await assert.doesNotReject(
        async () => { result = await graphifyBackend.reindex(null, ctx); },
        "reindex never throws when the graphify binary is absent"
      );
      assert.equal(result.backend, "graphify", "the result is the graphify backend's");
      assert.ok(result.recordCount > 0, "the record store is rebuilt and non-empty (the records half needs no binary)");
      assert.equal(result.graph.built, false, "the graph build was skipped, not crashed");
      assert.equal(result.graph.binaryAbsent, true, "the skip is flagged binary-absent");
      assert.match(result.graph.hint, /aof project provision/, "the skip carries the install hint (the 09 structured miss)");
      await rm(projectRoot, { recursive: true, force: true });
    },
  },
  {
    name: "arch/graphify-binary-absent: status does NOT throw — reports backend + record count + the binary-absent graph state",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      let result;
      await assert.doesNotReject(
        async () => { result = await graphifyBackend.status(ctx); },
        "status never throws when the graphify binary is absent"
      );
      assert.equal(result.backend, "graphify", 'status reports the backend "graphify"');
      assert.equal(typeof result.recordCount, "number", "status reports a numeric record count");
      assert.equal(result.graphState, GRAPH_STATE_BINARY_ABSENT, "status reports the binary-absent graph state");
      assert.ok(typeof result.graphHint === "string" && /aof project provision/.test(result.graphHint), "status carries the install hint");
    },
  },
  {
    name: "arch/graphify-binary-absent: the degrade is NON-TAUTOLOGICAL — with a graph PRESENT the same recall is graph-ranked (graphSignal flips)",
    run: async () => {
      // Guard against asserting a stub: prove the diagnostic actually tracks the graph
      // state. Re-run recall over the SAME records with a non-empty normalized graph
      // injected — now the signal must be "graph-ranked", not "unavailable". (If recall
      // always reported unavailable, this would fail — so the absent assertion is real.)
      const { ctx } = await backgroundReindexed();
      const graphPresentCtx = {
        ...ctx,
        normalizedGraph: {
          nodes: [{ id: "n1", label: "x", fileType: "document", sourceFile: "RETROSPECTIVE.md", community: 0, normLabel: "x" }],
          edges: [],
          hyperedges: [],
        },
      };
      const ranked = await graphifyBackend.recall("derived index invariant", {}, {}, graphPresentCtx);
      assert.notEqual(ranked.graphSignal, GRAPH_SIGNAL_UNAVAILABLE, "with a graph present the signal is NOT unavailable (the diagnostic tracks the real state)");
      assert.equal(ranked.graphSignal, "graph-ranked", "with a non-empty graph present the signal is graph-ranked");
      assert.doesNotMatch(ranked.text, /graph signal unavailable/i, "the graph-ranked text view carries no unavailable note");
    },
  },
];

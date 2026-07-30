// Traceability wiring for milestone 10 / story 00 (graphify-backend-module),
// task 01 — 01_reindex-rebuilds-records-and-graph.feature.
//
// Covers every @executable scenario of that feature against the REAL graphify backend
// module (../src/memory/graphify-backend.mjs) and the REAL 05 parser (`buildRecords`,
// via the backend's `reindex`). The graph-build half is driven through an INJECTED
// `ctx.invoke` (the backend's seam, mirroring local's injectable `ctx.loadIndex`) so
// the records assertions are HERMETIC: we simulate the CI reality — graphify's binary
// absent → the structured `graphify-missing` miss — and assert `reindex` FAILS SOFT
// (records rebuilt; graph skipped; no crash). `ctx.loadWorkspace` is injected too so
// the seam-bridge never reads a real config off disk.
//
// The @manual scenario ("reindex builds a real work-stream graph through graph:build")
// needs the live binary + a logged-in extraction backend — it is NOT wired here (CI
// cannot run it; RESEARCH §AA5). The `local`-parity scenario rebuilds under BOTH
// backends from the same stream and asserts the SAME set of frozen MemoryRecords.
//
//   01_reindex-rebuilds-records-and-graph.feature
//     — reindex rebuilds the derived records from the work stream (non-empty, frozen,
//       every source resolves)
//     — the graphify records match the records the local backend produces
//     — --item scopes the record rebuild to one milestone
//     — ingest produces the same records as reindex (alias)
//     — reindexing twice from unchanged sources does not grow the store
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import graphifyBackend from "../src/memory/graphify-backend.mjs";
import { graphifyIndexPath, workGraphRoot } from "../src/memory/graphify-backend.mjs";
import { reindex as localReindex, memoryIndexPath } from "../src/memory/local-indexing.mjs";

const MEMORY_RECORD_KEYS = [
  "recordType", "id", "item", "itemSlug", "title",
  "area", "stage", "kind", "owner", "status", "summary", "text", "source",
];

// A self-authored retro/arch pair per milestone — enough to exercise the parser and
// the source:line resolve invariant without depending on the live stream's growth.
function retroFor(n) {
  return `---
doc: retrospective
ref: "${n}"
---
# ${n} · Stream ${n} — Retrospective

## R1 — Lesson one of milestone ${n}

- **Kind:** near-miss · **Area:** tooling · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** something happened in milestone ${n}.
- **Why:** because of a reason.
- **Lesson:** the distilled lesson gist for ${n}.
`;
}

function archFor(n) {
  return `---
doc: architecture
---
# ${n} · Stream ${n} — Architecture Decisions

## ADR-001: A decision in milestone ${n}

**Status:** Accepted
**Date:** 2026-06-22

**Context.** some context for ${n}.

**Decision.** the decision gist for ${n}.

**Invariant.** the invariant for ${n}.
`;
}

// Build a temp NN_milestone_slug tree the parsers scan via listItems. `milestones`
// is a list of two-digit numbers; each gets a RETROSPECTIVE + ARCHITECTURE source.
async function tempStream(milestones) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-reidx-"));
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

// The INJECTED invoke that simulates the CI reality: graphify's binary is ABSENT, so
// graph:build throws the structured graphify-missing miss (exactly what
// src/commands/graph-build.mjs throws via commandError(..., "graphify-missing", 424)).
// The backend must CATCH it and still rebuild the records (FAIL SOFT, ADR-004).
function missingBinaryInvoke() {
  const calls = [];
  return {
    calls,
    invoke: async (id, input, ctx) => {
      calls.push({ id, input, ctx });
      const error = new Error("graphify binary not found — run `aof project provision graphify`.");
      error.code = "graphify-missing";
      error.status = 424;
      throw error;
    },
  };
}

// A no-op loadWorkspace so the seam-bridge never reads a real config off disk.
function fakeLoadWorkspace(projectRoot) {
  return async () => ({
    config: { name: "demo", resources: [], memory: { backend: "graphify" } },
    configPath: path.join(projectRoot, ".aof", "aof.config.json"),
    projectRoot,
    workDir: path.join(projectRoot, "wiki", "work"),
  });
}

// Make a memory ctx for the graphify backend, wiring the injected invoke/loadWorkspace.
function ctxFor(projectRoot, { invoke } = {}) {
  return {
    workDir: path.join(projectRoot, "wiki", "work"),
    projectRoot,
    configMemory: { backend: "graphify" },
    invoke,
    loadWorkspace: fakeLoadWorkspace(projectRoot),
  };
}

function assertFrozenShape(record) {
  for (const key of MEMORY_RECORD_KEYS) {
    assert.ok(key in record, `record ${record.id} has key "${key}"`);
    assert.equal(typeof record[key], "string", `record ${record.id} field "${key}" is a string`);
  }
  assert.ok(["lesson", "adr"].includes(record.recordType), `record ${record.id} recordType is lesson|adr`);
}

// Resolve a record's source (path:line) against a work directory; assert live text
// exists at the recorded 1-based line.
async function assertSourceResolves(record, workDir) {
  const lastColon = record.source.lastIndexOf(":");
  const relPath = record.source.slice(0, lastColon);
  const line = Number.parseInt(record.source.slice(lastColon + 1), 10);
  const absPath = path.join(workDir, relPath);
  assert.ok(existsSync(absPath), `source file ${relPath} exists for ${record.id}`);
  const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
  assert.ok(line >= 1 && line <= lines.length, `source line ${line} in range for ${record.id}`);
  // F-1: the line must trace to LIVE TEXT naming the record (its `## R<n>`/`## ADR-NNN`
  // heading), not merely be in range — the derived-index spine (05/ADR-005).
  assert.ok(
    lines[line - 1].includes(record.id),
    `source ${record.source} traces to live text naming ${record.id} (got: "${lines[line - 1]}")`
  );
}

// The set-equality key for a MemoryRecord (every frozen field, joined) — so two record
// sets are "the same set of frozen MemoryRecords" iff their keyed sets match.
function recordKey(r) {
  return MEMORY_RECORD_KEYS.map((k) => r[k]).join("");
}

export const graphifyReindexTests = [
  // ====================================================================
  // 01_reindex-rebuilds-records-and-graph.feature
  // ====================================================================
  {
    name: "graphify/reindex: rebuilds the derived records from the work stream (non-empty, frozen, source resolves)",
    run: async () => {
      const { projectRoot, workDir } = await tempStream(["00", "01"]);
      const { invoke } = missingBinaryInvoke();
      const result = await graphifyBackend.reindex(null, ctxFor(projectRoot, { invoke }));

      // FAILS SOFT: the command exits 0 (the records half succeeds) even though the
      // binary is absent — the graph was skipped, not crashed.
      assert.equal(result.backend, "graphify", "the result is the graphify backend's");
      assert.ok(result.recordCount > 0, "the rebuilt record store is non-empty");
      assert.equal(result.graph.built, false, "graph build was skipped (binary absent), not crashed");
      assert.equal(result.graph.skipped, "graphify-missing", "the skip carries the structured miss code");

      // The store was written and labelled backend:"graphify" (its OWN path, not local's).
      assert.ok(existsSync(graphifyIndexPath(projectRoot)), "the graphify store was written");
      const store = JSON.parse(await readFile(graphifyIndexPath(projectRoot), "utf8"));
      assert.equal(store.backend, "graphify", "the store is labelled backend:graphify");

      // Every record is a frozen MemoryRecord and every source resolves to live text.
      for (const record of result.records) {
        assertFrozenShape(record);
        await assertSourceResolves(record, workDir);
      }
    },
  },
  {
    name: "graphify/reindex: the graphify records match the records the local backend produces from the same stream",
    run: async () => {
      const { projectRoot } = await tempStream(["00", "01"]);
      const { invoke } = missingBinaryInvoke();

      // Rebuild under graphify (own store) and under local (its own store) from the
      // SAME work stream; the two record SETS must be identical frozen MemoryRecords.
      const graphifyResult = await graphifyBackend.reindex(null, ctxFor(projectRoot, { invoke }));
      const localCtx = { workDir: path.join(projectRoot, "wiki", "work"), projectRoot, configMemory: {} };
      const localResult = await localReindex(null, localCtx);

      // Sanity: the two backends wrote to DIFFERENT store paths (no clobber).
      assert.notEqual(
        graphifyIndexPath(projectRoot),
        memoryIndexPath(projectRoot),
        "graphify writes its own store path, never local's"
      );

      const graphifyKeys = graphifyResult.records.map(recordKey).sort();
      const localKeys = localResult.records.map(recordKey).sort();
      assert.deepEqual(graphifyKeys, localKeys, "the two record sets are the same set of frozen MemoryRecords");
    },
  },
  {
    name: "graphify/reindex: --item scopes the record rebuild to one milestone",
    run: async () => {
      const { projectRoot } = await tempStream(["00", "01"]);
      const { invoke } = missingBinaryInvoke();
      // reindex --item 01 → the seam maps --item to `only`; the backend scopes the
      // rebuild to milestone 01.
      const result = await graphifyBackend.reindex("01", ctxFor(projectRoot, { invoke }));
      assert.ok(result.records.length > 0, "the scoped rebuild is non-empty");
      assert.ok(result.records.every((r) => r.item === "01"), "every record has item 01");
      assert.ok(!result.records.some((r) => r.item === "00"), "no record sourced from milestone 00 is present");
    },
  },
  {
    name: "graphify/reindex: ingest produces the same records as reindex (the alias)",
    run: async () => {
      const { projectRoot } = await tempStream(["00", "01"]);
      const { invoke } = missingBinaryInvoke();
      const ctx = ctxFor(projectRoot, { invoke });
      // ingest is an ALIAS of reindex (the seam routes ingest → backend.reindex); the
      // backend has no separate write path, so a second reindex IS the ingest path.
      const first = await graphifyBackend.reindex(null, ctx);
      const captured = first.records.map(recordKey).sort();
      const ingest = await graphifyBackend.reindex(null, ctx);
      assert.deepEqual(
        ingest.records.map(recordKey).sort(),
        captured,
        "the ingest (alias) record set equals the captured reindex record set"
      );
    },
  },
  {
    name: "graphify/reindex: reindexing twice from unchanged sources does not grow the record store",
    run: async () => {
      const { projectRoot } = await tempStream(["00", "01"]);
      const { invoke } = missingBinaryInvoke();
      const ctx = ctxFor(projectRoot, { invoke });
      const first = await graphifyBackend.reindex(null, ctx);
      const firstCount = first.recordCount;
      const second = await graphifyBackend.reindex(null, ctx);
      assert.equal(second.recordCount, firstCount, "a re-run from unchanged sources does not grow the store");
    },
  },
  {
    name: "graphify/reindex: the graph build is reached through invoke('graph:build') over the work stream with a surfaced backend",
    run: async () => {
      // The ADR-002 integration shape: reindex reaches graphify ONLY via
      // invoke('graph:build'), targeting the work stream (ADR-006), with the extraction
      // backend surfaced (ADR-003, claude-cli). Asserted on the INJECTED invoke's
      // recorded call so no live binary is needed (the spawn itself is @manual).
      const { projectRoot } = await tempStream(["00"]);
      const rig = missingBinaryInvoke();
      await graphifyBackend.reindex(null, ctxFor(projectRoot, { invoke: rig.invoke }));
      const call = rig.calls.find((c) => c.id === "graph:build");
      assert.ok(call, "reindex reached invoke('graph:build')");
      assert.equal(call.input.path, path.join(projectRoot, "wiki", "work"), "the build targets the work stream (ADR-006)");
      assert.equal(call.input.backend, "claude-cli", "the extraction backend is surfaced as claude-cli (ADR-003)");
      // The work-stream graph is pinned to its OWN artifact root, never the projectRoot
      // one the codebase graph occupies (see workGraphRoot).
      assert.equal(
        call.input.outRoot,
        workGraphRoot(projectRoot),
        "the build writes the work-stream graph under its own root, not the projectRoot codebase graph"
      );
      assert.notEqual(call.input.outRoot, projectRoot, "the work-stream graph root is NOT the projectRoot");
      // The seam-bridge constructed a {workspace} ctx (ADR-002) — never the bare memory ctx.
      assert.ok(call.ctx && call.ctx.workspace, "the graph command receives a {workspace}-shaped ctx (the seam-bridge)");
      assert.equal(call.ctx.workspace.projectRoot, projectRoot, "the {workspace} carries the projectRoot the command reads");
    },
  },
  {
    // The eviction regression, end to end. graphify extraction REPLACES the single
    // graph.json under the root it is given, and this backend builds a WORK-DOCUMENT
    // graph over the same repo that `aof graph build` builds a CODE graph for. While
    // both used <projectRoot>/graphify-out/graph.json, a reindex (or an `aof import
    // milestone`, which triggers one) silently replaced a 20k-node code graph with
    // work-item nodes — after which `aof graph impact <file>` answered `present:false`
    // with zero edges, indistinguishable from "this module has no coupling".
    //
    // The injected invoke models the REPLACING write honestly, defaulting to the
    // projectRoot exactly as the pre-fix build did when handed no outRoot — so
    // removing the outRoot from attemptGraphBuild puts the work graph back on top of
    // the code graph and reds this test.
    name: "graphify/reindex: a reindex NEVER evicts the codebase graph (the two graphs have separate artifacts)",
    run: async () => {
      const { projectRoot } = await tempStream(["00"]);

      // A pre-existing CODEBASE graph, exactly where `aof graph build .` leaves one.
      const codeGraphPath = path.join(projectRoot, "graphify-out", "graph.json");
      const codeGraph = `${JSON.stringify({
        nodes: [{ id: "src_auth", source_file: "src/auth.mjs", file_type: "code" }],
        links: [],
      })}\n`;
      await mkdir(path.dirname(codeGraphPath), { recursive: true });
      await writeFile(codeGraphPath, codeGraph, "utf8");

      // An invoke that WRITES like the real replacing extraction does: a work-document
      // graph into <outRoot>/graphify-out/graph.json, falling back to the projectRoot
      // when the caller pins no root (the pre-fix behaviour).
      const calls = [];
      const invoke = async (id, input, ctx) => {
        calls.push({ id, input });
        if (id !== "graph:build") throw new Error(`unexpected invoke: ${id}`);
        const root = input.outRoot ?? ctx.workspace.projectRoot;
        const written = path.join(root, "graphify-out", "graph.json");
        await mkdir(path.dirname(written), { recursive: true });
        await writeFile(
          written,
          `${JSON.stringify({ nodes: [{ id: "spec_m00", file_type: "document" }], links: [] })}\n`,
          "utf8"
        );
        return { graphPath: written, egress: "docs-media" };
      };

      const result = await graphifyBackend.reindex(null, ctxFor(projectRoot, { invoke }));

      assert.ok(result.graph?.built, "the work-stream graph was built");
      assert.equal(
        await readFile(codeGraphPath, "utf8"),
        codeGraph,
        "the codebase graph is byte-identical after a reindex — the work-stream graph did not evict it"
      );
      const workGraphPath = path.join(workGraphRoot(projectRoot), "graphify-out", "graph.json");
      assert.ok(existsSync(workGraphPath), "the work-stream graph landed under its own root");
      assert.match(
        await readFile(workGraphPath, "utf8"),
        /spec_m00/,
        "the work-stream artifact holds the work-document graph"
      );
    },
  },
  {
    // The READ half of the same separation: recall re-ranks against the WORK graph, so a
    // codebase graph sitting at the projectRoot must not be what the signal comes from.
    // Before the split, `loadNormalizedGraph` read <projectRoot>/graphify-out/graph.json
    // — whatever `aof graph build` last wrote — and `status` reported graphPresent:true
    // off the same file, i.e. "recall is graph-grounded" for a graph recall cannot use.
    name: "graphify/status: graphPresent reports the WORK-stream graph, not a codebase graph at the projectRoot",
    run: async () => {
      const { projectRoot } = await tempStream(["00"]);
      await mkdir(path.join(projectRoot, "graphify-out"), { recursive: true });
      await writeFile(
        path.join(projectRoot, "graphify-out", "graph.json"),
        `${JSON.stringify({ nodes: [{ id: "src_auth", file_type: "code" }], links: [] })}\n`,
        "utf8"
      );

      const absent = await graphifyBackend.status(ctxFor(projectRoot, {}));
      assert.equal(
        absent.graphPresent,
        false,
        "a codebase graph at the projectRoot does NOT count as the work-stream graph being present"
      );

      const workGraphPath = path.join(workGraphRoot(projectRoot), "graphify-out", "graph.json");
      await mkdir(path.dirname(workGraphPath), { recursive: true });
      await writeFile(
        workGraphPath,
        `${JSON.stringify({ nodes: [{ id: "spec_m00", file_type: "document" }], links: [] })}\n`,
        "utf8"
      );
      const present = await graphifyBackend.status(ctxFor(projectRoot, {}));
      assert.equal(present.graphPresent, true, "the work-stream graph at its own root IS reported present");
    },
  },
];

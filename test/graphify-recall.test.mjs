// Traceability wiring for milestone 10 / story 00 (graphify-backend-module),
// task 02 — 02_recall-returns-frozen-records.feature.
//
// Covers every @executable scenario AND every Scenario-Outline Examples row of that
// feature against the REAL graphify backend module (../src/memory/graphify-backend.mjs),
// driven through the REAL seam (`runMemory` for the --json projection) and over a store
// the backend's own `reindex` populated from a temp work stream. The graph-build half
// of reindex FAILS SOFT through an injected `ctx.invoke` (binary-absent), so the recall
// shape/provenance assertions need NO live binary — exactly the @executable boundary
// the feature draws (the graph-grounded RE-RANK ORDER is story 01, out of scope here).
//
//   02_recall-returns-frozen-records.feature
//     — recall returns the frozen RecallResult { query, scope, records, text }
//     — each record is a frozen MemoryRecord + numeric score + resolving source
//     — scope pre-filters before ranking (no off-scope record returned)
//     — Outline: a scope flag (--area / --item) narrows recall to that field value
//     — --json emits the structured records array, not the rendered text
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import graphifyBackend from "../src/memory/graphify-backend.mjs";
import { runMemory, resolveConfiguredBackend } from "../src/work-memory.mjs";

const MEMORY_RECORD_KEYS = [
  "recordType", "id", "item", "itemSlug", "title",
  "area", "stage", "kind", "owner", "status", "summary", "text", "source",
];

function retroFor(n) {
  return `---
doc: retrospective
ref: "${n}"
---
# ${n} · Stream ${n} — Retrospective

## R1 — Derived index invariant lesson for milestone ${n}

- **Kind:** near-miss · **Area:** tooling · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** the derived index invariant held for ${n}.
- **Why:** because the records trace to source.
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

**Context.** some context for the derived index invariant in ${n}.

**Decision.** the derived index decision gist for ${n}.

**Invariant.** the derived index invariant for ${n}.
`;
}

async function tempStream(milestones) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-recall-"));
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

function missingBinaryInvoke() {
  return async () => {
    const error = new Error("graphify binary not found.");
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

function ctxFor(projectRoot) {
  return {
    workDir: path.join(projectRoot, "wiki", "work"),
    projectRoot,
    configMemory: { backend: "graphify" },
    invoke: missingBinaryInvoke(),
    loadWorkspace: fakeLoadWorkspace(projectRoot),
  };
}

// Populate the store, then return a ctx the backend's recall reads it through.
async function reindexed(milestones) {
  const { projectRoot, workDir } = await tempStream(milestones);
  const ctx = ctxFor(projectRoot);
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
  // F-1: not just in-range — the line must trace to LIVE TEXT that names the record
  // (the parser sources each record at its `## R<n>` / `## ADR-NNN` heading line, which
  // carries the id). A wrong-but-in-range line (e.g. frontmatter) would fail this.
  assert.ok(
    lines[line - 1].includes(record.id),
    `source ${record.source} traces to live text naming ${record.id} (got: "${lines[line - 1]}")`
  );
}

// Run `aof work memory recall ...` through the REAL seam with the graphify backend
// selected, capturing stdout. Used for the --json projection scenario (the seam owns
// the projection; the backend is unchanged by it).
async function runRecall(argv, ctx) {
  const lines = [];
  const outcome = await runMemory(argv, {
    config: { memory: { backend: "graphify" } },
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (l) => lines.push(l),
  });
  return { outcome, output: lines.join("\n") };
}

export const graphifyRecallTests = [
  // ====================================================================
  // 02_recall-returns-frozen-records.feature
  // ====================================================================
  {
    name: "graphify/recall: returns the frozen RecallResult shape (query, scope, records, text)",
    run: async () => {
      const { ctx } = await reindexed(["00", "01"]);
      const result = await graphifyBackend.recall("derived index invariant", {}, {}, ctx);
      assert.deepEqual(
        Object.keys(result).sort(),
        ["query", "records", "scope", "text"].sort(),
        "top-level keys are exactly query, scope, records, text"
      );
      assert.equal(result.query, "derived index invariant", "query echoes the submitted query");
      assert.ok(Array.isArray(result.records), "records is an array");
      assert.ok(result.records.length > 0, "the populated store yields hits");
    },
  },
  {
    name: "graphify/recall: each record is a frozen MemoryRecord with a numeric score and a resolving source",
    run: async () => {
      const { ctx, workDir } = await reindexed(["00", "01"]);
      const result = await graphifyBackend.recall("derived index invariant", {}, {}, ctx);
      for (const record of result.records) {
        // Frozen MemoryRecord shape: every field present as a string.
        for (const key of MEMORY_RECORD_KEYS) {
          assert.ok(key in record, `record ${record.id} has key "${key}"`);
          assert.equal(typeof record[key], "string", `record ${record.id} field "${key}" is a string`);
        }
        // The ONLY field recall adds (05/ADR-004): a numeric score.
        assert.equal(typeof record.score, "number", `record ${record.id} carries a numeric score`);
        // Provenance resolves (ADR-001): the source points at live text.
        await assertSourceResolves(record, workDir);
      }
    },
  },
  {
    name: "graphify/recall: scope flags pre-filter before ranking, so no off-scope record is returned",
    run: async () => {
      const { ctx } = await reindexed(["00", "01"]);
      // recall "" --item 01 → the scope pre-filter (05/ADR-006) runs BEFORE ranking.
      const result = await graphifyBackend.recall("", { item: "01" }, {}, ctx);
      assert.ok(result.records.length > 0, "the scoped recall yields hits");
      assert.ok(result.records.every((r) => r.item === "01"), "every record returned has item 01");
      assert.ok(!result.records.some((r) => r.item === "00"), "no record sourced from milestone 00 is present");
    },
  },
  // Scenario Outline: a scope flag narrows recall to records carrying that field value.
  //   | flag   | value        | field |
  //   | --area | architecture | area  |
  //   | --item | 01           | item  |
  ...[
    { flag: "area", value: "architecture", field: "area" },
    { flag: "item", value: "01", field: "item" },
  ].map((row) => ({
    name: `graphify/recall: outline — --${row.flag} ${row.value} narrows recall to records with ${row.field}=${row.value}`,
    run: async () => {
      const { ctx } = await reindexed(["00", "01"]);
      const unscoped = await graphifyBackend.recall("", {}, {}, ctx);
      const result = await graphifyBackend.recall("", { [row.field]: row.value }, {}, ctx);
      assert.ok(result.records.length > 0, `the --${row.flag} ${row.value} recall yields hits`);
      for (const record of result.records) {
        if (row.field === "item") {
          assert.equal(record.item, row.value, `record has item ${row.value}`);
        } else {
          assert.ok(String(record[row.field]).includes(row.value), `record ${row.field} matches ${row.value}`);
        }
      }
      // F-2: the scope is a HARD pre-filter (05/ADR-006), not a soft signal — it must
      // genuinely DROP off-scope records, symmetric with the dedicated --item scenario.
      // The unscoped recall over the 00+01 stream carries records this value excludes
      // (other milestones' records for --item; the area=tooling lessons for --area),
      // so the scoped set must be strictly smaller.
      assert.ok(
        result.records.length < unscoped.records.length,
        `--${row.flag} ${row.value} excluded off-scope records (${result.records.length} < ${unscoped.records.length})`
      );
    },
  })),
  {
    name: "graphify/recall: --json emits the structured records array, not the rendered text",
    run: async () => {
      const { ctx } = await reindexed(["00", "01"]);
      const { outcome, output } = await runRecall(["recall", "derived index invariant", "--json"], ctx);
      assert.equal(outcome.exitCode, 0, "the command exits 0");
      const parsed = JSON.parse(output);
      assert.ok(Array.isArray(parsed), "stdout parses as a JSON array");
      assert.ok(parsed.length > 0, "the array carries records");
      for (const record of parsed) {
        for (const key of MEMORY_RECORD_KEYS) {
          assert.ok(key in record, `the JSON record has the MemoryRecord field "${key}"`);
        }
        assert.equal(typeof record.score, "number", "each JSON record carries a numeric score");
      }
      // The rendered text view (the human projection) is NOT what --json emits.
      assert.ok(!output.includes("hit(s)"), "stdout does not contain the rendered text view");
    },
  },
];

// Integration coverage for milestone 05 (work-memory): the REAL wired stack —
// seam → backend registry (a lazy dynamic import of the `local` glue) → local
// backend → on-disk index — exercised through `runMemory` exactly as the CLI does.
//
// The isolated story suites each prove their half against a stub/fixture (that is
// what made them parallelise); this file closes the seam NONE of them cross: the
// configured `local` backend, resolved through the real registry, reindexing the
// real stream to a temp store and answering recall/brief/status/ingest. It also
// retires the indexing suite's tautological "ingest == reindex" assertion by
// driving `ingest` through the actual verb here.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { runMemory, resolveConfiguredBackend } from "../src/work-memory.mjs";
import { memoryIndexPath } from "../src/memory/local-indexing.mjs";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const WORK_DIR = path.join(REPO_ROOT, "wiki", "work");
const CONFIG = { memory: { backend: "local" } };

// A run harness mirroring `workMemoryCommand`: the REAL registry (so `local` is a
// genuine lazy import of the glue), a temp projectRoot (so the derived index and
// the .gitignore mutation never touch the repo), the real stream as workDir.
async function runReal(argv) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mem-int-"));
  const out = [];
  const ctx = { workDir: WORK_DIR, projectRoot, configMemory: CONFIG.memory };
  const outcome = await runMemory(argv, {
    config: CONFIG,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (line) => out.push(line)
  });
  return { outcome, output: out.join("\n"), projectRoot, ctx };
}

// Reuse one temp store across a sequence of verbs (reindex then read it back).
async function runRealIn(ctx, argv) {
  const out = [];
  const outcome = await runMemory(argv, {
    config: CONFIG,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (line) => out.push(line)
  });
  return { outcome, output: out.join("\n") };
}

async function freshCtx() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mem-int-"));
  return { workDir: WORK_DIR, projectRoot, configMemory: CONFIG.memory };
}

export const memoryIntegrationTests = [
  {
    name: "memory-integration: reindex through the real registry writes the index and reports a positive count",
    run: async () => {
      const ctx = await freshCtx();
      const { outcome } = await runRealIn(ctx, ["reindex", "--all"]);
      assert.equal(outcome.ok, true, "reindex succeeds");
      assert.ok(existsSync(memoryIndexPath(ctx.projectRoot)), "the derived index was written to the temp store");
      assert.ok(outcome.result.recordCount > 0, "the real stream yields at least one record");
    }
  },
  {
    name: "memory-integration: status (real backend) agrees with the reindex it just built",
    run: async () => {
      const ctx = await freshCtx();
      const reindex = await runRealIn(ctx, ["reindex", "--all"]);
      const status = await runRealIn(ctx, ["status"]);
      assert.equal(status.outcome.result.backend, "local", "status reports the local backend");
      assert.equal(
        status.outcome.result.recordCount,
        reindex.outcome.result.recordCount,
        "status record count matches the index just built"
      );
      assert.equal(
        status.outcome.result.lessons + status.outcome.result.adrs,
        status.outcome.result.recordCount,
        "the lesson/adr split sums to the record count"
      );
    }
  },
  {
    name: "memory-integration: ingest --all (the verb) produces the same index as reindex",
    run: async () => {
      const ctx = await freshCtx();
      await runRealIn(ctx, ["reindex", "--all"]);
      const afterReindex = JSON.parse(await readFile(memoryIndexPath(ctx.projectRoot), "utf8"));
      // Drive the ALIAS through the actual `ingest` verb (not a second reindex call).
      const ingest = await runRealIn(ctx, ["ingest", "--all"]);
      assert.equal(ingest.outcome.ok, true, "ingest succeeds");
      const afterIngest = JSON.parse(await readFile(memoryIndexPath(ctx.projectRoot), "utf8"));
      assert.deepEqual(
        afterIngest.records.map((r) => r.source).sort(),
        afterReindex.records.map((r) => r.source).sort(),
        "ingest reproduces the exact reindex record set"
      );
    }
  },
  {
    name: "memory-integration: recall through the real stack surfaces a prior lesson first (the objective)",
    run: async () => {
      const ctx = await freshCtx();
      await runRealIn(ctx, ["reindex", "--all"]);
      const { outcome } = await runRealIn(ctx, ["recall", "requiring grep fitness function smell", "--limit", "3"]);
      assert.equal(outcome.ok, true);
      assert.ok(outcome.result.records.length > 0, "recall returns hits");
      const top = outcome.result.records[0];
      assert.equal(top.recordType, "lesson", "a distilled lesson ranks #1 for a 'how do I' query (the F1 fix)");
      assert.ok(top.score >= outcome.result.records[outcome.result.records.length - 1].score, "highest-score-first");
    }
  },
  {
    name: "memory-integration: brief through the real stack renders the lesson/adr digest, not a recall dump",
    run: async () => {
      const ctx = await freshCtx();
      await runRealIn(ctx, ["reindex", "--all"]);
      const { outcome, output } = await runRealIn(ctx, ["brief"]);
      assert.equal(outcome.ok, true);
      assert.ok(outcome.result.lessonCount > 0, "the digest counts lessons");
      assert.ok(outcome.result.adrCount > 0, "the digest counts adrs");
      assert.ok(/lesson\(s\), .* adr\(s\)/.test(output), "the rendered text is the digest, not a recall record list");
      assert.ok(!("records" in outcome.result), "brief returns a digest, not a RecallResult records array");
    }
  },
  {
    name: "memory-integration: a bad --limit falls back to the default rather than returning zero/short results",
    run: async () => {
      const ctx = await freshCtx();
      await runRealIn(ctx, ["reindex", "--all"]);
      const bad = await runRealIn(ctx, ["recall", "architecture", "--limit", "abc"]);
      const negative = await runRealIn(ctx, ["recall", "architecture", "--limit", "-1"]);
      assert.ok(bad.outcome.result.records.length > 0, "a non-numeric --limit does not silently return 0 hits");
      assert.ok(bad.outcome.result.records.length <= 5, "it falls back to the default limit of 5");
      assert.ok(negative.outcome.result.records.length > 0, "a negative --limit does not drop the last record to nothing");
    }
  }
];

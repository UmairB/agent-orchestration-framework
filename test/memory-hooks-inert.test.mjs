// Traceability wiring for milestone 05 / story 03 (memory-hooks), task 04
// `04_hooks-inert-when-memory-off.feature` (@executable).
//
// The portability guarantee: with memory.backend "none" (or absent), every read
// and write hook is a SILENT no-op — recall surfaces nothing (an empty block),
// ingest writes nothing (no index file), and every verb exits 0 — so ACD behaves
// identically to a project that never opted in.
//
// Uses the REAL seam (`runMemory` + the REAL backend registry via
// `resolveConfiguredBackend`, which resolves "none"/absent to the no-op backend),
// a temp projectRoot (mkdtemp) so nothing touches the repo, and the actual
// `--block` injection render to prove "no block is injected".
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { runMemory, resolveConfiguredBackend, renderRecallBlock } from "../src/work-memory.mjs";
import { memoryIndexPath } from "../src/memory/local-indexing.mjs";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const WORK_DIR = path.join(REPO_ROOT, "wiki", "work");

// The two memory-off configs (ADR-002: absent memory ≡ { backend: "none" }).
const CONFIGS = {
  none: { memory: { backend: "none" } },
  absent: {} //                              no memory key at all
};

// A run harness mirroring `workMemoryCommand` but with a temp projectRoot so the
// derived-index path (and any .gitignore mutation) can NEVER touch the repo.
// Resolves the backend through the REAL registry, so "none"/absent reach the real
// no-op backend. Captures `log` output so we can assert NOTHING was injected.
async function runInert(config, argv, projectRoot) {
  const out = [];
  const ctx = { workDir: WORK_DIR, projectRoot, configMemory: config?.memory ?? {} };
  const outcome = await runMemory(argv, {
    config,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (line) => out.push(line)
  });
  return { outcome, output: out.join("\n") };
}

async function freshRoot() {
  return mkdtemp(path.join(os.tmpdir(), "aof-mem-inert-"));
}

// The two read-hook commands × the scope each fires with (task 04 Examples:
// refine → architect scope, continue → developer's near-miss scope).
const READ_HOOKS = [
  { command: "refine", argv: (q) => ["recall", q, "--area", "architecture", "--block"] },
  { command: "continue", argv: (q) => ["recall", q, "--kind", "near-miss", "--block"] }
];

export const memoryHooksInertTests = [
  // ===================================================================
  // Scenario Outline: a read hook surfaces nothing under the none backend
  //   (command × { none, absent }) → empty RecallResult, no block injected,
  //   exits 0.
  // ===================================================================
  ...READ_HOOKS.flatMap((hook) =>
    Object.entries(CONFIGS).map(([backend, config]) => ({
      name: `hooks-inert: the ${hook.command} read hook surfaces nothing under backend=${backend}`,
      run: async () => {
        const projectRoot = await freshRoot();
        const { outcome, output } = await runInert(config, hook.argv("content addressed manifest near-miss"), projectRoot);
        // recall returns an empty RecallResult …
        assert.equal(outcome.ok, true, "the hook exits ok");
        assert.equal(outcome.exitCode, 0, "exit 0");
        assert.deepEqual(outcome.result.records, [], "recall returns an empty RecallResult (no records)");
        // … so the injection block is empty (nothing pasted into agent context) …
        assert.equal(renderRecallBlock(outcome.result), "", "no prior-lessons block is rendered");
        // … and the --block render printed NOTHING (an empty block injects nothing).
        assert.equal(output, "", "the command logged no block output");
      }
    }))
  ),

  // ===================================================================
  // Scenario Outline: the write hook writes nothing under the none backend
  //   (× { none, absent }) → recordCount 0, no index file written, accept ok.
  // ===================================================================
  ...Object.entries(CONFIGS).map(([backend, config]) => ({
    name: `hooks-inert: the ingest write hook writes nothing under backend=${backend}`,
    run: async () => {
      const projectRoot = await freshRoot();
      const { outcome } = await runInert(config, ["ingest", "--all"], projectRoot);
      assert.equal(outcome.ok, true, "ingest exits ok (accept succeeds)");
      assert.equal(outcome.exitCode, 0, "exit 0");
      assert.equal(outcome.result.recordCount, 0, "ingest is a no-op reporting recordCount 0");
      // NO index file exists under the temp projectRoot — nothing was written.
      assert.ok(
        !existsSync(memoryIndexPath(projectRoot)),
        "no derived index file was written under the temp projectRoot"
      );
    }
  })),

  // ===================================================================
  // Scenario: with memory off the loop is indistinguishable from ACD without
  //   memory — recall(--block) + ingest + status in sequence on ONE temp
  //   projectRoot with config {} → no block output, no memory file, all exit 0.
  // ===================================================================
  {
    name: "hooks-inert: end-to-end with memory absent — no block, no memory file, all exit 0",
    run: async () => {
      const config = CONFIGS.absent;
      const projectRoot = await freshRoot();

      // read hook (recall --block) surfaces nothing.
      const read = await runInert(config, ["recall", "content addressed manifest", "--area", "architecture", "--block"], projectRoot);
      assert.equal(read.outcome.exitCode, 0, "recall exits 0");
      assert.deepEqual(read.outcome.result.records, [], "recall surfaces no records");
      assert.equal(read.output, "", "recall injects no block");

      // write hook (ingest) writes nothing.
      const write = await runInert(config, ["ingest", "--all"], projectRoot);
      assert.equal(write.outcome.exitCode, 0, "ingest exits 0");
      assert.equal(write.outcome.result.recordCount, 0, "ingest reports recordCount 0");

      // status still answers cleanly (the none backend names itself, zero records).
      const status = await runInert(config, ["status"], projectRoot);
      assert.equal(status.outcome.exitCode, 0, "status exits 0");
      assert.equal(status.outcome.result.recordCount, 0, "status reports zero records");

      // No memory file was created anywhere under the temp projectRoot.
      assert.ok(
        !existsSync(memoryIndexPath(projectRoot)),
        "no memory index file created across the whole sequence"
      );
    }
  }
];

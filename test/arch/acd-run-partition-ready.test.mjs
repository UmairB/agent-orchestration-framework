// Fitness function: acd-run-partition-ready (milestone 19, ADR-002 / fitness #3).
//
// Partition-ready layout: run records are PER-RUN files under runs/, never one
// monolithic aggregate — so milestone 26's <node>/ segment is a pure additive path
// delta (no aggregate file to migrate or rewrite). The run path is built by a SINGLE
// seam (runRecordPath/runsDir) the <node> segment slots into.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN_STORE = new URL("../../src/run-store.mjs", import.meta.url);

export const archTests = [
  {
    name: "arch/run-partition-ready: N runs produce N discrete files under runs/ with no monolithic aggregate",
    async run() {
      // Lazy-import the store INSIDE run() (house discipline R4/m06).
      const { startRun, completeRun } = await import("../../src/run-store.mjs");

      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-partition-"));
      try {
        const workDir = path.join(repo, "wiki", "work");
        const mDir = path.join(workDir, "19_milestone_work-run-lifecycle");
        await mkdir(mDir, { recursive: true });
        const item = { ref: "19", dir: mDir };

        // 20/ADR-006 dedup forbids two non-terminal runs per item — complete each
        // before the next so N discrete per-run files still accrue (partition-ready).
        const N = 5;
        const created = [];
        for (let i = 0; i < N; i += 1) {
          created.push(await startRun(item));
          await completeRun(item, { outcome: "done" });
        }

        const entries = await readdir(path.join(mDir, "runs"));
        // exactly N discrete files, one per run, named by runId
        assert.equal(entries.length, N, `runs/ holds exactly ${N} discrete files (one per run)`);
        const jsonFiles = entries.filter((name) => name.endsWith(".json"));
        assert.equal(jsonFiles.length, N, "every entry is a per-run .json file");
        assert.deepEqual(
          jsonFiles.sort(),
          created.map((r) => `${r.runId}.json`).sort(),
          "each file is named by its run's runId"
        );

        // NO monolithic aggregate: no runs.json (or any combined-log file) exists.
        assert.ok(!entries.includes("runs.json"), "there is no monolithic runs.json aggregate");
        assert.ok(
          !entries.some((name) => name === "runs.json" || name === "log.json" || name === "index.json"),
          "no aggregate/combined-log file alongside the per-run files"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-partition-ready: the run-file path is built by a single seam the <node> segment slots into",
    async run() {
      const source = await readFile(RUN_STORE, "utf8");
      const code = stripComments(source);

      // The ONE run-file path builder is runRecordPath, built from runsDir — the single
      // join site that produces a run-file path. milestone 26's <node>/ segment slots in
      // as join(runsDir(item), node, runId + ".json") — one edit, here.
      const recordPathDefs = [...code.matchAll(/function\s+runRecordPath\s*\(/g)];
      assert.equal(recordPathDefs.length, 1, "runRecordPath is defined exactly once (the single run-file path builder)");

      // runRecordPath builds its path from runsDir(...) + the runId stem — no other
      // function joins a runId into a path.
      assert.ok(
        /runRecordPath[\s\S]*?path\.join\s*\(\s*runsDir\s*\(\s*item\s*\)/.test(code),
        "runRecordPath joins runsDir(item) (the seam the <node> segment slots into)"
      );

      // The only `runId + ".json"` (the run-file stem) appears inside runRecordPath —
      // the single place a run-file name is assembled.
      const stemSites = [...code.matchAll(/runId\s*\+\s*["']\.json["']/g)];
      assert.equal(stemSites.length, 1, "the run-file name is assembled in exactly one place");
    },
  },
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

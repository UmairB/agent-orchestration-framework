// Fitness function: acd-run-record-derived (milestone 19, ADR-002 / fitness #1).
//
// The derived-record invariant: the runs/ log is a DERIVED artifact, never an
// authoritative second copy of item state. Pruning OR rebuilding the runs/ log
// changes NO item's frontmatter status — item frontmatter stays the single source
// of truth.
//
// This test covers the FULL invariant — BOTH (a) prune (delete runs/) AND (b)
// rebuild (start runs again) — not just prune (the explicit m10/R3 lesson: when you
// add a derived artifact that mirrors an existing one, cover the full invariant, not
// just the new-and-obvious case). The record-doc bytes are captured via recordDoc(item)
// (AOF.md-first else SPEC.md — NOT a hard-coded SPEC.md), per the Build note.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordDoc } from "../../src/work.mjs";

export const archTests = [
  {
    name: "arch/run-record-derived: pruning AND rebuilding the runs/ log leaves the item record-doc bytes byte-identical",
    async run() {
      // Lazy-import the store INSIDE run() (house discipline R4/m06): the test must
      // reference src/run-store.mjs without coupling the suite's module graph to it.
      const { startRun, pruneRun, readRuns, completeRun } = await import("../../src/run-store.mjs");

      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-derived-"));
      try {
        const workDir = path.join(repo, "wiki", "work");
        const mDir = path.join(workDir, "19_milestone_work-run-lifecycle");
        await mkdir(mDir, { recursive: true });
        // a NATIVE milestone (no AOF.md) — its record doc resolves to SPEC.md, but we
        // assert the real invariant via recordDoc(item), not a hard-coded filename.
        await writeFile(
          path.join(mDir, "SPEC.md"),
          "---\ntype: milestone\nnumber: 19\nslug: work-run-lifecycle\nstatus: in-progress\ntitle: \"Work-Run Lifecycle\"\ncreated: 2026-06-29\nupdated: 2026-06-29\n---\n# 19 · Work-Run Lifecycle\n",
          "utf8"
        );

        // recordDoc keys off item.type — a milestone resolves AOF.md-first else
        // SPEC.md. The store itself only needs item.dir + item.ref; type is here
        // solely so the test resolves the record doc the real way (not hard-coded).
        const item = { ref: "19", dir: mDir, type: "milestone" };
        const docName = recordDoc(item);
        assert.ok(docName, "the item resolves a record doc via recordDoc(item)");
        const docPath = path.join(mDir, docName);

        // capture the record-doc bytes BEFORE any run activity
        const before = await readFile(docPath, "utf8");

        // create N runs via the store (20/ADR-006 dedup: complete each before the
        // next — many discrete runs over the item's lifetime, none concurrent)
        for (let i = 0; i < 3; i += 1) {
          await startRun(item);
          await completeRun(item, { outcome: "done" });
        }
        assert.equal((await readRuns(item)).length, 3, "three runs persisted");
        const afterCreate = await readFile(docPath, "utf8");
        assert.equal(afterCreate, before, "creating runs leaves the record-doc bytes unchanged");

        // (a) PRUNE — delete every run file (then the whole runs/ dir)
        for (const run of await readRuns(item)) await pruneRun(item, run.runId);
        await rm(path.join(mDir, "runs"), { recursive: true, force: true });
        assert.deepEqual(await readRuns(item), [], "the log is empty after the prune");
        const afterPrune = await readFile(docPath, "utf8");
        assert.equal(afterPrune, before, "PRUNE leaves the record-doc frontmatter byte-identical");

        // (b) REBUILD — start runs again (the directory is wholly regenerable)
        for (let i = 0; i < 2; i += 1) {
          await startRun(item);
          await completeRun(item, { outcome: "done" });
        }
        assert.equal((await readRuns(item)).length, 2, "the log rebuilds from zero");
        const afterRebuild = await readFile(docPath, "utf8");
        assert.equal(afterRebuild, before, "REBUILD leaves the record-doc frontmatter byte-identical");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

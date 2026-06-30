// Traceability wiring for milestone 19 / story 00 — the derived runs/ log.
//
// Covers EVERY @executable scenario in tasks/02_derived-log-lifecycle.feature
// against the REAL src/run-store.mjs in-process. Many-runs-per-item (Issue !=
// Task), ordered reads, absence/emptiness tolerance, file-by-file prune, and
// wipe + regenerate. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RUNID_RE = /^(\d{8}T\d{9}Z)-(\d{4})$/;

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-runstore-log-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workDir };
}

async function milestoneItem(workDir, slug = "work-run-lifecycle") {
  const dir = path.join(workDir, `19_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: "19", dir };
}

async function runFiles(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

// Start N runs in sequence (distinct, ascending runIds). 20/ADR-006 dedup forbids
// two non-terminal runs per item, so each run is COMPLETED (→ done) before the next
// is started — "many discrete runs for one item" (the 19/ADR-002 Issue != Task
// mechanic) over the item's lifetime, not many concurrently in flight. Returns the
// COMPLETED records (the on-disk shape readRuns reads back), so full-record
// assertions compare like with like.
async function startN(startRun, item, n) {
  const { completeRun } = await import("../src/run-store.mjs");
  const out = [];
  for (let i = 0; i < n; i += 1) {
    await startRun(item);
    out.push(await completeRun(item, { outcome: "done" }));
  }
  return out;
}

export const runStoreDerivedLogTests = [
  {
    name: "run-store/02 many triggers produce many discrete runs for one item",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        await startN(startRun, item, 4);
        const files = await runFiles(item);
        assert.equal(files.length, 4, "the runs/ dir contains 4 files");

        const runs = await readRuns(item);
        assert.equal(runs.length, 4, "reading returns 4 records");
        assert.equal(new Set(runs.map((r) => r.runId)).size, 4, "4 distinct runIds");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 reading an item's runs returns them ordered by runId (creation order)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const created = await startN(startRun, item, 3);
        const runs = await readRuns(item);
        const ids = runs.map((r) => r.runId);
        assert.deepEqual(ids, [...ids].sort(), "the 3 records are returned in ascending runId order");
        assert.deepEqual(ids, created.map((r) => r.runId), "that order is the order they were created in");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 reading the runs of an item with no runs/ directory returns an empty history",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        assert.equal(existsSync(path.join(item.dir, "runs")), false, "the item has no runs/ dir");

        let runs;
        let raised = null;
        try {
          runs = await readRuns(item);
        } catch (error) {
          raised = error;
        }
        assert.equal(raised, null, "no error is raised (no thrown ENOENT)");
        assert.deepEqual(runs, [], "I get an empty run history");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 reading the runs of an item with an empty runs/ directory returns an empty history",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        // an existing but empty runs/ dir (e.g. after every run was pruned)
        await mkdir(path.join(item.dir, "runs"), { recursive: true });

        let runs;
        let raised = null;
        try {
          runs = await readRuns(item);
        } catch (error) {
          raised = error;
        }
        assert.equal(raised, null, "no error is raised");
        assert.deepEqual(runs, [], "I get an empty run history");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 pruning one run file removes exactly that run and leaves the others intact",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns, pruneRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const created = await startN(startRun, item, 3);
        const second = created[1];

        await pruneRun(item, second.runId);
        const files = await runFiles(item);
        assert.equal(files.length, 2, "the runs/ dir contains exactly 2 files");

        const runs = await readRuns(item);
        assert.equal(runs.length, 2, "reading returns 2 records");
        assert.ok(!runs.some((r) => r.runId === second.runId), "neither remaining record is the pruned run");
        const remainingIds = runs.map((r) => r.runId);
        assert.ok(remainingIds.includes(created[0].runId) && remainingIds.includes(created[2].runId), "both other runs are still present unchanged");
        // unchanged: their full records match what was created
        const byId = new Map(runs.map((r) => [r.runId, r]));
        assert.deepEqual(byId.get(created[0].runId), created[0], "first run unchanged");
        assert.deepEqual(byId.get(created[2].runId), created[2], "third run unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 pruning the middle run leaves the survivors readable in runId order",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns, pruneRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const created = await startN(startRun, item, 3);
        await pruneRun(item, created[1].runId);
        const runs = await readRuns(item);
        const ids = runs.map((r) => r.runId);
        assert.deepEqual(ids, [...ids].sort(), "the 2 surviving records are in ascending runId order");
        assert.deepEqual(ids, [created[0].runId, created[2].runId], "the first and third created runs are the survivors");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 pruning the only run of an item leaves an empty history",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns, pruneRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const [only] = await startN(startRun, item, 1);
        await pruneRun(item, only.runId);

        let runs;
        let raised = null;
        try {
          runs = await readRuns(item);
        } catch (error) {
          raised = error;
        }
        assert.equal(raised, null, "no error is raised");
        assert.deepEqual(runs, [], "reading returns an empty run history");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 pruning a non-existent runId is a clean no-op that changes nothing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns, pruneRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const created = await startN(startRun, item, 2);
        let raised = null;
        try {
          await pruneRun(item, "20990101T000000000Z-9999");
        } catch (error) {
          raised = error;
        }
        assert.equal(raised, null, "no error is raised pruning a non-existent runId");

        const runs = await readRuns(item);
        assert.equal(runs.length, 2, "reading still returns the same 2 records");
        assert.deepEqual(runs.map((r) => r.runId).sort(), created.map((r) => r.runId).sort(), "both original runs are present unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 wiping runs/ leaves the item readable and the next start regenerates it",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        await startN(startRun, item, 2);
        // delete the whole runs/ directory
        await rm(path.join(item.dir, "runs"), { recursive: true, force: true });
        assert.deepEqual(await readRuns(item), [], "reading returns an empty history after the wipe");

        const newRun = await startRun(item);
        assert.ok(existsSync(path.join(item.dir, "runs")), "the runs/ dir exists again");
        const files = await runFiles(item);
        assert.deepEqual(files, [`${newRun.runId}.json`], "the runs/ dir contains exactly the new run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Craft/robustness (review EDGE-CASE 1): the derived runs/ log tolerates a torn or
    // unparseable run file — a non-atomic write interrupted mid-flight, or an external
    // edit. ADR-002 sells the log as derived + rebuildable + "absence is benign", so one
    // bad file must degrade to ONE missing run, never blind the whole item's history.
    name: "run-store/02 a corrupt run file is skipped and the valid runs still read back",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const created = await startN(startRun, item, 2);
        // plant a torn/corrupt file alongside the two valid runs
        await writeFile(path.join(item.dir, "runs", "20990101T000000000Z-0099.json"), "{ not valid json", "utf8");

        let runs;
        let raised = null;
        try {
          runs = await readRuns(item);
        } catch (error) {
          raised = error;
        }
        assert.equal(raised, null, "a corrupt file does not throw out of readRuns");
        assert.equal(runs.length, 2, "the two VALID runs still read back (the bad file is skipped, not fatal)");
        assert.deepEqual(runs.map((r) => r.runId).sort(), created.map((r) => r.runId).sort(), "exactly the valid runs survive the skip");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/02 a run started after a wipe gets sequence 0000 again",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        await startN(startRun, item, 3);
        await rm(path.join(item.dir, "runs"), { recursive: true, force: true });

        const newRun = await startRun(item);
        const [, , seq] = newRun.runId.match(RUNID_RE);
        assert.equal(seq, "0000", "the new run's <seq> segment is 0000 (seq is positional over the live dir)");
        const files = await runFiles(item);
        assert.deepEqual(files, [`${newRun.runId}.json`], "the runs/ dir contains exactly that one new run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

// Fitness function: acd-run-dedup-no-duplicate (milestone 20, ADR-006 — owning 19/R2b).
//
// The mint path (startRun AND retryRun) rejects a SECOND non-terminal (queued|running)
// run for an item with duplicate-run, minting nothing and leaving the first record
// byte-unchanged. The mint is collision-safe: two mints for the same item at the same
// injected instant get DISTINCT runIds (the seq segment + write-if-absent retry), one
// file each. Behavioural over a controlled runs/.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function makeItem() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-dedup-"));
  const dir = path.join(repo, "wiki", "work", "20_milestone_autonomous-run-resilience");
  await mkdir(path.join(dir, "runs"), { recursive: true });
  return { repo, item: { ref: "20", dir } };
}

async function runFiles(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

async function bytes(item, runId) {
  return readFile(path.join(item.dir, "runs", `${runId}.json`), "utf8");
}

async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}" (got "${caught?.code}")`);
}

export const archTests = [
  {
    name: "arch/run-dedup-no-duplicate: a second startRun while a run is in flight is rejected duplicate-run, minting nothing",
    async run() {
      const { repo, item } = await makeItem();
      try {
        const { startRun } = await import("../../src/run-store.mjs");
        const first = await startRun(item, { now: "2026-06-30T09:00:00.000Z" });
        const before = await bytes(item, first.runId);

        await assertRejectsWithCode(() => startRun(item, { now: "2026-06-30T09:01:00.000Z" }), "duplicate-run");

        assert.deepEqual(await runFiles(item), [`${first.runId}.json`], "exactly one run file remains");
        assert.equal(await bytes(item, first.runId), before, "the existing run record is byte-unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-dedup-no-duplicate: retryRun is also blocked while the item has a non-terminal run in flight",
    async run() {
      const { repo, item } = await makeItem();
      try {
        const { startRun, completeRun, retryRun } = await import("../../src/run-store.mjs");
        // a terminal failed run (the retry target) + a separate in-flight running run
        await startRun(item, { now: "2026-06-30T09:00:00.000Z" });
        await completeRun(item, { outcome: "failed", failureReason: "timeout", now: "2026-06-30T09:01:00.000Z" });
        const running = await startRun(item, { now: "2026-06-30T09:02:00.000Z" });
        const filesBefore = (await runFiles(item)).length;

        await assertRejectsWithCode(() => retryRun(item, { maxAttempts: 3 }), "duplicate-run");
        assert.equal((await runFiles(item)).length, filesBefore, "retryRun minted no new run while one is in flight");
        assert.equal(JSON.parse(await bytes(item, running.runId)).state, "running", "the in-flight run is untouched");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-dedup-no-duplicate: two same-item mints at the identical instant get distinct runIds, one file each",
    async run() {
      const { repo, item } = await makeItem();
      try {
        const { startRun, completeRun } = await import("../../src/run-store.mjs");
        const now = "2026-06-30T09:00:00.000Z";
        const first = await startRun(item, { now });
        await completeRun(item, { outcome: "done", now: "2026-06-30T09:00:30.000Z" });
        const second = await startRun(item, { now }); // SAME injected instant

        assert.notEqual(first.runId, second.runId, "the two same-instant mints get distinct runIds");
        const files = (await runFiles(item)).sort();
        assert.equal(files.length, 2, "two record files, neither overwritten");
        assert.deepEqual(files, [`${first.runId}.json`, `${second.runId}.json`].sort(), "both runIds have their own file");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

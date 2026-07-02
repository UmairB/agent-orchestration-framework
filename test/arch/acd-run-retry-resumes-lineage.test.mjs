// Fitness function: acd-run-retry-resumes-lineage (milestone 20, ADR-003).
//
// A retry RESUMES the prior session on the same lineage; a fresh start does NOT.
// Via the store: start (with a sessionId) → fail (retryable) → retry; the retry
// record carries sessionId = prior.sessionId, attempt = prior.attempt + 1, retryOf =
// prior.runId. A separate startRun carries retryOf null and no prior session. A
// non-retryable / ceiling-exhausted prior → a coded error, NO new run minted, and the
// prior record byte-unchanged (the 19/R4 unaffected-sibling pin).
//
// This file is SHARED with story 01's command path (20/ADR-003) — story 01 appends a
// command-path test object that drives the same lineage through work:run-retry.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function makeItem() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-retry-lineage-"));
  const dir = path.join(repo, "wiki", "work", "20_milestone_autonomous-run-resilience");
  await mkdir(dir, { recursive: true });
  return { repo, item: { ref: "20", dir } };
}

// A FULL fixture repo (config + a 20 milestone SPEC with status in-progress) for the
// COMMAND-PATH test object below: the registry + work:run-* commands need
// loadWorkspace/resolveItemExact to resolve item 20 from a real work stream.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-retry-lineage-cmd-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "20_milestone_autonomous-run-resilience");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8",
  );
  const spec = [
    "---",
    "type: milestone",
    "number: 20",
    "slug: autonomous-run-resilience",
    'title: "Autonomous Run Resilience"',
    "status: in-progress",
    "created: 2026-06-30",
    "updated: 2026-06-30",
    "---",
    "# 20 · Autonomous Run Resilience",
    "",
  ].join("\n");
  await writeFile(path.join(mDir, "SPEC.md"), spec, "utf8");
  return { repo, workDir };
}

async function runFileBytes(item, runId) {
  return readFile(path.join(item.dir, "runs", `${runId}.json`), "utf8");
}

async function runFileCount(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
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
    name: "arch/run-retry-resumes-lineage: a retry record carries the prior session, attempt+1, and retryOf; a fresh start carries neither",
    async run() {
      const { repo, item } = await makeItem();
      try {
        const { startRun, completeRun, retryRun, readRuns } = await import("../../src/run-store.mjs");

        const started = await startRun(item, { sessionId: "sess-arch", now: "2026-06-30T09:00:00.000Z" });
        await completeRun(item, { outcome: "failed", failureReason: "timeout", now: "2026-06-30T09:01:00.000Z" });
        const retry = await retryRun(item, { maxAttempts: 3, now: "2026-06-30T09:02:00.000Z" });

        assert.notEqual(retry.runId, started.runId, "the retry mints a NEW, distinct runId");
        assert.equal(retry.sessionId, "sess-arch", "the retry carries the prior sessionId");
        assert.equal(retry.attempt, 2, "the retry increments attempt to 2");
        assert.equal(retry.retryOf, started.runId, "the retry's retryOf links the prior run");
        assert.equal(retry.state, "running", "the retry is running");

        // a fresh start (on a clean item) carries neither lineage field
        const { repo: repo2, item: item2 } = await makeItem();
        try {
          const fresh = await startRun(item2, { now: "2026-06-30T10:00:00.000Z" });
          assert.equal(fresh.retryOf, null, "a fresh start has retryOf null");
          assert.equal(fresh.attempt, 1, "a fresh start is attempt 1");
          assert.equal(fresh.sessionId, null, "a fresh start carries no prior session");
        } finally {
          await rm(repo2, { recursive: true, force: true });
        }

        // sanity: the lineage chains across the store-read view
        const runs = await readRuns(item);
        assert.equal(runs.length, 2, "the item has the prior + the retry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-retry-resumes-lineage: a non-retryable or ceiling-exhausted prior → a coded error, no new run, prior byte-unchanged",
    async run() {
      const { startRun, completeRun, retryRun } = await import("../../src/run-store.mjs");

      // (a) non-retryable prior (agent_error) → not-retryable
      {
        const { repo, item } = await makeItem();
        try {
          const started = await startRun(item, { now: "2026-06-30T09:00:00.000Z" });
          await completeRun(item, { outcome: "failed", failureReason: "agent_error", now: "2026-06-30T09:01:00.000Z" });
          const before = await runFileBytes(item, started.runId);
          await assertRejectsWithCode(() => retryRun(item, { maxAttempts: 3 }), "not-retryable");
          assert.equal(await runFileCount(item), 1, "no new run minted on not-retryable");
          assert.equal(await runFileBytes(item, started.runId), before, "the prior record is byte-unchanged");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }

      // (b) retryable prior at the ceiling → attempts-exhausted (a distinct code)
      {
        const { repo, item } = await makeItem();
        try {
          const started = await startRun(item, { now: "2026-06-30T09:00:00.000Z" });
          await completeRun(item, { outcome: "failed", failureReason: "timeout", now: "2026-06-30T09:01:00.000Z" });
          const before = await runFileBytes(item, started.runId);
          // the prior is attempt 1; with maxAttempts 1 it is already at the ceiling
          await assertRejectsWithCode(() => retryRun(item, { maxAttempts: 1 }), "attempts-exhausted");
          assert.equal(await runFileCount(item), 1, "no new run minted on attempts-exhausted");
          assert.equal(await runFileBytes(item, started.runId), before, "the prior record is byte-unchanged");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // COMMAND PATH (story 01, 20/ADR-003): the SAME lineage invariant driven end-to-end
  // through the registry — invoke("work:run-retry") resumes the prior session on an
  // incremented, linked lineage, and a non-retryable prior raises a not-retryable coded
  // error. This rides the same import as the store-side objects above (the shared arch-test).
  {
    name: "arch/run-retry-resumes-lineage: the command path (invoke work:run-retry) resumes the lineage and surfaces not-retryable on a non-retryable prior",
    async run() {
      const { loadWorkspace } = await import("../../src/work.mjs");
      const { invoke } = await import("../../src/command-core.mjs");

      // (a) a retryable failed prior → the resumed record carries sessionId/attempt+1/retryOf
      {
        const { repo } = await makeRepo();
        try {
          const ctx = { workspace: await loadWorkspace(repo) };
          const started = await invoke("work:run-start", { ref: "20", sessionId: "sess-cmd" }, ctx);
          await invoke("work:run-complete", { ref: "20", outcome: "failed", reason: "timeout" }, ctx);

          const resumed = await invoke("work:run-retry", { ref: "20" }, ctx);
          assert.notEqual(resumed.runId, started.runId, "the retry mints a NEW, distinct runId");
          assert.equal(resumed.sessionId, "sess-cmd", "the resumed record carries the prior sessionId");
          assert.equal(resumed.attempt, 2, "the resumed record increments attempt to 2");
          assert.equal(resumed.retryOf, started.runId, "the resumed record's retryOf links the prior run");
          assert.equal(resumed.state, "running", "the resumed record is running");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }

      // (b) a non-retryable prior (agent_error) → invoke raises a not-retryable coded error
      {
        const { repo } = await makeRepo();
        try {
          const ctx = { workspace: await loadWorkspace(repo) };
          await invoke("work:run-start", { ref: "20" }, ctx);
          await invoke("work:run-complete", { ref: "20", outcome: "failed", reason: "agent_error" }, ctx);
          await assertRejectsWithCode(() => invoke("work:run-retry", { ref: "20" }, ctx), "not-retryable");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];

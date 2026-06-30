// Traceability wiring for milestone 20 / story 00 — the retry lineage mint.
//
// Covers EVERY @executable scenario in
//   tasks/02_retry-lineage.feature
// exercising the REAL src/run-store.mjs in-process against a temp fixture repo
// (mkdtemp → mkdir → run → rm in finally). One test object per @executable
// scenario (Scenario-Outline rows folded into one entry iterating the rows), each
// name tracing to feature + scenario. node:assert/strict.
//
//   02_retry-lineage.feature — retryRun resolves the prior failed run, consults
//     shouldRetry, and on a yes mints a NEW lineage-linked run (sessionId carried,
//     attempt + 1, retryOf = prior.runId, state running, prior byte-unchanged); a
//     fresh start carries retryOf null + attempt 1; the prior is resolved by runId
//     else the most-recent failed (none → no-retryable-run); a non-retryable or
//     ceiling-exhausted prior is rejected with a distinct coded error minting no
//     run; resuming a retry again chains attempt 1 → 2 → 3 over a real sequence.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-retry-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workDir };
}

async function milestoneItem(workDir, { number = "20", slug = "autonomous-run-resilience" } = {}) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: number, dir };
}

function runFilePath(item, runId) {
  return path.join(item.dir, "runs", `${runId}.json`);
}

async function runFiles(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

async function readFileBytes(item, runId) {
  return readFile(runFilePath(item, runId), "utf8");
}

// Write a failed run-record DIRECTLY (an explicit attempt/sessionId/failureReason
// precondition — the store reads attempt + failureReason off it). The directly-
// written-fixture pattern story 00's notes prescribe.
async function writeFailedRecord(item, { runId, sessionId = null, attempt = 1, failureReason = "timeout", createdAt = "2026-06-29T09:00:00.000Z", retryOf = null } = {}) {
  const runsDir = path.join(item.dir, "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    runId,
    itemRef: item.ref,
    state: "failed",
    attempt,
    outcome: "failed",
    sessionId,
    brief: {},
    createdAt,
    updatedAt: createdAt,
    failureReason,
    heartbeatAt: null,
    retryOf,
    reclaimedAt: null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

async function expectRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}"`);
  return caught;
}

export const runRetryLineageTests = [
  // ── Scenario: retrying a retryable failed run resumes its session on an incremented, linked lineage ──
  {
    name: "run-retry-lineage/02 retrying a retryable failed run resumes its session on an incremented, linked lineage",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { retryRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const prior = await writeFailedRecord(item, { runId: "20260629T090000000Z-0000", sessionId: "sess-7", attempt: 1, failureReason: "timeout" });
        const priorBytesBefore = await readFileBytes(item, prior.runId);

        const retry = await retryRun(item, { now: "2026-06-30T09:00:00.000Z" });
        assert.notEqual(retry.runId, prior.runId, "a new run record is minted with its own distinct runId");
        assert.equal(retry.sessionId, "sess-7", "the new run record sessionId is sess-7 (the prior session)");
        assert.equal(retry.attempt, 2, "the new run record attempt is 2 (prior + 1)");
        assert.equal(retry.retryOf, prior.runId, "the new run record retryOf is the prior run's runId");
        assert.equal(retry.state, "running", "the new run record state is running");

        // the prior run record is left byte-unchanged
        const priorBytesAfter = await readFileBytes(item, prior.runId);
        assert.equal(priorBytesAfter, priorBytesBefore, "the prior run record is left byte-unchanged");
        // two records now exist (the prior failed + the new running)
        assert.equal((await runFiles(item)).length, 2, "the item now has two run records");
        assert.equal((await readRuns(item)).filter((r) => r.state === "running").length, 1, "exactly one is running");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a fresh start carries retryOf null and no prior session ──
  {
    name: "run-retry-lineage/02 a fresh start carries retryOf null and no prior session",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const record = await startRun(item, { now: "2026-06-30T09:00:00.000Z" });
        assert.equal(record.retryOf, null, "the fresh start record retryOf is null");
        assert.equal(record.attempt, 1, "the fresh start record attempt is 1");
        assert.equal(record.sessionId, null, "the fresh start carries no prior session (sessionId null when omitted)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: retryRun resolves the prior run by runId, else the most-recent failed run ──
  {
    name: "run-retry-lineage/02 retryRun resolves the prior run by runId, else the most-recent failed run",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { retryRun, startRun, completeRun } = await import("../src/run-store.mjs");

        // row 1: one failed timeout run, no runId → resumes that run
        {
          const item = await milestoneItem(workDir, { slug: "r-one-failed" });
          const prior = await writeFailedRecord(item, { runId: "20260629T090000000Z-0000", sessionId: "sess-a", failureReason: "timeout" });
          const retry = await retryRun(item, { now: "2026-06-30T09:00:00.000Z" });
          assert.equal(retry.retryOf, prior.runId, "[one failed run, no runId] resumes that run");
        }

        // rows 2 & 3: two failed timeout runs.
        // The older runId → resumes the older run; no runId → resumes the most-recent failed.
        {
          const item = await milestoneItem(workDir, { slug: "r-two-failed-older" });
          const older = await writeFailedRecord(item, { runId: "20260629T080000000Z-0000", sessionId: "sess-old", failureReason: "timeout", createdAt: "2026-06-29T08:00:00.000Z" });
          await writeFailedRecord(item, { runId: "20260629T090000000Z-0000", sessionId: "sess-new", failureReason: "timeout", createdAt: "2026-06-29T09:00:00.000Z" });
          const retry = await retryRun(item, { runId: older.runId, now: "2026-06-30T09:00:00.000Z" });
          assert.equal(retry.retryOf, older.runId, "[two failed runs, older runId] resumes the older run");
          assert.equal(retry.sessionId, "sess-old", "[two failed runs, older runId] carries the older run's session");
        }
        {
          const item = await milestoneItem(workDir, { slug: "r-two-failed-recent" });
          await writeFailedRecord(item, { runId: "20260629T080000000Z-0000", sessionId: "sess-old", failureReason: "timeout", createdAt: "2026-06-29T08:00:00.000Z" });
          const newer = await writeFailedRecord(item, { runId: "20260629T090000000Z-0000", sessionId: "sess-new", failureReason: "timeout", createdAt: "2026-06-29T09:00:00.000Z" });
          const retry = await retryRun(item, { now: "2026-06-30T09:00:00.000Z" });
          assert.equal(retry.retryOf, newer.runId, "[two failed runs, no runId] resumes the most-recent failed run");
          assert.equal(retry.sessionId, "sess-new", "[two failed runs, no runId] carries the most-recent run's session");
        }

        // row 4: no run at all, no runId → no-retryable-run, nothing minted
        {
          const item = await milestoneItem(workDir, { slug: "r-no-run" });
          await expectRejectsWithCode(() => retryRun(item, { now: "2026-06-30T09:00:00.000Z" }), "no-retryable-run");
          assert.equal((await runFiles(item)).length, 0, "[no run at all] nothing is minted");
        }

        // row 5: only a done run, no failed run, no runId → no-retryable-run, nothing minted
        {
          const item = await milestoneItem(workDir, { slug: "r-only-done" });
          await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
          await completeRun(item, { outcome: "done", now: "2026-06-30T08:05:00.000Z" });
          await expectRejectsWithCode(() => retryRun(item, { now: "2026-06-30T09:00:00.000Z" }), "no-retryable-run");
          assert.equal((await runFiles(item)).length, 1, "[only a done run] no new run is minted (only the done run remains)");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: a non-retryable or ceiling-exhausted prior is rejected with a coded error and no new run ──
  {
    name: "run-retry-lineage/02 a non-retryable or ceiling-exhausted prior is rejected with a coded error and no new run",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { retryRun } = await import("../src/run-store.mjs");

        const rows = [
          // a non-retryable reason → not-retryable
          { failureReason: "agent_error", attempt: 1, maxAttempts: 3, error: "not-retryable" },
          { failureReason: "some_other_kind", attempt: 1, maxAttempts: 3, error: "not-retryable" },
          { failureReason: null, attempt: 1, maxAttempts: 3, error: "not-retryable" },
          // a retryable reason at/over the ceiling → attempts-exhausted (codes stay distinct)
          { failureReason: "timeout", attempt: 3, maxAttempts: 3, error: "attempts-exhausted" },
          { failureReason: "runtime_offline", attempt: 4, maxAttempts: 3, error: "attempts-exhausted" },
        ];
        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `rej-${row.error}-${row.failureReason ?? "null"}-${row.attempt}` });
          const prior = await writeFailedRecord(item, { runId: "20260629T090000000Z-0000", attempt: row.attempt, failureReason: row.failureReason });
          const before = await readFileBytes(item, prior.runId);

          await expectRejectsWithCode(() => retryRun(item, { maxAttempts: row.maxAttempts, now: "2026-06-30T09:00:00.000Z" }), row.error);

          // no new run record is minted for the item
          assert.equal((await runFiles(item)).length, 1, `[${row.error}/${row.failureReason}] no new run record is minted`);
          // the prior run record is byte-unchanged
          assert.equal(await readFileBytes(item, prior.runId), before, `[${row.error}/${row.failureReason}] the prior run record is byte-unchanged`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: resuming a retried run again chains the lineage and marches attempt toward the ceiling ──
  {
    name: "run-retry-lineage/02 resuming a retried run again chains the lineage and marches attempt toward the ceiling",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { retryRun, completeRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // attempt 1 (the seed failed run, sessionId sess-9, timeout)
        const first = await writeFailedRecord(item, { runId: "20260629T090000000Z-0000", sessionId: "sess-9", attempt: 1, failureReason: "timeout" });
        // retry → attempt 2 (a NEW running run), then fail it with timeout
        const retry1 = await retryRun(item, { now: "2026-06-30T09:00:00.000Z" });
        assert.equal(retry1.attempt, 2, "the first retry is attempt 2");
        await completeRun(item, { runId: retry1.runId, outcome: "failed", failureReason: "timeout", now: "2026-06-30T09:05:00.000Z" });
        // retry again → attempt 3 (resumes retry1's lineage)
        const retry2 = await retryRun(item, { now: "2026-06-30T10:00:00.000Z" });

        assert.equal(retry2.attempt, 3, "the second retry record attempt is 3");
        assert.equal(retry2.sessionId, "sess-9", "the second retry record sessionId is sess-9 (carried through the chain)");
        // each retry record's retryOf links to the run it resumed
        assert.equal(retry1.retryOf, first.runId, "the first retry's retryOf links to the seed failed run");
        assert.equal(retry2.retryOf, retry1.runId, "the second retry's retryOf links to the first retry");

        const runs = await readRuns(item);
        assert.equal(runs.length, 3, "the lineage is three discrete run records");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

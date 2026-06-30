// Traceability wiring for milestone 20 / story 00 — heartbeat + orphan reclaim.
//
// Covers EVERY @executable scenario in
//   tasks/03_heartbeat-and-reclaim.feature
// exercising the REAL src/run-store.mjs in-process against a temp fixture repo
// (mkdtemp → mkdir → run → rm in finally). One test object per @executable
// scenario (Scenario-Outline rows folded into one entry iterating the rows), each
// name tracing to feature + scenario. node:assert/strict.
//
//   03_heartbeat-and-reclaim.feature — heartbeat bumps heartbeatAt + updatedAt with
//     NO state change; staleness is heartbeatAt-driven (updatedAt fallback when it
//     never beat), strict `>` at the threshold; reclaimStaleRuns force-fails ONLY
//     stale running runs via the legal running → failed edge (runtime_offline +
//     reclaimedAt = now, sessionId preserved), the never-beat fallback included;
//     every live/queued/terminal sibling is byte-unchanged; the scan walks the
//     supplied item list by path (an item not in the list is untouched); an empty
//     or all-healthy scan is a clean no-op.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-hbreclaim-"));
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

async function readFileBytes(item, runId) {
  return readFile(runFilePath(item, runId), "utf8");
}

async function runFiles(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

// Write a run-record DIRECTLY in an arbitrary shape/state (the dedup guard mints no
// queued/second run, and there is no producer for an aged-heartbeat record). The
// directly-written-fixture pattern story 00's notes prescribe.
async function writeRecord(item, overrides) {
  const runsDir = path.join(item.dir, "runs");
  await mkdir(runsDir, { recursive: true });
  const base = {
    runId: "20260630T000000000Z-0000",
    itemRef: item.ref,
    state: "running",
    attempt: 1,
    outcome: null,
    sessionId: null,
    brief: {},
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    failureReason: null,
    heartbeatAt: null,
    retryOf: null,
    reclaimedAt: null,
  };
  const record = { ...base, ...overrides };
  await writeFile(path.join(runsDir, `${record.runId}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

// Subtract `ms` from an ISO instant → an ISO instant `ms` ago.
function isoAgo(nowIso, ms) {
  return new Date(Date.parse(nowIso) - ms).toISOString();
}

export const runHeartbeatReclaimTests = [
  // ── Scenario: heartbeat stamps the running run's liveness without changing its state ──
  {
    name: "run-heartbeat-reclaim/03 heartbeat stamps the running run's liveness without changing its state",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, heartbeat, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const started = await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
        assert.equal(started.heartbeatAt, null, "the run starts with heartbeatAt null");

        const beat = await heartbeat(item, started.runId, { now: "2026-06-30T09:00:00.000Z" });
        assert.equal(beat.heartbeatAt, "2026-06-30T09:00:00.000Z", "heartbeatAt is the supplied now");
        assert.equal(beat.updatedAt, "2026-06-30T09:00:00.000Z", "updatedAt is bumped to the supplied now");
        assert.equal(beat.state, "running", "the state is still running");
        assert.equal(beat.outcome, null, "the outcome is still null");

        const [reloaded] = await readRuns(item);
        assert.equal(reloaded.heartbeatAt, "2026-06-30T09:00:00.000Z", "the stamp persisted to disk");
        assert.equal(reloaded.state, "running", "the persisted state is still running");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: a running run is stale per heartbeatAt, falling back to updatedAt when it never beat ──
  // Staleness is OBSERVED via whether the reclaim scan force-failed the run (the store
  // exposes no isStale; the by-write outcome is the observable per the feature note).
  {
    name: "run-heartbeat-reclaim/03 a running run is stale per heartbeatAt, falling back to updatedAt when it never beat",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { reclaimStaleRuns, readRuns } = await import("../src/run-store.mjs");
        const now = "2026-06-30T12:00:00.000Z";
        const threshold = 60000;

        const rows = [
          // heartbeatAt drives staleness when present (strict > at the boundary)
          { livenessField: "heartbeatAt", age: 30000, staleness: "live" },
          { livenessField: "heartbeatAt", age: 60000, staleness: "live" },
          { livenessField: "heartbeatAt", age: 90000, staleness: "stale" },
          // updatedAt is the fallback for a run that never beat (heartbeatAt null)
          { livenessField: "updatedAt", age: 30000, staleness: "live" },
          { livenessField: "updatedAt", age: 60000, staleness: "live" },
          { livenessField: "updatedAt", age: 90000, staleness: "stale" },
        ];
        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `stale-${row.livenessField}-${row.age}` });
          const stamp = isoAgo(now, row.age);
          // For the heartbeatAt rows, set heartbeatAt to the aged stamp and updatedAt
          // fresh so ONLY heartbeatAt could drive staleness. For the updatedAt rows,
          // leave heartbeatAt null so the fallback drives it.
          if (row.livenessField === "heartbeatAt") {
            await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: stamp, updatedAt: now });
          } else {
            await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: null, updatedAt: stamp });
          }

          await reclaimStaleRuns([item], { now, stalenessThreshold: threshold });
          const [run] = await readRuns(item);
          if (row.staleness === "stale") {
            assert.equal(run.state, "failed", `[${row.livenessField} age ${row.age}] judged stale → force-failed`);
          } else {
            assert.equal(run.state, "running", `[${row.livenessField} age ${row.age}] judged live → left running`);
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: reclaiming a stale running run force-fails it as a retryable, audited reclaim ──
  {
    name: "run-heartbeat-reclaim/03 reclaiming a stale running run force-fails it as a retryable, audited reclaim",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { reclaimStaleRuns, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        const now = "2026-06-30T12:00:00.000Z";

        // a stale running run (heartbeatAt far past the threshold) with sessionId sess-c
        await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", sessionId: "sess-c", heartbeatAt: isoAgo(now, 600000), updatedAt: isoAgo(now, 600000) });

        const reclaimed = await reclaimStaleRuns([item], { now, stalenessThreshold: 60000 });
        assert.equal(reclaimed.length, 1, "exactly one run is reclaimed");
        const [run] = await readRuns(item);
        assert.equal(run.state, "failed", "the run state is failed");
        assert.equal(run.failureReason, "runtime_offline", "the run failureReason is runtime_offline (infra → retryable)");
        assert.equal(run.reclaimedAt, now, "the run reclaimedAt is the now passed to the scan");
        assert.equal(run.sessionId, "sess-c", "the run sessionId is still sess-c (preserved)");
        // the returned entry references the item + the reclaimed run
        assert.equal(reclaimed[0].item, item, "the reclaimed entry carries the item");
        assert.equal(reclaimed[0].run.runId, run.runId, "the reclaimed entry carries the failed run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a never-beat running run past its updatedAt threshold is reclaimed via the fallback ──
  {
    name: "run-heartbeat-reclaim/03 a never-beat running run past its updatedAt threshold is reclaimed via the fallback",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { reclaimStaleRuns, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        const now = "2026-06-30T12:00:00.000Z";

        // never beat (heartbeatAt null) but updatedAt is past the threshold → stale via fallback
        await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: null, updatedAt: isoAgo(now, 600000) });

        await reclaimStaleRuns([item], { now, stalenessThreshold: 60000 });
        const [run] = await readRuns(item);
        assert.equal(run.state, "failed", "the never-beat run is force-failed via the updatedAt fallback");
        assert.equal(run.failureReason, "runtime_offline", "the failureReason is runtime_offline");
        assert.ok(run.reclaimedAt, "the reclaimedAt is set");
        assert.equal(run.reclaimedAt, now, "the reclaimedAt equals the scan's now");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: reclaim leaves every non-stale and every terminal run byte-unchanged ──
  {
    name: "run-heartbeat-reclaim/03 reclaim leaves every non-stale and every terminal run byte-unchanged",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { reclaimStaleRuns, readRuns } = await import("../src/run-store.mjs");
        const now = "2026-06-30T12:00:00.000Z";
        const fresh = isoAgo(now, 1000); // 1s old — well under the threshold
        const stale = isoAgo(now, 600000); // 10min old — well over the threshold

        const kinds = ["fresh-heartbeat running", "queued", "done", "failed", "cancelled"];
        for (const kind of kinds) {
          const item = await milestoneItem(workDir, { slug: `sib-${kind.replace(/\s+/g, "-")}` });
          // the stale running run that WILL be reclaimed
          const staleRun = await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: stale, updatedAt: stale });
          // the sibling that must be byte-unchanged
          const sibling = await writeSibling(item, kind, fresh);
          const siblingBefore = await readFileBytes(item, sibling.runId);

          await reclaimStaleRuns([item], { now, stalenessThreshold: 60000 });

          const runs = await readRuns(item);
          const staleAfter = runs.find((r) => r.runId === staleRun.runId);
          assert.equal(staleAfter.state, "failed", `[${kind}] the stale running run became failed`);
          assert.equal(await readFileBytes(item, sibling.runId), siblingBefore, `[${kind}] the sibling run is byte-unchanged`);
        }

        // build a sibling record of the given kind, distinct runId from the stale run
        async function writeSibling(item, kind, freshStamp) {
          switch (kind) {
            case "fresh-heartbeat running":
              return writeRecord(item, { runId: "20260630T000000000Z-0001", state: "running", heartbeatAt: freshStamp, updatedAt: freshStamp });
            case "queued":
              return writeRecord(item, { runId: "20260630T000000000Z-0001", state: "queued", outcome: null, heartbeatAt: null, updatedAt: freshStamp });
            case "done":
              return writeRecord(item, { runId: "20260630T000000000Z-0001", state: "done", outcome: "done", updatedAt: freshStamp });
            case "failed":
              return writeRecord(item, { runId: "20260630T000000000Z-0001", state: "failed", outcome: "failed", failureReason: "agent_error", updatedAt: freshStamp });
            case "cancelled":
              return writeRecord(item, { runId: "20260630T000000000Z-0001", state: "cancelled", outcome: "cancelled", updatedAt: freshStamp });
            default:
              throw new Error(`unknown sibling kind: ${kind}`);
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: the scan walks the supplied item list by path, scanning each item's runs/ and no others ──
  {
    name: "run-heartbeat-reclaim/03 the scan walks the supplied item list by path, scanning each item's runs/ and no others",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { reclaimStaleRuns, readRuns } = await import("../src/run-store.mjs");
        const now = "2026-06-30T12:00:00.000Z";
        const stale = isoAgo(now, 600000);

        const item20 = await milestoneItem(workDir, { number: "20", slug: "autonomous-run-resilience" });
        const item21 = await milestoneItem(workDir, { number: "21", slug: "board-run-observability" });
        const item19 = await milestoneItem(workDir, { number: "19", slug: "work-run-lifecycle" });

        await writeRecord(item20, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: stale, updatedAt: stale });
        await writeRecord(item21, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: stale, updatedAt: stale });
        await writeRecord(item19, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: stale, updatedAt: stale });
        const item19Before = await readFileBytes(item19, "20260630T000000000Z-0000");

        // scan ONLY item 20 + item 21 — item 19 is not in the list
        await reclaimStaleRuns([item20, item21], { now, stalenessThreshold: 60000 });

        assert.equal((await readRuns(item20))[0].state, "failed", "item 20's stale run became failed");
        assert.equal((await readRuns(item21))[0].state, "failed", "item 21's stale run became failed");
        // item 19, not in the scanned list, is byte-unchanged
        assert.equal(await readFileBytes(item19, "20260630T000000000Z-0000"), item19Before, "item 19's stale run is byte-unchanged because it was not in the scanned list");
        assert.equal((await readRuns(item19))[0].state, "running", "item 19's run is still running (never scanned)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a scan with no stale running run writes nothing and raises nothing ──
  {
    name: "run-heartbeat-reclaim/03 a scan with no stale running run writes nothing and raises nothing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { reclaimStaleRuns, readRuns } = await import("../src/run-store.mjs");
        const now = "2026-06-30T12:00:00.000Z";
        const fresh = isoAgo(now, 1000);

        const item = await milestoneItem(workDir);
        const live = await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: fresh, updatedAt: fresh });
        const done = await writeRecord(item, { runId: "20260630T000000000Z-0001", state: "done", outcome: "done", updatedAt: fresh });
        const liveBefore = await readFileBytes(item, live.runId);
        const doneBefore = await readFileBytes(item, done.runId);

        let reclaimed;
        await assert.doesNotReject(async () => {
          reclaimed = await reclaimStaleRuns([item], { now, stalenessThreshold: 60000 });
        }, "the all-healthy scan raises no error");
        assert.deepEqual(reclaimed, [], "the all-healthy scan reclaims nothing");
        // no run record under item 20 is changed
        assert.equal(await readFileBytes(item, live.runId), liveBefore, "the fresh-heartbeat running run is byte-unchanged");
        assert.equal(await readFileBytes(item, done.runId), doneBefore, "the done run is byte-unchanged");

        // an EMPTY scan is likewise a clean no-op
        const emptyItem = await milestoneItem(workDir, { slug: "empty" });
        let emptyReclaimed;
        await assert.doesNotReject(async () => {
          emptyReclaimed = await reclaimStaleRuns([emptyItem], { now, stalenessThreshold: 60000 });
        }, "an empty scan raises no error");
        assert.deepEqual(emptyReclaimed, [], "an empty scan reclaims nothing");
        assert.deepEqual(await readRuns(emptyItem), [], "the empty item still has no runs");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

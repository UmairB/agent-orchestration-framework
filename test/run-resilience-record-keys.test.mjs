// Traceability wiring for milestone 20 / story 00 — the resilience record keys.
//
// Covers EVERY @executable scenario in
//   tasks/00_resilience-record-keys.feature
// exercising the REAL src/run-store.mjs in-process against a temp fixture repo
// (mkdtemp → mkdir → run → rm in finally). One test object per @executable
// scenario (Scenario-Outline rows folded into one entry iterating the rows), each
// name tracing to feature + scenario. node:assert/strict.
//
//   00_resilience-record-keys.feature — the run record is extended with the four
//     additive resilience keys (failureReason / heartbeatAt / retryOf /
//     reclaimedAt): present + null on a fresh start, exactly the thirteen frozen
//     keys and no others, a legacy nine-key record reads each missing key as null,
//     populated keys round-trip byte-equivalent across a fresh load, each key is
//     set only by its owning mechanic, completing-as-failed records the supplied
//     reason (done/cancelled record null), and an unrecognised reason is recorded
//     verbatim (the classifier fails closed on it, the store never rejects it).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The FOURTEEN frozen schema keys, IN ORDER (26/ADR-001 SUPERSEDES 20/ADR-001's
// thirteen-key freeze): the original nine, then the four additive resilience keys,
// then the one additive partition-provenance key (node). RESILIENCE_KEYS below is
// untouched — the four m20 keys are still the resilience quartet.
const FROZEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt", "node", "resumeAfter"];
// The original nine milestone-19 keys — a legacy record carries only these.
const LEGACY_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt"];
const RESILIENCE_KEYS = ["failureReason", "heartbeatAt", "retryOf", "reclaimedAt"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-reskeys-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workDir };
}

// A milestone item shaped like the row findWork/listItems produce: the store only
// needs item.dir (to build runs/ paths) and item.ref (to stamp itemRef).
async function milestoneItem(workDir, { number = "20", slug = "autonomous-run-resilience" } = {}) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: number, dir };
}

function runFilePath(item, runId) {
  return path.join(item.dir, "runs", `${runId}.json`);
}

// Write a run-record file DIRECTLY (the dedup guard mints no queued/second run; a
// legacy nine-key record has no producer at all) — the directly-written fixture
// pattern story 00's dedup feature note prescribes.
async function writeRecordFile(item, record) {
  const runsDir = path.join(item.dir, "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(path.join(runsDir, `${record.runId}.json`), JSON.stringify(record, null, 2), "utf8");
}

async function runFiles(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

export const runResilienceRecordKeysTests = [
  // ── Scenario: a freshly started run carries the four resilience keys, each present and null ──
  {
    name: "run-resilience-record-keys/00 a freshly started run carries the four resilience keys, each present and null",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const record = await startRun(item);
        for (const key of RESILIENCE_KEYS) {
          assert.ok(key in record, `the run record has a "${key}" key`);
          assert.equal(record[key], null, `the run record "${key}" value is null`);
        }
        // none of the four resilience keys is a nested object — each is a scalar (null
        // here). (typeof null === "object" in JS, so guard the null case explicitly.)
        for (const key of RESILIENCE_KEYS) {
          assert.ok(
            record[key] === null || typeof record[key] !== "object",
            `the "${key}" key is a scalar, not a nested object`
          );
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: a started run carries exactly the thirteen frozen keys and no others ──
  // (folds the "carries a <key> key" outline AND the "no field outside the thirteen" scenario)
  {
    name: "run-resilience-record-keys/00 a started run carries exactly the thirteen frozen keys and no others",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const record = await startRun(item);
        // each of the fourteen enumerated keys is present (the outline rows)
        for (const key of FROZEN_KEYS) {
          assert.ok(key in record, `the run record has a "${key}" key`);
        }
        // and NOTHING else — exactly the fourteen, in order (the no-others scenario)
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "the record carries exactly the fourteen frozen keys, in order, and no field outside them");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: a legacy nine-key record reads each missing resilience key as null ──
  {
    name: "run-resilience-record-keys/00 a legacy nine-key record reads each missing resilience key as null without error",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // a milestone-19 record carries ONLY the nine keys — write it directly (no
        // producer mints a nine-key record now), so reading it forward-compatibly
        // exercises the absence-is-benign normalisation.
        const legacy = {
          runId: "20260629T090000000Z-0000",
          itemRef: "20",
          state: "running",
          attempt: 1,
          outcome: null,
          sessionId: "sess-legacy",
          brief: { note: "from m19" },
          createdAt: "2026-06-29T09:00:00.000Z",
          updatedAt: "2026-06-29T09:00:00.000Z",
        };
        assert.deepEqual(Object.keys(legacy), LEGACY_KEYS, "the seeded fixture has only the nine milestone-19 keys");
        await writeRecordFile(item, legacy);

        let runs;
        // reading it raises no error (each missing-key row)
        await assert.doesNotReject(async () => {
          runs = await readRuns(item);
        }, "reading a legacy nine-key record raises no error");
        assert.equal(runs.length, 1, "the legacy record reads back as one run");
        const [record] = runs;
        for (const key of RESILIENCE_KEYS) {
          assert.equal(record[key], null, `the missing resilience key "${key}" reads as null`);
        }
        // the original nine survive verbatim, and the read normalises to all fourteen keys
        assert.equal(record.sessionId, "sess-legacy", "the original sessionId survives the read");
        assert.deepEqual(record.brief, { note: "from m19" }, "the original brief survives the read");
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "the normalised record carries all fourteen frozen keys");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a record with populated resilience keys round-trips byte-equivalent across a fresh load ──
  {
    name: "run-resilience-record-keys/00 a record with populated resilience keys round-trips byte-equivalent across a fresh store load",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await milestoneItem(workDir);
        const priorRunId = "20260629T080000000Z-0000";
        const heartbeatAt = "2026-06-29T09:15:00.000Z";
        const reclaimedAt = "2026-06-29T09:30:00.000Z";
        // a persisted run whose resilience keys carry real values (write it directly —
        // no single mechanic sets all four at once, this is the durability surface).
        const populated = {
          runId: "20260629T090000000Z-0001",
          itemRef: "20",
          state: "failed",
          attempt: 2,
          outcome: "failed",
          sessionId: "sess-rt",
          brief: { workspace: "/w" },
          createdAt: "2026-06-29T09:00:00.000Z",
          updatedAt: "2026-06-29T09:30:00.000Z",
          failureReason: "timeout",
          heartbeatAt,
          retryOf: priorRunId,
          reclaimedAt,
        };
        await writeRecordFile(item, populated);

        // a FRESH store load (the in-process analogue of a fresh process)
        const fresh = await import("../src/run-store.mjs?fresh-reskeys");
        const runs = await fresh.readRuns(item);
        assert.equal(runs.length, 1, "the populated record reads back as one run");
        const [record] = runs;
        assert.equal(record.failureReason, "timeout", "the reloaded failureReason is timeout");
        assert.equal(record.retryOf, priorRunId, "the reloaded retryOf equals the prior runId, byte-equivalent");
        assert.equal(record.heartbeatAt, heartbeatAt, "the reloaded heartbeatAt equals the persisted instant");
        assert.equal(record.reclaimedAt, reclaimedAt, "the reloaded reclaimedAt equals the persisted instant");
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "the reloaded record carries all fourteen frozen keys");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: each resilience key is set only by its owning mechanic, null otherwise ──
  {
    name: "run-resilience-record-keys/00 each resilience key is set only by its owning mechanic, null otherwise",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, completeRun, readRuns, reclaimStaleRuns } = await import("../src/run-store.mjs");
        const now = "2026-06-30T09:00:00.000Z";

        // each row drives a run to a situation, then asserts (failureReason, reclaimedAt).
        const rows = [
          {
            situation: "a clean completion to done",
            failureReason: null,
            reclaimedAtKind: "null",
            async drive(item) {
              await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
              await completeRun(item, { outcome: "done", now });
            },
          },
          {
            situation: "an operator cancellation",
            failureReason: null,
            reclaimedAtKind: "null",
            async drive(item) {
              await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
              await completeRun(item, { outcome: "cancelled", now });
            },
          },
          {
            situation: "an operator-reported infra failure (timeout)",
            failureReason: "timeout",
            reclaimedAtKind: "null",
            async drive(item) {
              await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
              await completeRun(item, { outcome: "failed", failureReason: "timeout", now });
            },
          },
          {
            situation: "an agent-reported failure (agent_error)",
            failureReason: "agent_error",
            reclaimedAtKind: "null",
            async drive(item) {
              await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
              await completeRun(item, { outcome: "failed", failureReason: "agent_error", now });
            },
          },
          {
            situation: "a reclaim of a stale running run",
            failureReason: "runtime_offline",
            reclaimedAtKind: "instant",
            async drive(item) {
              // a running run whose updatedAt is far in the past → stale at `now`
              await startRun(item, { now: "2026-06-30T00:00:00.000Z" });
              await reclaimStaleRuns([item], { now, stalenessThreshold: 60000 });
            },
          },
        ];

        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `s-${rows.indexOf(row)}` });
          await row.drive(item);
          const [record] = await readRuns(item);
          assert.equal(record.failureReason, row.failureReason, `[${row.situation}] failureReason is ${JSON.stringify(row.failureReason)}`);
          if (row.reclaimedAtKind === "null") {
            assert.equal(record.reclaimedAt, null, `[${row.situation}] reclaimedAt is null`);
          } else {
            assert.equal(record.reclaimedAt, now, `[${row.situation}] reclaimedAt is the instant the reclaim passed`);
            assert.match(record.reclaimedAt, ISO_RE, `[${row.situation}] reclaimedAt is an ISO-8601 instant`);
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: completing a run as failed records the supplied reason; done/cancelled record null ──
  {
    name: "run-resilience-record-keys/00 completing a run as failed records the supplied reason; done/cancelled record null",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, completeRun, readRuns } = await import("../src/run-store.mjs");
        const now = "2026-06-30T09:00:00.000Z";

        const rows = [
          { outcome: "failed", reason: "timeout", failureReason: "timeout" },
          { outcome: "failed", reason: "agent_error", failureReason: "agent_error" },
          { outcome: "done", reason: null, failureReason: null },
          { outcome: "cancelled", reason: null, failureReason: null },
        ];
        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `c-${row.outcome}-${row.reason ?? "none"}` });
          await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
          await completeRun(item, { outcome: row.outcome, failureReason: row.reason, now });
          const [record] = await readRuns(item);
          assert.equal(record.state, row.outcome, `[${row.outcome}] the record state is ${row.outcome}`);
          assert.equal(record.failureReason, row.failureReason, `[${row.outcome}] failureReason is ${JSON.stringify(row.failureReason)}`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: an unrecognised failure reason is recorded verbatim and left for the classifier ──
  {
    name: "run-resilience-record-keys/00 an unrecognised failure reason is recorded verbatim and not rejected by the store",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, completeRun, readRuns, isRetryable } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
        // the store does NOT police the reason vocabulary — an unknown reason persists.
        await assert.doesNotReject(
          () => completeRun(item, { outcome: "failed", failureReason: "some_other_kind", now: "2026-06-30T09:00:00.000Z" }),
          "the store does not reject the unknown reason"
        );
        const [record] = await readRuns(item);
        assert.equal(record.failureReason, "some_other_kind", "the unrecognised reason is recorded verbatim");
        // the classifier (not the store) fails closed on it
        assert.equal(isRetryable("some_other_kind"), false, "the pure classifier fails closed on the unknown reason");
        assert.equal(files(await runFiles(item)), 1, "exactly one run record exists (nothing rejected mid-write)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

// tiny helper so the assertion message reads naturally
function files(list) {
  return list.length;
}

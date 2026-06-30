// Traceability wiring for milestone 20 / story 01 — the OUTSIDER-VERIFIABLE
// acceptance: the resume / fresh / ceiling / reclaim / dedup mechanics driven
// ENTIRELY through the registered CLI over the real filesystem, surviving a fresh
// process.
//
// Covers EVERY @executable scenario in tasks/03_resilience-acceptance.feature over
// the REAL seam: separate, fresh CLI processes (spawnSync) and the real filesystem.
// One test object per @executable scenario, each name tracing to feature + scenario.
//
//   03_resilience-acceptance.feature — resume-on-infra end-to-end; fresh-on-rejection;
//     the ceiling halts; reclaim-and-rollback; a reclaimed run is retryable; and the
//     dedup guard refuses a second in-flight run.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A multi-line milestone record doc with status in-progress, so the reclaim/failed
// rollback wiring can be observed (status NOT first nor last).
function specDoc(status) {
  return [
    "---",
    "type: milestone",
    "number: 20",
    "slug: autonomous-run-resilience",
    'title: "Autonomous Run Resilience"',
    `status: ${status}`,
    "created: 2026-06-30",
    "updated: 2026-06-30",
    "---",
    "# 20 · Autonomous Run Resilience",
    "",
  ].join("\n");
}

async function buildFixture({ status = "in-progress" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-resilience-acc-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  const mDir = path.join(workDir, "20_milestone_autonomous-run-resilience");
  await mkdir(aofDir, { recursive: true });
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(mDir, "SPEC.md"), specDoc(status), "utf8");
  return { root, mDir };
}

// Each runCli is a SEPARATE OS process — the restart proof. Nothing is shared in
// memory between calls; a later read re-loads runs/ from disk.
function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Write a run record file directly (13 keys) — for a SPECIFIC precondition (a failed
// run at a chosen attempt/reason, or a stale running orphan) dedup forbids minting
// through the store, so it is seeded as a fixture write.
async function seedRunFile(mDir, overrides = {}) {
  const runsDir = path.join(mDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const createdAt = overrides.createdAt ?? "2026-06-30T09:00:00.000Z";
  const runId = overrides.runId ?? `${createdAt.replace(/[-:.]/g, "")}-0000`;
  const record = {
    runId,
    itemRef: "20",
    state: overrides.state ?? "failed",
    attempt: overrides.attempt ?? 1,
    outcome: overrides.outcome ?? (overrides.state === "running" ? null : "failed"),
    sessionId: overrides.sessionId ?? null,
    brief: {},
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    failureReason: overrides.failureReason ?? null,
    heartbeatAt: overrides.heartbeatAt ?? null,
    retryOf: overrides.retryOf ?? null,
    reclaimedAt: overrides.reclaimedAt ?? null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

const statusRuns = (root) => JSON.parse(runCli(root, ["work", "run-status", "20", "--json"]).stdout).runs;

export const runResilienceAcceptanceTests = [
  // ══ Scenario: an infra-failed run resumes its session through run-retry ════
  {
    name: "run-resilience-acceptance/03 an infra-failed run resumes its session through run-retry and completes",
    async run() {
      const { root } = await buildFixture();
      try {
        const start = runCli(root, ["work", "run-start", "20", "--session", "sess-e2e", "--json"]);
        assert.equal(start.status, 0, `run-start exits 0 (stderr: ${start.stderr})`);
        const failedRunId = JSON.parse(start.stdout).runId;

        const fail = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--reason", "timeout"]);
        assert.equal(fail.status, 0, `run-complete failed exits 0 (stderr: ${fail.stderr})`);

        const retry = runCli(root, ["work", "run-retry", "20", "--json"]);
        assert.equal(retry.status, 0, `run-retry exits 0 (stderr: ${retry.stderr})`);
        const resumed = JSON.parse(retry.stdout);
        assert.equal(resumed.sessionId, "sess-e2e", "the resumed run's sessionId is sess-e2e");
        assert.equal(resumed.attempt, 2, "the resumed run's attempt is 2");
        assert.equal(resumed.retryOf, failedRunId, "the resumed run's retryOf is the failed run's runId");

        const done = runCli(root, ["work", "run-complete", "20", "--outcome", "done"]);
        assert.equal(done.status, 0, `run-complete done exits 0 (stderr: ${done.stderr})`);

        // a FRESH process reads the history back
        const runs = statusRuns(root);
        const failed = runs.find((run) => run.runId === failedRunId);
        const resumedRun = runs.find((run) => run.runId === resumed.runId);
        assert.equal(failed.state, "failed", "the history shows the failed run");
        assert.equal(resumedRun.state, "done", "the history shows the resumed run done");
        assert.equal(resumedRun.outcome, "done", "the resumed run's outcome is done");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a rejected (agent_error) run is not retried — fresh start ═════
  {
    name: "run-resilience-acceptance/03 a rejected (agent_error) run is not retried — a fresh start mints a new lineage",
    async run() {
      const { root } = await buildFixture();
      try {
        const start = runCli(root, ["work", "run-start", "20", "--session", "sess-bad"]);
        assert.equal(start.status, 0, `run-start exits 0 (stderr: ${start.stderr})`);
        const fail = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--reason", "agent_error"]);
        assert.equal(fail.status, 0, `run-complete failed exits 0 (stderr: ${fail.stderr})`);

        const retry = runCli(root, ["work", "run-retry", "20", "--json"]);
        assert.notEqual(retry.status, 0, "run-retry on an agent_error failure exits non-zero");
        const envelope = JSON.parse(retry.stdout);
        assert.equal(envelope.ok, false, "the retry envelope is ok:false");
        assert.equal(envelope.code, "not-retryable", `the retry envelope code is not-retryable (got ${envelope.code})`);

        // a fresh start mints a new lineage (retryOf null, attempt 1, the new session)
        const fresh = runCli(root, ["work", "run-start", "20", "--session", "sess-fresh", "--json"]);
        assert.equal(fresh.status, 0, `fresh run-start exits 0 (stderr: ${fresh.stderr})`);
        const newRun = JSON.parse(fresh.stdout);
        assert.equal(newRun.retryOf, null, "the new run's retryOf is null");
        assert.equal(newRun.attempt, 1, "the new run's attempt is 1");
        assert.equal(newRun.sessionId, "sess-fresh", "the new run's sessionId is sess-fresh (the poisoned session is not carried)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the attempt ceiling halts a genuinely-failing item ═══════════
  {
    name: "run-resilience-acceptance/03 the attempt ceiling halts a genuinely-failing item instead of looping",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // item 20 has a failed timeout run at attempt 1
        await seedRunFile(mDir, { state: "failed", attempt: 1, failureReason: "timeout", sessionId: "sess-loop" });

        // --max-attempts 2: attempt 1 < 2, so the retry resumes to attempt 2
        const retry1 = runCli(root, ["work", "run-retry", "20", "--max-attempts", "2", "--json"]);
        assert.equal(retry1.status, 0, `first run-retry exits 0 (stderr: ${retry1.stderr})`);
        assert.equal(JSON.parse(retry1.stdout).attempt, 2, "the resumed run's attempt is 2");

        // fail it again (now a running attempt-2 run exists)
        const fail = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--reason", "timeout"]);
        assert.equal(fail.status, 0, `run-complete failed exits 0 (stderr: ${fail.stderr})`);

        const runsBefore = statusRuns(root).length;
        // attempt 2 >= 2 → attempts-exhausted, no further run minted
        const retry2 = runCli(root, ["work", "run-retry", "20", "--max-attempts", "2", "--json"]);
        assert.notEqual(retry2.status, 0, "the ceiling retry exits non-zero");
        const envelope = JSON.parse(retry2.stdout);
        assert.equal(envelope.ok, false, "the envelope is ok:false");
        assert.equal(envelope.code, "attempts-exhausted", `the envelope code is attempts-exhausted (got ${envelope.code})`);
        assert.equal(statusRuns(root).length, runsBefore, "no further run is minted for item 20");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a crashed run is reclaimed on the next start, item rolled back ═
  {
    name: "run-resilience-acceptance/03 a run orphaned by a crash is reclaimed on the next start and its item rolled back",
    async run() {
      const { root, mDir } = await buildFixture({ status: "in-progress" });
      try {
        // item 20 has a running run whose heartbeat is stale past the threshold; status in-progress
        await seedRunFile(mDir, {
          runId: "20200101T000000000Z-0000",
          createdAt: "2020-01-01T00:00:00.000Z",
          state: "running",
          heartbeatAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        });

        // the restart-time reclaim scan runs as part of run-start
        const start = runCli(root, ["work", "run-start", "20"]);
        assert.equal(start.status, 0, `run-start (reclaim) exits 0 (stderr: ${start.stderr})`);

        // a FRESH process reads the orphaned run back
        const orphan = statusRuns(root).find((run) => run.runId === "20200101T000000000Z-0000");
        assert.ok(orphan, "the orphaned run is in the history");
        assert.equal(orphan.state, "failed", "the orphaned run shows state failed");
        assert.equal(orphan.failureReason, "runtime_offline", "its failureReason is runtime_offline");
        assert.ok(orphan.reclaimedAt, "it carries a reclaimedAt stamp");

        // item 20 frontmatter status is rolled back to not-started, so next re-offers it
        const next = runCli(root, ["work", "next", "--json"]);
        const offered = JSON.parse(next.stdout);
        assert.equal(offered.state, "ready", "next offers an actionable item");
        assert.equal(offered.ref, "20", "item 20 is among the offered actionable items");
        assert.equal(offered.status, "not-started", "item 20's status is not-started");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a reclaimed run is retryable and resumes its session ═════════
  {
    name: "run-resilience-acceptance/03 a reclaimed run is retryable and resumes its session to completion",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // item 20 had a running run with session sess-crash reclaimed as runtime_offline
        // (a failed, retryable, reclaimedAt-stamped record — exactly what reclaim leaves).
        const reclaimed = await seedRunFile(mDir, {
          state: "failed",
          attempt: 1,
          sessionId: "sess-crash",
          failureReason: "runtime_offline",
          reclaimedAt: "2026-06-30T12:00:00.000Z",
        });

        const retry = runCli(root, ["work", "run-retry", "20", "--json"]);
        assert.equal(retry.status, 0, `run-retry exits 0 (stderr: ${retry.stderr})`);
        const resumed = JSON.parse(retry.stdout);
        assert.equal(resumed.sessionId, "sess-crash", "the resumed run's sessionId is sess-crash");
        assert.equal(resumed.retryOf, reclaimed.runId, "the resumed run's retryOf is the reclaimed run's runId");

        const done = runCli(root, ["work", "run-complete", "20", "--outcome", "done"]);
        assert.equal(done.status, 0, `run-complete done exits 0 (stderr: ${done.stderr})`);

        const resumedRun = statusRuns(root).find((run) => run.runId === resumed.runId);
        assert.equal(resumedRun.state, "done", "the history shows the resumed run done");
        assert.equal(resumedRun.outcome, "done", "the resumed run's outcome is done");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a second run-start while in flight is refused duplicate-run ═══
  {
    name: "run-resilience-acceptance/03 a second run-start while a run is in flight is refused duplicate-run over the CLI",
    async run() {
      const { root } = await buildFixture();
      try {
        const first = runCli(root, ["work", "run-start", "20"]);
        assert.equal(first.status, 0, `first run-start exits 0 (stderr: ${first.stderr})`);

        const second = runCli(root, ["work", "run-start", "20", "--json"]);
        assert.notEqual(second.status, 0, "the second run-start exits non-zero");
        const envelope = JSON.parse(second.stdout);
        assert.equal(envelope.ok, false, "the envelope is ok:false");
        assert.equal(envelope.code, "duplicate-run", `the envelope code is duplicate-run (got ${envelope.code})`);

        // a fresh process shows exactly one run in flight
        const inFlight = statusRuns(root).filter((run) => run.state === "running" || run.state === "queued");
        assert.equal(inFlight.length, 1, "exactly one run is in flight");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

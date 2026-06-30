// Traceability wiring for milestone 20 / story 00 — dedup + atomic persist.
//
// Covers EVERY @executable scenario in
//   tasks/04_dedup-and-atomic-persist.feature
// exercising the REAL src/run-store.mjs in-process against a temp fixture repo
// (mkdtemp → mkdir → run → rm in finally). One test object per @executable
// scenario (Scenario-Outline rows folded into one entry iterating the rows), each
// name tracing to feature + scenario. node:assert/strict.
//
//   04_dedup-and-atomic-persist.feature — the mint path forbids a second
//     non-terminal (queued/running) run per item via duplicate-run (both verbs, both
//     states, including the self-lineage retry backstop), minting nothing; a terminal
//     run never blocks a new mint; two same-item mints at the identical injected
//     instant get distinct ids (0000/0001), two files neither overwritten; a
//     persisted record reloads as complete 13-key JSON with no .tmp- artifact; every
//     milestone-20 persist path (heartbeat / reclaim / retry mint) leaves a
//     fully-formed record + no .tmp- artifact.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FROZEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt"];
const RUNID_RE = /^(\d{8}T\d{9}Z)-(\d{4})$/;

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-dedup-"));
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

// All entries in the runs/ dir (so a stray .tmp- artifact would show up too).
async function runDirEntries(item) {
  try {
    return await readdir(path.join(item.dir, "runs"));
  } catch {
    return [];
  }
}

async function runFiles(item) {
  return (await runDirEntries(item)).filter((name) => name.endsWith(".json"));
}

async function tmpArtifacts(item) {
  return (await runDirEntries(item)).filter((name) => name.includes(".tmp-"));
}

// Write a run-record DIRECTLY (the dedup guard mints no queued/second non-terminal
// run; queued has no producer). The directly-written-fixture pattern story 00's
// dedup feature note prescribes for the reserved queued + second-running preconditions.
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

export const runDedupAtomicPersistTests = [
  // ── Scenario Outline: a second non-terminal run for an item is rejected duplicate-run, minting nothing ──
  {
    name: "run-dedup-atomic-persist/04 a second non-terminal run for an item is rejected duplicate-run, minting nothing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, retryRun } = await import("../src/run-store.mjs");
        const now = "2026-06-30T09:00:00.000Z";

        // Each row sets up an existing non-terminal run, then attempts a second mint.
        const rows = [
          // a running run blocks a second mint by either verb
          {
            label: "running / startRun a second run",
            async setup(item) {
              return { existing: await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running" }), expectedFiles: 1 };
            },
            mint: (item) => startRun(item, { now }),
          },
          {
            label: "running / retryRun a separate prior failed run",
            async setup(item) {
              // a terminal failed (retryable) run that COULD be retried, plus a running run in flight.
              await writeRecord(item, { runId: "20260629T000000000Z-0000", state: "failed", outcome: "failed", failureReason: "timeout", attempt: 1, createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z" });
              const existing = await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running" });
              return { existing, expectedFiles: 2 };
            },
            // retryRun targets the failed run, but the in-flight running run trips dedup.
            mint: (item) => retryRun(item, { runId: "20260629T000000000Z-0000", now }),
          },
          {
            label: "running / retryRun while this item's own run is in flight (self-lineage backstop)",
            async setup(item) {
              // the running run IS itself a retry of a prior failed run — a self-retry while
              // the item's own run is in flight (the anti-loop backstop story 02 leans on).
              await writeRecord(item, { runId: "20260629T000000000Z-0000", state: "failed", outcome: "failed", failureReason: "timeout", attempt: 1, createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z" });
              const existing = await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", attempt: 2, retryOf: "20260629T000000000Z-0000" });
              return { existing, expectedFiles: 2 };
            },
            // a retry with no runId resolves the most-recent failed run, but the running run trips dedup.
            mint: (item) => retryRun(item, { now }),
          },
          // a queued run (19's reserved state) also blocks a second mint
          {
            label: "queued / startRun a second run",
            async setup(item) {
              return { existing: await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "queued", outcome: null }), expectedFiles: 1 };
            },
            mint: (item) => startRun(item, { now }),
          },
          {
            label: "queued / retryRun a separate prior failed run",
            async setup(item) {
              await writeRecord(item, { runId: "20260629T000000000Z-0000", state: "failed", outcome: "failed", failureReason: "timeout", attempt: 1, createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z" });
              const existing = await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "queued", outcome: null });
              return { existing, expectedFiles: 2 };
            },
            mint: (item) => retryRun(item, { runId: "20260629T000000000Z-0000", now }),
          },
        ];

        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `dup-${rows.indexOf(row)}` });
          const { existing, expectedFiles } = await row.setup(item);
          const existingBefore = await readFileBytes(item, existing.runId);

          await expectRejectsWithCode(() => row.mint(item), "duplicate-run");

          // runs/ still contains exactly the pre-existing file(s) — nothing new minted
          assert.equal((await runFiles(item)).length, expectedFiles, `[${row.label}] no second run file is minted`);
          // the existing non-terminal run record is byte-unchanged
          assert.equal(await readFileBytes(item, existing.runId), existingBefore, `[${row.label}] the existing run record is byte-unchanged`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: a terminal run does not block a new mint ──
  {
    name: "run-dedup-atomic-persist/04 a terminal run does not block a new mint",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");

        const terminals = [
          { state: "done", outcome: "done", failureReason: null },
          { state: "failed", outcome: "failed", failureReason: "timeout" },
          { state: "cancelled", outcome: "cancelled", failureReason: null },
        ];
        for (const terminal of terminals) {
          const item = await milestoneItem(workDir, { slug: `term-${terminal.state}` });
          const prior = await writeRecord(item, { runId: "20260629T000000000Z-0000", state: terminal.state, outcome: terminal.outcome, failureReason: terminal.failureReason, createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z" });

          const fresh = await startRun(item, { now: "2026-06-30T09:00:00.000Z" });
          assert.equal(fresh.state, "running", `[${terminal.state}] a new running run is minted`);
          assert.notEqual(fresh.runId, prior.runId, `[${terminal.state}] the new run is distinct from the terminal run`);

          const ids = (await readRuns(item)).map((r) => r.runId);
          assert.ok(ids.includes(prior.runId), `[${terminal.state}] runs/ still contains the terminal run`);
          assert.ok(ids.includes(fresh.runId), `[${terminal.state}] runs/ contains the new running run`);
          assert.equal(ids.length, 2, `[${terminal.state}] runs/ contains both the terminal run and the new running run`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: two same-item mints at the identical injected instant get distinct runIds ──
  {
    name: "run-dedup-atomic-persist/04 two same-item mints at the identical injected instant get distinct runIds via the seq segment",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, completeRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // complete the first before minting the second (dedup) — both at the SAME now.
        const now = "2026-06-30T09:00:00.000Z";
        const first = await startRun(item, { now });
        await completeRun(item, { outcome: "done", now });
        const second = await startRun(item, { now });

        assert.notEqual(first.runId, second.runId, "the two run records have distinct runIds");
        const [, c1, s1] = first.runId.match(RUNID_RE);
        const [, c2, s2] = second.runId.match(RUNID_RE);
        assert.equal(c1, c2, "the two runIds share an identical <createdAt-compact> segment");
        assert.equal(s1, "0000", "the first <seq> is 0000");
        assert.equal(s2, "0001", "the second <seq> is 0001");
        // runs/ contains exactly two record files, neither overwritten
        const files = await runFiles(item);
        assert.equal(files.length, 2, "runs/ contains exactly two record files");
        assert.ok(files.includes(`${first.runId}.json`), "the first record file persists (not overwritten)");
        assert.ok(files.includes(`${second.runId}.json`), "the second record file persists (not overwritten)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a persisted run record is always fully-formed on reload, never torn ──
  {
    name: "run-dedup-atomic-persist/04 a persisted run record is always fully-formed on reload, with no .tmp- artifact remaining",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const record = await startRun(item, { sessionId: "sess-atomic", brief: { k: "v" }, now: "2026-06-30T09:00:00.000Z" });

        // a FRESH store load reads the committed record fully-formed
        const fresh = await import("../src/run-store.mjs?fresh-dedup-atomic");
        const runs = await fresh.readRuns(item);
        assert.equal(runs.length, 1, "the record reloads as one run");
        const [reloaded] = runs;
        // it parses as complete JSON carrying all thirteen frozen keys
        const onDisk = JSON.parse(await readFileBytes(item, record.runId));
        assert.deepEqual(Object.keys(onDisk), FROZEN_KEYS, "the on-disk record carries all thirteen frozen keys");
        assert.deepEqual(Object.keys(reloaded), FROZEN_KEYS, "the reloaded record carries all thirteen frozen keys");
        // no partial or temp (.tmp-) artifact remains in the item's runs/ directory
        assert.deepEqual(await tmpArtifacts(item), [], "no .tmp- artifact remains in the item's runs/ directory");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: every milestone-20 persist path leaves a fully-formed record ──
  {
    name: "run-dedup-atomic-persist/04 every milestone-20 persist path leaves a fully-formed record with no .tmp- artifact",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const store = await import("../src/run-store.mjs");
        const { startRun, completeRun, heartbeat, reclaimStaleRuns, retryRun, readRuns } = store;

        const rows = [
          {
            label: "a heartbeat bump",
            async drive(item) {
              const started = await startRun(item, { now: "2026-06-30T08:00:00.000Z" });
              await heartbeat(item, started.runId, { now: "2026-06-30T09:00:00.000Z" });
            },
          },
          {
            label: "a reclaim force-fail",
            async drive(item) {
              // a stale running run (far-past updatedAt) → the reclaim force-fail persist path
              await writeRecord(item, { runId: "20260630T000000000Z-0000", state: "running", heartbeatAt: null, updatedAt: "2026-06-30T00:00:00.000Z" });
              await reclaimStaleRuns([item], { now: "2026-06-30T12:00:00.000Z", stalenessThreshold: 60000 });
            },
          },
          {
            label: "a retry-lineage mint",
            async drive(item) {
              await writeRecord(item, { runId: "20260629T000000000Z-0000", state: "failed", outcome: "failed", failureReason: "timeout", attempt: 1, createdAt: "2026-06-29T00:00:00.000Z", updatedAt: "2026-06-29T00:00:00.000Z" });
              await retryRun(item, { now: "2026-06-30T09:00:00.000Z" });
            },
          },
        ];

        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `persist-${rows.indexOf(row)}` });
          await row.drive(item);

          // reload the store fresh and assert every record parses as complete JSON
          const fresh = await import(`../src/run-store.mjs?fresh-persist-${rows.indexOf(row)}`);
          const runs = await fresh.readRuns(item);
          assert.ok(runs.length >= 1, `[${row.label}] at least one record persists`);
          for (const run of runs) {
            const onDisk = JSON.parse(await readFileBytes(item, run.runId));
            assert.deepEqual(Object.keys(onDisk), FROZEN_KEYS, `[${row.label}] the persisted record parses as complete 13-key JSON`);
          }
          // no .tmp- artifact remains in the item's runs/ directory
          assert.deepEqual(await tmpArtifacts(item), [], `[${row.label}] no .tmp- artifact remains in the item's runs/ directory`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

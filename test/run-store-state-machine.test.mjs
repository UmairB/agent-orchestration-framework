// Traceability wiring for milestone 19 / story 00 — the run state machine.
//
// Covers EVERY @executable scenario in tasks/01_state-machine.feature against the
// REAL src/run-store.mjs in-process. The full 5x5 = 25-cell transition table and
// the illegal-transition matrix are asserted cell-by-cell (Scenario-Outline rows
// folded into one entry each). node:assert/strict.
//
//   01_state-machine.feature — the validator accepts only the five legal edges of
//     the closed table; a legal terminal transition records state + outcome==state
//     and bumps updatedAt; an illegal transition is rejected with illegal-transition
//     and the stored record is BYTE-UNCHANGED; starting a run always yields running.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STATES = ["queued", "running", "done", "failed", "cancelled"];
// The five legal edges of the closed table (ADR-001) — everything else is rejected.
const LEGAL = new Set(["queued>running", "queued>cancelled", "running>done", "running>failed", "running>cancelled"]);

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-runstore-sm-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workDir };
}

async function milestoneItem(workDir, slug = "work-run-lifecycle") {
  const dir = path.join(workDir, `19_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: "19", dir };
}

// Place a run record on disk already in a given state — to exercise transitions
// OUT of an arbitrary (incl. terminal) state directly. Built via startRun then a
// raw rewrite of the file's state, so the on-disk shape is a real persisted record.
async function seedRunInState(item, state) {
  const { startRun } = await import("../src/run-store.mjs");
  const record = await startRun(item);
  const onDisk = {
    ...record,
    state,
    outcome: state === "running" || state === "queued" ? null : state,
  };
  const file = path.join(item.dir, "runs", `${record.runId}.json`);
  await writeFile(file, JSON.stringify(onDisk, null, 2), "utf8");
  return { runId: record.runId, file };
}

async function assertRejectsWithCode(fn, code) {
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

export const runStoreStateMachineTests = [
  {
    name: "run-store/01 the transition validator accepts only the legal edges of the closed table (25-cell grid)",
    async run() {
      const { isLegalTransition } = await import("../src/run-store.mjs");
      // The full 5x5 grid — exactly the five legal cells, twenty rejected.
      let legalCount = 0;
      for (const from of STATES) {
        for (const to of STATES) {
          const expected = LEGAL.has(`${from}>${to}`);
          assert.equal(isLegalTransition(from, to), expected, `${from} -> ${to} is ${expected ? "legal" : "rejected"}`);
          if (expected) legalCount += 1;
        }
      }
      assert.equal(legalCount, 5, "exactly five legal edges in the 25-cell grid");
    },
  },
  {
    name: "run-store/01 completing a running run records the terminal state and sets outcome to match (Scenario Outline)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, applyTransition } = await import("../src/run-store.mjs");
        for (const terminal of ["done", "failed", "cancelled"]) {
          const item = await milestoneItem(workDir, `t-${terminal}`);
          const started = await startRun(item);
          // ensure a measurable clock gap so updatedAt can be strictly after createdAt
          await new Promise((resolve) => setTimeout(resolve, 2));
          const updated = await applyTransition(item, started.runId, terminal);

          assert.equal(updated.state, terminal, `state is ${terminal}`);
          assert.equal(updated.outcome, terminal, `outcome equals ${terminal}`);
          assert.ok(updated.updatedAt >= updated.createdAt, "updatedAt is at or after createdAt");
          assert.equal(updated.runId, started.runId, "keeps its original runId");
          assert.equal(updated.createdAt, started.createdAt, "keeps its original createdAt");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/01 an illegal transition is rejected and writes nothing (illegal-transition matrix, byte-unchanged)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { applyTransition } = await import("../src/run-store.mjs");
        // The matrix from the feature: re-completing each terminal to every terminal
        // (incl. itself), plus running's self-loop and backward running->queued.
        const matrix = [
          ["done", "running"], ["done", "done"], ["done", "failed"], ["done", "cancelled"],
          ["failed", "running"], ["failed", "done"], ["failed", "failed"], ["failed", "cancelled"],
          ["cancelled", "running"], ["cancelled", "done"], ["cancelled", "failed"], ["cancelled", "cancelled"],
          ["running", "running"], ["running", "queued"],
        ];
        for (const [from, to] of matrix) {
          const item = await milestoneItem(workDir, `ill-${from}-${to}`);
          const { runId, file } = await seedRunInState(item, from);
          const before = await readFile(file, "utf8");

          await assertRejectsWithCode(() => applyTransition(item, runId, to), "illegal-transition");

          const after = await readFile(file, "utf8");
          assert.equal(after, before, `the persisted record is byte-unchanged after rejecting ${from} -> ${to}`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/01 starting a run always yields running, never queued",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const runStore = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir, "no-mint");

        const record = await runStore.startRun(item);
        assert.equal(record.state, "running", "the run record state is running");
        // no store operation creates a run in state queued — the store exports no
        // enqueue/mint-queued API; only startRun mints a run, and it yields running.
        const exportNames = Object.keys(runStore);
        assert.equal(exportNames.some((name) => /enqueue|queue/i.test(name)), false, "no store export mints a queued run");
        const runs = await runStore.readRuns(item);
        assert.ok(runs.every((run) => run.state !== "queued"), "no persisted run is in state queued");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

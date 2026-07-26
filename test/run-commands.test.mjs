// Traceability wiring for milestone 19 / story 01 — the work:run-* commands.
//
// Covers EVERY @executable scenario in tasks/00_run-commands.feature, exercising
// the REAL in-process registry (src/command-core.mjs + src/commands/run-*.mjs over
// story 00's src/run-store.mjs) against a temp fixture repo — loadWorkspace +
// invoke, real fs, in-process. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry iterating the rows), each name
// tracing to feature + scenario. node:assert/strict.
//
//   00_run-commands.feature — the three commands register into the SAME core with
//     the frozen {id,input,run,cli} shape; run-start mints a running run
//     (resolveItemExact — a typo writes no run to the wrong item); run-complete
//     performs the terminal transition (resolveItemExact; runId defaults to the
//     single in-flight running run; illegal/ambiguous/none are errors);
//     run-status returns { ref, runs:[…] } (resolveItem, slug-fallback tolerated).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace, findWork } from "../src/work.mjs";
import { getCommand, listCommands, invoke } from "../src/command-core.mjs";

const RUN_IDS = ["work:run-start", "work:run-complete", "work:run-status"];
const FROZEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt", "node"];

// Seed a SECOND running run by writing the record file directly. 20/ADR-006 dedup
// forbids minting a second non-terminal run via the store, so the defensive
// ambiguous-run guard (more than one running run) is set up by a direct fixture write.
async function seedRunningRun(workDir, runId, createdAt = "2026-06-29T00:00:00.000Z") {
  const runsDir = path.join(workDir, "19_milestone_work-run-lifecycle", "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    runId, itemRef: "19", state: "running", attempt: 1, outcome: null, sessionId: null,
    brief: {}, createdAt, updatedAt: createdAt,
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
}

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-runcmd-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// The milestone 19 fixture + a story 19/00 (slug "run-store"). The story slug means
// the free-text fragments "run-stor" / "work-run-lifecycle" slug-match a real row
// that the EXACT write resolver then rejects (row.ref !== the fragment) →
// ref-not-found, with no run written.
async function buildStream(workDir, { status = "in-progress" } = {}) {
  const mDir = path.join(workDir, "19_milestone_work-run-lifecycle");
  const sDir = path.join(mDir, "stories", "00_story_run-store");
  await mkdir(sDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "19", slug: "work-run-lifecycle", status, title: '"Work-Run Lifecycle"', created: "2026-06-29", updated: "2026-06-29" }) + "# 19 · Work-Run Lifecycle\n",
    "utf8"
  );
  await writeFile(
    path.join(sDir, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "run-store", parent: "19", status, title: '"Run Store"', created: "2026-06-29", updated: "2026-06-29" }) + "# 00 · Run Store\n",
    "utf8"
  );
  return { mDir, sDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// Resolve an item's row (the same shape findWork/resolveItem return) so the test can
// read its runs/ dir directly off disk.
async function itemRow(workDir, ref) {
  const rows = await findWork(workDir, ref);
  return rows.find((row) => row.ref === ref) ?? rows[0];
}

async function runFiles(workDir, ref) {
  const row = await itemRow(workDir, ref);
  try {
    return (await readdir(path.join(row.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

async function readRunFile(workDir, ref, runId) {
  const row = await itemRow(workDir, ref);
  return JSON.parse(await readFile(path.join(row.dir, "runs", `${runId}.json`), "utf8"));
}

// Assert a thrown error carries the expected `.code` (the command error contract).
async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}" (got "${caught.code}")`);
  return caught;
}

export const runCommandsTests = [
  // ══════════════════ Scenario: the registry exposes the three commands ══════
  {
    name: "run-commands/00 the registry exposes the three work:run-* commands with the frozen shape",
    async run() {
      const ids = listCommands().map((command) => command.id);
      for (const id of RUN_IDS) {
        assert.ok(ids.includes(id), `the registry exposes ${id}`);
        const command = getCommand(id);
        // input schema, async run, cli adapter with argv + render.
        assert.ok(command.input && typeof command.input === "object", `${id} carries an input schema`);
        assert.equal(command.run.constructor.name, "AsyncFunction", `${id} run is async`);
        assert.ok(command.cli && typeof command.cli === "object", `${id} carries a cli adapter`);
        assert.equal(typeof command.cli.argv, "function", `${id} cli.argv is a function`);
        assert.equal(typeof command.cli.render, "function", `${id} cli.render is a function`);
      }
    },
  },

  // ══════════════════ Scenario: run-start creates a running run ══════════════
  {
    name: "run-commands/00 work:run-start creates a running run and returns the record",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        const ctx = await ctxFor(repo);

        const record = await invoke("work:run-start", { ref: "19", sessionId: "sess-1" }, ctx);
        assert.equal(record.state, "running", "state is running");
        assert.equal(record.outcome, null, "outcome is null");
        assert.equal(record.attempt, 1, "attempt is 1");
        assert.equal(record.itemRef, "19", "itemRef is 19");
        assert.equal(record.sessionId, "sess-1", "sessionId is the supplied value");
        assert.equal(record.createdAt, record.updatedAt, "createdAt equals updatedAt at start");
        // a runs/<run-id>.json file exists under item 19
        const files = await runFiles(workDir, "19");
        assert.equal(files.length, 1, "one runs/ file under item 19");
        assert.equal(files[0], `${record.runId}.json`, "the file is <runId>.json");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: run-start resolves exact — a typo writes no run ═══════
  {
    name: "run-commands/00 work:run-start resolves exact — a typo writes no run to the wrong item",
    async run() {
      const rows = [
        { ref: "19", kind: "creates" },
        { ref: "19/00", kind: "creates" },
        { ref: "99", kind: "ref-not-found" },
        { ref: "19/99", kind: "ref-not-found" },
        { ref: "run-stor", kind: "ref-not-found" },
        { ref: "work-run-lifecycle", kind: "ref-not-found" },
        { ref: "1", kind: "ref-not-found" },
      ];
      for (const { ref, kind } of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          if (kind === "creates") {
            const record = await invoke("work:run-start", { ref }, ctx);
            assert.equal(record.state, "running", `${ref} creates a running run`);
            assert.equal(record.itemRef, ref, `${ref} stamps itemRef ${ref}`);
            assert.equal((await runFiles(workDir, ref)).length, 1, `${ref} wrote exactly one run file`);
          } else {
            await assertRejectsWithCode(() => invoke("work:run-start", { ref }, ctx), "ref-not-found");
            // no run written anywhere: neither the milestone nor the story has runs/
            assert.equal((await runFiles(workDir, "19")).length, 0, `${ref}: no run under milestone 19`);
            assert.equal((await runFiles(workDir, "19/00")).length, 0, `${ref}: no run under story 19/00`);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: run-complete performs the terminal transition ════════
  {
    name: "run-commands/00 work:run-complete performs the terminal transition on the running run",
    async run() {
      for (const outcome of ["done", "failed", "cancelled"]) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          // item 19 has a single running run
          const started = await invoke("work:run-start", { ref: "19" }, ctx);
          const record = await invoke("work:run-complete", { ref: "19", outcome }, ctx);
          assert.equal(record.state, outcome, `state is ${outcome}`);
          assert.equal(record.outcome, outcome, `outcome is ${outcome}`);
          assert.equal(record.runId, started.runId, "the same run was completed");
          assert.ok(record.updatedAt >= record.createdAt, "updatedAt is at or after createdAt");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: run-complete rejects completing an already-terminal run
  {
    name: "run-commands/00 work:run-complete rejects completing an already-terminal run",
    async run() {
      const rows = [
        { terminal: "done", retry: "failed" },
        { terminal: "failed", retry: "done" },
        { terminal: "cancelled", retry: "done" },
      ];
      for (const { terminal, retry } of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          // item 19 has a run already in state <terminal>
          const started = await invoke("work:run-start", { ref: "19" }, ctx);
          await invoke("work:run-complete", { ref: "19", outcome: terminal }, ctx);
          const before = await readRunFile(workDir, "19", started.runId);

          await assertRejectsWithCode(
            () => invoke("work:run-complete", { ref: "19", runId: started.runId, outcome: retry }, ctx),
            "illegal-transition"
          );
          // the persisted run record is unchanged (byte-identical)
          const after = await readRunFile(workDir, "19", started.runId);
          assert.deepEqual(after, before, `re-completing a ${terminal} run leaves the record byte-unchanged`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: run-complete requires an unambiguous target run ══════
  {
    name: "run-commands/00 work:run-complete requires an unambiguous target run",
    async run() {
      // situation, runId selector, expected result
      const cases = [
        { situation: "no running run", runId: "none", result: "no-running-run" },
        { situation: "two running runs", runId: "none", result: "ambiguous-run" },
        { situation: "two running runs", runId: "first", result: "completes" },
        { situation: "one running run", runId: "none", result: "completes" },
      ];
      for (const { situation, runId, result } of cases) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          let firstRunId = null;
          if (situation === "one running run") {
            firstRunId = (await invoke("work:run-start", { ref: "19" }, ctx)).runId;
          } else if (situation === "two running runs") {
            firstRunId = (await invoke("work:run-start", { ref: "19" }, ctx)).runId;
            // a SECOND running run, written directly — 20/ADR-006 dedup forbids a
            // second mint, so the ambiguous-run guard is exercised via a fixture write.
            await seedRunningRun(workDir, "20260629T000000000Z-9000");
          }
          // "no running run" → no start at all.

          const input = { ref: "19", outcome: "done" };
          if (runId === "first") input.runId = firstRunId;

          if (result === "completes") {
            const record = await invoke("work:run-complete", input, ctx);
            assert.equal(record.state, "done", `${situation}/${runId}: completes that run as done`);
            if (runId === "first") {
              assert.equal(record.runId, firstRunId, "the explicit runId selected the first run");
            }
          } else {
            await assertRejectsWithCode(() => invoke("work:run-complete", input, ctx), result);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: run-complete resolves exact and rejects a typo'd ref ═
  {
    name: "run-commands/00 work:run-complete resolves exact and rejects a typo'd ref",
    async run() {
      for (const ref of ["99", "19/99", "work-run-lifecycle"]) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          // item 19 has a single running run
          const started = await invoke("work:run-start", { ref: "19" }, ctx);
          await assertRejectsWithCode(() => invoke("work:run-complete", { ref, outcome: "done" }, ctx), "ref-not-found");
          // item 19's running run is still running
          const persisted = await readRunFile(workDir, "19", started.runId);
          assert.equal(persisted.state, "running", `${ref}: item 19's running run is untouched`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══════════════════ Scenario: run-status returns the run history ═══════════
  {
    name: "run-commands/00 work:run-status returns the item's run history",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        const ctx = await ctxFor(repo);

        // item 19 has 2 persisted runs over its lifetime (20/ADR-006 dedup: the
        // first is completed before the second is started).
        await invoke("work:run-start", { ref: "19" }, ctx);
        await invoke("work:run-complete", { ref: "19", outcome: "done" }, ctx);
        await invoke("work:run-start", { ref: "19" }, ctx);

        const result = await invoke("work:run-status", { ref: "19" }, ctx);
        assert.equal(result.ref, "19", "the result ref is 19");
        assert.ok(Array.isArray(result.runs), "runs is an array");
        assert.equal(result.runs.length, 2, "both runs are carried");
        assert.ok(result.runs.every((run) => run.itemRef === "19"), "every run belongs to item 19");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: run-status tolerates the slug-fallback resolver ══════
  {
    name: "run-commands/00 work:run-status tolerates the slug-fallback resolver",
    async run() {
      for (const ref of ["work-run-lifecycle", "run-lifecycle"]) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          // item 19 (slug work-run-lifecycle) has persisted runs
          await invoke("work:run-start", { ref: "19" }, ctx);

          const result = await invoke("work:run-status", { ref }, ctx);
          assert.equal(result.ref, "19", `${ref} resolves to item 19`);
          assert.equal(result.runs.length, 1, `${ref} returns item 19's runs`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══════════════════ Scenario: run-status empty history ═════════════════════
  {
    name: "run-commands/00 work:run-status returns an empty history for an item with no runs",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        const ctx = await ctxFor(repo);

        // item 19 has no persisted runs — absent-not-error
        let caught = null;
        let result;
        try {
          result = await invoke("work:run-status", { ref: "19" }, ctx);
        } catch (error) {
          caught = error;
        }
        assert.equal(caught, null, "invoke raises no error for an item with no runs");
        assert.deepEqual(result, { ref: "19", runs: [] }, "the result is { ref: 19, runs: [] }");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══════════════════ Scenario: a run command leaves frontmatter untouched ═══
  {
    // The run state lives in runs/ (the derived log), NOT the item record doc — a
    // CLEAN run lifecycle touches no frontmatter. (20/ADR-005 deliberately supersedes
    // this for the failed/reclaim path: a FAILED completion rolls in-progress →
    // not-started — that bounded write is exercised in milestone 20 story 01's
    // 02_status-rollback. Here a DONE completion proves the derived-log discipline.)
    name: "run-commands/00 a clean run lifecycle leaves the item's frontmatter status untouched",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { mDir } = await buildStream(workDir, { status: "in-progress" });
        const ctx = await ctxFor(repo);

        // item 19 has frontmatter status in-progress
        const specBefore = await readFile(path.join(mDir, "SPEC.md"), "utf8");
        assert.ok(specBefore.includes("status: in-progress"), "fixture milestone is in-progress");

        await invoke("work:run-start", { ref: "19" }, ctx);
        await invoke("work:run-complete", { ref: "19", outcome: "done" }, ctx);

        // item 19 frontmatter status is still in-progress (byte-identical record doc)
        const specAfter = await readFile(path.join(mDir, "SPEC.md"), "utf8");
        assert.equal(specAfter, specBefore, "the milestone's record doc is byte-unchanged");
        assert.ok(existsSync(path.join(mDir, "runs")), "the run lived under runs/ (the derived log), not the record doc");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

// Traceability wiring for milestone 19 / story 01 — the outsider-verifiable
// acceptance: a run's lifecycle driven ENTIRELY through the registered commands,
// and the recorded run state SURVIVING A RESTART.
//
// Covers EVERY @executable scenario in tasks/02_lifecycle-survives-restart.feature
// over the REAL seam: separate, fresh CLI processes (spawnSync) and the real
// filesystem. A "restart" is a brand-new `node bin/aof.mjs …` process that re-loads
// the persisted runs/ from disk — proof the state is durable, not held in memory.
// One test object per @executable scenario, each name tracing to feature + scenario.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-runrestart-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  const mDir = path.join(workDir, "19_milestone_work-run-lifecycle");
  await mkdir(aofDir, { recursive: true });
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "19", slug: "work-run-lifecycle", status: "in-progress", title: '"Work-Run Lifecycle"', created: "2026-06-29", updated: "2026-06-29" }) + "# 19 · Work-Run Lifecycle\n",
    "utf8"
  );
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

const runsDir = (mDir) => path.join(mDir, "runs");

export const runLifecycleRestartTests = [
  // ══ Scenario: the full lifecycle driven entirely through the commands ══════
  {
    name: "run-restart/02 the full run lifecycle is driven entirely through the registered commands",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        const specBefore = await readFile(path.join(mDir, "SPEC.md"), "utf8");

        const start = runCli(root, ["work", "run-start", "19"]);
        assert.equal(start.status, 0, `run-start exits 0 (stderr: ${start.stderr})`);

        const status1 = runCli(root, ["work", "run-status", "19", "--json"]);
        const s1 = JSON.parse(status1.stdout);
        assert.equal(s1.runs.length, 1, "one run after start");
        assert.equal(s1.runs[0].state, "running", "the run is running");
        assert.equal(s1.runs[0].outcome, null, "the run's outcome is null");
        const startedRunId = s1.runs[0].runId;

        const complete = runCli(root, ["work", "run-complete", "19", "--outcome", "done"]);
        assert.equal(complete.status, 0, `run-complete exits 0 (stderr: ${complete.stderr})`);

        const status2 = runCli(root, ["work", "run-status", "19", "--json"]);
        const s2 = JSON.parse(status2.stdout);
        assert.equal(s2.runs.length, 1, "still one run after complete");
        assert.equal(s2.runs[0].state, "done", "the run is in state done");
        assert.equal(s2.runs[0].outcome, "done", "the run's outcome is done");
        // the same runId across the start, status and complete calls
        assert.equal(s2.runs[0].runId, startedRunId, "the runId is stable across start/status/complete");

        // no item record doc was edited to record any of this
        const specAfter = await readFile(path.join(mDir, "SPEC.md"), "utf8");
        assert.equal(specAfter, specBefore, "the milestone's record doc is byte-unchanged");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the recorded run state survives a restart with every field ═══
  {
    name: "run-restart/02 the recorded run state survives a restart with every frozen field intact",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // Started in ONE process with a session + a brief, then that process exits.
        const briefJson = '{"initiator":"operator","resources":["a","b"]}';
        const start = runCli(root, ["work", "run-start", "19", "--session", "sess-9", "--brief", briefJson, "--json"]);
        assert.equal(start.status, 0, `run-start exits 0 (stderr: ${start.stderr})`);
        const minted = JSON.parse(start.stdout);

        // A FRESH process re-loads the persisted run from runs/.
        const fresh = runCli(root, ["work", "run-status", "19", "--json"]);
        assert.equal(fresh.status, 0, `fresh run-status exits 0 (stderr: ${fresh.stderr})`);
        const parsed = JSON.parse(fresh.stdout);

        assert.equal(parsed.runs.length, 1, "the runs array carries exactly one run");
        const [reloaded] = parsed.runs;
        // every frozen ADR-003 field byte-for-byte intact
        assert.equal(reloaded.runId, minted.runId, "the runId is exactly the one the start minted");
        assert.equal(reloaded.state, "running", "the state is running");
        assert.equal(reloaded.outcome, null, "the outcome is null");
        assert.equal(reloaded.attempt, 1, "the attempt is 1");
        assert.equal(reloaded.sessionId, "sess-9", "the sessionId is sess-9");
        assert.deepEqual(reloaded.brief, JSON.parse(briefJson), "the brief is byte-equal to the brief first passed");
        assert.equal(JSON.stringify(reloaded.brief), JSON.stringify(JSON.parse(briefJson)), "the brief serializes identically");
        assert.equal(reloaded.createdAt, minted.createdAt, "createdAt equals the value first recorded");
        assert.equal(reloaded.itemRef, "19", "the itemRef is 19");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a completed run survives a restart with its terminal outcome ═
  {
    name: "run-restart/02 a completed run survives a restart with its terminal outcome and bumped updatedAt",
    async run() {
      const { root } = await buildFixture();
      try {
        // Started then completed (outcome failed) in one process flow, which exits.
        const start = runCli(root, ["work", "run-start", "19", "--json"]);
        const minted = JSON.parse(start.stdout);
        const complete = runCli(root, ["work", "run-complete", "19", "--outcome", "failed", "--json"]);
        assert.equal(complete.status, 0, `run-complete exits 0 (stderr: ${complete.stderr})`);

        // A FRESH process re-loads the completed run from runs/.
        const fresh = runCli(root, ["work", "run-status", "19", "--json"]);
        const parsed = JSON.parse(fresh.stdout);
        assert.equal(parsed.runs.length, 1, "the runs array carries the run");
        const [reloaded] = parsed.runs;
        assert.equal(reloaded.runId, minted.runId, "the same run survives");
        assert.equal(reloaded.state, "failed", "the run is in state failed");
        assert.equal(reloaded.outcome, "failed", "the outcome is failed");
        assert.ok(reloaded.updatedAt >= reloaded.createdAt, "updatedAt is at or after createdAt (the transition was persisted)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: run-status reflects the on-disk runs/ including after a prune ═
  {
    name: "run-restart/02 run-status reflects the on-disk runs/ including after a prune",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // item 19 has 2 persisted runs, one done and one running.
        const firstStart = runCli(root, ["work", "run-start", "19", "--json"]);
        const firstRunId = JSON.parse(firstStart.stdout).runId;
        runCli(root, ["work", "run-complete", "19", "--run", firstRunId, "--outcome", "done", "--json"]);
        const secondStart = runCli(root, ["work", "run-start", "19", "--json"]);
        const runningRunId = JSON.parse(secondStart.stdout).runId;

        const specBefore = await readFile(path.join(mDir, "SPEC.md"), "utf8");

        const before = JSON.parse(runCli(root, ["work", "run-status", "19", "--json"]).stdout);
        assert.equal(before.runs.length, 2, "both runs are carried before the prune");
        const stateById = Object.fromEntries(before.runs.map((run) => [run.runId, run.state]));
        assert.equal(stateById[firstRunId], "done", "the first run is done");
        assert.equal(stateById[runningRunId], "running", "the second run is running");

        // The done run's record file is pruned (deleted off disk).
        await unlink(path.join(runsDir(mDir), `${firstRunId}.json`));

        // A FRESH process reads only the surviving running run.
        const after = JSON.parse(runCli(root, ["work", "run-status", "19", "--json"]).stdout);
        assert.equal(after.runs.length, 1, "only the running run remains after the prune");
        assert.equal(after.runs[0].runId, runningRunId, "the survivor is the running run");

        // pruning the done run changed item 19 frontmatter status not at all
        const specAfter = await readFile(path.join(mDir, "SPEC.md"), "utf8");
        assert.equal(specAfter, specBefore, "the milestone's record doc / frontmatter is byte-unchanged by the prune");
        // the runs/ dir still exists on disk with exactly one file
        const remaining = (await readdir(runsDir(mDir))).filter((name) => name.endsWith(".json"));
        assert.deepEqual(remaining, [`${runningRunId}.json`], "the runs/ dir reflects the prune (one file)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

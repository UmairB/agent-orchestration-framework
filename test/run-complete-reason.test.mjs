// Traceability wiring for milestone 20 / story 01 — work:run-complete --reason.
//
// Covers EVERY @executable scenario in tasks/04_run-complete-reason.feature, driving
// the REAL CLI through child processes against a temp fixture repo. One test object
// per @executable scenario (Scenario-Outline rows folded into one entry iterating the
// rows), each name tracing to feature + scenario. node:assert/strict.
//
//   04_run-complete-reason.feature — --reason records failureReason on a FAILED
//     completion (timeout/agent_error/runtime_offline); an unrecognised reason is
//     recorded verbatim + exit 0; a reason is ignored on done/cancelled (failureReason
//     null); failed with no --reason → failureReason null; the single-envelope discipline.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-complete-reason-"));
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
  // status not-started: the failed-path rollback (rollback fires only FROM in-progress)
  // is a no-op here, so each scenario isolates the failureReason behaviour cleanly.
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "20", slug: "autonomous-run-resilience", status: "not-started", title: '"Autonomous Run Resilience"', created: "2026-06-30", updated: "2026-06-30" }) + "# 20 · Autonomous Run Resilience\n",
    "utf8"
  );
  return { root, mDir };
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// item 20 has a single running run (minted via the real CLI).
function startRun(root) {
  const result = runCli(root, ["work", "run-start", "20", "--json"]);
  assert.equal(result.status, 0, `seed run-start exits 0 (stderr: ${result.stderr})`);
  return JSON.parse(result.stdout).runId;
}

export const runCompleteReasonTests = [
  // ══ Scenario Outline: --outcome failed --reason records the failureReason ═══
  {
    name: "run-complete-reason/04 run-complete --outcome failed --reason records the failureReason on the run",
    async run() {
      for (const reason of ["timeout", "agent_error", "runtime_offline"]) {
        const { root } = await buildFixture();
        try {
          startRun(root);
          const result = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--reason", reason, "--json"]);
          assert.equal(result.status, 0, `run-complete failed --reason ${reason} exits 0 (stderr: ${result.stderr})`);
          const record = JSON.parse(result.stdout);
          assert.equal(record.state, "failed", "the JSON record state is failed");
          assert.equal(record.failureReason, reason, `the JSON record failureReason is ${reason}`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: an unrecognised reason is recorded verbatim, exit 0 ══════════
  {
    name: "run-complete-reason/04 run-complete records an unrecognised reason verbatim, leaving the classifier to fail closed",
    async run() {
      const { root } = await buildFixture();
      try {
        startRun(root);
        const result = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--reason", "some_other_kind", "--json"]);
        assert.equal(result.status, 0, "an unrecognised reason exits zero (the command does not police the vocabulary)");
        const record = JSON.parse(result.stdout);
        assert.equal(record.failureReason, "some_other_kind", "the unrecognised reason is recorded verbatim");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a reason is ignored on a non-failed outcome ══════════
  {
    name: "run-complete-reason/04 a reason is ignored on a non-failed outcome, leaving failureReason null",
    async run() {
      for (const outcome of ["done", "cancelled"]) {
        const { root } = await buildFixture();
        try {
          startRun(root);
          const result = runCli(root, ["work", "run-complete", "20", "--outcome", outcome, "--reason", "timeout", "--json"]);
          assert.equal(result.status, 0, `run-complete ${outcome} --reason timeout exits 0 (stderr: ${result.stderr})`);
          const record = JSON.parse(result.stdout);
          assert.equal(record.state, outcome, `the JSON record state is ${outcome}`);
          assert.equal(record.failureReason, null, `the JSON record failureReason is null on ${outcome}`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: failed with no --reason leaves failureReason null ════════════
  {
    name: "run-complete-reason/04 run-complete failed with no --reason leaves failureReason null and stays backward-compatible",
    async run() {
      const { root } = await buildFixture();
      try {
        startRun(root);
        const result = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--json"]);
        assert.equal(result.status, 0, `run-complete failed (no reason) exits 0 (stderr: ${result.stderr})`);
        const record = JSON.parse(result.stdout);
        assert.equal(record.state, "failed", "the JSON record state is failed");
        assert.equal(record.failureReason, null, "the JSON record failureReason is null with no --reason");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: --reason preserves the single --json envelope discipline ═════
  {
    name: "run-complete-reason/04 run-complete --reason preserves the single --json envelope discipline",
    async run() {
      const { root } = await buildFixture();
      try {
        startRun(root);
        const result = runCli(root, ["work", "run-complete", "20", "--outcome", "failed", "--reason", "timeout", "--json"]);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `stdout is one parseable JSON document (got: ${result.stdout.slice(0, 160)})`);
        assert.ok(parsed !== undefined, "the invocation produced a JSON value");
        const trimmed = result.stdout.trim();
        assert.ok(trimmed.startsWith("{") && trimmed.endsWith("}"), "no human-rendered line precedes or follows the JSON");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

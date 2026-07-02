// Traceability wiring for milestone 20 / story 01 — the CLI face over work:run-retry.
//
// Covers EVERY @executable scenario in tasks/01_run-retry-cli-face.feature, driving
// the REAL CLI through child processes: spawnSync(node, [bin/aof.mjs, …], { cwd })
// against a temp fixture repo. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry iterating the rows), each name
// tracing to feature + scenario. node:assert/strict.
//
//   01_run-retry-cli-face.feature — argv → invoke → render/--json over the registered
//     work:run-retry: the human confirmation + the resumed record under --json
//     (state running, attempt 2, sessionId carried, retryOf linked); --run selects an
//     explicit prior; --max-attempts at the ceiling → { ok:false, …, attempts-exhausted }
//     + non-zero exit; the error envelope matrix; and the single-JSON-document discipline.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
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

// A fixture stream with milestone 20 (slug autonomous-run-resilience).
async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-runretry-cli-"));
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
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "20", slug: "autonomous-run-resilience", status: "in-progress", title: '"Autonomous Run Resilience"', created: "2026-06-30", updated: "2026-06-30" }) + "# 20 · Autonomous Run Resilience\n",
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

// Write a failed run record file directly (13 keys, in order). 20/ADR-006 dedup +
// the need for a SPECIFIC precondition (a failed run at a chosen attempt/reason)
// means the precondition is seeded as a fixture write — the same posture story 00's
// dedup note prescribes. A failed run is terminal, so seeding it never trips dedup.
async function seedFailedRun(mDir, overrides = {}) {
  const runsDir = path.join(mDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const createdAt = overrides.createdAt ?? "2026-06-30T09:00:00.000Z";
  const runId = overrides.runId ?? `${createdAt.replace(/[-:.]/g, "")}-0000`;
  const record = {
    runId,
    itemRef: "20",
    state: "failed",
    attempt: overrides.attempt ?? 1,
    outcome: "failed",
    sessionId: overrides.sessionId ?? null,
    brief: {},
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    failureReason: overrides.failureReason ?? "timeout",
    heartbeatAt: null,
    retryOf: overrides.retryOf ?? null,
    reclaimedAt: overrides.reclaimedAt ?? null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

async function runFileNames(mDir) {
  try {
    return (await readdir(path.join(mDir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

export const runRetryCliFaceTests = [
  // ══ Scenario: run-retry resumes a retryable failed run + renders confirmation
  {
    name: "run-retry-cli-face/01 aof work run-retry resumes a retryable failed run and renders a confirmation",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // item 20 has a failed timeout run with sessionId sess-1 and attempt 1
        const prior = await seedFailedRun(mDir, { sessionId: "sess-1", attempt: 1, failureReason: "timeout" });

        const human = runCli(root, ["work", "run-retry", "20"]);
        assert.equal(human.status, 0, `run-retry exits 0 (stderr: ${human.stderr})`);
        assert.ok(/20/.test(human.stdout), "the confirmation names the ref 20");
        assert.ok(/running/.test(human.stdout), "the confirmation states running");

        // Re-seed a clean failed-only state so the --json retry mints cleanly again
        // (the human retry above left a running run, which dedup would refuse).
        await rm(path.join(mDir, "runs"), { recursive: true, force: true });
        const prior2 = await seedFailedRun(mDir, { sessionId: "sess-1", attempt: 1, failureReason: "timeout" });

        const json = runCli(root, ["work", "run-retry", "20", "--json"]);
        assert.equal(json.status, 0, `run-retry --json exits 0 (stderr: ${json.stderr})`);
        const record = JSON.parse(json.stdout);
        assert.equal(record.state, "running", "the JSON record state is running");
        assert.equal(record.attempt, 2, "the JSON record attempt is 2");
        assert.equal(record.sessionId, "sess-1", "the JSON record sessionId is sess-1 (carried)");
        assert.equal(record.retryOf, prior2.runId, "the JSON record retryOf is the prior run's runId");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: run-retry with --run resumes the named prior run ═════════════
  {
    name: "run-retry-cli-face/01 aof work run-retry with --run resumes the named prior run",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // item 20 has two failed timeout runs — the older one is named via --run
        const older = await seedFailedRun(mDir, { runId: "20260630T090000000Z-0000", createdAt: "2026-06-30T09:00:00.000Z", sessionId: "sess-old", attempt: 1 });
        await seedFailedRun(mDir, { runId: "20260630T100000000Z-0001", createdAt: "2026-06-30T10:00:00.000Z", sessionId: "sess-new", attempt: 1 });

        const json = runCli(root, ["work", "run-retry", "20", "--run", older.runId, "--json"]);
        assert.equal(json.status, 0, `run-retry --run exits 0 (stderr: ${json.stderr})`);
        const record = JSON.parse(json.stdout);
        assert.equal(record.retryOf, older.runId, "the JSON record retryOf is the named older runId");
        assert.equal(record.sessionId, "sess-old", "the resumed session is the older run's session");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: run-retry honours --max-attempts at the ceiling ══════════════
  {
    name: "run-retry-cli-face/01 aof work run-retry honours --max-attempts at the ceiling",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // item 20 has a failed timeout run at attempt 2; --max-attempts 2 is the ceiling
        await seedFailedRun(mDir, { attempt: 2, failureReason: "timeout" });
        const before = await runFileNames(mDir);

        const json = runCli(root, ["work", "run-retry", "20", "--max-attempts", "2", "--json"]);
        assert.notEqual(json.status, 0, `run-retry at the ceiling exits non-zero (got ${json.status})`);
        const parsed = JSON.parse(json.stdout);
        assert.equal(parsed.ok, false, "the envelope is ok:false");
        assert.equal(typeof parsed.error, "string", "the envelope carries an error string");
        assert.equal(parsed.code, "attempts-exhausted", `the envelope code is attempts-exhausted (got ${parsed.code})`);
        // no new run minted
        assert.deepEqual(await runFileNames(mDir), before, "no new run minted at the ceiling");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a bad run-retry invocation emits one error envelope ═══
  {
    name: "run-retry-cli-face/01 a bad run-retry invocation emits one structured error envelope and exits non-zero",
    async run() {
      const rows = [
        { seed: { sessionId: "s", attempt: 1, failureReason: "timeout" }, args: ["run-retry", "99"], code: "ref-not-found" },
        { seed: { sessionId: "s", attempt: 1, failureReason: "timeout" }, args: ["run-retry", "20/99"], code: "ref-not-found" },
        { seed: { sessionId: "s", attempt: 1, failureReason: "agent_error" }, args: ["run-retry", "20"], code: "not-retryable" },
        { seed: { sessionId: "s", attempt: 3, failureReason: "timeout" }, args: ["run-retry", "20"], code: "attempts-exhausted" },
        { seed: null, args: ["run-retry", "20"], code: "no-retryable-run" },
      ];
      for (const { seed, args, code } of rows) {
        const { root, mDir } = await buildFixture();
        try {
          if (seed) await seedFailedRun(mDir, seed);

          const result = runCli(root, ["work", ...args, "--json"]);
          assert.notEqual(result.status, 0, `${args.join(" ")} exits non-zero (got ${result.status})`);
          const parsed = JSON.parse(result.stdout);
          assert.equal(parsed.ok, false, `${args.join(" ")}: the envelope is ok:false`);
          assert.equal(typeof parsed.error, "string", `${args.join(" ")}: the envelope carries an error string`);
          assert.equal(parsed.code, code, `${args.join(" ")}: the envelope code is ${code} (got ${parsed.code})`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: every run-retry --json invocation prints exactly one JSON doc ═
  {
    name: "run-retry-cli-face/01 every run-retry --json invocation prints exactly one parseable JSON document",
    async run() {
      const { root, mDir } = await buildFixture();
      try {
        // Probe a success (a retryable failed run) and an error (no failed run) — both
        // must emit ONE parseable JSON document on stdout, no human line.
        const invocations = [
          { seed: { sessionId: "s", attempt: 1, failureReason: "timeout" }, args: ["work", "run-retry", "20", "--json"] }, // success
          { seed: null, args: ["work", "run-retry", "20", "--json"] }, // error: no-retryable-run
        ];
        for (const { seed, args } of invocations) {
          await rm(path.join(mDir, "runs"), { recursive: true, force: true });
          if (seed) await seedFailedRun(mDir, seed);

          const result = runCli(root, args);
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `${args.join(" ")} stdout is one parseable JSON document (got: ${result.stdout.slice(0, 160)})`);
          assert.ok(parsed !== undefined, `${args.join(" ")} produced a JSON value`);
          const trimmed = result.stdout.trim();
          assert.ok(trimmed.startsWith("{") && trimmed.endsWith("}"), `${args.join(" ")}: no human line precedes or follows the JSON`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

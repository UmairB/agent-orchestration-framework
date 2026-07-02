// Traceability wiring for milestone 19 / story 01 — the CLI face over work:run-*.
//
// Covers EVERY @executable scenario in tasks/01_cli-face.feature, driving the REAL
// CLI through child processes: spawnSync(node, [cli.mjs, …], { cwd }) against a temp
// fixture repo. One test object per @executable scenario (Scenario-Outline rows
// folded into one entry iterating the rows), each name tracing to feature + scenario.
//
//   01_cli-face.feature — argv → invoke → render/--json over the registered
//     commands; the --session/--brief mapping; the --outcome transition; --run
//     disambiguation; the run-status render + { ref, runs } envelope; the error
//     matrix (each code emits one { ok:false, error, code } envelope on stdout +
//     non-zero exit); and the single-parseable-JSON-document discipline.
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

// A fixture stream with milestone 19 (slug work-run-lifecycle).
async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-runcli-"));
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
  return root;
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Start a run via the real CLI and return its minted runId (from the --json record).
function startRunCli(root) {
  const result = runCli(root, ["work", "run-start", "19", "--json"]);
  assert.equal(result.status, 0, `seed run-start exits 0 (stderr: ${result.stderr})`);
  return JSON.parse(result.stdout).runId;
}

// Seed a SECOND running run by writing the record file directly. 20/ADR-006 dedup
// forbids minting a second non-terminal run for an item via the store/CLI, so the
// "several runs in flight" disambiguation cases (the defensive ambiguous-run guard)
// are set up by a direct fixture write — the same posture story 00's dedup feature
// note prescribes for the reserved `queued` precondition.
async function seedRunningRunFile(root, runId, createdAt = "2026-06-29T00:00:00.000Z") {
  const runsDir = path.join(root, "wiki", "work", "19_milestone_work-run-lifecycle", "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    runId, itemRef: "19", state: "running", attempt: 1, outcome: null, sessionId: null,
    brief: {}, createdAt, updatedAt: createdAt,
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
}

export const runCliFaceTests = [
  // ══ Scenario: run-start starts a run and renders a confirmation ════════════
  {
    name: "run-cli-face/01 aof work run-start starts a run and renders a confirmation",
    async run() {
      const root = await buildFixture();
      try {
        const human = runCli(root, ["work", "run-start", "19"]);
        assert.equal(human.status, 0, `run-start exits 0 (stderr: ${human.stderr})`);
        assert.ok(/19/.test(human.stdout), "the confirmation names the ref 19");
        assert.ok(/running/.test(human.stdout), "the confirmation states running");

        // Free the item before the second start (20/ADR-006 dedup forbids a second
        // non-terminal run) so the --json start mints cleanly.
        runCli(root, ["work", "run-complete", "19", "--outcome", "done"]);
        const json = runCli(root, ["work", "run-start", "19", "--json"]);
        assert.equal(json.status, 0, `run-start --json exits 0 (stderr: ${json.stderr})`);
        const record = JSON.parse(json.stdout);
        assert.equal(record.state, "running", "the JSON record state is running");
        assert.equal(record.outcome, null, "the JSON record outcome is null");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: run-start maps --session and --brief onto the record ═════════
  {
    name: "run-cli-face/01 aof work run-start maps --session and --brief onto the run record",
    async run() {
      const root = await buildFixture();
      try {
        const result = runCli(root, ["work", "run-start", "19", "--session", "sess-7", "--brief", '{"initiator":"operator"}', "--json"]);
        assert.equal(result.status, 0, `run-start exits 0 (stderr: ${result.stderr})`);
        const record = JSON.parse(result.stdout);
        assert.equal(record.sessionId, "sess-7", "the session id is recorded");
        assert.equal(record.brief.initiator, "operator", "the brief carries the initiator field passed");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: run-complete transitions to the chosen outcome ═══════
  {
    name: "run-cli-face/01 aof work run-complete transitions the running run to the chosen outcome",
    async run() {
      for (const outcome of ["done", "failed", "cancelled"]) {
        const root = await buildFixture();
        try {
          // item 19 has a single running run
          startRunCli(root);
          const result = runCli(root, ["work", "run-complete", "19", "--outcome", outcome, "--json"]);
          assert.equal(result.status, 0, `run-complete ${outcome} exits 0 (stderr: ${result.stderr})`);
          const record = JSON.parse(result.stdout);
          assert.equal(record.state, outcome, `the JSON record state is ${outcome}`);
          assert.equal(record.outcome, outcome, `the JSON record outcome is ${outcome}`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: run-complete --run completes the named run ═══════════════════
  {
    name: "run-cli-face/01 aof work run-complete with --run completes the named run when several are in flight",
    async run() {
      const root = await buildFixture();
      try {
        // item 19 has two running runs — the second seeded directly, as 20/ADR-006
        // dedup forbids minting a second non-terminal run via the CLI.
        const first = startRunCli(root);
        await seedRunningRunFile(root, "20260629T000000000Z-9000");

        const result = runCli(root, ["work", "run-complete", "19", "--run", first, "--outcome", "done", "--json"]);
        assert.equal(result.status, 0, `run-complete --run exits 0 (stderr: ${result.stderr})`);
        const record = JSON.parse(result.stdout);
        assert.equal(record.runId, first, "the completed run is the named first runId");
        assert.equal(record.state, "done", "its state is done");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: run-status renders the run history + --json envelope ═════════
  {
    name: "run-cli-face/01 aof work run-status renders the item's run history",
    async run() {
      const root = await buildFixture();
      try {
        // item 19 has 2 persisted runs over its lifetime — the first completed before
        // the second is started (20/ADR-006 dedup), so one is done and one running.
        const first = startRunCli(root);
        runCli(root, ["work", "run-complete", "19", "--outcome", "done"]);
        const second = startRunCli(root);

        const json = runCli(root, ["work", "run-status", "19", "--json"]);
        assert.equal(json.status, 0, `run-status --json exits 0 (stderr: ${json.stderr})`);
        const parsed = JSON.parse(json.stdout);
        assert.equal(parsed.ref, "19", "the JSON ref is 19");
        assert.ok(Array.isArray(parsed.runs), "runs is an array");
        assert.equal(parsed.runs.length, 2, "both runs are carried");

        const human = runCli(root, ["work", "run-status", "19"]);
        assert.equal(human.status, 0, `run-status exits 0 (stderr: ${human.stderr})`);
        for (const runId of [first, second]) {
          assert.ok(human.stdout.includes(runId), `the render lists run ${runId}`);
        }
        assert.ok(/running/.test(human.stdout), "the render lists each run's state");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a bad invocation emits one structured error envelope ═
  {
    name: "run-cli-face/01 a bad invocation emits one structured error envelope and exits non-zero",
    async run() {
      // Each row: a precondition setup, the CLI invocation, the expected code.
      const rows = [
        { setup: () => {}, invocation: ["run-start", "99"], code: "ref-not-found" },
        { setup: startRunCli, invocation: ["run-complete", "99", "--outcome", "done"], code: "ref-not-found" },
        { setup: startRunCli, invocation: ["run-complete", "19", "--outcome", "bogus"], code: "invalid-outcome" },
        { setup: startRunCli, invocation: ["run-complete", "19", "--outcome", ""], code: "invalid-outcome" },
        { setup: () => {}, invocation: ["run-complete", "19", "--outcome", "done"], code: "no-running-run" },
        { setup: "terminal", invocation: null, code: "illegal-transition" },
      ];
      for (const { setup, invocation, code } of rows) {
        const root = await buildFixture();
        try {
          let inv = invocation;
          if (setup === "terminal") {
            // item 19 has a run already in state done — re-completing it is illegal.
            const runId = startRunCli(root);
            const done = runCli(root, ["work", "run-complete", "19", "--outcome", "done", "--json"]);
            assert.equal(done.status, 0, "the seed run completes to done");
            inv = ["run-complete", "19", "--run", runId, "--outcome", "failed"];
          } else {
            setup(root);
          }

          const result = runCli(root, ["work", ...inv, "--json"]);
          // exits non-zero
          assert.notEqual(result.status, 0, `${inv.join(" ")} exits non-zero (got ${result.status})`);
          // stdout is a single parseable { ok:false, error, code:<code> } envelope
          const parsed = JSON.parse(result.stdout);
          assert.equal(parsed.ok, false, `${inv.join(" ")}: the envelope is ok:false`);
          assert.equal(typeof parsed.error, "string", `${inv.join(" ")}: the envelope carries an error string`);
          assert.equal(parsed.code, code, `${inv.join(" ")}: the envelope code is ${code} (got ${parsed.code})`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: every --json invocation prints exactly one JSON document ═════
  {
    name: "run-cli-face/01 every --json invocation prints exactly one parseable JSON document",
    async run() {
      const root = await buildFixture();
      try {
        // Probe a success (run-start) and an error (run-complete with nothing in
        // flight) — both must emit ONE parseable JSON document, no human line.
        const invocations = [
          ["work", "run-start", "19", "--json"],
          ["work", "run-status", "19", "--json"],
          ["work", "run-complete", "19", "--outcome", "done", "--json"], // success: completes the run-start above's run
          ["work", "run-complete", "19", "--outcome", "done", "--json"], // error: no-running-run now
        ];
        for (const inv of invocations) {
          const result = runCli(root, inv);
          // stdout parses as exactly one JSON document (JSON.parse rejects trailing
          // text / a human line before or after).
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `${inv.join(" ")} stdout is one parseable JSON document (got: ${result.stdout.slice(0, 160)})`);
          assert.ok(parsed !== undefined, `${inv.join(" ")} produced a JSON value`);
          // no human-rendered line: the stdout, trimmed, starts with { and ends with }
          const trimmed = result.stdout.trim();
          assert.ok(trimmed.startsWith("{") && trimmed.endsWith("}"), `${inv.join(" ")}: no human line precedes or follows the JSON`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Craft (review NIT 4): a malformed --brief is an HONEST coded input fault ═
  // The CLI face must not leak a raw V8 parser message under a generic code:"error";
  // a bad --brief is a 400 invalid-brief, emitted as the single { ok:false, error, code }
  // envelope on stdout + a non-zero exit — the 08/ADR-003 error-envelope discipline.
  {
    name: "run-cli-face/01 a malformed --brief emits one invalid-brief envelope and exits non-zero",
    async run() {
      const root = await buildFixture();
      try {
        const result = runCli(root, ["work", "run-start", "19", "--brief", "{not valid json", "--json"]);
        assert.notEqual(result.status, 0, "a malformed --brief exits non-zero");
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.ok, false, "the envelope is ok:false");
        assert.equal(parsed.code, "invalid-brief", "the envelope code is invalid-brief (not a generic 'error')");
        assert.equal(typeof parsed.error, "string", "the envelope carries an error string");
        const trimmed = result.stdout.trim();
        assert.ok(trimmed.startsWith("{") && trimmed.endsWith("}"), "exactly one JSON envelope, no human line");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

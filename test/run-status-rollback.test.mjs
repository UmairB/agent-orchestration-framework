// Traceability wiring for milestone 20 / story 01 — rollbackItemStatus, the first
// item-frontmatter writer (ADR-005).
//
// Covers EVERY @executable scenario in tasks/02_status-rollback.feature. A mix of
// DIRECT rollbackItemStatus calls (imported from ../src/work.mjs) over a controlled
// fixture, and the CLI / restart-reclaim wiring scenarios driven through the real
// CLI. One test object per @executable scenario (Scenario-Outline rows folded into
// one entry iterating the rows), each name tracing to feature + scenario.
//
//   02_status-rollback.feature — rollbackItemStatus(item, toStatus) sets status ONLY
//     from in-progress to not-started|blocked, touching only the status line (body +
//     every other frontmatter key byte-unchanged); a forbidden target → forbidden-rollback;
//     a from-state ≠ in-progress → rollback-not-applicable; the write is atomic (no
//     .tmp- artifact); a failed completion AND a reclaim roll the in-progress item back;
//     and a rolled-back not-started item is re-offered by aof work next.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollbackItemStatus } from "../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A multi-line, multi-key milestone record doc (status NOT the first nor last key,
// so the "only the status line changes" claim is exercised against neighbours).
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
    "depends: []",
    "---",
    "# 20 · Autonomous Run Resilience",
    "",
    "Body line one — must stay byte-identical.",
    "Body line two.",
    "",
  ].join("\n");
}

async function buildFixture({ status = "in-progress" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-rollback-"));
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
  return { root, workDir, mDir, specPath: path.join(mDir, "SPEC.md") };
}

// The item shape rollbackItemStatus consumes: { ref, dir, type } (recordDoc keys off
// item.type → milestone = SPEC.md).
function milestoneItem(mDir) {
  return { ref: "20", dir: mDir, type: "milestone" };
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Parse just the frontmatter block into an ordered list of [key, value] pairs — so a
// test can assert "every OTHER key byte-unchanged" without depending on the loose
// work.mjs scalar parser.
function frontmatterPairs(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return [];
  return block[1].split(/\r?\n/).map((line) => {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    return kv ? [kv[1], kv[2]] : ["", line];
  });
}

function bodyOf(text) {
  const block = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
  return block ? text.slice(block[0].length) : text;
}

async function seedRunFile(mDir, overrides = {}) {
  const runsDir = path.join(mDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const createdAt = overrides.createdAt ?? "2026-06-30T09:00:00.000Z";
  const runId = overrides.runId ?? `${createdAt.replace(/[-:.]/g, "")}-0000`;
  const record = {
    runId,
    itemRef: "20",
    state: overrides.state ?? "running",
    attempt: overrides.attempt ?? 1,
    outcome: overrides.outcome ?? null,
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

async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}" (got "${caught?.code}")`);
}

export const runStatusRollbackTests = [
  // ══ Scenario Outline: rollback to a legal target, touching only the status field
  {
    name: "run-status-rollback/02 rollback sets status from in-progress to a legal target, touching only the status field",
    async run() {
      for (const target of ["not-started", "blocked"]) {
        const { root, mDir, specPath } = await buildFixture({ status: "in-progress" });
        try {
          const before = await readFile(specPath, "utf8");
          const beforePairs = frontmatterPairs(before);

          const result = await rollbackItemStatus(milestoneItem(mDir), target);
          assert.deepEqual(result, { ref: "20", status: target }, `rollback returns { ref, status: ${target} }`);

          const after = await readFile(specPath, "utf8");
          const afterPairs = frontmatterPairs(after);

          // the status field is the target
          assert.equal(afterPairs.find(([k]) => k === "status")[1], target, `frontmatter status is ${target}`);
          // the body is byte-unchanged
          assert.equal(bodyOf(after), bodyOf(before), "the record-doc body is byte-unchanged");
          // every OTHER frontmatter key (including updated) is byte-unchanged
          assert.equal(afterPairs.length, beforePairs.length, "no frontmatter key was added or dropped");
          for (let i = 0; i < beforePairs.length; i += 1) {
            const [bk, bv] = beforePairs[i];
            const [ak, av] = afterPairs[i];
            assert.equal(ak, bk, `frontmatter key order is preserved at ${i}`);
            if (bk === "status") continue;
            assert.equal(av, bv, `frontmatter key "${bk}" is byte-unchanged`);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: rolling back to a non-legal target is forbidden ══════
  {
    name: "run-status-rollback/02 rolling back to any non-legal target is forbidden and writes nothing",
    async run() {
      for (const target of ["done", "in-review", "in-progress"]) {
        const { root, mDir, specPath } = await buildFixture({ status: "in-progress" });
        try {
          const before = await readFile(specPath, "utf8");
          await assertRejectsWithCode(() => rollbackItemStatus(milestoneItem(mDir), target), "forbidden-rollback");
          const after = await readFile(specPath, "utf8");
          assert.equal(after, before, `→ ${target} wrote nothing (record doc byte-identical)`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: rollback fires only from in-progress ═════════════════
  {
    name: "run-status-rollback/02 rollback fires only from in-progress, rejecting any other from-state",
    async run() {
      for (const from of ["not-started", "blocked", "in-review", "done"]) {
        const { root, mDir, specPath } = await buildFixture({ status: from });
        try {
          const before = await readFile(specPath, "utf8");
          await assertRejectsWithCode(() => rollbackItemStatus(milestoneItem(mDir), "not-started"), "rollback-not-applicable");
          const after = await readFile(specPath, "utf8");
          assert.equal(after, before, `from ${from}: the record doc is byte-unchanged`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: the rollback writes the record doc atomically ════════════════
  {
    name: "run-status-rollback/02 the rollback writes the record doc atomically, leaving no torn or temp file",
    async run() {
      const { root, mDir, specPath } = await buildFixture({ status: "in-progress" });
      try {
        await rollbackItemStatus(milestoneItem(mDir), "not-started");

        // the record doc reloads as a complete, parseable document (frontmatter + body)
        const reloaded = await readFile(specPath, "utf8");
        const pairs = frontmatterPairs(reloaded);
        assert.ok(pairs.length > 0, "the reloaded doc has a parseable frontmatter block");
        assert.equal(pairs.find(([k]) => k === "status")[1], "not-started", "the reloaded status is not-started");
        assert.ok(reloaded.includes("# 20 · Autonomous Run Resilience"), "the reloaded doc carries its body heading");

        // no .tmp- artifact remains beside the record doc
        const siblings = await readdir(mDir);
        const tmp = siblings.filter((name) => name.includes(".tmp-") || name.includes(".tmp"));
        assert.deepEqual(tmp, [], `no temp artifact remains beside the record doc (saw ${siblings.join(", ")})`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a failed completion rolls its in-progress item back ══════════
  {
    name: "run-status-rollback/02 a run completed as failed rolls its in-progress item back to not-started",
    async run() {
      const { root, mDir, specPath } = await buildFixture({ status: "in-progress" });
      try {
        // item 20 has a single running run + frontmatter status in-progress
        await seedRunFile(mDir, { state: "running" });

        const complete = runCli(root, ["work", "run-complete", "20", "--outcome", "failed"]);
        assert.equal(complete.status, 0, `run-complete failed exits 0 (stderr: ${complete.stderr})`);

        const after = await readFile(specPath, "utf8");
        const status = frontmatterPairs(after).find(([k]) => k === "status")[1];
        assert.equal(status, "not-started", "item 20 frontmatter status is rolled back to not-started");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a reclaimed stale run rolls its in-progress item back ════════
  {
    name: "run-status-rollback/02 a reclaimed stale run rolls its in-progress item back to not-started",
    async run() {
      const { root, mDir, specPath } = await buildFixture({ status: "in-progress" });
      try {
        // item 20 has a STALE running orphan (heartbeat far in the past) + in-progress.
        // Driving run-start runs the restart-time reclaim scan first: it force-fails the
        // orphan, rolls status back, THEN mints a fresh run (dedup is now satisfied).
        await seedRunFile(mDir, {
          runId: "20200101T000000000Z-0000",
          createdAt: "2020-01-01T00:00:00.000Z",
          state: "running",
          heartbeatAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        });

        const start = runCli(root, ["work", "run-start", "20"]);
        assert.equal(start.status, 0, `run-start over a stale orphan exits 0 (stderr: ${start.stderr})`);

        const after = await readFile(specPath, "utf8");
        const status = frontmatterPairs(after).find(([k]) => k === "status")[1];
        assert.equal(status, "not-started", "item 20 frontmatter status is rolled back to not-started by the reclaim");

        // the orphan is now failed / runtime_offline / has a reclaimedAt stamp
        const statusJson = runCli(root, ["work", "run-status", "20", "--json"]);
        const runs = JSON.parse(statusJson.stdout).runs;
        const orphan = runs.find((run) => run.runId === "20200101T000000000Z-0000");
        assert.ok(orphan, "the orphan is in the run history");
        assert.equal(orphan.state, "failed", "the orphan was force-failed");
        assert.equal(orphan.failureReason, "runtime_offline", "the orphan's failureReason is runtime_offline");
        assert.ok(orphan.reclaimedAt, "the orphan carries a reclaimedAt stamp");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a rolled-back item is re-offered by aof work next ════════════
  {
    name: "run-status-rollback/02 a rolled-back item is re-offered by aof work next",
    async run() {
      const { root, mDir } = await buildFixture({ status: "in-progress" });
      try {
        // roll item 20 back to not-started (its dependencies — none — are satisfied)
        await rollbackItemStatus(milestoneItem(mDir), "not-started");

        const next = runCli(root, ["work", "next", "--json"]);
        assert.equal(next.status, 0, `work next exits 0 (stderr: ${next.stderr})`);
        const parsed = JSON.parse(next.stdout);
        assert.equal(parsed.state, "ready", "next offers an actionable item");
        assert.equal(parsed.ref, "20", "item 20 is the offered actionable item");
        assert.equal(parsed.status, "not-started", "it is offered as not-started");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

// Traceability wiring for milestone 20 / story 01 — the work:run-retry command.
//
// Covers EVERY @executable scenario in tasks/00_run-retry-command.feature,
// exercising the REAL in-process registry (src/command-core.mjs +
// src/commands/run-retry.mjs over story 00's src/run-store.mjs) against a temp
// fixture repo — loadWorkspace + invoke, real fs, in-process. One test object per
// @executable scenario (Scenario-Outline rows folded into one entry iterating the
// rows), each name tracing to feature + scenario. node:assert/strict.
//
//   00_run-retry-command.feature — work:run-retry registers into the SAME core with
//     the frozen {id,input,run,cli} shape; it RESUMES the prior session on an
//     incremented, linked lineage (sessionId carried, attempt+1, retryOf); it
//     resolves EXACT (a typo retries no run on the wrong item); it surfaces the
//     store's coded rejections (not-retryable / attempts-exhausted / no-retryable-run)
//     minting no run; and it selects the prior by runId else the most-recent failed run.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace, findWork } from "../src/work.mjs";
import { getCommand, listCommands, invoke } from "../src/command-core.mjs";

const FROZEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt", "node", "resumeAfter"];

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-runretry-cmd-"));
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

// The milestone 20 fixture + a story 20/00 (slug "resilience-core"). The story slug
// + the milestone slug give the free-text fragments the EXACT write resolver then
// rejects (row.ref !== the fragment) → ref-not-found, with no run retried.
async function buildStream(workDir, { status = "in-progress" } = {}) {
  const mDir = path.join(workDir, "20_milestone_autonomous-run-resilience");
  const sDir = path.join(mDir, "stories", "00_story_resilience-core");
  await mkdir(sDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "20", slug: "autonomous-run-resilience", status, title: '"Autonomous Run Resilience"', created: "2026-06-30", updated: "2026-06-30" }) + "# 20 · Autonomous Run Resilience\n",
    "utf8"
  );
  await writeFile(
    path.join(sDir, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "resilience-core", parent: "20", status, title: '"Resilience Core"', created: "2026-06-30", updated: "2026-06-30" }) + "# 00 · Resilience Core\n",
    "utf8"
  );
  return { mDir, sDir };
}

// A milestone-ONLY stream (no story child), so a partial/sibling ref (20/00, 20/99)
// is UNRESOLVABLE through the EXACT resolver — used by the resolve-exact matrix, where
// every non-"20" ref must return ref-not-found and retry no run.
async function buildMilestoneOnly(workDir) {
  const mDir = path.join(workDir, "20_milestone_autonomous-run-resilience");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "20", slug: "autonomous-run-resilience", status: "in-progress", title: '"Autonomous Run Resilience"', created: "2026-06-30", updated: "2026-06-30" }) + "# 20 · Autonomous Run Resilience\n",
    "utf8"
  );
  return { mDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

async function itemRow(workDir, ref) {
  const rows = await findWork(workDir, ref);
  return rows.find((row) => row.ref === ref) ?? rows[0];
}

// Write a run record file directly (13 keys, in order) — 20/ADR-006 dedup forbids
// minting a SPECIFIC precondition (a failed run at a chosen attempt/reason) through
// the store, so a failed-run precondition is seeded as a fixture write.
async function seedRun(workDir, ref, overrides = {}) {
  const row = await itemRow(workDir, ref);
  const runsDir = path.join(row.dir, "runs");
  await mkdir(runsDir, { recursive: true });
  const createdAt = overrides.createdAt ?? "2026-06-30T09:00:00.000Z";
  const runId = overrides.runId ?? `${createdAt.replace(/[-:.]/g, "")}-0000`;
  const record = {
    runId,
    itemRef: ref,
    state: overrides.state ?? "failed",
    attempt: overrides.attempt ?? 1,
    outcome: overrides.outcome ?? (overrides.state === "running" ? null : "failed"),
    sessionId: overrides.sessionId ?? null,
    brief: overrides.brief ?? {},
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

async function assertRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}" (got "${caught?.code}")`);
  return caught;
}

export const runRetryCommandTests = [
  // ══ Scenario: the registry exposes work:run-retry with the frozen shape ═════
  {
    name: "run-retry-command/00 the registry exposes work:run-retry with the frozen command shape",
    async run() {
      const ids = listCommands().map((command) => command.id);
      assert.ok(ids.includes("work:run-retry"), "the registry exposes work:run-retry");
      const command = getCommand("work:run-retry");
      assert.ok(command.input && typeof command.input === "object", "work:run-retry carries an input schema");
      assert.equal(command.run.constructor.name, "AsyncFunction", "work:run-retry run is async");
      assert.ok(command.cli && typeof command.cli === "object", "work:run-retry carries a cli adapter");
      assert.equal(typeof command.cli.argv, "function", "work:run-retry cli.argv is a function");
      assert.equal(typeof command.cli.render, "function", "work:run-retry cli.render is a function");
    },
  },

  // ══ Scenario: work:run-retry resumes the prior session on a linked lineage ══
  {
    name: "run-retry-command/00 work:run-retry resumes the prior session on an incremented, linked lineage",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        await buildStream(workDir);
        const ctx = await ctxFor(repo);

        // item 20 has a failed run with sessionId sess-3, attempt 1, failureReason timeout
        const prior = await seedRun(workDir, "20", { sessionId: "sess-3", attempt: 1, failureReason: "timeout" });

        const result = await invoke("work:run-retry", { ref: "20" }, ctx);
        assert.equal(result.state, "running", "the result run record state is running");
        assert.equal(result.outcome, null, "the result run record outcome is null");
        assert.equal(result.sessionId, "sess-3", "the result run record sessionId is sess-3 (carried)");
        assert.equal(result.attempt, 2, "the result run record attempt is 2");
        assert.equal(result.retryOf, prior.runId, "the result run record retryOf is the prior run's runId");
        // the record carries exactly the frozen fourteen keys
        assert.deepEqual(Object.keys(result), FROZEN_KEYS, "the result is a frozen 14-key run record");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: work:run-retry resolves exact — a typo retries no run ═
  {
    name: "run-retry-command/00 work:run-retry resolves exact — a typo retries no run on the wrong item",
    async run() {
      // Per the feature, EVERY non-"20" ref (a partial/typo/slug/unresolvable ref) must
      // return ref-not-found and retry NO run. The fixture is the milestone "20" ONLY,
      // so 20/00, 20/99, the slug, the partial "2", and "" are all UNRESOLVABLE through
      // the EXACT resolver (no slug fallback) — never the milestone's failed run on a
      // wrong/partial ref. Only the exact "20" resumes.
      const rows = [
        { ref: "20", kind: "resumes" },
        { ref: "20/00", kind: "ref-not-found" },
        { ref: "99", kind: "ref-not-found" },
        { ref: "20/99", kind: "ref-not-found" },
        { ref: "autonomous-run-resilience", kind: "ref-not-found" },
        { ref: "2", kind: "ref-not-found" },
        { ref: "", kind: "ref-not-found" },
      ];
      for (const { ref, kind } of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildMilestoneOnly(workDir);
          const ctx = await ctxFor(repo);
          // item 20 has a retryable failed run
          const prior = await seedRun(workDir, "20", { sessionId: "sess-x", attempt: 1, failureReason: "timeout" });

          if (kind === "resumes") {
            const result = await invoke("work:run-retry", { ref }, ctx);
            assert.equal(result.state, "running", `${ref} resumes the run`);
            assert.equal(result.retryOf, prior.runId, `${ref} links the prior run`);
            assert.equal((await runFiles(workDir, "20")).length, 2, `${ref}: the prior + the resumed run`);
          } else {
            await assertRejectsWithCode(() => invoke("work:run-retry", { ref }, ctx), "ref-not-found");
            // no run retried anywhere: the prior is still failed and the only run on item 20
            assert.deepEqual(await runFiles(workDir, "20"), [`${prior.runId}.json`], `${ref}: no run retried under milestone 20`);
            const after = await readRunFile(workDir, "20", prior.runId);
            assert.equal(after.state, "failed", `${ref}: the failed run is still failed`);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: work:run-retry surfaces the store's coded rejection ═══
  {
    name: "run-retry-command/00 work:run-retry surfaces the store's coded rejection and mints no run",
    async run() {
      const rows = [
        { situation: "a failed agent_error run at attempt 1", seed: { attempt: 1, failureReason: "agent_error" }, error: "not-retryable" },
        { situation: "a failed timeout run at attempt 3", seed: { attempt: 3, failureReason: "timeout" }, error: "attempts-exhausted" },
        { situation: "no failed run at all", seed: null, error: "no-retryable-run" },
      ];
      for (const { situation, seed, error } of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          let beforeFiles = [];
          if (seed) {
            await seedRun(workDir, "20", { sessionId: "sess-y", ...seed });
            beforeFiles = await runFiles(workDir, "20");
          }

          await assertRejectsWithCode(() => invoke("work:run-retry", { ref: "20", maxAttempts: 3 }, ctx), error);
          // no NEW run record is minted for item 20
          assert.deepEqual(await runFiles(workDir, "20"), beforeFiles, `${situation}: no new run minted (${error})`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: work:run-retry targets the runId when given, else most-recent
  {
    name: "run-retry-command/00 work:run-retry targets the runId when given, else the most-recent failed run",
    async run() {
      const rows = [
        { selector: "no runId", expect: "newer" },
        { selector: "older", expect: "older" },
      ];
      for (const { selector, expect } of rows) {
        const { repo, workDir } = await makeRepo();
        try {
          await buildStream(workDir);
          const ctx = await ctxFor(repo);

          // item 20 has two failed timeout runs (older + newer, distinct timestamps)
          const older = await seedRun(workDir, "20", { runId: "20260630T090000000Z-0000", createdAt: "2026-06-30T09:00:00.000Z", sessionId: "sess-old", attempt: 1, failureReason: "timeout" });
          const newer = await seedRun(workDir, "20", { runId: "20260630T100000000Z-0001", createdAt: "2026-06-30T10:00:00.000Z", sessionId: "sess-new", attempt: 1, failureReason: "timeout" });

          const input = { ref: "20" };
          if (selector === "older") input.runId = older.runId;

          const result = await invoke("work:run-retry", input, ctx);
          const target = expect === "older" ? older : newer;
          assert.equal(result.retryOf, target.runId, `${selector}: resumes the ${expect} run`);
          assert.equal(result.sessionId, target.sessionId, `${selector}: carries the ${expect} run's session`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];

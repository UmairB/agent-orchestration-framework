// Fitness functions for m42 wave (d) leg d4, PORT 4 (PRD-command-spine-effects-
// ledger, "cascade-ports"): the Notion status sync is a LEDGERED CONSEQUENCE,
// with an APPLICABILITY PREDICATE deciding what is owed at append time.
//
// THE DEFECT THIS CLOSES. Forgetting to run `aof work integrations notion
// sync-work` after a run completed was INVISIBLE — nothing anywhere recorded
// that the board no longer matches the stream. Now a completion in a
// Notion-configured workspace owes a durable `integration:notion` step. WHO PAYS
// IT is the port's recorded operator decision (2026-07-31): `autoSync: true` ⇒
// the completion's own drain reaches the integration locus and syncs in place;
// absent ⇒ the step stays deferred until the sync-work verb — the operator's
// "do Notion egress now" door — drains it. And the NEW TABLE MACHINERY: a
// consequence that can never apply (no Notion config at all; the worker's
// no-workspace sites) is NOT OWED — evaluated once, by every seam, at append
// time — because a step at a locus nobody drains would otherwise accumulate in
// the journal forever.
//
//   (1) STRUCTURAL — one body, one door, uniform seams: the sync core
//       (`syncMilestoneWork`) is reachable only from the verb + the ledger's
//       reactor; the apply layer + spawn seam are reachable only from the core;
//       every transition seam resolves its reactors through applicableReactors.
//   (2) THE PREDICATE (behavioural, through the REAL seam): an unconfigured
//       workspace's completion materialises NO notion step (non-vacuous: the
//       configured twin materialises it, deferred, with zero egress).
//   (3) RECORD-ONLY → THE VERB PAYS (behavioural): the owed step survives the
//       completion, then `notion:sync-work` drains it — `drained` rides the
//       envelope, the step goes done, and the reactor's own re-projection is a
//       sidecar-deduped no-op (zero egress beyond the verb's own sync).
//   (4) AUTOSYNC (behavioural): with `autoSync: true` the completion itself
//       syncs (spy sees the create egress, the step is done in the same drain),
//       and a SECOND completion over unchanged disk issues ZERO further egress
//       (the lastStatus/lastContentHash dedup — at-least-once redelivery safe).
//   (5) CONTAINMENT: an integration:* step never rides the outbox (workspace-
//       scoped, not node-scoped), and the unscoped crash-recovery sweep does not
//       let a deferred integration backlog consume its fetch window.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECTS, applicableReactors } from "../../src/effects/table.mjs";
import { transitionRunStart, transitionRunComplete } from "../../src/effects/run-transitions.mjs";
import { openEffectsJournal, appendEvent, readEvents, readEventSteps, pendingSteps } from "../../src/effects/journal.mjs";
import { drainEffects, reachableLoci, LOCAL_LOCI } from "../../src/effects/dispatch.mjs";
import { remoteSteps } from "../../src/effects/outbox.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { invoke } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

// The one sync body: its definition, and its two sanctioned callers.
const SYNC_CORE = "src/notion/sync-work.mjs";
const SYNC_CORE_CALLERS = new Set([SYNC_CORE, "src/commands/notion-sync-work.mjs", "src/effects/table.mjs"]);
// The apply layer + the spawn-seam constructor: reachable only from the core
// (applyPlan's definition lives in sync.mjs; makeNotionSpawn's in notion/cli.mjs).
const APPLY_CALLERS = new Set(["src/notion/sync.mjs", SYNC_CORE]);
const SPAWN_SEAM_CALLERS = new Set(["src/notion/cli.mjs", SYNC_CORE]);
// Every transition seam resolves reactors through the append-time applicability
// evaluation — the uniform rule the predicate machinery rides on.
const TRANSITION_SEAMS = [
  "src/effects/run-transitions.mjs",
  "src/effects/doc-transitions.mjs",
  "src/effects/stream-transitions.mjs",
  "src/effects/assignment-transitions.mjs",
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

function frontmatter(fields) {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n`;
}

const NOTION_BLOCK = {
  dataSourceId: "ds-arch",
  tokenEnv: "AOF_ARCH_NOTION_TOKEN",
  statusProperty: "Status",
  statusMap: {
    "not-started": "Not started",
    "in-progress": "In progress",
    "in-review": "In review",
    done: "Done",
  },
  relationProperty: "Sub-tasks",
};

// A workspace fixture: milestone 03 + story 03/01 (both in-progress), with the
// Notion block absent, present, or present-with-autoSync.
async function buildFixture({ notion = null } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-notion-ledgered-"));
  const milestoneDir = path.join(repo, "wiki", "work", "03_milestone_board");
  const storyDir = path.join(milestoneDir, "stories", "01_story_board-ui");
  await mkdir(storyDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: '"03"', slug: "board", status: "in-progress", title: '"Board"' }),
    "utf8",
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: '"01"', slug: "board-ui", parent: '"03"', status: "in-progress", title: '"Board UI"' }),
    "utf8",
  );
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (notion) config.work.integrations = { notion };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    repo,
    story: { ref: "03/01", dir: storyDir, type: "story" },
  };
}

// A spy spawn: records every argv, answers a create with a fresh page id.
function makeSpy() {
  const calls = [];
  let next = 0;
  const spy = async (argv) => {
    calls.push(argv);
    next += 1;
    return { id: `page-${next}` };
  };
  return { spy, calls };
}

async function withIsolation(fn) {
  const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-notion-ledgered-gh-"));
  const env = { ...process.env, AOF_GLOBAL_HOME: globalHome };
  const journalOptions = { env };
  const publisherBase = { globalWorkStoreOptions: { env } };
  try {
    return await fn({ env, journalOptions, publisherBase, globalHome });
  } finally {
    await rm(globalHome, { recursive: true, force: true });
  }
}

async function journalSteps(journalOptions, eventId) {
  const journal = await openEffectsJournal(journalOptions);
  try {
    return readEventSteps(journal, eventId);
  } finally {
    journal.close();
  }
}

export const archTests = [
  {
    name: "arch/m42-d4-port4: one sync body behind one door — core callers, apply layer, spawn seam, and every seam resolving through applicableReactors",
    run: async () => {
      const declared = EFFECTS["run.completed"].find((reactor) => reactor.key === "notion-status-sync");
      assert.ok(declared, "run.completed declares the notion-status-sync reactor");
      assert.equal(declared.locus, "integration:notion", "the sync is an integration:notion-locus consequence");
      assert.equal(typeof declared.applies, "function", "the reactor declares its applicability predicate");
      // Cascade order: the sync reads the ROLLED-BACK status, never the pre-rollback lie.
      const keys = EFFECTS["run.completed"].map((reactor) => reactor.key);
      assert.ok(
        keys.indexOf("rollback-status") < keys.indexOf("notion-status-sync"),
        "rollback-status is declared before notion-status-sync",
      );

      const files = await listSourceFiles(SRC_DIR);
      const offenders = { core: [], apply: [], spawn: [] };
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        const code = stripComments(await readFile(file, "utf8"));
        if (/\bsyncMilestoneWork\s*\(/.test(code) && !SYNC_CORE_CALLERS.has(rel)) offenders.core.push(rel);
        if (/\bapplyPlan\s*\(/.test(code) && !APPLY_CALLERS.has(rel)) offenders.apply.push(rel);
        if (/\bmakeNotionSpawn\s*\(/.test(code) && !SPAWN_SEAM_CALLERS.has(rel)) offenders.spawn.push(rel);
      }
      assert.deepEqual(offenders.core, [], `syncMilestoneWork is reachable only from the verb + the reactor (offenders: ${offenders.core.join(", ")})`);
      assert.deepEqual(offenders.apply, [], `applyPlan is reachable only from the core (offenders: ${offenders.apply.join(", ")})`);
      assert.deepEqual(offenders.spawn, [], `makeNotionSpawn is reachable only from the core (offenders: ${offenders.spawn.join(", ")})`);

      for (const seam of TRANSITION_SEAMS) {
        const code = stripComments(await readFile(path.join(repoRoot, seam), "utf8"));
        assert.ok(/\bapplicableReactors\s*\(/.test(code), `${seam} resolves reactors through applicableReactors`);
        assert.ok(!/\beffectsFor\s*\(/.test(code), `${seam} no longer resolves through bare effectsFor`);
      }
    },
  },

  {
    name: "arch/m42-d4-port4: the applicability predicate — an unconfigured workspace's completion owes NO notion step; the configured twin owes it deferred, with zero egress (behavioural)",
    run: async () => {
      // Unconfigured: the step is never materialised (the permanent-leak fix).
      await withIsolation(async ({ journalOptions, publisherBase }) => {
        const { repo, story } = await buildFixture();
        try {
          const workspace = await loadWorkspace(repo);
          const opts = { workspace, publisherOptions: publisherBase, journalOptions };
          const started = await transitionRunStart(story, {}, opts);
          const completed = await transitionRunComplete(story, { runId: started.record.runId, outcome: "done" }, opts);
          const steps = await journalSteps(journalOptions, completed.eventId);
          assert.ok(steps.length >= 1, "the completion journaled its cascade");
          assert.equal(
            steps.find((step) => step.key === "notion-status-sync"),
            undefined,
            "no notion-status-sync step is owed in an unconfigured workspace",
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });

      // Configured (record-only): the step IS owed — deferred, pending, no egress.
      await withIsolation(async ({ journalOptions, publisherBase }) => {
        const { repo, story } = await buildFixture({ notion: NOTION_BLOCK });
        try {
          const workspace = await loadWorkspace(repo);
          const { spy, calls } = makeSpy();
          const opts = { workspace, publisherOptions: { ...publisherBase, notionSpawn: spy }, journalOptions };
          const started = await transitionRunStart(story, {}, opts);
          const completed = await transitionRunComplete(story, { runId: started.record.runId, outcome: "done" }, opts);
          const outcome = completed.effects.find((entry) => entry.key === "notion-status-sync");
          assert.ok(outcome, "the completion's envelope reports the notion step");
          assert.equal(outcome.status, "deferred", "without autoSync the step is deferred, not executed");
          const step = (await journalSteps(journalOptions, completed.eventId)).find((row) => row.key === "notion-status-sync");
          assert.equal(step?.status, "pending", "the owed sync is durable in the journal");
          assert.equal(calls.length, 0, "record-only means ZERO Notion egress at completion time");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });
    },
  },

  {
    name: "arch/m42-d4-port4: record-only — the sync-work verb pays the owed step, reports it on the envelope, and the reactor's re-projection is sidecar-deduped (behavioural)",
    run: async () => {
      await withIsolation(async ({ env, journalOptions, publisherBase }) => {
        const { repo, story } = await buildFixture({ notion: NOTION_BLOCK });
        try {
          const workspace = await loadWorkspace(repo);
          const { spy, calls } = makeSpy();
          const opts = { workspace, publisherOptions: { ...publisherBase, notionSpawn: spy }, journalOptions };
          const started = await transitionRunStart(story, {}, opts);
          const completed = await transitionRunComplete(story, { runId: started.record.runId, outcome: "done" }, opts);
          assert.equal(calls.length, 0, "the completion itself made no egress");

          const ctx = {
            workspace,
            notionSpawn: spy,
            effectsJournalOptions: journalOptions,
            globalWorkStoreOptions: { env },
          };
          const result = await invoke("notion:sync-work", { milestone: "03" }, ctx);
          assert.equal(result.configured, true, "the verb ran its configured sync");
          const verbCalls = calls.length;
          assert.ok(verbCalls >= 2, "the verb's own sync created the milestone + story pages");
          assert.ok(Array.isArray(result.drained), "the verb reports the owed steps it paid");
          const paid = result.drained.find((entry) => entry.eventId === completed.eventId);
          assert.ok(paid, "the completion's owed step is among the drained entries");
          assert.equal(paid.status, "done", "the owed step was paid");
          assert.equal(paid.ref, "03/01", "the drained entry names the completed item");
          assert.equal(calls.length, verbCalls, "the drained reactor's re-projection was a sidecar no-op — zero egress beyond the verb's own sync");

          const step = (await journalSteps(journalOptions, completed.eventId)).find((row) => row.key === "notion-status-sync");
          assert.equal(step?.status, "done", "the journal records the debt as paid");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });
    },
  },

  {
    name: "arch/m42-d4-port4: autoSync — the completion's own drain performs the sync, and a second completion over unchanged disk issues ZERO further egress (behavioural)",
    run: async () => {
      await withIsolation(async ({ journalOptions, publisherBase }) => {
        const { repo, story } = await buildFixture({ notion: { ...NOTION_BLOCK, autoSync: true } });
        try {
          const workspace = await loadWorkspace(repo);
          assert.deepEqual(
            reachableLoci(workspace),
            [...LOCAL_LOCI, "integration:notion"],
            "autoSync opts the workspace's drains into the integration locus",
          );
          const { spy, calls } = makeSpy();
          const opts = { workspace, publisherOptions: { ...publisherBase, notionSpawn: spy }, journalOptions };

          const started = await transitionRunStart(story, {}, opts);
          const completed = await transitionRunComplete(story, { runId: started.record.runId, outcome: "done" }, opts);
          const outcome = completed.effects.find((entry) => entry.key === "notion-status-sync");
          assert.equal(outcome?.status, "done", "the completion's own drain executed the sync");
          assert.ok(calls.length >= 2, "the sync created the milestone + story pages in place");
          const step = (await journalSteps(journalOptions, completed.eventId)).find((row) => row.key === "notion-status-sync");
          assert.equal(step?.status, "done", "the step is paid in the same drain");

          // Unchanged disk ⇒ the sidecar's lastStatus/lastContentHash decide noop:
          // a redelivered/repeated sync costs nothing (at-least-once safe).
          const before = calls.length;
          const restarted = await transitionRunStart(story, {}, opts);
          const recompleted = await transitionRunComplete(story, { runId: restarted.record.runId, outcome: "done" }, opts);
          const second = recompleted.effects.find((entry) => entry.key === "notion-status-sync");
          assert.equal(second?.status, "done", "the second completion's sync also completes");
          assert.equal(calls.length, before, "…with ZERO further egress — the dedup held");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });
    },
  },

  {
    name: "arch/m42-d4-port4: containment — an integration step never rides the outbox, and the unscoped sweep's fetch window skips the deferred backlog",
    run: async () => {
      await withIsolation(async ({ journalOptions }) => {
        const journal = await openEffectsJournal(journalOptions);
        try {
          const reactors = EFFECTS["run.completed"];
          const { eventId } = appendEvent(
            journal,
            { name: "run.completed", payload: { ref: "03/01", outcome: "done", workspaceRoot: null } },
            reactors.filter((reactor) => reactor.key === "notion-status-sync"),
          );
          // (a) The outbox complement excludes integration:* — workspace-scoped,
          // never shipped to the control node's bridge door.
          const shipped = remoteSteps(journal, { loci: LOCAL_LOCI });
          assert.deepEqual(
            shipped.map((step) => `${step.name}/${step.key}`),
            [],
            "the integration step is not in the outbox work-list",
          );
          // (b) The unscoped crash-recovery sweep fetches only what it can run:
          // the deferred backlog does not consume the limit window (no outcome at
          // all — the step is simply not considered)…
          const sweep = await drainEffects({ journal, loci: LOCAL_LOCI });
          assert.deepEqual(sweep, [], "the unscoped sweep does not fetch the undrainable step");
          // …while the eventId-scoped drain still REPORTS it deferred (the
          // completion envelope's wire).
          const scoped = await drainEffects({ journal, eventId, loci: LOCAL_LOCI });
          assert.equal(scoped.length, 1, "the scoped drain considers the step");
          assert.equal(scoped[0].status, "deferred", "…and reports it deferred");
          // Non-vacuity: the step is still pending for its rightful drain.
          const pending = pendingSteps(journal, { includeFailed: false });
          assert.equal(pending.length, 1, "the owed step survives both passes untouched");
          const events = readEvents(journal, { name: "run.completed" });
          assert.equal(events[0]?.eventId, eventId, "…on the appended event");
        } finally {
          journal.close();
        }
      });
    },
  },
];

// Traceability wiring for milestone 17 / story 01 — --dry-run zero-calls
// (02_dry-run-zero-calls.feature, @executable; ADR-003). One test object per
// @executable scenario.
//
// Background: a CONFIGURED fixture milestone "17" + stories on disk, a sidecar that
// records a page id for "17" and nothing for "17/01"/"17/02", and the Notion-CLI
// spawn seam injected as a SPY via ctx.notionSpawn. The in-process invoke path
// proves the spy is never called on a dry-run; one row also runs the bin for the
// exit-0 / --json contract.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { readMapping } from "../src/notion/mapping.mjs";
import { projectMilestone } from "../src/notion/projection.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const DATA_SOURCE_ID = "ds-fixture";

const NOTION_CONFIG = {
  dataSourceId: DATA_SOURCE_ID,
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: {
    "not-started": "Not started",
    "in-progress": "In progress",
    "in-review": "In review",
    done: "Done",
  },
  relationProperty: "Sub-tasks",
};

// A CONFIGURED fixture project: milestone 17 + two stories, a config WITH a
// work.integrations.notion block, and a sidecar recording a page id for "17" only.
// Statuses are chosen so the milestone differs from its recorded lastStatus (a
// patch op) and the stories have no page id (create ops) — a diverse plan.
async function makeProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-notion-dryrun-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mDir = path.join(workDir, "17_milestone_notion-work-sync");
  const s1 = path.join(mDir, "stories", "01_story_projection");
  const s2 = path.join(mDir, "stories", "02_story_apply");
  await mkdir(s1, { recursive: true });
  await mkdir(s2, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    '---\ntype: milestone\nnumber: 17\nslug: notion-work-sync\ntitle: "Notion Work-Board Sync"\nstatus: in-progress\n---\n# 17\n',
    "utf8"
  );
  await writeFile(
    path.join(s1, "STORY.md"),
    '---\ntype: story\nnumber: 01\nslug: projection\nparent: 17\ntitle: "Projection"\nstatus: in-progress\n---\n# 01\n',
    "utf8"
  );
  await writeFile(
    path.join(s2, "STORY.md"),
    '---\ntype: story\nnumber: 02\nslug: apply\nparent: 17\ntitle: "Apply"\nstatus: not-started\n---\n# 02\n',
    "utf8"
  );
  const config = { name: "fixture", work: { dir: "./wiki/work", integrations: { notion: NOTION_CONFIG } } };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  // The sidecar: a page id for "17" (lastStatus stale so it patches), nothing for
  // the stories (so they create) — a true mixed preview.
  const sidecar = {
    version: 1,
    dataSourceId: DATA_SOURCE_ID,
    entries: { "17": { pageId: "page-M", lastStatus: "Stale option", lastSyncedAt: "2026-06-01T00:00:00Z" } },
  };
  await writeFile(path.join(repo, ".aof", "notion.work-map.json"), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

  return { repo };
}

function runCli(root, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// A recording spawn spy.
function makeSpy() {
  const calls = [];
  const spy = (...args) => {
    calls.push(args);
    return { id: `page-new-${calls.length}` };
  };
  return { spy, calls };
}

const REFS = ["17", "17/01", "17/02"];
const DECISIONS = new Set(["created", "updated", "unchanged", "skipped", "no-op"]);

export const notionDryRunTests = [
  {
    // Scenario: --dry-run computes and prints the full per-item diff for the milestone and its stories
    name: "notion-dry-run/00 --dry-run computes the full per-item diff for the milestone and its stories",
    async run() {
      const { repo } = await makeProject();
      try {
        const workspace = await loadWorkspace(repo);
        const { spy, calls } = makeSpy();
        const result = await invoke("notion:sync-work", { milestone: "17", dryRun: true }, { workspace, notionSpawn: spy });
        const refs = result.items.map((i) => i.ref);
        for (const ref of REFS) assert.ok(refs.includes(ref), `a per-item decision exists for "${ref}"`);
        for (const item of result.items) {
          assert.ok(DECISIONS.has(item.action), `${item.ref}'s decision "${item.action}" is one of the known actions`);
        }
        assert.equal(calls.length, 0, "the dry-run issues zero Notion calls");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --dry-run issues zero Notion calls and creates or patches nothing
    name: "notion-dry-run/01 --dry-run issues zero Notion calls and creates or patches nothing",
    async run() {
      const { repo } = await makeProject();
      try {
        const workspace = await loadWorkspace(repo);
        const { spy, calls } = makeSpy();
        const result = await invoke("notion:sync-work", { milestone: "17", dryRun: true }, { workspace, notionSpawn: spy });
        assert.equal(calls.length, 0, "the injected spawn-seam spy is never called");
        // No create-plan item carries a freshly-assigned page id (nothing was POSTed).
        const created = result.items.filter((i) => i.action === "created");
        assert.ok(created.every((i) => i.pageId == null), "no page is created on the board (no new page id)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --dry-run with --json emits the per-item plan as structured data without writing
    name: "notion-dry-run/02 --dry-run --json emits the per-item plan without writing",
    async run() {
      const { repo } = await makeProject();
      try {
        const r = runCli(repo, ["work", "integrations", "notion", "sync-work", "17", "--dry-run", "--json"]);
        assert.equal(r.status, 0, `the command exits 0 (stderr: ${r.stderr.slice(0, 200)})`);
        const env = JSON.parse(r.stdout);
        assert.equal(env.dryRun, true, "the JSON envelope has dryRun true");
        const refs = env.items.map((i) => i.ref);
        for (const ref of REFS) assert.ok(refs.includes(ref), `the envelope lists a decision for "${ref}"`);
        // The bin path resolves the DEFAULT spawn seam (which throws on a live call);
        // a clean exit-0 over a dry-run proves the seam was never reached.
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the dry-run plan equals the plan the real sync would apply for the same inputs
    name: "notion-dry-run/03 the dry-run plan equals the would-apply plan for the same inputs",
    async run() {
      const { repo } = await makeProject();
      try {
        const workspace = await loadWorkspace(repo);
        const opToAction = { create: "created", patch: "updated", noop: "no-op", skip: "skipped" };

        // Leg 1 (MEANINGFUL): the dry-run plan's per-item op decisions must equal the
        // op decisions the REAL non-dry-run apply path produces over the SAME sidecar +
        // config — a true preview, not an estimate. Run the dry-run FIRST (it makes no
        // writes), then the real apply over the same fixture, and map the real applied
        // actions back to ops via the same correspondence (a real create on the seam ⇒
        // "created" ⇒ op "create"). If the two diverged the preview would be a lie.
        const { spy: drySpy } = makeSpy();
        const dryResult = await invoke("notion:sync-work", { milestone: "17", dryRun: true }, { workspace, notionSpawn: drySpy });
        const dryActionByRef = Object.fromEntries(dryResult.items.map((i) => [i.ref, i.action]));

        const { spy: applySpy } = makeSpy();
        const applyResult = await invoke("notion:sync-work", { milestone: "17", dryRun: false }, { workspace, notionSpawn: applySpy });
        const applyActionByRef = Object.fromEntries(applyResult.items.map((i) => [i.ref, i.action]));

        for (const ref of REFS) {
          assert.ok(dryActionByRef[ref] != null, `the dry-run plan decided "${ref}"`);
          assert.equal(
            dryActionByRef[ref],
            applyActionByRef[ref],
            `the dry-run decision for "${ref}" matches the real apply path's decision`
          );
        }

        // Leg 2 (MEANINGFUL): the per-item ACTIONS the command emits in dry-run mode
        // match the op decisions of the pure would-apply plan (the same opToAction
        // correspondence), proving the preview is the projection, not a re-estimate.
        const items = [
          { ref: "17", type: "milestone", slug: "notion-work-sync", meta: { title: "Notion Work-Board Sync", status: "in-progress" } },
          { ref: "17/01", type: "story", slug: "projection", meta: { title: "Projection", status: "in-progress" } },
          { ref: "17/02", type: "story", slug: "apply", meta: { title: "Apply", status: "not-started" } },
        ];
        const freshMapping = await readMapping(workspace.projectRoot, DATA_SOURCE_ID);
        // (Re-read AFTER the real apply re-records bindings; project the would-apply
        // plan over the post-apply state so it mirrors what a *second* dry-run sees.)
        const reDry = await invoke("notion:sync-work", { milestone: "17", dryRun: true }, { workspace, notionSpawn: makeSpy().spy });
        const reDryActionByRef = Object.fromEntries(reDry.items.map((i) => [i.ref, i.action]));
        const wouldApplyPlan = projectMilestone({ items, config: NOTION_CONFIG, mapping: freshMapping });
        for (const ref of REFS) {
          const op = wouldApplyPlan.ops.find((o) => o.ref === ref);
          assert.equal(reDryActionByRef[ref], opToAction[op.op], `the dry-run decision for "${ref}" matches the would-apply op`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

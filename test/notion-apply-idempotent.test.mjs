// Traceability wiring for milestone 17 / story 01 —
// tasks/01_first-run-creates-resync-updates.feature (the now-@executable MECHANIC
// rows; ADR-003/ADR-001/ADR-002). One test object per offline-provable scenario.
//
// These drive the REAL command (`notion:sync-work`) through the injectable spawn
// seam (ctx.notionSpawn) with a RECORDING spy — NO live token, NO network. They
// prove the milestone's signature claim end-to-end through applyPlan:
//   create → recordPageId → patch-in-place (idempotent update, no duplicates).
//
// The live `ntn api` authenticated round-trip (the real board observable outcome +
// §A6 pacing) stays @manual in the feature; here the spy stands in for the CLI and
// returns a known page id so the create→record→patch mechanic is asserted by
// EXECUTION (not source-grep). Fixture: a real temp workspace mirroring the
// notion-dry-run fixture, but with the sidecar varied per scenario so a single item
// drives create / no-op / patch deterministically.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { readMapping, resolvePageId } from "../src/notion/mapping.mjs";

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

// A CONFIGURED fixture project: milestone 17 only (a single item keeps the create /
// no-op / patch decision unambiguous). `milestoneStatus` sets the on-disk status;
// `sidecar` (optional) seeds `.aof/notion.work-map.json` so the projection resolves
// the create-vs-patch-vs-noop decision from local facts alone (ADR-001/ADR-003).
async function makeProject({ milestoneStatus = "in-progress", sidecar = null } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-notion-apply-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mDir = path.join(workDir, "17_milestone_notion-work-sync");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    `---\ntype: milestone\nnumber: 17\nslug: notion-work-sync\ntitle: "Notion Work-Board Sync"\nstatus: ${milestoneStatus}\n---\n# 17\n`,
    "utf8"
  );
  const config = { name: "fixture", work: { dir: "./wiki/work", integrations: { notion: NOTION_CONFIG } } };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  if (sidecar) {
    await writeFile(path.join(repo, ".aof", "notion.work-map.json"), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  }

  return { repo };
}

// A RECORDING spawn spy: captures every argv and returns a known created-page id so
// the create path's recordPageId has a deterministic id to persist.
function makeRecordingSpy(pageId = "page-new") {
  const calls = [];
  const spy = (argv) => {
    calls.push(argv);
    return { id: pageId };
  };
  return { spy, calls };
}

// Pull the page id off a `pages update --page-id <id>` argv (the patch carries the
// recorded id, never a fresh create).
function pageIdInArgv(argv) {
  const i = argv.indexOf("--page-id");
  return i >= 0 ? argv[i + 1] : null;
}

export const notionApplyIdempotentTests = [
  {
    // Scenario (@executable mechanic): a first sync over an EMPTY sidecar POSTs a page
    // create through the seam, maps it to "created" with the returned page id, AND
    // records that id back into the sidecar (so the next run resolves a patch).
    name: "notion-apply/01 first run creates the page, maps it created, and records the binding",
    async run() {
      const { repo } = await makeProject({ milestoneStatus: "in-progress", sidecar: null });
      try {
        const workspace = await loadWorkspace(repo);
        const { spy, calls } = makeRecordingSpy("page-new");
        const result = await invoke(
          "notion:sync-work",
          { milestone: "17", dryRun: false },
          { workspace, notionSpawn: spy }
        );

        // The seam was called with a `pages create` argv (a PAGE create — never schema).
        assert.equal(calls.length, 1, "the apply path issues exactly one Notion call");
        const argv = calls[0];
        assert.deepEqual(
          argv.slice(0, 3),
          ["api", "pages", "create"],
          `the create argv POSTs a page — got: ${JSON.stringify(argv)}`
        );

        // The ItemResult maps to created + carries the returned page id (ADR-002).
        const item = result.items.find((i) => i.ref === "17");
        assert.ok(item, "a per-item result exists for 17");
        assert.equal(item.action, "created", "the first-run item is reported created");
        assert.equal(item.pageId, "page-new", "the result carries the page id the create returned");

        // The sidecar now records that page id (ADR-001) — proven by reading it back.
        const mapping = await readMapping(workspace.projectRoot, DATA_SOURCE_ID);
        assert.equal(
          resolvePageId(mapping, "17"),
          "page-new",
          "the sidecar records the created page id so the next sync resolves a patch"
        );
        assert.equal(
          mapping.entries["17"].lastStatus,
          "In progress",
          "the sidecar records the mapped lastStatus the create wrote"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  {
    // Scenario (@executable mechanic): a second sync over UNCHANGED disk — the sidecar
    // already records the page id AND a lastStatus matching the mapped on-disk status —
    // issues NO Notion call and reports no-op (idempotent, no duplicate create).
    name: "notion-apply/01 second run over unchanged disk is a no-op — no duplicate create",
    async run() {
      // The sidecar from a prior run: page id recorded, lastStatus == the mapped
      // current on-disk status ("in-progress" → "In progress"), so the projection
      // decides noop (no spawn, no write).
      const sidecar = {
        version: 1,
        dataSourceId: DATA_SOURCE_ID,
        entries: { "17": { pageId: "page-existing", lastStatus: "In progress", lastSyncedAt: "2026-06-01T00:00:00Z" } },
      };
      const { repo } = await makeProject({ milestoneStatus: "in-progress", sidecar });
      try {
        const workspace = await loadWorkspace(repo);
        const { spy, calls } = makeRecordingSpy("page-DUPLICATE");
        const result = await invoke(
          "notion:sync-work",
          { milestone: "17", dryRun: false },
          { workspace, notionSpawn: spy }
        );

        // No spawn at all for the unchanged item — no second create, no duplicate.
        assert.equal(calls.length, 0, "an unchanged item issues zero Notion calls (no duplicate create)");
        const item = result.items.find((i) => i.ref === "17");
        assert.equal(item.action, "no-op", "the unchanged item is reported no-op");
        assert.equal(item.pageId, "page-existing", "the no-op keeps the recorded page id");

        // The recorded page id is untouched (still the single existing page).
        const mapping = await readMapping(workspace.projectRoot, DATA_SOURCE_ID);
        assert.equal(resolvePageId(mapping, "17"), "page-existing", "the recorded binding is unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  {
    // Scenario (@executable mechanic): the on-disk status moved since the last sync —
    // the next run PATCHes the EXISTING page (by its recorded id) in place and reports
    // updated; NO new page is created.
    name: "notion-apply/01 a moved on-disk status patches the existing page in place — no new create",
    async run() {
      // The sidecar records the page id with a STALE lastStatus; on-disk status is now
      // "done" ("Done"), which differs — so the projection decides patch.
      const sidecar = {
        version: 1,
        dataSourceId: DATA_SOURCE_ID,
        entries: { "17": { pageId: "page-existing", lastStatus: "In progress", lastSyncedAt: "2026-06-01T00:00:00Z" } },
      };
      const { repo } = await makeProject({ milestoneStatus: "done", sidecar });
      try {
        const workspace = await loadWorkspace(repo);
        const { spy, calls } = makeRecordingSpy("page-SHOULD-NOT-BE-USED");
        const result = await invoke(
          "notion:sync-work",
          { milestone: "17", dryRun: false },
          { workspace, notionSpawn: spy }
        );

        // Exactly one call, a PAGE update carrying the SAME recorded page id (not a create).
        assert.equal(calls.length, 1, "the moved item issues exactly one Notion call");
        const argv = calls[0];
        assert.deepEqual(
          argv.slice(0, 3),
          ["api", "pages", "update"],
          `the patch argv UPDATEs a page (not a create) — got: ${JSON.stringify(argv)}`
        );
        assert.equal(
          pageIdInArgv(argv),
          "page-existing",
          "the patch targets the SAME recorded page id (update-in-place, not a duplicate create)"
        );

        const item = result.items.find((i) => i.ref === "17");
        assert.equal(item.action, "updated", "the moved item is reported updated");
        assert.equal(item.pageId, "page-existing", "the updated item keeps the existing page id");

        // The sidecar still binds the same page id, now with the freshly written status.
        const mapping = await readMapping(workspace.projectRoot, DATA_SOURCE_ID);
        assert.equal(resolvePageId(mapping, "17"), "page-existing", "no new page id was recorded (in-place patch)");
        assert.equal(mapping.entries["17"].lastStatus, "Done", "the patch re-records the new mapped lastStatus");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

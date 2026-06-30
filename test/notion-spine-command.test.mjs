// Traceability wiring for milestone 17 / story 00 — the registered command + CLI
// dispatch (ADR-002). One test object per @executable scenario / Scenario-Outline
// row of `00_command-registered-and-invokable.feature`.
//
// Background: a CONFIGURED fixture workspace with milestone "17" + its stories on
// disk and a `work.integrations.notion` block; the Notion-CLI spawn seam is stubbed
// to return an empty plan (story 00's configured run is a stub returning empty items
// — the seam is never reached, but a stub is injectable for the contract).
//
// The registry-shape scenario imports getCommand; the CLI scenarios run the bin
// against the configured fixture.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCommand } from "../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A CONFIGURED fixture project: milestone 17 + two stories, a config WITH a
// work.integrations.notion block.
async function makeConfiguredProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-notion-cmd-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mDir = path.join(workDir, "17_milestone_notion-work-sync");
  const s0 = path.join(mDir, "stories", "00_story_notion-sync-spine");
  const s1 = path.join(mDir, "stories", "01_story_projection");
  await mkdir(s0, { recursive: true });
  await mkdir(s1, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 17\nslug: notion-work-sync\nstatus: in-progress\n---\n# 17\n",
    "utf8"
  );
  await writeFile(
    path.join(s0, "STORY.md"),
    "---\ntype: story\nnumber: 00\nslug: notion-sync-spine\nparent: 17\nstatus: in-progress\n---\n# 00\n",
    "utf8"
  );
  await writeFile(
    path.join(s1, "STORY.md"),
    "---\ntype: story\nnumber: 01\nslug: projection\nparent: 17\nstatus: not-started\n---\n# 01\n",
    "utf8"
  );
  const config = {
    name: "fixture",
    work: {
      dir: "./wiki/work",
      integrations: {
        notion: {
          dataSourceId: "ds-fixture",
          tokenEnv: "NOTION_API_TOKEN",
          statusProperty: "Status",
          statusMap: {
            "not-started": "Not started",
            "in-progress": "In progress",
            "in-review": "In review",
            done: "Done",
          },
          relationProperty: "Sub-tasks",
        },
      },
    },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  // The feature Background: "the Notion-CLI spawn seam is stubbed to return an empty
  // plan" — i.e. a configured run that issues ZERO Notion spawns. With story 01's
  // filled apply layer (the apply layer is the sole caller of the spawn seam), the
  // bin-level equivalent of "stubbed / empty plan" is a sidecar in which every item
  // already matches its mapped board option (an all-noop plan) — so the run reaches
  // the spawn seam ZERO times, exits 0, and reports the milestone with a populated
  // items list, exactly the Background's intent (no live Notion egress on this path).
  const noopSidecar = {
    version: 1,
    dataSourceId: "ds-fixture",
    entries: {
      "17": { pageId: "page-M", lastStatus: "In progress", lastSyncedAt: "2026-06-01T00:00:00Z" },
      "17/00": { pageId: "page-S0", lastStatus: "In progress", lastSyncedAt: "2026-06-01T00:00:00Z" },
      "17/01": { pageId: "page-S1", lastStatus: "Not started", lastSyncedAt: "2026-06-01T00:00:00Z" },
    },
  };
  await writeFile(
    path.join(repo, ".aof", "notion.work-map.json"),
    `${JSON.stringify(noopSidecar, null, 2)}\n`,
    "utf8"
  );
  return { repo };
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const notionSpineCommandTests = [
  {
    // Scenario: notion:sync-work is registered in the Command core with the frozen shape
    name: "notion-spine/command/00 notion:sync-work is registered with the frozen { id, input, run, cli } shape",
    async run() {
      const command = getCommand("notion:sync-work");
      assert.ok(command, "notion:sync-work resolves from the registry");
      assert.deepEqual(
        Object.keys(command).sort(),
        ["cli", "id", "input", "run"],
        'its keys are exactly "id", "input", "run", and "cli"'
      );
      assert.equal(command.id, "notion:sync-work", '"id" is "notion:sync-work"');
      assert.equal(typeof command.run, "function", '"run" is callable');
      assert.ok(command.cli && typeof command.cli.argv === "function", 'its "cli" adapter is present and callable');
      assert.equal(typeof command.cli.render, "function", "the cli render is callable");
      assert.equal(typeof command.cli.json, "function", "the cli json projection is callable");
    },
  },
  {
    // Scenario: aof work integrations notion sync-work over a configured fixture exits 0 and reports the milestone
    name: "notion-spine/command/01 a configured sync exits 0 and reports the milestone it synced",
    async run() {
      const { repo } = await makeConfiguredProject();
      try {
        const result = runCli(repo, ["work", "integrations", "notion", "sync-work", "17"]);
        assert.equal(result.status, 0, `the command exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(result.stdout.includes("17"), 'stdout reports the milestone "17" it synced');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --json projects the SyncResult envelope
    name: "notion-spine/command/02 --json projects the SyncResult envelope",
    async run() {
      const { repo } = await makeConfiguredProject();
      try {
        const result = runCli(repo, ["work", "integrations", "notion", "sync-work", "17", "--json"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const env = JSON.parse(result.stdout);
        assert.equal(env.milestone, "17", 'the JSON result has "milestone" equal to "17"');
        assert.equal(typeof env.configured, "boolean", 'the JSON result has a boolean "configured"');
        assert.equal(typeof env.dryRun, "boolean", 'the JSON result has a boolean "dryRun"');
        assert.ok(Array.isArray(env.items), 'the JSON result has an "items" array');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a missing <milestone> fails cleanly with a usage message
    name: "notion-spine/command/03 a missing <milestone> fails cleanly with a usage message",
    async run() {
      const { repo } = await makeConfiguredProject();
      try {
        const result = runCli(repo, ["work", "integrations", "notion", "sync-work"]);
        assert.notEqual(result.status, 0, "the command exits non-zero on a missing milestone");
        assert.ok(
          /integrations notion sync-work <milestone>/.test(result.stderr),
          "stderr shows a usage message for integrations notion sync-work <milestone>"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an unknown integrations provider fails cleanly citing the supported provider
    name: "notion-spine/command/04 an unknown integrations provider fails cleanly citing the supported provider",
    async run() {
      const { repo } = await makeConfiguredProject();
      try {
        const result = runCli(repo, ["work", "integrations", "widget", "17"]);
        assert.notEqual(result.status, 0, "the command exits non-zero on an unknown provider");
        assert.ok(
          result.stderr.includes('"notion"') || /supported integrations provider is "notion"/.test(result.stderr),
          'stderr states the supported integrations provider is "notion"'
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: the sync argument shape determines the outcome (all rows).
    name: "notion-spine/command/05 the sync argument shape determines the outcome (outline rows)",
    async run() {
      const { repo } = await makeConfiguredProject();
      try {
        // Row: "17" — exits 0 and reports the synced milestone "17"
        let r = runCli(repo, ["work", "integrations", "notion", "sync-work", "17"]);
        assert.equal(r.status, 0, `"17" exits 0 (stderr: ${r.stderr.slice(0, 160)})`);
        assert.ok(r.stdout.includes("17"), '"17" reports the synced milestone "17"');

        // Row: "17 --dry-run" — exits 0 with "dryRun" true in the envelope
        r = runCli(repo, ["work", "integrations", "notion", "sync-work", "17", "--dry-run", "--json"]);
        assert.equal(r.status, 0, `"17 --dry-run" exits 0 (stderr: ${r.stderr.slice(0, 160)})`);
        assert.equal(JSON.parse(r.stdout).dryRun, true, '"17 --dry-run" sets dryRun true in the envelope');

        // Row: "" (missing arg) — exits non-zero with a usage message
        r = runCli(repo, ["work", "integrations", "notion", "sync-work"]);
        assert.notEqual(r.status, 0, "a missing required arg exits non-zero");
        assert.ok(/sync-work <milestone>/.test(r.stderr), "the missing-arg row shows a usage message");

        // Row: "widget 17" — exits non-zero citing the provider "notion"
        r = runCli(repo, ["work", "integrations", "widget", "17"]);
        assert.notEqual(r.status, 0, '"widget 17" exits non-zero');
        assert.ok(r.stderr.includes('"notion"'), '"widget 17" cites the supported provider "notion"');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

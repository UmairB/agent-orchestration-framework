// Traceability wiring for milestone 17 / story 00 — the opt-in no-op gate (ADR-004 /
// STATE §Opt-in no-op). One test object per @executable scenario of
// `01_opt-in-no-op-when-unconfigured.feature`.
//
// Background: a fixture workspace with milestone "17" + its stories on disk, a config
// with NO `work.integrations.notion`, and the Notion-CLI spawn seam injected as a SPY.
// The no-op returns { configured:false, items:[], hint }, spawns NO CLI, issues ZERO
// Notion calls, and the human render prints a hint naming `work.integrations.notion`.
//
// The in-process invoke passes the spy via ctx.notionSpawn so the zero-spawn promise
// is observable; the CLI-render scenarios run the bin against the fixture.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { getCommand, invoke } from "../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A fixture project with milestone 17 + two stories on disk and a config with NO
// work.integrations.notion block (the unconfigured baseline).
async function makeUnconfiguredProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-notion-noop-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mDir = path.join(workDir, "17_milestone_notion-work-sync");
  const s0 = path.join(mDir, "stories", "00_story_notion-sync-spine");
  const s1 = path.join(mDir, "stories", "01_story_projection");
  await mkdir(s0, { recursive: true });
  await mkdir(s1, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 17\nslug: notion-work-sync\nstatus: in-progress\n---\n# 17 · Notion Work-Board Sync\n",
    "utf8"
  );
  await writeFile(
    path.join(s0, "STORY.md"),
    "---\ntype: story\nnumber: 00\nslug: notion-sync-spine\nparent: 17\nstatus: in-progress\n---\n# 00 · spine\n",
    "utf8"
  );
  await writeFile(
    path.join(s1, "STORY.md"),
    "---\ntype: story\nnumber: 01\nslug: projection\nparent: 17\nstatus: not-started\n---\n# 01 · projection\n",
    "utf8"
  );
  // A config WITHOUT work.integrations.notion (the unconfigured case).
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { repo, workDir };
}

// Spawn `aof <args>` with cwd at the project root.
function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const notionSpineOptinNoopTests = [
  {
    // Scenario: an unconfigured project returns the opt-in no-op envelope
    name: "notion-spine/optin-noop/00 an unconfigured project returns the opt-in no-op envelope",
    async run() {
      const { repo } = await makeUnconfiguredProject();
      try {
        const workspace = await loadWorkspace(repo);
        const command = getCommand("notion:sync-work");
        const result = await command.run({ milestone: "17" }, { workspace });
        assert.equal(result.configured, false, 'the result has "configured" false');
        assert.deepEqual(result.items, [], 'the result has an empty "items" array');
        assert.ok(typeof result.hint === "string" && result.hint.length > 0, 'the result has a non-empty "hint"');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the no-op spawns no CLI and issues zero Notion calls
    name: "notion-spine/optin-noop/01 the no-op spawns no CLI and issues zero Notion calls",
    async run() {
      const { repo } = await makeUnconfiguredProject();
      try {
        const workspace = await loadWorkspace(repo);
        const command = getCommand("notion:sync-work");
        // Inject the spawn seam as a SPY via ctx.notionSpawn — the no-op must never
        // call it (ZERO Notion calls, the hard requirement).
        let spawnCalls = 0;
        const notionSpawn = (...args) => {
          spawnCalls += 1;
          return args;
        };
        const result = await invoke("notion:sync-work", { milestone: "17" }, { workspace, notionSpawn });
        assert.equal(spawnCalls, 0, "the injected spawn-seam spy is never called");
        assert.equal(result.configured, false, "no Notion call is issued (the no-op path)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the human render prints a setup hint naming the config block
    name: "notion-spine/optin-noop/02 the human render prints a setup hint naming the config block",
    async run() {
      const { repo } = await makeUnconfiguredProject();
      try {
        const result = runCli(repo, ["work", "integrations", "notion", "sync-work", "17"]);
        assert.equal(result.status, 0, `the command exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(
          result.stdout.includes("work.integrations.notion"),
          "stdout prints a setup hint that names work.integrations.notion"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an unconfigured sync exits 0 and writes nothing
    name: "notion-spine/optin-noop/03 an unconfigured sync exits 0 and writes nothing",
    async run() {
      const { repo } = await makeUnconfiguredProject();
      try {
        const result = runCli(repo, ["work", "integrations", "notion", "sync-work", "17"]);
        assert.equal(result.status, 0, `the command exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        // Nothing is written to disk: the sidecar must not exist (no record was made).
        let sidecar = null;
        try {
          sidecar = await readFile(path.join(repo, ".aof", "notion.work-map.json"), "utf8");
        } catch {
          sidecar = null;
        }
        assert.equal(sidecar, null, "nothing is written to disk (no sidecar created on the no-op)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

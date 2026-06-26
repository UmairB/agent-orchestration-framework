// Fitness function for milestone 17 / ADR-004 + STATE §Opt-in no-op (inv. 3):
//   "Opt-in-no-op. Absent `work.integrations.notion` ⇒ `notion:sync-work` returns
//    `{ configured:false, items:[], hint }`, spawns NO CLI, and issues ZERO Notion
//    calls." (The hard-requirement arch-test STATE explicitly called for.)
//
// The proof invokes `notion:sync-work` through the in-process registry door (`invoke`,
// where the spawn seam injects via ctx.notionSpawn) over a workspace whose config has
// NO `work.integrations.notion` block, with the CLI-spawn seam injected as a SPY:
//   - the spy is NEVER called (ZERO Notion calls — the hard requirement);
//   - the result is the no-op envelope `{ configured:false, items:[], hint }`;
//   - a non-empty hint is present.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../../src/work.mjs";
import { invoke } from "../../src/command-core.mjs";

// A fixture project with milestone 17 + a story on disk and a config WITHOUT a
// `work.integrations.notion` block (the unconfigured baseline — the opt-in no-op case).
async function makeUnconfiguredProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-notion-noop-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mDir = path.join(workDir, "17_milestone_notion-work-sync");
  const s0 = path.join(mDir, "stories", "00_story_spine");
  await mkdir(s0, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 17\nslug: notion-work-sync\nstatus: in-progress\n---\n# 17 · Notion Work-Board Sync\n",
    "utf8"
  );
  await writeFile(
    path.join(s0, "STORY.md"),
    "---\ntype: story\nnumber: 00\nslug: spine\nparent: 17\nstatus: in-progress\n---\n# 00 · spine\n",
    "utf8"
  );
  // A config WITHOUT work.integrations.notion (the unconfigured case).
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { repo };
}

export const archTests = [
  {
    name: "arch/notion-opt-in-noop: an unconfigured project returns { configured:false, items:[], hint } and the injected spawn spy is NEVER called (zero Notion calls)",
    async run() {
      const { repo } = await makeUnconfiguredProject();
      try {
        const workspace = await loadWorkspace(repo);
        // Inject the CLI-spawn seam as a SPY via ctx.notionSpawn — the no-op must never
        // call it (ZERO Notion calls / ZERO CLI spawns, the hard requirement).
        let spawnCalls = 0;
        const notionSpawn = (...args) => {
          spawnCalls += 1;
          return args;
        };
        const result = await invoke("notion:sync-work", { milestone: "17" }, { workspace, notionSpawn });

        assert.equal(spawnCalls, 0, "the injected CLI-spawn spy is NEVER called (zero Notion calls)");
        assert.equal(result.configured, false, 'the no-op result has "configured" false');
        assert.deepEqual(result.items, [], 'the no-op result has an empty "items" array');
        assert.ok(
          typeof result.hint === "string" && result.hint.length > 0,
          'the no-op result carries a non-empty "hint"'
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

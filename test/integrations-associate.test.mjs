// Traceability wiring for milestone 18 / story 00, task 02 —
// tasks/02_associate-writes-descriptor.feature (@executable, every scenario + every
// Scenario-Outline row). One test object per @executable scenario/row; ADR-001/003/004/006.
//
// The associate command's run is driven in-process over a temp fixture: a milestone "18"
// on disk + a config carrying a boards registry (ops parents {p1:page-P1}, growth parents
// {g1:page-G1}, default ops). Each scenario asserts the OBSERVABLE behaviour: the
// .integrations.json write (the ONLY mutation — no sidecar, no Notion), --board/--parent
// validation against committed config (unknown board/parent codes naming the available
// keys, writing nothing), --parent none / --board none clears, idempotence (unchanged
// makes no write), the --json envelope, and the not-a-milestone refusal. The STRUCTURAL
// "zero sidecar/Notion writes / no spawn seam imported" invariants are FF-A/FF-D
// (arch-tests authored in story 02), NOT asserted here.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { notionAssociateCommand } from "../src/commands/notion-associate.mjs";
import { readRouting } from "../src/integrations/routing.mjs";

const board = (parents) => ({
  dataSourceId: "ds-x",
  statusProperty: "Status",
  statusMap: { "not-started": "a", "in-progress": "b", "in-review": "c", done: "d" },
  relationProperty: "Sub",
  parents,
});

const CONFIG = {
  name: "fixture",
  work: {
    dir: "./wiki/work",
    integrations: {
      notion: {
        default: "ops",
        boards: {
          ops: board({ p1: "page-P1" }),
          growth: board({ g1: "page-G1" }),
        },
      },
    },
  },
};

// A fixture workspace: a top-level milestone "18" on disk (+ optionally a story 18/00),
// the boards-registry config, and the loadWorkspace-shaped ctx the command reads.
// `associated` pre-writes an ops/p1 descriptor for the clear/idempotence scenarios.
async function makeProject({ associated = false, withStory = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-integrations-assoc-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "18_milestone_demo");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 18\nslug: demo\nstatus: in-progress\n---\n# Demo\n",
    "utf8"
  );
  let storyDir;
  if (withStory) {
    storyDir = path.join(mDir, "stories", "00_story_spine");
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      path.join(storyDir, "STORY.md"),
      "---\ntype: story\nnumber: 00\nslug: spine\nparent: 18\n---\n# Spine\n",
      "utf8"
    );
  }
  if (associated) {
    await writeFile(
      path.join(mDir, ".integrations.json"),
      `${JSON.stringify({ notion: { board: "ops", parent: "p1" } }, null, 2)}\n`,
      "utf8"
    );
  }
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(CONFIG, null, 2)}\n`, "utf8");
  const ctx = { workspace: { workDir, config: CONFIG, projectRoot: repo } };
  return { repo, ctx, mDir, storyDir, aofDir: path.join(repo, ".aof"), descPath: path.join(mDir, ".integrations.json") };
}

const run = (ctx, input) => notionAssociateCommand.run(input, ctx);

// Read the written descriptor synchronously ({} when absent) for the on-disk assertions.
function readDescriptor(mDir) {
  const p = path.join(mDir, ".integrations.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

export const integrationsAssociateTests = [
  {
    // Scenario: a valid --board and a parent key write the descriptor and nothing else
    name: "integrations-associate/02 a valid --board + parent key writes the descriptor, no sidecar, no Notion",
    async run() {
      const { repo, ctx, mDir, aofDir } = await makeProject();
      try {
        const result = await run(ctx, { ref: "18", board: "ops", parent: "p1" });
        assert.equal(result.action, "set", "the action is set");
        const desc = readDescriptor(mDir);
        assert.equal(desc.notion.board, "ops", "the descriptor names board ops");
        assert.equal(desc.notion.parent, "p1", "the descriptor names parent p1");
        const aofEntries = await readdir(aofDir);
        assert.ok(!aofEntries.includes("notion.work-map.json"), "no .aof sidecar is written");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a non-default --board writes that board and validates the parent against it
    name: "integrations-associate/02 a non-default --board writes that board and validates the parent against IT",
    async run() {
      const { repo, ctx, mDir } = await makeProject();
      try {
        const result = await run(ctx, { ref: "18", board: "growth", parent: "g1" });
        assert.equal(result.action, "set");
        const desc = readDescriptor(mDir);
        assert.equal(desc.notion.board, "growth", "the descriptor names board growth");
        assert.equal(desc.notion.parent, "g1", "the descriptor names parent g1 (validated against growth)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a raw page-id parent is accepted verbatim
    name: "integrations-associate/02 a raw page-id parent is accepted verbatim (no parents-map entry needed)",
    async run() {
      const { repo, ctx, mDir } = await makeProject();
      try {
        const id = "11112222333344445555666677778888";
        const result = await run(ctx, { ref: "18", board: "ops", parent: id });
        assert.equal(result.action, "set");
        const desc = readDescriptor(mDir);
        assert.equal(desc.notion.parent, id, "the raw page-id is stored verbatim");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --parent none clears the parent (leaving the board)
    name: "integrations-associate/02 --parent none clears the parent, leaves the board, reports unset",
    async run() {
      const { repo, ctx, mDir } = await makeProject({ associated: true });
      try {
        const result = await run(ctx, { ref: "18", board: "ops", parent: "none" });
        assert.equal(result.action, "unset", "the action reported is unset");
        const routing = readRouting({ type: "milestone", dir: mDir });
        assert.equal(routing.notion.board, "ops", "the notion block still names board ops");
        assert.equal(routing.notion.parent, undefined, "the notion block has no parent");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --board none clears the whole notion routing block
    name: "integrations-associate/02 --board none clears the whole notion block; re-read yields no notion block",
    async run() {
      const { repo, ctx, mDir } = await makeProject({ associated: true });
      try {
        const result = await run(ctx, { ref: "18", board: "none" });
        assert.equal(result.action, "unset", "the action reported is unset");
        const routing = readRouting({ type: "milestone", dir: mDir });
        assert.equal(routing.notion, undefined, "re-reading the routing yields no notion block");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: clearing an already-clear item reports unchanged and writes no file
    name: "integrations-associate/02 clearing an already-clear item reports unchanged and creates no file",
    async run() {
      const { repo, ctx, descPath } = await makeProject({ associated: false });
      try {
        const result = await run(ctx, { ref: "18", board: "none" });
        assert.equal(result.action, "unchanged", "the action reported is unchanged");
        assert.ok(!existsSync(descPath), "no .integrations.json file is created");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an associate that changes nothing reports unchanged and writes no file
    name: "integrations-associate/02 an associate that changes nothing reports unchanged, the file is byte-for-byte unchanged",
    async run() {
      const { repo, ctx, descPath } = await makeProject({ associated: true });
      try {
        const before = await readFile(descPath, "utf8");
        const beforeMtime = (await stat(descPath)).mtimeMs;
        const result = await run(ctx, { ref: "18", board: "ops", parent: "p1" });
        assert.equal(result.action, "unchanged", "the action reported is unchanged");
        const after = await readFile(descPath, "utf8");
        assert.equal(after, before, "the .integrations.json file is byte-for-byte unchanged");
        assert.equal((await stat(descPath)).mtimeMs, beforeMtime, "the file is not rewritten (mtime unchanged)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: an unresolvable --board or --parent is an honest error that writes nothing
    // (every Examples row → one assertion). The two arms have distinct codes; the parent
    // vocabulary is scoped to the CHOSEN board, never another board's.
    name: "integrations-associate/02 an unresolvable --board/--parent is an honest error naming the scoped keys, writing nothing (every outline row)",
    async run() {
      const rows = [
        {
          args: { board: "ghost", parent: "p1" },
          code: "unknown-board-key",
          names: [/"ops"/, /"growth"/],
        },
        {
          args: { board: "ops", parent: "ghost" },
          code: "unknown-parent-key",
          names: [/ops/, /"p1"/],
          notNames: [/"g1"/], // scoped to ops, NOT growth's keys
        },
        {
          args: { board: "growth", parent: "p1" },
          code: "unknown-parent-key",
          // The CHOSEN board's parent keys are named (growth's "g1"); "p1" (the rejected
          // key) appears as the unknown key, which is expected. The scoping check is that
          // growth's keys are named — ops's "p1" is not offered as an available key.
          names: [/growth/, /"g1"/],
        },
      ];
      for (const { args, code, names, notNames } of rows) {
        const { repo, ctx, descPath } = await makeProject();
        try {
          await assert.rejects(
            () => run(ctx, { ref: "18", ...args }),
            (err) => {
              assert.equal(err.code, code, `the code is ${code} for ${JSON.stringify(args)}`);
              for (const re of names) assert.match(err.message, re, `${JSON.stringify(args)} names ${re}`);
              for (const re of notNames ?? []) assert.doesNotMatch(err.message, re, `${JSON.stringify(args)} does NOT name ${re}`);
              return true;
            }
          );
          assert.ok(!existsSync(descPath), "no .integrations.json was created on a refusal");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    // Scenario: associating a non-milestone ref is the honest not-a-milestone error
    name: "integrations-associate/02 associating a story ref is the honest not-a-milestone error, writing no descriptor anywhere",
    async run() {
      const { repo, ctx, mDir, storyDir } = await makeProject({ withStory: true });
      try {
        await assert.rejects(
          () => run(ctx, { ref: "18/00", board: "ops", parent: "p1" }),
          (err) => {
            assert.equal(err.code, "not-a-milestone", "the code is not-a-milestone");
            assert.match(err.message, /top-level MILESTONE/i, "stderr states routing is on a top-level milestone");
            return true;
          }
        );
        assert.ok(!existsSync(path.join(mDir, ".integrations.json")), "no descriptor in the milestone folder");
        assert.ok(!existsSync(path.join(storyDir, ".integrations.json")), "no descriptor in the story folder");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --json projects the AssociateResult envelope
    name: "integrations-associate/02 --json projects the AssociateResult envelope { ref, board, parent, action }",
    async run() {
      const { repo, ctx } = await makeProject();
      try {
        const result = await run(ctx, { ref: "18", board: "ops", parent: "p1" });
        const json = notionAssociateCommand.cli.json(result);
        assert.equal(json.ref, "18", "ref is 18");
        assert.equal(json.board, "ops", "board is ops");
        assert.equal(json.parent, "p1", "parent is p1");
        assert.equal(json.action, "set", "action is set");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // A GSD `NN-slug` milestone folder (not the aof `NN_milestone_slug` form) is not in
    // listItems; associate resolves it tolerantly so a GSD-managed repo is associable
    // without a rename. A raw page-id parent + no --board needs no boards config at all.
    name: "integrations-associate a GSD `NN-slug` milestone folder is associable by ref, page-id parent, no --board/config",
    async run() {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-integrations-gsd-"));
      const workDir = path.join(repo, "wiki", "work");
      const gsdDir = path.join(workDir, "323-realtime-compliance-sidecar-providers");
      await mkdir(path.join(repo, ".aof"), { recursive: true });
      await mkdir(gsdDir, { recursive: true });
      // The GSD folder carries a record doc (its own SPEC), so it is a milestone folder.
      await writeFile(path.join(gsdDir, "SPEC.md"), "# 323 · Realtime — Spec\n\n## Goal\n\nClose the gap.\n", "utf8");
      // No notion config at all — a page-id parent with no --board needs none.
      const ctx = { workspace: { workDir, config: { name: "f", work: { dir: "./wiki/work" } }, projectRoot: repo } };
      const pageId = "e95f0dbfdcf98340a2d501a9ea0e40f6";
      try {
        const result = await notionAssociateCommand.run({ ref: "323", parent: pageId }, ctx);
        assert.equal(result.action, "set", "the GSD-folder milestone is resolved and associated");
        assert.equal(result.parent, pageId, "the raw page-id parent is recorded verbatim");
        // The descriptor is written INTO the GSD folder itself.
        const desc = JSON.parse(readFileSync(path.join(gsdDir, ".integrations.json"), "utf8"));
        assert.equal(desc.notion.parent, pageId, "the .integrations.json in the GSD folder carries the parent page-id");
        assert.ok(!("board" in desc.notion), "no board is recorded (none was requested)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // The hardened resolution still refuses a genuinely-unknown ref (no GSD folder match).
    name: "integrations-associate an unknown ref (no work item, no GSD folder) is an honest ref-not-found",
    async run() {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-integrations-gsd-miss-"));
      const workDir = path.join(repo, "wiki", "work");
      await mkdir(workDir, { recursive: true });
      const ctx = { workspace: { workDir, config: { name: "f", work: { dir: "./wiki/work" } }, projectRoot: repo } };
      try {
        await assert.rejects(
          () => notionAssociateCommand.run({ ref: "999", parent: "e95f0dbfdcf98340a2d501a9ea0e40f6" }, ctx),
          (err) => err.code === "ref-not-found",
          "an unresolvable ref is a ref-not-found error, not a silent write"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

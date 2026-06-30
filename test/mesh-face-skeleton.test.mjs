// Traceability wiring for milestone 22 / story 00 — the aof mesh face skeleton.
//
// Covers EVERY @executable scenario in tasks/02_aof-mesh-face-skeleton.feature,
// spawning the REAL CLI via spawnSync(process.execPath, [cliPath, "mesh", ...]) over
// a fixture stream (a .aof/aof.config.json + wiki/work, modelled on
// acd-work-command-cli-bijection's buildFixture). One test object per @executable
// scenario (the Scenario-Outline folded into one entry looping the Examples).
// node:assert/strict.
//
//   02_aof-mesh-face-skeleton.feature — aof mesh is a registered top-level command
//     rendering usage at exit 0; the matrix rows (no sub)/bogus/""/"   " under --json
//     each emit ONE parseable JSON doc with the right shape/code/exit; aof mesh bogus
//     --json names "bogus"; the dispatcher is routing-only — after aof mesh, no .mesh
//     file is created and no record doc is edited.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
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

// A fixture stream the CLI can resolve (modelled on the bijection test's builder):
// a .aof/aof.config.json + a wiki/work milestone/story with a record doc.
async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-face-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "03_milestone_board");
  const storyDir = path.join(milestoneDir, "stories", "01_story_board-ui");
  await mkdir(storyDir, { recursive: true });
  await mkdir(aofDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "03", slug: "board", status: "in-progress", title: '"Board"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "01", slug: "board-ui", parent: "03", status: "in-progress", title: '"Board UI"', created: "2026-06-19", updated: "2026-06-19" }),
    "utf8"
  );
  return root;
}

function runMesh(root, meshArgs) {
  const result = spawnCliSync(process.execPath, [cliPath, "mesh", ...meshArgs], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Recursively snapshot every file path under a dir (relative), to prove routing-only.
async function snapshotFiles(dir) {
  const out = [];
  async function walk(d, rel) {
    let entries = [];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = path.join(rel, e.name);
      if (e.isDirectory()) await walk(full, r);
      else out.push(r);
    }
  }
  await walk(dir, "");
  return out.sort();
}

export const meshFaceSkeletonTests = [
  {
    name: "mesh-store/02 aof mesh is a registered top-level CLI command (recognised, renders usage, exits zero)",
    async run() {
      const root = await buildFixture();
      try {
        const result = runMesh(root, []);
        assert.equal(result.status, 0, `aof mesh exits zero (stderr: ${result.stderr})`);
        // recognised — NOT an "unknown command" error
        assert.ok(!/unknown command/i.test(result.stderr), "aof mesh is not an 'unknown command' error");
        assert.ok(!/unknown command/i.test(result.stdout), "aof mesh is not an 'unknown command' error on stdout");
        // the output renders the aof mesh usage (the available sub-commands surface)
        assert.ok(/aof mesh/i.test(result.stdout), "the output renders the aof mesh usage");
        assert.ok(/usage/i.test(result.stdout), "the usage text advertises usage");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/02 the mesh skeleton routes a known shape and rejects every unknown sub with one envelope (Scenario Outline)",
    async run() {
      const root = await buildFixture();
      try {
        // Examples: (no sub) → usage/ok, no code, exit zero;
        //   bogus / "" / "   " → ok:false error, code unknown-subcommand, exit non-zero.
        const rows = [
          { args: [], shape: "ok", code: null, exitZero: true },
          { args: ["bogus"], shape: "error", code: "unknown-subcommand", exitZero: false },
          { args: [""], shape: "error", code: "unknown-subcommand", exitZero: false },
          { args: ["   "], shape: "error", code: "unknown-subcommand", exitZero: false },
        ];
        for (const { args, shape, code, exitZero } of rows) {
          const label = args.length === 0 ? "(no sub)" : JSON.stringify(args[0]);
          const result = runMesh(root, [...args, "--json"]);
          // stdout is a single parseable JSON document
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `[${label}] stdout is a single parseable JSON document (stdout: ${result.stdout.slice(0, 200)})`);
          if (shape === "ok") {
            assert.equal(parsed.ok, true, `[${label}] the result is ok`);
            assert.equal(result.status, 0, `[${label}] exit is zero`);
            assert.ok(!("code" in parsed) || parsed.code == null, `[${label}] no error code on the ok envelope`);
          } else {
            assert.equal(parsed.ok, false, `[${label}] the result is ok:false`);
            assert.equal(parsed.code, code, `[${label}] code is ${code}`);
            assert.equal(typeof parsed.error, "string", `[${label}] carries an error message`);
            assert.notEqual(result.status, 0, `[${label}] exit is non-zero (got ${result.status})`);
          }
          if (exitZero) assert.equal(result.status, 0, `[${label}] exit zero`);
          else assert.notEqual(result.status, 0, `[${label}] exit non-zero`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/02 an unknown mesh sub-command's error names the rejected sub-command",
    async run() {
      const root = await buildFixture();
      try {
        const result = runMesh(root, ["bogus", "--json"]);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.ok, false, "the envelope is { ok:false, ... }");
        assert.equal(typeof parsed.error, "string", "the envelope carries an error string");
        assert.equal(typeof parsed.code, "string", "the envelope carries a code");
        assert.ok(parsed.error.includes("bogus"), `the error message names the rejected sub "bogus" (got: ${parsed.error})`);
        assert.notEqual(result.status, 0, "the process exits non-zero");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/02 the meshCommand dispatcher is routing-only (no command logic, no side effects)",
    async run() {
      const root = await buildFixture();
      try {
        const before = await snapshotFiles(root);
        const specBefore = await readFile(path.join(root, "wiki", "work", "03_milestone_board", "SPEC.md"), "utf8");
        const storyBefore = await readFile(path.join(root, "wiki", "work", "03_milestone_board", "stories", "01_story_board-ui", "STORY.md"), "utf8");

        const result = runMesh(root, []);
        assert.equal(result.status, 0, "aof mesh exits zero");
        // the usage lists no behaviour beyond routing — it does NOT advertise
        // identity/status/sync (stories 01/02 add those).
        assert.ok(!/identity/i.test(result.stdout), "the usage does not advertise an identity verb");
        assert.ok(!/\bsync\b/i.test(result.stdout), "the usage does not advertise a sync verb");
        assert.ok(!/\bstatus\b/i.test(result.stdout), "the usage does not advertise a status verb");

        // no mesh record file was created, modified, or deleted on disk
        const after = await snapshotFiles(root);
        assert.deepEqual(after, before, "no file was created or deleted on disk");
        assert.ok(!after.some((f) => f.split(path.sep).includes(".mesh")), "no .mesh file was created");
        // no item record doc was edited
        assert.equal(await readFile(path.join(root, "wiki", "work", "03_milestone_board", "SPEC.md"), "utf8"), specBefore, "the milestone SPEC.md was not edited");
        assert.equal(await readFile(path.join(root, "wiki", "work", "03_milestone_board", "stories", "01_story_board-ui", "STORY.md"), "utf8"), storyBefore, "the story STORY.md was not edited");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];

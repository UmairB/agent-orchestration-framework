// Round-trip proof — milestone 04 / story 01 (install-proof).
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's three task features is wired here, driven END-TO-END through the shared
// round-trip harness (milestone 04 / story 00, ADR-005) and the REAL `aof` CLI.
// This re-proves the install COMPOSES from a cold start in a hermetic repo — the
// black-box assertion milestone 01's per-unit tests don't make (ADR-002/003):
//
//   00_renders-bundle.feature   — a cold `aof work init` renders the full ACD
//        bundle: a representative member of each kind lands at its conventional
//        path; command members are namespaced under aof/ (never flat) and carry
//        the /aof: invocation; the kind→location matrix; --dry-run writes nothing
//        and leaves no `work` section.
//   01_work-lock-section.feature — the cold install writes a conformant `work`
//        section to the unified .aof/aof.lock.json (lock-v2 envelope; every entry
//        sha256-hashed + forward-slashed; the per-member entry shape; no package/
//        framework intent; no separate aof.work.lock.json — ADR-009).
//   02_verbs-resolve.feature     — the work verbs resolve over the freshly-
//        installed, seeded repo: `work list --json` emits the seeded milestone and
//        its stories as the frozen flat array; the human listing nests stories
//        under the milestone; `work find --json` resolves a bare milestone ref and
//        a NN/SS story ref to the seeded item; an unseeded ref resolves nothing and
//        exits non-zero.
//
// Black-box throughout: every Then is a file that does or does not exist on disk,
// a frontmatter value, the parsed `.work` section of the on-disk lock, or the
// stdout/exit-code of a real `aof work` verb. Refs bind SYMBOLICALLY to the
// harness's seedSampleMilestone return value — never a hard-coded milestone
// number (ADR-005). Each scenario uses a FRESH repo and always tears it down.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRoundTripRepo,
  installBundle,
  seedSampleMilestone,
  findWork,
  listStream
} from "./support/roundtrip-harness.mjs";

const cliPath = fileURLToPath(new URL("../bin/aof.mjs", import.meta.url));

// ---------------------------------------------------------------- helpers ----

// Spawn the REAL CLI in `dir` exactly like test/work-list.test.mjs does — the
// repo has no .aof/aof.config.json, so the CLI resolves workDir to
// <dir>/wiki/work by default, which is where seedSampleMilestone writes.
function runCli(dir, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" }
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

// The unified lock's `work` section is the top-level `.work` key (ADR-009).
function lockPath(dir) {
  return path.join(dir, ".aof", "aof.lock.json");
}

async function readWorkSection(dir) {
  const lock = JSON.parse(await readFile(lockPath(dir), "utf8"));
  return lock.work;
}

// Repo with the bundle installed via the harness, handed to `body`, then torn
// down — the "fresh isolated repo with the bundle installed" Background.
async function withInstalledRepo(body) {
  const repo = await createRoundTripRepo();
  try {
    await installBundle(repo.dir, { runtimes: ["claude"] });
    await body(repo);
  } finally {
    await repo.cleanup();
  }
}

// Repo with the bundle installed AND the sample milestone seeded — the
// "...and the sample milestone seeded" Background. Hands { repo, seed } to body.
async function withSeededRepo(body) {
  const repo = await createRoundTripRepo();
  try {
    await installBundle(repo.dir, { runtimes: ["claude"] });
    const seed = await seedSampleMilestone(repo.dir);
    await body({ repo, seed });
  } finally {
    await repo.cleanup();
  }
}

// Resolve the seeded slug for a ref through the SAME shipped verb the harness
// uses (ADR-002) — never hard-code the fixture slug. listStream emits the
// canonical rows; the row for `ref` carries its slug.
async function seededSlug(dir, ref) {
  const rows = await listStream(path.join(dir, "wiki", "work"));
  const row = rows.find((candidate) => candidate.ref === ref);
  assert.ok(row, `seeded ref ${ref} resolves through the shipped listStream`);
  return row.slug;
}

const SHA256_PATH = /^sha256:[0-9a-f]{64}$/;

// ---------------------------------------------------------------- tests ----

export const installProofTests = [
  // ====================================================================
  // 00_renders-bundle.feature
  // ====================================================================

  {
    name: "renders-bundle: a representative member of each kind lands at its conventional path",
    run: () => withInstalledRepo(async (repo) => {
      assert.ok(existsSync(path.join(repo.dir, ".claude", "agents", "aof-architect.md")), ".claude/agents/aof-architect.md exists");
      assert.ok(existsSync(path.join(repo.dir, ".claude", "commands", "aof", "refine.md")), ".claude/commands/aof/refine.md exists");
      assert.ok(existsSync(path.join(repo.dir, ".aof", "templates", "work", "milestone", "SPEC.md")), ".aof/templates/work/milestone/SPEC.md exists");
    })
  },

  {
    name: "renders-bundle: command members are namespaced under aof, not written flat",
    run: () => withInstalledRepo(async (repo) => {
      const refinePath = path.join(repo.dir, ".claude", "commands", "aof", "refine.md");
      assert.ok(existsSync(refinePath), ".claude/commands/aof/refine.md exists");
      const content = await readFile(refinePath, "utf8");
      const match = /^aof-invocation:\s*(.+)$/m.exec(content);
      assert.ok(match, "frontmatter carries aof-invocation");
      assert.equal(match[1].trim(), "/aof:refine", "aof-invocation equals /aof:refine");
      assert.ok(!existsSync(path.join(repo.dir, ".claude", "commands", "refine.md")), "no flat .claude/commands/refine.md");
    })
  },

  {
    // Scenario Outline: a bundle member of a given kind lands at its conventional
    // location — all 8 Examples rows (agent x2, command x3, template x3).
    name: "renders-bundle: outline — every member kind lands at its conventional location (8 rows)",
    run: () => withInstalledRepo(async (repo) => {
      const rows = [
        { kind: "agent", id: "aof-architect", location: ".claude/agents/aof-architect.md" },
        { kind: "agent", id: "aof-developer", location: ".claude/agents/aof-developer.md" },
        { kind: "command", id: "refine", location: ".claude/commands/aof/refine.md" },
        { kind: "command", id: "continue", location: ".claude/commands/aof/continue.md" },
        { kind: "command", id: "verify", location: ".claude/commands/aof/verify.md" },
        { kind: "template", id: "milestone", location: ".aof/templates/work/milestone/SPEC.md" },
        { kind: "template", id: "story", location: ".aof/templates/work/story/STORY.md" },
        { kind: "template", id: "task", location: ".aof/templates/work/task/example.feature" }
      ];
      for (const row of rows) {
        const onDisk = path.join(repo.dir, ...row.location.split("/"));
        assert.ok(existsSync(onDisk), `${row.kind} ${row.id} at ${row.location}`);
      }
    })
  },

  {
    // --dry-run on a COLD repo (no prior install): exit 0, writes none of the
    // canonical members, and leaves no `work` section in the unified lock.
    name: "renders-bundle: --dry-run reports planned writes but writes nothing on a cold repo",
    run: async () => {
      const repo = await createRoundTripRepo();
      try {
        const result = runCli(repo.dir, ["work", "init", "--dry-run"]);
        assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
        assert.ok(!existsSync(path.join(repo.dir, ".claude", "agents", "aof-architect.md")), ".claude/agents/aof-architect.md not written");
        assert.ok(!existsSync(path.join(repo.dir, ".claude", "commands", "aof", "refine.md")), ".claude/commands/aof/refine.md not written");
        assert.ok(!existsSync(path.join(repo.dir, ".aof", "templates", "work", "milestone", "SPEC.md")), ".aof/templates/work/milestone/SPEC.md not written");
        // "no work section": the lock file is absent OR its `.work` is undefined.
        if (existsSync(lockPath(repo.dir))) {
          const lock = JSON.parse(await readFile(lockPath(repo.dir), "utf8"));
          assert.equal(lock.work, undefined, ".aof/aof.lock.json has no `work` section");
        }
      } finally {
        await repo.cleanup();
      }
    }
  },

  // ====================================================================
  // 01_work-lock-section.feature
  // ====================================================================

  {
    name: "lock-section: the cold install writes a work section with the lock-v2 envelope",
    run: () => withInstalledRepo(async (repo) => {
      assert.ok(existsSync(lockPath(repo.dir)), ".aof/aof.lock.json exists");
      const work = await readWorkSection(repo.dir);
      assert.ok(work && typeof work === "object", "the `work` section is present");
      assert.ok(work.bundle && typeof work.bundle.version === "string" && work.bundle.version.length > 0, "work.bundle.version is a non-empty string");
      assert.ok(Array.isArray(work.runtimes) && work.runtimes.includes("claude"), "work.runtimes contains \"claude\"");
      assert.ok(typeof work.generatedAt === "string" && work.generatedAt.length > 0, "work.generatedAt is a non-empty string");
      assert.ok(Array.isArray(work.files) && work.files.length > 0, "work.files is non-empty");
    })
  },

  {
    name: "lock-section: every work.files entry is sha256-hashed with a forward-slashed path",
    run: () => withInstalledRepo(async (repo) => {
      const work = await readWorkSection(repo.dir);
      assert.ok(work.files.length > 0, "there are entries to check");
      for (const entry of work.files) {
        assert.match(entry.hash, SHA256_PATH, `${entry.path} hash matches ^sha256:[0-9a-f]{64}$`);
        assert.ok(!entry.path.includes("\\"), `${entry.path} contains no backslash`);
      }
    })
  },

  {
    // Scenario Outline: the work.files entry for a representative member has the
    // conformant shape — all 3 Examples rows (agent / command / template).
    name: "lock-section: outline — the work.files entry for a representative member has the conformant shape (3 rows)",
    run: () => withInstalledRepo(async (repo) => {
      const work = await readWorkSection(repo.dir);
      const byPath = new Map(work.files.map((entry) => [entry.path, entry]));
      const rows = [
        { kind: "agent", id: "aof-architect", path: ".claude/agents/aof-architect.md" },
        { kind: "command", id: "refine", path: ".claude/commands/aof/refine.md" },
        { kind: "template", id: "milestone", path: ".aof/templates/work/milestone/SPEC.md" }
      ];
      for (const row of rows) {
        const entry = byPath.get(row.path);
        assert.ok(entry, `the work.files entry at path "${row.path}" exists`);
        assert.equal(entry.resource.id, row.id, `${row.path} resource.id equals "${row.id}"`);
        assert.equal(entry.resource.kind, row.kind, `${row.path} resource.kind equals "${row.kind}"`);
        assert.ok(typeof entry.runtime === "string" && entry.runtime.length > 0, `${row.path} runtime is a non-empty string`);
        assert.match(entry.hash, SHA256_PATH, `${row.path} hash matches ^sha256:[0-9a-f]{64}$`);
        assert.ok(typeof entry.generatedAt === "string" && entry.generatedAt.length > 0, `${row.path} generatedAt is a non-empty string`);
      }
    })
  },

  {
    name: "lock-section: the work section carries no package or framework intent on a cold install",
    run: () => withInstalledRepo(async (repo) => {
      const work = await readWorkSection(repo.dir);
      assert.deepEqual(work.packages, [], "work.packages is empty");
      assert.deepEqual(work.frameworks, [], "work.frameworks is empty");
      assert.deepEqual(work.frameworkInstallAttempts, [], "work.frameworkInstallAttempts is empty");
    })
  },

  {
    name: "lock-section: no separate work lock file is written",
    run: () => withInstalledRepo(async (repo) => {
      assert.ok(!existsSync(path.join(repo.dir, ".aof", "aof.work.lock.json")), ".aof/aof.work.lock.json does not exist");
      const lockFiles = (await readdir(path.join(repo.dir, ".aof"))).filter((name) => name.endsWith(".lock.json"));
      assert.deepEqual(lockFiles, ["aof.lock.json"], "the only *.lock.json under .aof/ is aof.lock.json");
    })
  },

  // ====================================================================
  // 02_verbs-resolve.feature
  // ====================================================================

  {
    name: "verbs-resolve: list --json emits the seeded milestone and its stories as a flat array",
    run: () => withSeededRepo(async ({ repo, seed }) => {
      const result = runCli(repo.dir, ["work", "list", "--json"]);
      assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, "output parses to JSON");
      assert.ok(Array.isArray(parsed), "the output is a JSON array");

      // The seeded milestone appears as a milestone element.
      const milestoneEl = parsed.find((el) => el.ref === seed.milestoneRef);
      assert.ok(milestoneEl, `an element whose ref equals the seeded milestoneRef (${seed.milestoneRef})`);
      assert.equal(milestoneEl.type, "milestone", "that element's type equals \"milestone\"");

      // Each seeded story appears as a story element parented to the milestone.
      const milestoneNumber = Number.parseInt(seed.milestoneRef, 10);
      for (const storyRef of seed.storyRefs) {
        const storyEl = parsed.find((el) => el.ref === storyRef);
        assert.ok(storyEl, `an element with ref ${storyRef}`);
        assert.equal(storyEl.type, "story", `${storyRef} type equals \"story\"`);
        assert.equal(Number.parseInt(storyEl.parent, 10), milestoneNumber, `${storyRef} parent equals the seeded milestoneRef's number`);
      }

      // Every element's key set is exactly the seven contract fields.
      const expectedKeys = ["dir", "parent", "ref", "slug", "status", "title", "type"];
      for (const el of parsed) {
        assert.deepEqual(Object.keys(el).sort(), expectedKeys, `${el.ref} key set is exactly ref, type, slug, status, title, parent, dir`);
      }
    })
  },

  {
    name: "verbs-resolve: list shows the seeded milestone with its stories nested under it",
    run: () => withSeededRepo(async ({ repo, seed }) => {
      const result = runCli(repo.dir, ["work", "list"]);
      assert.equal(result.status, 0, `exit 0 (stderr: ${result.stderr})`);
      const lines = result.stdout.split(/\r?\n/);

      // A line for the milestone (un-indented / flush).
      const milestoneIdx = lines.findIndex((line) => new RegExp(`^${seed.milestoneRef}\\b`).test(line));
      assert.ok(milestoneIdx >= 0, `a flush line for the seeded milestoneRef (${seed.milestoneRef})`);

      // Each story appears on its own indented line AFTER the milestone line
      // (depth-first preorder — a milestone immediately followed by its stories).
      for (const storyRef of seed.storyRefs) {
        const escaped = storyRef.replace("/", "\\/");
        const storyIdx = lines.findIndex((line) => new RegExp(`^\\s+${escaped}\\b`).test(line));
        assert.ok(storyIdx >= 0, `${storyRef} appears on its own indented line`);
        assert.ok(storyIdx > milestoneIdx, `${storyRef} appears after the milestone line`);
      }
    })
  },

  {
    // Scenario Outline: find --json resolves a seeded ref to the seeded item —
    // both Examples rows (the milestoneRef → milestone/null; the first storyRef →
    // story/milestone-number). Refs/slugs bind symbolically to the seed.
    name: "verbs-resolve: outline — find --json resolves a seeded ref to the seeded item (2 rows)",
    run: () => withSeededRepo(async ({ repo, seed }) => {
      const milestoneNumber = Number.parseInt(seed.milestoneRef, 10);
      const rows = [
        { ref: seed.milestoneRef, expectedType: "milestone", expectedParent: null },
        { ref: seed.storyRefs[0], expectedType: "story", expectedParent: milestoneNumber }
      ];
      for (const row of rows) {
        const result = runCli(repo.dir, ["work", "find", row.ref, "--json"]);
        assert.equal(result.status, 0, `find ${row.ref} --json exits 0 (stderr: ${result.stderr})`);
        const parsed = JSON.parse(result.stdout);
        assert.ok(Array.isArray(parsed), `find ${row.ref} parses to a JSON array`);
        assert.equal(parsed.length, 1, `find ${row.ref} resolves to exactly one element`);
        const el = parsed[0];
        assert.equal(el.type, row.expectedType, `${row.ref} type equals "${row.expectedType}"`);
        const expectedSlug = await seededSlug(repo.dir, row.ref);
        assert.equal(el.slug, expectedSlug, `${row.ref} slug equals the seeded slug "${expectedSlug}"`);
        if (row.expectedParent === null) {
          assert.equal(el.parent, null, `${row.ref} parent is null`);
        } else {
          assert.equal(Number.parseInt(el.parent, 10), row.expectedParent, `${row.ref} parent equals the milestoneRef number`);
        }
      }
    })
  },

  {
    name: "verbs-resolve: find on an unseeded ref resolves nothing and exits non-zero",
    run: () => withSeededRepo(async ({ repo }) => {
      // Cross-check the seam through the shipped verb: 9999 resolves to nothing.
      const found = await findWork(path.join(repo.dir, "wiki", "work"), "9999");
      assert.equal(found.length, 0, "the shipped findWork reports no item for 9999");
      // The CLI (human mode) reports no item and exits non-zero.
      const result = runCli(repo.dir, ["work", "find", "9999"]);
      assert.notEqual(result.status, 0, "the command exits non-zero");
      assert.doesNotMatch(result.stdout, /^\s*\d+(\/\d+)?\s/m, "no work item line is reported");
      assert.match(result.stdout, /no work item/i, "the not-found message is shown (not just empty output)");
    })
  }
];

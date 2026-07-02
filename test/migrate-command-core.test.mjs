// Traceability wiring for story 29 / migrate-command — the migrate:folder command
// (convert a source folder INTO a managed milestone) + its source-shape tolerance +
// its already-done reconciliation.
//
// ONE test object per @executable scenario / Scenario-Outline row across the four
// task features (Scenario-Outline rows folded into one entry where they share a
// fixture). Each name traces to feature + scenario. Drives the command BOTH at the
// unit level (invoke("migrate:folder", input, {workspace})) and the face level
// (spawnSyncHardened the real CLI), exactly as test/import-command-core.test.mjs.
//
//   00_migrate-produces-managed-item.feature — migrate:folder registered in the
//        frozen core ({id,input,run,cli}); `aof migrate <folder>` exits 0 + reports
//        the managed item; the produced item is a valid managed milestone under
//        work.dir that resolves via `work find` and passes `work validate`; source
//        intent → SPEC objective/scope; substructure → stories + task .features;
//        next free slot, no clobber; --dry-run previews + writes nothing; a missing
//        <folder> is a usage error; the invocation-shape + --json matrices.
//   01_migrate-vs-import-distinct-outcome.feature — migrate writes a MANAGED item
//        (SPEC.md + STATE.md) under work.dir, NO AOF.md digest, NOTHING under
//        .aof/imports/; the produced item is visible to work list / work next;
//        import's outcome stays a co-located digest; the two are non-interfering.
//   02_already-done-review-findings.feature (@executable rows) — a source with
//        delivered work produces a non-"not-started" status + a findings record; a
//        source with no delivered work is "not-started" with no spurious findings;
//        the delivery-axis matrix {status, findings}.
//   03_source-shape-tolerance.feature (@executable rows) — a bare README+code, a
//        non-aof folder, a thin overview-only, an empty source; read-only (source
//        byte-for-byte unchanged); the source-shape matrix.
//
// DEFERRED (@manual, NOT run here): 02's "the architect's findings are real
// structural issues" and 03's "migrate over a real-world arbitrary folder" — they
// are agent-judgement / need a real external folder, so they cannot run in CI. They
// are the milestone UAT.md / VERIFICATION.md lane (verifies → these scenarios). The
// read-only source boundary 03 asserts is ALSO pinned structurally by the story
// arch-test acd-migrate-read-only-source.
import assert from "node:assert/strict";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { getCommand, invoke } from "../src/command-core.mjs";
import { importStoreRoot } from "../src/import/store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A deterministic migratedAt for unit-level runs (the produced frontmatter's
// created/updated), so SPEC.md is byte-stable across runs.
const MIGRATED_AT = "2026-06-30";

// --- fixture builders -----------------------------------------------------------

// A minimal project root with a .aof config — enough for loadWorkspace to resolve
// projectRoot/workDir (mirrors import-command-core's makeRepo). `seedSlots` are
// pre-existing top-level milestone folders so the next-free-slot is non-trivial.
async function makeRepo(seedSlots = []) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-core-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  for (const ref of seedSlots) {
    const dir = path.join(workDir, `${ref}_milestone_seed-${ref}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SPEC.md"),
      `---\ntype: milestone\nnumber: ${ref}\nslug: seed-${ref}\nstatus: in-progress\ntitle: "Seed ${ref}"\nowner: product-owner\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# ${ref} · Seed ${ref}\n`,
      "utf8"
    );
  }
  return { repo, workDir };
}

// An aof-structured SOURCE: a `wiki/work/<NN>_milestone_<slug>/` with a SPEC headed
// `## Objective` / `## Scope`, an ARCHITECTURE ADR, and `stories/` substructure (two
// stories, the first carrying a task .feature). Read in place behind the read-only
// source seam. Returns the source dir.
async function makeAofSource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-aof-"));
  const mDir = path.join(src, "wiki", "work", "03_milestone_calls");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    `# 03 · Calls — Spec\n\n## Objective\n\nBuild the realtime calls subsystem with signaling.\n\n## Scope\n\nIn scope: signaling and presence. Out: recording.\n`,
    "utf8"
  );
  await writeFile(path.join(mDir, "STATE.md"), `# 03 State\n\n**Status:** In progress\n`, "utf8");
  await writeFile(
    path.join(mDir, "ARCHITECTURE.md"),
    `## ADR-001 — Use websockets for signaling\n\n**Status:** Accepted\n\nWe chose websockets over long-polling for the signaling channel.\n`,
    "utf8"
  );
  const signup = path.join(mDir, "stories", "00_story_signup", "tasks");
  const login = path.join(mDir, "stories", "01_story_login", "tasks");
  await mkdir(signup, { recursive: true });
  await mkdir(login, { recursive: true });
  await writeFile(path.join(mDir, "stories", "00_story_signup", "STORY.md"), `---\ntitle: "Signup flow"\n---\n# Signup\n`, "utf8");
  await writeFile(path.join(signup, "00_signup-form.feature"), `@executable\nFeature: signup form\n  Scenario: x\n    Given y\n`, "utf8");
  await writeFile(path.join(mDir, "stories", "01_story_login", "STORY.md"), `# Login\n`, "utf8");
  return src;
}

// A bare README+code SOURCE: a README overview + a source file, no aof docs, no
// wiki/work tree, no NN_milestone_ naming. The arbitrary-source recovery lane.
async function makeBareReadmeSource(overview = "A small URL shortener that turns long links into short codes.") {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-bare-"));
  await writeFile(path.join(src, "README.md"), `# shortlink\n\n${overview}\n`, "utf8");
  await mkdir(path.join(src, "src"), { recursive: true });
  await writeFile(path.join(src, "src", "index.js"), `export const shorten = (u) => u;\n`, "utf8");
  return src;
}

// A docs/ + ADR SOURCE: a README overview + a docs/adr tree, non-aof naming. The
// arbitrary-source decisions lane (docs/ADRs → decisions).
async function makeDocsAdrSource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-docs-"));
  await writeFile(path.join(src, "README.md"), `# payments\n\nA payments gateway integrating multiple processors.\n`, "utf8");
  await mkdir(path.join(src, "docs", "adr"), { recursive: true });
  await writeFile(
    path.join(src, "docs", "adr", "0001-use-stripe.md"),
    `# Use Stripe as the primary processor\n\nWe adopt Stripe for its idempotency keys and webhook reliability.\n`,
    "utf8"
  );
  return src;
}

// A THIN SOURCE: only a README overview, no decisions, no delivered work (no git,
// no docs/ADRs). Recovers a thin item — intent only; decisions/outcomes absent.
async function makeThinSource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-thin-"));
  await writeFile(
    path.join(src, "README.md"),
    `# notes-app\n\nA note-taking app that set out to sync notes across devices offline-first.\n`,
    "utf8"
  );
  return src;
}

// An EMPTY SOURCE: a directory with no recoverable intent, decisions, or work (no
// README, no docs, no git). Migrate must refuse cleanly.
async function makeEmptySource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-empty-"));
  // a non-recoverable file (not a README/overview, not a docs/ADR, not git)
  await writeFile(path.join(src, "LICENSE"), `MIT\n`, "utf8");
  return src;
}

// A DELIVERED-WITH-GAPS SOURCE: a real git repo carrying delivered commits (→
// outcomes) but NO decisions/ADRs and NO aof tasks — the partial/gaps fixture.
async function makeDeliveredWithGapsSource() {
  const src = await makeBareReadmeSource("A CLI that batches image resizes — most of it shipped.");
  // No shell: a shell:true spawn on Windows JOINS the argv into a command line and
  // word-splits a multi-word commit message (the colon/space subjects below would
  // break). Shell-less argv resolves `git` fine on Windows (recovery.mjs's own
  // `git log` spawn proves it) and passes each arg verbatim.
  const git = (args) => spawnSyncHardened("git", ["-C", src, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "fixture@aof.local"]);
  git(["config", "user.name", "aof fixture"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "feat: batch resize pipeline"]);
  await writeFile(path.join(src, "src", "resize.js"), `export const resize = (i) => i;\n`, "utf8");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "feat: add jpeg and png encoders"]);
  return src;
}

// An ADVERSARIAL-TITLE SOURCE: a bare README whose first heading carries content that
// would BREAK hand-rolled frontmatter/heading quoting — an embedded `"`, a newline,
// and a `status:`-looking substring. The produced milestone MUST still pass `aof work
// validate` (the recovered title is unbounded user content; quoting must be YAML-safe).
// The README heading is the recovered title (recoverArbitraryMeta → firstHeading);
// the overview prose supplies the objective so the source is non-empty (not refused).
async function makeAdversarialTitleSource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-adv-"));
  // A markdown heading is one line, so the literal newline is injected via the prose
  // that the title-recovery and heading-render must collapse; the `"` and the
  // `status: pwned` injection substring live on the heading line itself.
  await writeFile(
    path.join(src, "README.md"),
    `# evil "quoted\\title status: pwned — break\tthe ---\n\nAn app whose title tries to break YAML frontmatter and headings.\n`,
    "utf8"
  );
  await mkdir(path.join(src, "src"), { recursive: true });
  await writeFile(path.join(src, "src", "index.js"), `export const x = 1;\n`, "utf8");
  return src;
}

// A DONE-MARKER SOURCE (the G1 clamp guard): an aof-structured source whose STATE
// self-asserts `**Status:** Done` WITH clean full delivery — decisions (an ADR) AND a
// task feature, no gaps. migrate must NEVER emit "done": this clamps to in-review.
async function makeDoneMarkerSource() {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-src-done-"));
  const mDir = path.join(src, "wiki", "work", "07_milestone_shipped");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    `# 07 · Shipped — Spec\n\n## Objective\n\nShip the fully-delivered feature.\n\n## Scope\n\nIn scope: the whole thing.\n`,
    "utf8"
  );
  // The source self-asserts it is DONE — migrate must clamp this, never echo it.
  await writeFile(path.join(mDir, "STATE.md"), `# 07 State\n\n**Status:** Done\n`, "utf8");
  await writeFile(
    path.join(mDir, "ARCHITECTURE.md"),
    `## ADR-001 — Use a queue\n\n**Status:** Accepted\n\nWe chose a queue for the pipeline.\n`,
    "utf8"
  );
  const tasks = path.join(mDir, "stories", "00_story_core", "tasks");
  await mkdir(tasks, { recursive: true });
  await writeFile(path.join(mDir, "stories", "00_story_core", "STORY.md"), `---\ntitle: "Core"\n---\n# Core\n`, "utf8");
  await writeFile(path.join(tasks, "00_core.feature"), `@executable\nFeature: core\n  Scenario: x\n    Given y\n`, "utf8");
  return src;
}

// --- helpers --------------------------------------------------------------------

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

function runCli(root, args, env = {}) {
  const result = spawnSyncHardened(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runMigrate(projectRoot, sourceDir, extra = []) {
  return runCli(projectRoot, ["migrate", sourceDir, ...extra]);
}

function parseJsonStdout(stdout) {
  return JSON.parse(stdout);
}

// The work-item naming pattern a top-level managed milestone MUST match.
const MILESTONE_FOLDER_RE = /^\d+_milestone_[a-z0-9-]+$/;

// Snapshot every file under a dir (excluding .git) as path → "size:mtimeMs", for a
// byte-level created/deleted/modified comparison (the source-untouched assertion).
async function snapshotTree(root) {
  const out = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const s = await stat(full);
        out[path.relative(root, full).split(path.sep).join("/")] = `${s.size}:${s.mtimeMs}`;
      }
    }
  }
  await walk(root);
  return out;
}

// Read the produced milestone's STATE.md (for the findings assertions).
async function readState(workDir, ref) {
  for (const entry of await readdir(workDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(`${ref}_milestone_`)) {
      return readFile(path.join(workDir, entry.name, "STATE.md"), "utf8");
    }
  }
  return "";
}

export const migrateCommandCoreTests = [
  // ═══════════════ 00_migrate-produces-managed-item.feature ════════════════════
  {
    // Scenario: migrate is a registered command and "aof migrate <folder>" dispatches
    name: "migrate-core/00 migrate:folder is registered in the Command core with the frozen { id, input, run, cli } shape",
    async run() {
      const command = getCommand("migrate:folder");
      assert.ok(command, 'getCommand("migrate:folder") returns a command');
      assert.deepEqual(Object.keys(command).sort(), ["cli", "id", "input", "run"], "keys are exactly id, input, run, cli");
      assert.equal(command.id, "migrate:folder", 'id is "migrate:folder"');
      assert.equal(command.run.constructor.name, "AsyncFunction", "run is callable + async");
      assert.equal(typeof command.cli.argv, "function", "cli.argv is callable");
      assert.equal(typeof command.cli.render, "function", "cli.render is callable");
      assert.equal(typeof command.cli.json, "function", "cli.json is callable");
      assert.deepEqual(JSON.parse(JSON.stringify(command.input)), command.input, "input is plain data");
    },
  },
  {
    // Scenario: migrate over a local fixture folder exits 0 and reports the managed item
    name: "migrate-core/00 aof migrate over a local fixture folder exits 0 and reports the managed milestone it created",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const result = runMigrate(repo, src);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(/managed milestone/i.test(result.stdout), `stdout reports the managed milestone (stdout: ${result.stdout.slice(0, 200)})`);
        assert.ok(/01/.test(result.stdout), "stdout names where it landed (the produced ref)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the produced item is a valid managed milestone under work.dir
    name: "migrate-core/00 the produced item is a numbered managed milestone whose SPEC/STATE frontmatter matches the folder (type milestone)",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        const folder = path.basename(result.dir);
        assert.ok(MILESTONE_FOLDER_RE.test(folder), `the produced folder "${folder}" is a numbered milestone folder`);
        assert.ok(existsSync(path.join(result.dir, "SPEC.md")), "a SPEC.md is produced");
        assert.ok(existsSync(path.join(result.dir, "STATE.md")), "a STATE.md is produced");
        const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
        assert.ok(/^type:\s*milestone$/m.test(spec), 'SPEC frontmatter type is "milestone"');
        assert.ok(new RegExp(`^number:\\s*${result.milestoneRef}$`, "m").test(spec), "SPEC frontmatter number matches the folder");
        // The produced dir is under work.dir.
        assert.ok(result.dir.startsWith(workDir), "the produced milestone is under work.dir");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the produced item resolves through the stream's own resolver
    name: "migrate-core/00 the produced item resolves through aof work find as exactly one milestone",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const m = runMigrate(repo, src, ["--json"]);
        assert.equal(m.status, 0, `migrate exits 0 (stderr: ${m.stderr.slice(0, 200)})`);
        const ref = parseJsonStdout(m.stdout).milestoneRef;
        const find = runCli(repo, ["work", "find", ref, "--json"]);
        assert.equal(find.status, 0, `work find exits 0 (stderr: ${find.stderr.slice(0, 200)})`);
        const rows = parseJsonStdout(find.stdout);
        assert.equal(rows.length, 1, "exactly one item is returned");
        assert.equal(rows[0].type, "milestone", 'its type is "milestone"');
        assert.equal(rows[0].ref, ref, "it is the produced milestone");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the produced item passes work validation
    name: "migrate-core/00 the produced item passes aof work validate (no folder/frontmatter, tag, or depends errors)",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        runMigrate(repo, src);
        const validate = runCli(repo, ["work", "validate"]);
        assert.equal(validate.status, 0, `work validate exits 0 (stdout: ${validate.stdout.slice(0, 300)})`);
        assert.ok(/PASS/i.test(validate.stdout), "work validate reports the stream is well-formed");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the source folder's intent becomes the produced SPEC's objective + scope
    name: "migrate-core/00 the source folder's stated intent becomes the produced SPEC's objective and scope (not fabricated)",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
        assert.ok(/## Objective/.test(spec) && /realtime calls subsystem/.test(spec), "the SPEC objective carries the source's stated intent");
        assert.ok(/## Scope/.test(spec) && /signaling/.test(spec), "the SPEC scope carries the source's stated scope");
        // Not fabricated: the objective text is the source's, not an invented line.
        assert.ok(!/lorem|TODO: write the objective/i.test(spec), "the objective is legible source intent, not a fabricated placeholder");
        assert.ok(workDir);
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the source's substructure is scaffolded into stories and task features
    name: "migrate-core/00 the source's substructure is scaffolded into a stories/ folder with a story per recovered unit and its task .features",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.equal(result.storyCount, 2, "one story per recovered unit (the source has two stories)");
        const storiesDir = path.join(result.dir, "stories");
        const storyFolders = (await readdir(storiesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
        assert.equal(storyFolders.length, 2, "the produced milestone has a stories/ folder with two stories");
        assert.ok(storyFolders.every((name) => /^\d+_story_[a-z0-9-]+$/.test(name)), "each scaffolded story is a managed story folder");
        // The signup story carried a task → a task .feature is scaffolded.
        const signup = storyFolders.find((name) => name.endsWith("_story_signup"));
        assert.ok(signup, "the signup story is scaffolded");
        const tasks = (await readdir(path.join(storiesDir, signup, "tasks"))).filter((f) => f.endsWith(".feature"));
        assert.ok(tasks.length >= 1, "the recovered task is scaffolded as a .feature file");
        assert.equal(result.taskCount, 1, "the scaffold-count summary counts the recovered task feature");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the produced item lands at the next free slot without clobbering existing work
    name: "migrate-core/00 the produced item lands at the next free top-level slot, renumbering/overwriting nothing",
    async run() {
      // Existing items at 00, 01, 02 → the next free slot is 03.
      const { repo, workDir } = await makeRepo(["00", "01", "02"]);
      const src = await makeAofSource();
      try {
        const before = await snapshotTree(workDir);
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.equal(result.milestoneRef, "03", "the produced milestone takes the next free slot (03)");
        const after = await snapshotTree(workDir);
        // Every pre-existing seed file is byte-for-byte unchanged (no clobber/renumber).
        for (const key of Object.keys(before)) {
          assert.equal(after[key], before[key], `pre-existing item file "${key}" is unchanged (no clobber)`);
        }
        for (const ref of ["00", "01", "02"]) {
          assert.ok(existsSync(path.join(workDir, `${ref}_milestone_seed-${ref}`)), `existing item ${ref} still exists, unrenumbered`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: --dry-run previews the scaffold and writes nothing
    name: "migrate-core/00 --dry-run previews the managed item it WOULD create and writes nothing under work.dir",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const before = await snapshotTree(workDir);
        const result = runMigrate(repo, src, ["--dry-run"]);
        assert.equal(result.status, 0, `--dry-run exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(/would migrate/i.test(result.stdout), "stdout reports the item it WOULD create");
        const after = await snapshotTree(workDir);
        assert.deepEqual(after, before, "no folder, SPEC.md, STATE.md, or task feature is written under work.dir");
        assert.ok(!existsSync(path.join(workDir, "01_milestone_calls")), "no produced milestone folder is created");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a missing <folder> argument fails cleanly with a usage message
    name: "migrate-core/00 a missing <folder> argument exits non-zero with a usage message and creates nothing",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      try {
        const before = await snapshotTree(workDir);
        const result = runCli(repo, ["migrate"]);
        assert.notEqual(result.status, 0, "exits non-zero on a missing <folder>");
        assert.ok(/migrate <folder>/.test(result.stderr), `stderr shows a usage message for "migrate <folder>" (stderr: ${result.stderr.slice(0, 200)})`);
        const after = await snapshotTree(workDir);
        assert.deepEqual(after, before, "nothing is created under work.dir");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: the migrate invocation shape determines what is produced (folded)
    name: "migrate-core/00 the migrate invocation shape determines what is produced (Scenario Outline, folded)",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        // Row: <fixture-folder> → exits 0 and creates a valid managed milestone at the next free slot.
        let r = runMigrate(repo, src, ["--json"]);
        assert.equal(r.status, 0, `<fixture> exits 0 (stderr: ${r.stderr.slice(0, 160)})`);
        assert.equal(parseJsonStdout(r.stdout).milestoneRef, "01", "<fixture> creates at the next free slot (01)");
        // (clean up so the next rows see the same starting slot)
        await rm(path.join(workDir, "01_milestone_calls"), { recursive: true, force: true });

        // Row: <fixture-folder> --dry-run → exits 0, reports what it WOULD create, writes nothing.
        const beforeDry = await snapshotTree(workDir);
        r = runMigrate(repo, src, ["--dry-run"]);
        assert.equal(r.status, 0, "--dry-run exits 0");
        assert.ok(/would migrate/i.test(r.stdout), "--dry-run reports what it WOULD create");
        assert.deepEqual(await snapshotTree(workDir), beforeDry, "--dry-run writes nothing");

        // Row: (no <folder>) → exits non-zero with a usage message, creates nothing.
        const beforeMissing = await snapshotTree(workDir);
        r = runCli(repo, ["migrate"]);
        assert.notEqual(r.status, 0, "a missing <folder> exits non-zero");
        assert.ok(/migrate <folder>/.test(r.stderr), "a missing <folder> shows a usage message");
        assert.deepEqual(await snapshotTree(workDir), beforeMissing, "a missing <folder> creates nothing");

        // Row: <nonexistent-path> → exits non-zero stating the source could not be read, creating nothing.
        const beforeBad = await snapshotTree(workDir);
        r = runCli(repo, ["migrate", path.join(repo, "no-such-folder-xyz")]);
        assert.notEqual(r.status, 0, "a nonexistent path exits non-zero");
        assert.ok(/neither an existing local directory nor a reachable remote/i.test(r.stderr), `a nonexistent path states the source could not be read (stderr: ${r.stderr.slice(0, 200)})`);
        // The bad-path error is DISTINCT from the missing-folder usage error.
        assert.ok(!/migrate <folder>/.test(r.stderr), "the source-read error is distinct from the missing-folder usage error");
        assert.deepEqual(await snapshotTree(workDir), beforeBad, "a nonexistent path creates nothing");

        // Row: slot contention → lands at the next free slot, leaving existing items unchanged.
        const beforeContend = await snapshotTree(workDir);
        r = runMigrate(repo, src, ["--json"]);
        assert.equal(parseJsonStdout(r.stdout).milestoneRef, "01", "slot contention lands at the next free slot (01, after the 00 seed)");
        // the 00 seed is unchanged
        for (const key of Object.keys(beforeContend)) {
          assert.equal((await snapshotTree(workDir))[key], beforeContend[key], `existing item "${key}" is unchanged by slot contention`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: --json projects the produced item's ref, dir, and a scaffold summary (folded)
    name: "migrate-core/00 --json projects the produced item's ref, dir, and a scaffold-count summary (Scenario Outline, folded)",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        // Real run: names the ref + dir under work.dir + a scaffold-count summary.
        let r = runMigrate(repo, src, ["--json"]);
        assert.equal(r.status, 0, `--json exits 0 (stderr: ${r.stderr.slice(0, 160)})`);
        let json = parseJsonStdout(r.stdout);
        assert.equal(json.milestoneRef, "01", "the JSON names the produced milestone's ref");
        assert.ok(typeof json.dir === "string" && /01_milestone_calls/.test(json.dir), "the JSON names the produced dir under work.dir");
        assert.equal(typeof json.storyCount, "number", "the JSON reports a story count");
        assert.equal(typeof json.taskCount, "number", "the JSON reports a task-feature count");
        assert.equal(json.storyCount, 2, "the scaffold summary counts the two recovered stories");
        await rm(path.join(workDir, "01_milestone_calls"), { recursive: true, force: true });

        // Dry-run --json: names the ref + dir it WOULD create, with nothing written.
        const before = await snapshotTree(workDir);
        r = runMigrate(repo, src, ["--dry-run", "--json"]);
        assert.equal(r.status, 0, "--dry-run --json exits 0");
        json = parseJsonStdout(r.stdout);
        assert.equal(json.dryRun, true, "the JSON preview marks it a dry-run");
        assert.equal(json.milestoneRef, "01", "the JSON preview names the ref it WOULD create");
        assert.ok(/01_milestone_calls/.test(json.dir), "the JSON preview names the dir it WOULD create");
        assert.deepEqual(await snapshotTree(workDir), before, "the --dry-run --json writes nothing under work.dir");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },

  // ═══════════════ 01_migrate-vs-import-distinct-outcome.feature ═══════════════
  {
    // Scenario: migrate produces a managed item, not an AOF.md digest
    name: "migrate-core/01 migrate produces a managed milestone (SPEC.md + STATE.md) under work.dir, NOT an AOF.md digest",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.ok(existsSync(path.join(result.dir, "SPEC.md")), "a managed SPEC.md is created under work.dir");
        assert.ok(existsSync(path.join(result.dir, "STATE.md")), "a managed STATE.md is created under work.dir");
        // No AOF.md digest is written — anywhere under the produced item or the source.
        assert.ok(!existsSync(path.join(result.dir, "AOF.md")), "no AOF.md digest is written for the produced item");
        const sourceAof = path.join(src, "wiki", "work", "03_milestone_calls", "AOF.md");
        assert.ok(!existsSync(sourceAof), "no AOF.md digest is co-located in the source");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: migrate writes nothing into the import store
    name: "migrate-core/01 migrate writes nothing under .aof/imports/ (the import store is untouched)",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        runMigrate(repo, src);
        assert.ok(!existsSync(importStoreRoot(repo)), "nothing is written under .aof/imports/");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the produced item is managed — it is visible to the lifecycle commands
    name: "migrate-core/01 the produced item is visible to aof work list and selectable by aof work next",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const m = runMigrate(repo, src, ["--json"]);
        const ref = parseJsonStdout(m.stdout).milestoneRef;
        const list = runCli(repo, ["work", "list", "--json"]);
        assert.equal(list.status, 0, "work list exits 0");
        const rows = parseJsonStdout(list.stdout);
        assert.ok(rows.some((row) => row.ref === ref && row.type === "milestone"), "work list includes the produced milestone");
        // work next can select it as actionable work (it resolves to a real next item).
        const next = runCli(repo, ["work", "next", "--json"]);
        assert.equal(next.status, 0, "work next exits 0");
        const nextJson = parseJsonStdout(next.stdout);
        assert.ok(nextJson && (nextJson.ref != null || nextJson.state != null), "work next returns an actionable selection over the managed stream");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: import's outcome remains a read-only co-located digest, distinct from migrate
    name: "migrate-core/01 import over the same source materialises a co-located AOF.md digest and creates NO managed milestone",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const imp = runCli(repo, ["import", "milestone", src, "03", "--json"]);
        assert.equal(imp.status, 0, `import exits 0 (stderr: ${imp.stderr.slice(0, 200)})`);
        const json = parseJsonStdout(imp.stdout);
        assert.ok(json.artifacts.some((p) => /AOF\.md$/.test(p)), "an AOF.md digest is materialised for the source");
        // No managed milestone item is created under work.dir for it (only the 00 seed exists).
        const top = (await readdir(workDir, { withFileTypes: true })).filter((e) => e.isDirectory() && /_milestone_/.test(e.name)).map((e) => e.name);
        assert.deepEqual(top, ["00_milestone_seed-00"], "import creates no managed milestone under work.dir");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: migrate and import are distinct commands that do not alter each other
    // Scenario Outline: running one command leaves the other's prior output untouched (folded)
    name: "migrate-core/01 migrate and import are non-interfering: each leaves the other's prior output untouched (Scenario Outline, folded)",
    async run() {
      // Order A: migrate THEN import — the managed item survives, the digest is co-located.
      {
        const { repo, workDir } = await makeRepo(["00"]);
        const src = await makeAofSource();
        try {
          const m = runMigrate(repo, src, ["--json"]);
          const ref = parseJsonStdout(m.stdout).milestoneRef;
          const managedDir = path.join(workDir, `${ref}_milestone_calls`);
          const managedBefore = await snapshotTree(managedDir);
          runCli(repo, ["import", "milestone", src, "03"]);
          const managedAfter = await snapshotTree(managedDir);
          assert.deepEqual(managedAfter, managedBefore, "import after migrate leaves the managed milestone byte-for-byte unchanged (not turned into a digest)");
          assert.ok(existsSync(path.join(managedDir, "SPEC.md")), "the migrated item remains a managed milestone under work.dir");
          assert.ok(!existsSync(path.join(managedDir, "AOF.md")), "the managed item is not promoted into / replaced by a digest");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
      // Order B: import THEN migrate — the co-located digest survives, unpromoted.
      {
        const { repo, workDir } = await makeRepo(["00"]);
        const src = await makeAofSource();
        try {
          runCli(repo, ["import", "milestone", src, "03"]);
          const digestPath = path.join(src, "wiki", "work", "03_milestone_calls", "AOF.md");
          assert.ok(existsSync(digestPath), "precondition: import materialised the co-located AOF.md");
          const digestBefore = await readFile(digestPath, "utf8");
          runMigrate(repo, src);
          assert.equal(await readFile(digestPath, "utf8"), digestBefore, "migrate after import leaves the co-located digest byte-for-byte unchanged (not promoted into managed work)");
          // The digest folder is NOT a managed work item under work.dir.
          const top = (await readdir(workDir, { withFileTypes: true })).filter((e) => e.isDirectory() && /_milestone_/.test(e.name)).map((e) => e.name).sort();
          assert.ok(top.includes("01_milestone_calls"), "migrate produced its own managed item (from the source, not the digest)");
          assert.ok(!top.includes("03_milestone_calls"), "the import digest is not promoted to a managed work item");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
    },
  },
  {
    // Scenario Outline: the same source yields managed work under migrate and a digest under import
    name: "migrate-core/01 the same source diverges: migrate is managed-yes/digest-no/store-no, import is managed-no/digest-yes/store-no",
    async run() {
      // migrate row.
      {
        const { repo, workDir } = await makeRepo(["00"]);
        const src = await makeAofSource();
        try {
          const m = runMigrate(repo, src, ["--json"]);
          const ref = parseJsonStdout(m.stdout).milestoneRef;
          assert.ok(existsSync(path.join(workDir, `${ref}_milestone_calls`, "SPEC.md")), "migrate: a managed item under work.dir is PRESENT");
          assert.ok(!existsSync(path.join(src, "wiki", "work", "03_milestone_calls", "AOF.md")), "migrate: a co-located AOF.md digest is ABSENT");
          assert.ok(!existsSync(importStoreRoot(repo)), "migrate: anything under .aof/imports/ is ABSENT");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
      // import row.
      {
        const { repo, workDir } = await makeRepo(["00"]);
        const src = await makeAofSource();
        try {
          runCli(repo, ["import", "milestone", src, "03"]);
          const top = (await readdir(workDir, { withFileTypes: true })).filter((e) => e.isDirectory() && /_milestone_/.test(e.name)).map((e) => e.name);
          assert.deepEqual(top, ["00_milestone_seed-00"], "import: a managed item under work.dir is ABSENT (only the seed)");
          assert.ok(existsSync(path.join(src, "wiki", "work", "03_milestone_calls", "AOF.md")), "import: a co-located AOF.md digest is PRESENT");
          assert.ok(!existsSync(importStoreRoot(repo)), "import: anything under .aof/imports/ is ABSENT (co-located, not the store)");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
    },
  },

  // ═══════════════ 02_already-done-review-findings.feature (@executable) ═══════
  {
    // Scenario: a source with delivered work produces an item whose status reflects what is done
    name: "migrate-core/02 a source carrying delivered work produces an item whose status is NOT a uniform not-started",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeDeliveredWithGapsSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.notEqual(result.status, "not-started", "the produced status reflects that work was delivered (not a blank not-started)");
        assert.ok(["in-progress", "in-review"].includes(result.status), `the status is a delivered-work status (got "${result.status}")`);
        assert.notEqual(result.status, "done", 'migrate NEVER stamps "done" (earned via aof:verify)');
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: reconciliation records developer-actionable findings for the delivered work
    name: "migrate-core/02 reconciliation records developer-actionable findings (each naming what to act on) in the produced STATE.md",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeDeliveredWithGapsSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.ok(result.findingCount >= 1, "a findings record is written for the delivered-with-gaps source");
        const state = await readState(workDir, result.milestoneRef);
        assert.ok(/## Findings/.test(state), "the produced STATE.md carries a ## Findings section a developer picks up at aof:continue");
        assert.ok(/aof:continue/.test(state), "the findings record points to aof:continue");
        // Each finding NAMES what to act on (an imperative verb), not just "something is wrong".
        for (const finding of result.findings) {
          assert.ok(/\b(record|author|write|verify|add)\b/i.test(finding), `the finding names an action to take: "${finding}"`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a source with no delivered work produces a clean not-started item with no spurious findings
    name: "migrate-core/02 a source that states intent but delivered no work produces a not-started item with NO findings",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeThinSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.equal(result.status, "not-started", "no delivered work → a clean not-started item");
        assert.equal(result.findingCount, 0, "no findings are recorded for it (absence is information)");
        const state = await readState(workDir, result.milestoneRef);
        assert.ok(!/## Findings/.test(state), "no ## Findings section is written (no spurious findings)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: what the source has delivered determines the produced status and whether findings exist
    name: "migrate-core/02 the delivery axis maps {delivered} → {status, findings} (Scenario Outline, folded)",
    async run() {
      const { repo } = await makeRepo(["00"]);
      try {
        // Row: no delivered work → not-started, no findings.
        {
          const src = await makeThinSource();
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          assert.equal(result.status, "not-started", "no delivered work → not-started");
          assert.equal(result.findingCount, 0, "no delivered work → no findings");
          // clean up the produced item so the next row starts at the same slot
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
        // Rows: delivered with gaps → in-progress, findings present (delivered work +
        // no decisions/tasks → gaps). One representative fixture covers the gap rows
        // (the partial/most/all-with-gaps rows all map to in-progress + findings).
        {
          const src = await makeDeliveredWithGapsSource();
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          assert.equal(result.status, "in-progress", "delivered with gaps → in-progress (never done)");
          assert.ok(result.findingCount >= 1, "delivered with gaps → findings present");
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
        // Row: fully delivered, no gaps → in-review, no findings. An aof source whose
        // STATE marks progress AND carries decisions (ADR) + a task feature → no gaps.
        {
          const src = await makeAofSource();
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          assert.equal(result.status, "in-review", "fully + cleanly delivered → in-review (the honest verify-ready ceiling)");
          assert.equal(result.findingCount, 0, "clean delivery → no findings");
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario (G1 clamp guard): a source self-asserting `done` is clamped, never echoed
    name: "migrate-core/02 a source self-asserting Done with clean full delivery clamps to in-review — migrate NEVER emits done",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeDoneMarkerSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        // The contract's signature rule: a source's self-asserted "done" clamps to at
        // most in-review; migrate NEVER stamps "done" (earned only via aof:verify).
        assert.equal(result.status, "in-review", 'a source-asserted "Done" + clean delivery clamps to exactly in-review');
        assert.notEqual(result.status, "done", 'migrate NEVER emits "done", even when the source self-asserts it');
        assert.equal(result.findingCount, 0, "clean full delivery → no findings");
        // The produced frontmatter status echoes the clamped value, never "done".
        const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
        assert.ok(/^status:\s*in-review$/m.test(spec), "the produced SPEC frontmatter status is in-review");
        assert.ok(!/^status:\s*done$/m.test(spec), 'the produced SPEC frontmatter is never "done"');
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },

  // ═══════════════ 03_source-shape-tolerance.feature (@executable) ═════════════
  {
    // Scenario: a non-aof folder (a README and code, no aof docs) migrates without error
    name: "migrate-core/03 a non-aof folder (README + code, no aof docs) migrates without error, recovering the README as the objective",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeBareReadmeSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        assert.ok(existsSync(path.join(result.dir, "SPEC.md")), "the command produces a managed item");
        const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
        assert.ok(/URL shortener/.test(spec), "the README's overview is recovered as the produced SPEC.md's objective");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: migrate never requires the source to be reshaped into aof's layout first
    name: "migrate-core/03 a folder with neither wiki/work nor NN_milestone_ naming migrates as-is, never erroring to be restructured",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeBareReadmeSource();
      try {
        const result = runMigrate(repo, src);
        assert.equal(result.status, 0, `it migrates the folder as-is (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(!/restructur|wiki\/work|NN_milestone/i.test(result.stderr), "it does NOT error asking the source to be restructured into aof's conventions");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a thin source recovers a thin item — present signals only, nothing fabricated
    name: "migrate-core/03 a thin source recovers the overview as the objective and marks the absent decisions/outcomes as not recoverable",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeThinSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
        assert.ok(/sync notes across devices/.test(spec), "the produced item recovers the overview as its objective");
        // Decisions are absent → NO ARCHITECTURE.md is fabricated.
        assert.ok(!existsSync(path.join(result.dir, "ARCHITECTURE.md")), "the missing decisions are not invented (no ARCHITECTURE.md)");
        // Outcomes are absent → STATE records them as not recoverable, not fabricated.
        const state = await readFile(path.join(result.dir, "STATE.md"), "utf8");
        assert.ok(/not.*recover|No delivered outcomes/i.test(state), "the missing outcomes are recorded as not recoverable, never invented");
        assert.equal(result.findingCount, 0, "a thin (no delivered work) source records no findings");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an empty or unrecoverable source is refused cleanly, leaving nothing half-written
    name: "migrate-core/03 an empty/unrecoverable source is refused (non-zero), leaving no partial milestone under work.dir",
    async run() {
      const { repo, workDir } = await makeRepo(["00"]);
      const src = await makeEmptySource();
      try {
        const before = await snapshotTree(workDir);
        const result = runMigrate(repo, src);
        assert.notEqual(result.status, 0, "an empty source exits non-zero");
        assert.ok(/nothing was recoverable|nothing.*recoverable/i.test(result.stderr), `stderr states nothing was recoverable to migrate (stderr: ${result.stderr.slice(0, 200)})`);
        assert.deepEqual(await snapshotTree(workDir), before, "no partial milestone folder is left under work.dir");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: migrate reads the source read-only — the source folder is unchanged after migrating
    name: "migrate-core/03 the source folder's contents are byte-for-byte unchanged after migrating",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAofSource();
      try {
        const before = await snapshotTree(src);
        const result = runMigrate(repo, src);
        assert.equal(result.status, 0, "migrate exits 0");
        const after = await snapshotTree(src);
        assert.deepEqual(after, before, "the source tree is byte-for-byte unchanged (read-only)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: the source shape determines what is recovered, never demanding aof's layout (folded)
    name: "migrate-core/03 the source-shape matrix: aof / README+docs / docs+ADR / bare / thin migrate; empty is refused (Scenario Outline, folded)",
    async run() {
      const { repo } = await makeRepo(["00"]);
      try {
        // Row: an aof-structured source → a managed item carrying the recovered SPEC + stories/tasks.
        {
          const src = await makeAofSource();
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          assert.ok(existsSync(path.join(result.dir, "SPEC.md")), "[aof] a managed item is produced");
          assert.ok(result.storyCount >= 1, "[aof] it carries the recovered stories");
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
        // Row: a README + docs/ tree → a managed item recovered from its README + docs, source unreshaped.
        {
          const src = await makeDocsAdrSource();
          const before = await snapshotTree(src);
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
          assert.ok(/payments gateway/.test(spec), "[docs+ADR] the README overview is recovered");
          assert.ok(existsSync(path.join(result.dir, "ARCHITECTURE.md")), "[docs+ADR] the ADR decisions are recovered into ARCHITECTURE.md");
          assert.deepEqual(await snapshotTree(src), before, "[docs+ADR] the source is unreshaped");
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
        // Row: a bare README + code → a managed item with the README as objective.
        {
          const src = await makeBareReadmeSource();
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
          assert.ok(/URL shortener/.test(spec), "[bare] the README is recovered as the objective");
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
        // Row: only an overview → a thin item, missing decisions/outcomes marked absent.
        {
          const src = await makeThinSource();
          const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
          assert.ok(!existsSync(path.join(result.dir, "ARCHITECTURE.md")), "[thin] absent decisions are not fabricated");
          await rm(result.dir, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
        // Row: an empty folder → a non-zero refusal, work.dir untouched.
        {
          const { repo: repo2, workDir: workDir2 } = await makeRepo(["00"]);
          const src = await makeEmptySource();
          try {
            const before = await snapshotTree(workDir2);
            const r = runMigrate(repo2, src);
            assert.notEqual(r.status, 0, "[empty] a non-zero refusal");
            assert.ok(/recoverable/i.test(r.stderr), "[empty] it states nothing was recoverable");
            assert.deepEqual(await snapshotTree(workDir2), before, "[empty] work.dir is untouched");
          } finally {
            await rm(repo2, { recursive: true, force: true });
            await rm(src, { recursive: true, force: true });
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ═══════════════ review fixes — YAML safety + partial-write rollback ═════════
  {
    // Fix 1 (correctness): an adversarial recovered title must not break the produced
    // milestone — a `"`, a newline, or a `status:`-looking substring in the title must
    // not corrupt the `---` frontmatter or inject a line, so `work validate` still passes.
    name: "migrate-core/00 an adversarial recovered title (embedded quote, newline, status:-like text) still produces a milestone that passes work validate",
    async run() {
      const { repo } = await makeRepo(["00"]);
      const src = await makeAdversarialTitleSource();
      try {
        const result = await invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo));
        const spec = await readFile(path.join(result.dir, "SPEC.md"), "utf8");
        // The frontmatter is intact: exactly one `---`-delimited block, a single
        // `title:` line, a `status:` line that is the real status (not the injected
        // `status: pwned` from the title), and a `type: milestone` line.
        const fmMatch = spec.match(/^---\n([\s\S]*?)\n---\n/);
        assert.ok(fmMatch, "the produced SPEC has an intact --- frontmatter block");
        const fm = fmMatch[1];
        assert.equal((fm.match(/^title:/gm) ?? []).length, 1, "exactly one title: line in the frontmatter (no injected line)");
        assert.ok(/^status:\s*not-started$/m.test(fm), "the status: line is the real status, not the title's injected status: substring");
        assert.ok(!/^status:\s*pwned$/m.test(fm), "the title's `status: pwned` substring did not inject a frontmatter line");
        // The body heading is a single line (the title's newline was collapsed).
        const headingLine = (spec.split(/\r?\n/).find((l) => /^#\s+\d+\s/.test(l)) ?? "");
        assert.ok(headingLine.length > 0 && !/\n/.test(headingLine), "the `# N · title` body heading is a single line");
        // The real proof: the produced milestone passes `aof work validate`.
        const validate = runCli(repo, ["work", "validate"]);
        assert.equal(validate.status, 0, `work validate passes over the adversarial-title milestone (stdout: ${validate.stdout.slice(0, 300)})`);
        assert.ok(/PASS/i.test(validate.stdout), "work validate reports the stream is well-formed");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Fix 2 (correctness), boundary: when the destination milestone path is already
    // occupied (a stray FILE at `NN_milestone_slug`, which `nextFreeSlot` — counting
    // only DIRECTORIES — does not skip past), the scaffold's own `mkdir(milestoneDir)`
    // fails BEFORE any doc is written. migrate must reject and leave NO partial
    // milestone scaffolded (no SPEC/STATE/stories), and must NOT delete the stray path
    // it did not create (`createdFresh` is false). A deterministic, cross-platform inj.
    name: "migrate-core/03 a blocked destination path is refused, scaffolding no partial milestone and never deleting a path migrate did not create",
    async run() {
      const { repo, workDir } = await makeRepo([]);
      const src = await makeAofSource();
      try {
        // The milestone scaffolds at the next free slot (00) with slug "calls" →
        // 00_milestone_calls. Plant a regular FILE there: a file is not a directory, so
        // nextFreeSlot still picks slot 00, and the command's mkdir(milestoneDir) throws.
        const dest = path.join(workDir, "00_milestone_calls");
        await writeFile(dest, "stray\n", "utf8");
        const afterPlant = await snapshotTree(workDir);
        await assert.rejects(
          invoke("migrate:folder", { folder: src, migratedAt: MIGRATED_AT }, await ctxFor(repo)),
          "a blocked destination path rejects (the failure is surfaced, not swallowed)"
        );
        // No partial milestone is scaffolded: no SPEC/STATE/stories under the dest, and
        // the stray FILE migrate did not create is left intact (no destructive cleanup).
        assert.ok(!existsSync(path.join(dest, "SPEC.md")), "no partial SPEC.md is scaffolded under the blocked destination");
        assert.ok(!existsSync(path.join(dest, "stories")), "no partial stories/ tree is scaffolded under the blocked destination");
        assert.deepEqual(await snapshotTree(workDir), afterPlant, "work.dir is unchanged — the stray path migrate did not create is preserved, nothing partial added");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Fix 2 (correctness), the ROLLBACK branch — STRUCTURAL guard. A black-box test
    // cannot deterministically inject a POST-mkdir write failure here: `nextFreeSlot`
    // always returns one beyond the max existing milestone DIRECTORY, so pre-planting a
    // blocker INSIDE the fresh destination shifts the slot one past it (the command
    // never lands on a path we pre-occupied), and `node:fs/promises` named exports are
    // non-configurable so the writer cannot be mocked. The post-mkdir failure path is
    // therefore guarded structurally: the scaffold's mkdir + every write run under ONE
    // try whose catch removes the freshly-created milestone dir (guarded by
    // `createdFresh`) and rethrows — so a mid-scaffold throw leaves NO partial milestone.
    // The boundary test above proves the cross-platform observable (a blocked
    // destination scaffolds nothing partial); this pins the rollback's exact shape so a
    // future refactor that drops the cleanup is caught.
    name: "migrate-core/03 the scaffold's rollback path is present: a single try/catch around the mkdir+writes that rm's the freshly-created milestone dir and rethrows",
    async run() {
      const moduleUrl = new URL("../src/commands/migrate-folder.mjs", import.meta.url);
      const code = await readFile(moduleUrl, "utf8");
      // The scaffold runs under a try whose catch rm's the freshly-created milestoneDir
      // and rethrows (all-or-nothing). Assert the shape rather than re-deriving it.
      const scaffold = code.slice(code.indexOf("// SCAFFOLD the managed milestone"));
      assert.ok(/let createdFresh = false;/.test(scaffold), "the scaffold tracks whether it created the milestone dir (createdFresh)");
      assert.ok(/await mkdir\(milestoneDir, \{ recursive: true \}\)\) !== undefined/.test(scaffold), "createdFresh is set from mkdir(milestoneDir)'s return (the dir was freshly created)");
      assert.ok(/\}\s*catch\s*\(\s*err\s*\)\s*\{/.test(scaffold), "the scaffold writes run inside a try/catch");
      assert.ok(/if \(createdFresh\) await rm\(milestoneDir, \{ recursive: true, force: true \}\);/.test(scaffold), "the catch rm's ONLY the freshly-created milestone dir (rollback, non-destructive)");
      assert.ok(/await rm\(milestoneDir,[^;]*\);\s*throw err;/.test(scaffold), "the catch rethrows after rolling back (the failure is surfaced, never swallowed)");
    },
  },
];

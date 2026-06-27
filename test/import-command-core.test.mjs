// Traceability wiring for milestone 13 / story 00 — the import command + the
// frozen materialize contract (the SPINE).
//
// One test object per @executable scenario across the four task features (the
// @manual live-remote/network rows are DEFERRED — they need a real external repo +
// network and assert only the observable outcome). Scenario-Outline rows are
// folded into one entry; each name traces to feature + scenario.
//
//   00_command-registered-and-invokable.feature — import:milestone registered in
//        the frozen Command core ({id,input,run,cli}); `aof import milestone <repo>
//        <selector>` dispatches via invoke; --json projects materialized paths +
//        a record-count summary; a missing <repo> / unknown sub-noun fails cleanly;
//        the arg-shape matrix (incl. the missing-selector default: one ⇒ import,
//        ambiguous ⇒ ask which).
//   01_materializes-frozen-artifact-pair.feature — a FIXED recovery input
//        materializes the frozen pair (SPEC.md legible intent + ARCHITECTURE.md
//        `## ADR-NNN` / RETROSPECTIVE.md `## R<n>`) in the .aof/ import store,
//        OUTSIDE workDir, non-NN_type_slug, git-ignored via a nested .gitignore;
//        the recovered-input → artifact-set mapping (intent-only … all three).
//   02_dry-run-previews-without-writing.feature — --dry-run previews the artifacts
//        + record count and writes/indexes/networks NOTHING; --json preview.
//   03_source-repo-untouched.feature — after an import the source tree hash +
//        `git status --porcelain` are byte-for-byte unchanged; no file in the
//        source is created/deleted/modified.
//
// DEFERRED (@manual, not run here): 02's "--dry-run against a real remote repo"
// and 03's "importing from a real remote URL" rows — they need a reachable remote
// URL + live network (the read-only git fetch leg). Tracked in the features as
// @manual; the read-only boundary they assert is pinned structurally by the
// story-03 arch-test acd-import-read-only-source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { getCommand, invoke } from "../src/command-core.mjs";
import { materializeImport } from "../src/import/materialize.mjs";
import { importStoreRoot } from "../src/import/store.mjs";
import { memoryIndexPath } from "../src/memory/local-indexing.mjs";
import { parseArchitecture, parseRetrospective } from "../src/memory/local-indexing.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// The work-item naming pattern an import must NEVER match (ADR-004, mirrors
// src/work.mjs ITEM_RE).
const WORK_ITEM_RE = /^\d+_(milestone|story|task|uat)_[a-z0-9-]+$/;

// --- fixed recovery input (the features' "fixed recovery input" Background) ------
//
// Story 00's @executable tests drive materialize with a FIXED `recovered` directly
// (NOT the story-01 recovery stub). This is the FROZEN recovered shape.
function fixedRecovered({ intent = true, decisions = true, outcomes = true } = {}) {
  return {
    intent: intent ? { objective: "Recover the milestone faithfully.", scope: "In: the import. Out: live sync." } : null,
    decisions: decisions
      ? [
          { id: "ADR-001", title: "Materialize a frozen artifact pair", status: "Accepted", body: "**Decision.** Reuse the 05 doc shapes so the existing parsers index it." },
          { id: "ADR-002", title: "Read the source read-only", status: "Accepted", body: "**Decision.** A local repo is read in place; a remote is fetched read-only." },
        ]
      : [],
    outcomes: outcomes
      ? [
          { id: "R1", title: "Freezing the artifact shape first unblocked the siblings", body: "- **Lesson:** freeze the seam before fanning out." },
        ]
      : [],
  };
}

// --- fixture builders -----------------------------------------------------------

// A minimal project root with a .aof config — enough for loadWorkspace to resolve
// projectRoot/workDir (mirrors graph-command-core's makeRepo).
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-import-core-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { repo, workDir };
}

// A local aof-structured SOURCE fixture repo with recoverable milestone(s) read in
// place via the read-only seam. `milestones` is an array of refs (each gets a
// `NN_milestone_demo-<ref>` folder with a SPEC.md). Returns the source dir.
async function makeSourceRepo(milestones = ["00"]) {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-import-src-"));
  const workDir = path.join(src, "wiki", "work");
  for (const ref of milestones) {
    const dir = path.join(workDir, `${ref}_milestone_demo-${ref}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SPEC.md"),
      `# ${ref} Demo\n\n## Objective\n\nDeliver milestone ${ref}.\n\n## Scope\n\nIn scope: ${ref}. Out: the rest.\n`,
      "utf8"
    );
  }
  return src;
}

// A REAL temp git repo source fixture (the Three-Amigos harness helper
// `makeGitFixtureRepo`): `git init`, a milestone SPEC.md, an initial commit. Used
// for the source-untouched assertions (a real HEAD sha + clean working tree). `git`
// is already a CI dependency.
async function makeGitFixtureRepo(milestones = ["00"]) {
  const src = await makeSourceRepo(milestones);
  const git = (args) => spawnSync("git", args, { cwd: src, encoding: "utf8", shell: process.platform === "win32" });
  git(["init", "-q"]);
  git(["config", "user.email", "fixture@aof.local"]);
  git(["config", "user.name", "aof fixture"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "fixture milestone"]);
  return src;
}

// The git-backed tree state of a repo: HEAD sha + `git status --porcelain` (the
// `treeStateOf` harness helper). Byte-for-byte equality of both before/after is the
// source-untouched assertion (03).
function treeStateOf(repoDir) {
  const git = (args) => spawnSync("git", args, { cwd: repoDir, encoding: "utf8", shell: process.platform === "win32" });
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const porcelain = git(["status", "--porcelain"]).stdout;
  return { head, porcelain };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// Spawn `aof <args>` with cwd at the project root; returns { status, stdout, stderr }.
function runCli(root, args, env = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Parse the single JSON document a --json run prints (the `parseJsonStdout` helper).
function parseJsonStdout(stdout) {
  return JSON.parse(stdout);
}

// Drive the import command through the CLI against a source fixture, with the
// source resolved IN PLACE (a real local dir). The repo positional IS the source
// dir (an existing directory → the local read-in-place lane, no network).
function runImport(projectRoot, sourceDir, extra = []) {
  return runCli(projectRoot, ["import", "milestone", sourceDir, ...extra]);
}

export const importCommandCoreTests = [
  // ═════════════ 00_command-registered-and-invokable.feature ══════════════════
  {
    name: "import-core/00 import:milestone is registered in the Command core with the frozen shape",
    async run() {
      const command = getCommand("import:milestone");
      assert.ok(command, "getCommand(\"import:milestone\") returns a command");
      // Its keys are exactly id, input, run, cli.
      assert.deepEqual(
        Object.keys(command).sort(),
        ["cli", "id", "input", "run"],
        "the command's keys are exactly id, input, run, cli"
      );
      assert.equal(command.id, "import:milestone", "id is \"import:milestone\"");
      assert.equal(typeof command.run, "function", "run is callable");
      assert.equal(command.run.constructor.name, "AsyncFunction", "run is async");
      assert.ok(command.cli && typeof command.cli === "object", "cli adapter is present");
      assert.equal(typeof command.cli.argv, "function", "cli.argv is callable");
      assert.equal(typeof command.cli.render, "function", "cli.render is callable");
      assert.equal(typeof command.cli.json, "function", "cli.json is callable");
      // input is plain serialisable data (survives a JSON round-trip unchanged).
      assert.deepEqual(JSON.parse(JSON.stringify(command.input)), command.input, "input is plain data");
    },
  },
  {
    name: "import-core/00 aof import milestone over a local fixture repo exits 0 and reports what it imported",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        const result = runImport(repo, src, ["00"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(/milestone 00/i.test(result.stdout), `stdout reports the imported milestone (stdout: ${result.stdout.slice(0, 200)})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/00 --json projects the materialized artifact paths and a record-count summary",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        const result = runImport(repo, src, ["00", "--json"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const json = parseJsonStdout(result.stdout);
        assert.ok(Array.isArray(json.artifacts), "the JSON result lists the materialized artifact paths");
        assert.ok(json.artifacts.length >= 1, "at least one artifact path is listed");
        // The import writes a single co-located AOF.md digest INTO the source folder.
        assert.ok(json.artifacts.some((p) => /AOF\.md$/.test(p)), "AOF.md is among the artifact paths");
        assert.ok(/[\\/]00_milestone_demo-00[\\/]AOF\.md$/.test(json.artifacts[0]), "the AOF.md sits in the SOURCE milestone folder, not a separate store");
        assert.equal(typeof json.recordCount, "number", "the JSON result reports a record-count summary");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/00 a missing <repo> fails cleanly with a usage message and materializes nothing",
    async run() {
      const { repo } = await makeRepo();
      try {
        const result = runCli(repo, ["import", "milestone"]);
        assert.notEqual(result.status, 0, "exits non-zero on a missing <repo>");
        assert.ok(
          /import milestone <repo> <selector>/.test(result.stderr),
          `stderr shows the usage message (stderr: ${result.stderr.slice(0, 200)})`
        );
        // Nothing is materialized: no import store exists under the project.
        assert.ok(!existsSync(importStoreRoot(repo)), "no import store is created");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/00 an unknown sub-noun fails cleanly citing the supported unit \"milestone\"",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        const result = runCli(repo, ["import", "widget", src, "00"]);
        assert.notEqual(result.status, 0, "exits non-zero on an unknown sub-noun");
        assert.ok(
          /"milestone"/.test(result.stderr),
          `stderr states the supported import unit is "milestone" (stderr: ${result.stderr.slice(0, 200)})`
        );
        assert.ok(!existsSync(importStoreRoot(repo)), "nothing is materialized");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/00 the import argument shape determines the outcome (Scenario Outline, folded)",
    async run() {
      const oneMilestoneSrc = await makeSourceRepo(["00"]);
      const manyMilestoneSrc = await makeSourceRepo(["00", "01"]);
      const { repo } = await makeRepo();
      try {
        // Row: <one-milestone-repo> 00 → exits 0 and reports the imported milestone.
        let r = runImport(repo, oneMilestoneSrc, ["00"]);
        assert.equal(r.status, 0, `<repo> 00 exits 0 (stderr: ${r.stderr.slice(0, 160)})`);
        assert.ok(/milestone 00/i.test(r.stdout), "<repo> 00 reports the imported milestone");

        // Row: <one-milestone-repo> (no selector) → exits 0 and imports the sole milestone.
        r = runImport(repo, oneMilestoneSrc, []);
        assert.equal(r.status, 0, `<repo> (no selector) exits 0 (stderr: ${r.stderr.slice(0, 160)})`);
        assert.ok(/milestone 00/i.test(r.stdout), "the sole milestone is imported when the selector is omitted");

        // Row: (no args) → exits non-zero with a usage message.
        r = runCli(repo, ["import", "milestone"]);
        assert.notEqual(r.status, 0, "no args exits non-zero");
        assert.ok(/import milestone <repo> <selector>/.test(r.stderr), "no args shows a usage message");

        // Row: <many-milestone-repo> (no selector) → exits non-zero asking which milestone.
        r = runImport(repo, manyMilestoneSrc, []);
        assert.notEqual(r.status, 0, "an ambiguous source (no selector) exits non-zero");
        assert.ok(
          /more than one recoverable milestone|which/i.test(r.stderr),
          `an ambiguous source asks which milestone (stderr: ${r.stderr.slice(0, 200)})`
        );

        // Row: widget <one-milestone-repo> 00 → exits non-zero citing the unit "milestone".
        r = runCli(repo, ["import", "widget", oneMilestoneSrc, "00"]);
        assert.notEqual(r.status, 0, "an unknown sub-noun exits non-zero");
        assert.ok(/"milestone"/.test(r.stderr), "an unknown sub-noun cites the unit \"milestone\"");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(oneMilestoneSrc, { recursive: true, force: true });
        await rm(manyMilestoneSrc, { recursive: true, force: true });
      }
    },
  },

  // ═════════════ 01_materializes-frozen-artifact-pair.feature ═════════════════
  {
    name: "import-core/01 the import store holds the recovered SPEC.md recording the intent",
    async run() {
      const { repo } = await makeRepo();
      try {
        const out = await materializeImport(
          { projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: fixedRecovered() }
        );
        const specPath = path.join(out.dir, "SPEC.md");
        assert.ok(existsSync(specPath), "the import store holds a SPEC.md");
        const body = await readFile(specPath, "utf8");
        assert.ok(/Recover the milestone faithfully/.test(body), "SPEC.md records the recovered intent (Objective)");
        assert.ok(/## Scope/.test(body) && /live sync/.test(body), "SPEC.md records the recovered scope");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/01 the import store holds a knowledge artifact in the 05 heading conventions (parsers read it)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const out = await materializeImport(
          { projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: fixedRecovered() }
        );
        const archPath = path.join(out.dir, "ARCHITECTURE.md");
        const retroPath = path.join(out.dir, "RETROSPECTIVE.md");
        assert.ok(existsSync(archPath), "the import store holds an ARCHITECTURE.md");
        assert.ok(existsSync(retroPath), "the import store holds a RETROSPECTIVE.md");

        const archBody = await readFile(archPath, "utf8");
        const retroBody = await readFile(retroPath, "utf8");
        assert.ok(/^## ADR-\d+/m.test(archBody), "ARCHITECTURE.md uses the \"## ADR-NNN\" heading convention");
        assert.ok(/^## R\d+/m.test(retroBody), "RETROSPECTIVE.md uses the \"## R<n>\" heading convention");

        // The load-bearing ADR-001 contract: the EXISTING parsers index it with no
        // new parser — assert the materialized headings parse cleanly into records.
        const meta = { item: "00", itemSlug: "import-00", workRelPath: "ARCHITECTURE.md" };
        const adrs = parseArchitecture(archBody, meta);
        assert.equal(adrs.length, 2, "parseArchitecture derives one adr per recovered decision");
        assert.ok(adrs.every((r) => r.recordType === "adr"), "every derived record is an adr");
        assert.ok(adrs.every((r) => /^ADR-\d+$/.test(r.id)), "each adr id is recovered from the heading");
        assert.ok(adrs.every((r) => r.status.length > 0), "each adr carries its Status");

        const lessons = parseRetrospective(retroBody, { ...meta, workRelPath: "RETROSPECTIVE.md" });
        assert.equal(lessons.length, 1, "parseRetrospective derives one lesson per recovered outcome");
        assert.equal(lessons[0].recordType, "lesson", "the derived record is a lesson");
        assert.equal(lessons[0].id, "R1", "the lesson id is recovered from the heading");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/01 every materialized artifact carries deterministic import-provenance frontmatter (byte-identical re-import)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const out1 = await materializeImport(
          { projectRoot: repo, sourceSlug: "voice-vox-cadence", milestoneRef: "13", recovered: fixedRecovered() }
        );
        const bodies1 = {};
        for (const file of ["SPEC.md", "ARCHITECTURE.md", "RETROSPECTIVE.md"]) {
          const p = path.join(out1.dir, file);
          assert.ok(existsSync(p), `${file} is materialized`);
          const body = await readFile(p, "utf8");
          bodies1[file] = body;
          const fm = body.split(/\n---\n/)[0]; // the frontmatter block (before the closing ---)
          assert.ok(/^imported: true$/m.test(fm), `${file} frontmatter sets imported: true`);
          assert.ok(/^source: voice-vox-cadence$/m.test(fm), `${file} frontmatter names the source slug`);
          assert.ok(/^sourceRef: "13"$/m.test(fm), `${file} frontmatter names the sourceRef`);
          // NOT work-item frontmatter (ADR-004): no type/number/status keys — an import is never managed work.
          assert.ok(!/^(type|number|status):/m.test(fm), `${file} frontmatter is NOT work-item frontmatter`);
          // No timestamp / indexed-at field (ADR-005 determinism).
          assert.ok(!/(importedAt|indexedAt|timestamp|date):/i.test(fm), `${file} frontmatter carries no timestamp`);
        }
        // The frontmatter is ADDITIVE — the EXISTING parsers still derive the same records (ADR-001:
        // no new parser; they key off headings, not frontmatter).
        const meta = { item: "13", itemSlug: "import-13", workRelPath: "ARCHITECTURE.md" };
        assert.equal(parseArchitecture(bodies1["ARCHITECTURE.md"], meta).length, 2, "the existing parser still derives the adr records");
        assert.equal(
          parseRetrospective(bodies1["RETROSPECTIVE.md"], { ...meta, workRelPath: "RETROSPECTIVE.md" }).length,
          1,
          "the existing parser still derives the lesson record"
        );
        // DETERMINISTIC: a re-import over the same input yields BYTE-IDENTICAL artifacts (no timestamp —
        // the ADR-005 clean-snapshot invariant that acd-import-derived-index pins).
        const out2 = await materializeImport(
          { projectRoot: repo, sourceSlug: "voice-vox-cadence", milestoneRef: "13", recovered: fixedRecovered() }
        );
        for (const file of ["SPEC.md", "ARCHITECTURE.md", "RETROSPECTIVE.md"]) {
          const body2 = await readFile(path.join(out2.dir, file), "utf8");
          assert.equal(body2, bodies1[file], `${file} is byte-identical on a re-import (provenance carries no timestamp)`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/01 the import store is rooted under .aof/ and outside the configured workDir",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const out = await materializeImport(
          { projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: fixedRecovered() }
        );
        const rel = path.relative(repo, out.dir).split(path.sep);
        assert.equal(rel[0], ".aof", "the import store path is under .aof/");
        // Outside workDir: workDir is not a prefix of the materialized dir.
        const relToWork = path.relative(workDir, out.dir);
        assert.ok(
          relToWork.startsWith(".."),
          `the import store path is NOT under the configured workDir (relToWork: ${relToWork})`
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/01 the materialized milestone folder is not an NN_type_slug work-item name",
    async run() {
      const { repo } = await makeRepo();
      try {
        const out = await materializeImport(
          { projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: fixedRecovered() }
        );
        const folder = path.basename(out.dir);
        assert.ok(
          !WORK_ITEM_RE.test(folder),
          `the milestone folder name "${folder}" does NOT match ^\\d+_(milestone|story|task|uat)_[a-z0-9-]+$`
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/01 the import store is git-ignored via a nested .gitignore (git status shows nothing under it)",
    async run() {
      const { repo } = await makeRepo();
      // Make the project a real git repo so `git status --porcelain` is meaningful.
      const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8", shell: process.platform === "win32" });
      git(["init", "-q"]);
      git(["config", "user.email", "fixture@aof.local"]);
      git(["config", "user.name", "aof fixture"]);
      git(["config", "commit.gpgsign", "false"]);
      try {
        await materializeImport(
          { projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: fixedRecovered() }
        );
        // A .gitignore exists at the import store root.
        assert.ok(existsSync(path.join(importStoreRoot(repo), ".gitignore")), "a .gitignore exists at the import store root");
        // `git status --porcelain` shows nothing under the import store (the
        // materialized .md are ignored; only the .aof config + the nested .gitignore
        // pattern itself are visible, never the materialized artifacts).
        const porcelain = git(["status", "--porcelain"]).stdout;
        const underStore = porcelain
          .split(/\r?\n/)
          .filter((line) => /\.aof[\\/]imports[\\/]/.test(line))
          .filter((line) => !/\.gitignore$/.test(line)); // the nested .gitignore is allowed to show
        assert.equal(
          underStore.length,
          0,
          `git status --porcelain shows nothing (but the nested .gitignore) under the import store (saw: ${underStore.join(" | ")})`
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/01 a recovered input materializes the corresponding artifact set (Scenario Outline, folded)",
    async run() {
      const cases = [
        { label: "intent only", recovered: fixedRecovered({ decisions: false, outcomes: false }), arch: false, retro: false },
        { label: "intent and decisions", recovered: fixedRecovered({ outcomes: false }), arch: true, retro: false },
        { label: "intent and outcomes", recovered: fixedRecovered({ decisions: false }), arch: false, retro: true },
        { label: "intent, decisions, and outcomes", recovered: fixedRecovered(), arch: true, retro: true },
      ];
      for (const { label, recovered, arch, retro } of cases) {
        const { repo } = await makeRepo();
        try {
          const out = await materializeImport(
            { projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered }
          );
          // SPEC.md is ALWAYS materialized.
          assert.ok(existsSync(path.join(out.dir, "SPEC.md")), `[${label}] SPEC.md is always materialized`);
          assert.equal(
            existsSync(path.join(out.dir, "ARCHITECTURE.md")),
            arch,
            `[${label}] ARCHITECTURE.md presence is ${arch}`
          );
          assert.equal(
            existsSync(path.join(out.dir, "RETROSPECTIVE.md")),
            retro,
            `[${label}] RETROSPECTIVE.md presence is ${retro}`
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ═════════════ 02_dry-run-previews-without-writing.feature ══════════════════
  {
    name: "import-core/02 --dry-run previews the artifacts and the record count it would materialize",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        const result = runImport(repo, src, ["00", "--dry-run"]);
        assert.equal(result.status, 0, `--dry-run exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        assert.ok(/would materialize/i.test(result.stdout), "stdout previews the artifacts it would materialize");
        assert.ok(/record\(s\)/i.test(result.stdout), "stdout reports the record count it would yield");
        // Nothing was written: no import store under the project.
        assert.ok(!existsSync(importStoreRoot(repo)), "--dry-run writes nothing (no import store created)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/02 after --dry-run the import store is unchanged and the memory index is untouched",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        // Record the import store + memory index state BEFORE the run: neither exists.
        const storeBefore = existsSync(importStoreRoot(repo));
        const indexBefore = existsSync(memoryIndexPath(repo));
        assert.equal(storeBefore, false, "precondition: no import store before the run");
        assert.equal(indexBefore, false, "precondition: no memory index before the run");

        const result = runImport(repo, src, ["00", "--dry-run"]);
        assert.equal(result.status, 0, `--dry-run exits 0 (stderr: ${result.stderr.slice(0, 200)})`);

        assert.equal(existsSync(importStoreRoot(repo)), false, "no file is created in the import store");
        assert.equal(existsSync(memoryIndexPath(repo)), false, "the memory index is unchanged (untouched)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    // Companion to the absent-index case above: prove "unchanged" on a POPULATED
    // index. With a PRE-EXISTING index present, a --dry-run must leave it BYTE-
    // identical (it indexes nothing), not merely "still absent".
    name: "import-core/02 after --dry-run a pre-existing memory index is byte-identical (unchanged, not just absent)",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        // Seed a populated memory index BEFORE the dry-run.
        const indexPath = memoryIndexPath(repo);
        await mkdir(path.dirname(indexPath), { recursive: true });
        const seeded = `${JSON.stringify({ records: [{ id: "seed", recordType: "lesson" }] }, null, 2)}\n`;
        await writeFile(indexPath, seeded, "utf8");
        const before = await readFile(indexPath, "utf8");

        const result = runImport(repo, src, ["00", "--dry-run"]);
        assert.equal(result.status, 0, `--dry-run exits 0 (stderr: ${result.stderr.slice(0, 200)})`);

        const after = await readFile(indexPath, "utf8");
        assert.equal(after, before, "the pre-existing memory index is byte-identical after the dry-run (unchanged)");
        assert.equal(existsSync(importStoreRoot(repo)), false, "and the dry-run still wrote nothing to the import store");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/02 --dry-run with --json emits the preview as structured data without writing",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeSourceRepo(["00"]);
      try {
        const result = runImport(repo, src, ["00", "--dry-run", "--json"]);
        assert.equal(result.status, 0, `--dry-run --json exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const json = parseJsonStdout(result.stdout);
        assert.equal(json.dryRun, true, "the JSON preview marks it a dry-run");
        assert.ok(Array.isArray(json.artifacts) && json.artifacts.length >= 1, "the JSON preview lists the artifacts it would materialize");
        assert.equal(typeof json.recordCount, "number", "the JSON preview reports the record count it would yield");
        assert.ok(!existsSync(importStoreRoot(repo)), "no file is created or modified in the import store");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },

  // ═════════════ 03 source repo — co-located AOF.md, no commit, nothing else ═══
  {
    name: "import-core/03 importing writes the co-located AOF.md into the source milestone folder and makes NO commit (HEAD unchanged)",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeGitFixtureRepo(["00"]);
      try {
        const before = treeStateOf(src);
        const result = runImport(repo, src, ["00"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const after = treeStateOf(src);
        assert.equal(after.head, before.head, "the import makes NO commit — the source HEAD sha is unchanged");
        // The ONLY NEW working-tree change (vs. before) is the co-located AOF.md.
        const beforeLines = new Set(before.porcelain.split(/\r?\n/).filter((l) => l.trim().length > 0));
        const newChanges = after.porcelain.split(/\r?\n/).filter((l) => l.trim().length > 0 && !beforeLines.has(l));
        assert.equal(newChanges.length, 1, `exactly one NEW working-tree change (before: ${JSON.stringify(before.porcelain)}, after: ${JSON.stringify(after.porcelain)})`);
        assert.ok(
          /00_milestone_demo-00\/AOF\.md"?$/.test(newChanges[0]),
          `the sole new change is the co-located AOF.md in the source milestone folder (got: ${newChanges[0]})`
        );
        assert.ok(
          existsSync(path.join(src, "wiki", "work", "00_milestone_demo-00", "AOF.md")),
          "the AOF.md exists IN the source milestone folder (co-located, not a separate store)"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/03 importing adds ONLY the co-located AOF.md to the source — no other file is created, deleted, or modified",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeGitFixtureRepo(["00"]);
      try {
        // Snapshot the source tree (path → mtime+size) before the import.
        const before = await snapshotTree(src);
        const result = runImport(repo, src, ["00"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const after = await snapshotTree(src);
        const aofRel = "wiki/work/00_milestone_demo-00/AOF.md";
        // The ONLY new key is the co-located AOF.md…
        const newKeys = Object.keys(after).filter((k) => !(k in before));
        assert.deepEqual(newKeys, [aofRel], `the only file added to the source is the co-located AOF.md (added: ${newKeys.join(", ")})`);
        // …and every PRE-EXISTING source file is byte-for-byte unchanged.
        for (const k of Object.keys(before)) {
          assert.equal(after[k], before[k], `pre-existing source file "${k}" is not modified by the import`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },

  // ═══ tolerant folder addressing — GSD `NN-slug` + direct path + no-match ════════
  //
  // A source may name its milestone folders in the GSD `NN-slug` form (e.g.
  // `323-realtime-…`), not aof's `NN_milestone_slug`. The folder NAME is not a
  // contract: import addresses by the number/slug a human already gave the folder,
  // and an explicit selector that matches nothing is an honest error — NEVER a silent
  // fall-through to "the only milestone" (which used to mis-import a GSD repo).
  {
    name: "import-core/00 a GSD-style `NN-slug` milestone folder imports by its number (no `_milestone_` convention)",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeGsdSourceRepo([
        { ref: "323", slug: "realtime-compliance-sidecar-providers", goal: "Close the provider gap on the realtime sidecar." },
      ]);
      try {
        const result = runImport(repo, src, ["323", "--json"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const json = parseJsonStdout(result.stdout);
        assert.equal(json.milestoneRef, "323", "the imported ref is the GSD folder's number, not a fallback");
        // The digest is co-located INTO the GSD source folder, not a separate store.
        const aofPath = json.artifacts.find((p) => /AOF\.md$/.test(p));
        assert.ok(aofPath, "a co-located AOF.md is written");
        assert.ok(/323-realtime-compliance-sidecar-providers[\\/]AOF\.md$/.test(aofPath), "the AOF.md sits in the GSD `NN-slug` source folder");
        assert.ok(!existsSync(importStoreRoot(repo)), "no separate .aof/imports store is created");
        const body = await readFile(path.join(repo, aofPath), "utf8");
        assert.ok(/Close the provider gap/.test(body), "the recovered intent is THIS folder's `## Goal`, not another milestone's");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/00 pointing import DIRECTLY at a milestone folder imports it (point-at-the-folder, basename identity)",
    async run() {
      const { repo } = await makeRepo();
      const src = await makeGsdSourceRepo([
        { ref: "330", slug: "realtime-sidecar-productionisation", goal: "Productionise the realtime sidecar." },
      ]);
      try {
        const folder = path.join(src, "wiki", "work", "330-realtime-sidecar-productionisation");
        const result = runImport(repo, folder, ["--json"]);
        assert.equal(result.status, 0, `exits 0 (stderr: ${result.stderr.slice(0, 200)})`);
        const json = parseJsonStdout(result.stdout);
        assert.equal(json.milestoneRef, "330", "the ref is derived from the folder basename");
        // The AOF.md is co-located in the directly-addressed folder itself.
        const aofPath = json.artifacts.find((p) => /AOF\.md$/.test(p));
        assert.ok(/330-realtime-sidecar-productionisation[\\/]AOF\.md$/.test(aofPath), "the AOF.md is co-located in the directly-addressed folder");
        assert.ok(existsSync(path.join(folder, "AOF.md")), "the AOF.md exists in the source folder");
        const body = await readFile(path.join(folder, "AOF.md"), "utf8");
        assert.ok(/Productionise the realtime sidecar/.test(body), "the directly-addressed folder's intent is recovered");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-core/00 an explicit selector that matches no milestone is an honest error, not a silent mis-import",
    async run() {
      const { repo } = await makeRepo();
      // A source with exactly one (aof-form) milestone — the old fallback would have
      // mis-resolved ANY selector to it. The hardened resolver must refuse.
      const src = await makeSourceRepo(["333"]);
      try {
        const result = runImport(repo, src, ["323", "--json"]);
        assert.notEqual(result.status, 0, "a non-matching explicit selector exits non-zero");
        const json = parseJsonStdout(result.stdout);
        assert.equal(json.ok, false, "the --json envelope reports failure");
        assert.ok(/323/.test(json.error) && /333/.test(json.error), "the error names the unmatched selector and the available ref(s)");
        assert.ok(!existsSync(importStoreRoot(repo)), "nothing is materialized for a no-match selector");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
];

// A GSD-style SOURCE fixture repo: milestone folders named `NN-slug` (NOT aof's
// `NN_milestone_slug`), each with a SPEC.md headed `## Goal` (the GSD convention the
// recovery synonym-matches). `milestones` is an array of { ref, slug, goal }.
async function makeGsdSourceRepo(milestones) {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-import-gsd-src-"));
  const workDir = path.join(src, "wiki", "work");
  for (const m of milestones) {
    const dir = path.join(workDir, `${m.ref}-${m.slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SPEC.md"),
      `# ${m.ref} · ${m.slug} — Spec\n\n## Goal\n\n${m.goal}\n\n## Scope\n\nIn scope: ${m.slug}.\n`,
      "utf8"
    );
    await writeFile(path.join(dir, "STATE.md"), `# ${m.ref} State\n\n**Status:** Done\n`, "utf8");
  }
  return src;
}

// Snapshot every file under a dir (excluding .git) as path → "size:mtimeMs", for a
// byte-level created/deleted/modified comparison (the tree-enumeration fallback QA
// documented; combined with treeStateOf's git check above).
async function snapshotTree(root) {
  const { readdir } = await import("node:fs/promises");
  const out = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const s = await stat(full);
        out[path.relative(root, full).split(path.sep).join("/")] = `${s.size}:${s.mtimeMs}`;
      }
    }
  }
  await walk(root);
  return out;
}

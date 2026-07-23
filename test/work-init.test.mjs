// Traceability wiring for milestone 01 / story 01 `work-init`.
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's four task features is covered here, exercised against the REAL init
// implementation (`initWork` in ../src/work-init.mjs) which is itself a thin
// orchestrator over the locked engine (no drift logic authored in tests):
//
//   00_render-bundle-into-repo.feature — renders supported members; --dry-run
//        writes nothing; a directory arg targets that directory, not cwd
//   01_stamp-and-manifest.feature      — frontmatter/comment stamps + lock-v2
//        install manifest as the `work` SECTION of the unified .aof/aof.lock.json
//        (never a separate .aof/aof.work.lock.json) — ADR-009
//   02_runtime-selection.feature       — --runtime selects; codex commands are
//        reported not-installable per the capability matrix
//   03_init-guard-and-force.feature    — first-install guard + --force re-render
//
// Story 02 / task 01 (ADR-009, unified lock) @executable scenarios are folded in
// here too: the work manifest is the `work` section of aof.lock.json, no separate
// aof.work.lock.json is written, and writing the `work` section preserves the
// foreign asset/`planning` sections.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initWork, workLockPath } from "../src/work-init.mjs";
import { loadBundle } from "../src/work-bundle.mjs";

// ADR-009: the install manifest is the `work` SECTION of the unified lock. Read the
// section the same way every reader does (the top-level lock JSON's `.work` key).
async function readWorkSection(repo) {
  const lock = JSON.parse(await readFile(workLockPath(repo), "utf8"));
  return lock.work;
}

async function lockFileNames(repo) {
  return (await readdir(path.join(repo, ".aof"))).filter((name) => name.endsWith(".lock.json"));
}

// A pre-existing unified lock carrying foreign sections (asset fields + a
// `planning` section) that `work init`/`update` must preserve byte-intact.
function seededForeignLock() {
  return {
    version: 2,
    generatedAt: "2026-06-19T00:00:00.000Z",
    runtimes: ["claude"],
    files: [
      {
        path: ".claude/agents/own-resource.md",
        runtime: "claude",
        resource: { id: "own-resource", kind: "agent" },
        hash: "sha256:" + "c".repeat(64),
        generatedAt: "2026-06-19T00:00:00.000Z"
      }
    ],
    packages: [],
    frameworks: [],
    frameworkInstallAttempts: [],
    planning: {
      generatedAt: "2026-06-19T00:00:00.000Z",
      source: "phuryn/pm-skills",
      marketplaceName: "pm-skills",
      marketplaceVersion: "2.0.0",
      sha: "d384f0c9eb81fe74656a4f6da168587836939edb",
      runtime: "claude",
      plugins: [{ name: "pm-execution", marketplace: "pm-skills" }],
      codex: null
    }
  };
}

async function tempRepo(prefix = "aof-init-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function p(dir, ...rel) {
  return path.join(dir, ...rel);
}

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

const FRONTMATTER_STAMP = "aof-generated: true";
const TEMPLATE_MARKER = "<!-- aof-generated: bundle -->";

export const workInitTests = [
  // ====================================================================
  // 00_render-bundle-into-repo.feature
  // ====================================================================

  {
    name: "work-init/render: init renders the bundle members onto disk under the runtime root (exit 0)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
        assert.equal(result.guarded, false, "not guarded on a clean repo");
        // aof-* agent files exist under the runtime root.
        const bundle = loadBundle();
        for (const agent of bundle.resources.filter((r) => r.kind === "agent")) {
          assert.ok(existsSync(p(repo, ".claude", "agents", `${agent.id}.md`)), `agent ${agent.id} exists`);
        }
        // command members under the commands/aof/ namespace directory.
        for (const command of bundle.resources.filter((r) => r.kind === "command")) {
          assert.ok(existsSync(p(repo, ".claude", "commands", "aof", `${command.id}.md`)), `command ${command.id} under commands/aof/`);
        }
        // milestone template files exist under the fixed bundle template location.
        assert.ok(existsSync(p(repo, ".aof", "templates", "work", "milestone")), "milestone templates dir exists");
        const milestoneFiles = await readdir(p(repo, ".aof", "templates", "work", "milestone"));
        assert.ok(milestoneFiles.length > 0, "milestone template files exist");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },

  // F-02 (milestone 04 round-trip finding → 01): init establishes a self-contained
  // nested `.aof/.gitignore` baseline (ignoring the derived memory index), never the
  // repo-root .gitignore; idempotent + additive across a re-init.
  {
    name: "work-init/gitignore: a cold init writes a nested .aof/.gitignore ignoring the derived memory index, never the repo root",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const nested = p(repo, ".aof", ".gitignore");
        assert.ok(existsSync(nested), ".aof/.gitignore exists after init");
        assert.ok(!existsSync(p(repo, ".gitignore")), "the repo-root .gitignore is NOT created/touched");
        const lines = (await readFile(nested, "utf8")).split(/\r?\n/).map((l) => l.trim());
        assert.ok(lines.includes("aof.memory.index.json"), ".aof/.gitignore ignores the derived memory index");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/gitignore: --dry-run writes no .aof/.gitignore",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"], dryRun: true });
        assert.ok(!existsSync(p(repo, ".aof", ".gitignore")), "dry-run writes no .aof/.gitignore");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/gitignore: init is additive + idempotent — it preserves existing .aof/.gitignore lines and never duplicates the entry",
    run: async () => {
      const repo = await tempRepo();
      try {
        // Seed a pre-existing nested .aof/.gitignore (e.g. an assistant-workspace `/work/`).
        await mkdir(p(repo, ".aof"), { recursive: true });
        await writeFile(p(repo, ".aof", ".gitignore"), "/work/\n", "utf8");
        await initWork({ targetDir: repo, runtimes: ["claude"], force: true });
        const content = await readFile(p(repo, ".aof", ".gitignore"), "utf8");
        const lines = content.split(/\r?\n/).map((l) => l.trim());
        assert.ok(lines.includes("/work/"), "the pre-existing line is preserved");
        assert.ok(lines.includes("aof.memory.index.json"), "the index entry was added");
        assert.equal(lines.filter((l) => l === "aof.memory.index.json").length, 1, "no duplicate index entry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/render: a named agent member lands at .claude/agents/aof-architect.md",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        assert.ok(existsSync(p(repo, ".claude", "agents", "aof-architect.md")), "aof-architect.md exists");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/render: command members are namespaced under aof and invoked with the aof: prefix",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const refinePath = p(repo, ".claude", "commands", "aof", "refine.md");
        assert.ok(existsSync(refinePath), "commands/aof/refine.md exists");
        const content = await readFile(refinePath, "utf8");
        const match = /^aof-invocation:\s*(.+)$/m.exec(content);
        assert.ok(match, "frontmatter carries aof-invocation");
        assert.equal(match[1].trim(), "/aof:refine", "aof-invocation equals /aof:refine");
        // No flat command file at commands/refine.md.
        assert.ok(!existsSync(p(repo, ".claude", "commands", "refine.md")), "no flat commands/refine.md");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/render: --dry-run reports the planned writes but writes nothing (exit 0)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude"], dryRun: true });
        assert.equal(result.guarded, false, "dry-run is not guarded on a clean repo");
        assert.ok(result.actions.length > 0, "reports the files it would write");
        assert.equal(result.manifestWritten, false, "manifest not written on dry-run");
        // The runtime root contains no files; the work lock does not exist.
        assert.ok(!existsSync(p(repo, ".claude")), "no runtime root written");
        assert.ok(!existsSync(workLockPath(repo)), ".aof/aof.lock.json does not exist");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/render: init targets the given directory, not the CLI's own cwd",
    run: async () => {
      // The CLI cwd is an unrelated temp dir; the target is a distinct "consumer".
      const cliCwd = await tempRepo("aof-init-cwd-");
      const consumer = p(cliCwd, "consumer");
      await mkdir(consumer, { recursive: true });
      const originalCwd = process.cwd();
      try {
        process.chdir(cliCwd);
        await initWork({ targetDir: consumer, runtimes: ["claude"] });
        // Rendered files appear under consumer and its runtime root.
        assert.ok(existsSync(p(consumer, ".claude", "agents", "aof-architect.md")), "files appear under consumer");
        assert.ok(existsSync(workLockPath(consumer)), "manifest under consumer");
        // No ACD files under the CLI's own cwd (only the consumer/ subtree).
        const cwdFiles = (await listFilesRecursive(cliCwd))
          .filter((f) => !f.startsWith(consumer));
        assert.equal(cwdFiles.length, 0, `no ACD files outside consumer/: ${cwdFiles.join(", ")}`);
      } finally {
        process.chdir(originalCwd);
        await rm(cliCwd, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: a bundle member of a given kind lands at its conventional location.
  {
    name: "work-init/render: outline — member kinds land at conventional locations (agent, command, template)",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const rows = [
          { kind: "agent", id: "aof-architect", location: p(repo, ".claude", "agents", "aof-architect.md") },
          { kind: "command", id: "refine", location: p(repo, ".claude", "commands", "aof", "refine.md") }
        ];
        for (const row of rows) {
          assert.ok(existsSync(row.location), `${row.kind} ${row.id} at ${row.location}`);
        }
        // template member → the fixed bundle template location.
        assert.ok(existsSync(p(repo, ".aof", "templates", "work", "milestone")), "template at fixed bundle template location");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },

  // ====================================================================
  // 01_stamp-and-manifest.feature
  // ====================================================================

  {
    name: "work-init/stamp: every rendered resource file carries the frontmatter stamp",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const architect = await readFile(p(repo, ".claude", "agents", "aof-architect.md"), "utf8");
        assert.ok(architect.includes(FRONTMATTER_STAMP), "aof-architect.md frontmatter stamped");
        // Every written agent AND command file carries the frontmatter stamp.
        const bundle = loadBundle();
        for (const agent of bundle.resources.filter((r) => r.kind === "agent")) {
          const content = await readFile(p(repo, ".claude", "agents", `${agent.id}.md`), "utf8");
          assert.ok(content.includes(FRONTMATTER_STAMP), `agent ${agent.id} stamped`);
        }
        for (const command of bundle.resources.filter((r) => r.kind === "command")) {
          const content = await readFile(p(repo, ".claude", "commands", "aof", `${command.id}.md`), "utf8");
          assert.ok(content.includes(FRONTMATTER_STAMP), `command ${command.id} stamped`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/stamp: every rendered template file begins with the comment-form marker",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const templateRoot = p(repo, ".aof", "templates", "work");
        const files = (await listFilesRecursive(templateRoot));
        assert.ok(files.length > 0, "template files written");
        for (const file of files) {
          const content = await readFile(file, "utf8");
          assert.ok(content.startsWith(TEMPLATE_MARKER), `${file} begins with ${TEMPLATE_MARKER}`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/manifest: the install manifest is a lock-v2 `work` section of the unified lock",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const lockPath = workLockPath(repo);
        assert.ok(existsSync(lockPath), ".aof/aof.lock.json exists");
        assert.equal(path.basename(lockPath), "aof.lock.json", "the unified lock path");
        const work = await readWorkSection(repo);
        assert.ok(work && typeof work === "object", "the `work` section is present");
        assert.ok(work.bundle && typeof work.bundle.version === "string" && work.bundle.version.length > 0, "work.bundle.version recorded");
        assert.deepEqual(work.runtimes, ["claude"], "work.runtimes lists the rendered runtimes");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/manifest: one content-addressed entry per written file (path fwd-slash, sha256 hash, resource id+kind)",
    run: async () => {
      const repo = await tempRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
        const work = await readWorkSection(repo);
        // One entry for each file init wrote (created/updated actions).
        const writtenCount = result.actions.filter((a) => a.action === "create" || a.action === "update").length;
        assert.equal(work.files.length, writtenCount, "one manifest entry per written file");
        for (const entry of work.files) {
          assert.ok(!entry.path.includes("\\"), `${entry.path} uses forward slashes`);
          assert.ok(entry.hash.startsWith("sha256:"), `${entry.path} hash begins with sha256:`);
          assert.ok(entry.resource && typeof entry.resource.id === "string", `${entry.path} resource has id`);
          assert.ok(typeof entry.resource.kind === "string", `${entry.path} resource has kind`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // ====================================================================
  // Story 02 / task 01 — 01_work-manifest-section.feature (@executable)
  // ====================================================================
  {
    // @executable: the work bundle manifest is written to the `work` section of
    // .aof/aof.lock.json and no separate aof.work.lock.json is written.
    name: "work-init/manifest: the work manifest is the `work` section of aof.lock.json — no separate aof.work.lock.json",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        // Exactly one lock file under .aof/ — the unified lock.
        assert.deepEqual(await lockFileNames(repo), ["aof.lock.json"], "only the unified aof.lock.json exists");
        assert.ok(!existsSync(p(repo, ".aof", "aof.work.lock.json")), "no separate aof.work.lock.json is written");
        const work = await readWorkSection(repo);
        assert.ok(work && Array.isArray(work.files) && work.files.length > 0, "the manifest is recorded under the `work` section");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // @executable (task 01): writing the `work` section preserves the other lock
    // sections — here a pre-existing asset + `planning` set survives byte-intact and
    // only the `work` key is added.
    name: "work-init/manifest: writing the `work` section preserves the asset fields and the `planning` section",
    run: async () => {
      const repo = await tempRepo();
      try {
        await mkdir(p(repo, ".aof"), { recursive: true });
        const seeded = seededForeignLock();
        await writeFile(workLockPath(repo), `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        await initWork({ targetDir: repo, runtimes: ["claude"] });

        assert.deepEqual(await lockFileNames(repo), ["aof.lock.json"], "still only the unified aof.lock.json");
        const lock = JSON.parse(await readFile(workLockPath(repo), "utf8"));
        // The `work` section was added.
        assert.ok(lock.work && Array.isArray(lock.work.files) && lock.work.files.length > 0, "the `work` section is added");
        // The foreign sections survive byte-intact.
        assert.deepEqual(lock.files, seeded.files, "asset files[] preserved unchanged");
        assert.deepEqual(lock.packages, seeded.packages, "asset packages preserved");
        assert.deepEqual(lock.frameworks, seeded.frameworks, "asset frameworks preserved");
        assert.deepEqual(lock.planning, seeded.planning, "the `planning` section preserved unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: a written file of a given class carries its stamp form.
  {
    name: "work-init/stamp: outline — stamp form by file class (agent/command frontmatter; template comment marker)",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        // agent → frontmatter key
        const agent = await readFile(p(repo, ".claude", "agents", "aof-architect.md"), "utf8");
        assert.ok(agent.includes(FRONTMATTER_STAMP), "agent stamp form = frontmatter key");
        // command → frontmatter key
        const command = await readFile(p(repo, ".claude", "commands", "aof", "refine.md"), "utf8");
        assert.ok(command.includes(FRONTMATTER_STAMP), "command stamp form = frontmatter key");
        // template → comment marker
        const templateFiles = await listFilesRecursive(p(repo, ".aof", "templates", "work"));
        const template = await readFile(templateFiles[0], "utf8");
        assert.ok(template.startsWith(TEMPLATE_MARKER), "template stamp form = comment marker");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },

  // ====================================================================
  // 02_runtime-selection.feature
  // ====================================================================

  {
    name: "work-init/runtime: with no --runtime, init renders for claude",
    run: async () => {
      const repo = await tempRepo();
      try {
        const result = await initWork({ targetDir: repo });
        assert.equal(result.guarded, false, "exit 0");
        assert.ok(existsSync(p(repo, ".claude", "agents", "aof-architect.md")), "files under .claude");
        const work = await readWorkSection(repo);
        assert.ok(work.runtimes.includes("claude"), "work.runtimes lists claude");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/runtime: --runtime codex renders agents and maps ACD commands to skills",
    run: async () => {
      const repo = await tempRepo();
      try {
        const result = await initWork({ targetDir: repo, runtimes: ["codex"] });
        // agent members appear under .codex
        assert.ok(existsSync(p(repo, ".codex", "agents", "aof-architect.md")), "codex agent rendered");
        const codexArchitect = await readFile(p(repo, ".codex", "agents", "aof-architect.md"), "utf8");
        assert.match(codexArchitect, /^name: aof-architect$/m, "codex agent keeps codex-readable name metadata");
        assert.match(codexArchitect, /^description: /m, "codex agent keeps codex-readable description metadata");
        assert.doesNotMatch(codexArchitect, /^model:/m, "codex agent frontmatter omits Claude model aliases");
        assert.doesNotMatch(codexArchitect, /^tools:/m, "codex agent frontmatter omits Claude tool allow-lists");
        assert.doesNotMatch(codexArchitect, /^aof-generated:/m, "codex agent frontmatter omits AOF-only metadata");
        assert.doesNotMatch(codexArchitect, /^aof-runtime:/m, "codex agent frontmatter omits AOF-only metadata");
        assert.match(codexArchitect, /<!-- aof-generated: true; aof-runtime: codex -->/, "codex agent carries AOF metadata as a markdown comment");
        assert.deepEqual(result.notInstallable, [], "codex ACD command procedures are installable via mapped skills");
        const refineSkill = p(repo, ".codex", "skills", "aof-refine", "SKILL.md");
        assert.ok(existsSync(refineSkill), "refine command procedure rendered as a codex skill");
        const content = await readFile(refineSkill, "utf8");
        assert.match(content, /^name: aof-refine$/m, "codex skill has a stable skill name");
        assert.match(content, /Use this skill when the user asks for `\$aof-refine <item ref - NN or slug> \[--autonomous\] \[--solo\]`/);
        assert.match(content, /Where this procedure mentions `\$ARGUMENTS`, use the text the user supplied after the skill name\./);
        assert.match(content, /Where it mentions Claude slash command `\/aof:refine`/);
        // no command file written under .codex (any namespace)
        const hooks = JSON.parse(await readFile(p(repo, ".codex", "hooks.json"), "utf8"));
        assert.equal(
          hooks.hooks.SessionStart[0].hooks[0].command,
          "aof session start --assistant codex",
          "Codex starts AOF session presence"
        );
        assert.equal(hooks.hooks.SessionStart[0].matcher, "startup|resume|clear", "compaction does not reset presence");
        assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].command, "aof session ping --assistant codex");
        assert.equal(hooks.hooks.Stop[0].hooks[0].command, "aof session ping --assistant codex");
        assert.equal(hooks.hooks.SessionEnd, undefined, "Codex has no native SessionEnd event; TTL ends presence");
        assert.equal(hooks.hooks.Stop[0].hooks[0].type, "command", "native nested handler schema");
        assert.ok(!existsSync(p(repo, ".codex", "commands", "aof", "refine.md")), "no namespaced codex command file");
        assert.ok(!existsSync(p(repo, ".codex", "commands", "refine.md")), "no flat codex command file");
        // not force-written under ANY runtime root
        assert.ok(!existsSync(p(repo, ".claude", "commands")), "no command force-written under .claude either");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/runtime: --runtime claude,codex renders for both runtimes",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude", "codex"] });
        assert.ok(existsSync(p(repo, ".claude", "agents", "aof-architect.md")), "claude root populated");
        assert.ok(existsSync(p(repo, ".codex", "agents", "aof-architect.md")), "codex root populated");
        const work = await readWorkSection(repo);
        assert.ok(work.runtimes.includes("claude") && work.runtimes.includes("codex"), "work.runtimes lists both");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: a member kind on a runtime is rendered or reported unsupported.
  {
    name: "work-init/runtime: outline — (claude,agent)=rendered (claude,command)=rendered (codex,agent)=rendered (codex,command)=mapped-skill",
    run: async () => {
      const rows = [
        { runtime: "claude", kind: "agent", id: "aof-architect", outcome: "rendered" },
        { runtime: "claude", kind: "command", id: "refine", outcome: "rendered" },
        { runtime: "codex", kind: "agent", id: "aof-architect", outcome: "rendered" },
        { runtime: "codex", kind: "command", id: "refine", outcome: "mapped-skill" }
      ];
      for (const row of rows) {
        const repo = await tempRepo();
        try {
          const result = await initWork({ targetDir: repo, runtimes: [row.runtime] });
          const root = row.runtime === "claude" ? ".claude" : ".codex";
          if (row.outcome === "rendered") {
            const where = row.kind === "agent"
              ? p(repo, root, "agents", `${row.id}.md`)
              : p(repo, root, "commands", "aof", `${row.id}.md`);
            assert.ok(existsSync(where), `(${row.runtime},${row.kind}) rendered at ${where}`);
          } else {
            const skill = p(repo, root, "skills", `aof-${row.id}`, "SKILL.md");
            assert.ok(existsSync(skill), `(${row.runtime},${row.kind}) rendered as mapped skill`);
            assert.ok(
              !result.notInstallable.some((n) => n.kind === row.kind && n.runtime === row.runtime),
              `(${row.runtime},${row.kind}) not reported unsupported`
            );
            const flat = p(repo, root, "commands", `${row.id}.md`);
            const nested = p(repo, root, "commands", "aof", `${row.id}.md`);
            assert.ok(!existsSync(flat) && !existsSync(nested), `(${row.runtime},${row.kind}) not written`);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    }
  },

  // ====================================================================
  // 03_init-guard-and-force.feature
  // ====================================================================

  {
    name: "work-init/guard: init succeeds when there is no existing work manifest",
    run: async () => {
      const repo = await tempRepo();
      try {
        assert.ok(!existsSync(workLockPath(repo)), "no manifest before run");
        const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
        assert.equal(result.guarded, false, "exit 0");
        assert.ok(existsSync(workLockPath(repo)), "manifest exists after run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/guard: re-running init refuses when the work manifest already exists (non-zero, points to update, no overwrite)",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        // Mark a rendered file so we can prove it is not overwritten.
        const architectPath = p(repo, ".claude", "agents", "aof-architect.md");
        const before = await readFile(architectPath, "utf8");
        await writeFile(architectPath, `${before}\nUSER EDIT`, "utf8");
        const edited = await readFile(architectPath, "utf8");

        const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
        assert.equal(result.guarded, true, "guarded → CLI maps to non-zero exit");
        assert.ok(/aof work update/.test(result.message), "message points to aof work update");
        // No rendered file overwritten.
        const after = await readFile(architectPath, "utf8");
        assert.equal(after, edited, "rendered file not overwritten");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/guard: re-running init does not touch the existing manifest",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const before = await readFile(workLockPath(repo), "utf8");
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const after = await readFile(workLockPath(repo), "utf8");
        assert.equal(after, before, "manifest unchanged after a refused re-run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "work-init/guard: --force on an initialised repo re-renders from scratch and rewrites the manifest",
    run: async () => {
      const repo = await tempRepo();
      try {
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        // Mutate a rendered file; --force should re-render it back.
        const architectPath = p(repo, ".claude", "agents", "aof-architect.md");
        const original = await readFile(architectPath, "utf8");
        await writeFile(architectPath, "TAMPERED", "utf8");
        const before = await readFile(workLockPath(repo), "utf8");
        await new Promise((resolve) => setTimeout(resolve, 5));

        const result = await initWork({ targetDir: repo, runtimes: ["claude"], force: true });
        assert.equal(result.guarded, false, "exit 0 with --force");
        // Bundle files re-rendered (the tampered file is restored to canonical content).
        const restored = await readFile(architectPath, "utf8");
        assert.equal(restored, original, "bundle file re-rendered from scratch");
        // Manifest rewritten.
        const after = await readFile(workLockPath(repo), "utf8");
        assert.notEqual(after, before, "manifest rewritten");
        assert.equal(result.manifestWritten, true, "manifest written on force");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  // Scenario Outline: the init guard maps the precondition to an outcome.
  {
    name: "work-init/guard: outline — decision table (no manifest → render+write; present → refuse; present+force → re-render+rewrite)",
    run: async () => {
      // Row 1: no work manifest, no flag → render + write manifest.
      {
        const repo = await tempRepo();
        try {
          const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
          assert.equal(result.guarded, false, "row1: not guarded");
          assert.equal(result.manifestWritten, true, "row1: manifest written");
          assert.ok(existsSync(p(repo, ".claude", "agents", "aof-architect.md")), "row1: rendered");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Row 2: work manifest present, no flag → refuse, no writes.
      {
        const repo = await tempRepo();
        try {
          await initWork({ targetDir: repo, runtimes: ["claude"] });
          const lockBefore = await readFile(workLockPath(repo), "utf8");
          const result = await initWork({ targetDir: repo, runtimes: ["claude"] });
          assert.equal(result.guarded, true, "row2: guarded (refuse)");
          assert.equal(result.manifestWritten, false, "row2: no manifest write");
          assert.equal(result.actions.length, 0, "row2: no actions");
          assert.equal(await readFile(workLockPath(repo), "utf8"), lockBefore, "row2: manifest untouched");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Row 3: work manifest present, --force → re-render + rewrite manifest.
      {
        const repo = await tempRepo();
        try {
          await initWork({ targetDir: repo, runtimes: ["claude"] });
          await new Promise((resolve) => setTimeout(resolve, 5));
          const result = await initWork({ targetDir: repo, runtimes: ["claude"], force: true });
          assert.equal(result.guarded, false, "row3: not guarded");
          assert.equal(result.manifestWritten, true, "row3: manifest rewritten");
          assert.ok(existsSync(workLockPath(repo)), "row3: manifest present");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    }
  }
];

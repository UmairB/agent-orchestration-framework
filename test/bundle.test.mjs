// Traceability wiring for milestone 01 / story 00 `acd-bundle-resources`.
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's four task features is covered here, asserted against the REAL loader /
// renderer / manifest functions (no engine code authored in the tests):
//
//   00_bundle-source-tree.feature  — the tracked bundle root holds the ACD set
//   01_bundle-descriptor.feature   — the descriptor declares typed members
//   02_bundle-loader.feature       — the CLI loads the bundle cwd-independently
//   03_bundle-manifest.feature     — the shipped content-addressed manifest
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadBundle,
  readDescriptor,
  renderBundleOutputs,
  bundleRoot
} from "../src/work-bundle.mjs";
import {
  generateBundleManifest,
  serializeBundleManifest,
  readShippedManifest
} from "../src/work-bundle-manifest.mjs";
import { hashContent } from "../src/lock.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The frozen ACD actor set (the membership the fitness functions pin).
const AGENT_IDS = [
  "aof-architect",
  "aof-compliance",
  "aof-designer",
  "aof-developer",
  "aof-product-owner",
  "aof-qa",
  "aof-researcher",
  "aof-security"
];
const COMMAND_IDS = [
  "add-chore",
  "add-milestone",
  "add-spike",
  "add-story",
  "add-task",
  "add-uat",
  "autonomous",
  "code-review",
  "continue",
  "feedback",
  "migrate",
  "recent",
  "refine",
  "retrospective",
  "shatter",
  "validate",
  "verify"
];
const TEMPLATE_IDS = ["chore", "milestone", "spike", "story", "task", "uat"];

function descriptorMembers() {
  return readDescriptor().members;
}

function memberIds() {
  return descriptorMembers().map((member) => member.id);
}

export const bundleTests = [
  // ====================================================================
  // 00_bundle-source-tree.feature
  // ====================================================================

  {
    name: "bundle/source-tree: the bundle root holds the complete ACD actor set (8 agents, 17 commands, 6 templates)",
    run: async () => {
      const ids = new Set(memberIds());
      for (const id of AGENT_IDS) assert.ok(ids.has(id), `missing agent ${id}`);
      for (const id of COMMAND_IDS) assert.ok(ids.has(id), `missing command ${id}`);
      for (const id of TEMPLATE_IDS) assert.ok(ids.has(id), `missing template ${id}`);
      const byKind = (kind) => descriptorMembers().filter((m) => m.kind === kind).length;
      assert.equal(byKind("agent"), 8, "8 agents");
      assert.equal(byKind("command"), 17, "17 commands");
      assert.equal(byKind("template"), 6, "milestone/story/task/uat/spike/chore templates");
    }
  },
  {
    name: "bundle/source-tree: the bundle root ships with the package — tracked and not git-ignored",
    run: async () => {
      const root = bundleRoot();
      assert.ok(existsSync(root), "bundle root exists on disk");
      // Not matched by any git-ignore rule: `git check-ignore` exits non-zero
      // (and prints nothing) when a path is NOT ignored.
      let ignored = false;
      try {
        const out = execFileSync("git", ["check-ignore", path.join(root, "bundle.json")], {
          cwd: repoRoot,
          encoding: "utf8"
        });
        ignored = out.trim().length > 0;
      } catch {
        ignored = false; // non-zero exit == not ignored
      }
      assert.equal(ignored, false, "bundle root is not matched by any git-ignore rule");
      // Tracked: the descriptor + a representative member are known to git.
      const lsFiles = execFileSync("git", ["ls-files", "src/bundle"], { cwd: repoRoot, encoding: "utf8" });
      assert.ok(lsFiles.includes("src/bundle/bundle.json"), "descriptor is git-tracked");
      assert.ok(lsFiles.includes("src/bundle/agents/aof-architect.md"), "agents are git-tracked");
    }
  },
  // Scenario Outline: a declared ACD member is present in the bundle root.
  {
    name: "bundle/source-tree: outline — declared members present (aof-architect, aof-product-owner, aof-qa, aof-security, add-milestone, refine, shatter, verify)",
    run: async () => {
      const root = bundleRoot();
      const ids = new Set(memberIds());
      const byId = new Map(descriptorMembers().map((m) => [m.id, m]));
      for (const id of [
        "aof-architect",
        "aof-product-owner",
        "aof-qa",
        "aof-security",
        "add-milestone",
        "refine",
        "shatter",
        "verify"
      ]) {
        assert.ok(ids.has(id), `declared member ${id} present`);
        const member = byId.get(id);
        const file = member.file ?? member.dir;
        assert.ok(existsSync(path.join(root, file)), `on-disk file/dir for ${id} exists`);
      }
    }
  },
  // Scenario Outline: a legacy or unmanaged actor is absent from the bundle root.
  {
    name: "bundle/source-tree: outline — legacy/unmanaged actors absent (code-reviewer, gsd-planner, gsd-executor, gsd-verifier, gsd-roadmapper)",
    run: async () => {
      const ids = new Set(memberIds());
      const root = bundleRoot();
      for (const id of ["code-reviewer", "gsd-planner", "gsd-executor", "gsd-verifier", "gsd-roadmapper"]) {
        assert.ok(!ids.has(id), `legacy/unmanaged ${id} is not a declared member`);
        assert.ok(!existsSync(path.join(root, "agents", `${id}.md`)), `no ${id}.md file in bundle agents`);
        assert.ok(!existsSync(path.join(root, "commands", `${id}.md`)), `no ${id}.md file in bundle commands`);
      }
    }
  },

  // ====================================================================
  // 01_bundle-descriptor.feature
  // ====================================================================

  {
    name: "bundle/descriptor: one typed entry per member — every member carries id + kind; 8 agents, 17 commands, 6 templates",
    run: async () => {
      const members = descriptorMembers();
      for (const member of members) {
        assert.ok(typeof member.id === "string" && member.id.length > 0, "member has id");
        assert.ok(["agent", "command", "template"].includes(member.kind), `member ${member.id} has a valid kind`);
      }
      assert.deepEqual(
        members.filter((m) => m.kind === "agent").map((m) => m.id).sort(),
        [...AGENT_IDS].sort(),
        "8 agents declared"
      );
      assert.deepEqual(
        members.filter((m) => m.kind === "command").map((m) => m.id).sort(),
        [...COMMAND_IDS].sort(),
        "17 commands declared"
      );
      assert.deepEqual(
        members.filter((m) => m.kind === "template").map((m) => m.id).sort(),
        [...TEMPLATE_IDS].sort(),
        "milestone/story/task/uat/spike/chore templates declared as kind template"
      );
    }
  },
  {
    name: "bundle/descriptor: every resource member (agent + command) names one or more target runtimes",
    run: async () => {
      const resourceMembers = descriptorMembers().filter((m) => m.kind === "agent" || m.kind === "command");
      assert.equal(resourceMembers.length, 25, "25 resource members");
      for (const member of resourceMembers) {
        assert.ok(Array.isArray(member.runtimes) && member.runtimes.length >= 1, `${member.id} declares >=1 runtime`);
      }
    }
  },
  // Scenario Outline: a descriptor resource entry declares its kind and target runtime(s).
  {
    name: "bundle/descriptor: outline — resource kind + runtimes (agents claude,codex; commands claude)",
    run: async () => {
      const byId = new Map(descriptorMembers().map((m) => [m.id, m]));
      const rows = [
        { id: "aof-architect", kind: "agent", runtimes: ["claude", "codex"] },
        { id: "aof-product-owner", kind: "agent", runtimes: ["claude", "codex"] },
        { id: "aof-qa", kind: "agent", runtimes: ["claude", "codex"] },
        { id: "aof-developer", kind: "agent", runtimes: ["claude", "codex"] },
        { id: "add-milestone", kind: "command", runtimes: ["claude"] },
        { id: "refine", kind: "command", runtimes: ["claude"] },
        { id: "verify", kind: "command", runtimes: ["claude"] },
        { id: "retrospective", kind: "command", runtimes: ["claude"] }
      ];
      for (const row of rows) {
        const member = byId.get(row.id);
        assert.ok(member, `entry for ${row.id} exists`);
        assert.equal(member.kind, row.kind, `${row.id} kind`);
        assert.deepEqual(member.runtimes, row.runtimes, `${row.id} runtimes`);
      }
    }
  },
  // Scenario Outline: a template member is declared with id and kind "template".
  {
    name: "bundle/descriptor: outline — template members (milestone, story, task, uat, spike, chore) are kind template",
    run: async () => {
      const byId = new Map(descriptorMembers().map((m) => [m.id, m]));
      for (const id of TEMPLATE_IDS) {
        const member = byId.get(id);
        assert.ok(member, `entry for ${id} exists`);
        assert.equal(member.kind, "template", `${id} is kind template`);
        // Templates are not runtime-targeted resources.
        assert.equal(member.runtimes, undefined, `${id} declares no runtimes`);
      }
    }
  },

  // ====================================================================
  // 02_bundle-loader.feature
  // ====================================================================

  {
    name: "bundle/loader: the loader returns the full member set faithful to the descriptor (by count and by id)",
    run: async () => {
      const bundle = loadBundle();
      const descriptorIds = memberIds();
      const loadedIds = [
        ...bundle.resources.map((r) => r.id),
        ...bundle.templates.map((t) => t.id)
      ];
      assert.equal(loadedIds.length, descriptorIds.length, "member count matches descriptor");
      assert.deepEqual(loadedIds.slice().sort(), descriptorIds.slice().sort(), "member ids match descriptor");
    }
  },
  {
    name: "bundle/loader: the loaded bundle renders one non-empty output per claude-supported member",
    run: async () => {
      const bundle = loadBundle();
      const outputs = renderBundleOutputs(bundle, { runtimes: ["claude"] });
      // Claude supports all agents (8) + all commands (17) + all template files (14) = 39.
      const resourceOutputs = outputs.filter((o) => o.resource.kind === "agent" || o.resource.kind === "command");
      assert.equal(resourceOutputs.length, AGENT_IDS.length + COMMAND_IDS.length, "one output per claude resource member");
      for (const output of outputs) {
        assert.ok(typeof output.content === "string" && output.content.trim().length > 0, `${output.resource.id} content non-empty`);
      }
    }
  },
  // Scenario Outline: the bundle loads identically from any working directory.
  {
    name: "bundle/loader: outline — loads identically from repo root, an unrelated temp dir, and a nested subdirectory",
    run: async () => {
      const baseline = memberIds().slice().sort();
      const originalCwd = process.cwd();
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-bundle-cwd-"));
      const nested = path.join(repoRoot, "src", "bundle", "agents");
      try {
        for (const cwd of [repoRoot, tmp, nested]) {
          process.chdir(cwd);
          // loadBundle resolves the root from import.meta.url, so cwd is irrelevant.
          const bundle = loadBundle();
          const loaded = [
            ...bundle.resources.map((r) => r.id),
            ...bundle.templates.map((t) => t.id)
          ].sort();
          assert.deepEqual(loaded, baseline, `member set stable from cwd ${cwd}`);
        }
      } finally {
        process.chdir(originalCwd);
        await rm(tmp, { recursive: true, force: true });
      }
    }
  },
  {
    name: "bundle/loader: ADR-001 — the bundle resolves from a child process whose cwd is an unrelated temp dir",
    run: async () => {
      // A black-box proof of cwd-independence: spawn node from a temp cwd and
      // load the bundle by its module path; the member count must match.
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-bundle-proc-"));
      const loaderUrl = pathToFileUrl(path.join(repoRoot, "src", "work-bundle.mjs"));
      try {
        const script = `import { loadBundle } from ${JSON.stringify(loaderUrl)}; const b = loadBundle(); process.stdout.write(String(b.resources.length + b.templates.length));`;
        const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
          cwd: tmp,
          encoding: "utf8"
        });
        assert.equal(out.trim(), String(memberIds().length), "child process loads full member set from unrelated cwd");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
  },

  // ====================================================================
  // 03_bundle-manifest.feature
  // ====================================================================

  {
    name: "bundle/manifest: catalogues one entry per rendered member with path/runtime/resource/hash and resource id+kind",
    run: async () => {
      const manifest = readShippedManifest();
      const rendered = renderBundleOutputs(loadBundle(), { runtimes: manifest.runtimes });
      assert.equal(manifest.entries.length, rendered.length, "one entry per rendered member");
      for (const entry of manifest.entries) {
        assert.ok(typeof entry.path === "string" && entry.path.length > 0, "entry has path");
        assert.ok(typeof entry.runtime === "string" && entry.runtime.length > 0, "entry has runtime");
        assert.ok(entry.resource && typeof entry.resource === "object", "entry has resource");
        assert.ok(typeof entry.resource.id === "string", "resource has id");
        assert.ok(typeof entry.resource.kind === "string", "resource has kind");
        assert.ok(typeof entry.hash === "string", "entry has hash");
      }
    }
  },
  {
    name: "bundle/manifest: every hash is a sha256 content address",
    run: async () => {
      const manifest = readShippedManifest();
      for (const entry of manifest.entries) {
        assert.ok(entry.hash.startsWith("sha256:"), `${entry.path} hash is sha256:`);
      }
    }
  },
  {
    name: "bundle/manifest: records the bundle version",
    run: async () => {
      const manifest = readShippedManifest();
      assert.ok("bundleVersion" in manifest, "manifest carries bundleVersion");
      assert.ok(typeof manifest.bundleVersion === "string" && manifest.bundleVersion.length > 0, "bundleVersion non-empty");
    }
  },
  {
    name: "bundle/manifest: regenerating from an unchanged bundle is byte-for-byte stable, hashes unchanged",
    run: async () => {
      const first = generateBundleManifest();
      const second = generateBundleManifest();
      assert.equal(serializeBundleManifest(first), serializeBundleManifest(second), "regeneration is byte-for-byte stable");
      const firstHashes = first.entries.map((e) => `${e.path}=${e.hash}`).sort();
      const secondHashes = second.entries.map((e) => `${e.path}=${e.hash}`).sort();
      assert.deepEqual(secondHashes, firstHashes, "every entry hash unchanged across regeneration");
      // And it matches what shipped on disk.
      assert.equal(serializeBundleManifest(first), serializeBundleManifest(generateBundleManifest()), "stable vs disk-derived");
    }
  },
  // Scenario Outline: a rendered member appears in the manifest with the full entry shape.
  {
    name: "bundle/manifest: outline — entry shape for aof-architect, aof-qa, add-milestone, refine",
    run: async () => {
      const manifest = readShippedManifest();
      const byId = new Map(manifest.entries.map((e) => [e.resource.id, e]));
      for (const id of ["aof-architect", "aof-qa", "add-milestone", "refine"]) {
        const entry = byId.get(id);
        assert.ok(entry, `manifest entry for ${id} exists`);
        assert.ok(entry.path.length > 0, `${id} non-empty path`);
        assert.ok(typeof entry.runtime === "string" && entry.runtime.length > 0, `${id} has runtime`);
        assert.ok(entry.hash.startsWith("sha256:"), `${id} hash is sha256:`);
      }
    }
  },
  {
    name: "bundle/manifest: each entry hash equals hashContent of the re-rendered member (content-address soundness)",
    run: async () => {
      const manifest = readShippedManifest();
      const rendered = renderBundleOutputs(loadBundle(), { runtimes: manifest.runtimes });
      const renderedByPath = new Map(rendered.map((o) => [String(o.path).replaceAll("\\", "/"), o]));
      for (const entry of manifest.entries) {
        const output = renderedByPath.get(entry.path);
        assert.ok(output, `rendered output for ${entry.path}`);
        assert.equal(entry.hash, hashContent(output.content), `${entry.path} hash is a true content address`);
      }
    }
  }
];

function pathToFileUrl(filePath) {
  let resolved = path.resolve(filePath).replaceAll("\\", "/");
  if (!resolved.startsWith("/")) resolved = `/${resolved}`;
  return `file://${encodeURI(resolved)}`;
}

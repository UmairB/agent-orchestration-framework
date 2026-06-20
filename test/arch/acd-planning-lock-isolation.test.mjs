// Fitness function for milestone 02 / ADR-009 (supersedes ADR-003's file-isolation):
// "aof planning init writes ONLY the `planning` section of the unified
//  .aof/aof.lock.json. It never writes a separate aof.planning.lock.json, never
//  clobbers the asset (files/packages/frameworks/frameworkInstallAttempts) or `work`
//  sections, and never writes the runtime's known_marketplaces.json / settings.json."
//
// Reframed 2026-06-19 from FILE-isolation ("touch only aof.planning.lock.json") to
// SECTION-isolation ("write only the `planning` section of aof.lock.json; preserve
// the foreign sections"). RED until the developer migrates `planning init` to
// read-merge-write the unified lock (src/planning-init.mjs writeLock target +
// buildManifest → `planning` section). That red is expected and correct.
//
// Proofs:
//  1. Source — grep the planning-init source: it names the unified `aof.lock.json`
//     literal, NEVER a separate `aof.planning.lock.json` or `aof.work.lock.json`,
//     and never `known_marketplaces` / `settings.json`.
//  2. Behavioural — seed `.aof/aof.lock.json` with asset + `work` sections, run a
//     claude init, then assert: only `aof.lock.json` exists under `.aof/`, the
//     `planning` section carries the frozen ADR-009 schema, and the seeded
//     asset/`work` sections survive byte-intact.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initPlanning } from "../../src/planning-init.mjs";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const planningSourcePath = path.join(srcDir, "planning-init.mjs");
const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";

// Reuse the stripComments idiom from acd-install-manifest-contract: drop block and
// line comments so the grep targets real code, not the documenting prose.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// A representative pre-existing unified lock with the ASSET fields populated and a
// foreign `work` section. The `planning` key is intentionally ABSENT.
function seededUnifiedLock() {
  return {
    version: 2,
    generatedAt: "2026-06-19T00:00:00.000Z",
    runtimes: ["claude"],
    files: [
      {
        path: ".claude/agents/aof-architect.md",
        runtime: "claude",
        resource: { id: "aof-architect", kind: "agent" },
        hash: "sha256:" + "a".repeat(64),
        generatedAt: "2026-06-19T00:00:00.000Z"
      }
    ],
    packages: [],
    frameworks: [],
    frameworkInstallAttempts: [],
    work: {
      generatedAt: "2026-06-19T00:00:00.000Z",
      bundle: { version: "1.0.0" },
      runtimes: ["claude"],
      files: [],
      packages: [],
      frameworks: [],
      frameworkInstallAttempts: []
    }
  };
}

export const archTests = [
  {
    name: "arch/ADR-009: planning-init names the unified aof.lock.json and never a separate per-vertical lock or runtime-state file",
    run: async () => {
      const code = stripComments(await readFile(planningSourcePath, "utf8"));

      // It writes the unified consumer lock — the bare `aof.lock.json` literal.
      assert.ok(/aof\.lock\.json/.test(code), "names the unified aof.lock.json");

      // It must NOT name either eliminated per-vertical lock.
      assert.ok(!/aof\.planning\.lock\.json/.test(code), "never names the eliminated aof.planning.lock.json");
      assert.ok(!/aof\.work\.lock\.json/.test(code), "never names aof.work.lock.json");

      // It never touches the runtime's own plugin state (RESEARCH §2).
      assert.ok(!/known_marketplaces/.test(code), "never touches the runtime's known_marketplaces.json");
      assert.ok(!/settings\.json/.test(code), "never writes the runtime's settings.json");
    }
  },
  {
    name: "arch/ADR-009: after a claude run, only aof.lock.json exists under .aof/, the planning section is written, and the asset/work sections survive intact",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-planning-section-"));
      try {
        // Seed the unified lock with asset + `work` sections (no `planning` yet).
        const aofDir = path.join(repo, ".aof");
        await mkdir(aofDir, { recursive: true });
        const lockPath = path.join(aofDir, "aof.lock.json");
        const seeded = seededUnifiedLock();
        await writeFile(lockPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        const result = await initPlanning({
          targetDir: repo,
          sha: FIXTURE_SHA,
          simulateInstall: true,
          log: () => {}
        });
        assert.equal(result.manifestWritten, true, "planning provenance was written");

        // Exactly one lock file under .aof/ — the unified lock.
        const entries = (await readdir(aofDir)).filter((name) => name.endsWith(".lock.json"));
        assert.deepEqual(entries, ["aof.lock.json"], "only the unified aof.lock.json under .aof/");

        const lock = JSON.parse(await readFile(lockPath, "utf8"));

        // The `planning` section carries the frozen ADR-009 schema.
        assert.ok(lock.planning && typeof lock.planning === "object", "lock.planning section present");
        assert.equal(lock.planning.source, "phuryn/pm-skills", "planning.source");
        assert.equal(lock.planning.marketplaceName, "pm-skills", "planning.marketplaceName");
        assert.equal(lock.planning.marketplaceVersion, "2.0.0", "planning.marketplaceVersion");
        assert.match(lock.planning.sha, /^[0-9a-f]{40}$/, "planning.sha is 40-hex (ADR-002)");
        assert.equal(lock.planning.runtime, "claude", "planning.runtime");
        assert.ok(Array.isArray(lock.planning.plugins) && lock.planning.plugins.length > 0, "planning.plugins[]");
        assert.equal(lock.planning.codex, null, "planning.codex null on claude");
        assert.ok(typeof lock.planning.generatedAt === "string", "planning.generatedAt");

        // The seeded foreign sections survive byte-intact (deep-equal the seed).
        assert.deepEqual(lock.files, seeded.files, "asset files[] preserved unchanged");
        assert.deepEqual(lock.packages, seeded.packages, "asset packages preserved");
        assert.deepEqual(lock.frameworks, seeded.frameworks, "asset frameworks preserved");
        assert.deepEqual(lock.frameworkInstallAttempts, seeded.frameworkInstallAttempts, "asset frameworkInstallAttempts preserved");
        assert.deepEqual(lock.work, seeded.work, "the foreign `work` section preserved unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];

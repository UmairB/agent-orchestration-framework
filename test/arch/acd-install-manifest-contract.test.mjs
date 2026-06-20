// Fitness function for milestone 02 / ADR-009 (supersedes m01-ADR-004's file-isolation):
// "aof work init/update write ONLY the `work` section of the unified
//  .aof/aof.lock.json. They never write a separate aof.work.lock.json, preserve the
//  asset fields and the `planning` section, and the `work` section conforms to the
//  frozen lock-v2 install-manifest schema. The bundle drift-check reads the `work`
//  section's recorded hashes."
//
// Reframed 2026-06-19 from FILE-isolation ("touch only aof.work.lock.json") to
// SECTION-isolation ("write only the `work` section of aof.lock.json; preserve the
// foreign sections"). RED until the developer migrates `work init`/`update` to
// read-merge-write the unified lock (src/work-init.mjs / src/work-update.mjs: read
// the unified lock, replace only `work`, write the merged whole; drift-check keys
// off `previousLock.work`). That red is expected and correct.
//
// Two proofs:
//  1. Source — grep work-init/update: they name the unified `aof.lock.json`,
//     NEVER a separate `aof.work.lock.json`.
//  2. Behavioural — seed `.aof/aof.lock.json` with asset + `planning` sections, run
//     init/update, and assert: only `aof.lock.json` exists under `.aof/`, the `work`
//     section conforms to the frozen lock-v2 manifest schema, and the seeded
//     asset/`planning` sections survive byte-intact.
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initWork } from "../../src/work-init.mjs";
import { updateWork } from "../../src/work-update.mjs";
import { loadBundle } from "../../src/work-bundle.mjs";
import { workspacePaths } from "../../src/workspace.mjs";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const initSourcePath = path.join(srcDir, "work-init.mjs");
const updateSourcePath = path.join(srcDir, "work-update.mjs");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// The unified lock the writer must name and preserve. It writes the `work` section
// of `aof.lock.json` and must NOT name the eliminated `aof.work.lock.json`.
function assertWorkSectionOnly(code, label) {
  assert.ok(/aof\.lock\.json/.test(code), `${label} references the unified aof.lock.json`);
  assert.ok(!/aof\.work\.lock\.json/.test(code), `${label} never names the eliminated aof.work.lock.json`);
}

function newerBundle(bundle) {
  return {
    ...bundle,
    resources: bundle.resources.map((res) => (res.id === "aof-architect" ? { ...res, body: res.body + "\nNEWER\n" } : res))
  };
}

// A pre-existing unified lock with the `planning` section populated. The `work` key
// is intentionally ABSENT (work init has not run yet).
function seededPlanningLock() {
  return {
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

function assertWorkManifestSchema(work) {
  assert.ok(work && typeof work === "object", "lock.work section present");
  assert.ok(work.bundle && typeof work.bundle.version === "string" && work.bundle.version.length > 0, "work.bundle.version present");
  assert.ok(Array.isArray(work.runtimes) && work.runtimes.length > 0, "work.runtimes[]");
  assert.ok(typeof work.generatedAt === "string", "work.generatedAt present");
  assert.ok(Array.isArray(work.files) && work.files.length > 0, "work.files[]");
  for (const entry of work.files) {
    assert.ok(typeof entry.path === "string" && !entry.path.includes("\\"), `${entry.path} repo-relative forward-slash path`);
    assert.ok(typeof entry.runtime === "string", "entry.runtime");
    assert.ok(entry.resource && typeof entry.resource.id === "string" && typeof entry.resource.kind === "string", "entry.resource {id,kind}");
    assert.match(entry.hash, /^sha256:[0-9a-f]{64}$/, `${entry.path} hash is sha256:<hex>`);
    assert.ok(typeof entry.generatedAt === "string", "entry.generatedAt");
  }
  assert.deepEqual(work.packages, [], "work.packages: []");
  assert.deepEqual(work.frameworks, [], "work.frameworks: []");
  assert.deepEqual(work.frameworkInstallAttempts, [], "work.frameworkInstallAttempts: []");
}

export const archTests = [
  {
    name: "arch/ADR-009: work init writes the unified aof.lock.json and never the eliminated aof.work.lock.json",
    run: async () => {
      const code = stripComments(await readFile(initSourcePath, "utf8"));
      assertWorkSectionOnly(code, "init");
    }
  },
  {
    name: "arch/ADR-009: work update writes the unified aof.lock.json and never the eliminated aof.work.lock.json",
    run: async () => {
      const code = stripComments(await readFile(updateSourcePath, "utf8"));
      assertWorkSectionOnly(code, "update");
    }
  },
  {
    name: "arch/ADR-009: work init records a frozen lock-v2 `work` section in the unified lock, preserving a pre-existing `planning` section",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-work-section-"));
      try {
        const lockPath = workspacePaths(repo).lockPath;
        await mkdir(path.dirname(lockPath), { recursive: true });
        const seeded = seededPlanningLock();
        await writeFile(lockPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        await initWork({ targetDir: repo, runtimes: ["claude"] });

        // Exactly one lock under .aof/.
        const entries = (await readdir(path.dirname(lockPath))).filter((name) => name.endsWith(".lock.json"));
        assert.deepEqual(entries, ["aof.lock.json"], "only the unified aof.lock.json under .aof/");

        const lock = JSON.parse(await readFile(lockPath, "utf8"));
        assertWorkManifestSchema(lock.work);
        // The foreign `planning` section survives byte-intact.
        assert.deepEqual(lock.planning, seeded.planning, "the pre-existing `planning` section preserved unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-009: work update rewrites the `work` section and leaves the asset fields and `planning` section intact",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-work-update-section-"));
      try {
        // Init first so there is a `work` section, then layer asset + planning state.
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        const lockPath = workspacePaths(repo).lockPath;
        const afterInit = JSON.parse(await readFile(lockPath, "utf8"));
        const assetFiles = [
          {
            path: ".claude/agents/own-resource.md",
            runtime: "claude",
            resource: { id: "own-resource", kind: "agent" },
            hash: "sha256:" + "b".repeat(64),
            generatedAt: "2026-06-19T00:00:00.000Z"
          }
        ];
        const planning = seededPlanningLock().planning;
        await writeFile(
          lockPath,
          `${JSON.stringify({ ...afterInit, files: assetFiles, planning }, null, 2)}\n`,
          "utf8"
        );

        await updateWork({ targetDir: repo, bundleOverride: newerBundle(loadBundle()), bundleVersionOverride: "9.9.9" });

        const entries = (await readdir(path.dirname(lockPath))).filter((name) => name.endsWith(".lock.json"));
        assert.deepEqual(entries, ["aof.lock.json"], "still only the unified aof.lock.json under .aof/");

        const lock = JSON.parse(await readFile(lockPath, "utf8"));
        assertWorkManifestSchema(lock.work);
        assert.equal(lock.work.bundle.version, "9.9.9", "work.bundle.version records the new release");
        // Asset fields and planning section are carried through unchanged.
        assert.deepEqual(lock.files, assetFiles, "asset files[] preserved unchanged");
        assert.deepEqual(lock.planning, planning, "the `planning` section preserved unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];

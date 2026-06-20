// Fitness function for milestone 02 / ADR-009:
// "A project has exactly ONE .aof/*.lock.json (aof.lock.json). Every writer
//  preserves the sections it does not own: `aof planning init` writes only the
//  `planning` section, `aof work init`/`update` write only the `work` section,
//  `aof assets apply` / `packages` write only the flat asset fields — and none
//  reconstructs the lock from a fixed field set (read-merge-write)."
//
// This is the unifying single-lock / foreign-section-preservation invariant the
// SPEC and STORY call for. A BEHAVIOURAL proof is strongest: run a sequence of
// real writers into one temp repo and assert that, throughout, there is exactly
// one lock file and every section survives intact.
//
// RED until the developer migrates every writer to read-merge-write the unified
// lock (planning init → `planning`; work init/update → `work`; assets apply via
// createLockManifest + writeLock, and mergeFrameworkInstallAttempts, must spread
// the current lock and replace only their own keys). That red is expected.
//
//  Case 1 — sequence: `work init` → `planning init` → asset-apply write into ONE
//    repo; assert readdir(.aof) shows only aof.lock.json AND the `work`, `planning`,
//    and flat asset fields all survive intact end-to-end.
//  Case 2 — focused: the asset-apply write path carries a pre-seeded `planning` +
//    `work` through unchanged (the createLockManifest/writeLock seam is the one that
//    today reconstructs from a fixed field set and would DROP foreign sections).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initWork } from "../../src/work-init.mjs";
import { initPlanning } from "../../src/planning-init.mjs";
import { createRenderPlan, createLockManifest, planApplyActions, executeApplyActions } from "../../src/render-plan.mjs";
import { writeLock, readLock, mergeFrameworkInstallAttempts } from "../../src/lock.mjs";
import { workspacePaths } from "../../src/workspace.mjs";

const FIXTURE_SHA = "d384f0c9eb81fe74656a4f6da168587836939edb";

// Drive the asset-apply lock-write path EXACTLY as `aof assets apply` does
// (src/cli.mjs assetsApplyCommand): build the render plan, plan the actions against
// the current lock, run createLockManifest, then writeLock to the unified lockPath.
// An empty config keeps the asset `files[]` empty but still exercises the flat-field
// asset write — the precise seam that must read-merge-write to preserve foreign
// sections. The developer's fix lands here (createLockManifest preserving / the
// apply writer merging) and turns this green.
async function runAssetApply(repo) {
  const config = { resources: [], workflows: [], packages: [] };
  const runtimes = ["claude"];
  const paths = workspacePaths(repo);
  const desiredOutputs = await createRenderPlan(config, { targetDir: repo, runtimes });
  const previousLock = await readLock(paths.lockPath);
  const actions = await planApplyActions(desiredOutputs, previousLock, { targetDir: repo, force: false });
  await executeApplyActions(actions);
  const manifest = createLockManifest({ actions, desiredOutputs, previousLock, config, runtimes });
  await writeLock(paths.lockPath, manifest);
}

function assertFlatAssetFields(lock) {
  assert.ok(Array.isArray(lock.files), "flat asset files[] present");
  assert.ok(Array.isArray(lock.packages), "flat asset packages present");
  assert.ok(Array.isArray(lock.frameworks), "flat asset frameworks present");
  assert.ok(Array.isArray(lock.frameworkInstallAttempts), "flat asset frameworkInstallAttempts present");
}

async function onlyLockFile(aofDir) {
  return (await readdir(aofDir)).filter((name) => name.endsWith(".lock.json"));
}

export const archTests = [
  {
    name: "arch/ADR-009: work init → planning init → assets apply leave ONE lock holding the work, planning, and asset sections — each intact",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-unified-seq-"));
      try {
        const paths = workspacePaths(repo);
        const aofDir = path.dirname(paths.lockPath);

        // 1. work init writes the `work` section.
        await initWork({ targetDir: repo, runtimes: ["claude"] });
        let entries = await onlyLockFile(aofDir);
        assert.deepEqual(entries, ["aof.lock.json"], "after work init: only aof.lock.json");
        let lock = JSON.parse(await readFile(paths.lockPath, "utf8"));
        assert.ok(lock.work && Array.isArray(lock.work.files) && lock.work.files.length > 0, "work section written");
        const workSnapshot = lock.work;

        // 2. planning init writes the `planning` section, preserving `work`.
        await initPlanning({ targetDir: repo, sha: FIXTURE_SHA, simulateInstall: true, log: () => {} });
        entries = await onlyLockFile(aofDir);
        assert.deepEqual(entries, ["aof.lock.json"], "after planning init: still only aof.lock.json");
        lock = JSON.parse(await readFile(paths.lockPath, "utf8"));
        assert.ok(lock.planning && lock.planning.source === "phuryn/pm-skills", "planning section written");
        assert.match(lock.planning.sha, /^[0-9a-f]{40}$/, "planning.sha 40-hex");
        assert.deepEqual(lock.work, workSnapshot, "planning init preserved the `work` section");
        const planningSnapshot = lock.planning;

        // 3. assets apply rewrites the flat asset fields, preserving `work` + `planning`.
        await runAssetApply(repo);
        entries = await onlyLockFile(aofDir);
        assert.deepEqual(entries, ["aof.lock.json"], "after assets apply: still only aof.lock.json");
        lock = JSON.parse(await readFile(paths.lockPath, "utf8"));
        assertFlatAssetFields(lock);
        assert.deepEqual(lock.work, workSnapshot, "assets apply preserved the `work` section");
        assert.deepEqual(lock.planning, planningSnapshot, "assets apply preserved the `planning` section");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-009: the assets-apply write path carries a pre-seeded `planning` + `work` section through unchanged",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-unified-asset-"));
      try {
        const paths = workspacePaths(repo);
        await mkdir(path.dirname(paths.lockPath), { recursive: true });
        const seeded = {
          version: 2,
          generatedAt: "2026-06-19T00:00:00.000Z",
          runtimes: ["claude"],
          files: [],
          packages: [],
          frameworks: [],
          frameworkInstallAttempts: [],
          planning: {
            generatedAt: "2026-06-19T00:00:00.000Z",
            source: "phuryn/pm-skills",
            marketplaceName: "pm-skills",
            marketplaceVersion: "2.0.0",
            sha: FIXTURE_SHA,
            runtime: "claude",
            plugins: [{ name: "pm-execution", marketplace: "pm-skills" }],
            codex: null
          },
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
        await writeFile(paths.lockPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

        await runAssetApply(repo);

        const entries = await onlyLockFile(path.dirname(paths.lockPath));
        assert.deepEqual(entries, ["aof.lock.json"], "only the unified aof.lock.json");
        const lock = JSON.parse(await readFile(paths.lockPath, "utf8"));
        assertFlatAssetFields(lock);
        assert.deepEqual(lock.planning, seeded.planning, "assets apply did NOT drop the `planning` section");
        assert.deepEqual(lock.work, seeded.work, "assets apply did NOT drop the `work` section");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    // ADR-009 names BOTH lock reconstructors as hazards: createLockManifest (the
    // asset-apply seam, covered by Case 2) AND mergeFrameworkInstallAttempts (the
    // `packages install` / replay / sync seam). This case closes the second one —
    // without it, a future revert of mergeFrameworkInstallAttempts to a fixed-field
    // rebuild would silently drop `planning`/`work` and no fitness function would fail.
    name: "arch/ADR-009: the packages-install write path (mergeFrameworkInstallAttempts) carries `planning` + `work` through unchanged",
    run: async () => {
      const seeded = {
        version: 2,
        generatedAt: "2026-06-19T00:00:00.000Z",
        runtimes: ["claude"],
        files: [],
        packages: [],
        frameworks: [{ id: "gsd", namespace: "gsd", runtimes: ["claude"] }],
        frameworkInstallAttempts: [],
        planning: {
          generatedAt: "2026-06-19T00:00:00.000Z",
          source: "phuryn/pm-skills",
          marketplaceName: "pm-skills",
          marketplaceVersion: "2.0.0",
          sha: FIXTURE_SHA,
          runtime: "claude",
          plugins: [{ name: "pm-execution", marketplace: "pm-skills" }],
          codex: null
        },
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

      // The exact transform `packages install` / replay / sync apply: record new
      // install attempts onto the prior lock. It MUST read-merge-write — spread the
      // current lock and replace only frameworkInstallAttempts — never reconstruct.
      const next = mergeFrameworkInstallAttempts(seeded, [
        { runtime: "claude", status: "success", exitStatus: 0, command: "gsd install" }
      ]);

      assert.deepEqual(next.planning, seeded.planning, "mergeFrameworkInstallAttempts did NOT drop the `planning` section");
      assert.deepEqual(next.work, seeded.work, "mergeFrameworkInstallAttempts did NOT drop the `work` section");
      assert.deepEqual(next.frameworks, seeded.frameworks, "the flat `frameworks` intent survives");
      assert.equal(next.frameworkInstallAttempts.length, 1, "the new install attempt is recorded");
    }
  }
];

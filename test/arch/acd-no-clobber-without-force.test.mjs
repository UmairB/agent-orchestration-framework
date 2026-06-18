// Fitness function for milestone 01 / ADR-004 + ADR-005:
// "init/update never overwrite a user-modified managed file without --force
//  (a hash-divergent managed file classifies as `drift-warning`, not `update`)."
//
// Behavioural proof (not a source grep): install the bundle to a temp dir, mutate
// a managed file so its on-disk content no longer matches the install manifest,
// then re-run the SAME engine path `aof work update` uses with a NEWER bundle that
// also changed that member —
//   - WITHOUT --force → the mutated file classifies as `drift-warning` (preserved);
//   - WITH    --force → it classifies as `update` (overwritten).
// The proof exercises the real `updateWork` orchestrator + a synthesized "newer
// bundle" (a test-only bundleOverride that only chooses WHICH bundle is loaded;
// all classification still flows through planApplyActions).
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LOCK_VERSION, writeLock } from "../../src/lock.mjs";
import { createLockManifest, executeApplyActions, planApplyActions } from "../../src/render-plan.mjs";
import { loadBundle } from "../../src/work-bundle.mjs";
import { synthesizeBundleConfig } from "../../src/work-bundle-synthesis.mjs";
import { updateWork, workLockPath } from "../../src/work-update.mjs";

// Base install reusing the engine path init uses (no hand-rolled drift logic).
async function installBase(repo, bundle, runtimes = ["claude"], version = "1.0.0") {
  const { desiredOutputs } = await synthesizeBundleConfig(bundle, { runtimes, targetDir: repo });
  const actions = await planApplyActions(desiredOutputs, null, { force: false, targetDir: repo });
  await executeApplyActions(actions);
  const base = createLockManifest({ actions, desiredOutputs, previousLock: null, config: { packages: [] }, runtimes });
  await writeLock(workLockPath(repo), {
    version: LOCK_VERSION,
    generatedAt: base.generatedAt,
    bundle: { version },
    runtimes,
    files: base.files.map((entry) => ({ ...entry, path: String(entry.path).replaceAll("\\", "/") })),
    packages: base.packages,
    frameworks: base.frameworks,
    frameworkInstallAttempts: base.frameworkInstallAttempts
  });
}

// A newer bundle whose `aof-architect` body differs from the installed release.
function newerBundle(bundle) {
  return {
    ...bundle,
    resources: bundle.resources.map((res) => (res.id === "aof-architect" ? { ...res, body: res.body + "\nNEWER BUNDLE CONTENT\n" } : res))
  };
}

const ARCHITECT_REL = ".claude/agents/aof-architect.md";

function classOf(result, relPath) {
  const item = result.actions.find((entry) => String(entry.path).replaceAll("\\", "/") === relPath);
  return item ? item.action : undefined;
}

export const archTests = [
  {
    name: "arch/ADR-004+005: a locally-mutated managed file is drift-warning (not update) on a newer-bundle update",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-noclobber-"));
      try {
        const base = loadBundle();
        await installBase(repo, base);
        // Mutate the managed file so it diverges from the install manifest hash.
        const architect = path.join(repo, ".claude", "agents", "aof-architect.md");
        const mutated = `${await readFile(architect, "utf8")}\nUSER MUTATION\n`;
        await writeFile(architect, mutated, "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: newerBundle(base), bundleVersionOverride: "2.0.0" });
        assert.equal(classOf(result, ARCHITECT_REL), "drift-warning", "mutated managed file is drift-warning, not update");
        assert.equal(await readFile(architect, "utf8"), mutated, "the mutated file is preserved (not overwritten)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-004+005: the same mutated file becomes `update` (overwritten) when --force is given",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-noclobber-force-"));
      try {
        const base = loadBundle();
        await installBase(repo, base);
        const architect = path.join(repo, ".claude", "agents", "aof-architect.md");
        await writeFile(architect, `${await readFile(architect, "utf8")}\nUSER MUTATION\n`, "utf8");

        const result = await updateWork({ targetDir: repo, bundleOverride: newerBundle(base), bundleVersionOverride: "2.0.0", force: true });
        assert.equal(classOf(result, ARCHITECT_REL), "update", "with --force the mutated file is update (overwritten)");
        const onDisk = await readFile(architect, "utf8");
        assert.ok(onDisk.includes("NEWER BUNDLE CONTENT"), "on-disk content now matches the newer bundle");
        assert.ok(!onDisk.includes("USER MUTATION"), "the user mutation was overwritten");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];

// Fitness function for milestone 06 / ADR-004:
// "The enable/disable surface writes ONLY the `work.headroom` subtree of
//  .aof/aof.config.json (every other config key survives byte-intact) and NEVER
//  reads or writes .aof/aof.lock.json. `unuse-headroom` keeps the block with
//  enabled:false (it does not delete it)."
//
// RED-until-built and CORRECT: src/work-headroom.mjs does not export the toggle
// entry points yet, so the import below rejects with ERR_MODULE_NOT_FOUND (a
// missing-source red, not a syntax error). The CLI story builds the read-merge-
// write helper against this contract; the test then proves config-only isolation.
//
// Adapted from acd-planning-lock-isolation's seed-foreign-sections-and-prove-
// survival idiom — but the protected artifact here is the SIBLING config keys and
// the lock (the toggle writes config, the lock must be untouched).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// LAZY resolution (NOT a top-level import): src/work-headroom.mjs does not exist
// yet, so each run() dynamically imports it. A missing module is then a CLEAN
// assertion red inside the case — not an ERR_MODULE_NOT_FOUND that crashes the whole
// suite at scripts/test.mjs load time (the established RED-until-built idiom).
const headroomCliUrl = new URL("../../src/work-headroom.mjs", import.meta.url).href;
async function loadToggle() {
  const mod = await import(headroomCliUrl);
  assert.equal(typeof mod.useHeadroom, "function", "src/work-headroom.mjs exports useHeadroom (RED until the CLI story builds it)");
  assert.equal(typeof mod.unuseHeadroom, "function", "src/work-headroom.mjs exports unuseHeadroom (RED until the CLI story builds it)");
  return mod;
}

// A config seeded with foreign root keys AND a foreign sibling work.ui — none of
// which the toggle is allowed to disturb. work.headroom is intentionally ABSENT.
function seededConfig() {
  return {
    name: "demo",
    resources: [],
    settings: { model: "sonnet" },
    work: {
      dir: "./wiki/work",
      ui: { baseUrl: "https://localhost:1234" }
    }
  };
}

// A representative pre-existing unified lock the toggle MUST NOT touch.
function seededLock() {
  return {
    version: 2,
    generatedAt: "2026-06-20T00:00:00.000Z",
    runtimes: ["claude"],
    files: [],
    packages: [],
    frameworks: [],
    frameworkInstallAttempts: [],
    work: { generatedAt: "2026-06-20T00:00:00.000Z", bundle: { version: "1.0.0" }, runtimes: ["claude"], files: [] }
  };
}

async function seedProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-headroom-iso-"));
  const aofDir = path.join(repo, ".aof");
  await mkdir(aofDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  const lockPath = path.join(aofDir, "aof.lock.json");
  await writeFile(configPath, `${JSON.stringify(seededConfig(), null, 2)}\n`, "utf8");
  await writeFile(lockPath, `${JSON.stringify(seededLock(), null, 2)}\n`, "utf8");
  return { repo, aofDir, configPath, lockPath };
}

export const archTests = [
  {
    name: "arch/ADR-004: use-headroom sets work.headroom, preserves every other config key, and leaves the lock byte-intact",
    run: async () => {
      const { repo, configPath, lockPath } = await seedProject();
      const lockBefore = await readFile(lockPath, "utf8");
      try {
        const { useHeadroom } = await loadToggle();
        await useHeadroom({ targetDir: repo, which: () => null, log: () => {} });

        const config = JSON.parse(await readFile(configPath, "utf8"));
        // work.headroom is written and enabled.
        assert.ok(config.work.headroom && config.work.headroom.enabled === true, "work.headroom.enabled === true after use");
        assert.equal(config.work.headroom.mode, "wrap", "default mode is wrap");

        // Every foreign key survives byte-intact.
        assert.equal(config.name, "demo", "root name preserved");
        assert.deepEqual(config.settings, { model: "sonnet" }, "settings preserved");
        assert.equal(config.work.dir, "./wiki/work", "work.dir preserved");
        assert.deepEqual(config.work.ui, { baseUrl: "https://localhost:1234" }, "sibling work.ui preserved byte-intact");

        // The lock is NEVER touched.
        assert.equal(await readFile(lockPath, "utf8"), lockBefore, "aof.lock.json is byte-identical (the toggle never writes the lock)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  },
  {
    name: "arch/ADR-004: unuse-headroom keeps the block with enabled:false (does not delete it) and never touches the lock",
    run: async () => {
      const { repo, configPath, lockPath } = await seedProject();
      try {
        const { useHeadroom, unuseHeadroom } = await loadToggle();
        await useHeadroom({ targetDir: repo, which: () => "/usr/local/bin/headroom", log: () => {} });
        const lockAfterUse = await readFile(lockPath, "utf8");

        await unuseHeadroom({ targetDir: repo, log: () => {} });
        const config = JSON.parse(await readFile(configPath, "utf8"));

        assert.ok(config.work.headroom, "the work.headroom block is kept (not deleted)");
        assert.equal(config.work.headroom.enabled, false, "enabled is flipped to false");
        assert.deepEqual(config.work.ui, { baseUrl: "https://localhost:1234" }, "sibling work.ui still preserved");

        assert.equal(await readFile(lockPath, "utf8"), lockAfterUse, "unuse never touches the lock either");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
  }
];

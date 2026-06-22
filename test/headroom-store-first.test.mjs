// Traceability wiring for milestone 12 / story 03, task 00 —
// tasks/00_headroom-store-first.feature.
//
// Covers every @executable scenario (Scenario-Outline rows folded into one entry)
// against the REAL in-process code: src/headroom.mjs's resolveHeadroomBinary, the
// store-first re-point (milestone-12 ADR-004) that delegates to tool-store.mjs's
// resolveManagedBinary, plus src/work-headroom.mjs's useHeadroom (the config surface
// that is INDEPENDENT of the lookup). One test object per @executable scenario, each
// name tracing to feature + scenario.
//
// HERMETIC by construction (mirrors graphify-store-first.test.mjs):
//   - store-presence rows: mkdtemp a temp home, point env.AOF_GLOBAL_HOME at it,
//     create the headroom version dir's Scripts/bin and write a real binary file,
//     then resolve with that env + platform — no process-global state touched.
//   - PATH rows: mkdtemp a temp dir, write the binary, pass it as pathValue with
//     useLocator:false so the injected PATH is the ONLY source consulted.
//   - the version probe is injected so no live headroom binary is needed.
//   - the config scenario runs useHeadroom in a temp project with an injected
//     `which` and no store, asserting the config is written regardless.
// Expected store paths are DERIVED via the same toolVersionDir/exeDirFor/exeNameFor
// functions the resolver uses — never a hardcoded home — and the version comes from
// HEADROOM_DESCRIPTOR.version so the store key is the one the resolver looks up.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolVersionDir } from "../src/paths.mjs";
import { exeDirFor, exeNameFor, HEADROOM_DESCRIPTOR } from "../src/tool-store.mjs";
import { resolveHeadroomBinary } from "../src/headroom.mjs";
import { useHeadroom } from "../src/work-headroom.mjs";

const HEADROOM_BINARY = "headroom";
const HEADROOM_VERSION = HEADROOM_DESCRIPTOR.version;

// --- helpers -----------------------------------------------------------------

// Provision a real headroom store binary under a temp home so the resolver's
// store-first leg hits a real file at the version dir. Returns
// { env, storeExe, cleanup }.
async function makeStoreBinary(platform) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-store-"));
  const env = { AOF_GLOBAL_HOME: home };
  const versionDir = toolVersionDir(HEADROOM_BINARY, HEADROOM_VERSION, env);
  const exeDir = exeDirFor(versionDir, platform);
  await mkdir(exeDir, { recursive: true });
  const storeExe = path.join(exeDir, exeNameFor(HEADROOM_BINARY, platform));
  await writeFile(storeExe, "#!/bin/sh\n", "utf8");
  return { env, storeExe, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// Provision a real headroom binary in a temp PATH dir (the PATH-fallback leg).
// Returns { pathValue, pathExe, cleanup }.
async function makePathBinary(platform) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-path-"));
  const pathExe = path.join(dir, exeNameFor(HEADROOM_BINARY, platform));
  await writeFile(pathExe, "#!/bin/sh\n", "utf8");
  return { pathValue: dir, pathExe, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// An empty temp home so the store leg is a clean miss (no headroom provisioned).
async function makeEmptyHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-empty-"));
  return { env: { AOF_GLOBAL_HOME: home }, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// The injected version probe — no live headroom binary is needed (the store/PATH
// fixtures are inert files).
const PROBE = () => HEADROOM_VERSION;

// A minimal aof project (config-only) so useHeadroom's read-merge-write runs
// end-to-end without touching process-global state. Returns { repo, configPath }.
async function makeProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-use-"));
  const aofDir = path.join(repo, ".aof");
  await mkdir(aofDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify({ name: "demo", resources: [], work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { repo, configPath, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

export const headroomStoreFirstTests = [
  // ═══════════════ 00_headroom-store-first.feature ════════════════════════════

  {
    // @executable Scenario Outline: headroom's lookup returns the right copy for each
    // presence state — BOTH store+PATH → source "store" (the feature's "managed
    // store" copy wins); ONLY PATH → source "path" (the 06 PATH location, unchanged).
    // Asserted on the host's own platform (the store-first ORDER is platform-
    // independent; the POSIX path shape is exercised by the tool-store geometry test).
    name: "headroom-store-first/00 headroom's lookup returns the right copy for each presence state",
    async run() {
      const platform = process.platform;

      // Row 1 — BOTH in the managed store and on PATH → found true, source "store".
      {
        const store = await makeStoreBinary(platform);
        const pathBin = await makePathBinary(platform);
        try {
          const result = resolveHeadroomBinary({
            env: store.env,
            platform,
            pathValue: pathBin.pathValue,
            useLocator: false,
            probe: PROBE,
          });
          assert.equal(result.found, true, "BOTH present → found true");
          assert.equal(result.source, "store", "BOTH present → the managed store copy wins");
          assert.equal(result.path, store.storeExe, "the resolved path is the store copy");
          assert.notEqual(result.path, pathBin.pathExe, "it did NOT resolve the PATH copy");
          assert.equal(result.binary, HEADROOM_BINARY, "found result carries the binary name");
          assert.equal(result.version, HEADROOM_VERSION, "found result carries the probed version");
        } finally {
          await store.cleanup();
          await pathBin.cleanup();
        }
      }

      // Row 2 — ONLY on PATH (empty store home) → found true, source "path".
      {
        const empty = await makeEmptyHome();
        const pathBin = await makePathBinary(platform);
        try {
          const result = resolveHeadroomBinary({
            env: empty.env,
            platform,
            pathValue: pathBin.pathValue,
            useLocator: false,
            probe: PROBE,
          });
          assert.equal(result.found, true, "ONLY PATH → found true");
          assert.equal(result.source, "path", "a store miss falls back to PATH (06 behaviour)");
          assert.equal(result.path, pathBin.pathExe, "it resolves the PATH location");
        } finally {
          await empty.cleanup();
          await pathBin.cleanup();
        }
      }
    },
  },

  {
    // @executable: useHeadroom still writes the plugin config regardless of the binary
    // lookup — the config read-merge-write precedes and does not depend on where (or
    // whether) the binary resolves. Proven with an injected `which` (absent) AND with
    // an empty store home (the default store-first lookup is a clean miss), asserting
    // work.headroom.enabled === true is written in BOTH cases. ONLY the lookup moved;
    // the config surface (06/ADR-004) is untouched (acd-headroom-config-isolation).
    name: "headroom-store-first/00 useHeadroom still writes the plugin config regardless of the binary lookup",
    async run() {
      // Case A — an explicitly absent `which`: the config is still written, and the
      // returned headroomOnPath reflects the lookup, not the config write.
      {
        const project = await makeProject();
        try {
          const result = await useHeadroom({
            targetDir: project.repo,
            which: () => null,
            log: () => {},
          });
          const config = JSON.parse(await readFile(project.configPath, "utf8"));
          assert.equal(config.work.headroom.enabled, true, "config written enabled even when the binary is absent");
          assert.equal(config.work.headroom.mode, "wrap", "default mode is wrap (config surface unchanged)");
          assert.equal(result.headroomOnPath, false, "an absent binary is reported, but the config was still written");
          assert.equal(config.work.dir, "./wiki/work", "sibling work.dir preserved (config surface unchanged)");
        } finally {
          await project.cleanup();
        }
      }

      // Case B — the DEFAULT store-first lookup against an EMPTY store home + empty
      // PATH (a clean miss). Enabling must NOT depend on where the binary resolves:
      // the config is written identically whether the binary is found or not.
      {
        const project = await makeProject();
        try {
          const result = await useHeadroom({
            targetDir: project.repo,
            // No `which` → the re-pointed default store-first defaultWhich runs; an
            // empty store home + empty PATH make it a clean miss, deterministically.
            env: { AOF_GLOBAL_HOME: project.repo, PATH: "" },
            log: () => {},
          });
          const config = JSON.parse(await readFile(project.configPath, "utf8"));
          assert.equal(config.work.headroom.enabled, true, "config written enabled even on a store+PATH miss");
          assert.equal(result.headroomOnPath, false, "the store-first miss does not block the config write");
          // The config file exists and is the only thing the surface wrote (no lock).
          assert.ok(existsSync(project.configPath), "the config file was written");
          assert.equal(existsSync(path.join(project.repo, ".aof", "aof.lock.json")), false, "the lock is never written by useHeadroom");
        } finally {
          await project.cleanup();
        }
      }
    },
  },
];

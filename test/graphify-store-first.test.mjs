// Traceability wiring for milestone 12 / story 02, task 00 —
// tasks/00_graphify-store-first.feature.
//
// Covers every @executable scenario (Scenario-Outline rows folded into one entry)
// against the REAL in-process code: src/graphify.mjs's resolveGraphifyBinary, now
// RE-POINTED store-first (milestone-12 ADR-004) to delegate to tool-store.mjs's
// resolveManagedBinary. One test object per @executable scenario, each name
// tracing to feature + scenario.
//
// HERMETIC by construction (mirrors tool-store-path-resolution.test.mjs):
//   - store-presence rows: mkdtemp a temp home, point env.AOF_GLOBAL_HOME at it,
//     create the graphify version dir's Scripts/bin and write a real binary file,
//     then resolve with that env + platform — no process-global state touched.
//   - PATH rows: mkdtemp a temp dir, write the binary, pass it as pathValue with
//     useLocator:false so the injected PATH is the ONLY source consulted.
//   - the version probe is injected so no live graphify binary is needed.
// Expected store paths are DERIVED via the same toolStoreRoot/toolVersionDir/
// exeDirFor/exeNameFor functions the resolver uses — never a hardcoded home — and
// the pinned version comes from PINNED_GRAPHIFY_VERSION so the store key is the one
// the re-pointed resolver actually looks up.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toolStoreRoot, toolVersionDir } from "../src/paths.mjs";
import { exeDirFor, exeNameFor } from "../src/tool-store.mjs";
import {
  resolveGraphifyBinary,
  GRAPHIFY_BINARY,
  PINNED_GRAPHIFY_VERSION,
} from "../src/graphify.mjs";

// --- helpers -----------------------------------------------------------------

// Provision a real graphify store binary under a temp home so the resolver's
// store-first leg hits a real file at the pinned version dir. Returns
// { env, storeExe, cleanup }.
async function makeStoreBinary(platform) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-store-"));
  const env = { AOF_GLOBAL_HOME: home };
  const versionDir = toolVersionDir(GRAPHIFY_BINARY, PINNED_GRAPHIFY_VERSION, env);
  const exeDir = exeDirFor(versionDir, platform);
  await mkdir(exeDir, { recursive: true });
  const storeExe = path.join(exeDir, exeNameFor(GRAPHIFY_BINARY, platform));
  await writeFile(storeExe, "#!/bin/sh\n", "utf8");
  return { env, storeExe, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// Provision a real graphify binary in a temp PATH dir (the PATH-fallback leg).
// Returns { pathValue, pathExe, cleanup }.
async function makePathBinary(platform) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-path-"));
  const pathExe = path.join(dir, exeNameFor(GRAPHIFY_BINARY, platform));
  await writeFile(pathExe, "#!/bin/sh\n", "utf8");
  return { pathValue: dir, pathExe, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// An empty temp home so the store leg is a clean miss (no graphify provisioned).
async function makeEmptyHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-empty-"));
  return { env: { AOF_GLOBAL_HOME: home }, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// The injected version probe — no live graphify binary is needed (the store/PATH
// fixtures are inert files).
const PROBE = () => PINNED_GRAPHIFY_VERSION;

export const graphifyStoreFirstTests = [
  // ═══════════════ 00_graphify-store-first.feature ═══════════════════════════

  {
    // @executable Scenario Outline: resolveGraphifyBinary returns the right copy
    // for each presence state — BOTH store+PATH → found, source "store" (the
    // managed store wins); ONLY PATH → found, source "path" (the 09 location,
    // unchanged); NEITHER → found false. Asserted on the host's own platform (the
    // store-first ORDER is platform-independent; the POSIX path shape is exercised
    // by the dedicated tool-store geometry test).
    name: "graphify-store-first/00 resolveGraphifyBinary returns the right copy for each presence state",
    async run() {
      const platform = process.platform;

      // Row 1 — BOTH in the store and on PATH → found true, source "managed store".
      {
        const store = await makeStoreBinary(platform);
        const pathBin = await makePathBinary(platform);
        try {
          const result = resolveGraphifyBinary({
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
          // The frozen found-shape the graph commands depend on (09/ADR-002).
          assert.equal(result.binary, GRAPHIFY_BINARY, "found result carries the binary name");
          assert.equal(result.version, PINNED_GRAPHIFY_VERSION, "found result carries the probed version");
        } finally {
          await store.cleanup();
          await pathBin.cleanup();
        }
      }

      // Row 2 — ONLY on PATH (empty store home) → found true, source "PATH".
      {
        const empty = await makeEmptyHome();
        const pathBin = await makePathBinary(platform);
        try {
          const result = resolveGraphifyBinary({
            env: empty.env,
            platform,
            pathValue: pathBin.pathValue,
            useLocator: false,
            probe: PROBE,
          });
          assert.equal(result.found, true, "ONLY PATH → found true");
          assert.equal(result.source, "path", "a store miss falls back to PATH (09 behaviour)");
          assert.equal(result.path, pathBin.pathExe, "it resolves the PATH location");
        } finally {
          await empty.cleanup();
          await pathBin.cleanup();
        }
      }

      // Row 3 — in NEITHER the store nor PATH → found false.
      {
        const empty = await makeEmptyHome();
        try {
          const result = resolveGraphifyBinary({
            env: empty.env,
            platform,
            pathValue: "",
            useLocator: false,
            probe: PROBE,
          });
          assert.equal(result.found, false, "NEITHER → found false");
        } finally {
          await empty.cleanup();
        }
      }
    },
  },

  {
    // @executable: an absent graphify is the structured miss, now hinting
    // `aof project provision graphify` — the frozen 09 no-throw { found:false, hint }
    // contract is preserved (only the hint changed; ADR-004).
    name: "graphify-store-first/00 an absent graphify is the structured miss, now hinting aof project provision",
    async run() {
      const empty = await makeEmptyHome();
      try {
        let result;
        // Empty injected PATH + locator skipped → both the store and PATH are clean
        // misses, deterministically (no process-global PATH consulted).
        assert.doesNotThrow(() => {
          result = resolveGraphifyBinary({
            pathValue: "",
            useLocator: false,
            env: empty.env,
          });
        }, "resolveGraphifyBinary must never throw on an absent binary");
        assert.equal(result.found, false, "absent → found false (a structured miss, not an ENOENT)");
        assert.equal(typeof result.hint, "string", "the miss carries a hint string");
        assert.ok(
          result.hint.includes("aof project provision graphify"),
          `the hint names \`aof project provision graphify\` — got: ${result.hint}`
        );
        // The miss is purely structured: no path/version leaks into an absent result.
        assert.equal(result.path, undefined, "an absent result carries no binary path");
        assert.equal(result.version, undefined, "an absent result asserts no version");
        // Defensive: the store root the resolver consulted derives from the temp home.
        assert.ok(
          toolStoreRoot(empty.env).startsWith(os.tmpdir()) ||
            toolStoreRoot(empty.env).includes("aof-graphify-empty-"),
          "the store leg derived its root from the injected AOF_GLOBAL_HOME"
        );
      } finally {
        await empty.cleanup();
      }
    },
  },
];

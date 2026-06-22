// Fitness function for milestone 12 / ADR-005 inv. 1 (store-first resolution;
// ADR-001 + ADR-004):
// "A managed tool resolves the store binary
//  (<store>/<name>/<version>/{Scripts|bin}/<binary>[.exe]) AHEAD of a PATH binary;
//  on a store miss it falls back to PATH (the 06/09 behaviour); a TOTAL miss is a
//  structured { found:false, hint }, never an opaque throw. The guarantee extends
//  to the re-pointed resolveGraphifyBinary (09) and resolveHeadroomBinary (06)."
//
// Proven the 09 acd-graph-binary-absent injected-seam idiom way, extended: each
// resolver is driven with BOTH a hermetic store hit (mkdtemp + AOF_GLOBAL_HOME +
// the version dir's Scripts/bin + a real binary file) AND a separate PATH hit
// (a temp dir + binary, passed as pathValue with useLocator:false so the injected
// PATH is the ONLY source). The store path MUST win; on an empty store the PATH
// copy resolves; on a total miss the structured { found:false, hint } is returned
// without throwing. `platform` is passed EXPLICITLY so the POSIX (bin/, no .exe)
// shape is asserted on this win32 host, not just the host shape.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toolStoreRoot, toolVersionDir } from "../../src/paths.mjs";
import { resolveManagedBinary, exeDirFor, exeNameFor } from "../../src/tool-store.mjs";
import {
  resolveGraphifyBinary,
  GRAPHIFY_BINARY,
  PINNED_GRAPHIFY_VERSION,
} from "../../src/graphify.mjs";
import { resolveHeadroomBinary } from "../../src/headroom.mjs";
import { HEADROOM_DESCRIPTOR } from "../../src/tool-store.mjs";

// The injected version probe — the store/PATH fixtures are inert files, so no live
// binary is spawned; the probe returns a deterministic stub version.
const PROBE = () => "1.2.3";

// Provision a real store binary for (name, version, binary) under a temp home so
// the resolver's store-first leg hits a real file at the deterministic version
// dir. Returns { env, storeExe, cleanup }.
async function makeStoreBinary({ name, version, binary, platform }) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-store-order-store-"));
  const env = { AOF_GLOBAL_HOME: home };
  const versionDir = toolVersionDir(name, version, env);
  const exeDir = exeDirFor(versionDir, platform);
  await mkdir(exeDir, { recursive: true });
  const storeExe = path.join(exeDir, exeNameFor(binary, platform));
  await writeFile(storeExe, "#!/bin/sh\n", "utf8");
  return { env, storeExe, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// Provision a real binary in a temp PATH dir (the PATH-fallback leg). Returns
// { pathValue, pathExe, cleanup }.
async function makePathBinary({ binary, platform }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-store-order-path-"));
  const pathExe = path.join(dir, exeNameFor(binary, platform));
  await writeFile(pathExe, "#!/bin/sh\n", "utf8");
  return { pathValue: dir, pathExe, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// An empty temp home so the store leg is a clean miss (nothing provisioned).
async function makeEmptyHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-store-order-empty-"));
  return { env: { AOF_GLOBAL_HOME: home }, cleanup: () => rm(home, { recursive: true, force: true }) };
}

// Run the THREE invariant legs (store-wins, path-fallback, total-miss) against an
// arbitrary resolver, for a given { name, version, binary, platform }. `resolve`
// is the injected-seam resolver (resolveManagedBinary or a re-pointed driver) —
// each accepts the same { name?, version?, binary?, env, platform, pathValue,
// useLocator, probe } shape (the drivers pre-bind name/version/binary, so the
// generic legs pass only env/platform/pathValue/useLocator/probe to them).
async function assertResolutionOrder(resolve, { name, version, binary, platform, label }) {
  // ── Leg 1 — STORE-FIRST: both a store hit AND a PATH hit injected; store wins.
  {
    const store = await makeStoreBinary({ name, version, binary, platform });
    const pathBin = await makePathBinary({ binary, platform });
    try {
      const result = resolve({
        env: store.env,
        platform,
        pathValue: pathBin.pathValue,
        useLocator: false,
        probe: PROBE,
      });
      assert.equal(result.found, true, `${label}: store+PATH → found`);
      assert.equal(result.source, "store", `${label}: the managed store copy WINS over PATH`);
      assert.equal(result.path, store.storeExe, `${label}: the resolved path is the store copy`);
      assert.notEqual(result.path, pathBin.pathExe, `${label}: it did NOT resolve the PATH copy`);
      // The store path is UNDER the store root, never under the PATH dir.
      assert.ok(
        result.path.startsWith(toolStoreRoot(store.env)),
        `${label}: the resolved store path is under toolStoreRoot, not the PATH dir`
      );
      assert.ok(
        !result.path.startsWith(pathBin.pathValue),
        `${label}: the resolved path is NOT under the injected PATH dir`
      );
    } finally {
      await store.cleanup();
      await pathBin.cleanup();
    }
  }

  // ── Leg 2 — PATH-FALLBACK: empty store, PATH has it → source "path".
  {
    const empty = await makeEmptyHome();
    const pathBin = await makePathBinary({ binary, platform });
    try {
      const result = resolve({
        env: empty.env,
        platform,
        pathValue: pathBin.pathValue,
        useLocator: false,
        probe: PROBE,
      });
      assert.equal(result.found, true, `${label}: store miss + PATH hit → found`);
      assert.equal(result.source, "path", `${label}: a store miss falls back to PATH (06/09 behaviour)`);
      assert.equal(result.path, pathBin.pathExe, `${label}: it resolves the PATH location`);
    } finally {
      await empty.cleanup();
      await pathBin.cleanup();
    }
  }

  // ── Leg 3 — TOTAL MISS: empty store, empty PATH → structured { found:false,
  // hint }, no throw, no leaked path/version.
  {
    const empty = await makeEmptyHome();
    try {
      let result;
      assert.doesNotThrow(() => {
        result = resolve({
          env: empty.env,
          platform,
          pathValue: "",
          useLocator: false,
          probe: PROBE,
        });
      }, `${label}: a total miss NEVER throws (no opaque ENOENT)`);
      assert.equal(result.found, false, `${label}: total miss → found:false (a structured miss)`);
      assert.equal(typeof result.hint, "string", `${label}: the miss carries a string install hint`);
      assert.equal(result.path, undefined, `${label}: an absent result carries no resolved path`);
      assert.equal(result.version, undefined, `${label}: an absent result asserts no version`);
    } finally {
      await empty.cleanup();
    }
  }
}

export const archTests = [
  {
    name: "arch/ADR-005 inv.1: resolveManagedBinary resolves the store binary AHEAD of PATH, falls back to PATH on a store miss, and returns a structured no-throw miss (win32 + POSIX)",
    run: async () => {
      // Both platform shapes — the POSIX (bin/, bare name) shape is asserted on
      // this win32 host by passing platform EXPLICITLY (ADR-001's cross-platform
      // exe path), not just the host's win32 shape.
      for (const platform of ["win32", "linux"]) {
        await assertResolutionOrder(
          (opts) => resolveManagedBinary({ name: "demo-tool", version: "1.2.3", binary: "demo-tool", ...opts }),
          { name: "demo-tool", version: "1.2.3", binary: "demo-tool", platform, label: `resolveManagedBinary/${platform}` }
        );
      }
    },
  },
  {
    name: "arch/ADR-005 inv.1: the re-pointed resolveGraphifyBinary (09) resolves store-first, PATH-fallback, structured miss (win32 + POSIX)",
    run: async () => {
      // The driver pre-binds graphify's name/pinned-version/binary; the generic
      // legs pass only the injectable seams. Both platform shapes asserted.
      for (const platform of ["win32", "linux"]) {
        await assertResolutionOrder(
          (opts) => resolveGraphifyBinary(opts),
          {
            name: GRAPHIFY_BINARY,
            version: PINNED_GRAPHIFY_VERSION,
            binary: GRAPHIFY_BINARY,
            platform,
            label: `resolveGraphifyBinary/${platform}`,
          }
        );
      }
    },
  },
  {
    name: "arch/ADR-005 inv.1: the re-pointed resolveHeadroomBinary (06) resolves store-first, PATH-fallback, structured miss (win32 + POSIX)",
    run: async () => {
      // The driver pre-binds headroom's name/pinned-version/binary from the frozen
      // descriptor; the generic legs pass only the injectable seams.
      for (const platform of ["win32", "linux"]) {
        await assertResolutionOrder(
          (opts) => resolveHeadroomBinary(opts),
          {
            name: HEADROOM_DESCRIPTOR.name,
            version: HEADROOM_DESCRIPTOR.version,
            binary: "headroom",
            platform,
            label: `resolveHeadroomBinary/${platform}`,
          }
        );
      }
    },
  },
  {
    name: "arch/ADR-005 inv.1: the POSIX store shape is bin/<binary> (no .exe) and the win32 shape is Scripts/<binary>.exe — the resolved store path matches the platform geometry",
    run: async () => {
      // A focused assertion on the platform-shaped store exe path the resolver
      // returns — proving the cross-platform geometry (ADR-001) is honoured for
      // BOTH the win32 (.exe under Scripts) and POSIX (bare under bin) shapes,
      // exercised explicitly on this win32 host via the platform seam.
      const cases = [
        { platform: "win32", dir: "Scripts", suffix: ".exe" },
        { platform: "linux", dir: "bin", suffix: "" },
        { platform: "darwin", dir: "bin", suffix: "" },
      ];
      for (const { platform, dir, suffix } of cases) {
        const store = await makeStoreBinary({ name: "demo-tool", version: "1.2.3", binary: "demo-tool", platform });
        try {
          const result = resolveManagedBinary({
            name: "demo-tool",
            version: "1.2.3",
            binary: "demo-tool",
            env: store.env,
            platform,
            pathValue: "",
            useLocator: false,
            probe: PROBE,
          });
          assert.equal(result.found, true, `${platform}: the store binary resolves`);
          assert.equal(result.source, "store", `${platform}: from the store`);
          const versionDir = toolVersionDir("demo-tool", "1.2.3", store.env);
          const expected = path.join(versionDir, dir, `demo-tool${suffix}`);
          assert.equal(result.path, expected, `${platform}: store path is ${dir}/demo-tool${suffix}`);
          // The POSIX legs carry NO .exe; the win32 leg DOES.
          if (platform === "win32") {
            assert.ok(result.path.endsWith(".exe"), `${platform}: win32 store exe carries .exe`);
          } else {
            assert.ok(!result.path.endsWith(".exe"), `${platform}: POSIX store exe carries no .exe`);
          }
        } finally {
          await store.cleanup();
        }
      }
    },
  },
];

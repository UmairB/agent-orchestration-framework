// Traceability wiring for milestone 12 / story 00, task 00 —
// tasks/00_store-path-and-resolution.feature.
//
// Covers every @executable scenario (Scenario-Outline rows folded into one entry)
// against the REAL in-process code: src/paths.mjs's toolStoreRoot/toolVersionDir
// (the store geometry, ADR-001) and src/tool-store.mjs's resolveManagedBinary
// (the store-first / PATH-fallback resolver, ADR-001). One test object per
// @executable scenario, each name tracing to feature + scenario.
//
// HERMETIC by construction (mirrors graph-binary-provisioning.test.mjs):
//   - store-presence rows: mkdtemp a temp home, point env.AOF_GLOBAL_HOME at it,
//     create the version dir's Scripts/bin and write a real binary file, then
//     resolve with that env + platform — no process-global state touched.
//   - PATH rows: mkdtemp a temp dir, write the binary, pass it as pathValue with
//     useLocator:false so the injected PATH is the ONLY source consulted.
//   - version-probe rows: inject the `probe` seam (clean / failing / empty).
// Expected paths are DERIVED via the same toolStoreRoot/toolVersionDir/
// defaultGlobalWorkspaceDir functions — never a hardcoded absolute home — so the
// AOF_GLOBAL_HOME-relocation invariant is asserted against the real geometry.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultGlobalWorkspaceDir, toolStoreRoot, toolVersionDir } from "../src/paths.mjs";
import {
  resolveManagedBinary,
  exeDirFor,
  exeNameFor,
  defaultProbe,
  toolSpawnOptions,
  TOOL_PROBE_TIMEOUT_ENV,
  DEFAULT_TOOL_PROBE_TIMEOUT_MS,
} from "../src/tool-store.mjs";

// --- helpers -----------------------------------------------------------------

// A normalized "ends with" check that is path-separator-agnostic: the feature's
// `tail` examples use forward slashes; on win32 the real path uses backslashes.
function endsWithTail(actual, tail) {
  const norm = (p) => p.replace(/\\/g, "/");
  return norm(actual).endsWith(tail);
}

// Provision a real store binary under a temp home so resolveManagedBinary's
// store-first leg hits a real file. Returns { env, storeExe, cleanup }.
async function makeStoreBinary({ name, version, binary, platform }) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-tool-store-"));
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-tool-path-"));
  const pathExe = path.join(dir, exeNameFor(binary, platform));
  await writeFile(pathExe, "#!/bin/sh\n", "utf8");
  return { pathValue: dir, pathExe, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export const toolStorePathResolutionTests = [
  // ═══════════════ 00_store-path-and-resolution.feature ═══════════════════════

  {
    // @executable Scenario Outline: the store root derives from the global home and
    // relocates under AOF_GLOBAL_HOME. Three rows: unset (the default home), a POSIX
    // override, a Windows-style absolute override. Expected values are DERIVED via
    // the same geometry functions (never a hardcoded home), so the relocation is the
    // observable assertion.
    name: "tool-store/00 the store root derives from the global home and relocates under AOF_GLOBAL_HOME",
    run() {
      // The feature's three rows: (unset) the default home, a POSIX override, a
      // Windows-style absolute override. Expected values are DERIVED via the same
      // geometry (never a hardcoded absolute home) — the feature's `root` column is
      // the POSIX-host shape (e.g. `/tmp/aof-home/tools`); on this win32 host
      // defaultGlobalWorkspaceDir runs path.resolve, which carries the drive, so the
      // assertion is "the root is exactly <defaultGlobalWorkspaceDir(env)>/tools" —
      // the relocation is the observable, host-agnostic fact.
      const rows = [
        { env: {} },
        { env: { AOF_GLOBAL_HOME: "/tmp/aof-home" } },
        { env: { AOF_GLOBAL_HOME: "D:\\aof-store" } },
      ];
      // The unset and a set override produce DIFFERENT roots — the relocation moved it.
      const defaultRoot = toolStoreRoot({});
      for (const { env } of rows) {
        const root = toolStoreRoot(env);
        // The root is exactly <defaultGlobalWorkspaceDir(env)>/tools — derived, not
        // hardcoded; AOF_GLOBAL_HOME moving the global home moves the root under it.
        assert.equal(
          root,
          path.join(defaultGlobalWorkspaceDir(env), "tools"),
          `root derives from the global home (env: ${JSON.stringify(env)})`
        );
        if (env.AOF_GLOBAL_HOME !== undefined) {
          assert.notEqual(root, defaultRoot, `a set AOF_GLOBAL_HOME relocates the root (env: ${JSON.stringify(env)})`);
          // The relocated root sits under the override's resolved home.
          assert.ok(
            root.startsWith(defaultGlobalWorkspaceDir(env)),
            `the relocated root is under the override home (env: ${JSON.stringify(env)})`
          );
        }
        // toolVersionDir for graphify 0.8.44 is <root>/graphify/0.8.44.
        assert.equal(
          toolVersionDir("graphify", "0.8.44", env),
          path.join(root, "graphify", "0.8.44"),
          "the version dir is <root>/<name>/<version>"
        );
      }
    },
  },

  {
    // @executable Scenario Outline: the managed binary path is platform-shaped under
    // the version dir — Scripts/<bin>.exe on win32, bin/<bin> on POSIX (darwin shares
    // POSIX). The package→binary asymmetry is exercised via graphify's SECOND binary
    // (graphify-mcp). Asserts the POSIX shapes by passing platform explicitly (not the
    // host platform) so linux/darwin rows pass on this win32 host.
    name: "tool-store/00 the managed binary path is platform-shaped under the version dir",
    run() {
      const rows = [
        { binary: "graphify", platform: "win32", tail: "graphify/0.8.44/Scripts/graphify.exe" },
        { binary: "graphify", platform: "linux", tail: "graphify/0.8.44/bin/graphify" },
        { binary: "graphify", platform: "darwin", tail: "graphify/0.8.44/bin/graphify" },
        { binary: "graphify-mcp", platform: "win32", tail: "graphify/0.8.44/Scripts/graphify-mcp.exe" },
        { binary: "graphify-mcp", platform: "linux", tail: "graphify/0.8.44/bin/graphify-mcp" },
      ];
      for (const { binary, platform, tail } of rows) {
        // Build the exe path through the same geometry the resolver uses.
        const versionDir = toolVersionDir("graphify", "0.8.44", {});
        const exePath = path.join(exeDirFor(versionDir, platform), exeNameFor(binary, platform));
        assert.ok(
          endsWithTail(exePath, tail),
          `binary "${binary}" on "${platform}" ends with "${tail}" — got: ${exePath}`
        );
      }
    },
  },

  {
    // @executable: resolveManagedBinary prefers the store copy over a PATH copy —
    // both a store hit AND a PATH hit are available, the store copy is the one
    // resolved (the store-first ORDER, ADR-001's crux). Asserted on the win32 host's
    // own platform (the store-first order is platform-independent).
    name: "tool-store/00 resolveManagedBinary prefers the store copy over a PATH copy",
    async run() {
      const platform = process.platform;
      const store = await makeStoreBinary({ name: "graphify", version: "0.8.44", binary: "graphify", platform });
      const pathBin = await makePathBinary({ binary: "graphify", platform });
      try {
        const result = resolveManagedBinary({
          name: "graphify",
          version: "0.8.44",
          binary: "graphify",
          env: store.env,
          platform,
          pathValue: pathBin.pathValue,
          useLocator: false,
          probe: () => "0.8.44",
        });
        assert.equal(result.found, true, "found a binary when both copies exist");
        assert.equal(result.source, "store", "the store copy wins over the PATH copy");
        assert.equal(result.path, store.storeExe, "the resolved path is the store copy");
        // The resolved path is under the tool store, NOT the PATH location.
        assert.ok(
          result.path.startsWith(toolStoreRoot(store.env)),
          `the resolved path is under the tool store — got: ${result.path}`
        );
        assert.notEqual(result.path, pathBin.pathExe, "it did NOT resolve the PATH location");
      } finally {
        await store.cleanup();
        await pathBin.cleanup();
      }
    },
  },

  {
    // @executable: resolveManagedBinary falls back to PATH when the store has no
    // copy — the 06/09 behaviour, preserved. A store MISS (no temp home provisioned)
    // + a PATH hit → source:"path", resolving the PATH location.
    name: "tool-store/00 resolveManagedBinary falls back to PATH when the store has no copy",
    async run() {
      const platform = process.platform;
      const pathBin = await makePathBinary({ binary: "graphify", platform });
      // Point AOF_GLOBAL_HOME at an empty temp home so the store leg is a clean miss.
      const emptyHome = await mkdtemp(path.join(os.tmpdir(), "aof-tool-empty-"));
      try {
        const result = resolveManagedBinary({
          name: "graphify",
          version: "0.8.44",
          binary: "graphify",
          env: { AOF_GLOBAL_HOME: emptyHome },
          platform,
          pathValue: pathBin.pathValue,
          useLocator: false,
          probe: () => "0.8.44",
        });
        assert.equal(result.found, true, "found a binary on PATH when the store is empty");
        assert.equal(result.source, "path", "a store miss falls back to PATH (06/09 behaviour)");
        assert.equal(result.path, pathBin.pathExe, "it resolves the PATH location");
      } finally {
        await pathBin.cleanup();
        await rm(emptyHome, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable: a total miss is a structured result with an install hint, not a
    // throw — absent from both the store and PATH → {found:false, hint} naming
    // `aof project provision graphify`, and it does NOT throw (no opaque ENOENT).
    name: "tool-store/00 a total miss is a structured result with an install hint, not a throw",
    async run() {
      const emptyHome = await mkdtemp(path.join(os.tmpdir(), "aof-tool-miss-"));
      try {
        let result;
        assert.doesNotThrow(() => {
          // Empty injected PATH + locator skipped → the store + PATH are both clean
          // misses, deterministically (no process-global PATH consulted).
          result = resolveManagedBinary({
            name: "graphify",
            version: "0.8.44",
            binary: "graphify",
            env: { AOF_GLOBAL_HOME: emptyHome },
            platform: process.platform,
            pathValue: "",
            useLocator: false,
          });
        }, "resolveManagedBinary must never throw on a total miss");
        assert.equal(result.found, false, "absent → found:false (a structured miss, not an ENOENT)");
        assert.equal(typeof result.hint, "string", "the miss carries a hint string");
        assert.ok(
          result.hint.includes("aof project provision graphify"),
          `the hint names \`aof project provision graphify\` — got: ${result.hint}`
        );
        // The miss is purely structured: no path/version leaks into an absent result.
        assert.equal(result.path, undefined, "an absent result carries no binary path");
        assert.equal(result.version, undefined, "an absent result asserts no version");
      } finally {
        await rm(emptyHome, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable Scenario Outline: a store hit degrades the version cleanly when
    // the probe is unreliable. Three rows: a clean probe (0.8.44), a failing probe
    // (non-zero → null), an empty-output probe (→ null). Every row stays a found
    // store hit and NEVER throws (RESEARCH §A4). Rather than stub the probe seam to
    // a constant (which would assert a tautology), each row drives the REAL
    // defaultProbe through a row-specific FAKE spawn — so defaultProbe's actual
    // branch logic (non-zero exit → null, empty stdout → null, a clean dotted
    // version → that version) is the thing under test, hermetically, no live binary.
    name: "tool-store/00 a store hit degrades the version cleanly when the probe is unreliable",
    async run() {
      const platform = process.platform;
      const store = await makeStoreBinary({ name: "graphify", version: "0.8.44", binary: "graphify", platform });
      try {
        // A fake spawnSync result per row — the shape defaultProbe inspects
        // (`status` + `stdout`). The probe wraps the REAL defaultProbe with it.
        const fakeSpawn = (result) => (exe) => defaultProbe(exe, () => result);
        const rows = [
          // Clean: zero exit + dotted-version stdout → the version is extracted.
          { label: "clean (0.8.44)", probe: fakeSpawn({ status: 0, stdout: "graphify 0.8.44\n" }), expected: "0.8.44" },
          // Failing: a NON-ZERO exit degrades to null (the real status check).
          { label: "failing (non-zero)", probe: fakeSpawn({ status: 1, stdout: "boom: unknown flag --version" }), expected: null },
          // Empty: zero exit but empty stdout degrades to null (the real trim check).
          { label: "empty output", probe: fakeSpawn({ status: 0, stdout: "" }), expected: null },
        ];
        for (const { label, probe, expected } of rows) {
          let result;
          assert.doesNotThrow(() => {
            result = resolveManagedBinary({
              name: "graphify",
              version: "0.8.44",
              binary: "graphify",
              env: store.env,
              platform,
              probe,
            });
          }, `a store hit with a "${label}" probe must never throw`);
          assert.equal(result.found, true, `"${label}" → still a found hit`);
          assert.equal(result.source, "store", `"${label}" → source:"store"`);
          assert.equal(result.version, expected, `"${label}" → version ${JSON.stringify(expected)}`);
        }
      } finally {
        await store.cleanup();
      }
    },
  },
  {
    // Regression for the INTERMITTENT `aof work memory ingest`/`reindex` hang: every
    // resolveManagedBinary call spawns the `where`/`which` locator (even when the tool
    // is ABSENT — running it is HOW absence is determined) and, on a hit, a `--version`
    // probe. An UNBOUNDED spawn there stalls the caller forever under machine contention.
    // toolSpawnOptions is the guard: a positive finite wall-clock timeout (force-kill on
    // overrun) + an IGNORED stdin so neither child can block reading a prompt.
    name: "tool-store/00 the locator + version-probe spawns are BOUNDED (finite timeout + ignored stdin)",
    run() {
      const opts = toolSpawnOptions();
      assert.equal(opts.encoding, "utf8", "the spawn still captures stdout as utf8 (probe/locator parse it)");
      assert.ok(
        Number.isFinite(opts.timeout) && opts.timeout > 0,
        "a positive, finite timeout is always set (never unbounded)"
      );
      assert.equal(opts.timeout, DEFAULT_TOOL_PROBE_TIMEOUT_MS, "the default is the pinned short probe budget");
      assert.ok(opts.killSignal, "a kill signal is set so a stalled locator/probe is force-killed on overrun");
      assert.equal(
        Array.isArray(opts.stdio) && opts.stdio[0],
        "ignore",
        "the child's stdin is ignored (a prompt gets EOF, never a hang)"
      );

      // AOF_TOOL_PROBE_TIMEOUT_MS overrides the budget — injected via the env seam so the
      // global process env is never mutated; garbage/non-positive falls back to the default.
      assert.equal(
        toolSpawnOptions({ [TOOL_PROBE_TIMEOUT_ENV]: "3000" }).timeout,
        3000,
        "AOF_TOOL_PROBE_TIMEOUT_MS overrides the default timeout"
      );
      assert.equal(
        toolSpawnOptions({ [TOOL_PROBE_TIMEOUT_ENV]: "0" }).timeout,
        DEFAULT_TOOL_PROBE_TIMEOUT_MS,
        "a non-positive override falls back to the default (never unbounded)"
      );
    },
  },
];

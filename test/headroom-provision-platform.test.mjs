// Traceability wiring for milestone 12 / story 03, task 01 —
// tasks/01_provision-and-platform.feature.
//
// Covers the @executable scenarios ONLY (the @manual live `headroom-ai[all]` uv
// install + the live `headroom --version` from the store are DEFERRED to aof:verify):
//   - "the headroom descriptor plans headroom-ai[all] via the uv lane" — planProvision
//     over HEADROOM_DESCRIPTOR with dryRun yields the uv-lane spec headroom-ai[all]==
//     0.26.0 and targets the headroom version dir in the store (no spawn).
//   - "the tool-platform check reflects headroom's platform matrix" (Scenario Outline)
//     — toolPlatformCheckFor(HEADROOM_DESCRIPTOR, platform): linux ok, darwin ok,
//     win32 warning naming the Rust prerequisite.
//
// Both are PURE over the frozen descriptor (ADR-004): no spawn, no live binary, no
// process-global state. This host is win32 — the linux/darwin rows pass `platform`
// EXPLICITLY so the assertions never depend on the host. One test object per
// @executable scenario (Scenario-Outline rows folded into one entry).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toolVersionDir } from "../src/paths.mjs";
import { HEADROOM_DESCRIPTOR, planProvision } from "../src/tool-store.mjs";
import { toolPlatformCheckFor } from "../src/config-inspect.mjs";

export const headroomProvisionPlatformTests = [
  // ═══════════════ 01_provision-and-platform.feature ══════════════════════════

  {
    // @executable Scenario: the headroom descriptor plans headroom-ai[all] via the uv
    // lane. planProvision dispatches on descriptor.provider ("uv") and, under dryRun,
    // returns the plan WITHOUT spawning. The install spec threads the [all] extra into
    // the PyPI form headroom-ai[all]==0.26.0, and the plan targets the headroom version
    // dir in the store (derived via toolVersionDir, the same path the resolver reads).
    name: "headroom-provision-platform/01 the headroom descriptor plans headroom-ai[all] via the uv lane",
    async run() {
      // A temp store home so the version dir is hermetic (no process-global ~/.aof).
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-plan-"));
      const env = { AOF_GLOBAL_HOME: home };
      try {
        let plan;
        assert.doesNotThrow(() => {
          plan = planProvision(HEADROOM_DESCRIPTOR, { dryRun: true, env });
        }, "planProvision over the headroom descriptor must not throw under dryRun");

        assert.equal(plan.provider, "uv", "headroom provisions via the uv lane (no third provider)");

        // The uv-lane install spec threads the [all] extra: headroom-ai[all]==<version>.
        const expectedSpec = `headroom-ai[all]==${HEADROOM_DESCRIPTOR.version}`;
        assert.equal(plan.spec, expectedSpec, `the uv-lane install spec is "${expectedSpec}" — got: ${plan.spec}`);

        // The plan targets the headroom version dir in the store (derived, never hardcoded).
        const expectedVersionDir = toolVersionDir(HEADROOM_DESCRIPTOR.name, HEADROOM_DESCRIPTOR.version, env);
        assert.equal(plan.versionDir, expectedVersionDir, "the plan targets the headroom version dir in the store");

        // The uv-lane commands carry the spec + venv-into-version-dir (no spawn under
        // dryRun); the pip install line names the threaded spec.
        const installCmd = plan.commands.find((cmd) => cmd.includes("install"));
        assert.ok(installCmd, "the plan carries a uv pip install command");
        assert.ok(installCmd.includes(expectedSpec), `the install command names the headroom-ai[all] spec — got: ${installCmd.join(" ")}`);
        assert.ok(installCmd.includes(expectedVersionDir), "the install command provisions into the version dir");
        // dryRun is pure: the plan never names npx (provider-neutral) and never installs live.
        const flat = plan.commands.flat().join(" ");
        assert.ok(!/\bnpx\b/.test(flat), "the uv lane never shells npx");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable Scenario Outline: the tool-platform check reflects headroom's platform
    // matrix. The two POSIX platforms ship a prebuilt wheel (ok, no warning); win32 has
    // no wheel (warning naming the Rust prerequisite). Pure over the descriptor matrix —
    // always advisory, NEVER an error. Platforms passed EXPLICITLY (this host is win32).
    name: "headroom-provision-platform/01 the tool-platform check reflects headroom's platform matrix",
    run() {
      const rows = [
        { platform: "linux", severity: "ok", warns: false },
        { platform: "darwin", severity: "ok", warns: false },
        { platform: "win32", severity: "warning", warns: true },
      ];
      for (const { platform, severity, warns } of rows) {
        let check;
        assert.doesNotThrow(() => {
          check = toolPlatformCheckFor(HEADROOM_DESCRIPTOR, platform);
        }, `tool-platform must never throw (${platform})`);
        assert.equal(check.id, "tool-platform", "the check id is tool-platform");
        assert.equal(check.severity, severity, `${platform} → severity "${severity}"`);
        assert.notEqual(check.severity, "error", "tool-platform is never an error (advisory only)");
        assert.equal(check.details?.platform, platform, "the check carries the platform in details");
        assert.equal(check.details?.tool, "headroom", "the check carries the tool name in details");

        if (warns) {
          // win32 → warning naming the Rust prerequisite (assert case-insensitively).
          assert.match(check.message, /rust/i, `the win32 warning names the Rust prerequisite — got: ${check.message}`);
        } else {
          // linux/darwin → no warning (and certainly no Rust prereq surfaced).
          assert.doesNotMatch(check.message, /rust/i, `${platform} is ok and does not warn about Rust — got: ${check.message}`);
        }
      }
    },
  },
];

// Traceability wiring for milestone 12 / story 01, task 01 —
// tasks/01_doctor-checks.feature.
//
// Covers every @executable scenario against the REAL in-process code:
// src/config-inspect.mjs's three new doctorConfig checks (12/ADR-003, SUPERSEDING
// the 09 graphify-binary check in place) — managedToolChecks (store-first),
// providerPrereqCheck (uv), and toolPlatformChecks/toolPlatformCheckFor. One test
// object per @executable scenario (Scenario-Outline rows folded into one entry),
// each name tracing to feature + scenario.
//
// HERMETIC: every row drives the check via the injectable seams the builders
// expose (options.resolveManagedBinary / options.managedTools / options.uvPresent
// / options.which / options.platform) — no live binary, no process-global PATH
// mutation. This is Windows (win32); POSIX platform rows pass platform:"linux"/
// "darwin" explicitly so the assertions never depend on the host.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  doctorConfig,
  managedToolChecks,
  providerPrereqCheck,
  toolPlatformChecks,
  toolPlatformCheckFor,
} from "../src/config-inspect.mjs";

// A single-tool descriptor list so the managed-tool matrix drives ONE check at a
// time (the binaries[0] is the resolved binary name; ADR-001's package→binary map).
const GRAPHIFY_DESCRIPTOR_LIST = [
  { name: "graphify", provider: "uv", packageSpec: "graphifyy", version: "0.8.44", binaries: ["graphify", "graphify-mcp"] },
];

// Stubbed resolver results for the four managed-tool resolution states.
const FROM_STORE = () => ({ found: true, source: "store", binary: "graphify", path: "/store/graphify/0.8.44/bin/graphify", version: "0.8.44" });
const FROM_PATH = () => ({ found: true, source: "path", binary: "graphify", path: "/usr/local/bin/graphify", version: "0.8.44" });
const ABSENT = () => ({ found: false, hint: "Run `aof project provision graphify` to install graphify into the managed tool store." });
const STORE_VERSION_UNKNOWN = () => ({ found: true, source: "store", binary: "graphify", path: "/store/graphify/0.8.44/bin/graphify", version: null });

// A headroom-shaped descriptor with a per-platform matrix (the tool-platform rows).
function headroomDescriptor(win32Support) {
  const win32 = win32Support === "supported-with-note"
    ? { supported: true, prereqs: ["rust"], note: "needs Rust" }
    : { supported: false, prereqs: ["rust"], note: "no Windows wheel — sdist build needs Rust" };
  return {
    name: "headroom",
    provider: "uv",
    packageSpec: "headroom-ai",
    version: "0.26.0",
    binaries: ["headroom"],
    platforms: { linux: { supported: true }, darwin: { supported: true }, win32 },
  };
}

// Find the single managed-tool check for a tool in a check list.
function managedToolCheck(checks, tool) {
  return checks.find((item) => item.id === "managed-tool" && item.details?.tool === tool);
}

// A minimal valid project so doctorConfig runs end-to-end (it resolves the same
// checks[] `aof project doctor` surfaces — config-inspect.mjs / cli.mjs:1476).
async function makeProject() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-tool-doctor-"));
  const workspaceDir = path.join(targetDir, ".aof");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    path.join(workspaceDir, "aof.config.json"),
    `${JSON.stringify({ name: "demo", resources: [] }, null, 2)}\n`,
    "utf8"
  );
  return targetDir;
}

// Mirror cli.mjs doctorCommand's failure computation: the run fails ONLY when a
// check is severity "error" (or --strict + a warning). A tool warning must NOT
// make the run fail.
function doctorRunFailed(report, { strict = false } = {}) {
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  return errors.length > 0 || (strict && warnings.length > 0);
}

export const toolDoctorChecksTests = [
  // ═══════════════════════ 01_doctor-checks.feature ══════════════════════════

  {
    // @executable Scenario Outline: the managed-tool check maps each resolution
    // state to an honest severity. The full ADR-003 matrix: store hit (ok+version),
    // PATH-only (ok "not managed"), total miss (warning+guidance), store hit whose
    // version probe failed (ok, version unknown — RESEARCH §A4). Absence is the
    // ONLY warning; nothing is an error.
    name: "tool-doctor/01 the managed-tool check maps resolution state to severity (matrix)",
    run() {
      const cases = [
        {
          state: "present from the store",
          resolver: FROM_STORE,
          severity: "ok",
          assertMessage: (msg) => assert.ok(msg.includes("0.8.44") && /store/i.test(msg), `names the resolved version + the store — got: ${msg}`),
        },
        {
          state: "present on PATH only",
          resolver: FROM_PATH,
          severity: "ok",
          assertMessage: (msg) => assert.ok(/present on PATH/i.test(msg) && /not managed/i.test(msg), `says present on PATH, not managed — got: ${msg}`),
        },
        {
          state: "absent from store and PATH",
          resolver: ABSENT,
          severity: "warning",
          assertMessage: (msg) => assert.ok(/aof project provision/.test(msg), `gives the \`aof project provision\` guidance — got: ${msg}`),
        },
        {
          state: "present, version unprobable",
          resolver: STORE_VERSION_UNKNOWN,
          severity: "ok",
          assertMessage: (msg) => {
            assert.ok(/version unknown/i.test(msg), `says present, version unknown — got: ${msg}`);
            assert.ok(!/\d+\.\d+\.\d+/.test(msg), `does NOT fabricate a dotted version — got: ${msg}`);
          },
        },
      ];
      for (const { state, resolver, severity, assertMessage } of cases) {
        let checks;
        assert.doesNotThrow(() => {
          checks = managedToolChecks({ resolveManagedBinary: resolver, managedTools: GRAPHIFY_DESCRIPTOR_LIST });
        }, `the managed-tool check must never throw (state: ${state})`);
        const check = managedToolCheck(checks, "graphify");
        assert.ok(check, `a managed-tool check is present (state: ${state})`);
        assert.equal(check.severity, severity, `state "${state}" → severity "${severity}"`);
        assert.notEqual(check.severity, "error", `state "${state}" is never an error`);
        assertMessage(check.message);
      }
    },
  },

  {
    // @executable: a throwing resolver still degrades to a warning, never crashes —
    // the doctor check's never-throws contract (RESEARCH §A4).
    name: "tool-doctor/01 the managed-tool check absorbs a throwing resolver into a warning (never crashes)",
    run() {
      const THROWS = () => { throw new Error("resolver exploded"); };
      let checks;
      assert.doesNotThrow(() => {
        checks = managedToolChecks({ resolveManagedBinary: THROWS, managedTools: GRAPHIFY_DESCRIPTOR_LIST });
      }, "a throwing resolver must not crash the managed-tool check");
      const check = managedToolCheck(checks, "graphify");
      assert.ok(check, "a managed-tool check is present even when the resolver throws");
      assert.equal(check.severity, "warning", "a resolver crash degrades to a warning, never propagates");
      assert.ok(/aof project provision/.test(check.message), "the warning carries the provision guidance");
    },
  },

  {
    // @executable Scenario Outline: the provider-prereq check reports the uv
    // prerequisite. uv present → ok (confirms uv available); uv absent → warning
    // (install-uv guidance). Never an error. Driven via the injectable uvPresent /
    // which seams.
    name: "tool-doctor/01 the provider-prereq check reports the uv prerequisite (present + absent)",
    run() {
      const rows = [
        {
          uv: "on PATH",
          options: { uvPresent: true },
          severity: "ok",
          assertMessage: (msg) => assert.ok(/uv is available/i.test(msg), `confirms uv is available — got: ${msg}`),
        },
        {
          uv: "not on PATH",
          options: { uvPresent: false },
          severity: "warning",
          assertMessage: (msg) => assert.ok(/install uv/i.test(msg), `gives the install-uv guidance — got: ${msg}`),
        },
      ];
      for (const { uv, options, severity, assertMessage } of rows) {
        let check;
        assert.doesNotThrow(() => { check = providerPrereqCheck(options); }, `provider-prereq must never throw (uv: ${uv})`);
        assert.equal(check.id, "provider-prereq", "the check id is provider-prereq");
        assert.equal(check.severity, severity, `uv "${uv}" → severity "${severity}"`);
        assert.notEqual(check.severity, "error", "provider-prereq is never an error");
        assertMessage(check.message);
      }

      // Also exercise the injectable `which` seam (the default-probe path): a which
      // that returns a path → ok; a which that returns null → warning.
      const presentViaWhich = providerPrereqCheck({ which: () => "/usr/bin/uv" });
      assert.equal(presentViaWhich.severity, "ok", "a which-probe hit → ok");
      const absentViaWhich = providerPrereqCheck({ which: () => null });
      assert.equal(absentViaWhich.severity, "warning", "a which-probe miss → warning");
    },
  },

  {
    // @executable Scenario Outline: the tool-platform check warns (never blocks)
    // where a descriptor matrix is unsupported. Rows: linux supported (ok), darwin
    // supported (ok), win32 supported-with-note (ok — supported:true with a note),
    // win32 unsupported (warning). Always advisory — never an error. Driven via the
    // single-tool toolPlatformCheckFor helper with explicit platforms (host-neutral).
    name: "tool-doctor/01 the tool-platform check warns on an unsupported platform (matrix)",
    run() {
      const rows = [
        { platform: "linux", descriptor: headroomDescriptor("unsupported"), severity: "ok" },
        { platform: "darwin", descriptor: headroomDescriptor("unsupported"), severity: "ok" },
        { platform: "win32", descriptor: headroomDescriptor("supported-with-note"), severity: "ok" },
        { platform: "win32", descriptor: headroomDescriptor("unsupported"), severity: "warning" },
      ];
      for (const { platform, descriptor, severity } of rows) {
        let check;
        assert.doesNotThrow(() => { check = toolPlatformCheckFor(descriptor, platform); }, `tool-platform must never throw (${platform})`);
        assert.equal(check.id, "tool-platform", "the check id is tool-platform");
        assert.equal(check.severity, severity, `${platform} / ${descriptor.platforms[platform]?.supported} → severity "${severity}"`);
        assert.notEqual(check.severity, "error", "tool-platform is never an error");
        assert.equal(check.details?.platform, platform, "the check carries the platform in details");
      }

      // A descriptor with NO matrix → supported everywhere (ok).
      const noMatrix = toolPlatformCheckFor({ name: "graphify" }, "win32");
      assert.equal(noMatrix.severity, "ok", "a tool with no platform matrix is supported everywhere (ok)");

      // The win32-unsupported warning names the prereq (Rust).
      const win32Unsupported = toolPlatformCheckFor(headroomDescriptor("unsupported"), "win32");
      assert.ok(/rust/i.test(win32Unsupported.message), `the unsupported-platform warning names the prereq (Rust) — got: ${win32Unsupported.message}`);
    },
  },

  {
    // @executable: an absent tool, missing uv, and an unsupported platform never
    // error or crash — the doctor run reports no error and does not throw. End-to-end
    // through doctorConfig against a fixture project with all seams set to the bad
    // state (win32 unsupported via an explicit platform, so it is host-neutral).
    name: "tool-doctor/01 an absent tool, missing uv, and unsupported platform never error or crash",
    async run() {
      const targetDir = await makeProject();
      try {
        let report;
        await assert.doesNotReject(async () => {
          report = await doctorConfig(targetDir, {
            runtimes: ["codex"],
            // managed tool absent.
            resolveManagedBinary: ABSENT,
            managedTools: [headroomDescriptor("unsupported")],
            // uv missing.
            uvPresent: false,
            // platform unsupported (host-neutral: force win32, where headroom is unsupported).
            platform: "win32",
          });
        }, "doctorConfig must not throw when a tool is absent, uv is missing, and the platform is unsupported");

        // EVERY tool-related check is at most a warning — none is an error.
        const toolRelated = report.checks.filter((item) =>
          item.id === "managed-tool" || item.id === "provider-prereq" || item.id === "tool-platform"
        );
        assert.ok(toolRelated.length >= 3, `the report carries the three new tool checks (got ${toolRelated.length})`);
        for (const check of toolRelated) {
          assert.notEqual(check.severity, "error", `${check.id} is never severity error — got: ${check.severity}`);
        }

        // The doctor run reports no error.
        assert.equal(doctorRunFailed(report), false, "the doctor run reports no error for absent tool / missing uv / unsupported platform");
        assert.equal(
          report.checks.some((item) => item.severity === "error"),
          false,
          "no check in the whole report is severity error"
        );
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },
];

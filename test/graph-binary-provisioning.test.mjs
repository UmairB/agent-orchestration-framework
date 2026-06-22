// Traceability wiring for milestone 09 / story 01 — binary-provisioning.
//
// Covers every @executable scenario across the story's two task features against
// the REAL in-process code: src/graphify.mjs's resolveGraphifyBinary (story 00's
// ADR-002 seam) and src/config-inspect.mjs's doctorConfig graphify-binary check
// (this story's ADR-004 Option B wiring). One test object per @executable
// scenario (Scenario-Outline rows folded into one entry), each name tracing to
// feature + scenario.
//
//   00_binary-resolution.feature    — absent → structured miss + provision-command
//        hint + no throw/spawn ; spec-name vs binary-name asymmetry (graphifyy ↔
//        graphify). (milestone-12 ADR-004 re-points resolveGraphifyBinary store-first
//        onto resolveManagedBinary, so the miss hint now names `aof project provision
//        graphify`, superseding the 09 two-step manual install.) (the present-binary +
//        version-probe Outline is @manual — live-only, RESEARCH §A4/A7 — NOT wired here.)
//   01_doctor-graphify-check.feature — absent → graphify-binary severity "warning"
//        + guidance + doctor run does not error ; the severity matrix (absent →
//        warning, present → ok, version-unknown → ok, never throws) ; the
//        version-unknown degrade message ("present, version unknown", no invented
//        version).
//
// The absent case is made HERMETIC via the additive options seam story 01 added to
// resolveGraphifyBinary ({ pathValue:"", useLocator:false }) — no process-global
// PATH mutation. The doctor states are driven via doctorConfig's injectable
// options.resolveGraphifyBinary seam (default: the real resolver), so all three
// states are CI-assertable with the binary stubbed — no live graphify needed.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveGraphifyBinary,
  GRAPHIFY_SPEC,
  GRAPHIFY_BINARY,
} from "../src/graphify.mjs";
import { doctorConfig } from "../src/config-inspect.mjs";

// --- fixtures ----------------------------------------------------------------

// A minimal valid project so doctorConfig runs end-to-end (it resolves the same
// checks[] `aof project doctor` surfaces — config-inspect.mjs / cli.mjs:1457).
async function makeProject() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-prov-"));
  const workspaceDir = path.join(targetDir, ".aof");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    path.join(workspaceDir, "aof.config.json"),
    `${JSON.stringify({ name: "demo", resources: [] }, null, 2)}\n`,
    "utf8"
  );
  return targetDir;
}

// Mirror cli.mjs:1457 doctorCommand's failure computation: the run reports an
// error ONLY when a check is severity "error" (or --strict + a warning). A
// graphify-binary "warning" must NOT make the run fail.
function doctorRunFailed(report, { strict = false } = {}) {
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  return errors.length > 0 || (strict && warnings.length > 0);
}

// milestone-12 ADR-003 SUPERSESSION: the 09 `graphify-binary` doctor check is
// SUPERSEDED IN PLACE by the store-aware `managed-tool` check (config-inspect.mjs).
// These 01_doctor-graphify-check.feature entries now find the graphify
// `managed-tool` check and drive state via doctorConfig's new resolveManagedBinary /
// managedTools seams (instead of the PATH-only resolveGraphifyBinary). The INTENT
// is preserved (absent→warning, present+version→ok naming the version,
// version-unknown→ok "version unknown", the run does not fail) and the absent
// warning now names `aof project provision graphify` (NOT `uv tool install`). The
// 00_binary-resolution.feature resolver entries below are UNCHANGED (the resolver
// is another story's concern — 12/ADR-004).

// A single-tool descriptor list so the graphify managed-tool check is driven on
// its own (binaries[0] is the resolved binary name; ADR-001's package→binary map).
const GRAPHIFY_MANAGED_TOOLS = [
  { name: "graphify", provider: "uv", packageSpec: "graphifyy", version: "0.8.44", binaries: [GRAPHIFY_BINARY] },
];

// Find the graphify managed-tool check in a doctor report (the superseding check).
function graphifyCheck(report) {
  return report.checks.find((item) => item.id === "managed-tool" && item.details?.tool === "graphify");
}

// Stubbed STORE-FIRST resolver results for the doctor states (the resolveManagedBinary
// shape: { found, source, binary, path, version } | { found:false, hint }).
const ABSENT = () => ({
  found: false,
  hint: "Run `aof project provision graphify` to install graphify into the managed tool store.",
});
const PRESENT_WITH_VERSION = () => ({
  found: true,
  source: "store",
  binary: GRAPHIFY_BINARY,
  path: "/stub/bin/graphify",
  version: "0.8.44",
});
const PRESENT_VERSION_UNKNOWN = () => ({
  found: true,
  source: "store",
  binary: GRAPHIFY_BINARY,
  path: "/stub/bin/graphify",
  version: null,
});

export const graphBinaryProvisioningTests = [
  // ═══════════════════════ 00_binary-resolution.feature ═══════════════════════

  {
    // @executable: an absent graphify binary resolves to a structured miss with
    // install guidance — found:false, the hint names `aof project provision
    // graphify` (milestone-12 ADR-004 re-points resolveGraphifyBinary store-first
    // onto resolveManagedBinary, whose miss hint names the provision command), and
    // it does not throw (and does not spawn graphify to learn it is absent).
    name: "graph-binary/00 absent graphify resolves to a structured miss with install guidance",
    async run() {
      // Hermetic absence via the additive seam: empty PATH + locator skipped, so
      // an empty injected PATH is the ONLY source consulted — no process-global
      // PATH mutation, deterministic on every platform/CI. The store leg is a clean
      // miss because no AOF_GLOBAL_HOME store copy is provisioned here.
      let result;
      assert.doesNotThrow(() => {
        result = resolveGraphifyBinary({ pathValue: "", useLocator: false });
      }, "resolveGraphifyBinary must never throw on an absent binary");
      assert.equal(result.found, false, "absent → found:false (a structured miss, not an ENOENT)");
      assert.equal(typeof result.hint, "string");
      assert.ok(
        result.hint.includes("aof project provision graphify"),
        `hint must name "aof project provision graphify" — got: ${result.hint}`
      );
      // The miss is purely structured: no version/path leaks into an absent result.
      assert.equal(result.path, undefined, "an absent result carries no binary path");
      assert.equal(result.version, undefined, "an absent result asserts no version");
    },
  },

  {
    // @executable: the install hint names the provision command. milestone-12
    // ADR-004 SUPERSEDES the 09 two-step manual install (`uv tool install graphifyy`
    // then `graphify install`) with the single lifecycle command — graphify is now
    // an aof-managed dependency installed via `aof project provision graphify`, so
    // the store-first resolver's miss hint names that one command, not the two
    // manual steps.
    name: "graph-binary/00 the install hint names the provision command",
    async run() {
      const result = resolveGraphifyBinary({ pathValue: "", useLocator: false });
      assert.equal(result.found, false);
      assert.ok(
        result.hint.includes("aof project provision graphify"),
        `hint must name the provision command "aof project provision graphify" — got: ${result.hint}`
      );
    },
  },

  {
    // @executable: the resolver distinguishes the spec name (PyPI `graphifyy`,
    // double-y) from the invoked binary name (`graphify`, single-y) — the
    // load-bearing asymmetry a lock/doctor entry records (RESEARCH §G).
    name: "graph-binary/00 the resolver distinguishes the spec name from the binary name",
    async run() {
      assert.equal(GRAPHIFY_SPEC, "graphifyy", "the install spec name is the double-y PyPI package");
      assert.equal(GRAPHIFY_BINARY, "graphify", "the invoked binary name is the single-y executable");
      assert.notEqual(GRAPHIFY_SPEC, GRAPHIFY_BINARY, "spec and binary names are distinct (the asymmetry)");
    },
  },

  // ═══════════════════ 01_doctor-graphify-check.feature ═══════════════════════

  {
    // @executable: doctor reports the absent binary as a warning with install
    // guidance, and the overall doctor run does not report an error for graphify
    // being absent.
    name: "graph-binary/01 doctor reports the absent binary as a warning with install guidance",
    async run() {
      const targetDir = await makeProject();
      try {
        // milestone-12 ADR-003 supersession: drive the absent state via the new
        // store-first resolveManagedBinary seam (single-tool managedTools list).
        const report = await doctorConfig(targetDir, {
          runtimes: ["codex"],
          resolveManagedBinary: ABSENT,
          managedTools: GRAPHIFY_MANAGED_TOOLS,
        });
        const check = graphifyCheck(report);
        assert.ok(check, "doctor surfaces a graphify managed-tool check");
        assert.equal(check.severity, "warning", "absent → warning (NOT error — a project may not graph)");
        assert.ok(
          check.message.includes("aof project provision graphify"),
          `message must name "aof project provision graphify" — got: ${check.message}`
        );
        // The run does not FAIL because graphify is absent (a warning, not an error).
        assert.equal(
          doctorRunFailed(report),
          false,
          "the doctor run does not report an error for graphify being absent"
        );
        assert.equal(
          report.checks.some((item) => item.id === "managed-tool" && item.details?.tool === "graphify" && item.severity === "error"),
          false,
          "the graphify managed-tool check is never severity error"
        );
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable Scenario Outline: the graphify-binary check maps each state to
    // the right severity and NEVER throws — absent → warning, present(version) →
    // ok, present(version-unknown) → ok. (the three Examples rows, folded.)
    name: "graph-binary/01 the graphify-binary check maps each state to the right severity (matrix)",
    async run() {
      const targetDir = await makeProject();
      try {
        // milestone-12 ADR-003 supersession: the severities are unchanged (absent→
        // warning, present(version)→ok, version-unknown→ok), but the state is now
        // driven via the store-first resolveManagedBinary seam.
        const cases = [
          { state: "absent from store and PATH", resolver: ABSENT, severity: "warning" },
          { state: "present from the store with a version", resolver: PRESENT_WITH_VERSION, severity: "ok" },
          { state: "present, version probe unavailable", resolver: PRESENT_VERSION_UNKNOWN, severity: "ok" },
        ];
        for (const { state, resolver, severity } of cases) {
          let report;
          // "never throws": resolving the doctor checks must not throw for any state.
          await assert.doesNotReject(async () => {
            report = await doctorConfig(targetDir, {
              runtimes: ["codex"],
              resolveManagedBinary: resolver,
              managedTools: GRAPHIFY_MANAGED_TOOLS,
            });
          }, `the graphify managed-tool check must never throw (state: ${state})`);
          const check = graphifyCheck(report);
          assert.ok(check, `graphify managed-tool check present (state: ${state})`);
          assert.equal(check.severity, severity, `state "${state}" → severity "${severity}"`);
          assert.notEqual(check.severity, "error", `state "${state}" is never an error`);
        }
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable: the check degrades clearly when the version probe is
    // unavailable — severity ok, message says the version is unknown, and it does
    // NOT invent or assert a version it never observed (RESEARCH §A4).
    name: "graph-binary/01 the check degrades clearly when the version probe is unavailable",
    async run() {
      const targetDir = await makeProject();
      try {
        // milestone-12 ADR-003 supersession: driven via the store-first seam.
        const report = await doctorConfig(targetDir, {
          runtimes: ["codex"],
          resolveManagedBinary: PRESENT_VERSION_UNKNOWN,
          managedTools: GRAPHIFY_MANAGED_TOOLS,
        });
        const check = graphifyCheck(report);
        assert.ok(check, "doctor surfaces a graphify managed-tool check");
        assert.equal(check.severity, "ok", "present-but-unprobable → ok (present, just no version)");
        assert.ok(
          /unknown/i.test(check.message),
          `message must say the version is unknown — got: ${check.message}`
        );
        // It does not invent a version: no dotted version string appears in the
        // message, and the details carry version:null (observed-nothing, honestly).
        assert.equal(
          /\d+\.\d+\.\d+/.test(check.message),
          false,
          `the version-unknown message must NOT assert a concrete version — got: ${check.message}`
        );
        assert.equal(check.details?.version, null, "details record version:null, not a fabricated value");
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable (severity-matrix, present-with-version row asserted positively):
    // a present binary with a probed version reports ok with the resolved version
    // in the message — the check is honest about a version it DID observe.
    name: "graph-binary/01 a present binary with a version reports ok naming the resolved version",
    async run() {
      const targetDir = await makeProject();
      try {
        // milestone-12 ADR-003 supersession: driven via the store-first seam.
        const report = await doctorConfig(targetDir, {
          runtimes: ["codex"],
          resolveManagedBinary: PRESENT_WITH_VERSION,
          managedTools: GRAPHIFY_MANAGED_TOOLS,
        });
        const check = graphifyCheck(report);
        assert.ok(check, "doctor surfaces a graphify managed-tool check");
        assert.equal(check.severity, "ok", "present + version → ok");
        assert.ok(
          check.message.includes("0.8.44"),
          `message must include the resolved version "0.8.44" — got: ${check.message}`
        );
        assert.equal(doctorRunFailed(report), false, "a healthy graphify check does not fail the run");
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },

  // ═══ 01 version naming + degrade (milestone-12 ADR-003 supersession) ═══
  // The 09 check's version-PIN-DRIFT warning (a present-but-different version was a
  // warning naming resolved-vs-pinned) does NOT survive the supersession: the
  // store-aware `managed-tool` check is store-first and version-keyed (a project
  // pinning a version provisions THAT version dir — there is no PATH-binary "drift"
  // to flag), so it simply REPORTS the resolved version. The surviving INTENT —
  // present+version → ok naming the version, version-unknown → ok "version unknown"
  // (never an invented version), run-does-not-fail — is preserved here, driven via
  // the store-first resolveManagedBinary seam.
  {
    name: "graph-binary/01 the managed-tool check names the resolved version (present → ok), version-unknown → ok",
    async run() {
      const targetDir = await makeProject();
      try {
        // (a) present-from-store with a version → ok, names the resolved version,
        // run does not fail.
        const present = await doctorConfig(targetDir, {
          runtimes: ["codex"],
          resolveManagedBinary: PRESENT_WITH_VERSION,
          managedTools: GRAPHIFY_MANAGED_TOOLS,
        });
        const presentCheck = graphifyCheck(present);
        assert.equal(presentCheck.severity, "ok", "present-from-store is ok");
        assert.ok(presentCheck.message.includes("0.8.44"), "the ok message names the resolved version");
        assert.equal(presentCheck.details?.version, "0.8.44", "details record the OBSERVED version");
        assert.equal(doctorRunFailed(present), false, "a present-version check does not fail the run");

        // (b) version-unknown stays a clean ok — never an invented version.
        const unknown = await doctorConfig(targetDir, {
          runtimes: ["codex"],
          resolveManagedBinary: PRESENT_VERSION_UNKNOWN,
          managedTools: GRAPHIFY_MANAGED_TOOLS,
        });
        const unknownCheck = graphifyCheck(unknown);
        assert.equal(unknownCheck.severity, "ok", "a version-unknown binary is a clean ok");
        assert.ok(/unknown/i.test(unknownCheck.message), "the version-unknown message says so");
        assert.ok(!/\d+\.\d+\.\d+/.test(unknownCheck.message), "the version-unknown message asserts no version it did not observe");
        assert.equal(unknownCheck.details?.version, null, "details record version:null, not a fabricated value");
        assert.equal(doctorRunFailed(unknown), false, "the version-unknown branch does not fail the run");
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
  },
];

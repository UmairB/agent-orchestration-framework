// Fitness function for milestone 09 / ADR-006 inv. 3 (binary-absent clean
// failure; ADR-002 + ADR-004):
// "`resolveGraphifyBinary()` returns a structured `{ found:false, hint }` (with
//  the `aof project provision graphify` guidance — milestone-12 ADR-004 re-points
//  the resolver store-first, superseding the 09 two-step manual-install hint) when
//  graphify is absent — never an opaque ENOENT, never a throw; and the
//  `graphify-binary` doctor check surfaces the absence as a `warning` (NOT an
//  error, NEVER a crash), and degrades clearly on an unprobable version
//  (`present, version unknown`)."
//
// The absent case is made HERMETIC via the additive options seam ADR-002/story 01
// added to resolveGraphifyBinary ({ pathValue:"", useLocator:false }) — empty PATH
// + locator skipped — PLUS an explicitly isolated managed store root
// (verify-2026-06-22, finding-F1): the store-first resolver derives its store root
// from env.AOF_GLOBAL_HOME, so neutralizing only the PATH leg still let the store
// leg consult the operator's real ~/.aof/tools/graphify and return found:true.
// Pinning env: { AOF_GLOBAL_HOME: <empty dir> } isolates the store leg to a
// guaranteed-empty root, so the absent assertion holds regardless of whether the
// operator has graphify provisioned. The doctor states are driven via doctorConfig's
// injectable resolveManagedBinary seam (default: the real resolver), so all states
// are CI-assertable with no live graphify binary.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveGraphifyBinary, GRAPHIFY_BINARY } from "../../src/graphify.mjs";
import { doctorConfig } from "../../src/config-inspect.mjs";

// A minimal valid project so doctorConfig runs end-to-end (it resolves the same
// checks[] `aof project doctor` surfaces).
async function makeProject() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-graph-absent-"));
  const workspaceDir = path.join(targetDir, ".aof");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    path.join(workspaceDir, "aof.config.json"),
    `${JSON.stringify({ name: "demo", resources: [] }, null, 2)}\n`,
    "utf8"
  );
  return targetDir;
}

// The doctor run "fails" only when a check is severity "error" (or --strict + a
// warning). A graphify-binary "warning" must NOT make the run fail.
function doctorRunFailed(report, { strict = false } = {}) {
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  return errors.length > 0 || (strict && warnings.length > 0);
}

// milestone-12 ADR-003 SUPERSESSION: the 09 `graphify-binary` doctor check is
// SUPERSEDED IN PLACE by the store-aware `managed-tool` check (config-inspect.mjs).
// Scenarios 2 + 3 below (the DOCTOR-check scenarios) now find the graphify
// `managed-tool` check and drive state via the new resolveManagedBinary /
// managedTools doctor seams. Scenario 1 (the resolveGraphifyBinary RESOLVER test)
// is UNCHANGED — the resolver is a separate story's concern (12/ADR-004). inv.3's
// guarantee is preserved: absent→warning, version-unknown→ok, throwing-resolver→
// warning, never-crash, run-does-not-fail; the absent message now names
// `aof project provision`.

// A single-tool descriptor list so the graphify managed-tool check is driven on
// its own (binaries[0] is the resolved binary name; ADR-001's package→binary map).
const GRAPHIFY_MANAGED_TOOLS = [
  { name: "graphify", provider: "uv", packageSpec: "graphifyy", version: "0.8.44", binaries: [GRAPHIFY_BINARY] },
];

// Find the graphify managed-tool check in a doctor report (the superseding check).
function graphifyCheck(report) {
  return report.checks.find((item) => item.id === "managed-tool" && item.details?.tool === "graphify");
}

// Stubbed STORE-FIRST resolver results for the doctor states (the
// resolveManagedBinary shape: { found, source, binary, path, version }
// | { found:false, hint }).
const ABSENT = () => ({
  found: false,
  hint: "Run `aof project provision graphify` to install graphify into the managed tool store.",
});
const PRESENT_VERSION_UNKNOWN = () => ({
  found: true,
  source: "store",
  binary: GRAPHIFY_BINARY,
  path: "/stub/bin/graphify",
  version: null,
});
// A resolver that THROWS — the doctor check must still never crash.
const THROWS = () => {
  throw new Error("locator exploded");
};

export const archTests = [
  {
    name: "arch/ADR-006 inv.3: resolveGraphifyBinary() returns a structured { found:false, hint } when graphify is absent (no throw, no ENOENT)",
    run: async () => {
      // The hermetic absent case on BOTH resolver legs (finding-F1): empty PATH + no
      // OS locator neutralizes the PATH leg, and AOF_GLOBAL_HOME is EXPLICITLY
      // isolated to a fresh empty dir (no tools/graphify under it) so the store-first
      // leg is a clean miss too — the assertion holds regardless of whether the
      // operator has graphify provisioned in their real ~/.aof store.
      const storeRoot = await mkdtemp(path.join(os.tmpdir(), "aof-graph-empty-store-"));
      try {
        let resolved;
        assert.doesNotThrow(
          () => {
            resolved = resolveGraphifyBinary({
              pathValue: "",
              useLocator: false,
              env: { ...process.env, AOF_GLOBAL_HOME: storeRoot },
            });
          },
          "resolveGraphifyBinary never throws on a missing binary"
        );
        assert.equal(resolved.found, false, "the resolver reports found:false structurally");
        assert.equal(typeof resolved.hint, "string", "the miss carries a string install hint");
        // milestone-12 ADR-004: resolveGraphifyBinary is re-pointed store-first onto
        // resolveManagedBinary, whose miss hint names the single lifecycle command
        // (superseding the 09 two-step `uv tool install graphifyy` + `graphify install`).
        assert.ok(/aof project provision/.test(resolved.hint), "the hint names the `aof project provision` command");
        // The structured miss never leaks a live-binary handle.
        assert.ok(!("path" in resolved), "the absent result carries no resolved binary path");
      } finally {
        await rm(storeRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-006 inv.3: the graphify-binary doctor check is a `warning` (not error, never a crash) when graphify is absent",
    run: async () => {
      const projectDir = await makeProject();
      try {
        // milestone-12 ADR-003 supersession: drive the absent state via the new
        // store-first resolveManagedBinary seam; doctorConfig must not throw.
        let report;
        try {
          report = await doctorConfig(projectDir, {
            resolveManagedBinary: ABSENT,
            managedTools: GRAPHIFY_MANAGED_TOOLS,
          });
        } catch (error) {
          assert.fail(`doctorConfig crashed when graphify is absent: ${error.message}`);
        }
        const check = graphifyCheck(report);
        assert.ok(check != null, "the doctor report carries a graphify managed-tool check");
        assert.equal(check.severity, "warning", "absent graphify is a warning, NOT an error");
        assert.notEqual(check.severity, "error", "absent graphify never escalates to error (a project may legitimately not graph)");
        assert.ok(/aof project provision/.test(check.message), "the warning carries the `aof project provision` guidance");
        assert.equal(doctorRunFailed(report), false, "an absent-graphify warning does not fail the doctor run");
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-006 inv.3: the graphify-binary doctor check degrades clearly (ok, `version unknown`) when the version is unprobable, and never crashes when the resolver throws",
    run: async () => {
      const projectDir = await makeProject();
      try {
        // milestone-12 ADR-003 supersession: drive these via the store-first
        // resolveManagedBinary seam. Version-unknown branch: present but no version
        // → ok + a clear message, never an invented version (RESEARCH §A4).
        const unknownReport = await doctorConfig(projectDir, {
          resolveManagedBinary: PRESENT_VERSION_UNKNOWN,
          managedTools: GRAPHIFY_MANAGED_TOOLS,
        });
        const unknownCheck = graphifyCheck(unknownReport);
        assert.equal(unknownCheck.severity, "ok", "present-but-version-unknown is ok (the binary IS provisioned)");
        assert.ok(/version unknown/i.test(unknownCheck.message), "the message reports `version unknown`, not a fabricated version");
        assert.ok(!/\d+\.\d+\.\d+/.test(unknownCheck.message), "the version-unknown message asserts no dotted version it did not observe");
        assert.equal(doctorRunFailed(unknownReport), false, "the version-unknown branch does not fail the doctor run");

        // A throwing resolver must STILL be absorbed into a warning, never crash.
        let crashReport;
        try {
          crashReport = await doctorConfig(projectDir, {
            resolveManagedBinary: THROWS,
            managedTools: GRAPHIFY_MANAGED_TOOLS,
          });
        } catch (error) {
          assert.fail(`doctorConfig crashed when the resolver throws: ${error.message}`);
        }
        const crashCheck = graphifyCheck(crashReport);
        assert.ok(crashCheck != null, "the doctor report carries a graphify managed-tool check even when the resolver throws");
        assert.equal(crashCheck.severity, "warning", "a resolver crash degrades to a warning, never propagates");
        assert.equal(doctorRunFailed(crashReport), false, "a resolver crash never fails the doctor run");
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    },
  },
];

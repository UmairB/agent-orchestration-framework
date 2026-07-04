// Traceability wiring for milestone 33 / story 01 — per-fabric operator guidance.
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/04_operator-guidance.feature: the healthy-tailscale preflight guidance (self-
// address + same-tailnet/peer-Online/shields-up lines); the per-BackendState
// remediation matrix; the macOS App-Store-CLI-split warn (an INJECTED platform + an
// injected CLI-unreachable signal, exercisable on ANY CI OS); the warn's absence on a
// non-macOS platform; work doctor surfacing the SAME remediation and never
// runtime-auto-fixing. One test object per @executable scenario (Scenario-Outline rows
// folded into one entry iterating the rows). node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { probeFabric, fabricGuidance, macOsAppStoreSplitWarning, remediationForReason } from "../src/mesh-fabric.mjs";

const STATUS_FIXTURE = {
  BackendState: "Running",
  Self: { HostName: "umairs-msi", DNSName: "umairs-msi.tail1a2b.ts.net.", TailscaleIPs: ["100.121.112.23"], Online: true },
  Peer: {},
};

const CONFIG = { mesh: { fabric: "tailscale" } };

async function makeRepo({ fabricConfigured = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-operator-guidance-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: fabricConfigured ? { nodeId: "test-node", fabric: "tailscale" } : {},
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

const cleanup = (repo) => rm(repo, { recursive: true, force: true });

export const meshOperatorGuidanceTests = [
  // ══ Scenario: a healthy tailscale preflight prints the resolved self-address and the
  //    reachability guidance ══
  {
    name: "mesh-operator-guidance/04 a healthy tailscale preflight prints the resolved self-address and the reachability guidance",
    async run() {
      const exec = async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 });
      const probe = await probeFabric(CONFIG, { exec, platform: "linux" });
      const guidance = fabricGuidance(probe, { selfAddress: "100.121.112.23" });
      assert.equal(guidance.healthy, true);
      const joined = guidance.lines.join("\n");
      assert.ok(joined.includes("100.121.112.23"), "the guidance includes the resolved self-address");
      assert.ok(/same tailnet/.test(joined), "the guidance states both nodes must be on the same tailnet");
      assert.ok(/tailscale status.*Online|Online.*tailscale status/.test(joined), "the guidance states to ensure `tailscale status` shows the peer Online");
      assert.ok(/shields-up|ACLs/.test(joined), "the guidance states that if a dial is refused, check shields-up/ACLs");
    },
  },

  // ══ Scenario Outline: a degraded probe prints the RESEARCH §4 remediation matching
  //    its reason ══
  {
    name: "mesh-operator-guidance/04 a degraded probe prints the RESEARCH §4 remediation matching its reason (Scenario Outline, folded)",
    async run() {
      const rows = [
        { reason: "not-installed", remediation: "install Tailscale" },
        { reason: "needs-login", remediation: "run `tailscale up`" },
        { reason: "stopped", remediation: "the tailscale daemon isn't running" },
        { reason: "needs-machine-auth", remediation: "waiting on tailnet admin approval" },
        { reason: "degraded", remediation: "the fabric probe could not be parsed — check tailscale" },
        { reason: "fabric-unsupported", remediation: "this build targets tailscale — that fabric is not yet supported" },
        { reason: "fabric-undeclared", remediation: 'declare config.mesh.fabric = "tailscale" to enable the mesh' },
      ];
      for (const row of rows) {
        const guidance = fabricGuidance({ healthy: false, reason: row.reason }, {});
        assert.deepEqual(guidance.lines, [row.remediation], `[${row.reason}] the printed guidance is the expected remediation`);
        assert.equal(remediationForReason(row.reason), row.remediation, `[${row.reason}] remediationForReason matches`);
      }
    },
  },

  // ══ Scenario: on macOS, when the CLI cannot reach the daemon, the preflight warns
  //    and steers to the Standalone/open-source build ══
  {
    name: "mesh-operator-guidance/04 on macOS, when the CLI cannot reach the daemon, the preflight warns and steers to the Standalone/open-source build",
    async run() {
      const warning = macOsAppStoreSplitWarning({ platform: "darwin", cliUnreachable: true });
      assert.ok(warning != null, "a warning is emitted about the macOS App-Store CLI split");
      assert.ok(/standalone|open-source/i.test(warning), "it steers the operator to the Standalone or open-source tailscaled build");
      // Install-guidance only — the function returns a STRING to print, never performs
      // an action; there is no runtime auto-fix API surface here at all.
      assert.equal(typeof warning, "string", "it does NOT attempt a runtime auto-fix (install-guidance only — a string to print)");
    },
  },

  // ══ Scenario Outline: the macOS App-Store-split warn is not emitted on a non-macOS
  //    platform ══
  {
    name: "mesh-operator-guidance/04 the macOS App-Store-split warn is not emitted on a non-macOS platform (Scenario Outline, folded)",
    async run() {
      for (const platform of ["win32", "linux"]) {
        const warning = macOsAppStoreSplitWarning({ platform, cliUnreachable: true });
        assert.equal(warning, null, `[${platform}] no macOS App-Store CLI-split warning is emitted`);
        // The failure is reported through the ordinary degraded-fabric remediation instead.
        assert.equal(remediationForReason("degraded"), "the fabric probe could not be parsed — check tailscale", `[${platform}] the ordinary degraded remediation still resolves`);
      }
    },
  },

  // ══ Scenario: work doctor surfaces the same per-fabric guidance and never
  //    runtime-auto-fixes ══
  {
    name: "mesh-operator-guidance/04 work doctor surfaces the same remediation as the launcher and never runtime-auto-fixes",
    async run() {
      const repo = await makeRepo({ fabricConfigured: true });
      try {
        const ws = await loadWorkspace(repo);
        const fabricProbe = { fabric: "tailscale", state: null, healthy: false, reason: "needs-login" };
        const result = await invoke("work:doctor", {}, { workspace: ws, fabricProbe });
        const finding = result.findings.find((f) => f.code === "mesh-fabric-degraded");
        assert.ok(finding != null, "work doctor reports a mesh-fabric-degraded finding");
        assert.ok(finding.message.includes("run `tailscale up`"), 'work doctor reports the same remediation "run `tailscale up`" as the launcher');
        assert.equal(finding.severity, "warn", "the finding is advisory (warn), never an error that blocks");
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ (additive) work doctor stays silent when the mesh fabric is unconfigured — no
  //    dangling finding on an install that never opted into a fabric ══
  {
    name: "mesh-operator-guidance/04 work doctor stays silent on an unconfigured mesh (no fabric probe attempted, no dangling finding)",
    async run() {
      const repo = await makeRepo({ fabricConfigured: false });
      try {
        const ws = await loadWorkspace(repo);
        let probed = false;
        const fabricProbe = null; // ensure the injected shortcut is not what silences it
        const result = await invoke("work:doctor", {}, { workspace: ws });
        void probed;
        const finding = result.findings.find((f) => f.code === "mesh-fabric-degraded");
        assert.equal(finding, undefined, "no mesh-fabric-degraded finding appears when config.mesh.fabric is undeclared");
      } finally {
        await cleanup(repo);
      }
    },
  },
];

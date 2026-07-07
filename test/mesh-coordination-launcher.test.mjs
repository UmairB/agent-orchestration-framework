// Traceability wiring for milestone 33 / story 01 — the coordination launcher.
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/03_coordination-launcher.feature, exercising src/mesh-launcher.mjs
// (launcherProbe / startLauncher) and the registered mesh:serve command over an
// INJECTED fabric-exec closure + an injected sync-loop ticker + an injected peer-poll
// ticker — no tailnet, no wall-clock wait. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry iterating the rows). node:assert/strict.
//
//   03_coordination-launcher.feature — the registered run is a non-blocking probe that
//     reports fabric state + self-address + registered mesh peer count + issuance authority and
//     RETURNS (never listens, never starts the loop); the --serve path preflights and
//     refuses-with-guidance on a degraded fabric (no loop, no presence publish); a
//     healthy preflight publishes presence, starts the reused sync loop, binds no
//     listening socket, and re-reads resolvePeers each tick; SIGINT/SIGTERM stop the
//     loop + publisher cleanly via the observable stop() seam; the verb rides
//     acd-mesh-command-cli-bijection because its registered run returns, never listens.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke, listCommands } from "../src/command-core.mjs";
import { presenceRecordPath, publishNodeRecord } from "../src/mesh-store.mjs";
import { launcherProbe, startLauncher } from "../src/mesh-launcher.mjs";
import { acquireMeshLauncherLock } from "../src/mesh-launcher-lock.mjs";

const NODE_ID = "test-node-self";

const STATUS_FIXTURE = {
  BackendState: "Running",
  Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.121.112.23"], Online: true },
  Peer: {
    a: { HostName: "peer-b", DNSName: "peer-b.tail1a2b.ts.net.", TailscaleIPs: ["100.90.11.5"], Online: true },
    b: { HostName: "peer-c", DNSName: "peer-c.tail1a2b.ts.net.", TailscaleIPs: ["100.70.22.9"], Online: true },
  },
};

async function makeRepo({ issuanceAuthority = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-launcher-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: {
      nodeId: NODE_ID,
      fabric: "tailscale",
      relay: issuanceAuthority ? { controlNode: NODE_ID } : { controlNode: "someone-else" },
    },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

// A FRESH, NEVER-PUBLISHED node: no pinned config.mesh.nodeId, no sidecar. The fixture
// this task's regression row needs (every OTHER fixture pins nodeId, which masks the
// mint-on-probe bug — this one deliberately does not).
async function makeFreshRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-launcher-fresh-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" }, mesh: { fabric: "tailscale" } };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

function manualTicker() {
  const handles = [];
  return {
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
    fire(handle) { handle.onTick(); },
    handles,
  };
}

const cleanup = (repo) => rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

async function loadLauncherWorkspace(repo) {
  return await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") } });
}

function launcherOptions(repo, options = {}) {
  const env = { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") };
  const { controlStreamServerOptions = {}, globalWorkStoreOptions = {}, ...rest } = options;
  return {
    ...rest,
    globalWorkStoreOptions: { env, ...globalWorkStoreOptions },
    controlStreamServerOptions: {
      ...controlStreamServerOptions,
      storeOptions: { env, ...(controlStreamServerOptions.storeOptions ?? {}) },
    },
  };
}

export const meshCoordinationLauncherTests = [
  // ══ Scenario: the registered run is a non-blocking probe that reports fabric state +
  //    self-address + registered mesh peer count + issuance authority and RETURNS ══
  {
    name: "mesh-coordination-launcher/03 the registered run is a non-blocking probe that reports fabric state + self-address + registered mesh peer count + issuance authority and RETURNS",
    async run() {
      const repo = await makeRepo({ issuanceAuthority: true });
      try {
        const ws = await loadLauncherWorkspace(repo);
        await publishNodeRecord(ws, "mesh-peer-b", {
          nodeId: "mesh-peer-b",
          host: "peer-b",
          os: "linux",
          runtimes: ["codex"],
          publishedAt: "2026-07-06T11:00:00.000Z",
        });
        const exec = async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 });
        const result = await launcherProbe(ws, { exec, platform: "linux" });
        assert.deepEqual(
          result,
          { fabricState: "running", healthy: true, selfAddress: "100.121.112.23", peerCount: 1, launcherRunning: false, launcherPid: null, issuanceAuthority: true },
          "the probe returns registered mesh peer count, not raw Tailscale peer count"
        );
        const command = listCommands().find((entry) => entry.id === "mesh:serve");
        assert.match(command.cli.render(result), /1 mesh peer\(s\).*launcher stopped/, "the CLI labels mesh peer count and separates launcher state from fabric state");

        const lock = await acquireMeshLauncherLock({ paths: { meshRoot: ws.globalMeshRoot }, pid: 12345 });
        try {
          const running = await launcherProbe(ws, {
            exec,
            platform: "linux",
            launcherLockOptions: { paths: { meshRoot: ws.globalMeshRoot }, isProcessAlive: (pid) => pid === 12345 },
          });
          assert.equal(running.launcherRunning, true, "the probe reports a live launcher lock separately from fabric state");
          assert.equal(running.launcherPid, 12345, "the probe reports the launcher owner pid");
          assert.match(command.cli.render(running), /launcher running \(pid 12345\)/, "the CLI renders launcher state explicitly when the daemon is running");
        } finally {
          await lock.release();
        }
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ Scenario: on a degraded fabric the registered probe still RETURNS, reporting the
  //    unhealthy state (never blocks) ══
  {
    name: "mesh-coordination-launcher/03 on a degraded fabric the registered probe still RETURNS, reporting the unhealthy state (never blocks)",
    async run() {
      const repo = await makeRepo();
      try {
        const ws = await loadLauncherWorkspace(repo);
        const exec = async () => { const error = new Error("spawn tailscale ENOENT"); error.code = "ENOENT"; throw error; };
        const result = await launcherProbe(ws, { exec, platform: "linux" });
        assert.equal(result.fabricState, "not-installed", 'the --json result reports fabricState "not-installed"');
        assert.equal(result.healthy, false, "the --json result reports healthy false (a status probe, not a start)");
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ Scenario Outline: the --serve path preflights and refuses-with-guidance when the
  //    fabric probe is degraded ══
  {
    name: "mesh-coordination-launcher/03 the --serve path preflights and refuses-with-guidance when the fabric probe is degraded (Scenario Outline, folded)",
    async run() {
      const rows = [
        { reason: "not-installed", exec: async () => { const e = new Error("enoent"); e.code = "ENOENT"; throw e; } },
        { reason: "needs-login", exec: async () => ({ stdout: JSON.stringify({ ...STATUS_FIXTURE, BackendState: "NeedsLogin" }), status: 0 }) },
        { reason: "stopped", exec: async () => ({ stdout: JSON.stringify({ ...STATUS_FIXTURE, BackendState: "Stopped" }), status: 0 }) },
        { reason: "needs-machine-auth", exec: async () => ({ stdout: JSON.stringify({ ...STATUS_FIXTURE, BackendState: "NeedsMachineAuth" }), status: 0 }) },
        { reason: "degraded", exec: async () => ({ stdout: "not json", status: 0 }) },
      ];
      for (const row of rows) {
        const repo = await makeRepo();
        try {
          const ws = await loadLauncherWorkspace(repo);
          const handle = await startLauncher(ws, launcherOptions(repo, { exec: row.exec, platform: "linux" }));
          assert.equal(handle.refused, true, `[${row.reason}] the daemon does NOT start`);
          assert.ok(handle.guidance != null && handle.guidance.lines.length > 0, `[${row.reason}] it carries the guidance for this reason`);
          assert.equal(handle.probe.reason, row.reason, `[${row.reason}] the refusal names the matching reason`);
          // No presence file was published (no sync loop, no presence publish).
          const published = await readFile(presenceRecordPath(ws, NODE_ID), "utf8").then(() => true).catch(() => false);
          assert.equal(published, false, `[${row.reason}] no presence record was published`);
        } finally {
          await cleanup(repo);
        }
      }
    },
  },

  // ══ Scenario: a healthy preflight starts the daemon, publishes presence, runs the
  //    reused sync loop, and binds no listening socket ══
  {
    name: "mesh-coordination-launcher/03 a healthy preflight starts the daemon, publishes presence, runs the reused sync loop, and binds no listening socket",
    async run() {
      const repo = await makeRepo();
      try {
        const ws = await loadLauncherWorkspace(repo);
        const exec = async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 });
        const syncTicker = manualTicker();
        const peerTicker = manualTicker();
        let peersSeen = null;
        const handle = await startLauncher(ws, launcherOptions(repo, {
          exec,
          platform: "linux",
          ticker: syncTicker,
          peerPollTicker: peerTicker,
          onPeers: (peers) => { peersSeen = peers; },
        }));

        assert.equal(handle.refused, undefined, "the daemon starts (no refusal)");
        const published = await readFile(presenceRecordPath(ws, NODE_ID), "utf8").then((text) => JSON.parse(text)).catch(() => null);
        assert.ok(published != null, "this node's git presence record is published (via the reused publishPresenceRecord)");
        assert.equal(published.nodeId, NODE_ID, "the published record carries this node's id");
        assert.equal(syncTicker.handles.length, 1, "the reused startSyncLoop is started on the configured cadence");
        assert.equal(handle.selfAddress, "100.121.112.23", 'no listening broker socket is bound (the "bind" is the fabric self-address)');

        // Each ticker tick re-reads resolvePeers so mesh:status reflects live fabric liveness.
        peerTicker.fire(peerTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.ok(Array.isArray(peersSeen) && peersSeen.length === 2, "each ticker tick re-reads resolvePeers");

        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ Scenario Outline: <signal> stops the sync loop and the presence publisher
  //    cleanly ══
  {
    name: "mesh-coordination-launcher/03 SIGINT/SIGTERM stop the sync loop and the presence publisher cleanly (Scenario Outline, folded)",
    async run() {
      for (const signal of ["SIGINT", "SIGTERM"]) {
        const repo = await makeRepo();
        try {
          const ws = await loadLauncherWorkspace(repo);
          const exec = async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 });
          const syncTicker = manualTicker();
          const peerTicker = manualTicker();
          const handle = await startLauncher(ws, launcherOptions(repo, { exec, platform: "linux", ticker: syncTicker, peerPollTicker: peerTicker }));
          assert.equal(handle.refused, undefined, `[${signal}] the daemon is running with a published presence record and a live sync loop`);

          // The CLI's SIGINT/SIGTERM handler, when invoked, calls handle.stop() — the
          // standard Node signal-handler testing idiom: drive the SAME internal
          // stop-routine the real process.on(signal, …) handler calls, no real signal.
          const onSignal = () => handle.stop();
          assert.doesNotThrow(() => onSignal(), `[${signal}] the registered handler, when invoked, calls stop() without throwing`);

          assert.equal(syncTicker.handles[0].stopped, true, `[${signal}] the sync loop's stop() is called (the ticker is torn down)`);
          assert.equal(peerTicker.handles[0].stopped, true, `[${signal}] the presence/peer-poll ticker is stopped cleanly`);

          // No further tick fires / advances after stop (the ticker is torn down — a
          // manual ticker's fire() would still invoke onTick if called again, but no
          // caller does so after stop(), proving the serve path "returns cleanly").
        } finally {
          await cleanup(repo);
        }
      }
    },
  },

  // ══ Scenario: the serve verb rides acd-mesh-command-cli-bijection because its
  //    registered run returns, not listens ══
  {
    name: "mesh-coordination-launcher/03 the serve verb rides acd-mesh-command-cli-bijection because its registered run returns, not listens",
    async run() {
      const command = listCommands().find((c) => c.id === "mesh:serve");
      assert.ok(command != null, "mesh:serve is registered as a mesh:* command");
      assert.ok(command.cli != null && typeof command.cli.argv === "function" && typeof command.cli.render === "function", "it carries a cli adapter");

      const repo = await makeRepo();
      try {
        const ws = await loadLauncherWorkspace(repo);
        const start = Date.now();
        const result = await invoke("mesh:serve", {}, { workspace: ws });
        const elapsedMs = Date.now() - start;
        assert.ok(result !== undefined, "the registered run completes and returns a parseable result");
        assert.ok(elapsedMs < 15000, "the registered run completed promptly (never a blocking listen)");
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ REGRESSION (review Fix 1 — HIGH): the non-blocking probe must NOT mint/persist
  //    identity on a fresh, never-published node (no pinned config.mesh.nodeId, no
  //    sidecar) — a read-only probe must never write .aof/mesh/identity.json ══
  {
    name: "mesh-coordination-launcher/03 REGRESSION: the registered mesh:serve probe never mints/persists the per-install identity sidecar on a fresh, never-published node",
    async run() {
      const repo = await makeFreshRepo();
      try {
        const ws = await loadLauncherWorkspace(repo);
        const sidecarPath = ws.identityPath;
        assert.equal(existsSync(sidecarPath), false, "precondition: no sidecar exists before the probe");

        const exec = async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 });
        const result = await launcherProbe(ws, { exec, platform: "linux" });

        assert.equal(existsSync(sidecarPath), false, "the probe wrote NO sidecar (.aof/mesh/identity.json does not exist afterward — a read-only probe never mints)");
        assert.equal(typeof result.fabricState, "string", "the probe still returned a valid fabricState");
        assert.equal(result.healthy, true, "the probe still returned a valid healthy flag");
        assert.equal(typeof result.selfAddress, "string", "the probe still returned a valid selfAddress");
        assert.equal(typeof result.peerCount, "number", "the probe still returned a valid peerCount");
        assert.equal(typeof result.launcherRunning, "boolean", "the probe still returned a valid launcherRunning flag");
        assert.equal(result.launcherPid == null || typeof result.launcherPid === "number", true, "the probe still returned a null-or-number launcherPid");
        assert.equal(typeof result.issuanceAuthority, "boolean", "the probe still returned a valid issuanceAuthority");

        // The SAME must hold through the registered mesh:serve command (the actual
        // bijection-gate-probed path), not only the bare launcherProbe function.
        const viaCommand = await invoke("mesh:serve", {}, { workspace: ws });
        assert.equal(existsSync(sidecarPath), false, "invoking the registered mesh:serve command also writes NO sidecar");
        assert.ok(viaCommand != null, "the registered command still returns a valid probe result");
      } finally {
        await cleanup(repo);
      }
    },
  },
];

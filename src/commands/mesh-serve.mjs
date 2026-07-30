// mesh:serve — the per-node presence and global propagation daemon FACE / probe command (milestone 33 /
// story 01, ADR-003). Thin over src/mesh-launcher.mjs. `aof mesh serve` is a long-lived
// serve verb (it stands up the fabric presence/global propagation daemon), but its registered command
// run is the NON-BLOCKING probe (the mesh:relay precedent, ADR-003.2): it reports the
// fabric state + this node's resolved self-address + the registered mesh peer count + whether this node
// is the control node — WITHOUT starting the long-lived daemon. This keeps the
// acd-mesh-command-cli-bijection gate honest (`aof mesh serve --json` runs clean + parseable +
// RETURNS, never hanging on a daemon). The long-lived daemon is the `--serve` spelling,
// declared through the LAUNCHER SEAM below (cli.launch) — the face's probe rule
// (--json never launches) is what keeps the two doors from ever colliding.
import path from "node:path";
import { launcherProbe, startLauncher } from "../mesh-launcher.mjs";
import { acquireMeshLauncherLock } from "../mesh-launcher-lock.mjs";
import { createMeshLogSink } from "../mesh-log.mjs";
import { readBuildInfo, buildInfoString } from "../build-info.mjs";
import { sweepStaleTempFiles } from "../fs.mjs";
import { globalMeshPaths } from "../workspace.mjs";
import { loadWorkspace } from "../work.mjs";
import { MESH_WORKSPACE_FLAG, guardMeshPositionals } from "./mesh-face-shared.mjs";

// `aof mesh serve --serve` — the FOREGROUND presence+sync daemon (milestone 33 / story
// 01, ADR-003.1/.3): the long-lived `--serve` face over the one-shot launcher core
// (src/mesh-launcher.mjs's startLauncher). Moved here whole from cli.mjs with the
// launcher seam (m42 wave (d) leg d1, wave-3 tail) — the body lives beside its
// command, never in the face file. Preflights the fabric and refuses-with-guidance if
// degraded (never starting a loop over a dead fabric); a healthy preflight publishes
// this node's presence, starts global work propagation, and periodically re-reads the
// fabric peer-map — binding NO listening broker socket (the "bind" is the fabric
// self-address). Traps SIGINT/SIGTERM to stop cleanly.
async function runMeshServeDaemon(options) {
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const launcherLock = await acquireMeshLauncherLock({ env: process.env });
  if (!launcherLock.acquired) {
    const pid = launcherLock.pid != null ? ` (pid ${launcherLock.pid})` : "";
    console.error(`AOF mesh launcher is already running${pid}.`);
    process.exitCode = 1;
    return;
  }

  let handle = null;
  // m42 wave (a) / TECH_DEBT item 2 — the durable sink. Warnings TEE here beside the
  // live stderr line (a supervised daemon's stderr goes nowhere; this file is the
  // record). Startup/shutdown are logged too, with the build id, so "which build ran
  // when" is answerable from the file alone.
  const logSink = createMeshLogSink("mesh-serve", { env: process.env });
  // m42 / item 2's REMOTE read — a worker forwards each log event UP its stream so
  // the control's `aof mesh logs --node <id>` answers from its own store. Wired
  // after startLauncher returns (the client exists then); a forward fault is
  // already failure-isolated inside sendLogEntries.
  let forwardLogEntry = null;
  try {
    // review fix (live soak, 2026-07-17): a connect failure, propagation fault, or
    // dispatch-tick error used to be accumulated into handle.warnings and never read
    // again by this foreground loop — the daemon's own log showed nothing regardless
    // of what actually went wrong. Every warning now prints live, timestamped, as it
    // happens.
    handle = await startLauncher(workspace, {
      onWarning: (warning) => {
        console.error(`[mesh ${new Date().toISOString()}] ${warning.code}: ${warning.message}`);
        // 2026-07-27 — an event may carry its OWN level (the dispatch/worktree
        // DECISION records are info, not warn); anything level-less stays warn.
        const entry = { at: new Date().toISOString(), level: warning.level ?? "warn", code: warning.code ?? "warning", message: warning.message ?? "", path: warning.path ?? null };
        logSink.write(entry);
        forwardLogEntry?.(entry);
      },
    });
    if (handle.refused) {
      console.error(`The fabric is not ready to serve (${handle.probe.reason ?? "degraded"}):`);
      for (const line of handle.guidance.lines) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }

    console.log(`AOF mesh launcher is running (node ${handle.record.nodeId}).`);
    // TECH_DEBT item 1 — same second-line build report as mesh ui's.
    console.log(`Build: ${buildInfoString(readBuildInfo())}`);
    console.log(`Self-address: ${handle.selfAddress ?? "(unresolved)"}`);
    console.log(`Log: ${logSink.path}`);
    console.log("Press Ctrl+C to stop the launcher.");
    logSink.write({ level: "info", code: "daemon-started", message: `mesh serve running (node ${handle.record.nodeId}, build ${buildInfoString(readBuildInfo())})`, node: handle.record.nodeId });
    if (handle.streamClient != null && typeof handle.streamClient.sendLogEntries === "function") {
      const client = handle.streamClient;
      forwardLogEntry = (entry) => {
        void client.sendLogEntries([entry]);
      };
      forwardLogEntry({ at: new Date().toISOString(), level: "info", code: "daemon-started", message: `mesh serve running (node ${handle.record.nodeId}, build ${buildInfoString(readBuildInfo())})`, path: null });
    }
    // m38-F26 (m42 wave (a)) — reclaim .tmp-* orphans a crashed publisher left in
    // the presence/nodes stores (age-gated; a live writer's temp is never touched).
    for (const dir of [path.join(globalMeshPaths({ env: process.env }).meshRoot, "presence"), globalMeshPaths({ env: process.env }).nodesRoot]) {
      const swept = await sweepStaleTempFiles(dir);
      if (swept.removed.length > 0) {
        logSink.write({ level: "info", code: "temp-orphans-swept", message: `reclaimed ${swept.removed.length} stale .tmp-* file(s) in ${dir}` });
      }
    }

    await new Promise((resolve) => {
      const shutdown = () => {
        handle.stop();
        resolve();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  } finally {
    await launcherLock.release();
  }
}

export const meshServeCommand = {
  id: "mesh:serve",
  input: {
    type: "object",
    // No input today — the probe reads config.mesh.* off the workspace. Additive-
    // friendly for a future flag.
    properties: {},
    additionalProperties: false,
  },

  async run(_input, ctx) {
    // The NON-BLOCKING probe (no listen, no loop started): fabric state + self-address
    // + registered mesh peer count + control-node. The `--serve` spelling is the
    // launcher body (cli.launch below); this registered run never blocks.
    return await launcherProbe(ctx.workspace);
  },

  cli: {
    // m42 wave (d) leg d1 (wave-3 tail) — routed at last: the launcher seam let the
    // route carry BOTH spellings. Bare `aof mesh serve` invokes the probe; `--serve`
    // (a declared flag, not a route word) selects the daemon body via cli.launch.
    // The face's probe rule means `--serve --json` is STILL the probe document —
    // a launcher never rides --json (documented contract change; previously the
    // daemon started and --json was ignored).
    route: ["mesh", "serve"],
    spec: {
      usage: "aof mesh serve [--serve] [--workspace <path|id>] [--json]",
      flags: {
        serve: { type: "boolean", description: "run the long-lived presence+sync daemon in the foreground" },
        ...MESH_WORKSPACE_FLAG,
      },
    },

    // `aof mesh serve` — no positional (the daemon publishes/syncs THIS node, not a
    // named ref). The guard governs both doors: the face runs argv before launch too.
    argv: (positionals) => {
      guardMeshPositionals("serve", positionals);
      return {};
    },

    // The launcher seam: `--serve` selects the daemon body; anything else falls
    // through to the probe/invoke path. The body resolves its own workspace from
    // the cwd (the retired meshServeDaemonCommand contract, byte-for-byte).
    launch: (options) => (options.serve === true ? (_input, faceCtx) => runMeshServeDaemon(faceCtx.options) : null),

    // The status line: fabric health + self-address + registered mesh peer count + control-node role.
    render(result) {
      if (result == null) return "No launcher status.";
      const address = result.selfAddress ?? "(no address — fabric degraded)";
      const role = result.issuanceAuthority ? " — this node is the control node" : "";
      const launcher = result.launcherRunning ? `launcher running${result.launcherPid != null ? ` (pid ${result.launcherPid})` : ""}` : "launcher stopped";
      return `Fabric ${result.fabricState} (healthy: ${result.healthy}) — self-address ${address} — ${result.peerCount} mesh peer(s) — ${launcher}${role}`;
    },

    // The --json face is the bare probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};

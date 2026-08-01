// mesh:ui — the fleet mission-control web surface as a REGISTERED launcher-seam
// command (m42 wave (d) leg d1, wave-3 tail; formerly cli.mjs's CLI-only
// meshUiCommand + MESH_UI_FLAGS, both retired). `aof mesh ui` is a long-lived
// serve verb (milestone 25 / story 02, ADR-003; milestone 34 / story 03,
// ADR-006): it stands up its OWN thin fleet serve-face (serveMeshUi) — one
// 127.0.0.1 server serving the ui/dist bundle with ?mode=fleet + the
// GET /api/mesh/status route — and mirrors the board's ui-build-missing +
// EADDRINUSE friendly refusals (never a stack trace). Default port 4181 clears
// assets-ui 4177/4178 + board 4180, so the fleet view runs ON TOP of a board on
// one machine.
//
// The launcher seam splits its two faces:
//   run (the probe) — meshUiProbe: what WOULD serve (port/scope/projectDir,
//     uiBuildPresent, relayConfigured), non-blocking. This is the --json face
//     (the face's probe rule: --json never launches), which is what keeps the
//     acd-mesh-command-cli-bijection spawn probe from hanging on the server.
//   cli.launch — the long-lived fleet server body, moved whole from cli.mjs.
//
// milestone 34 / story 03 (ADR-006) — `aof mesh ui` is GLOBAL by default: it
// passes scope "global" to serveMeshUi and does NOT require the current
// directory to be a mesh-enabled workspace to start (serveMeshUi loads no
// workspace up front; the global read only opens the machine-wide projection
// store). `--local` passes scope "local" + this directory as projectDir — the
// pre-existing focused-workspace view, unchanged. The announced browser URL
// always names the selected scope (`?mode=fleet&scope=<global|local>`) so a
// bookmarked/shared link reproduces the same view.
import path from "node:path";
import { serveMeshUi, meshUiProbe, DEFAULT_MESH_UI_PORT } from "../mesh-ui-serve.mjs";
// milestone 38 / story 06 — ADR-014 AMENDMENT (2026-07-19, closing BLOCKER
// F-38.06, option (a)): the fleet CONSUMER seam — a real relay subscription,
// wired as a LITERAL `startTerminalRelaySubscriber` key at the production
// `serveMeshUi({...})` call site below (the launch body).
import { createTerminalMirrorSubscriberTransport, startTerminalMirrorSubscriber } from "../mesh-terminal-mirror.mjs";
// m42 "interactive worker terminals" — the INPUT direction's loopback push, wired
// as a LITERAL `terminalInputPush` key at the same production call site (null when
// no relay is configured — the route then stays output-only).
import { createTerminalRelayPushTransport } from "../mesh-terminal-relay-bridge.mjs";
import { readBuildInfo, buildInfoString } from "../build-info.mjs";
import { createMeshLogSink } from "../mesh-log.mjs";
import { loadWorkspace } from "../work.mjs";
import { guardMeshPositionals } from "./mesh-face-shared.mjs";

// The one shaping both doors share: the probe (run) and the launch body resolve
// port/scope/projectDir identically, so the probe can never describe a different
// server than the one `aof mesh ui` would start.
function resolveUiLaunchConfig(options) {
  return {
    port: Number.parseInt(options.port ?? String(DEFAULT_MESH_UI_PORT), 10),
    projectDir: path.resolve(options.target ?? process.cwd()),
    scope: options.local ? "local" : "global",
    configPath: options.config,
  };
}

// The long-lived fleet server (the retired meshUiCommand body, byte-for-byte on
// its announce lines and friendly refusals). The body owns its BEST-EFFORT
// workspace posture: a `loadWorkspace` fault (cwd is not a workspace at all, no
// aof.config.json, …) degrades to `config: undefined` rather than refusing the
// command (milestone 38 / story 06 — ADR-014 AMENDMENT).
// `createTerminalMirrorSubscriberTransport` already returns `null` for an
// undefined/unconfigured relay, so `startTerminalMirrorSubscriber` cleanly
// degrades to `{ connected:false }` — the mirror simply never receives a live
// frame; every other route on the fleet face still serves.
async function runFleetUi(input) {
  const { port, projectDir, scope, configPath } = input;

  let config;
  try {
    ({ config } = await loadWorkspace(projectDir, configPath));
  } catch {
    config = undefined;
  }

  let session;
  try {
    session = await serveMeshUi({
      projectDir,
      port,
      scope,
      startTerminalRelaySubscriber: (mirror) => startTerminalMirrorSubscriber({ transport: createTerminalMirrorSubscriberTransport(config), mirror }),
      terminalInputPush: createTerminalRelayPushTransport(config),
    });
  } catch (error) {
    if (error.code === "ui-build-missing") {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Pass --port <n> to pick another.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { server, fleetUrl } = session;
  console.log("AOF mesh ui is running locally.");
  // TECH_DEBT item 1 — the daemon's startup line records which build it runs
  // (a SECOND line: the announce line above is a pinned contract).
  console.log(`Build: ${buildInfoString(readBuildInfo())}`);
  // m42 wave (a) / item 2 — the ui daemon's durable startup record (same sink family
  // as mesh-serve's; the fleet server's own faults land via its error paths below).
  const uiLogSink = createMeshLogSink("mesh-ui", { env: process.env });
  uiLogSink.write({ level: "info", code: "daemon-started", message: `mesh ui running (build ${buildInfoString(readBuildInfo())})` });
  console.log(`Open this URL in your browser: ${fleetUrl}&scope=${scope}`);
  console.log(`Project: ${projectDir}`);
  console.log("Press Ctrl+C to stop the fleet view.");

  await new Promise((resolve) => {
    const shutdown = () => {
      server.close(() => {
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export const meshUiCommand = {
  id: "mesh:ui",
  input: {
    type: "object",
    properties: {
      port: { type: "number" },
      projectDir: { type: "string" },
      scope: { type: "string", enum: ["global", "local"] },
      configPath: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input) {
    // The NON-BLOCKING probe (no bind, no server): what WOULD serve. The launch
    // body is the --serve-class door below; this registered run never blocks.
    return await meshUiProbe(input);
  },

  cli: {
    route: ["mesh", "ui"],
    spec: {
      usage: "aof mesh ui [--port 4181] [--local] [--target <dir>] [--json]",
      // The retired MESH_UI_FLAGS vocabulary, declared per-command: port/local/
      // target (+ the base json/config). The face's spec-parse is what refuses an
      // unknown flag now (`Unknown flag "--x" for mesh:ui` replacing the old
      // `Unknown option "--x".` — the wave-3 documented-contract-change class).
      workspace: false,
      flags: {
        port: { type: "string", description: "port to bind (default 4181)" },
        local: { type: "boolean", description: "focused-workspace view of this directory (default: global fleet)" },
        target: { type: "string", description: "serve this project directory instead of the cwd" },
      },
    },

    // `aof mesh ui` — no positional. The guard governs both doors (the face runs
    // argv before launch too); a stray positional was previously ignored
    // silently — it now gets the mesh family's loud refusal.
    argv: (positionals, options) => {
      guardMeshPositionals("ui", positionals);
      return resolveUiLaunchConfig(options);
    },

    // The launcher seam: every non---json invocation IS the fleet server (bare
    // `aof mesh ui` launches — today's contract); the probe is the machine face.
    launch: () => (input) => runFleetUi(input),

    // The probe's human line. Unreachable from the CLI today (every non---json
    // invocation launches), but the bijection contract requires a render and the
    // board/MCP faces may invoke the probe headlessly.
    render(result) {
      const build = result.uiBuildPresent ? "ui build present" : "ui build MISSING (npm --prefix ui run build)";
      const relay = result.relayConfigured ? "relay configured" : "relay not configured";
      return `Fleet UI probe — would serve ${result.fleetUrl} from ${result.projectDir} (${build}; ${relay})`;
    },

    // The --json face is the bare probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};

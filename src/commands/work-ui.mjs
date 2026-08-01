// work:ui — the work board server as a REGISTERED launcher-seam command (m42
// wave (d) leg d1, wave-3 tail; formerly cli.mjs's CLI-only workUiCommand ladder
// branch). `aof work ui` serves the BUILT board (ui/dist) same-origin — api +
// terminal ws + static, one origin — mirroring the board's ui-build-missing +
// EADDRINUSE friendly refusals (never a stack trace).
//
// The launcher seam splits its two faces:
//   run (the probe) — boardUiProbe: what WOULD serve (port/projectDir,
//     uiBuildPresent, the board URL), non-blocking. This is the --json face (the
//     face's probe rule: --json never launches), which keeps the
//     acd-work-command-cli-bijection spawn probe from hanging on the server.
//   cli.launch — the long-lived board server body (the retired workUiCommand's
//     bytes: announce lines, friendly refusals, SIGINT/SIGTERM shutdown).
import path from "node:path";
import { serveBoard, boardUiProbe } from "../board-serve.mjs";
import { commandError } from "../command-error.mjs";

// The one shaping both doors share: the probe (run) and the launch body resolve
// port/projectDir identically, so the probe can never describe a different
// server than the one `aof work ui` would start. Default 4180 so it does not
// collide with `aof assets ui` (4177 frontend / 4178 API); the board serves on
// this single port.
function resolveBoardLaunchConfig(options) {
  return {
    port: Number.parseInt(options.port ?? "4180", 10),
    projectDir: path.resolve(options.target ?? process.cwd()),
  };
}

async function runWorkUi(input) {
  const { port, projectDir } = input;

  let session;
  try {
    session = await serveBoard({ projectDir, port });
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

  const { server, boardUrl } = session;
  console.log("AOF work ui is running locally.");
  console.log(`Open this URL in your browser: ${boardUrl}`);
  console.log(`Project: ${projectDir}`);
  console.log("Press Ctrl+C to stop the board.");

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

export const workUiCommand = {
  id: "work:ui",
  input: {
    type: "object",
    properties: {
      port: { type: "number" },
      projectDir: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input) {
    // The NON-BLOCKING probe (no bind, no server): what WOULD serve. The launch
    // body is the door below; this registered run never blocks.
    return boardUiProbe(input);
  },

  cli: {
    route: ["work", "ui"],
    spec: {
      usage: "aof work ui [--port 4180] [--target <dir>] [--json]",
      workspace: false,
      flags: {
        port: { type: "string", description: "port to bind (default 4180)" },
        target: { type: "string", description: "serve this project directory instead of the cwd" },
      },
    },

    // No positional. Previously a stray one was silently ignored — it now gets
    // the seam's loud refusal (the guard governs both doors).
    argv: (positionals, options) => {
      if (positionals.length > 0) {
        throw commandError(`"work ui" takes no positional argument (got "${positionals[0]}").`, "invalid-input", 400);
      }
      return resolveBoardLaunchConfig(options);
    },

    // The launcher seam: every non---json invocation IS the board server (bare
    // `aof work ui` launches — today's contract); the probe is the machine face.
    launch: () => (input) => runWorkUi(input),

    // The probe's human line — unreachable from the CLI today; other faces may
    // invoke the probe headlessly.
    render(result) {
      const build = result.uiBuildPresent ? "ui build present" : "ui build MISSING (npm --prefix ui run build)";
      return `Board probe — would serve ${result.boardUrl} from ${result.projectDir} (${build})`;
    },

    // The --json face is the bare probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};

// assets:ui — the project/global asset editor as a REGISTERED launcher-seam
// command (m42 wave (d) leg d1, wave-3 tail; formerly cli.mjs's CLI-only
// assetsUiCommand → setupUiCommand ladder branch). `aof assets ui` stands up the
// setup-UI API server plus the DEV-ONLY vite frontend re-exec (below), announcing
// the editor's `/config` URL (milestone 45 / ADR-002).
//
// The launcher seam splits its two faces:
//   run (the probe) — what WOULD serve: the resolved ui/api ports, the editor
//     URL, and the cwd it would announce. Non-blocking — the --json face (the
//     face's probe rule: --json never launches).
//   cli.launch — the launch body (the retired setupUiCommand's bytes), which
//     ALSO owns the `--no-serve` / `--dry-run` not-started print (a body that
//     returns immediately — the seam's body is the verb's CLI face, long-lived
//     or not).
import path from "node:path";
import { spawn } from "node:child_process";
import { assetBase } from "../asset-base.mjs";
import { commandError } from "../command-error.mjs";

// The one shaping both doors share.
function resolveSetupUiLaunchConfig(options) {
  const uiPort = Number.parseInt(options.port ?? "4177", 10);
  const apiPort = Number.parseInt(options.apiPort ?? String(uiPort + 1), 10);
  return {
    uiPort,
    apiPort,
    noServe: Boolean(options.noServe || options.dryRun),
    projectDir: process.cwd(),
  };
}

async function runSetupUi(input) {
  const description = "project/global asset editor";

  if (input.noServe) {
    console.log("Setup UI not started.");
    console.log("Run `aof assets ui` to open the local project/global asset editor.");
    return;
  }

  const { uiPort, apiPort } = input;
  const { serveSetupUi } = await import("../setup-ui.mjs");
  const { server } = await serveSetupUi(null, { port: apiPort });
  const frontend = startSetupUiFrontend(uiPort, `http://127.0.0.1:${apiPort}`);
  // milestone 45 / story 04 (ADR-002) — the config editor's PATH is `/config`, NOT
  // `/assets`: `/assets` is the built bundle's OWN asset directory (ui/dist/assets/
  // index-*.js), so a route by that name would collide with the JavaScript it serves.
  // The verb stays `assets ui` and the command id stays `assets:ui`; ADR-002 names that
  // divergence deliberately. The legacy `?mode=assets` address keeps working (ADR-003).
  const uiUrl = `http://127.0.0.1:${uiPort}/config`;

  console.log("AOF assets UI is running locally.");
  console.log(`Open this URL in your browser: ${uiUrl}`);
  console.log(`Project: ${process.cwd()}`);
  console.log(`Use the UI for ${description}. Keep this terminal open while you use it.`);
  console.log("Press Ctrl+C to stop the setup UI.");

  await new Promise((resolve, reject) => {
    const shutdown = () => {
      frontend.kill();
      server.close(() => {
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    frontend.once("exit", (code) => {
      server.close(() => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Setup UI frontend exited with code ${code}.`));
        }
      });
    });
  });
}

// DEV-ONLY: the vite UI dev server re-exec (RESEARCH §0; ADR-003 allow-list).
// Never on the shipped path — a SEA never runs vite. Re-homed onto the ONE
// asset-base seam for correctness (the same repoRoot-derivation every other
// site used), but allow-listed from the "must serve packaged assets" assertion
// (acd-sea-safe-asset-base fitness #1) since this line never executes in a SEA.
function startSetupUiFrontend(port, apiUrl = "http://127.0.0.1:4178") {
  // "version" resolves to the repo root in dev (the same base package.json/
  // work-bundle-manifest.mjs read); it never runs under a SEA (dev-only path).
  const repoRoot = assetBase("version");
  const uiDir = path.join(repoRoot, "ui");
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  return spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: uiDir,
    stdio: "inherit",
    env: {
      // `VITE_AOF_UI_MODE: "assets"` stood here and is RETIRED with the query selector it
      // fed (milestone 45 / ADR-002). It was a build-time constant, set only here and read
      // only by the pre-45 render root's ternary; keeping it would leave the route decision
      // with two inputs — a URL and a baked env var — which is the two-homes-for-one-fact
      // shape this milestone exists to remove. The address bar is the one input now, and
      // the editor is reached at `/config`.
      ...process.env,
      VITE_AOF_API_URL: apiUrl,
      BROWSER: "none"
    }
  });
}

export const assetsUiCommand = {
  id: "assets:ui",
  input: {
    type: "object",
    properties: {
      uiPort: { type: "number" },
      apiPort: { type: "number" },
      noServe: { type: "boolean" },
      projectDir: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input) {
    // The NON-BLOCKING probe (no bind, no vite spawn): what WOULD serve.
    return {
      mode: "assets-ui",
      uiPort: input.uiPort,
      apiPort: input.apiPort,
      projectDir: input.projectDir,
      // The probe's URL and the launch body's are separate strings that must never
      // disagree — both name the ADR-002 `/config` path (see the note at the serve site).
      uiUrl: `http://127.0.0.1:${input.uiPort}/config`,
    };
  },

  cli: {
    route: ["assets", "ui"],
    spec: {
      usage: "aof assets ui [--port 4177] [--api-port 4178] [--no-serve] [--json]",
      workspace: false,
      flags: {
        port: { type: "string", description: "frontend port (default 4177)" },
        apiPort: { type: "string", description: "API port (default frontend port + 1)" },
        noServe: { type: "boolean", description: "print how to start the editor without serving" },
        dryRun: { type: "boolean", description: "alias of --no-serve" },
      },
    },

    // No positional. Previously a stray one was silently ignored — it now gets
    // the seam's loud refusal (the guard governs both doors).
    argv: (positionals, options) => {
      if (positionals.length > 0) {
        throw commandError(`"assets ui" takes no positional argument (got "${positionals[0]}").`, "invalid-input", 400);
      }
      return resolveSetupUiLaunchConfig(options);
    },

    // The launcher seam: every non---json invocation is the CLI face body —
    // the editor serve, or the --no-serve/--dry-run not-started print (both the
    // retired setupUiCommand's bytes); the probe is the machine face.
    launch: () => (input) => runSetupUi(input),

    // The probe's human line — unreachable from the CLI today; other faces may
    // invoke the probe headlessly.
    render(result) {
      return `Assets UI probe — would serve ${result.uiUrl} (api on 127.0.0.1:${result.apiPort}) from ${result.projectDir}`;
    },

    // The --json face is the bare probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};

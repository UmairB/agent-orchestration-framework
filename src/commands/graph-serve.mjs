// graph:serve — the stdio MCP server as a REGISTERED launcher-seam command (m42
// wave (d) leg d1, wave-3 tail; formerly cli.mjs's CLI-only graphServeCommand
// ladder branch). `aof graph serve` launches the line-delimited JSON-RPC 2.0
// server the story-02 rendered MCP config entry targets (command:"aof",
// args:["graph","serve"] — story 04, ADR-005 amendment). It is a thin transport
// face over the SAME command core — it reaches the graph ONLY through
// invoke("graph:…"), and spawns no graphify itself (the driver src/graphify.mjs
// is the sole spawn site — ADR-006 inv. 2).
//
// The launcher seam splits its two faces:
//   run (the probe) — mcpServeProbe: the MCP server identity + protocol + the
//     advertised tool descriptors, non-blocking. This is the --json face (the
//     face's probe rule: --json never launches), which keeps the
//     acd-graph-command-cli-bijection spawn probe from hanging on the stdio loop.
//   cli.launch — the long-lived serveStdio body: loadWorkspace resolves the ctx
//     the server's tool handlers pass to invoke; the server then speaks JSON-RPC
//     over stdin/stdout until EOF.
import { serveStdio, mcpServeProbe } from "../graph-mcp-server.mjs";
import { loadWorkspace } from "../work.mjs";
import { commandError } from "./errors.mjs";

async function runGraphServe(options) {
  const workspace = await loadWorkspace(process.cwd(), options.config);
  await serveStdio({ workspace });
}

export const graphServeCommand = {
  id: "graph:serve",
  input: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },

  async run() {
    // The NON-BLOCKING probe (no stdin read, no loop): what WOULD serve. The
    // stdio loop is the launch body below; this registered run never blocks.
    return mcpServeProbe();
  },

  cli: {
    route: ["graph", "serve"],
    spec: {
      usage: "aof graph serve [--json]",
      // The probe describes a static surface; only the LAUNCH body needs a
      // workspace, and it resolves its own from the cwd (the mesh:serve
      // precedent — a launcher owns its workspace posture).
      workspace: false,
      flags: {},
    },

    // No positional. Previously a stray one was silently ignored — it now gets
    // the seam's loud refusal (the guard governs both doors: the face runs argv
    // before launch too).
    argv: (positionals) => {
      if (positionals.length > 0) {
        throw commandError(`"graph serve" takes no positional argument (got "${positionals[0]}").`, "invalid-input", 400);
      }
      return {};
    },

    // The launcher seam: every non---json invocation IS the stdio server (bare
    // `aof graph serve` blocks on stdin — today's contract); the probe is the
    // machine face.
    launch: () => (_input, faceCtx) => runGraphServe(faceCtx.options),

    // The probe's human line. Unreachable from the CLI today (every non---json
    // invocation launches), but the bijection contract requires a render and
    // other faces may invoke the probe headlessly.
    render(result) {
      const tools = result.tools.map((tool) => tool.name).join(", ");
      return `MCP stdio probe — ${result.server.name} ${result.server.version} (protocol ${result.protocolVersion}) advertising ${result.tools.length} tool(s): ${tools}`;
    },

    // The --json face is the bare probe (the non-blocking bijection-probe shape).
    json: (result) => result,
  },
};

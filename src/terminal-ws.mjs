// Adapted from elirantutia/vibeyard (MIT) — the node-pty lifecycle
// (pty.spawn options + onData/onExit/write/resize/kill, win32-guarded) and the
// CliProvider seam, re-homed off vibeyard's Electron IPC carrier onto `ws@8` at
// /ws/terminal. vibeyard is MIT-licensed; see the repo NOTICE file. ADR-001 (one
// http.createServer; the terminal WS only at /ws/terminal via `ws` noServer +
// server.on('upgrade')) and ADR-003 (the frozen wire envelope; a missing provider
// → an {type:'error'} control-frame, NEVER a crash).
//
// The wire envelope (frozen, ADR-003):
//   - PTY bytes  : raw WS frames both directions (client→server → pty.write;
//                  server→client → ws.send(data)).
//   - control    : client→server JSON { type:'resize', cols, rows } → pty.resize;
//                  server→client JSON { type:'exit', exitCode }     (clean/failed exit)
//                  server→client JSON { type:'error', message }     (spawn failure).
import { WebSocketServer } from "ws";
import { loadWorkspace, findWork } from "./work.mjs";
import { resolveProvider, PROVIDER_IDS } from "./terminal-providers.mjs";
import { registerSession, unregisterSession } from "./terminal-sessions.mjs";
import { resolveHeadroomLaunch } from "./headroom.mjs";

// The single terminal pathname (ADR-001). Any other upgrade pathname is destroyed.
const TERMINAL_PATH = "/ws/terminal";

// The default PTY spawner: dynamically imports node-pty INSIDE the call so that
// importing this module never requires the native addon at load time (CI tests
// inject a stub spawn; only a real session touches node-pty). Returns the
// node-pty process handle.
async function defaultSpawn(bin, args, options) {
  const pty = await import("node-pty");
  return pty.spawn(bin, args, options);
}

// Attach the terminal WebSocket to an existing http.Server (ADR-001: the SAME
// server serveSetupUi returns — no second server, no second port). The `spawn`
// option is injected for testability; it defaults to the real node-pty spawner.
//
//   attachTerminalWebSocket(server, { projectDir, spawn })
//
// On upgrade: route by pathname; only /ws/terminal handshakes, everything else is
// socket.destroy()'d (the `ws` default branch — the only "auth" a 127.0.0.1
// single-user server needs).
export function attachTerminalWebSocket(server, options = {}) {
  const projectDir = options.projectDir ?? process.cwd();
  const spawn = options.spawn ?? defaultSpawn;
  const baseEnv = options.env ?? process.env;
  // Injectable PATH lookup (default: real PATH). Tests pass a stub that reports a
  // provider's binary present/absent so the @executable scenarios drive the
  // missing-binary error path with no real PATH and no real PTY.
  const which = options.which;
  // Persist running sessions to .aof/terminal-sessions.json? Default OFF so the
  // test suite's serveSetupUi servers never touch .aof (no temp-dir teardown
  // race); the real `aof work ui` (serveBoard) turns it ON.
  const recordSessions = options.recordSessions ?? false;

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "ws://127.0.0.1").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== TERMINAL_PATH) {
      // Unknown upgrade pathname: reject (the ws pattern's default branch).
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    handleConnection(ws, request, { projectDir, spawn, baseEnv, which, recordSessions }).catch((error) => {
      // A defensive backstop: even an unexpected error in connection setup must
      // surface as the dock error state, never an unguarded throw (ADR-003).
      sendControl(ws, { type: "error", message: error?.message ?? "terminal session failed" });
      safeClose(ws);
    });
  });

  return wss;
}

// Read the thin launch contract (ref + provider) off the upgrade URL, resolve the
// item dir + provider, and either spawn the session or emit the error
// control-frame. Never throws in a way that crashes the process.
async function handleConnection(ws, request, { projectDir, spawn, baseEnv, which, recordSessions }) {
  const params = parseQuery(request.url);
  const ref = (params.get("ref") ?? "").trim();
  const providerId = (params.get("provider") ?? "").trim();

  if (!PROVIDER_IDS.includes(providerId)) {
    sendControl(ws, { type: "error", message: `Unknown provider "${providerId || "(none)"}".` });
    safeClose(ws);
    return;
  }

  const provider = resolveProvider(providerId, which);
  if (!provider) {
    sendControl(ws, { type: "error", message: `Unknown provider "${providerId}".` });
    safeClose(ws);
    return;
  }

  // Resolve the item's directory from the ref, in-process, to use as PTY cwd.
  // A missing/unresolvable ref falls back to projectDir rather than crashing.
  // The workspace config is retained for the headroom resolver (ADR-003): it is
  // hoisted out of the try and left undefined on the catch path, so a config
  // resolution failure is treated as plugin-off and never breaks the terminal.
  let cwd = projectDir;
  let headroomConfig = undefined;
  try {
    const workspace = await loadWorkspace(projectDir);
    headroomConfig = workspace.config;
    const rows = await findWork(workspace.workDir, ref);
    const item = rows.find((row) => row.ref === ref) ?? rows[0] ?? null;
    if (item?.dir) cwd = item.dir;
  } catch {
    // Resolution failure is non-fatal: spawn against projectDir, plugin off.
  }

  // Resolve the binary path ONCE and reuse it for both the honest-degrade gate
  // and the spawn (avoids re-walking PATH per call). A null path is the missing
  // binary → the error control-frame, no spawn attempt, no faked success (ADR-003).
  const bin = provider.resolveBinaryPath(baseEnv);
  if (bin === null) {
    sendControl(ws, {
      type: "error",
      message: `${provider.id} CLI not found — install it or pick another provider.`,
    });
    safeClose(ws);
    return;
  }

  const args = provider.buildArgs();
  const sessionId = `${ref || "session"}:${provider.id}:${Date.now()}`;
  const env = provider.buildEnv(sessionId, baseEnv);

  // The headroom plugin's single seam ↔ runtime call (ADR-003). It runs AFTER the
  // provider gate (a missing PROVIDER fires the error frame above and never reaches
  // here) and BEFORE spawn: a pure decoration of the already-computed raw launch.
  // Plugin off / not-routable (gemini) / headroom-absent all return the raw launch
  // unchanged; enabled + routable + headroom on PATH returns the wrapped launch.
  // The injected `which` is the same PATH lookup the provider seam uses.
  const launch = resolveHeadroomLaunch({
    providerId: provider.id,
    config: headroomConfig,
    rawBin: bin,
    rawArgs: args,
    env: baseEnv,
    which,
  });

  let term;
  try {
    term = await spawn(launch.bin, launch.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env,
    });
  } catch (error) {
    // pty.spawn threw (binary vanished between check and spawn, exec denied, …):
    // still the dock error state, never an unguarded crash (ADR-003).
    sendControl(ws, {
      type: "error",
      message: `${provider.id} CLI failed to start: ${error?.message ?? "spawn failed"}.`,
    });
    safeClose(ws);
    return;
  }

  // Log the spawned PTY pid to the board server's stdout so a running session is
  // traceable from the host (e.g. to inspect or `taskkill` it). A live PTY can't
  // be migrated into a native terminal, so the pid is the handle to it.
  try {
    console.log(`terminal: ${provider.id} started · pid=${term?.pid ?? "?"} · ref=${ref || "-"} · cwd=${cwd}`);
  } catch {
    /* logging must never break the session */
  }

  // Persist the running session to .aof/terminal-sessions.json (best-effort, when
  // enabled) so the live PTY is traceable from the host; dropped again when it ends.
  if (recordSessions) {
    void registerSession(projectDir, { pid: term?.pid, ref, provider: provider.id, cwd });
  }

  wireSession(ws, term, recordSessions ? () => void unregisterSession(projectDir, term?.pid) : undefined);
}

// Wire the PTY ↔ WebSocket per the frozen envelope. All PTY mutations
// (write/resize/kill) are try/catch-guarded — the win32 "already-exited" guard
// carried from vibeyard.
function wireSession(ws, term, onEnd = () => {}) {
  // Run the end hook (unregister the session) at most once, on exit OR close.
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    try {
      onEnd();
    } catch {
      /* the end hook must never throw into the session */
    }
  };

  // PTY → client: raw frames.
  const dataSub = term.onData((data) => {
    try {
      ws.send(data);
    } catch {
      // socket already closing
    }
  });

  // PTY exit → client: the {type:'exit', exitCode} control-frame.
  const exitSub = term.onExit(({ exitCode }) => {
    sendControl(ws, { type: "exit", exitCode });
    safeClose(ws);
    end();
  });

  // client → server.
  ws.on("message", (data, isBinary) => {
    // A JSON object is a control message; anything else is raw input bytes.
    const control = !isBinary && parseControl(data);
    if (control && control.type === "resize") {
      try {
        term.resize(toCols(control.cols), toRows(control.rows));
      } catch {
        // already-exited guard (win32)
      }
      return;
    }
    try {
      term.write(isBinary ? data : data.toString());
    } catch {
      // already-exited guard (win32)
    }
  });

  ws.on("close", () => {
    try {
      dataSub?.dispose?.();
      exitSub?.dispose?.();
    } catch {
      /* no-op */
    }
    try {
      term.kill();
    } catch {
      // already-exited guard (win32)
    }
    end();
  });
}

// --- helpers -----------------------------------------------------------------

function parseQuery(url) {
  try {
    return new URL(url ?? "/", "ws://127.0.0.1").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function parseControl(data) {
  const text = data?.toString?.() ?? "";
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function sendControl(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // socket closed/closing — nothing to send
  }
}

function safeClose(ws) {
  try {
    ws.close();
  } catch {
    /* already closed */
  }
}

function toCols(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 80;
}

function toRows(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

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
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { loadWorkspace } from "./work.mjs";
// The SAME folder-trust pre-write the mesh worker's spawn uses (a leaf module, so this
// never reaches back into mesh-worker-execution.mjs — which imports THIS file).
import { ensureWorktreeTrusted } from "./claude-trust.mjs";
import { resolveProvider, PROVIDER_IDS } from "./terminal-providers.mjs";
import { registerSession, unregisterSession } from "./terminal-sessions.mjs";
import { resolveHeadroomLaunch } from "./headroom.mjs";
// milestone 28 / story 00 (ADR-002): the SEA sentinel this module's node-pty
// re-home branches on — the SAME sentinel src/asset-base.mjs's assetBase()
// keys on, so a test flips ONE seam and both the asset base AND the node-pty
// loader branch move in lock-step.
import { isPackaged } from "./asset-base.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// The single terminal pathname (ADR-001). Any other upgrade pathname is destroyed.
const TERMINAL_PATH = "/ws/terminal";

// The node-pty LOADER — separated from defaultSpawn so an @executable test can
// inject a stub loader (resolves / throws) and assert WHICH branch ran, with no
// built binary and no real node-pty (the Build-notes developer-seat guidance).
// Real behaviour, exactly as before the split:
//   - SEA (isPackaged() true): createRequire(process.execPath)("node-pty") —
//     a filesystem require resolved against the on-disk sidecar the build
//     recipe ships beside the binary (a raw `await import("node-pty")` THROWS
//     for an FS module inside a SEA main — RESEARCH §1/§2).
//   - dev (isPackaged() false): the EXISTING `await import("node-pty")`,
//     byte-for-byte unchanged.
// Exported (F12 craft-review) so an @executable test can drive the REAL
// branch-selection logic directly — flipping isPackaged() via
// setSeaSentinelForTest and observing WHICH mechanism was actually attempted
// (its distinct failure/success signature in a dev environment), rather than
// only asserting on the source text. This does not change production
// behaviour: defaultSpawn (below) still calls this exact function.
export function loadNodePty() {
  return isPackaged() ? createRequire(process.execPath)("node-pty") : import("node-pty");
}

// The default PTY spawner: loads node-pty INSIDE the call (via the injectable
// ptyLoader) so that importing this module never requires the native addon at
// load time (CI tests inject a stub spawn; only a real session touches
// node-pty). Returns the node-pty process handle.
//
// The load stays INSIDE this function, never hoisted to a top-level import
// (fitness #3 — a missing/unloadable sidecar must never crash startup;
// importing terminal-ws.mjs must never need the addon).
async function defaultSpawn(bin, args, options) {
  const pty = await loadNodePty();
  return pty.spawn(bin, args, options);
}

// A defaultSpawn FACTORY, parameterised on the ptyLoader — the injectable seam
// an @executable test uses to model "sidecar resolves" / "ENOENT" / "throws on
// require" / "wrong-arch dlopen failure" / "missing Windows companion" without
// a built binary and without a real node-pty (mirrors the isPackaged/
// setSeaSentinelForTest injection shape in src/asset-base.mjs). The real
// defaultSpawn above is EXACTLY createTerminalSpawn(loadNodePty)'s behaviour —
// this factory does not change the production default, it only exposes the
// same shape for a test-supplied loader.
export function createTerminalSpawn(ptyLoader) {
  return async function spawnWithLoader(bin, args, options) {
    const pty = await ptyLoader();
    return pty.spawn(bin, args, options);
  };
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
  // trustCwd(cwd) — the claude folder-trust pre-write. DEFAULT NO-OP on purpose: the
  // real writer touches the operator's own ~/.claude.json, and a test that stands up
  // this server and opens a terminal would write real entries for its temp fixture
  // dirs. So the real one is wired ONLY at the production call site (board-serve.mjs's
  // serveBoard — the same "literal key at the production call site" discipline the mesh
  // launcher uses for its own trustWorktree seam). No test run can touch that file by
  // construction, rather than by every fixture remembering to stub it.
  const trustCwd = options.trustCwd ?? (() => {});

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
    handleConnection(ws, request, { projectDir, spawn, baseEnv, which, recordSessions, trustCwd }).catch((error) => {
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
async function handleConnection(ws, request, { projectDir, spawn, baseEnv, which, recordSessions, trustCwd }) {
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

  // The PTY cwd is the PROJECT ROOT — never the item's own wiki/work folder
  // (2026-07-26). An agent asked to build an item works on the REPO: source, tests,
  // config all live above the work folder, and a session rooted inside
  // `wiki/work/<NN>_<type>_<slug>/` starts every run outside the code it is there to
  // change. It also made claude's one-time folder-TRUST dialog unavoidable — trust is
  // keyed on the exact absolute cwd, so a per-item cwd is a NEW untrusted folder for
  // every item, forever (the mesh worker path has never had this problem: it spawns at
  // the worktree ROOT). The ref still reaches the agent as the typed slash-command.
  //
  // The workspace config is still resolved here for the headroom resolver (ADR-003):
  // it is left undefined on the catch path, so a config resolution failure is treated
  // as plugin-off and never breaks the terminal.
  const cwd = projectDir;
  let headroomConfig = undefined;
  try {
    const workspace = await loadWorkspace(projectDir);
    headroomConfig = workspace.config;
  } catch (error) {
    // Non-fatal (the session still spawns, headroom off) but NOT silent — a config
    // that won't load silently changes how the agent is launched.
    console.error(`terminal: workspace config did not load for ${projectDir}, headroom disabled: ${error?.message ?? error}`);
  }
  // Pre-clear claude's one-time folder-trust dialog for THIS cwd — the SAME seam the
  // mesh worker's spawn already uses, never a second trust-writing rule. INJECTED
  // (`trustCwd`) for the same reason the launcher injects it: the real one writes the
  // operator's actual ~/.claude.json, which no test run may ever touch — the test
  // fixture passes a no-op. Best-effort: a fault here must never block the spawn.
  try {
    await trustCwd(cwd);
  } catch (error) {
    // NOT SILENT. Best-effort means "does not take the terminal down", never "fails
    // invisibly": if this throws, the very next thing the operator sees is claude's
    // blocking trust dialog with no explanation of why it came back. Reported on the
    // board server's stdout, beside the spawn line below.
    console.error(`terminal: folder-trust pre-write failed for cwd=${cwd}: ${error?.message ?? error}`);
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
  } catch (error) {
    /* logging must never break the session */
      reportDegrade("terminal-ws", error); }

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
    } catch (error) {
      /* the end hook must never throw into the session */
      reportDegrade("terminal-ws", error); }
  };

  // PTY → client: raw frames.
  const dataSub = term.onData((data) => {
    try {
      ws.send(data);
    } catch (error) {
      // socket already closing
      reportDegrade("terminal-ws", error); }
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
      } catch (error) {
        // already-exited guard (win32)
      reportDegrade("terminal-ws", error); }
      return;
    }
    try {
      term.write(isBinary ? data : data.toString());
    } catch (error) {
      // already-exited guard (win32)
      reportDegrade("terminal-ws", error); }
  });

  ws.on("close", () => {
    try {
      dataSub?.dispose?.();
      exitSub?.dispose?.();
    } catch (error) {
      /* no-op */
      reportDegrade("terminal-ws", error); }
    try {
      term.kill();
    } catch (error) {
      // already-exited guard (win32)
      reportDegrade("terminal-ws", error); }
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
  } catch (error) {
    // socket closed/closing — nothing to send
      reportDegrade("terminal-ws", error); }
}

function safeClose(ws) {
  try {
    ws.close();
  } catch (error) {
    /* already closed */
      reportDegrade("terminal-ws", error); }
}

function toCols(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 80;
}

function toRows(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

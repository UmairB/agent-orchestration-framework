// The `aof mesh ui` fleet serve-face — the read-only "fleet mission-control" web
// surface (milestone 25 / story 02; ARCHITECTURE ADR-003/ADR-004). A SIBLING to
// `board-serve.mjs`, NOT an extension of the work UI: it stands up its OWN single
// `http.createServer` bound to `127.0.0.1`, serving the BUILT `ui/dist` bundle
// announced with `?mode=fleet` and exactly ONE API route —
// `GET /api/mesh/status` → `invoke("mesh:status", …)` through the command registry.
//
// It is deliberately NOT `serveSetupUi` (the board's server): that server
// unconditionally wires `handleWorkApi` (a `/api/work` surface) AND
// `attachTerminalWebSocket` (a `/ws/terminal` upgrade), both of which this face
// FORBIDS (ADR-004 read-only; ADR-003 disjoint `/api/mesh` namespace). So the
// fleet face owns its own thin server whose surface is exactly: the static
// bundle, `GET /api/mesh/status`, and a clean not-found for everything else.
//
// The isolation guarantees are STRUCTURAL:
//   - it imports NO fleet-data/operation module except `./command-core.mjs`
//     (the ONE registry door — 08/ADR-004 inv.3, mirrored by
//     acd-mesh-ui-no-core-import / acd-mesh-ui-single-data-command);
//   - it stands up exactly ONE `http.createServer` bound to `127.0.0.1`, routing
//     the fleet under `/api/mesh*` and NEVER `/api/work*`
//     (acd-mesh-ui-single-server);
//   - it performs ZERO fs write and NO shell-out; it serves no `/ws/terminal` and
//     no write route (acd-mesh-ui-write-isolation + ADR-004 read-only).
//
// Original aof code (the board-serve.mjs sibling) — no attribution needed.
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invoke, loadWorkspace } from "./command-core.mjs";

// The default fleet port (task 00, DEV flag): 4181 — the next free port directly
// above the board (4180), distinct from all of assets-ui 4177/4178 + board 4180
// so an operator legitimately runs the fleet view ON TOP of a board at once.
export const DEFAULT_MESH_UI_PORT = 4181;

// The built fleet bundle lives in the SAME ui/dist the board serves (the single
// bundle carries every `?mode`); the fleet mode is selected by the `?mode=fleet`
// query, not a separate build (task 00 DEV note; ADR-003 decision 4).
export function meshUiDist(repoRoot) {
  return path.join(repoRoot, "ui", "dist");
}

export async function serveMeshUi({ projectDir = process.cwd(), port = DEFAULT_MESH_UI_PORT, repoRoot } = {}) {
  const resolvedRepoRoot = repoRoot
    ? path.resolve(repoRoot)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dist = meshUiDist(resolvedRepoRoot);

  // The board's friendly build-missing refusal, mirrored verbatim onto the fleet
  // verb (task 00): a missing ui/dist is a caught { code:"ui-build-missing" }
  // refusal, never a stack trace. (The message keeps the board's literal — the
  // build command is the same `npm --prefix ui run build`.)
  if (!existsSync(path.join(dist, "index.html"))) {
    const error = new Error(
      `The fleet UI build is missing at ${dist}. Build it first: npm --prefix ui run build`
    );
    error.code = "ui-build-missing";
    throw error;
  }

  const resolvedProjectDir = path.resolve(projectDir);

  const server = http.createServer(async (request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendApiError(response, 400, "Invalid request URL.", "invalid-url");
      return;
    }
    const pathname = requestUrl.pathname;

    // The ONE fleet route: GET /api/mesh/status → invoke("mesh:status") through
    // the registry door (ADR-002/ADR-003). Its payload deep-equals the CLI
    // `aof mesh status --json` for the same fixture (one command, two faces).
    if (pathname === "/api/mesh/status") {
      // Read-only: only GET is answered. A write method (POST/PUT/PATCH/DELETE)
      // is a clean 405 method-rejection — there is no mutating route on this face
      // (ADR-004; task 05). GET/HEAD are the safe methods; a HEAD falls through
      // to the same read.
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendMethodNotAllowed(response);
        return;
      }
      try {
        // Inside the try so a loadWorkspace/invoke throw lands in the catch (a
        // JSON error envelope, status ?? 500), never escaping the handler.
        const workspace = await loadWorkspace(resolvedProjectDir);
        const result = await invoke("mesh:status", {}, { workspace });
        sendJson(response, 200, result);
      } catch (error) {
        sendApiError(response, error.status ?? 500, error.message, error.code ?? "mesh-api-failed");
      }
      return;
    }

    // Any other /api/* path — including the board's frozen /api/work namespace —
    // is a clean not-found on this DISJOINT fleet face (ADR-003): the fleet view
    // owns /api/mesh and proxies no board (task 00: a /api/work request is a 404,
    // never a proxied board). Mirrors board-ui.mjs's { ok:false, error, code }
    // not-found envelope.
    if (pathname.startsWith("/api/")) {
      sendApiError(response, 404, "Mesh API route not found.", "not-found");
      return;
    }

    // Everything else is the static bundle (the built ui/dist). A missing asset
    // is a friendly 404, never a crash.
    const filePath = safeStaticPath(dist, pathname);
    if (!filePath) {
      sendApiError(response, 404, "Mesh API route not found.", "not-found");
      return;
    }
    readFile(filePath)
      .then((content) => {
        send(response, 200, contentType(filePath), content);
      })
      .catch(() => {
        // A missing static file falls back to index.html (the SPA entry) so a
        // deep link renders; a missing index is the friendly not-found envelope.
        readFile(path.join(dist, "index.html"))
          .then((index) => send(response, 200, "text/html", index))
          .catch(() => sendApiError(response, 404, "Mesh API route not found.", "not-found"));
      });
  });

  // Read-only: the fleet face serves NO /ws/terminal (and no WebSocket upgrade at
  // all — ADR-004; task 05). Refuse every upgrade cleanly (destroy the socket) so
  // an operator's muscle-memory /ws/terminal attempt is a clean refusal, never a
  // hang and never a terminal session. (There is NO WebSocketServer here — the
  // board's per-item terminal is one level down, in aof work ui.)
  server.on("upgrade", (_request, socket) => {
    try {
      socket.destroy();
    } catch {
      /* the socket may already be closed — refusing an upgrade never crashes */
    }
  });

  // Reject (don't hang) when the port can't be bound — e.g. EADDRINUSE — so the
  // CLI verb can degrade honestly (the setup-ui.mjs listen-or-reject idiom).
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  // `url` ends with "/", so this yields e.g. http://127.0.0.1:PORT/?mode=fleet —
  // the same single bundle, the fleet mode (task 00 DEV note; ADR-003 decision 4).
  const fleetUrl = `${url}?mode=fleet`;
  return { server, url, fleetUrl };
}

// --- local response helpers (mirror board-ui.mjs / setup-ui.mjs; not shared) ---

function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

function sendApiError(response, status, message, code) {
  sendJson(response, status, { ok: false, error: message, code });
}

// A write method on the one read route is a clean method-rejection (ADR-004; task
// 05) — the { ok:false, error, code } envelope with a 405 + Allow header, never a
// crash and never a state change.
function sendMethodNotAllowed(response) {
  response.writeHead(405, { "content-type": "application/json", allow: "GET, HEAD" });
  response.end(JSON.stringify({ ok: false, error: "Method not allowed. The fleet view is read-only.", code: "method-not-allowed" }));
}

function send(response, status, contentTypeValue, body) {
  response.writeHead(status, { "content-type": contentTypeValue });
  response.end(body);
}

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

// The static-path guard (setup-ui.mjs's safeStaticPath, mirrored): map a pathname
// to a file INSIDE the served root, refusing traversal (an absolute or escaping
// path returns null → not-found).
function safeStaticPath(uiRoot, pathname) {
  let relativePath;
  try {
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (path.isAbsolute(relativePath)) return null;
  const filePath = path.resolve(uiRoot, relativePath);
  const root = path.resolve(uiRoot);
  return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

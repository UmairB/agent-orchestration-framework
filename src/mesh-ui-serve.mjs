// The `aof mesh ui` fleet serve-face — the "fleet mission-control" web surface
// (milestone 25 / story 02; ARCHITECTURE ADR-003/ADR-004). A SIBLING to
// `board-serve.mjs`, NOT an extension of the work UI: it stands up its OWN single
// `http.createServer` bound to `127.0.0.1`, serving the BUILT `ui/dist` bundle
// announced with `?mode=fleet` and its `/api/mesh` routes —
// `GET /api/mesh/status` → `invoke("mesh:status", …)` and (milestone 27 / story
// 02, ADR-006) `POST /api/mesh/issue` → `invoke("mesh:issue", …)` — through the
// command registry.
//
// It is deliberately NOT `serveSetupUi` (the board's server): that server
// unconditionally wires `handleWorkApi` (a `/api/work` surface) AND
// `attachTerminalWebSocket` (a `/ws/terminal` upgrade), both of which this face
// FORBIDS (ADR-004; ADR-003 disjoint `/api/mesh` namespace). So the fleet face
// owns its own thin server whose surface is exactly: the static bundle,
// `GET /api/mesh/status`, `POST /api/mesh/issue`, and a clean not-found for
// everything else.
//
// The isolation guarantees are STRUCTURAL:
//   - it imports NO fleet-data/operation module except `./command-core.mjs`
//     (the ONE registry door — 08/ADR-004 inv.3, mirrored by
//     acd-mesh-ui-no-core-import / acd-mesh-ui-single-data-command); the write
//     route reaches its mutation the SAME way — never a direct `mesh-issuance`
//     import (27/ADR-006.1);
//   - it stands up exactly ONE `http.createServer` bound to `127.0.0.1`, routing
//     the fleet under `/api/mesh*` and NEVER `/api/work*`
//     (acd-mesh-ui-single-server);
//   - it performs ZERO fs write and NO shell-out of its own; it serves no
//     `/ws/terminal`; the ONLY mutation route is `POST /api/mesh/issue`, reached
//     ONLY via `invoke("mesh:issue")` (the BOUNDED-WRITE flip,
//     acd-mesh-ui-write-isolation, 27/ADR-006.2) — no other write route exists.
//   - the write route is guarded BEFORE the mutation by a same-origin +
//     application/json check (SECURITY T1 / fitness S-1, 27/ADR-006).
//
// milestone 28 / story 00 (ADR-003): the default ui/dist location routes
// through the ONE SEA-safe asset-base seam instead of joining a path off a bare
// import.meta.url — dev behaviour is byte-for-byte unchanged (a caller-supplied
// repoRoot still wins, exactly as before; only the DEFAULT resolution changes
// carrier). A packaged binary reads the sidecar ui/dist tree instead.
//
// Original aof code (the board-serve.mjs sibling) — no attribution needed.
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { invoke, loadWorkspace } from "./command-core.mjs";
import { assetPath } from "./asset-base.mjs";

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
  const dist = repoRoot ? meshUiDist(path.resolve(repoRoot)) : assetPath("ui", "dist");

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

    // The ONE fleet READ route: GET /api/mesh/status → invoke("mesh:status")
    // through the registry door (ADR-002/ADR-003). Its payload deep-equals the
    // CLI `aof mesh status --json` for the same fixture (one command, two faces).
    if (pathname === "/api/mesh/status") {
      // Read-only: only GET is answered. A write method (POST/PUT/PATCH/DELETE)
      // is a clean 405 method-rejection — there is no mutating route on THIS
      // path (ADR-004; task 05). GET/HEAD are the safe methods; a HEAD falls
      // through to the same read.
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendMethodNotAllowed(response, "GET, HEAD");
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

    // milestone 27 / story 02 (ADR-006) — the FIRST write route on the fleet
    // face: POST /api/mesh/issue → invoke("mesh:issue") through the ONE registry
    // door (never a direct `mesh-issuance` import — acd-mesh-ui-no-core-import
    // stays green; the bounded-write flip, acd-mesh-ui-write-isolation #7).
    if (pathname === "/api/mesh/issue") {
      // Read-only-except-issue: only POST is answered on this route. PUT/PATCH/
      // DELETE are a clean 405 (task 00/03's method matrix) — the write door
      // opened for exactly this ONE method on this ONE route.
      if (request.method !== "POST") {
        sendMethodNotAllowed(response, "POST");
        return;
      }

      // (1) SAME-ORIGIN + CONTENT-TYPE GUARD — BEFORE any body read or invoke
      // (SECURITY T1 / fitness S-1). A refused request never reaches the body
      // parser, let alone the mutation — the disk stays byte-unchanged.
      const origin = request.headers.origin;
      const boundPort = server.address().port;
      // BOTH loopback spellings are legitimate same-origin (SECURITY.md S-1
      // names http://127.0.0.1:<port> AND http://localhost:<port> as the
      // loopback origin — review fix / architect NIT-1): a browser tab open at
      // either address is the SAME operator on the SAME loopback boundary, so
      // accepting either is fail-safe (no security downside — a foreign origin
      // still matches neither and is still refused).
      const loopbackOrigins = new Set([`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`]);
      if (origin && !loopbackOrigins.has(origin)) {
        sendApiError(response, 403, "Cross-origin request refused.", "forbidden");
        return;
      }
      if (!/application\/json/i.test(request.headers["content-type"] ?? "")) {
        sendApiError(response, 403, "content-type: application/json required.", "forbidden");
        return;
      }

      // (2) BODY READ — the board's readJsonBody transport reader, mirrored
      // (empty-json / malformed-json are transport concerns, stay in the face —
      // src/board-ui.mjs:192-216).
      try {
        const body = await readJsonBody(request);
        const workspace = await loadWorkspace(resolvedProjectDir);
        // The wire sentinel for "untargeted" (the picker's "Any node" default,
        // ADR-002.3/ADR-003 "absent ⇒ { kind:"any" }") is the literal string
        // "any" — but its disambiguation is NOT a route-layer concern (review
        // fix: the route used to normalize "any" ⇒ undefined here, which meant
        // the CLI face — `aof mesh issue <ref> --to any`, which reaches
        // resolveTarget with the token still "any" — disagreed with this route
        // on what "any" means. `body.to` now rides through UNCHANGED; mesh:
        // issue's own resolveTarget is the ONE place that disambiguates "any"
        // (case-insensitive, trimmed) into { kind:"any" }, so both faces agree.
        const result = await invoke("mesh:issue", { ref: body.ref, to: body.to }, { workspace });
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

// A write method on a route that does not accept it is a clean method-rejection
// (ADR-004; task 05; milestone 27 story 02 task 00 — the per-route Allow header)
// — the { ok:false, error, code } envelope with a 405 + an Allow header naming
// THIS route's own allowed methods, never a crash and never a state change.
// `/api/mesh/status` advertises "GET, HEAD"; `/api/mesh/issue` advertises "POST".
function sendMethodNotAllowed(response, allowed = "GET, HEAD") {
  response.writeHead(405, { "content-type": "application/json", allow: allowed });
  response.end(JSON.stringify({ ok: false, error: "Method not allowed.", code: "method-not-allowed" }));
}

// milestone 27 / story 02 — the HTTP-body transport reader for the write route,
// mirroring board-ui.mjs's readJsonBody verbatim (src/board-ui.mjs:192-216): its
// payload-too-large / empty-json / malformed-json errors are transport concerns
// that stay in the face, never operation logic.
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 1_000_000) tooLarge = true;
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(httpError("Request body is too large.", "payload-too-large", 413));
        return;
      }
      if (body.trim() === "") {
        reject(httpError("Request body must be JSON.", "empty-json", 400));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(httpError(`Malformed JSON: ${error.message}`, "malformed-json", 400));
      }
    });
    request.on("error", reject);
  });
}

function httpError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
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

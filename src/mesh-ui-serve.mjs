// The `aof mesh ui` fleet serve-face — the "fleet mission-control" web surface
// (milestone 25 / story 02; ARCHITECTURE ADR-003/ADR-004). A SIBLING to
// `board-serve.mjs`, NOT an extension of the work UI: it stands up its OWN single
// `http.createServer` bound to `127.0.0.1`, serving the BUILT `ui/dist` bundle
// announced with `?mode=fleet` and its `/api/mesh` route: `GET /api/mesh/status`.
//
// milestone 34 / story 03 (34/ADR-006) — `GET /api/mesh/status` now DEFAULTS to
// the machine-wide GLOBAL projection (via `queryGlobalMeshStatus`,
// ./global-mesh-query.mjs — the ONE additional query surface this face is allowed
// to reach); `serveMeshUi({ scope: "local" })` (the CLI's `--local`) reads the
// same global projection narrowed to the current workspace id, and a globally-
// started server still honours a `?scope=local` deep-link
// by narrowing the SAME global query to the current workspace id. The face stays
// thin either way: it never opens the SQLite projection itself and never imports
// global-work-store.mjs/global-node-registry.mjs directly — only the one
// composition seam.
//
// It is deliberately NOT `serveSetupUi` (the board's server): that server
// unconditionally wires `handleWorkApi` (a `/api/work` surface) AND
// `attachTerminalWebSocket` (a `/ws/terminal` upgrade), both of which this face
// FORBIDS (ADR-004; ADR-003 disjoint `/api/mesh` namespace). So the fleet face
// owns its own thin server whose surface is exactly: the static bundle,
// `GET /api/mesh/status`, and a clean not-found for
// everything else.
//
// The isolation guarantees are STRUCTURAL:
//   - it imports the single global query surface only, not low-level work/run/mesh
//     writers;
//   - it stands up exactly ONE `http.createServer` bound to `127.0.0.1`, routing
//     the fleet under `/api/mesh*` and NEVER `/api/work*`;
//   - it performs ZERO fs write and NO shell-out of its own; it serves no
//     `/ws/terminal`; there is no fleet mutation route.
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
import { assetPath } from "./asset-base.mjs";
// milestone 34 / story 03 (ADR-006) — the ONE global query surface this thin serve
// face is allowed to reach for its GLOBAL `/api/mesh/status` read. `queryGlobalMeshStatus`
// is itself the composition seam (it owns the SQLite open + the story 00/02 query
// calls); this face never opens the projection store or imports the low-level
// global-work-store/global-node-registry modules directly (ADR-006 "must not import
// low-level work/run/mesh writers; it talks to a query surface").
import { queryGlobalMeshStatus, workspaceIdForProjectRoot } from "./global-mesh-query.mjs";

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

// milestone 34 / story 03 (ADR-006) — `scope` selects the default `/api/mesh/status`
// data source: both "global" (the default) and "local" read the machine-wide
// projection via queryGlobalMeshStatus; local scope narrows work items to the
// current workspace id. Either scope still honours a `?scope=` query override per
// request (task 01) — the STARTED scope only decides the DEFAULT when the query
// string is silent.
const VALID_SCOPES = new Set(["global", "local"]);

export async function serveMeshUi({
  projectDir = process.cwd(),
  port = DEFAULT_MESH_UI_PORT,
  repoRoot,
  scope = "global",
  globalStoreOptions,
} = {}) {
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

    // The ONE fleet READ route: GET /api/mesh/status. milestone 34 / story 03
    // (ADR-006) — the DATA SOURCE branches on scope, and the MECHANISM depends on
    // how "local" was reached (task 01's two distinct local paths):
    //   - a server STARTED with scope:"local" (serveMeshUi({ scope:"local" }))
    //     narrows the global projection to the current workspace id.
    //   - a server STARTED with scope:"global" answers the machine-wide
    //     queryGlobalMeshStatus read by default (task 01 scenario 1); an explicit
    //     `?scope=local` deep-link on THIS server narrows the SAME global
    //     projection query to the current workspace id.
    // Any OTHER ?scope= value is a clean 400 invalid-scope BEFORE any query or
    // workspace command runs (task 01 scenario 4).
    if (pathname === "/api/mesh/status") {
      // Read-only: only GET is answered. A write method (POST/PUT/PATCH/DELETE)
      // is a clean 405 method-rejection — there is no mutating route on THIS
      // path (ADR-004; task 05). GET/HEAD are the safe methods; a HEAD falls
      // through to the same read.
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendMethodNotAllowed(response, "GET, HEAD");
        return;
      }
      const requestedScope = requestUrl.searchParams.get("scope");
      if (requestedScope != null && !VALID_SCOPES.has(requestedScope)) {
        sendApiError(response, 400, `Unsupported scope "${requestedScope}".`, "invalid-scope");
        return;
      }

      try {
        // 34/story 03 — mesh state is machine-wide GLOBAL, so there is ONE data source:
        // queryGlobalMeshStatus. `local` is NOT a different source — it is the SAME global
        // view with the WORK ITEMS filtered to the current repo's workspace id; the NODE
        // roster stays machine-wide either way (nodes are a machine fact, not per-repo).
        // A server STARTED with --local always scopes to its own workspace; a globally-
        // started server honours a ?scope=local deep-link the same way.
        const effectiveScope = scope === "local" ? "local" : (requestedScope ?? "global");
        const workspaceId = effectiveScope === "local" ? workspaceIdForProjectRoot(resolvedProjectDir) : null;
        const result = await queryGlobalMeshStatus({ ...globalStoreOptions, workspaceId });
        const body = { ...result, scope: effectiveScope };
        if (effectiveScope === "local") body.currentWorkspace = resolvedProjectDir;
        sendJson(response, 200, body);
      } catch (error) {
        // review fix P0.5: a globalStoreError (global-mesh-query.mjs) carries the
        // global mesh database `path` on the error object — thread it into the
        // response body when present (task 03 scenario 2: "the response body
        // contains path <the global mesh path>"), never just { ok, error, code }.
        sendApiError(response, error.status ?? 500, error.message, error.code ?? "mesh-api-failed", { path: error.path ?? null });
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

// review fix P0.5: an OPTIONAL 5th `extra` object merges additional coded-error
// fields into the response body (today: `path`, when the thrown error carries
// one) — every pre-existing 4-arg call site is byte-unchanged (extra defaults to
// {}, so `path` resolves to `undefined`, and JSON.stringify OMITS an `undefined`
// value entirely — the exact pre-existing { ok, error, code } shape survives
// byte-for-byte for every caller that never opts in).
function sendApiError(response, status, message, code, extra = {}) {
  const path = extra?.path ?? undefined;
  sendJson(response, status, { ok: false, error: message, code, path });
}

// A write method on a route that does not accept it is a clean method-rejection
// (ADR-004; task 05; milestone 27 story 02 task 00 — the per-route Allow header)
// — the { ok:false, error, code } envelope with a 405 + an Allow header naming
// THIS route's own allowed methods, never a crash and never a state change.
// `/api/mesh/status` advertises "GET, HEAD".
function sendMethodNotAllowed(response, allowed = "GET, HEAD") {
  response.writeHead(405, { "content-type": "application/json", allow: allowed });
  response.end(JSON.stringify({ ok: false, error: "Method not allowed.", code: "method-not-allowed" }));
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

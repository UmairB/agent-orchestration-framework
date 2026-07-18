// The `aof mesh ui` fleet serve-face — the "fleet mission-control" web surface
// (milestone 25 / story 02; ARCHITECTURE ADR-003/ADR-004). A SIBLING to
// `board-serve.mjs`, NOT an extension of the work UI: it stands up its OWN single
// `http.createServer` bound to `127.0.0.1`, serving the BUILT `ui/dist` bundle
// announced with `?mode=fleet`, its `/api/mesh/status` read route, and its board drill-in URL route.
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
// GET /api/mesh/status, GET /api/mesh/board-url, POST /api/mesh/assign (the
// ONE mutation carve-out, below), and a clean not-found for everything else.
//
// milestone 38 / story 04 (ADR-012) — the face gains its FIRST live write
// route: POST /api/mesh/assign wraps the EXISTING `assignWork` verb VERBATIM
// (`./commands/mesh-assign.mjs`), same-origin + application/json admitted
// (SECURITY T13), re-running every one of the verb's own gates — no second
// arbitration, no bespoke uniqueness/repo check. This is the SOLE, deliberate,
// documented exception to the isolation guarantees below.
//
// The isolation guarantees are otherwise STRUCTURAL:
//   - it imports the single global query surface plus the board launcher, not
//     low-level work/run/mesh writers — PLUS the one `assignWork` verb door;
//   - it stands up exactly ONE `http.createServer` bound to `127.0.0.1`, routing
//     the fleet under `/api/mesh*` and NEVER `/api/work*`;
//   - it performs ZERO fs write and NO shell-out of its own (the ONE mutation
//     rides entirely inside `assignWork`'s own gated store write); it serves no
//     `/ws/terminal`; every OTHER route/method stays read-only.
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
import { serveBoard } from "./board-serve.mjs";
// milestone 34 / story 03 (ADR-006) — the ONE global query surface this thin serve
// face is allowed to reach for its GLOBAL `/api/mesh/status` read. `queryGlobalMeshStatus`
// is itself the composition seam (it owns the SQLite open + the story 00/02 query
// calls); this face never opens the projection store or imports the low-level
// global-work-store/global-node-registry modules directly (ADR-006 "must not import
// low-level work/run/mesh writers; it talks to a query surface").
import { queryGlobalMeshStatus, workspaceIdForProjectRoot } from "./global-mesh-query.mjs";
// milestone 38 / story 04 (ADR-012) — the fleet face's FIRST live write route. Two
// imports, both DELIBERATE and narrow: `loadWorkspace` (the standard workspace
// object every CLI verb loads, `./work.mjs`) resolves the { workDir, config,
// projectRoot } the verb needs; `assignWork` (`./commands/mesh-assign.mjs`) is the
// COMPLETE, ALREADY-GATED verb wrapped VERBATIM — no arbitration is reimplemented
// here, and no OTHER commands module, mesh-store/presence/registry/sync module, or
// global-work-store/global-node-registry module is imported (ADR-012 inv.2/4).
import { loadWorkspace } from "./work.mjs";
import { assignWork } from "./commands/mesh-assign.mjs";

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
  const boardServers = new Map();

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

    // A drill-in from the global milestone cards opens the real per-workspace
    // board server. This keeps /api/work off the fleet face: the browser navigates
    // away to that board origin instead of asking this server to proxy board data.
    if (pathname === "/api/mesh/board-url") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendMethodNotAllowed(response, "GET, HEAD");
        return;
      }
      const workspaceId = (requestUrl.searchParams.get("workspaceId") ?? "").trim();
      const ref = (requestUrl.searchParams.get("ref") ?? "").trim();
      if (!workspaceId) {
        sendApiError(response, 400, "workspaceId is required.", "invalid-workspace");
        return;
      }

      try {
        const status = await queryGlobalMeshStatus({ ...globalStoreOptions });
        const workspace = (status.workspaces ?? []).find((candidate) => candidate.workspaceId === workspaceId);
        if (!workspace) {
          sendApiError(response, 404, `Workspace "${workspaceId}" is not in the mesh projection.`, "workspace-not-found");
          return;
        }
        const url = await boardUrlForWorkspace(boardServers, workspace, { repoRoot, ref });
        sendJson(response, 200, { url, workspaceId, ref: ref || null });
      } catch (error) {
        sendApiError(response, error.status ?? 500, error.message, error.code ?? "board-url-failed", { path: error.path ?? null });
      }
      return;
    }

    // milestone 38 / story 04 (ADR-012) — the fleet face's FIRST and ONLY
    // mutation route: POST /api/mesh/assign { ref, nodeId }. It wraps the
    // EXISTING assignWork(workspace, ref, nodeId, ctx) core VERBATIM — no
    // second uniqueness rule, no bespoke repo check, no arbitration of its
    // own. Every OTHER method on this path (GET/PUT/DELETE/…) is a clean 405
    // naming "POST" as the one allowed verb (the read-only-except-this-one-
    // route posture, structural invariant #1/#4).
    if (pathname === "/api/mesh/assign") {
      if (request.method !== "POST") {
        sendMethodNotAllowed(response, "POST");
        return;
      }

      // SECURITY T13 — the same-origin + application/json admission guard,
      // scoped to THIS write route only (the read routes stay unguarded — a
      // safe method has no side effect to forge). A same-origin browser
      // request's Origin ALWAYS matches this server's own `http://<host>`
      // (the exact string a same-origin `fetch` sends); a cross-site page, an
      // absent Origin (a bare/simple cross-site form-POST), or a non-JSON
      // content-type are each refused BEFORE the body is even parsed — the
      // guard runs strictly before any store read/write.
      const expectedOrigin = `http://${request.headers.host}`;
      const originHeader = request.headers.origin;
      if (typeof originHeader !== "string" || originHeader !== expectedOrigin) {
        sendApiError(response, 403, "Cross-origin write refused.", "cross-origin-refused");
        return;
      }
      const contentTypeHeader = String(request.headers["content-type"] ?? "");
      if (!/^application\/json\b/i.test(contentTypeHeader)) {
        sendApiError(response, 400, "Content-Type must be application/json.", "invalid-content-type");
        return;
      }

      let body;
      try {
        body = await readJsonBody(request);
      } catch {
        sendApiError(response, 400, "Malformed JSON body.", "invalid-body");
        return;
      }
      // ONLY { ref, nodeId } is lifted off the body and passed into the verb —
      // any other field a client posts (a forged state/assignmentId/issuer,
      // task 00 scenario 2) rides no further; the verb assembles its own
      // record shape (ADR-012 inv.2 — "adds no second uniqueness rule, no
      // bespoke repo check").
      const ref = typeof body?.ref === "string" ? body.ref.trim() : "";
      const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";
      if (!ref || !nodeId) {
        sendApiError(response, 400, "Both \"ref\" and \"nodeId\" are required.", "invalid-body");
        return;
      }

      try {
        // Loaded LAZILY, only for a request that already cleared the CSRF +
        // shape guards above — mirroring the SEA/CLI's own `loadWorkspace(cwd)`
        // per-invocation load (never cached across requests; the read routes
        // above never trigger this at all, so a GET-only test never touches a
        // workspace object it did not ask for). A malformed/absent config never
        // throws — loadWorkspace degrades to an empty config (work.mjs's own
        // contract) — findWork below just resolves nothing for it.
        const assignWorkspace = await loadWorkspace(resolvedProjectDir, undefined, { env: globalStoreOptions?.env });
        const result = await assignWork(assignWorkspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions ?? {} });
        if (!result.ok) {
          // The verb's OWN { ok:false, code } surfaces as a coded non-200 —
          // never a 200, never swallowed (ADR-012 inv.3). The HTTP NUMBER is
          // this route's own pinned mapping; the CODE (the contract) is the
          // verb's, verbatim — including any extra field it attaches
          // (`holder`/`target`), so a refusal names its cause faithfully.
          const { ok: _ok, error: message, code, ...extra } = result;
          sendApiError(response, assignGateStatus(code), message, code, extra);
          return;
        }
        sendJson(response, 200, result);
      } catch (error) {
        sendApiError(response, error.status ?? 500, error.message, error.code ?? "assign-failed", { path: error.path ?? null });
      }
      return;
    }

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

  const originalClose = server.close.bind(server);
  server.close = function closeWithBoardServers(callback) {
    return originalClose((error) => {
      closeBoardServers(boardServers).finally(() => {
        if (typeof callback === "function") callback(error);
      });
    });
  };

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

async function boardUrlForWorkspace(boardServers, workspace, { repoRoot, ref } = {}) {
  const workspaceId = workspace.workspaceId;
  let entry = boardServers.get(workspaceId);
  if (!entry) {
    const launched = await serveBoard({
      projectDir: workspace.projectRoot,
      port: 0,
      repoRoot,
      recordSessions: false,
    });
    entry = { server: launched.server, boardUrl: launched.boardUrl };
    boardServers.set(workspaceId, entry);
    launched.server.on("close", () => boardServers.delete(workspaceId));
  }
  const url = new URL(entry.boardUrl);
  if (ref) url.hash = ref;
  return url.toString();
}

async function closeBoardServers(boardServers) {
  const servers = [...boardServers.values()].map((entry) => entry.server);
  boardServers.clear();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          try {
            server.close(() => resolve());
          } catch {
            resolve();
          }
        })
    )
  );
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
//
// milestone 38 / story 04 (ADR-012) — every OTHER `extra` key (e.g. the assign
// verb's `holder`/`target`, task 01) rides through UNCHANGED, byte-for-byte —
// "the refusal names the current holder, the verb's own field, surfaced
// faithfully." `path`'s pre-existing null->omitted normalization is preserved
// exactly (destructured out first) so no pre-existing caller's shape shifts.
function sendApiError(response, status, message, code, extra = {}) {
  const { path, ...rest } = extra ?? {};
  sendJson(response, status, { ok: false, error: message, code, path: path ?? undefined, ...rest });
}

// milestone 38 / story 04 (ADR-012, BUILD-owed decision) — the assign verb's
// `{ ok:false, code }` -> HTTP status mapping. The CONTRACT is the CODE (the
// verb's own, surfaced verbatim in the body above); the NUMBER is this route's
// pinned choice: an unresolvable ref or an unknown/ineligible target reads as
// "not found" (404), a uniqueness/readiness conflict with the item's CURRENT
// state reads as "conflict" (409). Never 200 for a miss, never a code this
// table does not know (an unmapped future code still refuses, at 400).
const ASSIGN_GATE_STATUS = Object.freeze({
  "ref-not-found": 404,
  "assignment-target-unknown": 404,
  "assignment-repo-unavailable": 409,
  "assignment-already-active": 409,
});

function assignGateStatus(code) {
  return ASSIGN_GATE_STATUS[code] ?? 400;
}

// Collects + JSON-parses the request body (there is no body-parser middleware
// on this thin face — the board/setup-ui idiom, read once, parsed once). A
// caller with no body at all parses `{}` (never throws on an empty request —
// the ref/nodeId presence check above is what refuses it).
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
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

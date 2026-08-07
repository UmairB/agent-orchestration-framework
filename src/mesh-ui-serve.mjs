// The `aof mesh ui` fleet serve-face — the "fleet mission-control" web surface
// (milestone 25 / story 02; ARCHITECTURE ADR-003/ADR-004). A SIBLING to
// `board-serve.mjs`, NOT an extension of the work UI: it stands up its OWN single
// `http.createServer` bound to `127.0.0.1`, serving the BUILT `ui/dist` bundle
// announced at the fleet's own PATH (milestone 45 / ADR-002), its `/api/mesh/status` read route, and its board drill-in URL route.
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
// milestone 38 / story 04 — ADR-012 AMENDMENT (2026-07-24, BLOCKER F21): the
// write route's WIRE SHAPE is `{ ref, nodeId, workspaceId }`, all three
// REQUIRED, and it resolves the ref against the ITEM's OWN workspace (through
// the sanctioned queryGlobalMeshStatus → status.workspaces[] → projectRoot
// seam) — NEVER against `resolvedProjectDir`, this daemon's own launch dir.
// The face is GLOBAL, so resolving a per-item fact from its own local context
// mis-dispatched real work off a `200 ok` (the ADR-010 "Gap A" class).
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
// milestone 45 / story 02 (ADR-004): the THREE static-serving rules live ONCE, in a
// pure leaf, and this face re-derives none of them. `safeStaticPath` and `contentType`
// were defined here (:861-884) and again in setup-ui.mjs — the guard byte-identically,
// the MIME table already drifted (this copy was the richer one, and the merged table is
// its union, so nothing about THIS origin's MIME answers changes).
// `shouldServeAppShell` is the predicate that TIGHTENS this face's previously
// unconditional catch -> index.html fallback.
import { contentType, safeStaticPath, shouldServeAppShell } from "./static-serve.mjs";
import { serveBoard } from "./board-serve.mjs";
// milestone 34 / story 03 (ADR-006) — the ONE global query surface this thin serve
// face is allowed to reach for its GLOBAL `/api/mesh/status` read. `queryGlobalMeshStatus`
// is itself the composition seam (it owns the SQLite open + the story 00/02 query
// calls); this face never opens the projection store or imports the low-level
// global-work-store/global-node-registry modules directly (ADR-006 "must not import
// low-level work/run/mesh writers; it talks to a query surface").
import { queryGlobalMeshStatus, workspaceIdForProjectRoot } from "./global-mesh-query.mjs";
// m43 / story 04 (ADR-006) — the ONE cache-staleness window resolver. The face reads no
// threshold of its own; it resolves the configured number through the single home and hands
// it to the query surface, which states it once on the payload.
import { resolveCacheStalenessSeconds } from "./cache-provenance.mjs";
// milestone 38 / story 04 (ADR-012) — the fleet face's FIRST live write route. Two
// imports, both DELIBERATE and narrow: `loadWorkspace` (the standard workspace
// object every CLI verb loads, `./work.mjs`) resolves the { workDir, config,
// projectRoot } the verb needs; `assignWork` (`./commands/mesh-assign.mjs`) is the
// COMPLETE, ALREADY-GATED verb wrapped VERBATIM — no arbitration is reimplemented
// here, and no OTHER commands module, mesh-store/presence/registry/sync module, or
// global-work-store/global-node-registry module is imported (ADR-012 inv.2/4).
import { loadWorkspace } from "./work.mjs";
import { assignWork } from "./mesh-assignment.mjs";
// VERIFICATION (UI phase selection, 2026-07-25) — the closed-set validator for the
// optional `phase` on POST /api/mesh/assign (refine/continue/verify).
import { isAssignmentPhase } from "./mesh-assignment-directive.mjs";
// milestone 38 / story 06 (ADR-014) — the fleet face's SECOND carve-out: a
// READ-ONLY terminal-VIEW upgrade route, `GET /ws/terminal-view?nodeId=&sessionId=`.
// `WebSocketServer` (noServer) mirrors terminal-ws.mjs's / mesh-relay.mjs's own
// "one http.createServer, route the upgrade by pathname" shape (no second server).
// `createTerminalMirror` is the in-memory, ephemeral, live-tail mirror
// (src/mesh-terminal-mirror.mjs) — constructed as a LITERAL default here (never
// reachable only through a test-injection spread), so a real `aof mesh ui`
// genuinely stands up a mirror even before any relay subscriber is wired to it.
import { WebSocketServer } from "ws";
import { createTerminalMirror } from "./mesh-terminal-mirror.mjs";
// m42 "interactive worker terminals" — the INPUT direction's envelope builder. The
// terminal-view socket is tuple-bound at upgrade time; a browser message is wrapped
// with THE SOCKET'S OWN (nodeId, sessionId) — never anything read out of the
// message — so a client can only ever type into the exact session its socket was
// opened for (no cross-session injection by construction).
import { buildTerminalInputEnvelope } from "./mesh-terminal-relay-bridge.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// The default fleet port (task 00, DEV flag): 4181 — the next free port directly
// above the board (4180), distinct from all of assets-ui 4177/4178 + board 4180
// so an operator legitimately runs the fleet view ON TOP of a board at once.
export const DEFAULT_MESH_UI_PORT = 4181;

// The built fleet bundle lives in the SAME ui/dist the board serves — ONE bundle
// carrying every surface; which surface renders is decided by the PATH the operator
// is on (milestone 45 / ADR-001's route table), never by a separate build and no
// longer by a query selector (task 00 DEV note; ADR-003 decision 4).
export function meshUiDist(repoRoot) {
  return path.join(repoRoot, "ui", "dist");
}

// m42 wave (d) leg d1 (wave-3 tail) — the NON-BLOCKING probe behind the registered
// mesh:ui command's run (the launcher seam's probe rule: --json never launches). A
// pure read of "what WOULD serve": the resolved port/scope/projectDir, whether the
// built fleet bundle is present (the ui-build-missing precheck), and whether a
// relay is configured for the terminal-mirror legs (best-effort config read — a
// non-workspace cwd degrades to relayConfigured:false, the launch path's own
// posture). Lives HERE so the dist resolution keeps one home — the probe and
// serveMeshUi can never disagree about where the bundle is.
export async function meshUiProbe({ projectDir = process.cwd(), port = DEFAULT_MESH_UI_PORT, repoRoot, scope = "global", configPath } = {}) {
  const dist = repoRoot ? meshUiDist(path.resolve(repoRoot)) : assetPath("ui", "dist");
  const resolvedProjectDir = path.resolve(projectDir);
  let relayConfigured = false;
  try {
    const { config } = await loadWorkspace(resolvedProjectDir, configPath);
    relayConfigured = typeof config?.mesh?.relay?.url === "string" && config.mesh.relay.url.length > 0;
  } catch {
    relayConfigured = false;
  }
  return {
    mode: "fleet",
    scope,
    port,
    projectDir: resolvedProjectDir,
    uiDist: dist,
    uiBuildPresent: existsSync(path.join(dist, "index.html")),
    relayConfigured,
    // milestone 45 / story 04 (ADR-002) — the fleet's ADR-002 PATH, carrying the
    // scope it would serve as a REAL query parameter on that path. The legacy
    // `?mode=fleet&scope=…` form still works (ADR-003 translates it once at the
    // entry); it is simply no longer MINTED here.
    fleetUrl: `http://127.0.0.1:${port}/fleet?scope=${scope}`,
  };
}

// milestone 34 / story 03 (ADR-006) — `scope` selects the default `/api/mesh/status`
// data source: both "global" (the default) and "local" read the machine-wide
// projection via queryGlobalMeshStatus; local scope narrows work items to the
// current workspace id. Either scope still honours a `?scope=` query override per
// request (task 01) — the STARTED scope only decides the DEFAULT when the query
// string is silent.
const VALID_SCOPES = new Set(["global", "local"]);

// The per-message ceiling for the terminal INPUT lane (m42 interactive worker
// terminals): human keystrokes and pasted answers, never bulk transfer. Anything
// over this is dropped (reported, never forwarded) — well under the relay's own
// DEFAULT_MAX_FRAME_BYTES so a legal input frame can never be the thing that
// trips the broker's frame limit.
export const MAX_TERMINAL_INPUT_BYTES = 32 * 1024;

export async function serveMeshUi({
  projectDir = process.cwd(),
  port = DEFAULT_MESH_UI_PORT,
  repoRoot,
  scope = "global",
  globalStoreOptions,
  // milestone 38 / story 06 (ADR-014) — the terminal-VIEW carve-out's collaborators.
  // `terminalMirror` defaults to a FRESH createTerminalMirror() (a literal
  // construction at THIS production call site, never reachable only via a test's
  // own injection) — an in-memory, ephemeral, live-tail projection, never a
  // durable record. `startTerminalRelaySubscriber`, when supplied, is an ASYNC
  // `(mirror) => Promise<{ stop() }>` this function calls once the server is
  // listening and disposes on close — the seam a real `aof mesh ui` wires a live
  // relay subscription through (src/mesh-terminal-mirror.mjs's
  // createTerminalMirrorSubscriberTransport + startTerminalMirrorSubscriber);
  // absent by default so a caller with no relay configured gets a mirror that
  // simply never receives a live frame (the same clean-degrade posture every
  // other relay collaborator in this codebase keeps).
  terminalMirror,
  startTerminalRelaySubscriber,
  // m42 "interactive worker terminals" — the INPUT direction's loopback push
  // ({ push(envelope), close?() } | null). Wired by the CLI verb through
  // createTerminalRelayPushTransport(config); absent/null (no relay configured, or
  // a pre-feature caller) keeps the terminal-view route OUTPUT-ONLY — a browser
  // message is then simply dropped, the exact clean-degrade posture every other
  // relay collaborator keeps.
  terminalInputPush = null,
} = {}) {
  const dist = repoRoot ? meshUiDist(path.resolve(repoRoot)) : assetPath("ui", "dist");
  const boardServers = new Map();
  const mirror = terminalMirror ?? createTerminalMirror();
  let terminalSubscriberHandle = null;

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

  // milestone 38 / story 04 — REVIEW FIX F-B (architect, 2026-07-24). The
  // CONTROL's OWN machine identity: the `issuer` every directive minted through
  // this face is stamped with. Resolved from THIS daemon's launch workspace —
  // deliberately OUTSIDE the assign branch, which may read no fact of its own
  // launch dir (inv.5) — and memoised for the life of the process.
  //
  // WHY IT MAY NOT RIDE OFF THE TARGET WORKSPACE. `assignWork` derives TWO facts
  // from the workspace OBJECT it is handed: the `workspaceId` it stamps (asserted
  // pre-mint below, inv.6) and `issuer = ctx.issuer ?? workspace.config?.mesh
  // ?.nodeId` (commands/mesh-assign.mjs). The second is a MACHINE-scoped fact,
  // and after the AMENDMENT the workspace handed to the verb is the CLICKED
  // CARD's, not this machine's. On the common path loadWorkspace overlays the
  // machine-wide identity onto every workspace it loads, so the two agree; on a
  // machine where the TARGET checkout still carries a LEGACY per-workspace
  // identity sidecar (work.mjs's read-only back-compat fallback) they do NOT,
  // and the mint would stamp the TARGET's id as the issuer of a directive THIS
  // control issued. `issuer` is load-bearing — control-stream-server.mjs never
  // routes a directive whose issuer is revoked — so it is passed EXPLICITLY.
  //
  // LAZY, never at startup: a GET-only session must load no workspace at all
  // (the read routes stay untouched), and a machine's identity cannot change
  // under a running daemon, so one read is one read.
  let controlNodeIdMemo;
  const controlNodeId = async () => {
    if (controlNodeIdMemo === undefined) {
      const ownWorkspace = await loadWorkspace(resolvedProjectDir, undefined, { env: globalStoreOptions?.env });
      controlNodeIdMemo = ownWorkspace.config?.mesh?.nodeId ?? null;
    }
    return controlNodeIdMemo;
  };

  // m43 / story 04 (ADR-006) — the CACHE-FRESHNESS WINDOW the fleet payload states once.
  // Read off THIS node's own checkout, the same lazy machine-fact memo shape as
  // controlNodeId above and for the same reason: the fleet is machine-wide, so the window
  // it renders is a property of the machine an operator configured, not of whichever card
  // they are looking at. Going through `resolveCacheStalenessSeconds` (never a literal
  // here) is what keeps the board and the fleet on ONE number — the defect DESIGN calls out
  // by name is two surfaces that can disagree about the same instant.
  //
  // A workspace that will not load is not a failure: the resolver answers the documented
  // default, which is the honest machine-wide answer and exactly what an unconfigured
  // machine should see.
  let cacheStalenessMemo;
  const cacheStalenessSeconds = async () => {
    if (cacheStalenessMemo === undefined) {
      let config = undefined;
      try {
        config = (await loadWorkspace(resolvedProjectDir, undefined, { env: globalStoreOptions?.env })).config;
      } catch (error) {
        reportDegrade("mesh-ui-serve", error);
      }
      cacheStalenessMemo = resolveCacheStalenessSeconds(config);
    }
    return cacheStalenessMemo;
  };

  const server = http.createServer(async (request, response) => {
    let requestUrl;
    try {
      // A "//x" request target parses as PROTOCOL-RELATIVE — see the identical guard in
      // setup-ui.mjs: without this, //api/* dodges the API guard and the SPA fallback
      // answers HTML for it. Collapse LEADING slashes only.
      requestUrl = new URL((request.url ?? "/").replace(/^\/\/+/, "/"), "http://127.0.0.1");
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

    // milestone 38 / story 04 (ADR-012 + its 2026-07-24 AMENDMENT) — the fleet
    // face's FIRST and ONLY mutation route:
    // POST /api/mesh/assign { ref, nodeId, workspaceId }. It wraps the EXISTING
    // assignWork(workspace, ref, nodeId, ctx) core VERBATIM — no second
    // uniqueness rule, no bespoke repo check, no arbitration of its own. Every
    // OTHER method on this path (GET/PUT/DELETE/…) is a clean 405 naming "POST"
    // as the one allowed verb (the read-only-except-this-one-route posture,
    // structural invariant #1/#4).
    //
    // BLOCKER F21 (measured live, VERIFICATION §"Soak 04" 2026-07-24): this
    // route used to lift only { ref, nodeId } and resolve the ref against the
    // DAEMON's own launch project dir. But this face is GLOBAL — the cards on
    // screen come from EVERY workspace on the machine — so a card from a
    // non-control workspace was mis-assigned, and on a ref COLLISION it
    // dispatched entirely different work off a correct-looking `200 ok`. The
    // ADR-012 AMENDMENT therefore makes `workspaceId` a REQUIRED third field
    // and pins the resolution + assertion ORDER below (invariants 5 and 6).
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
      // ONLY { ref, nodeId, workspaceId } is lifted off the body — the first
      // two are passed into the verb, the third SELECTS the workspace the verb
      // is handed. Any other field a client posts (a forged state/assignmentId/
      // issuer, task 00 scenario 2) rides no further; the verb assembles its
      // own record shape (ADR-012 inv.2 — "adds no second uniqueness rule, no
      // bespoke repo check").
      const ref = typeof body?.ref === "string" ? body.ref.trim() : "";
      const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";
      const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";
      if (!ref || !nodeId) {
        sendApiError(response, 400, "Both \"ref\" and \"nodeId\" are required.", "invalid-body");
        return;
      }
      // VERIFICATION (UI phase selection, 2026-07-25) — an OPTIONAL 4th field: the
      // lifecycle phase the worker runs (refine/continue/verify). Validated against the
      // closed set; anything else (or absent) is REFUSED to `refine` (the pre-existing
      // default), never trusted verbatim — the phase then maps to a whole slash-command
      // string on the control's dispatch side, so an unvalidated value would become
      // arbitrary text typed into a live worker PTY. It is threaded into the verb, which
      // persists it in the additive side-table; it never touches the frozen record.
      const requestedPhase = typeof body?.phase === "string" ? body.phase.trim() : "";
      const phase = isAssignmentPhase(requestedPhase) ? requestedPhase : "refine";
      // ADR-012 AMENDMENT ruling 1 — workspaceId is REQUIRED, and a blank/absent
      // one is a CODED refusal minting nothing. There is deliberately NO default
      // and NO fallback anywhere on this path: the "intuitive" fallback (absent
      // workspaceId ⇒ the daemon's own workspace) IS defect F21, so the degree of
      // freedom is removed by construction (the milestone's own F-38.06b lesson).
      // A stale client fails LOUDLY here instead of dispatching another
      // workspace's milestone. The code/status reuse GET /api/mesh/board-url's
      // existing spelling above — the face's two workspace-addressed routes speak
      // ONE dialect.
      if (!workspaceId) {
        sendApiError(response, 400, "\"workspaceId\" is required.", "invalid-workspace");
        return;
      }

      try {
        // ADR-012 AMENDMENT ruling 2 — resolution runs through the SANCTIONED
        // seam: queryGlobalMeshStatus → status.workspaces[] → projectRoot, the
        // EXACT two-step GET /api/mesh/board-url already performs above. That
        // makes the resolution domain EQUAL the render domain by construction
        // (every workspace the operator can click resolves, and nothing else
        // does), costs ZERO new imports, and keeps "drill in to this card" and
        // "assign this card" resolving the SAME id to the SAME project root
        // through the SAME row. A store fault rides the catch below, coded —
        // never a fallback.
        //
        // REVIEW FIX F-A (architect, 2026-07-24) — the call is BYTE-IDENTICAL to
        // the board-url precedent above: UNNARROWED, then find the row. Passing
        // `workspaceId` into the query as well was provably equivalent today,
        // but that is a property of two query IMPLEMENTATIONS, not of this
        // seam's contract — and that contract has already been carved
        // non-uniformly once (queryGlobalRegistry deliberately does not narrow
        // the node roster, since nodes are machine-wide). The degree of freedom
        // is removed by construction; a loopback single-user server never needed
        // the micro-optimisation.
        const status = await queryGlobalMeshStatus({ ...globalStoreOptions });
        const row = (status.workspaces ?? []).find((candidate) => candidate.workspaceId === workspaceId);
        if (!row) {
          sendApiError(response, 404, `Workspace "${workspaceId}" is not in the mesh projection.`, "workspace-not-found");
          return;
        }
        // The reachability caveat, checked BEFORE loadWorkspace: workspace ids
        // are path-derived, so a row published by ANOTHER machine into a synced
        // projection carries a project_root that does not exist HERE. Without
        // this probe loadWorkspace degrades to an empty config, findWork
        // resolves nothing, and the operator gets "ref-not-found" — a refusal
        // that names the WRONG cause. A refusal must name its own cause.
        if (!row.projectRoot || !existsSync(row.projectRoot)) {
          sendApiError(response, 409, `Workspace "${workspaceId}" is not checked out on this machine.`, "workspace-not-local");
          return;
        }
        // Loaded LAZILY, only for a request that already cleared the CSRF +
        // shape + resolution guards above — mirroring the SEA/CLI's own
        // `loadWorkspace(cwd)` per-invocation load (never cached across
        // requests; the read routes above never trigger this at all, so a
        // GET-only test never touches a workspace object it did not ask for).
        // The dir is the RESOLVED ROW's project root — the workspace the
        // operator's card belongs to, NEVER this daemon's own launch dir.
        const assignWorkspace = await loadWorkspace(row.projectRoot, undefined, { env: globalStoreOptions?.env });
        // ADR-012 AMENDMENT ruling 3 / inv.6 — assert the mint's target BEFORE
        // minting. assignWork does not take a workspaceId: it DERIVES the id it
        // stamps from the workspace OBJECT it is handed (resolveItem,
        // commands/mesh-assign.mjs). So "we resolved the row carefully" is NOT
        // the same guarantee as "the minted record carries the id the operator
        // clicked" — a config-level mesh.workspaceId override, a stale
        // projection row pointing at a moved/re-keyed checkout, or a
        // case/normalisation difference each diverge the two. Deriving with the
        // VERB-IDENTICAL expression checks the very value the mint will stamp,
        // not a lookalike, and makes minting against a workspace other than the
        // one clicked structurally impossible rather than merely unlikely.
        const ownWorkspaceId = assignWorkspace.config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(assignWorkspace.projectRoot);
        if (ownWorkspaceId !== workspaceId) {
          sendApiError(response, 409, `The workspace resolved for "${workspaceId}" identifies itself as "${ownWorkspaceId}".`, "workspace-id-mismatch");
          return;
        }
        // REVIEW FIX F-B — `issuer` is the CONTROL's own machine identity,
        // passed EXPLICITLY so it can never fall out of the TARGET workspace's
        // config (see `controlNodeId` at the top of serveMeshUi). A control that
        // has no identity at all refuses BY NAME here rather than handing the
        // verb a null that reaches `issuer TEXT NOT NULL` and surfaces as an
        // uncoded 500 on a legitimately-clickable card — every other failure on
        // this path names its own cause.
        const issuer = await controlNodeId();
        if (!issuer) {
          sendApiError(
            response,
            409,
            "This control node has no mesh identity yet — run `aof mesh identity` before dispatching work.",
            "control-identity-unknown",
          );
          return;
        }
        const result = await assignWork(assignWorkspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions ?? {}, issuer, phase });
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
        const result = await queryGlobalMeshStatus({
          ...globalStoreOptions,
          workspaceId,
          // m43 / story 04 — the freshness window this machine is configured with, stated
          // once on the payload beside the rows' own `syncedAt`/`reportedBy`.
          cacheStalenessSeconds: await cacheStalenessSeconds(),
        });
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
    //
    // m45 / story 02 (ADR-004 [Amigos-2]) — THE ORDER IS THE DECISION: the traversal
    // guard's `null` is TERMINAL. Several traversal encodings survive URL parsing intact
    // AND end in an extension-less segment, so routing a REFUSED path into the fallback
    // predicate would answer 200 text/html to an attempted directory escape — a refusal
    // silently converted into a success.
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
        // m45 / story 02 (ADR-004) — this fallback WAS UNCONDITIONAL, and that was a
        // live defect on this origin: a missing `/assets/index-abc.js` was answered with
        // index.html and `Content-Type: text/html`, so a deploy that shipped without its
        // JavaScript arrived in the browser as `Uncaught SyntaxError: Unexpected token
        // '<'`, arbitrarily far from its cause, while `curl` of the asset said 200. It is
        // now gated behind the SHARED predicate, so a deep-linked `/fleet` still renders
        // and a missing FILE stays loud. This is a deliberate NARROWING of live fleet
        // behaviour, decided in ADR-004, not a regression.
        if (!shouldServeAppShell(pathname)) {
          sendApiError(response, 404, "Mesh API route not found.", "not-found");
          return;
        }
        // A missing index is the friendly not-found envelope — ui-build-missing stays
        // loud, never a blank 200.
        readFile(path.join(dist, "index.html"))
          .then((index) => send(response, 200, "text/html", index))
          .catch(() => sendApiError(response, 404, "Mesh API route not found.", "not-found"));
      });
  });

  // milestone 38 / story 06 (ADR-014, carve-out #2) — the ONE upgrade path this
  // face now answers: GET /ws/terminal-view?nodeId=&sessionId=, a READ-ONLY
  // server->browser mirror of the relayed terminal-frame signals. Every OTHER
  // upgrade pathname (including the board's own /ws/terminal — ADR-004; task 05)
  // is STILL destroyed unconditionally, byte-identical to the pre-story-06
  // posture. There is still exactly ONE http.createServer (ADR-003/ADR-012
  // inv.4) — this WebSocketServer rides the SAME server via noServer + the
  // upgrade event, the terminal-ws.mjs/mesh-relay.mjs precedent.
  const terminalViewWss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    let pathname;
    let searchParams;
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      pathname = requestUrl.pathname;
      searchParams = requestUrl.searchParams;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws/terminal-view") {
      try {
        socket.destroy();
      } catch (error) {
        /* the socket may already be closed — refusing an upgrade never crashes */
      reportDegrade("mesh-ui-serve", error); }
      return;
    }
    const nodeId = searchParams.get("nodeId");
    const sessionId = searchParams.get("sessionId");
    // A card with no (nodeId, sessionId) yet (ADR-014 invariant 4 / task 01
    // scenario 2 — "an assignment with no session_id surfaced yet ... never
    // subscribes to a guessed or wrong session") is refused the SAME way an
    // unknown pathname is — no upgrade, no socket left dangling.
    if (!nodeId || !sessionId) {
      try {
        socket.destroy();
      } catch (error) {
        /* already closed */
      reportDegrade("mesh-ui-serve", error); }
      return;
    }
    terminalViewWss.handleUpgrade(request, socket, head, (ws) => {
      // subscribe() delivers ONLY frames whose (nodeId, sessionId) matches this
      // tuple (no cross-talk — task 01's multiplex scenario); unsubscribe on
      // close/error so a dropped browser tab leaves no dangling listener.
      const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes, meta) => {
        // ADR-014 AMENDMENT (2026-07-23, structural invariant 8; BLOCKER F-38.06e)
        // — the worker's END-OF-STREAM marker for THIS tuple. The route answers it
        // by CLOSING the browser socket, which is what makes the browser's already
        // correct `socket.onclose -> terminalViewOnClose -> ENDED` reducer reachable
        // from a REAL session end (DESIGN §Surface 3 V9: a dead stream must not
        // masquerade as a live one).
        //
        // A TRANSPORT close, never an in-band control message written into the byte
        // stream, for two load-bearing reasons: (1) the browser writes these bytes
        // STRAIGHT into xterm, so sniffing control content out of terminal bytes
        // would turn a dumb painter into a parser (the shape inv.2 forbids in
        // spirit); (2) SECURITY T14 — a worker's OWN PTY output could then FORGE an
        // end by simply printing the marker, closing the operator's view at will and
        // defeating the on-screen-secret inspection. At the transport layer that
        // forgery is structurally impossible.
        if (meta?.end === true) {
          try {
            ws.close();
          } catch (error) {
            /* the socket may already be closing */
      reportDegrade("mesh-ui-serve", error); }
          return;
        }
        try {
          ws.send(bytes);
        } catch (error) {
          /* the socket may already be closing */
      reportDegrade("mesh-ui-serve", error); }
      });
      ws.on("close", unsubscribe);
      ws.on("error", unsubscribe);
      // m42 "interactive worker terminals" — SECURITY T14's original read-only
      // decision is OPERATOR-OVERRIDDEN: this socket now carries the INPUT
      // direction too, under the constrained shape the rewritten fitness
      // (acd-fleet-terminal-input-constrained) pins:
      //   - TUPLE-BOUND: the envelope's routing facts are THE SOCKET'S OWN
      //     (nodeId, sessionId), closed over from the upgrade query above — the
      //     message body contributes ONLY the opaque bytes, so a client cannot
      //     address any session but the one its socket was opened for.
      //   - CONTENT-BLIND: the bytes are never parsed, sniffed, or branched on
      //     (a pasted JSON answer must arrive as typed text).
      //   - BOUNDED: an over-limit message is dropped and reported, never
      //     truncated-and-forwarded.
      //   - CLEAN-DEGRADE: no configured push (terminalInputPush == null) means
      //     the route stays output-only — the message is dropped silently-but-
      //     reportably, exactly like every other unconfigured relay collaborator.
      ws.on("message", (data) => {
        if (terminalInputPush == null) return;
        let bytes;
        try {
          bytes = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        } catch (error) {
          reportDegrade("mesh-ui-terminal-input", error);
          return;
        }
        if (bytes.length === 0) return;
        if (Buffer.byteLength(bytes) > MAX_TERMINAL_INPUT_BYTES) {
          reportDegrade("mesh-ui-terminal-input-oversize", new Error(`terminal input dropped: ${Buffer.byteLength(bytes)} bytes exceeds the ${MAX_TERMINAL_INPUT_BYTES}-byte input ceiling`));
          return;
        }
        try {
          const result = terminalInputPush.push(buildTerminalInputEnvelope(nodeId, sessionId, bytes));
          if (result && typeof result.catch === "function") {
            result.catch((error) => {
              // a relay push fault loses THIS keystroke, never the socket.
              reportDegrade("mesh-ui-terminal-input", error);
            });
          }
        } catch (error) {
          reportDegrade("mesh-ui-terminal-input", error);
        }
      });
    });
  });

  const originalClose = server.close.bind(server);
  server.close = function closeWithBoardServers(callback) {
    return originalClose((error) => {
      Promise.all([
        closeBoardServers(boardServers),
        Promise.resolve(terminalSubscriberHandle?.stop?.()),
        // the input push holds a lazily-opened loopback socket — dispose it with the server.
        Promise.resolve().then(() => terminalInputPush?.close?.()).catch((error) => reportDegrade("mesh-ui-terminal-input", error)),
      ]).finally(() => {
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

  // milestone 38 / story 06 — once the server is listening, start the OPTIONAL
  // live relay subscriber (absent by default; a caller supplies one — e.g. wired
  // through createTerminalMirrorSubscriberTransport — to feed `mirror` from a
  // REAL relay). A subscriber fault must never fail server startup (the SAME
  // clean-degrade posture every other relay collaborator keeps): the fleet face
  // still serves; the terminal-VIEW route simply carries no live frames yet.
  if (typeof startTerminalRelaySubscriber === "function") {
    try {
      terminalSubscriberHandle = await startTerminalRelaySubscriber(mirror);
    } catch {
      terminalSubscriberHandle = null;
    }
  }

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  // milestone 45 / story 04 (ADR-002) — the fleet's PATH on this server's own origin:
  // e.g. http://127.0.0.1:PORT/fleet. Built with `new URL` rather than concatenated, so
  // the path can never be glued onto a query. It carries NO scope: the scope is the
  // LAUNCHER's fact, and `src/commands/mesh-ui.mjs` sets it on this URL as a real search
  // parameter before announcing it (the same value `serveMeshUi` was started with).
  const fleetUrl = new URL("/fleet", url).toString();
  return { server, url, fleetUrl, terminalMirror: mirror };
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
  // m43 / ADR-003 — the SCOPE lock's refusal is the same class of conflict as the
  // exact-ref one (the item's CURRENT state forbids the mint), so it takes the same
  // 409 rather than falling through to this table's 400 default.
  "item-locked-by-assignment": 409,
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

// m45 / story 02 (ADR-004): `contentType` and `safeStaticPath` used to be defined here,
// the guard byte-identically with setup-ui.mjs's copy and the MIME table already drifted
// ahead of it. They now have ONE home — ./static-serve.mjs, imported at the top of this
// file. The merged MIME table is the UNION, i.e. THIS copy, so no answer this origin
// gives changes; it is the board/config origin that stops being one file type behind.

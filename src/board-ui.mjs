// `/api/work*` — the work board's read-mostly HTTP API (milestone 03, story 01;
// re-homed onto the command core in milestone 08, story 02).
//
// This module owns the board's HTTP namespace (ADR-001): list / doc / tasks /
// validate / next / feedback, all under the frozen `/api/work` prefix. It is
// wired into the single `http.createServer` in `setup-ui.mjs` via one additive
// line; the terminal WebSocket (`/ws/terminal`) is a disjoint namespace on the
// same server.
//
// After the milestone-08 migration (ADR-003) this is a THIN FACE: each route is
// a `HTTP → invoke(id, input, { workspace }) → board-projection` adapter and
// carries ZERO operation logic of its own. The operations live in the command
// core (`./command-core.mjs` → `src/commands/*`); this module obtains the
// `workspace` and `invoke` it needs THROUGH that single registry door (ADR-004
// inv. 3 — its only operation-bearing import is `./command-core.mjs`). The board
// face's two jobs are TRANSPORT (read the JSON body, map the error/status
// envelope, own the unknown-route 404) and PATH DISPLAY (`displayPath`:
// relativise the command's basis-neutral raw paths to `projectRoot` + forward
// slashes — the milestone-03 wire, ADR-002).
import path from "node:path";
import { invoke, loadWorkspace } from "./command-core.mjs";
// m43 / story 04 (ADR-006 + ADR-010/R4.1) — the staleness WINDOW is one number for the
// whole response, so it is an ENVELOPE concern and therefore a FACE concern: the board
// route states it once beside the rows, while `work:list`'s own result and `aof work list
// --json`'s flat array stay byte-identical. This is `validate.mjs`'s documented discipline
// ("Path display is a FACE adapter … the command result stays the richer envelope") applied
// in the other direction. The resolver is a pure config read — no operation logic follows
// it here, and the number itself has exactly one home (cache-provenance.mjs).
import { resolveCacheStalenessSeconds } from "./cache-provenance.mjs";

// Returns true if the request was an `/api/work*` route (handled here), else
// false so the caller falls through to its own routing/404.
export async function handleWorkApi(request, response, options = {}) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return false;
  }

  const pathname = requestUrl.pathname;
  if (!pathname.startsWith("/api/work")) return false;

  try {
    // Inside the try so a loadWorkspace throw lands in the catch below (mapping
    // error.status ?? 500 to a JSON error response) rather than escaping the
    // handler — the caller awaits this bare in the http.createServer callback.
    const workspace = await loadWorkspace(path.resolve(options.projectDir ?? process.cwd()));
    const ctx = { workspace };
    const params = requestUrl.searchParams;

    if (request.method === "GET" && pathname === "/api/work/list") {
      // The list rows pass straight through — `dir` is already forward-slashed
      // by listStream, so no path projection is needed (ADR-002).
      // `mesh: true` — VERIFICATION (2026-07-25): the BOARD asks for the mesh-execution
      // overlay (is this item being executed by a worker, and where does that work live),
      // so a milestone a remote worker is building no longer reads `not-started` from this
      // node's own local frontmatter. Opt-in per call: the CLI's own `work:list` is
      // untouched. The overlay degrades to the local rows on any fault, so this cannot
      // fail the board.
      const rows = await invoke("work:list", { mesh: true }, ctx);
      // m43 / story 04 — THE ENVELOPE. `{ items, stalenessSeconds, nodeId }`: the rows carry
      // the per-row FACTS (`reportedBy`, `syncedAt`), and the two things that are ONE fact
      // for the WHOLE response are stated once beside them.
      //
      //   `stalenessSeconds` — the window the reader applies to those facts. Per-row would
      //   let two rows in one response disagree about the same threshold, and a client-side
      //   default would be the "two predicates" defect in its most common form — so `ui/`
      //   carries neither.
      //
      //   `nodeId` — WHICH MACHINE IS SERVING THIS READ, so a row THIS node published can
      //   read `(this node)` (AC 11; DESIGN §1c "the control is simply one more writer into
      //   the cache"). It is the same shape of face change and for the same reason: a node
      //   identity is a property of the surface, not of a row, so per-row would be a second
      //   spelling of one fact — and `ui/` cannot derive it, because a row names its
      //   REPORTER, which is the fact being qualified rather than the qualifier.
      //
      // It is read the way the sibling FLEET face reads its own machine identity
      // (`mesh-ui-serve.mjs`'s `controlNodeId`): the raw optional-chain off the loaded
      // workspace, which is where `loadWorkspace` has already resolved the per-install
      // identity sidecar over the committed config. NOT `meshNodeIdOf` — that helper lives
      // in `src/commands/`, which no face and no lower module may import
      // (acd-work-ui-no-core-import, acd-command-layer-imports-downward). An unconfigured
      // machine states `null` and NO row is marked local: a board that does not know which
      // machine it is must not guess, and every row still names its reporter plainly.
      sendJson(response, 200, {
        items: rows,
        stalenessSeconds: resolveCacheStalenessSeconds(workspace.config),
        nodeId: workspace.config?.mesh?.nodeId ?? null,
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/doc") {
      const result = await invoke(
        "work:doc",
        { ref: (params.get("ref") ?? "").trim(), doc: (params.get("doc") ?? "").trim() },
        ctx
      );
      sendJson(response, 200, result);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/tasks") {
      const result = await invoke("work:tasks", { ref: (params.get("ref") ?? "").trim() }, ctx);
      sendJson(response, 200, result);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/run-status") {
      // The run read path (milestone 21, ADR-001): the thinnest route of the
      // family. `work:run-status` returns `{ ref, runs: RunRecord[] }` and the run
      // records carry REFS, not absolute paths (19/ADR-003) — so, unlike
      // validate/next/doctor, there is NO `displayPath` projection to perform. It
      // reads the query param, invokes the already-registered command through the
      // one registry door, and serialises the result UNCHANGED (zero operation
      // logic, no run-store import). Current-run state is the latest/in-flight
      // element of the SAME `runs[]` — the UI selects it; there is no second route.
      const result = await invoke("work:run-status", { ref: (params.get("ref") ?? "").trim() }, ctx);
      sendJson(response, 200, result);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/validate") {
      const result = await invoke("work:validate", { scope: scopeParam(params) }, ctx);
      // Project each finding's raw-absolute path to projectRoot-relative +
      // forward-slashed — the milestone-03 board wire (ADR-002/003 face adapter).
      sendJson(response, 200, {
        findings: result.findings.map((finding) => ({
          path: displayPath(workspace.projectRoot, finding.path),
          problem: finding.problem,
        })),
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/doctor") {
      // The health lane's board face (15/ADR-001/ADR-002): a thin pass-through —
      // invoke work:doctor through the registry, then project each finding's
      // raw-absolute path to projectRoot-relative + forward-slashed (the board
      // displayPath wire). The board NEVER gates: there is no --strict here (a
      // board cannot fail CI), so `?strict` is inert and the envelope carries no
      // exit/gate field — just the advisory finding set.
      const result = await invoke("work:doctor", { scope: scopeParam(params) }, ctx);
      sendJson(response, 200, {
        findings: result.findings.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          path: displayPath(workspace.projectRoot, finding.path),
          message: finding.message,
        })),
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/work/next") {
      const result = await invoke("work:next", { scope: scopeParam(params) }, ctx);
      // Project the next item's raw-absolute path (when present) to
      // projectRoot-relative + forward-slashed — the milestone-03 board wire.
      const payload = { ...result };
      if (typeof payload.path === "string") {
        payload.path = displayPath(workspace.projectRoot, payload.path);
      }
      sendJson(response, 200, payload);
      return true;
    }

    // THE phase doors (continue 2026-07-26; refine/verify m42 wave (b) — the
    // one-door completion): "do this act, optionally naming where". Each may mint
    // an assignment, so each carries the same same-origin admission guard the
    // fleet's own assign route uses — a same-origin browser fetch always matches
    // this server's own http://<host>; anything else is refused before the body is
    // read. ONE implementation (handlePhaseDoor below); the routes are spelled
    // explicitly so the registry-derived route-coverage gate can see each literal.
    const handlePhaseDoor = async (phase) => {
      const expectedOrigin = `http://${request.headers.host}`;
      if (request.headers.origin !== expectedOrigin) {
        sendApiError(response, 403, "Cross-origin write refused.", "cross-origin-refused");
        return true;
      }
      const body = await readJsonBody(request);
      // Only ref/node are lifted off the body — the command decides everything else.
      const result = await invoke(
        `work:${phase}`,
        { ref: body.ref, ...(body.node ? { node: body.node } : {}) },
        ctx
      );
      sendJson(response, 200, result);
      return true;
    };
    if (request.method === "POST" && pathname === "/api/work/continue") {
      return handlePhaseDoor("continue");
    }
    if (request.method === "POST" && pathname === "/api/work/refine") {
      return handlePhaseDoor("refine");
    }
    if (request.method === "POST" && pathname === "/api/work/verify") {
      return handlePhaseDoor("verify");
    }

    // m43 / story 04 (ADR-010/R4.2) — THE RESYNC DOOR. A POST rather than a GET because it
    // causes a node→node request to leave this machine, and it carries the SAME same-origin
    // admission guard the phase doors use for the same reason. It is not a board WRITE: the
    // face still writes no file and spawns nothing; the command writes one request row for
    // the control daemon's own tick to drain.
    //
    // The answer is a CODED OUTCOME DOCUMENT at 200, never an error envelope — the offline
    // owner is the LIKELY case here (the row is stale precisely because its owner stopped
    // reporting), so it is a designed state the surface renders, not a fault it reports. The
    // face therefore passes the command's document through verbatim: `{ ok, code, ref, node,
    // message }`, which is exactly what `mesh:recover-push` established.
    if (request.method === "POST" && pathname === "/api/work/resync") {
      const expectedOrigin = `http://${request.headers.host}`;
      if (request.headers.origin !== expectedOrigin) {
        sendApiError(response, 403, "Cross-origin write refused.", "cross-origin-refused");
        return true;
      }
      const body = await readJsonBody(request);
      const result = await invoke("work:resync", { ref: body.ref }, ctx);
      sendJson(response, 200, result);
      return true;
    }

    if (request.method === "POST" && pathname === "/api/work/feedback") {
      // readJsonBody is the HTTP-body transport reader (its payload-too-large /
      // empty-json / malformed-json errors are HTTP-body concerns, not operation
      // logic — they stay in the face). The default actor "you" now lives in the
      // command, so the raw body.actor passes straight through.
      const body = await readJsonBody(request);
      const result = await invoke(
        "work:feedback",
        { ref: body.ref, note: body.note, actor: body.actor, refs: body.refs },
        ctx
      );
      sendJson(response, 200, result);
      return true;
    }
  } catch (error) {
    // The command (and the body reader) throw Errors carrying the same
    // `.code`/`.status` the board set inline before the migration, so the
    // `{ ok:false, error, code }` envelope + status mapping is preserved
    // byte-for-byte (ADR-003): invalid-doc/missing-ref/missing-note/
    // unsupported-target → 400, ref-not-found → 404, payload-too-large → 413,
    // empty-json/malformed-json → 400.
    sendApiError(response, error.status ?? 500, error.message, error.code ?? "work-api-failed");
    return true;
  }

  // An unknown `/api/work*` route: own the response with a 404 so the caller's
  // generic guard does not also try to respond. (A routing concern, not an
  // operation — it stays in the face, ADR-003.)
  sendApiError(response, 404, "Work API route not found.", "not-found");
  return true;
}

function scopeParam(params) {
  const scope = (params.get("scope") ?? "").trim();
  return scope === "" ? undefined : scope;
}

// Turn an absolute item path into a forward-slashed path relative to the project
// root for display on the wire (Windows host → forward slashes, ADR-002 style).
// This is the BOARD's path-display face adapter — it stays here (presentation,
// not operation): the command returns basis-neutral raw paths, the board
// projects them to the milestone-03 projectRoot-relative + slashed wire.
function displayPath(projectRoot, absolutePath) {
  const relative = path.relative(projectRoot, absolutePath);
  return relative.replaceAll("\\", "/");
}

// --- local response helpers (mirrors setup-ui.mjs; not exported there) -------

function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

function sendApiError(response, status, message, code) {
  sendJson(response, status, { ok: false, error: message, code });
}

function send(response, status, contentTypeValue, body) {
  response.writeHead(status, { "content-type": contentTypeValue });
  response.end(body);
}

// The HTTP request-body reader for the feedback write (transport, not
// operation): caps the body size (413), rejects an empty (400) or malformed
// (400) JSON body. These are HTTP-body concerns and stay in the face; the
// resolved JSON object is handed to the command as its input.
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

// The REAL board face on a loopback port, over a REAL work stream on disk and an
// isolated global store (milestone 43 / story 04 — the substrate the board mount
// harness runs against).
//
// "REAL board face" means the production `handleWorkApi` (src/board-ui.mjs) — the
// module that owns `/api/work/*` — answering every route: list, doc, tasks,
// run-status, next, validate. The app under test therefore speaks HTTP to the
// same handler the desktop board speaks to, through its own api client, in its
// own order. Nothing about the routing, the command core, the workspace
// resolution or the row shapes is stood in for.
//
// PROVENANCE IS PRODUCER-FED, NOT PAINTED ON. A lane says "this workspace was
// reported by <node> at <instant>" by making the REAL publisher write exactly
// that into the REAL store (`publishWorkspaceSnapshot`, which stamps `node_id` +
// `updated_at` on every row it upserts). The face then reads it back through the
// production row mapper (`cache-provenance.mjs`'s `toWireProvenance`) and serves
// it on the envelope. So a green lane means the store recorded it, the mapper
// mapped it and the route served it — the m38/ADR-008 producer-fed rule, applied
// to the fact this whole story is about. The window travels the same way: it is
// CONFIGURED in the workspace's own `.aof/aof.config.json` and resolved by the
// face's own resolver, never injected into the response.
//
// ── THE ONE RESPONSE-LEVEL SEAM, NAMED HONESTLY ─────────────────────────────
// `withdrawWindow()` drops `stalenessSeconds` from the envelope. That is a
// producer this face cannot BE — the real resolver always answers a number — but
// it is a wire state `ui/` must survive without inventing a threshold of its own
// (DESIGN §Surface 3's words-never-a-number degrade), so it is exercised at the
// response boundary and nowhere else. Everything else here goes through the
// store.
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleWorkApi } from "../../src/board-ui.mjs";
import { openGlobalWorkProjectionStore, upsertWorkItemContent, workspaceIdFor } from "../../src/global-work-store.mjs";
import { RESYNC_REQUESTED, readResync, runResyncDispatchTick } from "../../src/mesh-resync.mjs";
import { assembleAssignmentRecord, insertAssignment, updateAssignmentState } from "../../src/assignment-record.mjs";
import { loadWorkspace } from "../../src/work.mjs";

// The REAL timers, captured at MODULE LOAD — before any mounted app installs its
// controllable clock over `globalThis.setTimeout` / `globalThis.setInterval`. The
// control daemon this fixture stands in for runs on the machine's own clock, not
// on the board's, and the two must not be the same instrument: a drain scheduled
// on the board's fake clock could only ever run when the board's clock was
// advanced, which is the one ordering the real system never has.
//
// BOTH are captured, and the pair is the point (43/ADR-015 F4). The interval was
// previously armed with a BARE `setInterval`, which resolves to
// `globalThis.setInterval` AT CALL TIME — i.e. the fake one for any lane that
// calls `controlTick()` after mounting the app. Every lane today calls it first,
// so the file was correct by call-order convention while its own header stated
// the property as structural. `clearInterval` is captured beside it so the
// teardown clears the same wheel it armed.
const realSetTimeout = setTimeout;
const realSetInterval = setInterval;
const realClearInterval = clearInterval;
const realSleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

// ── THE SECOND SEAM, AND IT IS THE FABRIC, NOT THE FACE ─────────────────────
// `controlTick()` runs the REAL control-daemon drain (`runResyncDispatchTick`,
// src/mesh-resync.mjs) against the REAL store on a REAL interval, and the ONLY
// thing the lane supplies is the socket registry it consults — which node
// currently holds a connected admitted socket, and whether a dispatch onto it
// completes. That is the FABRIC: a thing a single-process fixture cannot BE, and
// the same stand-in every mesh lane in this repo already makes.
//
// Everything downstream of it is production: the request row, the state machine,
// the coded outcomes, the route and the command. So a green Resync lane means
// the board wrote a request, the real tick drained it, and the real command
// reported the real coded answer.
//
// The interval is armed by the FIXTURE, before the mounted app installs its fake
// clock, so it keeps ticking on the real event loop exactly as the always-on
// control daemon does — independently of whatever the board's clock is doing.
const CONTROL_TICK_MS = 10;

// The default work stream every board lane reads: one milestone with four
// stories across the status ramp, plus a `uat` gate (which is a LOCAL acceptance
// item and therefore never carries cached provenance — DESIGN §1b).
const DEFAULT_STREAM = {
  milestone: { number: "43", slug: "mesh-artifact-authority", title: "Mesh artifact authority", status: "in-progress" },
  stories: [
    { number: "03", slug: "artifact-sync", title: "Artifact sync", status: "done" },
    { number: "04", slug: "staleness-and-resync", title: "Staleness, never eviction", status: "in-progress" },
    { number: "05", slug: "gate-propagation", title: "Gate propagation", status: "blocked" },
    { number: "06", slug: "cache-read-surface", title: "Cache read surface", status: "not-started" },
  ],
  gate: { number: "44", slug: "accept-mesh-authority", title: "Accept the mesh authority", status: "blocked", accepts: "43" },
};

async function writeStream(workDir, stream) {
  const m = stream.milestone;
  const milestoneDir = path.join(workDir, `${m.number}_milestone_${m.slug}`);
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    `---\ntype: milestone\nnumber: ${m.number}\nslug: ${m.slug}\nstatus: ${m.status}\ntitle: "${m.title}"\n---\n\n# ${m.number} · ${m.title}\n`,
    "utf8",
  );
  for (const story of stream.stories ?? []) {
    const dir = path.join(milestoneDir, "stories", `${story.number}_story_${story.slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "STORY.md"),
      `---\ntype: story\nnumber: ${story.number}\nslug: ${story.slug}\nparent: ${m.number}\nstatus: ${story.status}\ntitle: "${story.title}"\n---\n\n# ${story.number} · ${story.title}\n`,
      "utf8",
    );
  }
  if (stream.gate) {
    const gate = stream.gate;
    const dir = path.join(workDir, `${gate.number}_uat_${gate.slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SESSION.md"),
      `---\ntype: uat\nnumber: ${gate.number}\nslug: ${gate.slug}\nstatus: ${gate.status}\ntitle: "${gate.title}"\naccepts: ${gate.accepts}\n---\n\n# ${gate.number} · ${gate.title}\n`,
      "utf8",
    );
  }
}

// The response shim `handleWorkApi` writes into when the fixture needs to see the
// real face's answer before forwarding it. The face uses exactly `writeHead` +
// `end` (src/board-ui.mjs `send`), both synchronous — so after awaiting the
// handler the capture is complete.
function captureResponse() {
  const captured = { status: 200, headers: {}, body: "" };
  return {
    captured,
    response: {
      writeHead(status, headers) {
        captured.status = status;
        captured.headers = headers ?? {};
        return this;
      },
      end(body) {
        captured.body = typeof body === "string" ? body : body == null ? "" : String(body);
      },
    },
  };
}

// withBoardFace(fn, options) — stand up the face and yield the lane's control
// surface over the workspace, its cache and its configuration.
//
//   `stalenessSeconds` — the window CONFIGURED for this workspace, resolved by the
//   face's own resolver off `.aof/aof.config.json`. Stated by the lane rather than
//   inherited from `src/`'s documented default, so a tuning change there cannot
//   silently move what a UI lane is asserting.
//
//   `nodeId` — WHICH MACHINE this face is running on, configured in the same file and
//   stated by the face on the same envelope (m43 / story 04, AC 11), so a row this node
//   published reads `(this node)`. `null` writes a config with NO mesh identity at all —
//   a real, ordinary deployment state (an unconfigured machine), not a seam: the face
//   answers `nodeId: null` and no row is marked local. It is also the ISSUER the
//   fixture's `dispatched()` stamps and the default reporter of `reportedDoc()`, so a
//   lane that needs either should leave it configured.
export async function withBoardFace(fn, { stream = DEFAULT_STREAM, nodeId = "aof-control", stalenessSeconds = 300 } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-board-face-"));
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "repo");
  const workDir = path.join(root, "wiki", "work");
  const previousHome = process.env.AOF_GLOBAL_HOME;

  // The face resolves its workspace (and its global store) from the process
  // environment — it takes no injection seam — so the isolated home is set for
  // the fixture's lifetime and restored after it. Every aof test run is already
  // required to carry a throwaway AOF_GLOBAL_HOME; this narrows it further to
  // one per fixture.
  process.env.AOF_GLOBAL_HOME = home;

  const state = {
    // The ONE response-level seam: drop the window from the envelope, a wire
    // state the real resolver cannot produce (see the header note).
    withdrawWindow: false,
    // The FABRIC's socket registry, consulted by the REAL dispatch tick (see the
    // header note above `CONTROL_TICK_MS`). `null` = no control daemon is
    // running at all, which is a real deployment state and leaves every request
    // sitting in `requested`.
    fabric: null,
    tickTimer: null,
    ticking: false,
    // A list response the fixture holds open (the app's LOADING state) / fails
    // (the app's page-level error line). Both are real HTTP behaviours of the
    // route, driven from the lane.
    stallGate: null,
    releaseStall: null,
    failList: null,
  };

  const server = http.createServer(async (request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Invalid request URL.", code: "invalid-url" }));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/work/list") {
      if (state.failList) {
        response.writeHead(state.failList.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: state.failList.message, code: "work-api-failed" }));
        return;
      }
      if (state.stallGate) await state.stallGate;
      if (!state.withdrawWindow) {
        // The ordinary path: the REAL route, byte-for-byte.
        if (await handleWorkApi(request, response, { projectDir: root })) return;
        return;
      }
      // …and the one wire state the real resolver cannot produce.
      const { captured, response: shim } = captureResponse();
      await handleWorkApi(request, shim, { projectDir: root });
      if (captured.status !== 200) {
        response.writeHead(captured.status, captured.headers);
        response.end(captured.body);
        return;
      }
      const payload = JSON.parse(captured.body);
      delete payload.stalenessSeconds;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }

    if (await handleWorkApi(request, response, { projectDir: root })) return;
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Not found", code: "not-found" }));
  });

  try {
    await mkdir(workDir, { recursive: true });
    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeStream(workDir, stream);
    // The window is CONFIGURED here and resolved by the face's own resolver —
    // one number, in the one place `src/` reads it from.
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "board-fixture", work: { dir: "./wiki/work" }, mesh: { nodeId, cache: { stalenessSeconds } } }, null, 2)}\n`,
      "utf8",
    );

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;

    const face = {
      url,
      root,
      home,
      nodeId,
      workspaceId: workspaceIdFor(root),
      // reportedBy(node, at) — the REAL publisher writes this node's view of the
      // whole workspace into the REAL store at that instant, stamping `node_id` +
      // `updated_at` on every row. This is how a lane says "umairs-mac-mini
      // reported this workspace twelve minutes ago" without painting anything on
      // the wire.
      //
      // Re-publishing as the SAME node is how a FRESHER COPY LANDS: an automatic
      // publish is authoritative over rows it authored, so the second write moves
      // `updated_at` forward. Re-publishing as a DIFFERENT node is deliberately
      // NOT a way to hand over authorship — the store refuses it, which is the
      // milestone's own rule and not something a fixture should route around.
      async reportedBy(node, at) {
        const workspace = await loadWorkspace(root, undefined, { env: { AOF_GLOBAL_HOME: home } });
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          return await store.publishWorkspaceSnapshot(workspace, { nodeId: node, now: at });
        } finally {
          store.close();
        }
      },
      // forget(ref, fields) — the PRE-v8 ROW, and its two halves: a stamped
      // column that reads NULL because nothing ever wrote it. Stated in WIRE
      // names by the lane (`syncedAt` / `reportedBy`) and translated here to the
      // storage columns, so the row still reaches the wire through the production
      // mapper — which is the code that has to turn a NULL into an EXPLICIT null
      // rather than an omitted key. A ref of `*` forgets every row.
      //
      // Both halves are separately reachable because DESIGN renders them
      // separately: "synced time unknown · from aof-wsl" is a different sentence
      // from "synced 30s ago · reporting node unknown".
      async forget(ref = "*", fields = ["reportedBy", "syncedAt"]) {
        const columns = fields.map((field) => (field === "reportedBy" ? "node_id" : field === "syncedAt" ? "updated_at" : null));
        if (columns.some((column) => column == null)) throw new Error(`board face: forget() knows the wire fields reportedBy / syncedAt, not ${fields.join(", ")}`);
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          const workspaceId = workspaceIdFor(root);
          const set = columns.map((column) => `${column} = NULL`).join(", ");
          if (ref === "*") store.db.prepare(`UPDATE work_items SET ${set} WHERE workspace_id = ?`).run(workspaceId);
          else store.db.prepare(`UPDATE work_items SET ${set} WHERE workspace_id = ? AND ref = ?`).run(workspaceId, ref);
        } finally {
          store.close();
        }
        return face;
      },
      // reportedDoc(ref, doc, body, { node, at }) — an ARTIFACT reported by a
      // node at an instant, written through the REAL content upsert
      // (`upsertWorkItemContent`, which stamps `node_id` + `updated_at` per doc
      // row). Separate from `reportedBy` above, and deliberately so: a doc can be
      // older than the row that names it, so a lane must be able to state the two
      // instants independently — which is exactly the fact DESIGN renders as two
      // separately-judged provenance lines.
      async reportedDoc(ref, doc, body, { node = nodeId, at } = {}) {
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          upsertWorkItemContent(store, workspaceIdFor(root), { docs: [{ ref, doc, body }], nodeId: node }, { now: at });
        } finally {
          store.close();
        }
        return face;
      },
      // dispatched(ref, { node, state, sessionId, at }) — the item was DISPATCHED
      // to a worker: a real assignment record, assembled by the production
      // assembler and written by the production single-row writer, which is what
      // the board's execution overlay reads. It is what makes the provenance
      // box's LINE 1 (`running on <node>` / `last run <state> on <node>`) appear —
      // and therefore the only way a lane can show that line 2 renders BESIDE it
      // rather than instead of it.
      //
      // A TERMINAL state is reached the way production reaches it: the record is
      // minted `assigned` and then advanced through the real state writer, never
      // inserted terminal, so the row a lane reads has a real lifecycle behind it.
      async dispatched(ref, { node = "umairs-mac-mini", state = "running", sessionId = null, at } = {}) {
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          const record = assembleAssignmentRecord({
            itemRef: ref,
            workspaceId: workspaceIdFor(root),
            targetNodeId: node,
            issuer: nodeId,
            now: at,
          });
          insertAssignment(store, record);
          if (state !== "assigned") {
            updateAssignmentState(store, record.assignmentId, state, { now: at, sessionId });
          }
          return record;
        } finally {
          store.close();
        }
      },
      // controlTick({ connected, deliver }) — start (or re-aim) the REAL control
      // daemon's resync drain. `connected` is the set of nodes holding a socket;
      // `deliver` is whether a dispatch onto one completes. Between them they
      // produce, THROUGH THE REAL TICK, every coded outcome DESIGN's table needs:
      //
      //   connected: [owner], deliver: true   → `dispatched`  → DESIGN "accepted"
      //   connected: [owner], deliver: false  → `resync-owner-unreachable`
      //   connected: []                       → `resync-owner-not-connected`
      //   controlTick() never called          → the row stays `requested` (no
      //                                         daemon is draining it at all)
      //
      // The interval is armed on the REAL event loop, before any mounted app
      // installs its fake clock, so it keeps draining exactly as the always-on
      // control daemon does while the board's own clock is under a lane's control.
      controlTick({ connected = [], deliver = true } = {}) {
        state.fabric = {
          directiveTargets: new Map(connected.map((node) => [node, { node }])),
          dispatchDirective: () => ({ sent: deliver === true }),
        };
        if (state.tickTimer == null) {
          state.tickTimer = realSetInterval(() => {
            if (state.ticking || state.fabric == null) return;
            state.ticking = true;
            void runResyncDispatchTick(state.fabric, { storeOptions: { env: { AOF_GLOBAL_HOME: home } } })
              .catch(() => { /* a tick that cannot open the store is a dead daemon, which is a state */ })
              .finally(() => { state.ticking = false; });
          }, CONTROL_TICK_MS);
          state.tickTimer.unref?.();
        }
        return face;
      },
      // awaitDispatch(ref) — resolve once the control tick has ACTED on this
      // item's request row (any state but `requested`), on the machine's REAL
      // clock. It is the fixture's "the daemon has drained the queue" gate, and
      // a lane needs it for a structural reason rather than a timing one:
      //
      //   `work:resync` writes the row and reads it back SYNCHRONOUSLY, so the
      //   first read ALWAYS sees `requested` and the command always sleeps at
      //   least once. That sleep is on the board's controllable clock, and the
      //   harness's `advance()` fires one timer and then waits for the app to
      //   settle — so if the row is not terminal by the FIRST wake, the command
      //   arms a second sleep the advance can no longer reach. Gating on the real
      //   drain here is what makes the first wake the LAST one, deterministically,
      //   instead of racing the daemon against the test's clock.
      // `after` is a PRIOR row's `updatedAt`, and a RETRY needs it: after a first
      // episode the row is already terminal, so a bare "is it settled yet?" would
      // answer instantly with the OLD answer and the lane would race the second
      // attempt. Passing the previous stamp makes the gate mean "settled AGAIN".
      async awaitDispatch(ref, { rounds = 600, everyMs = 5, after = null } = {}) {
        for (let round = 0; round < rounds; round += 1) {
          const row = await face.resyncRow(ref);
          if (row != null && row.state !== RESYNC_REQUESTED && (after == null || row.updatedAt !== after)) return row;
          await realSleep(everyMs);
        }
        throw new Error(`board face: no control tick settled a resync for ${ref} (is controlTick() armed?)`);
      },
      // The request row as the control daemon sees it — so a lane can capture a
      // marker before a retry, and so "the row is never wedged" is checkable at
      // the store rather than only on screen.
      async resyncRow(ref) {
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          return readResync(store, workspaceIdFor(root), ref);
        } finally {
          store.close();
        }
      },
      // withdrawWindow() — the ONE response-level seam (see the header note): the
      // envelope arrives with no `stalenessSeconds` at all.
      withdrawWindow(withdrawn = true) {
        state.withdrawWindow = withdrawn;
        return face;
      },
      // stallList() — hold every list response until release(): the app's own
      // LOADING branch, produced by a real slow route rather than a stub.
      stallList() {
        let release = () => {};
        state.stallGate = new Promise((resolve) => { release = resolve; });
        state.releaseStall = () => {
          release();
          state.stallGate = null;
          state.releaseStall = null;
        };
        return { release: () => state.releaseStall?.() };
      },
      // failListWith(status, message) — the page-level error line's producer.
      failListWith(status = 500, message = "Board face refused the list") {
        state.failList = { status, message };
        return face;
      },
      healList() {
        state.failList = null;
        return face;
      },
    };

    return await fn(face);
  } finally {
    state.releaseStall?.();
    if (state.tickTimer != null) realClearInterval(state.tickTimer);
    await new Promise((resolve) => server.close(resolve));
    if (previousHome === undefined) delete process.env.AOF_GLOBAL_HOME;
    else process.env.AOF_GLOBAL_HOME = previousHome;
    await rm(tmp, { recursive: true, force: true });
  }
}

export { DEFAULT_STREAM };

// test/fleet-terminal-view-producer-fed.test.mjs — QA-authored behavioural coverage
// for milestone 38 / story 06 / task 04 (BLOCKER F-38.06c), added at the task-04
// behavioural review (2026-07-23). Carries findings **F-38.06d** and **F-38.06e**.
//
// WHY THIS FILE EXISTS. Task 04's own traceability module
// (test/fleet-terminal-view-surface.test.mjs) proves each LINK of the three-link
// chain against a payload the TEST chooses:
//   - PERSIST is fed `buildAssignmentStatusFrame(..., { sessionId: "sess-1" })` —
//     the real frame BUILDER, but with the TEST deciding that a session id rides a
//     frame at all, and when,
//   - SURFACE is fed the row PERSIST wrote,
//   - RENDER is fed the row SURFACE projected,
//   - the STATE RAMP is fed by calling `terminalViewOnBytes/onClose/onError`
//     directly — a hand-driven transition, never one a real stream caused.
// Nothing in that module asks the ACTUAL PRODUCERS — `createMeshWorkerExecutionHandler`
// (which decides WHEN a captured session id rides a status frame) and the
// bridge/mirror/route (which decides what a browser socket ever OBSERVES) — whether
// the join key and the state ramp hold at the moment the operator needs them.
//
// That is this milestone's own defect class (ADR-008) at the FOURTH link: a
// component exercised against a fixture shaped to its own convenience, never
// against its real producer's SEQUENCE.
//
// PRODUCER-FED, END TO END, HEADLESS. These lanes wire, in process:
//   the REAL createMeshWorkerExecutionHandler (real worktree, real run-store, real
//   driveInteractiveClaudeSession over the house node-pty double)
//     -> the REAL buildAssignmentStatusFrame (worker-stream-client.mjs — exactly
//        what sendAssignmentStatus does to its arguments)
//     -> the REAL applyStreamFrame (control-stream-server.mjs) over a REAL store
//     -> the REAL queryGlobalMeshStatus shaping (/api/mesh/status)
//     -> the REAL resolveTerminalStream + view-state ramp the browser imports,
//   and, for the stream half, the REAL onOutputChunk bridge -> the REAL
//   buildTerminalFrameEnvelope -> the REAL mirror -> the REAL serveMeshUi
//   /ws/terminal-view route -> a REAL browser socket.
// No hand-built frame, no hand-built row, no hand-driven state transition, no
// hand-picked moment. The ONLY doubles are the house leaf seams every story-05/06
// test already uses (fake `which`, fake node-pty, injected transcript watch,
// scripted push exec) — and the transcript watch is injected to resolve PROMPTLY,
// i.e. the MOST FAVOURABLE case for the feature (a real watch resolves later, never
// earlier).
//
// REGISTERED in scripts/test.mjs (2026-07-23). QA authored these UNREGISTERED
// because two lanes were RED against the build under review and QA does not break
// the suite; both findings are now fixed (F-38.06d — the mid-run live report; and
// F-38.06e — the end-of-stream producer, which the fourth lane below extends to the
// `needs-input` outcome), so the whole module is a standing gate.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

import { createMeshWorkerExecutionHandler, NEEDS_INPUT_SENTINEL } from "../src/mesh-worker-execution.mjs";
import { buildAssignmentStatusFrame } from "../src/worker-stream-client.mjs";
import { applyStreamFrame } from "../src/control-stream-server.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { queryGlobalMeshStatus } from "../src/global-mesh-query.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { createTerminalMirror } from "../src/mesh-terminal-mirror.mjs";
import { buildTerminalFrameEnvelope, buildTerminalEndEnvelope } from "../src/mesh-terminal-relay-bridge.mjs";
import {
  withMeshWorkerExecFixture,
  markRepoPublished,
  seedNodeWorkspaceMembership,
  scriptedPushExec,
} from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";
import { seedAssignment, seedTargetNode } from "./support/mesh-assign-fixture.mjs";

import { resolveTerminalStream, terminalViewSocketUrl, NO_STREAM } from "../ui/src/fleet/terminal-view/stream.mjs";
import {
  initialTerminalViewState,
  terminalViewOnBytes,
  terminalViewOnClose,
  terminalViewOnError,
  describeTerminalViewState,
  TERMINAL_VIEW_STATES,
} from "../ui/src/fleet/terminal-view/view-state.mjs";

const NODE_ID = "worker-a";
const ASSIGNMENT_ID = "asg-live";
const NOW = "2026-07-23T10:00:00.000Z";
const LIVE_SESSION = "sess-live-1";

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

// The control node, in process: every frame the worker's own status emitter would
// put on the wire is built by the REAL builder and applied by the REAL handler over
// a REAL store — the same store the fleet read shape then reads.
function controlSide(home) {
  const applied = [];
  return {
    applied,
    // Byte-for-byte what worker-stream-client.mjs's sendAssignmentStatus does with
    // its arguments (build the frame, send it), with the control node's own
    // applyStreamFrame standing in for the socket hop.
    async sendAssignmentStatus(assignmentId, state, { runId, sessionId, code } = {}) {
      const frame = buildAssignmentStatusFrame(NODE_ID, assignmentId, state, { runId, sessionId, code, now: NOW });
      applied.push(frame);
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        await applyStreamFrame(store, frame, { now: NOW, nodeId: NODE_ID });
      } finally {
        store.close();
      }
      return { sent: true };
    },
  };
}

// The card's resolution, read the way the browser reads it: the REAL
// /api/mesh/status shaping, then the REAL resolver the component imports.
async function resolveCardStream({ home, itemRef }) {
  const status = await queryGlobalMeshStatus({ env: { AOF_GLOBAL_HOME: home }, now: NOW });
  const item = status.items.find((row) => row.ref === itemRef);
  const assignment = item?.assignment ?? null;
  return { assignment, stream: resolveTerminalStream(assignment) };
}

// Everything a dispatch needs on the control store: a member node, a published
// snapshot, and the assignment row the operator's `aof mesh assign` minted.
async function readyControlStore(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  await seedTargetNode({ home: fx.home }, {
    nodeId: NODE_ID, workspaceId: fx.workspaceId, projectRoot: fx.root, workDir: fx.workDir,
  });
  await seedAssignment({ home: fx.home }, {
    assignmentId: ASSIGNMENT_ID, itemRef: fx.itemRef, workspaceId: fx.workspaceId,
    targetNodeId: NODE_ID, issuer: "control-a", state: "assigned", assignedAt: NOW,
  });
  const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: fx.home } });
  try {
    await store.publishWorkspaceSnapshot(ws, { workspaceId: fx.workspaceId });
  } finally {
    store.close();
  }
  return ws;
}

// A minimal built-UI tree so serveMeshUi will serve (the same shape task 04's own
// multiplex lane stands up).
async function withFleetFace({ mirror }, fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-face-"));
  const root = path.join(tmp, "repo");
  const distRoot = path.join(tmp, "dist");
  const home = path.join(tmp, "home");
  let server;
  try {
    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
    await mkdir(path.join(meshUiDist(distRoot), "assets"), { recursive: true });
    await writeFile(path.join(meshUiDist(distRoot), "index.html"), "<!doctype html><html><body></body></html>\n", "utf8");
    await writeFile(path.join(meshUiDist(distRoot), "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
    ({ server } = await serveMeshUi({
      projectDir: root, port: 0, repoRoot: distRoot,
      globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
      terminalMirror: mirror,
    }));
    return await fn({ host: `127.0.0.1:${server.address().port}` });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
}

export const fleetTerminalViewProducerFedTests = [
  {
    // F-38.06d. The headline of task 04's own feature: "the operator watches a
    // dispatched run progress in real time FROM the control node" — i.e. WHILE it
    // is running.
    name: "task04/38-06 (F-38.06d) while the worker is STREAMING live PTY bytes, the card resolves THAT stream's (nodeId, sessionId) from the REAL read shape",
    run: () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyControlStore(fx);
      const control = controlSide(fx.home);
      // The terminal-BRIDGE producer, wired exactly as mesh-launcher.mjs wires it:
      // `onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, ...)`.
      // Each entry is a frame the fleet mirror would route under (nodeId, sessionId).
      const terminalFrames = [];
      let emitData = null;
      let emitExit = null;

      const { spawn } = createFakePtySpawn({
        onWrite: (handle) => {
          // The "agent" has been handed its command; it is now running and will
          // print as it works. Capture the emitters so the TEST drives the live
          // phase rather than racing it.
          emitData = handle.emitData;
          emitExit = handle.emitExit;
        },
      });

      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: control.sendAssignmentStatus,
        onOutputChunk: (chunk, sessionId) => { terminalFrames.push({ sessionId, bytes: String(chunk) }); },
        // The transcript watch resolves PROMPTLY — the most favourable timing the
        // feature can ever get (a real watch resolves later, never earlier).
        watchTranscriptSessionId: async () => LIVE_SESSION,
        globalWorkStoreOptions: { env: fx.env },
        pushExec: scriptedPushExec(),
        ptySpawn: spawn,
        which: createFakeWhich(["claude"]),
        now: () => NOW,
      });

      // Dispatch — deliberately NOT awaited: the run is LIVE for the whole middle of
      // this test, which is exactly the window the terminal-view exists to serve.
      const running = handler({
        kind: "directive", to: NODE_ID, assignmentId: ASSIGNMENT_ID, itemRef: fx.itemRef,
        workspaceId: fx.workspaceId, at: NOW, command: "/aof:refine 38/06 --autonomous",
      });

      for (let i = 0; i < 60 && emitData == null; i += 1) await tick();
      assert.ok(emitData != null, "precondition: the interactive session was spawned and handed its command");
      await tick();

      // The agent prints. THIS is the live tail the operator wants to watch.
      emitData("Reading DESIGN.md …\r\n");
      await tick();
      emitData("Editing src/global-mesh-query.mjs …\r\n");
      await tick();

      // PRECONDITION (the producer half): the bytes ARE flowing, keyed by the
      // captured session id — the mirror is routing them under (worker-a, sess-live-1).
      const keyed = terminalFrames.filter((frame) => frame.sessionId === LIVE_SESSION);
      assert.ok(
        keyed.length > 0,
        `precondition: the worker streams live PTY bytes keyed by its captured session id (frames so far: ${JSON.stringify(terminalFrames)})`,
      );

      // THE ASSERTION. At this exact moment — bytes flowing, run live — can the
      // browser card resolve the stream? Read through the REAL status shaping and
      // the REAL resolver, with nothing hand-built anywhere.
      const live = await resolveCardStream({ home: fx.home, itemRef: fx.itemRef });
      assert.ok(live.assignment, "the fleet read shape still carries the assignment while it runs");
      assert.equal(live.assignment.state, "running", "precondition: the card sees a RUNNING assignment");
      assert.equal(
        live.stream.resolved,
        true,
        `the card resolves the live stream while the run is streaming — instead it resolved NO stream (reason: ${live.stream.reason}); `
        + `the worker's live bytes are keyed ${LIVE_SESSION} but the assignment row surfaced sessionId=${JSON.stringify(live.assignment.sessionId)}. `
        + `Frames the REAL producer put on the wire so far: ${JSON.stringify(control.applied)}`,
      );
      assert.equal(live.stream.nodeId, NODE_ID);
      assert.equal(live.stream.sessionId, LIVE_SESSION, "and it resolves to the SAME session the live bytes are keyed by — the join key actually joins");

      // Let the run finish so the fixture can tear its worktree down.
      emitExit?.(0);
      await running;
    }),
  },
  {
    // The strictly-later half of F-38.06d: even if the live window is missed, the
    // id IS on the record by the time the run terminates. GREEN — recorded so the
    // fix is bounded to the live window and nothing already working is disturbed.
    name: "task04/38-06 (F-38.06d, bound) by the time the REAL producer reports a terminal state, the captured session id HAS reached the read shape",
    run: () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyControlStore(fx);
      const control = controlSide(fx.home);
      const { spawn } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: control.sendAssignmentStatus,
        watchTranscriptSessionId: async () => LIVE_SESSION,
        globalWorkStoreOptions: { env: fx.env },
        pushExec: scriptedPushExec(),
        ptySpawn: spawn,
        which: createFakeWhich(["claude"]),
        now: () => NOW,
      });
      await handler({
        kind: "directive", to: NODE_ID, assignmentId: ASSIGNMENT_ID, itemRef: fx.itemRef,
        workspaceId: fx.workspaceId, at: NOW, command: "/aof:refine 38/06 --autonomous",
      });

      const settled = await resolveCardStream({ home: fx.home, itemRef: fx.itemRef });
      assert.ok(settled.assignment, "the fleet read shape carries the finished assignment");
      assert.equal(
        settled.assignment.sessionId,
        LIVE_SESSION,
        `the terminal frame the REAL producer sent carried the captured session id, and it reached the read shape (frames: ${JSON.stringify(control.applied)})`,
      );
      assert.equal(settled.stream.resolved, true);
      assert.equal(settled.stream.sessionId, LIVE_SESSION);
      assert.notEqual(settled.stream.reason, NO_STREAM.NO_SESSION);
    }),
  },
  {
    // F-38.06e — the V9 row of task 04's OWN state-ramp Examples table
    // (`| the stream closes cleanly | ended — not a frozen pretend-live frame |`),
    // driven by its REAL producer instead of by a direct call to the reducer.
    //
    // The whole ramp is exercised here the way the component exercises it: a REAL
    // browser socket on the REAL /ws/terminal-view route feeding
    // terminalViewOnBytes / onClose / onError, over a REAL mirror fed by the REAL
    // worker driver's own onOutputChunk bridge. This lane is deliberately
    // INDEPENDENT of F-38.06d (it resolves its stream from a tuple, exactly as task
    // 04's own multiplex lane does), so it stays meaningful either way.
    name: "task04/38-06 (F-38.06e) when the worker's session ENDS, an open terminal-view stops reading `streaming` — a dead stream never keeps a live pulse",
    run: () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyControlStore(fx);
      const control = controlSide(fx.home);
      const mirror = createTerminalMirror();

      let emitData = null;
      let emitExit = null;
      const { spawn } = createFakePtySpawn({
        onWrite: (handle) => { emitData = handle.emitData; emitExit = handle.emitExit; },
      });

      await withFleetFace({ mirror }, async ({ host }) => {
        const handler = createMeshWorkerExecutionHandler({
          loadWs: () => Promise.resolve(ws),
          nodeId: NODE_ID,
          sendAssignmentStatus: control.sendAssignmentStatus,
          // THE REAL BRIDGE SHAPE (mesh-launcher.mjs:856) — each PTY chunk becomes a
          // real terminal-frame envelope applied to the real mirror, which is what
          // the control node's onTerminalFrame sink does one relay hop later.
          onOutputChunk: (chunk, sessionId) => { mirror.apply(buildTerminalFrameEnvelope(NODE_ID, sessionId, String(chunk))); },
          // THE REAL END-OF-STREAM SHAPE (mesh-launcher.mjs's sibling literal key,
          // `onSessionEnd: (sessionId) => client.sendTerminalEnd(sessionId)`), which
          // the driver calls from its ONE finish() settle point once the PTY is
          // gone. Same substitution as the byte hook above: the REAL envelope
          // builder applied to the REAL mirror, standing in for the fabric hop the
          // control node's onTerminalFrame sink performs. Nothing about the END is
          // hand-driven — the DRIVER decides when it fires.
          onSessionEnd: (sessionId) => { mirror.apply(buildTerminalEndEnvelope(NODE_ID, sessionId)); },
          watchTranscriptSessionId: async () => LIVE_SESSION,
          globalWorkStoreOptions: { env: fx.env },
          pushExec: scriptedPushExec(),
          ptySpawn: spawn,
          which: createFakeWhich(["claude"]),
          now: () => NOW,
        });

        const running = handler({
          kind: "directive", to: NODE_ID, assignmentId: ASSIGNMENT_ID, itemRef: fx.itemRef,
          workspaceId: fx.workspaceId, at: NOW, command: "/aof:refine 38/06 --autonomous",
        });

        // The card opens its terminal — the REAL resolver, the REAL url helper, the
        // REAL route.
        const stream = resolveTerminalStream({ targetNodeId: NODE_ID, sessionId: LIVE_SESSION });
        const socket = new WebSocket(terminalViewSocketUrl(stream, { protocol: "http:", host }));
        // The component's OWN reducer wiring (FleetTerminalView.tsx onmessage /
        // onclose / onerror), driven by a real socket rather than by hand.
        let view = initialTerminalViewState();
        socket.on("message", () => { view = terminalViewOnBytes(view); });
        socket.on("close", () => { view = terminalViewOnClose(view); });
        socket.on("error", () => { view = terminalViewOnError(view); });
        await new Promise((resolve, reject) => { socket.on("open", resolve); socket.on("error", reject); });

        try {
          for (let i = 0; i < 60 && emitData == null; i += 1) await tick();
          assert.ok(emitData != null, "precondition: the interactive session was spawned and handed its command");
          await tick();
          emitData("working …\r\n");
          for (let i = 0; i < 60 && view !== TERMINAL_VIEW_STATES.STREAMING; i += 1) await tick();
          assert.equal(view, TERMINAL_VIEW_STATES.STREAMING, "precondition: live bytes reached the open view, which reads streaming");
          assert.equal(describeTerminalViewState(view).live, true);

          // The agent's session ENDS — the run completes to `done`, the PTY is gone,
          // no byte will ever arrive on this stream again.
          emitExit(0);
          await running;
          const doneFrame = control.applied.find((frame) => frame.state === "done");
          assert.ok(doneFrame, "precondition: the REAL producer reported the session's terminal state");

          // Give the whole chain a generous window to tell the browser.
          for (let i = 0; i < 100 && view === TERMINAL_VIEW_STATES.STREAMING; i += 1) await tick();

          const descriptor = describeTerminalViewState(view);
          assert.notEqual(
            view,
            TERMINAL_VIEW_STATES.STREAMING,
            `the session has ENDED (the worker reported "${doneFrame.state}") but the open terminal-view still reads "${descriptor.text}" `
            + `(live=${descriptor.live}, motion=${descriptor.motion}) — a frozen pretend-live frame with a pulsing dot. DESIGN §Surface 3 V9 binds: `
            + "\"a dead stream must not masquerade as a live one\". Nothing on the terminal-frame path (buildTerminalFrameEnvelope carries only "
            + "{sessionId, bytes}) or on the fleet route (mesh-ui-serve.mjs unsubscribes on the BROWSER's close, never on the session's end) "
            + "ever tells the browser the session is over, so TERMINAL_VIEW_STATES.ENDED has no producer.",
          );
          assert.equal(descriptor.live, false, "and whatever it reads, it does not claim liveness the source no longer asserts");
          // …and POSITIVELY (R5/m03 — assert what SHOULD exist, not merely the
          // absence of the lie): it reads the ENDED form the DESIGN States table
          // names. Reached here ONLY through the transport — the driver's finish()
          // → the end envelope → the mirror → the route's ws.close() → this real
          // socket's own close event → the already-shipped reducer. The reducer is
          // never called by hand in this lane; that hand-driven transition is
          // exactly how F-38.06e survived review.
          assert.equal(view, TERMINAL_VIEW_STATES.ENDED, "the view reads the ENDED state (V9), reached from a REAL session end");
          assert.equal(descriptor.text, "stream ended", "and says so in WORDS — legible, never colour alone");
          assert.equal(descriptor.motion, "none", "with the live pulse gone");
        } finally {
          try { socket.close(); } catch { /* already closing */ }
        }
      });
    }),
  },
  {
    // F-38.06e, the THIRD outcome. ADR-014 inv.8 pins the end emission at the
    // driver's ONE settle point precisely BECAUSE `needs-input` reaches it too — via
    // the sentinel branch, which `term.kill()`s the PTY (a human resumes with a
    // FRESH `claude --resume` on a NEW session, never by reattaching). So that
    // stream is genuinely over even though the assignment's state stays `running` —
    // which is also why the REJECTED option (b) (closing subscribers off the
    // assignment's terminal state) would have painted "live" forever on exactly the
    // case where a human is being waited on. Driven end-to-end, same as above.
    name: "task04/38-06 (F-38.06e, needs-input) a session that ends on the needs-input sentinel ALSO ends its stream — the assignment stays `running`, the view does not",
    run: () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyControlStore(fx);
      const control = controlSide(fx.home);
      const mirror = createTerminalMirror();

      let emitData = null;
      const { spawn } = createFakePtySpawn({
        onWrite: (handle) => { emitData = handle.emitData; },
      });

      await withFleetFace({ mirror }, async ({ host }) => {
        const handler = createMeshWorkerExecutionHandler({
          loadWs: () => Promise.resolve(ws),
          nodeId: NODE_ID,
          sendAssignmentStatus: control.sendAssignmentStatus,
          onOutputChunk: (chunk, sessionId) => { mirror.apply(buildTerminalFrameEnvelope(NODE_ID, sessionId, String(chunk))); },
          onSessionEnd: (sessionId) => { mirror.apply(buildTerminalEndEnvelope(NODE_ID, sessionId)); },
          watchTranscriptSessionId: async () => LIVE_SESSION,
          globalWorkStoreOptions: { env: fx.env },
          pushExec: scriptedPushExec(),
          ptySpawn: spawn,
          which: createFakeWhich(["claude"]),
          now: () => NOW,
        });

        const running = handler({
          kind: "directive", to: NODE_ID, assignmentId: ASSIGNMENT_ID, itemRef: fx.itemRef,
          workspaceId: fx.workspaceId, at: NOW, command: "/aof:refine 38/06 --autonomous",
        });

        const stream = resolveTerminalStream({ targetNodeId: NODE_ID, sessionId: LIVE_SESSION });
        const socket = new WebSocket(terminalViewSocketUrl(stream, { protocol: "http:", host }));
        let view = initialTerminalViewState();
        socket.on("message", () => { view = terminalViewOnBytes(view); });
        socket.on("close", () => { view = terminalViewOnClose(view); });
        socket.on("error", () => { view = terminalViewOnError(view); });
        await new Promise((resolve, reject) => { socket.on("open", resolve); socket.on("error", reject); });

        try {
          for (let i = 0; i < 60 && emitData == null; i += 1) await tick();
          assert.ok(emitData != null, "precondition: the interactive session was spawned and handed its command");
          await tick();
          emitData("thinking about the ADR …\r\n");
          for (let i = 0; i < 60 && view !== TERMINAL_VIEW_STATES.STREAMING; i += 1) await tick();
          assert.equal(view, TERMINAL_VIEW_STATES.STREAMING, "precondition: live bytes reached the open view, which reads streaming");

          // The agent asks a blocking question and prints the sentinel: THIS
          // invocation's session is over (the driver kills the PTY), but the
          // assignment deliberately stays `running` — a human is being waited on.
          emitData(`${NEEDS_INPUT_SENTINEL}\r\n`);
          await running;
          const frames = control.applied.filter((frame) => frame.code === "needs-input");
          assert.equal(frames.length, 1, "precondition: the REAL producer reported the needs-input sentinel");
          assert.equal(frames[0].state, "running", "precondition: and the ASSIGNMENT state stays `running` — the human has not answered yet");

          for (let i = 0; i < 100 && view === TERMINAL_VIEW_STATES.STREAMING; i += 1) await tick();
          const descriptor = describeTerminalViewState(view);
          assert.equal(
            view,
            TERMINAL_VIEW_STATES.ENDED,
            `the PTY was killed at the needs-input sentinel, so no byte can ever arrive on this stream again, but the view reads "${descriptor.text}" `
            + `(live=${descriptor.live}, motion=${descriptor.motion}). The end must be emitted from the driver's ONE settle point, which covers this outcome too.`,
          );
          assert.equal(descriptor.live, false);
        } finally {
          try { socket.close(); } catch { /* already closing */ }
        }
      });
    }),
  },
];

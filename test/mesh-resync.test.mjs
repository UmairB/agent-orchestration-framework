// test/mesh-resync.test.mjs — the RESYNC transport, behaviourally (m43 / story 04,
// ADR-006 + ADR-010/R4.2, owed by ADR-014/E6).
//
// WHY THIS FILE EXISTS. The transport shipped with 483 lines of new node→node code and no
// behavioural test: its only exercise was two registry probes that hit `resync-no-owner`
// BEFORE any row, tick or frame existed, so `runResyncDispatchTick`, `applyResyncResultFrame`,
// `buildResyncFrame`, the worker's receive lane and the door's bounded poll were all
// unexecuted, and two of the door's codes were produced by nothing at all. The architect
// exercised the transport by hand at review and found it CORRECT — which is exactly why the
// test is owed: the behaviour is right today and nothing would tell us when it stops being.
// Model and shape: `test/mesh-recovery-push.test.mjs`, the flow this module mirrors.
//
// THE DISCIPLINE THIS MILESTONE KEEPS PAYING FOR — a green test that proves nothing. Every
// assertion below names an observable that ONLY the path under test can produce:
//   - the two failure branches BOTH write `state: "failed"`, so `failed` alone proves
//     nothing: each is pinned by its DETAIL CODE plus whether a frame left the server;
//   - the dispatched frame is pinned by its EXACT KEY SET, because "it carries no command
//     and no credential" is the property that makes this pull safe, and a frame that grew
//     one would still have the right kind;
//   - the authorization refusals are pinned by the row being BYTE-IDENTICAL afterwards
//     (state, detail AND updated_at), not merely by `applied: false` — an apply that wrote
//     and then reported failure would pass the weaker check;
//   - the door's self-owner and no-owner answers are pinned by NO REQUEST ROW EXISTING,
//     which no other branch can produce (every other answer writes one first);
//   - the resync target is pinned against an ACTIVE ASSIGNMENT TO A DIFFERENT NODE, so a
//     regression to "ask whoever it was assigned to" fails here rather than passing by
//     coincidence on a fixture where the two nodes are the same;
//   - the request-leg bound is MEASURED in virtual milliseconds off the door's own poll
//     loop and compared against the cadence it waits on — the ADR-014/E5 defect, whose
//     whole point is that the old code passed every test it had.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openGlobalWorkProjectionStore, upsertWorkItems } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment } from "../src/assignment-record.mjs";
import { applyStreamFrame } from "../src/control-stream-server.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import { resyncCommand } from "../src/commands/resync.mjs";
import { DEFAULT_SYNC_CADENCE_SECONDS } from "../src/mesh-sync-cadence.mjs";
import {
  RESYNC_KIND,
  RESYNC_RESULT_KIND,
  RESYNC_REQUESTED,
  RESYNC_DISPATCHED,
  RESYNC_PUSHED,
  RESYNC_FAILED,
  RESYNC_OK,
  RESYNC_NO_OWNER,
  RESYNC_OWNER_NOT_CONNECTED,
  RESYNC_OWNER_UNREACHABLE,
  RESYNC_OWNER_IS_SELF,
  RESYNC_PENDING,
  requestResync,
  readResync,
  listResyncRequests,
  markResyncState,
  buildResyncFrame,
  buildResyncResultFrame,
  applyResyncResultFrame,
  runResyncDispatchTick,
  resyncRequestId,
} from "../src/mesh-resync.mjs";

const WS = "ws-resync-1";
const OTHER_WS = "ws-resync-2";
const REF = "43/04";
const CONTROL = "aof-control";
const OWNER = "umairs-mac-mini";
const OTHER = "aof-wsl";
const NOW = "2026-08-03T12:00:00.000Z";

// A hermetic store under a throwaway AOF_GLOBAL_HOME — never the real ~/.aof.
async function withIsolatedStore(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-resync-"));
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn({ store, env: { AOF_GLOBAL_HOME: home } });
  } finally {
    store.close?.();
    await rm(home, { recursive: true, force: true });
  }
}

// The dispatch tick close()s its own store in a finally; the test wants to keep reading the
// SAME handle afterwards.
function noClose(store) {
  return { db: store.db, paths: store.paths, close() {} };
}

// A fake control stream server, `mesh-recovery-push.test.mjs`'s verbatim: directiveTargets
// resolves a connected node to a live-looking socket, dispatchDirective records the frame and
// reports `sent` for a connected target (the SAME shape sendDirective returns). `throwOn`
// makes the send itself blow up — the transport-fault leg, which is a different branch from
// a `{ sent: false }` refusal and must be tested as one.
function fakeStreamServer({ connected = [], throwOn = [] } = {}) {
  const conn = new Set(connected);
  const boom = new Set(throwOn);
  const dispatched = [];
  return {
    dispatched,
    directiveTargets: { get: (nodeId) => (conn.has(nodeId) ? { readyState: 1 } : null) },
    dispatchDirective: (frame) => {
      if (boom.has(frame?.to)) throw Object.assign(new Error("socket closed mid-send"), { code: "socket-closed" });
      if (conn.has(frame?.to)) { dispatched.push(frame); return { sent: true }; }
      return { sent: false, code: "assignment-target-not-connected" };
    },
  };
}

// captureLog(fn) — the daemon's log channel is `console.error` (the recovery-push tick's
// channel verbatim), so narration is observable. ADR-014/E7: this tick's terminal `failed` is
// written to a row the requester's bounded poll may already have given up on, so a drain that
// narrated nothing would make the CAUSE of a failure unrecoverable.
async function captureLog(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(" ")); };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

// A cached row with a real AUTHOR, written through the shared upsert seam (the same door the
// control's publish and a worker's delta both write through) — never a hand-poked column, so
// "who owns this row" is the fact the production reader reads.
function seedRow(store, { ref = REF, workspaceId = WS, node = OWNER, at = "2026-08-03T11:45:00.000Z" } = {}) {
  return upsertWorkItems(store, workspaceId, [{
    ref,
    type: ref.includes("/") ? "story" : "milestone",
    slug: "staleness-and-resync",
    status: "in-progress",
    title: "Staleness, never eviction",
    parent: ref.includes("/") ? ref.split("/")[0] : null,
    sourcePath: `wiki/work/43_m/stories/04_s/STORY.md`,
  }], { nodeId: node, authority: "reported", syncedAt: at });
}

// The command's ctx: a workspace with a pinned mesh identity (so no path derivation is
// involved), the isolated store injected, and the poll knobs the bounded leg needs.
function doorCtx(store, { nodeId = CONTROL, workspaceId = WS, cadenceSeconds, ...rest } = {}) {
  const mesh = { workspaceId, nodeId };
  if (cadenceSeconds !== undefined) mesh.sync = { cadenceSeconds };
  return {
    workspace: { projectRoot: "/x", workDir: "/x", config: { mesh } },
    openGlobalWorkProjectionStore: async () => noClose(store),
    now: NOW,
    ...rest,
  };
}

// A VIRTUAL CLOCK for the door's bounded poll: `sleep` never waits, it advances a counter and
// optionally settles the row once enough simulated time has passed. That is what makes "the
// answer arrived one full drain cadence after the request" a test rather than a 15-second
// wall-clock sleep.
function virtualClock({ store, settleAfterMs = null, state = RESYNC_DISPATCHED, detail = null } = {}) {
  const clock = { elapsedMs: 0, sleeps: 0 };
  clock.sleep = async (ms) => {
    clock.elapsedMs += ms;
    clock.sleeps += 1;
    if (settleAfterMs != null && clock.elapsedMs >= settleAfterMs) {
      markResyncState(store, resyncRequestId(WS, REF), state, { now: NOW, detail });
    }
  };
  return clock;
}

export const meshResyncTests = [
  // ────────────────────────────────── the store surface ──────────────────────────────────
  {
    name: "resync store: the request is keyed by (workspace, ref) — two refs and two workspaces are separate rows; a re-request after a terminal outcome resets it to `requested` and clears the stale detail",
    run: async () => withIsolatedStore(async ({ store }) => {
      const row = requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      assert.equal(row.state, RESYNC_REQUESTED);
      assert.equal(row.targetNodeId, OWNER);
      assert.equal(row.detail, null);

      // The SAME ref in another workspace, and another ref in this one, are separate
      // requests — the key is the pair, not the ref.
      requestResync(store, { workspaceId: OTHER_WS, itemRef: REF, targetNodeId: OTHER, now: NOW });
      requestResync(store, { workspaceId: WS, itemRef: "43/05", targetNodeId: OTHER, now: NOW });
      assert.equal(readResync(store, OTHER_WS, REF).targetNodeId, OTHER, "a same-ref request in another workspace is its own row");
      assert.equal(readResync(store, WS, REF).targetNodeId, OWNER, "…and does not disturb this one");
      assert.equal(listResyncRequests(store).length, 3, "all three are drainable");

      // A terminal row is not wedged: a re-request resets it and drops the stale detail, so
      // the operator's second click re-drives the whole flow.
      markResyncState(store, resyncRequestId(WS, REF), RESYNC_FAILED, { now: NOW, detail: RESYNC_OWNER_NOT_CONNECTED });
      assert.equal(readResync(store, WS, REF).detail, RESYNC_OWNER_NOT_CONNECTED);
      const reset = requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: "2026-08-03T12:05:00.000Z" });
      assert.equal(reset.state, RESYNC_REQUESTED, "a re-request resets a terminal row");
      assert.equal(reset.detail, null, "…and clears the previous attempt's code");
      assert.equal(reset.requestedAt, "2026-08-03T12:05:00.000Z", "…re-stamping the request instant");
      assert.equal(
        listResyncRequests(store).filter((request) => request.itemRef === REF && request.workspaceId === WS).length,
        1,
        "a second click never stacks a second request for the same item (DESIGN: exactly ONE resync request per episode)",
      );
    }),
  },
  {
    name: "resync store: an unknown state is REFUSED with a code (never a silent bad write), and a state write against a vanished row is a no-op rather than a crash",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      assert.throws(
        () => markResyncState(store, resyncRequestId(WS, REF), "half-done", { now: NOW }),
        (error) => error?.code === "resync-state-invalid",
        "an unknown lifecycle state is refused with a code",
      );
      assert.equal(readResync(store, WS, REF).state, RESYNC_REQUESTED, "…and the row is untouched by the refusal");
      assert.equal(markResyncState(store, "no-such-request", RESYNC_PUSHED, { now: NOW }), null, "a write against a vanished row is null, never a throw");
      assert.equal(readResync(store, WS, "43/99"), null, "an unrequested item reads as null");
    }),
  },

  // ─────────────────────────────── the control's dispatch tick ───────────────────────────
  {
    name: "resync tick: a connected owner is sent a `work-resync` DOWN-frame carrying ONLY (kind, to, workspaceId, itemRef, at) — no command, no credential — and the row is marked `dispatched`",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      const streamServer = fakeStreamServer({ connected: [OWNER] });

      let result = null;
      const narration = await captureLog(async () => {
        result = await runResyncDispatchTick(streamServer, {
          now: "2026-08-03T12:00:05.000Z",
          openStore: async () => noClose(store),
        });
      });

      assert.equal(result.drained, 1, "the tick drained the one requested row");
      assert.equal(narration.length, 1, "the tick narrates the outcome on the daemon's log channel");
      assert.match(narration[0], /\[mesh-resync\].*43\/04.*umairs-mac-mini.*dispatched/, "…naming the item, the owner and what happened");
      assert.equal(streamServer.dispatched.length, 1, "exactly one frame left the server");
      const frame = streamServer.dispatched[0];
      // THE EXACT KEY SET is the assertion, not just the kind: "it carries NO credential and
      // NO command … that is why this pull is safe — it can only ever cause the owner to say
      // what it was going to say". A frame that grew a command would still have the right
      // kind and the right target.
      assert.deepEqual(Object.keys(frame).sort(), ["at", "itemRef", "kind", "to", "workspaceId"], "the frame carries five fields and nothing else — no command, no credential, no scope");
      assert.equal(frame.kind, RESYNC_KIND);
      assert.equal(frame.kind, "work-resync", "…spelled on the wire exactly as the worker's receive branch matches it");
      assert.equal(frame.to, OWNER, "addressed to the row's OWN reporting node");
      assert.equal(frame.workspaceId, WS);
      assert.equal(frame.itemRef, REF);
      assert.equal(frame.at, "2026-08-03T12:00:05.000Z", "stamped with the tick's own instant");
      assert.deepEqual(frame, buildResyncFrame(OWNER, { workspaceId: WS, itemRef: REF, at: "2026-08-03T12:00:05.000Z" }), "…and it is the shared builder's frame, not a re-spelled literal");

      const row = readResync(store, WS, REF);
      assert.equal(row.state, RESYNC_DISPATCHED, "the row records DESIGN's `accepted`");
      assert.equal(row.detail, null, "…with no failure code attached");
      assert.equal(row.updatedAt, "2026-08-03T12:00:05.000Z");
    }),
  },
  {
    name: "resync tick: an owner holding no socket is marked `failed` + `resync-owner-not-connected` on the FIRST tick — nothing is dispatched, and the row is NOT left `requested` to retry (the one deliberate difference from recovery-push)",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      const streamServer = fakeStreamServer({ connected: [] }); // the owner is offline

      const narration = await captureLog(() => runResyncDispatchTick(streamServer, { now: NOW, openStore: async () => noClose(store) }));

      assert.equal(streamServer.dispatched.length, 0, "nothing was sent — there was no socket to send on");
      // The requester's bounded poll may already have given up when this lands, so the log
      // channel is the only place this cause survives.
      assert.equal(narration.length, 1, "the failure is narrated, not only written to a row nobody reads again");
      assert.match(narration[0], new RegExp(`\\[mesh-resync\\].*${REF}.*${OWNER}.*${RESYNC_OWNER_NOT_CONNECTED}`), "…carrying the item, the owner and the code");
      const row = readResync(store, WS, REF);
      assert.equal(row.state, RESYNC_FAILED);
      // BOTH failure branches write `failed`, so the code is the whole assertion: this row is
      // "we looked for a socket and found none", never "the send did not complete".
      assert.equal(row.detail, RESYNC_OWNER_NOT_CONNECTED, "the detail names the connectivity fact that was actually tested");
      assert.notEqual(row.detail, RESYNC_OWNER_UNREACHABLE, "…and not the send-failed code, which nothing here attempted");
      assert.notEqual(row.state, RESYNC_REQUESTED, "an operator is WAITING on this answer: it is terminal on the first tick, never a silent retry ladder");
      assert.deepEqual(listResyncRequests(store), [], "…so the next tick has nothing to re-drain");
    }),
  },
  {
    name: "resync tick: a dispatch that does not complete — whether the send THROWS or returns `{ sent: false }` — is marked `failed` + `resync-owner-unreachable`, distinct from the not-connected code",
    run: async () => withIsolatedStore(async ({ store }) => {
      // (a) the send THROWS on a socket that looked live a moment ago.
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      const throwing = fakeStreamServer({ connected: [OWNER], throwOn: [OWNER] });
      const narration = await captureLog(() => runResyncDispatchTick(throwing, { now: NOW, openStore: async () => noClose(store) }));
      const thrown = readResync(store, WS, REF);
      assert.equal(thrown.state, RESYNC_FAILED, "a throwing dispatch never escapes the tick");
      assert.equal(thrown.detail, RESYNC_OWNER_UNREACHABLE, "…and is reported as unreachable, not as not-connected");
      assert.equal(throwing.dispatched.length, 0);
      assert.match(narration[0] ?? "", /socket-closed/, "the narration names the CAUSE the swallowed exception carried — otherwise it is lost with the catch");

      // (b) the send REFUSES — a routing answer, not an exception. Same verdict, and the
      // tick must not confuse it with the no-socket case either.
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      const refusing = {
        directiveTargets: { get: () => ({ readyState: 1 }) }, // a target that LOOKS connected…
        dispatchDirective: () => ({ sent: false, code: "assignment-target-not-connected" }), // …but the route refuses
      };
      await runResyncDispatchTick(refusing, { now: NOW, openStore: async () => noClose(store) });
      const refused = readResync(store, WS, REF);
      assert.equal(refused.state, RESYNC_FAILED);
      assert.equal(refused.detail, RESYNC_OWNER_UNREACHABLE, "a `{ sent: false }` route answer is the same designed state as a throw");
    }),
  },
  {
    name: "resync tick: it drains only `requested` rows — a dispatched row is never re-sent on the next tick — and one row's failure never stops another row's dispatch",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      requestResync(store, { workspaceId: WS, itemRef: "43/05", targetNodeId: OTHER, now: NOW });
      const streamServer = fakeStreamServer({ connected: [OWNER] }); // OTHER is offline

      const first = await runResyncDispatchTick(streamServer, { now: NOW, openStore: async () => noClose(store) });
      assert.equal(first.drained, 2, "both requests were considered in one tick");
      assert.equal(streamServer.dispatched.length, 1, "the connected owner got its frame…");
      assert.equal(streamServer.dispatched[0].itemRef, REF);
      assert.equal(readResync(store, WS, "43/05").detail, RESYNC_OWNER_NOT_CONNECTED, "…and the offline one its own verdict — neither outcome swallowed the other");

      // The second tick has nothing to do: `dispatched` is in flight, `failed` is terminal.
      const second = await runResyncDispatchTick(streamServer, { now: "2026-08-03T12:00:30.000Z", openStore: async () => noClose(store) });
      assert.equal(second.drained, 0);
      assert.equal(streamServer.dispatched.length, 1, "no second frame for the same episode — exactly ONE request left the app");
      assert.equal(readResync(store, WS, REF).updatedAt, NOW, "…and the in-flight row was not re-stamped by a tick that did nothing");
    }),
  },

  // ─────────────────────── the owner's result frame + its authorization ───────────────────
  {
    name: "resync result: the T6 gate — a result on the WRONG connection is refused `resync-result-not-owner` and leaves the row BYTE-IDENTICAL, including when the frame self-declares the owner's id",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      markResyncState(store, resyncRequestId(WS, REF), RESYNC_DISPATCHED, { now: "2026-08-03T12:00:05.000Z" });
      const before = readResync(store, WS, REF);

      // (a) a result honestly arriving on another node's connection.
      const honest = applyResyncResultFrame(
        store,
        buildResyncResultFrame(OTHER, { workspaceId: WS, itemRef: REF, ok: true, now: "2026-08-03T12:00:06.000Z" }),
        { nodeId: OTHER, now: "2026-08-03T12:00:06.000Z" },
      );
      assert.equal(honest.applied, false);
      assert.equal(honest.code, "resync-result-not-owner");

      // (b) THE SPOOF: the frame self-declares the owner's id, but the CONNECTION is
      // someone else's. The connection wins — a frame can claim anything.
      const spoof = applyResyncResultFrame(
        store,
        { kind: RESYNC_RESULT_KIND, nodeId: OWNER, workspaceId: WS, itemRef: REF, ok: true },
        { nodeId: OTHER, now: "2026-08-03T12:00:07.000Z" },
      );
      assert.equal(spoof.applied, false);
      assert.equal(spoof.code, "resync-result-not-owner", "the self-declared node id never outranks the connection's authenticated one");

      // The row is byte-identical — not merely "still dispatched". An apply that wrote and
      // then reported failure would pass a weaker check.
      assert.deepEqual(readResync(store, WS, REF), before, "neither refusal touched the row: same state, same detail, same updated_at");

      // …and the REAL owner's result settles it.
      const real = applyResyncResultFrame(
        store,
        buildResyncResultFrame(OWNER, { workspaceId: WS, itemRef: REF, ok: true, now: "2026-08-03T12:00:08.000Z" }),
        { nodeId: OWNER, now: "2026-08-03T12:00:08.000Z" },
      );
      assert.equal(real.applied, true);
      assert.equal(readResync(store, WS, REF).state, RESYNC_PUSHED);
    }),
  },
  {
    name: "resync result: a worker-reported failure flips the row `failed` carrying the reported code; an unknown request and a malformed frame are coded skips that write nothing",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      markResyncState(store, resyncRequestId(WS, REF), RESYNC_DISPATCHED, { now: NOW });

      const failed = applyResyncResultFrame(
        store,
        buildResyncResultFrame(OWNER, { workspaceId: WS, itemRef: REF, ok: false, code: "resync-push-failed", now: NOW }),
        { nodeId: OWNER, now: "2026-08-03T12:01:00.000Z" },
      );
      assert.equal(failed.applied, true);
      const row = readResync(store, WS, REF);
      assert.equal(row.state, RESYNC_FAILED);
      assert.equal(row.detail, "resync-push-failed", "the worker's own code is what the row carries — never a generic failure");

      // A result for a request that was never made (or was made for another workspace) is a
      // coded skip, and creates nothing.
      const unknown = applyResyncResultFrame(
        store,
        buildResyncResultFrame(OWNER, { workspaceId: OTHER_WS, itemRef: REF, ok: true, now: NOW }),
        { nodeId: OWNER, now: NOW },
      );
      assert.equal(unknown.code, "resync-result-unknown-request", "the request key includes the workspace — another workspace's result is not this row's");
      assert.equal(readResync(store, OTHER_WS, REF), null, "…and no row was conjured to hold it");

      const malformed = applyResyncResultFrame(store, { kind: RESYNC_RESULT_KIND, ok: true }, { nodeId: OWNER });
      assert.equal(malformed.applied, false);
      assert.equal(malformed.code, "resync-result-invalid", "a frame with no workspace/ref is refused, never guessed at");
    }),
  },
  {
    name: "resync result: the frame settles the row through the REAL control-stream dispatch (applyStreamFrame's own kind branch), not only through the apply function directly",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      markResyncState(store, resyncRequestId(WS, REF), RESYNC_DISPATCHED, { now: NOW });

      const applied = await applyStreamFrame(
        store,
        buildResyncResultFrame(OWNER, { workspaceId: WS, itemRef: REF, ok: true, now: NOW }),
        { nodeId: OWNER, now: "2026-08-03T12:02:00.000Z" },
      );
      assert.equal(applied.applied, true, "the control-stream server routes `work-resync-result` to the resync apply");
      assert.equal(readResync(store, WS, REF).state, RESYNC_PUSHED);
      // …and the gate holds on that path too: the wiring did not lose the authorization.
      requestResync(store, { workspaceId: WS, itemRef: REF, targetNodeId: OWNER, now: NOW });
      const spoofed = await applyStreamFrame(
        store,
        { kind: RESYNC_RESULT_KIND, nodeId: OWNER, workspaceId: WS, itemRef: REF, ok: true },
        { nodeId: OTHER, now: NOW },
      );
      assert.equal(spoofed.code, "resync-result-not-owner", "…including the connection gate, on the production route");
      assert.equal(readResync(store, WS, REF).state, RESYNC_REQUESTED);
    }),
  },
  {
    name: "resync worker lane: a `work-resync` DOWN-frame reaches the registered onResync handler and no other lane's; the reply is a `work-resync-result` UP-frame stamped with THIS node's id",
    run: async () => {
      let deliver = null;
      const sent = [];
      const transport = {
        onMessage(fn) { deliver = fn; },
        connect: async () => ({}),
        send: async (_handle, frame) => { sent.push(frame); },
      };
      const client = createWorkerStreamClient({ transport, nodeId: OWNER, workspaceId: WS, now: () => NOW });
      assert.ok(deliver, "the client registered its receive listener");

      // Unregistered: the frame is dropped silently, never a crash.
      deliver(JSON.stringify(buildResyncFrame(OWNER, { workspaceId: WS, itemRef: REF, at: NOW })));

      const received = [];
      client.onResync((frame) => received.push(frame));
      deliver(JSON.stringify(buildResyncFrame(OWNER, { workspaceId: WS, itemRef: REF, at: NOW })));
      assert.equal(received.length, 1, "the resync frame reaches the registered handler");
      assert.equal(received[0].itemRef, REF, "…parsed and whole");
      assert.equal(received[0].workspaceId, WS);

      // Another kind never lands in this lane, and neither does a malformed payload.
      deliver(JSON.stringify({ kind: "directive", to: OWNER, assignmentId: "a1", at: NOW }));
      deliver("{not json");
      assert.equal(received.length, 1, "no other kind and no malformed frame reaches the resync handler");

      await client.sendResyncResult({ workspaceId: WS, itemRef: REF, ok: true });
      const reply = sent.at(-1);
      assert.equal(reply.kind, RESYNC_RESULT_KIND);
      assert.equal(reply.nodeId, OWNER, "the reply is stamped with the CLIENT's own node id, not the frame's");
      assert.equal(reply.workspaceId, WS);
      assert.equal(reply.itemRef, REF);
      assert.equal(reply.ok, true);
      assert.ok(!("code" in reply), "no code rides a successful reply — `code` is additive");

      await client.sendResyncResult({ workspaceId: WS, itemRef: REF, ok: false, code: "resync-push-failed" });
      assert.equal(sent.at(-1).ok, false);
      assert.equal(sent.at(-1).code, "resync-push-failed", "a failure reply carries the worker's own code");
    },
  },

  // ────────────────────────────────── the work:resync door ───────────────────────────────
  {
    name: "resync door: a row nobody has reported is refused `resync-no-owner` — and NO request row is written, because there was nobody to ask",
    run: async () => withIsolatedStore(async ({ store }) => {
      // A pre-v8 row: present in the cache, no author. (Written straight to the columns —
      // the shared seam cannot produce an unattributed row, which is the point of it.)
      store.db.prepare(`
        INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path, node_id, updated_at)
        VALUES (?, ?, 'story', 'staleness', 'in-progress', 'Staleness', '43', 'x/STORY.md', NULL, NULL)
      `).run(WS, REF);

      const result = await resyncCommand.run({ ref: REF }, doorCtx(store));
      assert.equal(result.ok, false);
      assert.equal(result.code, RESYNC_NO_OWNER, "DESIGN's `refused` — the one destructive outcome, a fault we own");
      assert.equal(result.ref, REF);
      assert.equal(result.node, null, "…naming no node, because there is none");
      assert.equal(readResync(store, WS, REF), null, "nothing was queued: a request with no target would sit in the tick forever");

      // A ref the cache has never held at all lands in the same place, honestly.
      const missing = await resyncCommand.run({ ref: "43/99" }, doorCtx(store));
      assert.equal(missing.code, RESYNC_NO_OWNER);
      assert.equal(readResync(store, WS, "43/99"), null);
    }),
  },
  {
    name: "resync door: a row THIS node authored answers `resync-owner-is-self` (muted) — never `resync-owner-not-connected`, which names a connectivity fact nothing tested, and never the destructive `resync-no-owner`",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedRow(store, { node: CONTROL }); // the control's own publication
      const result = await resyncCommand.run({ ref: REF }, doorCtx(store, { nodeId: CONTROL }));

      assert.equal(result.ok, false, "there is nothing to wait for, so the call did not succeed");
      assert.equal(result.code, RESYNC_OWNER_IS_SELF, "the fifth code (ADR-014/E2): the case makes no node→node call, so it cannot wear a call's outcome");
      assert.notEqual(result.code, RESYNC_OWNER_NOT_CONNECTED, "…specifically NOT the connectivity code — no socket was ever looked for");
      assert.notEqual(result.code, RESYNC_NO_OWNER, "…and not the destructive refusal — there IS an owner and nothing was rejected");
      assert.equal(result.node, CONTROL, "it names the owner, which is this node");
      assert.match(result.message, /publish tick/, "…and the message says what actually refreshes the row, so the operator looks locally rather than at the network");
      assert.match(result.message, /still readable/, "…while stating the cached copy is intact (the muted tone rule)");

      assert.equal(readResync(store, WS, REF), null, "no request row was written — there is no peer to dispatch to, so nothing is left to time out");
      assert.deepEqual(listResyncRequests(store), [], "…and the control tick has nothing to drain");
    }),
  },
  {
    name: "resync door: the request targets the row's OWN reporting node — not the node the item is assigned to, and not a presence lookup",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedRow(store, { node: OWNER });
      // …while the item is ACTIVELY ASSIGNED to a different node. "Ask whoever it was
      // assigned to" is the plausible wrong implementation, and this is the fixture that
      // tells the two apart.
      insertAssignment(store, assembleAssignmentRecord({
        assignmentId: "asg-1", itemRef: REF, workspaceId: WS, targetNodeId: OTHER, issuer: "control", state: "assigned", now: NOW,
      }));

      const result = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 1, timeoutMs: 0 }));
      assert.equal(result.node, OWNER, "the answer names the reporting node");
      const queued = readResync(store, WS, REF);
      assert.equal(queued.targetNodeId, OWNER, "and the queued request is aimed at the node that REPORTED the row…");
      assert.notEqual(queued.targetNodeId, OTHER, "…never at the assignment's target node");
      assert.equal(queued.state, RESYNC_REQUESTED, "…waiting for the control daemon's tick to drain it");
    }),
  },
  {
    name: "resync door: `dispatched` (and a later `pushed`) is the answer to the question this door asks — ok + `resync-requested`, a claim about the CALL and never about the data",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedRow(store, { node: OWNER });
      // The daemon settles the row between polls, exactly as the real tick would.
      const clock = virtualClock({ store, settleAfterMs: 400 });
      const result = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 200, sleep: clock.sleep }));

      assert.equal(result.ok, true, "the request reached the owner");
      assert.equal(result.code, RESYNC_OK);
      assert.equal(result.code, "resync-requested", "…DESIGN's `accepted`, spelled for the surface");
      assert.equal(result.node, OWNER);
      assert.match(result.message, /Asked umairs-mac-mini to push/, "the message reports the CALL");
      assert.doesNotMatch(result.message, /refreshed|up to date|now fresh|resynced/i, "…and never claims the DATA arrived (there is no success toast on any face)");
      assert.equal(readResync(store, WS, REF).state, RESYNC_DISPATCHED, "the door answered off the row the daemon actually settled");

      // The owner's own later `pushed` is equally an accepted call, and is not a data claim
      // either — only a fresher syncedAt on the list response proves that.
      const pushed = virtualClock({ store, settleAfterMs: 200, state: RESYNC_PUSHED });
      const afterPush = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 200, sleep: pushed.sleep }));
      assert.equal(afterPush.ok, true);
      assert.equal(afterPush.code, RESYNC_OK, "`pushed` is the same accepted answer — the door reports the call, and the state it reached does not change what it may claim");
    }),
  },
  {
    name: "resync door: the tick's two failure codes reach the operator verbatim — a `failed` row detailed `resync-owner-unreachable` reports unreachable, and one detailed not-connected reports not-connected",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedRow(store, { node: OWNER });

      const unreachable = virtualClock({ store, settleAfterMs: 200, state: RESYNC_FAILED, detail: RESYNC_OWNER_UNREACHABLE });
      const first = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 200, sleep: unreachable.sleep }));
      assert.equal(first.ok, false);
      assert.equal(first.code, RESYNC_OWNER_UNREACHABLE, "the tick's code is what the operator is told");
      assert.match(first.message, /unchanged and still readable/, "…and the cached copy is never presented as lost");

      const notConnected = virtualClock({ store, settleAfterMs: 200, state: RESYNC_FAILED, detail: RESYNC_OWNER_NOT_CONNECTED });
      const second = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 200, sleep: notConnected.sleep }));
      assert.equal(second.code, RESYNC_OWNER_NOT_CONNECTED, "…and the two failure codes are not collapsed into one");
      assert.match(second.message, /not connected/);
    }),
  },
  {
    // ADR-014/E5 — the defect this suite exists to stop coming back. The bound is DERIVED
    // from the cadence the drain runs at; a literal shorter than that cadence manufactures
    // "no answer" for roughly one healthy request in three.
    name: "resync door: the request-leg bound is DERIVED from `mesh.sync.cadenceSeconds` and strictly EXCEEDS it — measured off the door's own poll loop, for the default, a configured and a malformed cadence",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedRow(store, { node: OWNER });

      // The bound is observable: with a virtual clock that never settles the row, the door
      // returns `resync-pending` after exactly its own timeout of simulated time.
      async function measureBoundMs(cadenceSeconds) {
        const clock = virtualClock({ store }); // never settles
        const result = await resyncCommand.run({ ref: REF }, doorCtx(store, { cadenceSeconds, pollMs: 1000, sleep: clock.sleep }));
        assert.equal(result.code, RESYNC_PENDING, "an unanswered request always terminates — never an indefinite spinner");
        assert.equal(result.ok, false);
        return clock.elapsedMs;
      }

      for (const [label, cadenceSeconds, effective] of [
        ["unset — the documented default", undefined, DEFAULT_SYNC_CADENCE_SECONDS],
        ["the default, configured explicitly", 15, 15],
        ["a slowed tick", 60, 60],
        ["a fast tick (DESIGN's 10s floor still applies)", 2, 2],
        ["malformed — falls back to the default", "soon", DEFAULT_SYNC_CADENCE_SECONDS],
      ]) {
        const boundMs = await measureBoundMs(cadenceSeconds);
        assert.ok(
          boundMs > effective * 1000,
          `${label}: the bound (${boundMs}ms) must strictly exceed the drain cadence it waits on (${effective}s) — a bound shorter than its cadence measures the clock, not the world`,
        );
        assert.ok(boundMs >= 10_000, `${label}: DESIGN's 10s request round trip is the floor, never the ceiling`);
      }

      // …and it SCALES with the knob rather than being one bigger literal: a slowed tick
      // gets a proportionally longer bound.
      assert.ok(await measureBoundMs(60) > await measureBoundMs(15), "slowing the tick lengthens the bound — the derivation is live, not a constant that happens to fit today");
    }),
  },
  {
    name: "resync door: an answer that lands one FULL drain cadence after the request is reported as accepted — the same episode under DESIGN's old 10s literal reports `resync-pending` (the E5 defect, pinned)",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedRow(store, { node: OWNER });
      const cadenceMs = DEFAULT_SYNC_CADENCE_SECONDS * 1000;

      // The realistic healthy case: the request arrives just after a tick, so the drain
      // picks it up a whole cadence later and the row goes `dispatched` at ~15s.
      const late = virtualClock({ store, settleAfterMs: cadenceMs });
      const derived = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 1000, sleep: late.sleep }));
      assert.equal(derived.ok, true, "a healthy request whose dispatch lands one cadence later is reported ACCEPTED");
      assert.equal(derived.code, RESYNC_OK);
      assert.ok(late.elapsedMs >= cadenceMs, `the answer really did arrive a full cadence after the request (${late.elapsedMs}ms)`);

      // The counterfactual, same fixture, only the bound differs: the retired 10s literal
      // gives up before the drain has run, and the CLI face turns that into a non-zero exit
      // on a working system.
      const underOldBound = virtualClock({ store, settleAfterMs: cadenceMs });
      const stale = await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 1000, timeoutMs: 10_000, sleep: underOldBound.sleep }));
      assert.equal(stale.code, RESYNC_PENDING, "the 10s bound manufactures `no answer` for exactly this healthy episode");
      assert.throws(() => resyncCommand.cli.render(stale), (error) => error?.code === RESYNC_PENDING, "…which the CLI face renders as a coded failure (a non-zero exit on a working system)");
    }),
  },
  {
    name: "resync door: a workspace with no mesh identity has no cache and therefore no owner — `resync-no-owner`, with no store opened and no request written",
    run: async () => withIsolatedStore(async ({ store }) => {
      let opened = false;
      const result = await resyncCommand.run({ ref: REF }, {
        workspace: { config: {} }, // no workspaceId, no projectRoot to derive from
        openGlobalWorkProjectionStore: async () => { opened = true; return noClose(store); },
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, RESYNC_NO_OWNER);
      assert.equal(opened, false, "an unpublished workspace is answered without opening the cache at all");
    }),
  },
  {
    name: "resync door: the CLI face — a missing ref is a coded input refusal, `render` throws the outcome's own code, and `--json` emits the outcome document verbatim",
    run: async () => withIsolatedStore(async ({ store }) => {
      await assert.rejects(
        () => resyncCommand.run({ ref: "   " }, doorCtx(store)),
        (error) => error?.code === "missing-ref" && error?.status === 400,
      );
      assert.throws(() => resyncCommand.cli.argv([]), (error) => error?.code === "invalid-input");
      assert.deepEqual(resyncCommand.cli.argv(["43/04"]), { ref: "43/04" });

      const refusal = { ok: false, code: RESYNC_OWNER_IS_SELF, ref: REF, node: CONTROL, message: "its own publish tick refreshes it." };
      assert.throws(() => resyncCommand.cli.render(refusal), (error) => error?.code === RESYNC_OWNER_IS_SELF, "a coded refusal renders as a coded stderr failure");
      assert.equal(resyncCommand.cli.render({ ok: true, message: "Asked X to push." }), "Asked X to push.");
      assert.deepEqual(resyncCommand.cli.json(refusal), refusal, "--json prints the outcome document verbatim, whatever the answer was");
    }),
  },
  {
    // THE CODE LIST, produced rather than declared — the vocabulary a face (board, CLI, and
    // the UI half of this story) codes against. Every code below is the OUTCOME OF A RUN in
    // this test, not a constant copied into an array.
    name: "resync door: the whole coded vocabulary is produced by real episodes — five codes, exactly, and only `resync-no-owner` is a rejection",
    run: async () => withIsolatedStore(async ({ store }) => {
      const produced = new Set();

      // 1. no owner — an unpublished workspace.
      produced.add((await resyncCommand.run({ ref: REF }, { workspace: { config: {} } })).code);

      // 2. owner is self.
      seedRow(store, { node: CONTROL });
      produced.add((await resyncCommand.run({ ref: REF }, doorCtx(store, { nodeId: CONTROL }))).code);

      // 3. accepted — the row settles `dispatched`.
      seedRow(store, { node: OWNER });
      const accept = virtualClock({ store, settleAfterMs: 200 });
      produced.add((await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 200, sleep: accept.sleep }))).code);

      // 4. owner not connected / 5. owner unreachable — the tick's two verdicts.
      for (const detail of [RESYNC_OWNER_NOT_CONNECTED, RESYNC_OWNER_UNREACHABLE]) {
        const clock = virtualClock({ store, settleAfterMs: 200, state: RESYNC_FAILED, detail });
        produced.add((await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 200, sleep: clock.sleep }))).code);
      }

      // 6. no answer inside the bound.
      const never = virtualClock({ store });
      produced.add((await resyncCommand.run({ ref: REF }, doorCtx(store, { pollMs: 1000, sleep: never.sleep }))).code);

      assert.deepEqual(
        [...produced].sort(),
        [
          "resync-no-owner",
          "resync-owner-is-self",
          "resync-owner-not-connected",
          "resync-owner-unreachable",
          "resync-pending",
          "resync-requested",
        ],
        "the door's produced vocabulary is exactly these six codes — five outcomes plus the accepted acknowledgement (ADR-010/R4.2 + ADR-014/E2)",
      );
      assert.ok(!produced.has("resync-result-not-owner"), "the RESULT-frame skip codes are a control-internal vocabulary and never reach the door's answer");
    }),
  },
];

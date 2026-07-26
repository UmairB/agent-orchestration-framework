// Traceability wiring for milestone 34 / story 04 — task 02
// (tasks/02_control-node-stream-server.feature). Covers every @executable scenario /
// Scenario Outline row:
//   - the server admits a tailnet peer and refuses a non-peer (Scenario Outline, 2
//     rows), with a refused connection writing NOTHING to the global store
//   - an admitted worker's snapshot and deltas are applied to the global store (the
//     completed item ends up "done")
//   - secret-shaped fields are redacted before entering the global store
//   - a worker's stream liveness label follows its connection and heartbeat
//     (Scenario Outline, 3 rows: live / stale / disconnected)
//
// Driven over the pure admission/apply/label functions directly (the STORY.md build
// note's "task 01's paired fake channel" pattern generalised to the server side) plus
// an injected peer-identity signal mirroring mesh-fabric's injected exec — no live
// tailnet, no real ws socket needed for these units (the real-transport accept loop
// is exercised end-to-end by startControlStreamServer itself, used here over an
// ephemeral loopback port with an injected origin resolver).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  isTailnetPeer,
  applyStreamFrame,
  streamLivenessLabel,
  startControlStreamServer,
} from "../src/control-stream-server.mjs";
import { openGlobalWorkProjectionStore, queryGlobalWorkProjection, readWorkItemDoc, readWorkItemRuns } from "../src/global-work-store.mjs";
import { readPresenceRecord } from "../src/mesh-presence.mjs";

const NOW = "2026-07-05T10:00:00.000Z";

async function withGlobalHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-control-stream-"));
  try {
    return await fn({ env: { AOF_GLOBAL_HOME: home } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

// registerWorkspaceDescriptor(store, workspaceId) — a snapshot/delta frame is now
// REFUSED (2026-07-18 fix) unless the control node already holds a registered
// global_workspace_descriptors row for that workspaceId (the ADR-010 registration
// gate — a worker's frame carries no real projectRoot of its own, so applying an
// unregistered id can no longer fabricate one). Every test below that exercises
// applySnapshotFrame/applyDeltaFrame registers its synthetic workspace first,
// mirroring what a real `mesh:join`/`mesh repo publish` would already have done.
function registerWorkspaceDescriptor(store, workspaceId) {
  const projectRoot = `/workspaces/${workspaceId}`;
  store.db.prepare(`
    INSERT INTO global_workspace_descriptors
      (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
    VALUES (?, ?, ?, ?, 1, 'control-a', '[]', ?, ?)
  `).run(workspaceId, projectRoot, `${projectRoot}/wiki/work`, workspaceId, NOW, `${projectRoot}/descriptor.json`);
}

function waitForOpenOrClose(ws) {
  return new Promise((resolve) => {
    let settled = false;
    ws.on("open", () => { if (!settled) { settled = true; resolve({ opened: true }); } });
    ws.on("close", () => { if (!settled) { settled = true; resolve({ opened: false }); } });
    ws.on("error", () => { if (!settled) { settled = true; resolve({ opened: false }); } });
  });
}

export const controlStreamServerTests = [
  {
    name: "control-stream-server/02 the server admits a tailnet peer and refuses a non-peer",
    run() {
      const peerNodeIds = new Set(["worker-a", "worker-b"]);
      assert.equal(isTailnetPeer({ nodeId: "worker-a" }, { peerNodeIds }), true, "a tailnet peer is accepted");
      assert.equal(isTailnetPeer({ nodeId: "some-other-host" }, { peerNodeIds }), false, "a non-peer is refused");
      assert.equal(isTailnetPeer({ nodeId: null }, { peerNodeIds }), false, "an unresolved origin is never a peer");
    },
  },
  {
    name: "control-stream-server/02 a refused connection writes nothing to the global store (end-to-end over the real accept loop)",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({
          peerNodeIds: ["worker-a"],
          resolveOrigin: (request) => ({ nodeId: request.headers["x-aof-node-id"] ?? null }),
          storeOptions: { env },
        });
        try {
          const port = server.server.address().port;
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { "x-aof-node-id": "not-a-peer" } });
          const outcome = await waitForOpenOrClose(ws);
          assert.equal(outcome.opened, false, "a non-peer connection is refused, never opened");

          const store = await openGlobalWorkProjectionStore({ env });
          try {
            const projection = queryGlobalWorkProjection(store);
            assert.equal(projection.items.length, 0, "a refused connection wrote nothing to the global store");
          } finally {
            store.close();
          }
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "control-stream-server/02 an admitted worker's snapshot and deltas are applied to the global store",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          registerWorkspaceDescriptor(store, "ws-worker-a");
          const snapshot = {
            kind: "snapshot",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [
              { ref: "34/04/00", type: "task", slug: "worker-role", status: "in-progress", title: "Worker role", parent: "34/04", sourcePath: "/x/00.md" },
              { ref: "34/04/01", type: "task", slug: "stream-client", status: "planned", title: "Stream client", parent: "34/04", sourcePath: "/x/01.md" },
            ],
            at: NOW,
          };
          await applyStreamFrame(store, snapshot, { now: NOW });

          const delta = {
            kind: "delta",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [{ ref: "34/04/00", type: "task", slug: "worker-role", status: "done", title: "Worker role", parent: "34/04", sourcePath: "/x/00.md" }],
            at: NOW,
          };
          await applyStreamFrame(store, delta, { now: NOW });

          const projection = queryGlobalWorkProjection(store, { workspaceId: "ws-worker-a" });
          assert.equal(projection.items.length, 2, "both items for that worker are shown");
          const done = projection.items.find((item) => item.ref === "34/04/00");
          assert.equal(done.status, "done");
          const untouched = projection.items.find((item) => item.ref === "34/04/01");
          assert.equal(untouched.status, "planned");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "control-stream-server/02 secret-shaped fields are redacted before entering the global store",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          registerWorkspaceDescriptor(store, "ws-worker-a");
          const snapshot = {
            kind: "snapshot",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [
              {
                ref: "34/04/00",
                type: "task",
                slug: "worker-role",
                status: "in-progress",
                title: "Worker role",
                parent: "34/04",
                sourcePath: "/x/00.md",
                relayAuthToken: "super-secret-credential-value",
              },
            ],
            at: NOW,
          };
          await applyStreamFrame(store, snapshot, { now: NOW });

          const projection = queryGlobalWorkProjection(store, { workspaceId: "ws-worker-a" });
          const stored = projection.items[0];
          assert.equal(JSON.stringify(stored).includes("super-secret-credential-value"), false, "the credential value never lands in the store");
          assert.equal("relayAuthToken" in stored, false, "the secret-shaped key itself is stripped, not merely blanked");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    // review fix P0.3 REGRESSION: a delta whose ref is UNSEEN (not already in the
    // store) and whose own fields don't supply the schema's NOT NULL columns must
    // be skipped — NOT allowed to abort the merged re-publish and silently drop
    // every OTHER already-published item in the SAME workspace (the docstring's
    // "a delta for an unseen item behaves sanely", made true).
    name: "control-stream-server/02 P0.3 REGRESSION: a delta for an unseen, incomplete ref does not roll back the workspace's other already-published items",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          registerWorkspaceDescriptor(store, "ws-worker-a");
          const snapshot = {
            kind: "snapshot",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [
              { ref: "34/04/00", type: "task", slug: "worker-role", status: "in-progress", title: "Worker role", parent: "34/04", sourcePath: "/x/00.md" },
              { ref: "34/04/01", type: "task", slug: "stream-client", status: "planned", title: "Stream client", parent: "34/04", sourcePath: "/x/01.md" },
            ],
            at: NOW,
          };
          await applyStreamFrame(store, snapshot, { now: NOW });

          // A delta for a ref NEVER seen before, carrying only a status change — no
          // type/slug/sourcePath of its own (the shape a partial delta frame from a
          // buggy/lagging worker might carry).
          const partialDelta = {
            kind: "delta",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [{ ref: "34/04/02", status: "in-progress" }],
            at: NOW,
          };
          const result = await applyStreamFrame(store, partialDelta, { now: NOW });
          assert.ok(result != null, "the apply call itself completes (never throws out of applyDeltaFrame)");

          const projection = queryGlobalWorkProjection(store, { workspaceId: "ws-worker-a" });
          // The critical assertion: the pre-existing items from the snapshot are
          // STILL there — a rolled-back txn (the pre-fix behaviour) would have
          // wiped them (publishWorkspaceSnapshot's own re-publish DELETEs then
          // re-INSERTs the whole workspace's rows inside one transaction).
          assert.equal(projection.items.length, 2, "the two already-published items survive; the incomplete unseen-ref delta did not roll back the merged re-publish");
          assert.ok(projection.items.some((item) => item.ref === "34/04/00"), "34/04/00 is still present");
          assert.ok(projection.items.some((item) => item.ref === "34/04/01"), "34/04/01 is still present");
          assert.ok(!projection.items.some((item) => item.ref === "34/04/02"), "the incomplete unseen-ref row itself is skipped, never half-written");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    // review fix P2.8: the pre-existing test above only proves redaction on a
    // SNAPSHOT frame's initial write; applyDeltaFrame merges the delta's redacted
    // item into the EXISTING row read back from the store — this proves the
    // credential-shaped key/value never survive that merge-then-republish path
    // either (a snapshot establishing the row, then a delta carrying the secret key).
    name: "control-stream-server/02 a delta frame's secret-shaped field is also redacted before the merged row re-enters the global store (round trip)",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          registerWorkspaceDescriptor(store, "ws-worker-a");
          const snapshot = {
            kind: "snapshot",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [
              { ref: "34/04/00", type: "task", slug: "worker-role", status: "in-progress", title: "Worker role", parent: "34/04", sourcePath: "/x/00.md" },
            ],
            at: NOW,
          };
          await applyStreamFrame(store, snapshot, { now: NOW });

          const delta = {
            kind: "delta",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [
              {
                ref: "34/04/00",
                type: "task",
                slug: "worker-role",
                status: "done",
                title: "Worker role",
                parent: "34/04",
                sourcePath: "/x/00.md",
                relayAuthToken: "delta-secret-credential-value",
              },
            ],
            at: NOW,
          };
          await applyStreamFrame(store, delta, { now: NOW });

          const projection = queryGlobalWorkProjection(store, { workspaceId: "ws-worker-a" });
          const stored = projection.items.find((item) => item.ref === "34/04/00");
          assert.equal(stored.status, "done", "the delta's own field update still lands");
          assert.equal(JSON.stringify(stored).includes("delta-secret-credential-value"), false, "the credential value carried on a DELTA frame never lands in the store");
          assert.equal("relayAuthToken" in stored, false, "the secret-shaped key from a delta frame is stripped, not merely blanked");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "control-stream-server/02 a presence frame from an admitted worker is persisted into the control node's global presence store",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          // Producer-shaped: the exact 5-key record assemblePresenceRecord emits,
          // INCLUDING a live session (ADR-001). The prior 4-key fixture here is what
          // let the cross-node `sessions`-drop ship — it had no sessions key to lose.
          const sessions = [{ workspaceId: "ws-9db1", repo: "aof", assistant: "claude-code", lastPingAt: NOW }];
          const presence = { nodeId: "worker-a", heartbeatAt: NOW, activeRuns: ["run-1"], sessions, aofVersion: "1.2.3" };
          await applyStreamFrame(store, { kind: "presence", nodeId: "worker-a", presence, at: NOW }, { now: NOW });

          const saved = await readPresenceRecord({ globalMeshRoot: store.paths.meshRoot }, "worker-a");
          assert.deepEqual(saved, presence, "the control node stores the worker's durable presence — INCLUDING the ADR-001 sessions key — in the same seam the UI reads");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "control-stream-server/02 a REMOTE worker's live sessions survive the fabric — the ADR-001 `sessions` key is never dropped on ingest (cross-node SPEC objective a)",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          // The regression this pins: applyPresenceFrame used to rebuild ONLY the m23
          // four keys, so a remote node's live-session projection was silently dropped
          // as its presence crossed the fabric — the worker read `idle` on the control's
          // fleet while actively being worked on. Measured live on a real two-machine
          // mesh (the control held a fresh but 4-key presence for the mac worker) before
          // this was fixed. Only a REMOTE node's presence flows through here; the
          // control's own is written by assemblePresenceRecord, which is why every
          // single-machine soak stayed green.
          const sessions = [
            { workspaceId: "ws-beta", repo: "pay-guard-portal", assistant: "claude-code", lastPingAt: NOW },
          ];
          const presence = { nodeId: "worker-a", heartbeatAt: NOW, activeRuns: [], sessions, aofVersion: "1.2.3" };
          await applyStreamFrame(
            store,
            { kind: "presence", nodeId: "worker-a", presence, at: NOW },
            { now: NOW, nodeId: "worker-a" }
          );

          const saved = await readPresenceRecord({ globalMeshRoot: store.paths.meshRoot }, "worker-a");
          assert.ok(saved, "the remote worker's presence was persisted");
          assert.deepEqual(
            saved.sessions,
            sessions,
            "the worker's live sessions crossed the fabric INTACT — the node can read `working · <repo> (session)` on the control's fleet"
          );
          assert.deepEqual(
            Object.keys(saved),
            ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion"],
            "the stored record is the full ADR-001 five-key shape, sessions before aofVersion"
          );
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "control-stream-server/02 durable presence is attributed to the admitted socket node, not a self-declared frame node",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          const presence = { nodeId: "spoofed-node", heartbeatAt: NOW, activeRuns: ["run-1"], aofVersion: "1.2.3" };
          await applyStreamFrame(store, { kind: "presence", nodeId: "spoofed-node", presence, at: NOW }, { now: NOW, nodeId: "worker-a" });

          const savedWorker = await readPresenceRecord({ globalMeshRoot: store.paths.meshRoot }, "worker-a");
          const savedSpoofed = await readPresenceRecord({ globalMeshRoot: store.paths.meshRoot }, "spoofed-node");
          assert.deepEqual(
            savedWorker,
            { nodeId: "worker-a", heartbeatAt: NOW, activeRuns: ["run-1"], sessions: [], aofVersion: "1.2.3" },
            "presence is stored for the admitted connection identity"
          );
          assert.equal(savedSpoofed, null, "the self-declared frame node cannot create another node's presence record");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "control-stream-server/02 a worker's stream liveness label follows its connection and heartbeat",
    run() {
      const rows = [
        { condition: "connected and heartbeating", connected: true, lastHeartbeatAt: NOW, now: NOW, label: "live" },
        { condition: "connected but no heartbeat within the window", connected: true, lastHeartbeatAt: "2026-07-05T09:00:00.000Z", now: NOW, label: "stale" },
        { condition: "disconnected", connected: false, lastHeartbeatAt: NOW, now: NOW, label: "disconnected" },
      ];
      for (const row of rows) {
        assert.equal(
          streamLivenessLabel({ connected: row.connected, lastHeartbeatAt: row.lastHeartbeatAt, now: row.now, windowSeconds: 30 }),
          row.label,
          row.condition,
        );
      }
    },
  },
  {
    // review fix P2.9: a malformed frame.at (a non-ISO/garbage string) must never
    // land verbatim in last_published_at — the server clock is used instead when
    // no explicit `now` option is supplied.
    name: "control-stream-server/02 P2.9 a malformed frame.at falls back to the server clock rather than being written verbatim",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          registerWorkspaceDescriptor(store, "ws-worker-a");
          const snapshot = {
            kind: "snapshot",
            nodeId: "worker-a",
            workspaceId: "ws-worker-a",
            items: [
              { ref: "34/04/00", type: "task", slug: "worker-role", status: "in-progress", title: "Worker role", parent: "34/04", sourcePath: "/x/00.md" },
            ],
            at: "not-a-real-timestamp",
          };
          // No `now` option supplied — the ONLY candidate is the malformed frame.at.
          const before = Date.now();
          await applyStreamFrame(store, snapshot);
          const after = Date.now();

          const projection = queryGlobalWorkProjection(store, { workspaceId: "ws-worker-a" });
          const metadata = projection.metadata.find((entry) => entry.key === "lastPublishedAt");
          assert.ok(metadata != null, "a lastPublishedAt metadata row was written");
          assert.notEqual(metadata.value, "not-a-real-timestamp", "the malformed frame.at is never written verbatim");
          const publishedMs = Date.parse(metadata.value);
          assert.ok(Number.isFinite(publishedMs), "the fallback value parses as a real instant");
          assert.ok(publishedMs >= before - 1000 && publishedMs <= after + 1000, "the fallback is the server clock (close to now), not garbage");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    // schema v5 (TECH_DEBT item 6 — finish the board bridge): the worktree-content
    // frame lands doc bodies + run records behind the SAME descriptor gate as
    // snapshot/delta, attributed to the CONNECTION-bound nodeId (T6).
    name: "control-stream-server/06 a worktree-content frame applies behind the descriptor gate and an unknown workspace is refused",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          const record = { runId: "run-1", itemRef: "18/03", state: "running", attempt: 1, createdAt: NOW, updatedAt: NOW };
          const frame = {
            kind: "worktree-content",
            nodeId: "self-declared-node",
            workspaceId: "ws-worker-a",
            itemRef: "18",
            docs: [{ ref: "18/03", doc: "STORY", body: "# the streamed story\n" }],
            runs: [{ ref: "18", runId: "run-1", record }],
            at: NOW,
          };

          // UNREGISTERED workspace: refused, and the refusal is a reportable skip —
          // the accept loop's onFrameSkipped contract, never a silent drop.
          const refused = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(refused.skipped, true, "an unknown workspace is refused");
          assert.equal(refused.code, "unknown-workspace");
          assert.equal(readWorkItemDoc(store, "ws-worker-a", "18/03", "STORY"), null, "a refused frame writes nothing");

          registerWorkspaceDescriptor(store, "ws-worker-a");
          const applied = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(applied.published, true);
          assert.equal(applied.docCount, 1);
          assert.equal(applied.runCount, 1);

          const doc = readWorkItemDoc(store, "ws-worker-a", "18/03", "STORY");
          assert.equal(doc.body, "# the streamed story\n", "the streamed body is readable for a ref the control checkout has never seen");
          assert.equal(doc.nodeId, "worker-a", "attribution is the CONNECTION-bound nodeId, never the frame's self-declared one (T6)");
          const runs = readWorkItemRuns(store, "ws-worker-a", "18");
          assert.equal(runs.length, 1);
          assert.deepEqual(runs[0].record, record, "the run record round-trips");
        } finally {
          store.close();
        }
      });
    },
  },
];

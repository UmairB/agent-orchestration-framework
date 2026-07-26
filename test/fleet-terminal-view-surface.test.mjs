// test/fleet-terminal-view-surface.test.mjs — traceability for milestone 38 /
// story 06 / task 04 (tasks/04_bug-fleet-terminal-view-surface.feature; BLOCKER
// F-38.06c). ARCHITECTURE ADR-013 (the `session_id` join key) + ADR-014 (the
// read-only mirror, routed by (nodeId, sessionId)); DESIGN §Surface 3 (V1-V9 + the
// States table); SECURITY T14.
//
// THE THREE-LINK CHAIN this task closes:
//   (1) PERSIST — the worker already SENDS its captured session id on the
//       assignment-status frame; the control node read only `runId` off it and
//       `global_assignments` had no session_id column, so the join key was dropped
//       on the floor.
//   (2) SURFACE — `projectAssignment` carried eight keys, none of them the session
//       id, so `/api/mesh/status` could not express which stream a card opens.
//   (3) RENDER — there was no `ui/` terminal-view consumer at all.
//
// PRODUCER-FED OR IT IS NOT EVIDENCE (ADR-008 — this milestone's defining lesson,
// earned seven times). The persist + surface lanes drive the REAL
// `control-stream-server` frame handler (`applyStreamFrame`) over a REAL
// AOF_GLOBAL_HOME-isolated SQLite store, with the frame built by the REAL
// `buildAssignmentStatusFrame` the worker's own `sendAssignmentStatus` calls, and
// read the REAL `/api/mesh/status` shaping (`queryGlobalMeshStatus`) — never a
// hand-built assignment row asserted against itself. The render lanes drive the
// framework-free `.mjs` helpers `FleetTerminalView.tsx` ITSELF imports (the
// ui/src/board/terminal/*.mjs + test/terminal-dock.test.mjs house precedent) —
// headless, no browser — and the multiplex lane drives BOTH resolved URLs into the
// REAL serveMeshUi `/ws/terminal-view` route over the REAL in-memory mirror.
//
// The ON-SCREEN render is judged at the design-conformance gate against §Surface 3;
// the live cross-machine stream stays task 03's @manual soak.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import { applyStreamFrame } from "../src/control-stream-server.mjs";
import { buildAssignmentStatusFrame } from "../src/worker-stream-client.mjs";
import { readAssignment } from "../src/assignment-record.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { queryGlobalMeshStatus } from "../src/global-mesh-query.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { createTerminalMirror } from "../src/mesh-terminal-mirror.mjs";
import { buildTerminalFrameEnvelope } from "../src/mesh-terminal-relay-bridge.mjs";
import { withMeshAssignFixture, seedAssignment, seedTargetNode } from "./support/mesh-assign-fixture.mjs";

// The helpers the REAL component imports — the same module specifiers
// ui/src/fleet/terminal-view/FleetTerminalView.tsx names.
import {
  resolveTerminalStream,
  terminalStreamKey,
  terminalStreamHeader,
  terminalViewSocketUrl,
  NO_STREAM,
} from "../ui/src/fleet/terminal-view/stream.mjs";
import {
  initialTerminalViewState,
  terminalViewOnBytes,
  terminalViewOnClose,
  terminalViewOnError,
  describeTerminalViewState,
  TERMINAL_VIEW_STATES,
} from "../ui/src/fleet/terminal-view/view-state.mjs";

const NOW = "2026-07-23T10:00:00.000Z";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TERMINAL_VIEW_DIR = path.join(repoRoot, "ui", "src", "fleet", "terminal-view");

// lf(source) — CRLF-normalise before ANY cross-file text comparison (the normaliser
// every arch test in this repo already carries; added here at the architect's N6,
// 2026-07-23). This tree is MIXED: `ui/src/board/TerminalDock.tsx` is CRLF and
// `ui/src/fleet/terminal-view/FleetTerminalView.tsx` is LF, so the theme/font
// comparisons below were comparing raw bytes ACROSS line-ending regimes — green
// today only because both matches happen to be single-line. Reformat either
// declaration onto multiple lines and the lane fails on line endings ALONE, which
// is this milestone's own recurring bite (a needle that silently no-ops).
function lf(source) {
  return String(source).replace(/\r\n/g, "\n");
}

async function withStore({ home }, fn) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

// The m35 projected-assignment key set, in order — the eight keys that existed
// BEFORE this task. Every one must keep its meaning (and its place) byte-for-byte:
// this thread is ADDITIVE only.
const PRE_EXISTING_PROJECTED_KEYS = [
  "assignmentId", "state", "targetNodeId", "issuer", "runId", "assignedAt", "updatedAt", "reclaimedAt",
];

export const fleetTerminalViewSurfaceTests = [
  // ═══════════════════════════════════════════════════════════════════════════
  // LINK 1 — PERSIST. "the session_id a worker reports on its assignment-status
  // frame is PERSISTED on the assignment record"
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "task04/38-06 the session id a worker reports on its assignment-status frame is PERSISTED on the assignment record, verbatim across a re-read",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        // Given an assignment row held by node "node-a".
        await seedAssignment({ home }, {
          assignmentId: "asg-1", itemRef: "35/00", workspaceId,
          targetNodeId: "node-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
        });

        // When the worker sends an assignment-status frame carrying its captured
        // session id "sess-1" — the REAL frame builder the worker's own
        // sendAssignmentStatus() calls, over the REAL control-side frame handler.
        await withStore({ home }, async (store) => {
          const frame = buildAssignmentStatusFrame("node-a", "asg-1", "running", {
            runId: "run-7", sessionId: "sess-1", now: NOW,
          });
          assert.equal(frame.sessionId, "sess-1", "the REAL worker frame builder does carry the session id");
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "node-a" });
          assert.equal(result.applied, true, "the real handler applied the frame");

          // Then the stored assignment row carries that session id — no longer
          // dropped at the frame handler.
          const record = readAssignment(store, "asg-1");
          assert.equal(record.sessionId, "sess-1", "the session id is persisted on the assignment record");
          assert.equal(record.runId, "run-7", "the pre-existing run link is untouched");
          assert.equal(record.state, "running");
        });

        // And re-reading the row returns it verbatim, so the join key survives a
        // control-node restart — a SEPARATE store open over the SAME database file
        // (the store above was closed), i.e. a genuine reopen, not a cache read.
        await withStore({ home }, async (store) => {
          const reread = readAssignment(store, "asg-1");
          assert.equal(reread.sessionId, "sess-1", "the session id survives a control-node restart (a fresh store open)");
        });
      });
    },
  },
  {
    name: "task04/38-06 an assignment-status frame carrying NO session id leaves a previously-captured value intact — absent is not a clear",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, {
          assignmentId: "asg-1", itemRef: "35/00", workspaceId,
          targetNodeId: "node-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
        });
        await withStore({ home }, async (store) => {
          await applyStreamFrame(
            store,
            buildAssignmentStatusFrame("node-a", "asg-1", "running", { runId: "run-7", sessionId: "sess-1", now: NOW }),
            { now: NOW, nodeId: "node-a" },
          );

          // A later terminal-state frame carries NO sessionId (the real builder
          // OMITS the key when none is supplied — the conditional-inclusion shape).
          const done = buildAssignmentStatusFrame("node-a", "asg-1", "done", { now: NOW });
          assert.equal(Object.prototype.hasOwnProperty.call(done, "sessionId"), false, "the real builder omits sessionId when the worker supplies none");
          const result = await applyStreamFrame(store, done, { now: NOW, nodeId: "node-a" });
          assert.equal(result.applied, true);

          const record = readAssignment(store, "asg-1");
          assert.equal(record.state, "done");
          assert.equal(record.sessionId, "sess-1", "the previously-captured session id is NOT cleared by a frame that simply does not mention it");
          assert.equal(record.runId, "run-7", "and the run link keeps the same absent-is-not-a-clear discipline");
        });
      });
    },
  },
  {
    name: "task04/38-06 a PRE-EXISTING database with no session_id column is migrated IN PLACE (idempotent) — never recreated, never wiped",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-session-id-migration-"));
      const home = path.join(tmp, "home");
      try {
        const paths = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } });
        await mkdir(paths.workRoot, { recursive: true });

        // Build a PRE-EXISTING database the way a real machine already has one:
        // the schema-v4 `global_assignments` shape WITHOUT session_id, carrying a
        // live dispatch row (assignment rows are operator/worker-CREATED state —
        // unrecoverable if a "migration" recreated the table).
        const { DatabaseSync } = await import("node:sqlite");
        const legacy = new DatabaseSync(paths.databasePath);
        legacy.exec(`
          CREATE TABLE aof_schema (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
          INSERT INTO aof_schema (key, value) VALUES ('version', 4);
          CREATE TABLE global_assignments (
            assignment_id TEXT PRIMARY KEY,
            item_ref TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            target_node_id TEXT NOT NULL,
            issuer TEXT NOT NULL,
            state TEXT NOT NULL,
            run_id TEXT,
            assigned_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            reclaimed_at TEXT
          );
          INSERT INTO global_assignments
            (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, run_id, assigned_at, updated_at, reclaimed_at)
          VALUES ('legacy-1', '35/00', 'ws-legacy', 'node-a', 'control-a', 'running', 'run-legacy', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL);
        `);
        const legacyColumns = legacy.prepare("PRAGMA table_info(global_assignments)").all().map((c) => c.name);
        assert.equal(legacyColumns.includes("session_id"), false, "the pre-existing database genuinely lacks the column (the migration has something to do)");
        legacy.close();

        // Opening through the REAL store migrates in place.
        await withStore({ home }, async (store) => {
          const columns = store.db.prepare("PRAGMA table_info(global_assignments)").all().map((c) => c.name);
          assert.ok(columns.includes("session_id"), "the pre-existing database gained the session_id column");

          const row = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = 'legacy-1'").get();
          assert.ok(row, "the pre-existing dispatch row SURVIVED — the table was altered, not recreated");
          assert.equal(row.state, "running");
          assert.equal(row.run_id, "run-legacy");
          assert.equal(row.target_node_id, "node-a");
          assert.equal(row.assigned_at, "2026-07-01T00:00:00.000Z");
          assert.equal(row.session_id, null, "an un-captured session id reads null — no fabricated backfill");

          // And the REAL frame handler can now capture into the migrated table.
          await applyStreamFrame(
            store,
            buildAssignmentStatusFrame("node-a", "legacy-1", "running", { sessionId: "sess-legacy", now: NOW }),
            { now: NOW, nodeId: "node-a" },
          );
          assert.equal(readAssignment(store, "legacy-1").sessionId, "sess-legacy");
        });

        // IDEMPOTENT: a second (and third) open of the ALREADY-migrated database
        // neither throws nor disturbs the row.
        await withStore({ home }, async (store) => {
          const columns = store.db.prepare("PRAGMA table_info(global_assignments)").all().map((c) => c.name);
          assert.equal(columns.filter((name) => name === "session_id").length, 1, "re-opening adds the column exactly once");
          assert.equal(readAssignment(store, "legacy-1").sessionId, "sess-legacy", "the captured value survives the re-open");
        });
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LINK 2 — SURFACE. "the assignment projection SURFACES the session id, so a
  // card can resolve its stream"
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "task04/38-06 the REAL /api/mesh/status shaping surfaces the session id alongside the target node id — ADDITIVE only, absent (never an empty string) when uncaptured",
    async run() {
      await withMeshAssignFixture(async ({ workspace, workspaceId, home, root }) => {
        const env = { AOF_GLOBAL_HOME: home };
        await seedTargetNode({ home }, { nodeId: "node-a", workspaceId, projectRoot: root, workDir: path.join(root, "wiki", "work") });
        // TWO assignments: one whose worker HAS captured a session, one whose
        // worker has not yet.
        await seedAssignment({ home }, {
          assignmentId: "asg-1", itemRef: "35/00", workspaceId,
          targetNodeId: "node-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
        });
        await seedAssignment({ home }, {
          assignmentId: "asg-2", itemRef: "35", workspaceId,
          targetNodeId: "node-a", issuer: "control-a", state: "assigned", assignedAt: NOW,
        });

        await withStore({ home }, async (store) => {
          await store.publishWorkspaceSnapshot(workspace, { workspaceId });
          // Given an assignment row whose session id has been captured — by the
          // REAL frame handler, over the REAL worker frame.
          await applyStreamFrame(
            store,
            buildAssignmentStatusFrame("node-a", "asg-1", "running", { runId: "run-7", sessionId: "sess-1", now: NOW }),
            { now: NOW, nodeId: "node-a" },
          );
        });

        // When the fleet status payload is shaped — the REAL /api/mesh/status read.
        const status = await queryGlobalMeshStatus({ env, now: NOW });
        const captured = status.items.find((item) => item.ref === "35/00");
        const uncaptured = status.items.find((item) => item.ref === "35");
        assert.ok(captured?.assignment, "the item row still carries its assignment");
        assert.ok(uncaptured?.assignment, "the second item row still carries its assignment");

        // Then that assignment's projected row carries the session id alongside
        // its target node id.
        assert.equal(captured.assignment.sessionId, "sess-1");
        assert.equal(captured.assignment.targetNodeId, "node-a");

        // And every pre-existing projected key keeps its meaning byte-for-byte —
        // ADDITIVE only (same keys, same order, same values; sessionId appended).
        assert.deepEqual(
          Object.keys(captured.assignment).slice(0, PRE_EXISTING_PROJECTED_KEYS.length),
          PRE_EXISTING_PROJECTED_KEYS,
          "the eight pre-existing projected keys keep their identity AND their order",
        );
        assert.equal(captured.assignment.assignmentId, "asg-1");
        assert.equal(captured.assignment.state, "running");
        assert.equal(captured.assignment.issuer, "control-a");
        assert.equal(captured.assignment.runId, "run-7");
        assert.equal(captured.assignment.assignedAt, NOW);
        assert.equal(captured.assignment.reclaimedAt, null);

        // And an assignment with no session id yet carries no fabricated
        // placeholder — absent, not an empty string.
        assert.deepEqual(Object.keys(uncaptured.assignment), PRE_EXISTING_PROJECTED_KEYS, "the uncaptured row is exactly the pre-existing eight");
        assert.equal(Object.prototype.hasOwnProperty.call(uncaptured.assignment, "sessionId"), false, "no sessionId key at all — absent, not \"\"");
        assert.notEqual(uncaptured.assignment.sessionId, "", "and certainly never an empty-string placeholder");
      });
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LINK 3 — RENDER. "a card resolves its stream from the surfaced session_id —
  // or honestly declines to subscribe" (Scenario Outline, 4 rows)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "task04/38-06 a card resolves its stream from the REAL surfaced session_id — (node-a, sess-1) and (node-b, sess-2) each resolve to their OWN stream",
    async run() {
      await withMeshAssignFixture(async ({ workspace, workspaceId, home, root }) => {
        const env = { AOF_GLOBAL_HOME: home };
        for (const nodeId of ["node-a", "node-b"]) {
          await seedTargetNode({ home }, { nodeId, workspaceId, projectRoot: root, workDir: path.join(root, "wiki", "work") });
        }
        await seedAssignment({ home }, { assignmentId: "asg-a", itemRef: "35/00", workspaceId, targetNodeId: "node-a", issuer: "control-a", state: "accepted", assignedAt: NOW });
        await seedAssignment({ home }, { assignmentId: "asg-b", itemRef: "35", workspaceId, targetNodeId: "node-b", issuer: "control-a", state: "accepted", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          await store.publishWorkspaceSnapshot(workspace, { workspaceId });
          await applyStreamFrame(store, buildAssignmentStatusFrame("node-a", "asg-a", "running", { sessionId: "sess-1", now: NOW }), { now: NOW, nodeId: "node-a" });
          await applyStreamFrame(store, buildAssignmentStatusFrame("node-b", "asg-b", "running", { sessionId: "sess-2", now: NOW }), { now: NOW, nodeId: "node-b" });
        });

        const status = await queryGlobalMeshStatus({ env, now: NOW });
        const rowA = status.items.find((item) => item.ref === "35/00").assignment;
        const rowB = status.items.find((item) => item.ref === "35").assignment;

        // | node-a | sess-1 | the (node-a, sess-1) stream |
        const streamA = resolveTerminalStream(rowA);
        assert.equal(streamA.resolved, true);
        assert.equal(streamA.nodeId, "node-a");
        assert.equal(streamA.sessionId, "sess-1");
        assert.equal(streamA.key, terminalStreamKey("node-a", "sess-1"));

        // | node-b | sess-2 | the (node-b, sess-2) stream |
        const streamB = resolveTerminalStream(rowB);
        assert.equal(streamB.resolved, true);
        assert.equal(streamB.nodeId, "node-b");
        assert.equal(streamB.sessionId, "sess-2");

        // And it NEVER subscribes to a guessed, defaulted, or sibling session
        // (ADR-014 invariant 4) — each URL carries its OWN tuple only.
        const urlA = terminalViewSocketUrl(streamA, { protocol: "http:", host: "127.0.0.1:4181" });
        const urlB = terminalViewSocketUrl(streamB, { protocol: "http:", host: "127.0.0.1:4181" });
        assert.equal(urlA, "ws://127.0.0.1:4181/ws/terminal-view?nodeId=node-a&sessionId=sess-1");
        assert.equal(urlB, "ws://127.0.0.1:4181/ws/terminal-view?nodeId=node-b&sessionId=sess-2");
        assert.ok(!urlA.includes("sess-2") && !urlB.includes("sess-1"), "neither card's subscription mentions the other's session");
      });
    },
  },
  {
    name: "task04/38-06 a card whose REAL projected assignment has no session id yet resolves to NO stream — no terminal, no socket, and never a sibling's session",
    async run() {
      await withMeshAssignFixture(async ({ workspace, workspaceId, home, root }) => {
        const env = { AOF_GLOBAL_HOME: home };
        await seedTargetNode({ home }, { nodeId: "node-a", workspaceId, projectRoot: root, workDir: path.join(root, "wiki", "work") });
        // A SIBLING assignment on the SAME node DOES have a session — the exact
        // value a "helpful" defaulting bug would borrow.
        await seedAssignment({ home }, { assignmentId: "asg-sib", itemRef: "35", workspaceId, targetNodeId: "node-a", issuer: "control-a", state: "running", assignedAt: NOW });
        await seedAssignment({ home }, { assignmentId: "asg-none", itemRef: "35/00", workspaceId, targetNodeId: "node-a", issuer: "control-a", state: "assigned", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          await store.publishWorkspaceSnapshot(workspace, { workspaceId });
          await applyStreamFrame(store, buildAssignmentStatusFrame("node-a", "asg-sib", "running", { sessionId: "sess-sibling", now: NOW }), { now: NOW, nodeId: "node-a" });
        });

        const status = await queryGlobalMeshStatus({ env, now: NOW });
        const row = status.items.find((item) => item.ref === "35/00").assignment;
        assert.equal(row.assignmentId, "asg-none");

        // | node-a | absent | NO stream — the card shows no terminal, opens no socket |
        const stream = resolveTerminalStream(row);
        assert.equal(stream.resolved, false);
        assert.equal(stream.reason, NO_STREAM.NO_SESSION);
        assert.equal(terminalViewSocketUrl(stream, { protocol: "http:", host: "127.0.0.1:4181" }), null, "an unresolved stream yields NO url — nothing to open");
        assert.equal(terminalStreamHeader(stream, { itemRef: "35/00" }), null, "and NO header — the card renders no terminal at all (V1)");
        assert.equal(stream.sessionId, undefined, "it borrowed nothing from the sibling assignment on the same node");
      });
    },
  },
  {
    name: "task04/38-06 an unresolvable tuple (no node id) never opens a socket — the defensive half of ADR-014 invariant 4",
    async run() {
      // A projected row with NO target node cannot arise from the store (the column
      // is NOT NULL) — this row is deliberately synthesized to prove the RESOLVER
      // itself never fabricates the missing half, which is the assertion the
      // Examples row asks for.
      const stream = resolveTerminalStream({ assignmentId: "asg-x", state: "running", sessionId: "sess-1" });
      assert.equal(stream.resolved, false);
      assert.equal(stream.reason, NO_STREAM.NO_NODE);
      assert.equal(terminalViewSocketUrl(stream, { protocol: "http:", host: "127.0.0.1:4181" }), null);
      assert.equal(terminalStreamHeader(stream, { itemRef: "35/00" }), null);

      // A half-tuple never produces a routing key either — so it can never match a
      // live subscription (the mirror's own routingKey discipline, mirrored here).
      assert.equal(terminalStreamKey(null, "sess-1"), null);
      assert.equal(terminalStreamKey("node-a", null), null);
      assert.equal(terminalStreamKey("node-a", ""), null);

      // And the no-assignment case degrades the same honest way (never throws).
      assert.equal(resolveTerminalStream(null).reason, NO_STREAM.NO_ASSIGNMENT);
      assert.equal(resolveTerminalStream(undefined).resolved, false);
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V7/V9 — "the terminal-view state reads honestly at every point in its life"
  // (Scenario Outline, 4 rows)
  // ═══════════════════════════════════════════════════════════════════════════
  ...[
    {
      event: "it has subscribed but no byte has arrived",
      reads: "an honest waiting/empty state",
      apply: () => initialTerminalViewState(),
      expect: TERMINAL_VIEW_STATES.WAITING,
      text: "waiting for output",
      failure: false,
    },
    {
      event: "the first PTY bytes arrive",
      reads: "streaming live",
      apply: () => terminalViewOnBytes(initialTerminalViewState()),
      expect: TERMINAL_VIEW_STATES.STREAMING,
      text: "streaming",
      failure: false,
    },
    {
      event: "the stream closes cleanly",
      reads: "ended — not a frozen pretend-live frame",
      apply: () => terminalViewOnClose(terminalViewOnBytes(initialTerminalViewState())),
      expect: TERMINAL_VIEW_STATES.ENDED,
      text: "stream ended",
      failure: false,
    },
    {
      event: "the transport fails",
      reads: "a disconnected/error state, legibly",
      apply: () => terminalViewOnError(terminalViewOnBytes(initialTerminalViewState())),
      expect: TERMINAL_VIEW_STATES.DISCONNECTED,
      text: "disconnected",
      failure: true,
    },
  ].map((row) => ({
    name: `task04/38-06 the terminal-view state reads honestly — when ${row.event}, the view reads ${row.reads}`,
    run: () => {
      const state = row.apply();
      assert.equal(state, row.expect);
      const descriptor = describeTerminalViewState(state);
      assert.equal(descriptor.text, row.text, "the state is named in WORDS — legible, never colour alone");
      assert.equal(descriptor.state, row.expect);

      // And a NORMAL empty or ended state is never rendered as an error nor as an
      // endless spinner (V7/V9).
      if (row.failure) {
        assert.equal(descriptor.reads, "failure", "a genuine transport failure DOES read as a failure");
        assert.equal(descriptor.token, "destructive", "on the pre-existing fleet read-failure token — no terminal-local error primitive");
        assert.equal(descriptor.live, false, "a dead stream never claims to be live");
      } else {
        assert.equal(descriptor.reads, "normal", "an empty/streaming/ended state is NOT an error");
        assert.notEqual(descriptor.token, "destructive", "and never wears the red error token");
      }
      if (row.expect !== TERMINAL_VIEW_STATES.STREAMING) {
        assert.equal(descriptor.motion, "none", "no motion off the live state — the cold start can never render as a spinner-forever");
        assert.equal(descriptor.live, false);
      } else {
        assert.equal(descriptor.live, true);
      }
    },
  })),
  {
    name: "task04/38-06 the state ramp never launders a failure into a clean finish, and an unknown state LABELS ITSELF (never impersonates `waiting`, never a red error)",
    run: () => {
      // The close that FOLLOWS a transport error stays disconnected — relabelling
      // it "stream ended" would tell the operator the run finished cleanly.
      const dropped = terminalViewOnError(terminalViewOnBytes(initialTerminalViewState()));
      assert.equal(terminalViewOnClose(dropped), TERMINAL_VIEW_STATES.DISCONNECTED);

      // Forward-compat: an unrecognised state degrades QUIETLY — muted token,
      // `normal` (never the red failure token), no motion, not live.
      const unknown = describeTerminalViewState("some-future-state");
      assert.equal(unknown.reads, "normal");
      assert.equal(unknown.token, "muted");
      assert.equal(unknown.motion, "none");
      assert.equal(unknown.live, false);

      // …and it SAYS it is unknown (QA SHOULD-FIX 2, 2026-07-23). This lane used to
      // enshrine the deviation it documented: the fallback returned the WAITING
      // descriptor, so a state this module has not learned yet rendered the words
      // `waiting for output` — a specific, checkable claim ("bytes are still
      // plausibly coming") that nothing had established, on a surface whose whole
      // discipline is never to assert a liveness the source does not. The house
      // idiom (ui/src/fleet/assignments.mjs's UNKNOWN_CHIP, and the board run
      // chip's fallback) labels itself `unknown`; so does this now.
      assert.equal(unknown.text, "unknown", "an unrecognised state names ITSELF — it never borrows a known state's words");
      assert.equal(unknown.state, "unknown");
      assert.notEqual(unknown.text, describeTerminalViewState(TERMINAL_VIEW_STATES.WAITING).text, "and is distinguishable from a genuine cold start");

      // The same for an absent/null state (the other half of the forward-compat
      // fallback — a descriptor is always returned, it never throws).
      for (const absent of [undefined, null, ""]) {
        assert.equal(describeTerminalViewState(absent).text, "unknown");
      }
    },
  },
  {
    // QA SHOULD-FIX 3 (2026-07-23). view-state.mjs DOCUMENTS this transition —
    // "bytes arriving after an ended/disconnected state legitimately revive the
    // view" — and it is the ONE transition with no laundering guard, so it is the
    // one most worth pinning: a future "once ended, always ended" tightening would
    // silently freeze a genuinely revived stream, and nothing asserted otherwise.
    name: "task04/38-06 bytes arriving AFTER an ended/disconnected view legitimately revive it to streaming — the source is asserting liveness again",
    run: () => {
      const ended = terminalViewOnClose(terminalViewOnBytes(initialTerminalViewState()));
      assert.equal(ended, TERMINAL_VIEW_STATES.ENDED, "precondition: the view had ended");
      assert.equal(terminalViewOnBytes(ended), TERMINAL_VIEW_STATES.STREAMING, "a byte after `ended` revives the view — V9 forbids showing a liveness the source no longer asserts, never the reverse");
      assert.equal(describeTerminalViewState(terminalViewOnBytes(ended)).live, true);

      const dropped = terminalViewOnError(terminalViewOnBytes(initialTerminalViewState()));
      assert.equal(dropped, TERMINAL_VIEW_STATES.DISCONNECTED, "precondition: the view had dropped");
      assert.equal(terminalViewOnBytes(dropped), TERMINAL_VIEW_STATES.STREAMING, "and a byte after `disconnected` revives it too — a reconnected stream that is genuinely flowing must not keep reading as failed");

      // The revive is a genuine round trip: the revived view can end again.
      assert.equal(terminalViewOnClose(terminalViewOnBytes(ended)), TERMINAL_VIEW_STATES.ENDED);
    },
  },
  {
    // DESIGN §Surface 3 V10 (NEW 2026-07-23, GAP-3; CORRECTED §Correction 3).
    // `waiting for output` is a PROMISE; on an assignment that has already finished it
    // is the same species of lie as a stuck `working`. The ruling: keep the tuple-only
    // RESOLUTION (a state filter would hide a real captured stream), fix the LABEL —
    // and derive BOTH terminal-ness and the wording from `assignmentChip(row)`, never
    // a hand-maintained list.
    //
    // BEFORE this correction the describer read a `TERMINAL_ASSIGNMENT_STATES` set of
    // raw state strings `{done, failed, reclaimed}`. That set LEAKED the fleet's two
    // OTHER terminal states — `withdrawn` (operator-stop, ADR-001) and `stale` — so
    // their terminal-views sat on `waiting for output` forever: the exact lie V10
    // exists to kill, at two new addresses. This lane now pins that BOTH leaked states
    // read honestly, that terminal-ness is the chip's judgment (so `reclaimed` WITHOUT
    // `reclaimedAt` — which the chip degrades to `unknown` — is NOT asserted terminal),
    // and the V11 chip/bar split (short STATE in `text`, full REASON in `reason`).
    name: "task04/38-06 (V10) a stream whose assignment is terminal reads `no live output` — terminal-ness AND wording come from assignmentChip (no leaky state list), the ROUTING stays tuple-only, and the chip/bar split holds (V11)",
    async run() {
      const waiting = initialTerminalViewState();

      // NON-terminal (or absent) assignments keep the promise — output is still
      // possible, so `waiting for output` stays honest, with no override reason.
      const stillWaiting = describeTerminalViewState(waiting);
      assert.equal(stillWaiting.text, "waiting for output", "a stream that could still speak keeps the promise");
      assert.equal(stillWaiting.reason, undefined, "…and offers no bar override — the bar falls back to the same text");
      assert.equal(describeTerminalViewState(waiting, {}).text, "waiting for output", "and so does one whose assignment the caller did not supply");
      for (const state of ["assigned", "accepted", "running"]) {
        assert.equal(describeTerminalViewState(waiting, { assignment: { state } }).text, "waiting for output", `${state} is NOT terminal — output is still possible`);
      }
      // Forward-compat: a state neither this module NOR the chip recognises must NOT
      // be asserted terminal — we may not claim output is impossible for a state we do
      // not know. The chip degrades it to `unknown`, which is not `done`/`failed`.
      const future = describeTerminalViewState(waiting, { assignment: { state: "some-future-state" } });
      assert.equal(future.text, "waiting for output", "an unknown assignment state keeps `waiting for output` — the chip degrades to `unknown`, which is not terminal");
      assert.equal(future.reason, undefined);
      // …and the ONE-vocabulary consequence: a `reclaimed` row MISSING its reclaimedAt
      // is exactly such an unrecognised shape (assignmentChip needs reclaimedAt to
      // settle it to failed), so it too keeps waiting — no second list to drift.
      assert.equal(describeTerminalViewState(waiting, { assignment: { state: "reclaimed" } }).text, "waiting for output", "reclaimed WITHOUT reclaimedAt degrades to `unknown` at the chip — not terminal (one vocabulary, no drift)");

      // TERMINAL assignments now ALL read honestly — including the two the old set
      // leaked. Terminal-ness AND the words come from assignmentChip: done/failed read
      // directly; `withdrawn` and reclaimed/`stale` (with `reclaimedAt`) SETTLE to
      // `failed`, carrying the chip's `· reclaimed` note where it has one.
      const terminalCases = [
        { assignment: { state: "done" }, reason: "no live output — assignment done", leaked: false },
        { assignment: { state: "failed" }, reason: "no live output — assignment failed", leaked: false },
        { assignment: { state: "reclaimed", reclaimedAt: NOW }, reason: "no live output — assignment failed · reclaimed", leaked: false },
        // The two §Correction 3 addresses — terminal, and formerly stuck on `waiting`.
        { assignment: { state: "withdrawn" }, reason: "no live output — assignment failed", leaked: true },
        { assignment: { state: "stale", reclaimedAt: NOW }, reason: "no live output — assignment failed · reclaimed", leaked: true },
      ];
      for (const { assignment, reason, leaked } of terminalCases) {
        const descriptor = describeTerminalViewState(waiting, { assignment });
        // V11 chip/bar SPLIT: the header STATE chip carries the short in-family word…
        assert.equal(descriptor.text, "no live output", `the header STATE chip is the short 14-char word (${assignment.state})`);
        assert.equal(descriptor.text.length, 14, "…exactly `no live output` (14 chars) — a chip that grows into a sentence wraps the header (V11)");
        // …while the BAR carries the full REASON in the m35 ramp's own words + note.
        assert.equal(descriptor.reason, reason, `the viewport BAR carries the REASON in assignmentChip's own words (${assignment.state})`);
        assert.notEqual(descriptor.text, descriptor.reason, "chip and bar are SPLIT — the long reason never lands in the header chip");
        // …and it is the SAME WAITING state, told truthfully — no new primitive.
        assert.equal(descriptor.state, TERMINAL_VIEW_STATES.WAITING, "it is the SAME state, told truthfully — no new state was invented");
        assert.equal(descriptor.token, "muted", "on the same quiet token — no new primitive, never an error");
        assert.equal(descriptor.reads, "normal");
        assert.equal(descriptor.motion, "none");
        assert.equal(descriptor.live, false);
        if (leaked) {
          assert.notEqual(descriptor.text, "waiting for output", `${assignment.state} no longer leaks a \`waiting for output\` that can never come true (§Correction 3)`);
        }
      }

      // The stronger fact wins: a view that ACTUALLY received bytes keeps its own
      // ramp, whatever the assignment says — and carries no bar override.
      for (const [state, text] of [
        [TERMINAL_VIEW_STATES.STREAMING, "streaming"],
        [TERMINAL_VIEW_STATES.ENDED, "stream ended"],
        [TERMINAL_VIEW_STATES.DISCONNECTED, "disconnected"],
      ]) {
        const descriptor = describeTerminalViewState(state, { assignment: { state: "done" } });
        assert.equal(descriptor.text, text, "a view that received bytes keeps its OWN ramp, whatever the assignment says");
        assert.equal(descriptor.reason, undefined, "…and carries no override reason — the bar renders its own state word");
      }

      // And the ROUTING is untouched (the half V10 explicitly forbids changing):
      // a terminal assignment that captured a session still RESOLVES its stream.
      const stream = resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-1", state: "done" });
      assert.equal(stream.resolved, true, "a finished assignment's captured stream is still resolvable — the label tells the truth, the resolver hides nothing");
      assert.equal(stream.sessionId, "sess-1");

      // The chip/bar split is genuinely WIRED in the component, not merely present on
      // the descriptor: the header chip renders the short STATE (`descriptor.text`)
      // and the message slots render the REASON with a fallback (`descriptor.reason ??
      // descriptor.text`). A descriptor that grew a `reason` the component ignored
      // would lose the detail and leave the header showing the long string again.
      const view = await readFile(path.join(TERMINAL_VIEW_DIR, "FleetTerminalView.tsx"), "utf8");
      assert.ok(/\{descriptor\.text\}/.test(view), "the header STATE chip renders descriptor.text (the short word)");
      assert.ok(/\{descriptor\.reason \?\? descriptor\.text\}/.test(view), "the viewport bar renders `descriptor.reason ?? descriptor.text` (the REASON, with a fallback) — the chip/bar split is wired, not just declared");
      assert.ok(/describeTerminalViewState\(view, \{ assignment \}\)/.test(view), "the component passes the assignment ROW to the describer, not a bare state string");
    },
  },
  {
    // DESIGN §Surface 3 V11 (NEW 2026-07-23, GAP-1) — confirmed in a real render:
    // `stream ended` was painted unbacked over the last output line and BOTH became
    // unreadable. Structural, over the real component source: chrome that destroys
    // the content it annotates is worse than no chrome.
    name: "task04/38-06 (V11) the non-live message never overprints the frame it describes — ended/disconnected render on an OPAQUE bar in the dock's own tokens, top-left is reserved for the empty pane",
    async run() {
      const view = await readFile(path.join(TERMINAL_VIEW_DIR, "FleetTerminalView.tsx"), "utf8");
      const dock = await readFile(path.join(repoRoot, "ui", "src", "board", "TerminalDock.tsx"), "utf8");

      // The bar exists, is OPAQUE (a background, not bare text), sits at the BOTTOM
      // of the terminal pane, and spends only chrome the board dock already owns.
      const bar = /className="[^"]*border-t border-\[#1e2a44\][^"]*"/.exec(view)?.[0] ?? null;
      assert.ok(bar != null, "the non-live message renders on its own bar under the byte area — where the newest line is and the eye already is");
      assert.ok(/bg-\[#0f1629\]/.test(bar), "…on an OPAQUE background (the dock's own panel token) — never unbacked text over live glyphs");
      assert.ok(!/\babsolute\b/.test(bar), "…and it takes its OWN layout space rather than floating over the pane: an opaque bar overlaid on the bottom still HIDES the newest line (measured), which is GAP-1 relocated, not fixed");
      assert.ok(
        /className="relative min-h-0 flex-1"/.test(lf(view)) && /className="flex h-48 min-h-0 flex-col/.test(lf(view)),
        "…which is only true because the byte area is a flex-1 sibling that SHRINKS by the bar's height (the ResizeObserver then refits xterm into the smaller box)",
      );
      assert.ok(lf(dock).includes("#0f1629") && lf(dock).includes("#1e2a44"), "precondition: both tokens are the BOARD dock's, reused — no fleet-local chrome is invented (V3)");

      // The top-left placement survives ONLY for the state whose pane is empty by
      // definition, and the dead frame is dimmed (with the label still carrying the
      // meaning — V6: dimming never travels alone).
      const topOverlay = /className="[^"]*absolute[^"]*top-0[^"]*"/.exec(view)?.[0] ?? null;
      assert.ok(topOverlay != null, "the empty/cold-start message still sits at the top-left, where the first line will appear");
      assert.ok(!/bg-\[/.test(topOverlay), "…and needs no bar: nothing can be overprinted on a pane that is empty by definition");
      assert.ok(
        /overprintable\s*=\s*descriptor\.state === TERMINAL_VIEW_STATES\.WAITING/.test(lf(view)),
        "…and that placement is gated on the WAITING state specifically, not on `not live` (which is also true of ended/disconnected)",
      );
      assert.ok(/opacity-60/.test(view), "the frozen frame of a dead stream is dimmed — dead separated from live");
      assert.ok(/\{descriptor\.text\}/.test(view), "…while the LABEL always carries the meaning (V6: the dim never travels alone)");
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V1/V8 — "the view NAMES its stream, and multiplexed cards never cross-wire"
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "task04/38-06 each view's header names its OWN (nodeId, sessionId) resolved to the assignment ref it belongs to — and a terminal with no visible owner is never rendered",
    run: () => {
      const headerA = terminalStreamHeader(resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-1" }), { itemRef: "38/06" });
      const headerB = terminalStreamHeader(resolveTerminalStream({ targetNodeId: "node-b", sessionId: "sess-2" }), { itemRef: "38/07" });

      assert.equal(headerA.ref, "38/06");
      assert.equal(headerA.nodeId, "node-a");
      assert.equal(headerA.sessionId, "sess-1");
      assert.ok(headerA.label.includes("38/06") && headerA.label.includes("node-a"), "the header names the assignment ref AND the node — not a raw id alone (V1)");
      assert.ok(headerA.sessionLabel.includes("sess-1"));
      assert.equal(headerA.readOnlyLabel, "read-only", "the read-only posture travels as an explicit LABEL (V2/V6)");

      // Neither header mentions the other's stream.
      assert.ok(!headerA.label.includes("node-b") && !headerA.sessionLabel.includes("sess-2"));
      assert.ok(!headerB.label.includes("node-a") && !headerB.sessionLabel.includes("sess-1"));
      assert.notEqual(headerA.key, headerB.key);

      // The subscription key is the FULL tuple, never the node alone: two sessions
      // on the SAME node are two DIFFERENT keys (V8).
      const sameNodeOne = terminalStreamHeader(resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-1" }), { itemRef: "38/06" });
      const sameNodeTwo = terminalStreamHeader(resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-9" }), { itemRef: "38/08" });
      assert.notEqual(sameNodeOne.key, sameNodeTwo.key, "same node, different session ⇒ different subscription key");

      // A terminal with no visible owner is never rendered (V1): a resolvable
      // stream the view cannot NAME yields no header at all.
      assert.equal(terminalStreamHeader(resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-1" }), {}), null);
      // …and it degrades to the assignment id when no human ref is available,
      // rather than rendering an anonymous terminal.
      const byId = terminalStreamHeader(resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-1" }), { assignmentId: "asg-1" });
      assert.equal(byId.ref, "asg-1");
    },
  },
  {
    name: "task04/38-06 two multiplexed views over the REAL /ws/terminal-view route are never handed each other's bytes",
    async run() {
      // PRODUCER-FED end-to-end: the URLs the REAL resolver produced are dialled
      // against the REAL serveMeshUi route over the REAL in-memory mirror, fed by
      // the REAL terminal-frame envelope builder.
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-terminal-view-"));
      const root = path.join(tmp, "repo");
      const distRoot = path.join(tmp, "dist");
      const home = path.join(tmp, "home");
      let server;
      const sockets = [];
      try {
        await mkdir(path.join(root, ".aof"), { recursive: true });
        await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
        await mkdir(path.join(meshUiDist(distRoot), "assets"), { recursive: true });
        await writeFile(path.join(meshUiDist(distRoot), "index.html"), "<!doctype html><html><body></body></html>\n", "utf8");
        await writeFile(path.join(meshUiDist(distRoot), "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");

        const mirror = createTerminalMirror();
        ({ server } = await serveMeshUi({
          projectDir: root, port: 0, repoRoot: distRoot,
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          terminalMirror: mirror,
        }));
        const host = `127.0.0.1:${server.address().port}`;

        const streamA = resolveTerminalStream({ targetNodeId: "node-a", sessionId: "sess-1" });
        const streamB = resolveTerminalStream({ targetNodeId: "node-b", sessionId: "sess-2" });
        const received = { a: [], b: [] };
        for (const [bucket, stream] of [["a", streamA], ["b", streamB]]) {
          const url = terminalViewSocketUrl(stream, { protocol: "http:", host });
          const ws = new WebSocket(url);
          sockets.push(ws);
          ws.on("message", (data) => received[bucket].push(data.toString()));
          await new Promise((resolve, reject) => {
            ws.on("open", resolve);
            ws.on("error", reject);
          });
        }

        mirror.apply(buildTerminalFrameEnvelope("node-a", "sess-1", "hello from a\n"));
        mirror.apply(buildTerminalFrameEnvelope("node-b", "sess-2", "hello from b\n"));
        // An unresolvable frame (no open subscription for its tuple) is dropped —
        // never bled into an unrelated view.
        mirror.apply(buildTerminalFrameEnvelope("node-a", "sess-ghost", "orphan bytes\n"));

        const start = Date.now();
        while (received.a.length < 1 || received.b.length < 1) {
          if (Date.now() - start > 2000) throw new Error("timeout waiting for the multiplexed frames");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.deepEqual(received.a, ["hello from a\n"], "view A saw ONLY its own stream's bytes");
        assert.deepEqual(received.b, ["hello from b\n"], "view B saw ONLY its own stream's bytes");
      } finally {
        for (const ws of sockets) {
          try { ws.close(); } catch { /* already closing */ }
        }
        if (server) await new Promise((resolve) => server.close(resolve));
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // V3 — "the view reuses the existing terminal rendering, and the typed UI build
  // stays green"
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "task04/38-06 the fleet view renders through the SAME xterm idiom the board dock uses — no fleet-local terminal chrome, colour, frame or accent is invented",
    async run() {
      const view = await readFile(path.join(TERMINAL_VIEW_DIR, "FleetTerminalView.tsx"), "utf8");
      const dock = await readFile(path.join(repoRoot, "ui", "src", "board", "TerminalDock.tsx"), "utf8");

      // The SAME terminal package + fit addon + stylesheet the board dock loads.
      for (const specifier of ['from "@xterm/xterm"', 'from "@xterm/addon-fit"', '"@xterm/xterm/css/xterm.css"']) {
        assert.ok(dock.includes(specifier), `precondition: the board dock imports ${specifier}`);
        assert.ok(view.includes(specifier), `the fleet view reuses ${specifier} — not a fleet-local terminal`);
      }

      // The terminal's own look is COPIED, not re-invented: the same mono font
      // stack, the same font size, the same dark viewport theme literal.
      // CRLF-NORMALISED on BOTH sides (architect N6, 2026-07-23): TerminalDock.tsx
      // is a CRLF file and FleetTerminalView.tsx is an LF one, so a raw comparison
      // is one multi-line reformat away from failing on line endings alone.
      const themeOf = (source) => /theme:\s*\{[^}]*\}/.exec(lf(source))?.[0] ?? null;
      assert.ok(themeOf(dock) != null, "precondition: the board dock declares an xterm theme");
      assert.equal(themeOf(view), themeOf(dock), "the fleet view's xterm theme is byte-identical to the board dock's");
      const fontOf = (source) => /fontFamily:\s*"[^"]*"/.exec(lf(source))?.[0] ?? null;
      assert.equal(fontOf(view), fontOf(dock), "the same mono font stack");
      assert.ok(view.includes("fontSize: 13"), "the same font size");
      assert.ok(view.includes('bg-[#0b0f14]') && view.includes('border-[#1e2a44]'), "the same dark viewport/chrome classes the dock already uses");

      // No fleet-local terminal palette: the ONLY colour literals in the view are
      // ones the board dock already spends.
      const dockHexes = new Set(dock.match(/#[0-9a-fA-F]{3,8}/g) ?? []);
      const viewHexes = new Set(view.match(/#[0-9a-fA-F]{3,8}/g) ?? []);
      const invented = [...viewHexes].filter((hex) => !dockHexes.has(hex));
      assert.deepEqual(invented, [], "the fleet view invents NO colour of its own");
    },
  },
  {
    // NAMED FOR WHAT IT PROVES (QA SHOULD-FIX 1, 2026-07-23): this lane checks the
    // .d.mts companion FILES exist and are imported — a structural, filesystem-level
    // check. It does NOT run the typed build, so it cannot claim `tsc -b && vite
    // build stays green`; the lane BELOW does that for real. Both are kept: this one
    // localises the failure to "the companion is missing" (the F2 lesson) in under a
    // millisecond, and stays a gate on a machine with no TypeScript installed.
    name: "task04/38-06 every framework-free terminal-view .mjs helper ships its .d.mts companion, and the component that imports it is mounted (the companion-PRESENCE half — the node suite does not type-check the fleet TS)",
    async run() {
      const entries = await readdir(TERMINAL_VIEW_DIR);
      const helpers = entries.filter((name) => name.endsWith(".mjs"));
      assert.ok(helpers.length >= 2, "the terminal-view ships its logic as framework-free .mjs helpers (the board-terminal house pattern)");
      for (const helper of helpers) {
        const companion = `${helper.slice(0, -".mjs".length)}.d.mts`;
        assert.ok(entries.includes(companion), `${helper} ships its ${companion} companion (the node suite does NOT type-check the fleet TS)`);
      }
      // And the component genuinely CONSUMES them (a helper nothing imports is not
      // a seam — the F-38.05 lesson at this scale).
      const view = await readFile(path.join(TERMINAL_VIEW_DIR, "FleetTerminalView.tsx"), "utf8");
      for (const helper of helpers) {
        assert.ok(view.includes(`./${helper}`), `FleetTerminalView.tsx imports ./${helper}`);
      }
      // And the fleet page MOUNTS the component (F-38.06c was a component-shaped
      // hole; an unmounted component would be the same hole one layer in).
      const fleet = await readFile(path.join(repoRoot, "ui", "src", "fleet", "Fleet.tsx"), "utf8");
      assert.ok(fleet.includes("FleetTerminalView"), "Fleet.tsx mounts the terminal view from the work-item card");
    },
  },
  {
    // The REAL half of the V3 step "…so `tsc -b && vite build` passes" (QA
    // SHOULD-FIX 1, 2026-07-23). The companion-presence lane above proves the FILES
    // are there; only the compiler proves they TYPE. This milestone's own F2 was
    // exactly that gap — `ui/src/fleet/runs.mjs` shipped without its `.d.mts`, the
    // node suite stayed green, and `tsc -b && vite build` failed on an implicit any.
    //
    // GUARD-IF-PRESENT, mirroring the cargo lanes in scripts/test.mjs: TypeScript is
    // a devDependency hoisted to the repo root, so it is present on any `npm ci`
    // tree — but a SEA/packaged checkout without node_modules must not be failed for
    // a toolchain it never installed. The check runs the compiler DIRECTLY through
    // this process's own node (`process.execPath node_modules/typescript/bin/tsc`) —
    // never `npx` (policy-blocked, and it would resolve/fetch off-tree).
    //
    // `-b ui` builds the ui/ solution (tsconfig.app.json + tsconfig.node.json). Both
    // are `noEmit` with their tsBuildInfoFile under an ignored node_modules/.tmp, so
    // this writes NOTHING into the tracked tree. `--force` defeats the incremental
    // cache: a lane that silently no-ops because a previous build left a fresh
    // .tsbuildinfo would be a hollow pass — the exact class of defect this file was
    // written to catch. Measured ~2s.
    name: "task04/38-06 the typed UI build genuinely type-checks — `tsc -b ui` compiles the fleet terminal-view clean (guard-if-present; skips when TypeScript is not installed)",
    async run() {
      const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
      const solution = path.join(repoRoot, "ui", "tsconfig.json");
      if (!existsSync(tsc) || !existsSync(solution)) {
        // The honest-degrade path: announce the skip rather than pretend a pass.
        console.log(`# skip - tsc -b ui (typescript=${existsSync(tsc)}, ui/tsconfig.json=${existsSync(solution)})`);
        return;
      }
      const result = spawnSync(process.execPath, [tsc, "-b", "ui", "--force"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 300000,
      });
      assert.equal(result.error, undefined, `tsc could not be spawned: ${String(result.error?.message ?? "")}`);
      assert.equal(
        result.status,
        0,
        `\`tsc -b ui\` must compile clean — the typed UI build is part of this task's own contract (V3).\n`
        + `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`,
      );
    },
  },
];

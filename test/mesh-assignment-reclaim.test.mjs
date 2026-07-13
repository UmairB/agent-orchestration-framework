// task 04 — a non-terminal assignment is reclaimed ONLY under DUAL staleness (worker
// presence stale AND run heartbeat stale, both strict), and reclaim force-fails the
// linked run runtime_offline, retryable, so the item is re-assignable (milestone 35 /
// story 02, ADR-005). Exercised over a TEMP fixture repo with a FIXTURE presence
// record + a node-partitioned run record whose stamps the test controls + a store
// assignment row in a non-terminal state, driving the reclaim decision at an injected
// `now` that feeds BOTH predicates. Mined from
// reference/retired-dispatch-tests/fleet-orphan-reclaim.mjs.
import assert from "node:assert/strict";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment, findActiveAssignment } from "../src/assignment-record.mjs";
import { publishPresenceRecord } from "../src/mesh-presence.mjs";
import { startRun, heartbeat, readRuns, isRetryable } from "../src/run-store.mjs";
import { findWork } from "../src/work.mjs";
import { reclaimStaleAssignments, dualStalenessDecision, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS } from "../src/mesh-assignment-reclaim.mjs";
import { withMeshWorkerExecFixture } from "./support/mesh-worker-exec-fixture.mjs";

const NOW = "2026-07-09T12:00:00.000Z";
const TARGET_NODE = "node-b";
const secondsBefore = (iso, seconds) => new Date(Date.parse(iso) - seconds * 1000).toISOString();
const msBefore = (iso, ms) => new Date(Date.parse(iso) - ms).toISOString();

const PRESENCE_STALE = secondsBefore(NOW, 120); // > 90s ⇒ stale
const PRESENCE_FRESH = secondsBefore(NOW, 30); // <= 90s ⇒ fresh
const PRESENCE_AT = secondsBefore(NOW, 90); // == 90s ⇒ still LIVE (strict >)
const HEARTBEAT_STALE = msBefore(NOW, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS + 60_000); // > 15m ⇒ stale
const HEARTBEAT_FRESH = secondsBefore(NOW, 60); // <= 15m ⇒ fresh

async function seedRunningAssignment(fx, store, { runHeartbeatAt }) {
  const matches = await findWork(fx.workDir, fx.itemRef);
  const item = matches[0];
  const runRecord = await startRun(item, { now: secondsBefore(NOW, 600), node: TARGET_NODE });
  await heartbeat(item, runRecord.runId, { now: runHeartbeatAt });

  const record = assembleAssignmentRecord({
    itemRef: fx.itemRef,
    workspaceId: fx.workspaceId,
    targetNodeId: TARGET_NODE,
    issuer: "control-a",
    state: "running",
    runId: runRecord.runId,
    now: secondsBefore(NOW, 600),
  });
  insertAssignment(store, record);
  return { item, runRecord, record };
}

async function seedPresence(fx, heartbeatAt) {
  if (heartbeatAt == null) return; // "no presence record" row: seed nothing
  await publishPresenceRecord(fx.workspace, TARGET_NODE, { nodeId: TARGET_NODE, heartbeatAt, activeRuns: [], aofVersion: "1.0.0" });
}

export const meshAssignmentReclaimTests = [
  {
    name: "assignment-reclaim/04 an assignment is reclaimed only under dual staleness — Scenario Outline (6 rows: stale+stale reclaims; presence precedence; conservative wait; fresh+fresh; AT-threshold still live; no-presence hands-off)",
    run: async () => {
      const rows = [
        { label: "stale presence + stale heartbeat", presence: PRESENCE_STALE, heartbeat: HEARTBEAT_STALE, reclaimed: true },
        { label: "fresh presence + stale heartbeat (presence precedence)", presence: PRESENCE_FRESH, heartbeat: HEARTBEAT_STALE, reclaimed: false },
        { label: "stale presence + fresh heartbeat (conservative wait)", presence: PRESENCE_STALE, heartbeat: HEARTBEAT_FRESH, reclaimed: false },
        { label: "fresh presence + fresh heartbeat", presence: PRESENCE_FRESH, heartbeat: HEARTBEAT_FRESH, reclaimed: false },
        { label: "exactly AT the presence threshold (still LIVE — strict >)", presence: PRESENCE_AT, heartbeat: HEARTBEAT_STALE, reclaimed: false },
        { label: "no presence record (unknown liveness, not staleness)", presence: null, heartbeat: HEARTBEAT_STALE, reclaimed: false },
      ];
      for (const row of rows) {
        await withMeshWorkerExecFixture(async (fx) => {
          const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
          try {
            const { record } = await seedRunningAssignment(fx, store, { runHeartbeatAt: row.heartbeat });
            await seedPresence(fx, row.presence);

            const result = await reclaimStaleAssignments(store, fx.workspace, fx.workspaceId, { now: NOW });

            if (row.reclaimed) {
              assert.equal(result.length, 1, `[${row.label}] the assignment is reclaimed`);
              const after = readAssignment(store, record.assignmentId);
              assert.equal(after.state, "reclaimed", `[${row.label}] state is reclaimed`);
            } else {
              assert.equal(result.length, 0, `[${row.label}] the assignment is hands-off`);
              const after = readAssignment(store, record.assignmentId);
              assert.equal(after.state, "running", `[${row.label}] the assignment stays running, byte-unchanged`);
            }
          } finally {
            store.close();
          }
        });
      }
    },
  },
  {
    name: "assignment-reclaim/04 dual staleness sets the assignment reclaimed with a reclaimedAt stamp and force-fails the run runtime_offline retryable",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      try {
        const { item, runRecord, record } = await seedRunningAssignment(fx, store, { runHeartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx, PRESENCE_STALE);

        await reclaimStaleAssignments(store, fx.workspace, fx.workspaceId, { now: NOW });

        const after = readAssignment(store, record.assignmentId);
        assert.equal(after.state, "reclaimed");
        assert.equal(after.reclaimedAt, NOW, 'the assignment carries a "reclaimedAt" stamp of "now"');

        const runs = await readRuns(item);
        const run = runs.find((r) => r.runId === runRecord.runId);
        assert.equal(run.state, "failed", "the linked run is force-failed");
        assert.equal(run.failureReason, "runtime_offline");
        assert.equal(isRetryable(run.failureReason), true, "that failure reason is retryable");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "assignment-reclaim/04 after a reclaim the item is assignable again — the store uniqueness check passes",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      try {
        await seedRunningAssignment(fx, store, { runHeartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx, PRESENCE_STALE);
        await reclaimStaleAssignments(store, fx.workspace, fx.workspaceId, { now: NOW });

        const active = findActiveAssignment(store, fx.workspaceId, fx.itemRef);
        assert.equal(active, null, "no active assignment remains on the item");

        const now2 = secondsBefore(NOW, -60);
        const record2 = assembleAssignmentRecord({
          itemRef: fx.itemRef,
          workspaceId: fx.workspaceId,
          targetNodeId: "node-c",
          issuer: "control-a",
          now: now2,
        });
        insertAssignment(store, record2);
        const readBack = readAssignment(store, record2.assignmentId);
        assert.equal(readBack.targetNodeId, "node-c", "a new assignment for the item is minted");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "assignment-reclaim/04 only the reclaim path stamps reclaimedAt on the run — Scenario Outline (operator-reported failed vs dual-staleness reclaim)",
    run: async () => {
      // Row 1: an operator-reported (not reclaimed) failed run never carries reclaimedAt.
      await withMeshWorkerExecFixture(async (fx) => {
        const { completeRun } = await import("../src/run-store.mjs");
        const matches = await findWork(fx.workDir, fx.itemRef);
        const item = matches[0];
        const runRecord = await startRun(item, { now: secondsBefore(NOW, 600), node: TARGET_NODE });
        const completed = await completeRun(item, { runId: runRecord.runId, outcome: "failed", failureReason: "agent_error", now: NOW });
        assert.equal(completed.reclaimedAt, null, 'a run failed via an operator-reported outcome has reclaimedAt null');
      });

      // Row 2: a dual-staleness reclaim stamps reclaimedAt with the "now" the reclaim ran at.
      await withMeshWorkerExecFixture(async (fx) => {
        const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
        try {
          const { item, runRecord } = await seedRunningAssignment(fx, store, { runHeartbeatAt: HEARTBEAT_STALE });
          await seedPresence(fx, PRESENCE_STALE);
          await reclaimStaleAssignments(store, fx.workspace, fx.workspaceId, { now: NOW });
          const runs = await readRuns(item);
          const run = runs.find((r) => r.runId === runRecord.runId);
          assert.equal(run.reclaimedAt, NOW, 'a run failed via a dual-staleness reclaim has reclaimedAt the "now" stamp');
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "assignment-reclaim/04 dualStalenessDecision ANDs the two IMPORTED predicates — a unit-level check of the decision function itself",
    run: () => {
      const thresholds = { presenceThresholdMs: 90 * 1000, heartbeatThresholdMs: DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS };
      const nowMs = Date.parse(NOW);
      assert.equal(
        dualStalenessDecision({ presence: { heartbeatAt: PRESENCE_STALE }, heartbeatAt: HEARTBEAT_STALE }, nowMs, thresholds),
        true,
      );
      assert.equal(
        dualStalenessDecision({ presence: { heartbeatAt: PRESENCE_FRESH }, heartbeatAt: HEARTBEAT_STALE }, nowMs, thresholds),
        false,
      );
      assert.equal(dualStalenessDecision({ presence: null, heartbeatAt: HEARTBEAT_STALE }, nowMs, thresholds), false);
    },
  },
];

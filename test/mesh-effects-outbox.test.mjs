// test/mesh-effects-outbox.test.mjs — m42 wave (d) leg d3: FACTS OVER THE BRIDGE.
//
// The defect these lanes exist for is measured, not theoretical (STATE 2026-07-27):
// "Worker startup-reclaim frames are fire-once — the Mac worker restarted in the
// ~3-min window while the control was ALSO down; its `failed/daemon-restarted`
// report for run 0017's stranded worktree died on the dead connection, and the
// control row read a stale `running` for 35+ min". Every scenario below is a
// property of the cure: the fact is owed durably, delivery is separate from
// completion, an offline send loses nothing, and the control node's verdict — not
// the socket — is what ends the obligation.
import assert from "node:assert/strict";
import { openEffectsJournal, appendEvent, readEventSteps, pendingSteps } from "../src/effects/journal.mjs";
import { drainEffects, LOCAL_LOCI, CONTROL_LOCI } from "../src/effects/dispatch.mjs";
import { drainOutbox, remoteSteps, applyEffectAck, EFFECT_STEP_FRAME_KIND, EFFECT_ACK_FRAME_KIND } from "../src/effects/outbox.mjs";
import { reportAssignmentSettled } from "../src/effects/assignment-transitions.mjs";
import { applyStreamFrame } from "../src/control-stream-server.mjs";
import { readAssignment } from "../src/assignment-record.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { withMeshAssignFixture, seedAssignment } from "./support/mesh-assign-fixture.mjs";

const NOW = "2026-07-31T10:00:00.000Z";

// A journal in the fixture's isolated global home.
async function withJournal({ home }, fn) {
  const journal = await openEffectsJournal({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn(journal);
  } finally {
    journal.close();
  }
}

// The worker's owed step, raised the way production raises it.
async function raiseReport({ home }, report) {
  return reportAssignmentSettled(
    { now: NOW, ...report },
    { journalOptions: { env: { AOF_GLOBAL_HOME: home } } },
  );
}

// A control-node double that accepts every step and answers with the ack frame
// the real server sends, so a test can close the loop without a socket.
function acceptingControl() {
  const seen = [];
  return {
    seen,
    async send(envelope) {
      seen.push(envelope);
      return { sent: true };
    },
  };
}

export const meshEffectsOutboxTests = [
  {
    name: "effects-outbox/d3 a control-store step is OWED by a worker, not run by it — the local drain defers it and the outbox claims it",
    run: async () => withMeshAssignFixture(async ({ home }) => {
      const { eventId } = await raiseReport({ home }, { assignmentId: "asg-1", state: "failed", code: "daemon-restarted" });
      assert.ok(eventId, "the report is durable — it has an event id");

      await withJournal({ home }, async (journal) => {
        // The worker's own drain reaches checkout + local only.
        const outcomes = await drainEffects({ journal, eventId, loci: LOCAL_LOCI, now: NOW });
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0].locus, "control-store");
        assert.equal(outcomes[0].status, "deferred", "a worker never runs a control-store reactor itself");

        const steps = readEventSteps(journal, eventId);
        assert.equal(steps[0].status, "pending", "the step is still OWED after the local drain");

        const owed = remoteSteps(journal, { loci: LOCAL_LOCI });
        assert.deepEqual(
          owed.map((step) => [step.name, step.key]),
          [["assignment.reported", "settle-assignment"]],
          "the outbox's work-list is exactly the steps this node cannot run",
        );
      });
    }),
  },
  {
    name: "effects-outbox/d3 DELIVERY IS NOT COMPLETION — a shipped step stays pending until the control node acks it",
    run: async () => withMeshAssignFixture(async ({ home }) => {
      const { eventId } = await raiseReport({ home }, { assignmentId: "asg-2", state: "done", branch: "aof/mesh/35-00" });
      await withJournal({ home }, async (journal) => {
        const control = acceptingControl();
        const shipped = await drainOutbox({ journal, send: control.send, now: NOW });
        assert.equal(shipped.length, 1);
        assert.equal(shipped[0].status, "sent");
        assert.equal(control.seen.length, 1, "the envelope reached the transport");
        assert.equal(control.seen[0].name, "assignment.reported");
        assert.equal(control.seen[0].payload.branch, "aof/mesh/35-00", "the fact carries its own evidence");

        assert.equal(readEventSteps(journal, eventId)[0].status, "pending", "a SENT step is still owed — the receipt is the ack, not the send");

        applyEffectAck(journal, { eventId, reactorKey: "settle-assignment", ok: true }, { now: NOW });
        assert.equal(readEventSteps(journal, eventId)[0].status, "done", "the ack is what pays the step");
      });
    }),
  },
  {
    name: "effects-outbox/d3 THE MEASURED DEFECT: a report raised while the control node is unreachable is redelivered by the next drain, never lost",
    run: async () => withMeshAssignFixture(async ({ home }) => {
      // The worker restarts and reports a stranded worktree — with nobody home.
      const { eventId } = await raiseReport({ home }, { assignmentId: "asg-3", state: "failed", code: "daemon-restarted" });
      await withJournal({ home }, async (journal) => {
        const offline = [];
        const first = await drainOutbox({
          journal,
          send: async (envelope) => {
            offline.push(envelope);
            return { sent: false, code: "not-connected" };
          },
          now: NOW,
        });
        assert.equal(first[0].status, "unsent");
        const afterOffline = readEventSteps(journal, eventId)[0];
        assert.equal(afterOffline.status, "pending", "an offline send leaves the fact owed");
        assert.equal(afterOffline.attempts, 0, "being offline is not a failed attempt — it must never burn the retry budget");

        // The connection returns; the very next drain ships it.
        const control = acceptingControl();
        const second = await drainOutbox({ journal, send: control.send, now: NOW });
        assert.equal(second[0].status, "sent", "the next drain redelivers — this is the fire-once cure");
        assert.equal(control.seen[0].payload.code, "daemon-restarted", "the redelivered fact is the same fact");
      });
    }),
  },
  {
    name: "effects-outbox/d3 the ack vocabulary: ok pays, a coded refusal ENDS the step (never a redelivery loop), a bare fault leaves it retryable",
    run: async () => withMeshAssignFixture(async ({ home }) => {
      const a = await raiseReport({ home }, { assignmentId: "asg-ok", state: "done" });
      const b = await raiseReport({ home }, { assignmentId: "asg-refused", state: "done" });
      const c = await raiseReport({ home }, { assignmentId: "asg-fault", state: "done" });
      await withJournal({ home }, async (journal) => {
        applyEffectAck(journal, { eventId: a.eventId, reactorKey: "settle-assignment", ok: true }, { now: NOW });
        applyEffectAck(journal, { eventId: b.eventId, reactorKey: "settle-assignment", ok: false, code: "assignment-status-already-terminal" }, { now: NOW });
        applyEffectAck(journal, { eventId: c.eventId, reactorKey: "settle-assignment", ok: false }, { now: NOW });

        assert.equal(readEventSteps(journal, a.eventId)[0].status, "done");
        const refused = readEventSteps(journal, b.eventId)[0];
        assert.equal(refused.status, "skipped", "a DECIDED refusal ends the obligation — redelivering it would loop forever");
        assert.equal(refused.lastError, "assignment-status-already-terminal", "the verdict is recorded, never silent");
        assert.equal(readEventSteps(journal, c.eventId)[0].status, "failed", "a fault stays retryable");

        // Only the fault is still owed.
        const owed = remoteSteps(journal, { loci: LOCAL_LOCI }).map((step) => step.eventId);
        assert.deepEqual(owed, [c.eventId]);

        // A duplicate ack for a settled step is the at-least-once tax, paid quietly.
        const dupe = applyEffectAck(journal, { eventId: a.eventId, reactorKey: "settle-assignment", ok: true }, { now: NOW });
        assert.equal(dupe.applied, false);
        assert.equal(dupe.code, "effect-ack-already-settled");
        // An ack for a step this journal never owed is ignored, never fabricated.
        const ghost = applyEffectAck(journal, { eventId: "nope", reactorKey: "settle-assignment", ok: true }, { now: NOW });
        assert.equal(ghost.code, "effect-ack-unknown-step");
      });
    }),
  },
  {
    name: "effects-outbox/d3 END TO END over the real bridge door: a shipped step settles the control row through the transition and is acked",
    run: async () => withMeshAssignFixture(async ({ workspaceId, home }) => {
      await seedAssignment({ home }, {
        assignmentId: "asg-e2e",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-31T09:00:00.000Z",
        updatedAt: "2026-07-31T09:00:00.000Z",
      });
      const { eventId } = await raiseReport({ home }, { assignmentId: "asg-e2e", state: "done", branch: "aof/mesh/35-00-asg-e2e" });

      // Ship it the way the worker does, then hand the envelope to the control's
      // own frame door — with the connection's authenticated identity.
      const envelope = await withJournal({ home }, async (journal) => {
        const control = acceptingControl();
        await drainOutbox({ journal, send: control.send, now: NOW, eventId });
        return control.seen[0];
      });
      assert.ok(envelope, "the worker shipped one envelope");

      const sent = [];
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        const result = await applyStreamFrame(store, { kind: EFFECT_STEP_FRAME_KIND, nodeId: "worker-a", ...envelope }, {
          nodeId: "worker-a",
          now: NOW,
          journalOptions: { env: { AOF_GLOBAL_HOME: home } },
          directiveTargets: { get: () => ({ fake: true }), send: () => ({ sent: true }) },
          sendDirective: (_targets, _to, frame) => { sent.push(frame); return { sent: true }; },
        });
        assert.equal(result.applied, true, "the control node applied the bridged fact");

        const row = readAssignment(store, "asg-e2e");
        assert.equal(row.state, "done", "the assignment row settled — the fact crossed the bridge and landed");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "effects-outbox/d3 the bridge door is GUARDED: an unknown event, an undeclared reactor, and a non-holder are each refused with a code — the transition's rules apply to a bridged fact",
    run: async () => withMeshAssignFixture(async ({ workspaceId, home }) => {
      await seedAssignment({ home }, {
        assignmentId: "asg-guarded",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-31T09:00:00.000Z",
        updatedAt: "2026-07-31T09:00:00.000Z",
      });
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      const options = {
        now: NOW,
        journalOptions: { env: { AOF_GLOBAL_HOME: home } },
        directiveTargets: { get: () => ({ fake: true }) },
      };
      try {
        const unknownEvent = await applyStreamFrame(store, {
          kind: EFFECT_STEP_FRAME_KIND, nodeId: "worker-a", eventId: "e1", reactorKey: "settle-assignment", name: "not.an.event", payload: {},
        }, { ...options, nodeId: "worker-a" });
        assert.equal(unknownEvent.code, "effect-step-unknown-event", "a name outside the closed vocabulary is refused, never guessed at");

        const unknownReactor = await applyStreamFrame(store, {
          kind: EFFECT_STEP_FRAME_KIND, nodeId: "worker-a", eventId: "e2", reactorKey: "not-a-reactor", name: "assignment.reported", payload: {},
        }, { ...options, nodeId: "worker-a" });
        assert.equal(unknownReactor.code, "effect-step-unknown-reactor", "a reactor this build does not declare is refused (mixed-version fleet)");

        // The holder guard: worker-b ships a fact about worker-a's assignment.
        const notHolder = await applyStreamFrame(store, {
          kind: EFFECT_STEP_FRAME_KIND, nodeId: "worker-b", eventId: "e3", reactorKey: "settle-assignment", name: "assignment.reported",
          payload: { assignmentId: "asg-guarded", state: "done" },
        }, { ...options, nodeId: "worker-b" });
        assert.equal(notHolder.applied, false, "a non-holder cannot settle another node's assignment through the bridge");
        assert.equal(notHolder.code, "assignment-status-not-holder", "and the refusal is the transition's own code — one rule, both doors");
        assert.equal(readAssignment(store, "asg-guarded").state, "running", "the row is untouched");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "effects-outbox/d3 a control-node process runs the same step IN PLACE — the locus decides, not the code path",
    run: async () => withMeshAssignFixture(async ({ workspaceId, home }) => {
      await seedAssignment({ home }, {
        assignmentId: "asg-local",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "control-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-31T09:00:00.000Z",
        updatedAt: "2026-07-31T09:00:00.000Z",
      });
      const { eventId } = await raiseReport({ home }, { assignmentId: "asg-local", state: "failed" });
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        await withJournal({ home }, async (journal) => {
          const outcomes = await drainEffects({
            journal,
            eventId,
            loci: CONTROL_LOCI,
            now: NOW,
            ctx: { store, now: NOW, journalOptions: { env: { AOF_GLOBAL_HOME: home } } },
          });
          assert.equal(outcomes[0].status, "done", "with control-store reachable, the very same step just runs");
          assert.equal(readEventSteps(journal, eventId)[0].status, "done");
        });
        assert.equal(readAssignment(store, "asg-local").state, "failed");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "effects-outbox/d3 the frame kinds have ONE home — worker and control import the same literals",
    run: async () => {
      assert.equal(EFFECT_STEP_FRAME_KIND, "effect-step");
      assert.equal(EFFECT_ACK_FRAME_KIND, "effect-ack");
      // Both sides import them rather than re-spelling (the WORKTREE_CONTENT_FRAME_KIND
      // discipline); the arch gate proves the import, this proves the values.
      const { readFile } = await import("node:fs/promises");
      const url = await import("node:url");
      const path = await import("node:path");
      const src = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "src");
      for (const file of ["worker-stream-client.mjs", "control-stream-server.mjs"]) {
        const source = await readFile(path.join(src, file), "utf8");
        assert.ok(
          /from\s+["']\.\/effects\/outbox\.mjs["']/.test(source),
          `${file} imports the frame kinds from their one home`,
        );
      }
    },
  },
];

// task 02 — accepting a directive brackets execution in a node-partitioned run and
// streams accepted -> running -> done|failed, with the run-store staying mesh-blind
// (milestone 35 / story 02, ADR-004). Exercised over the worker execution handler in a
// TEMP fixture repo, the REGISTERED run-store (startRun/completeRun via readRuns), an
// injected runtime spawn scripted to a terminal outcome, an injected status recorder,
// and an injected clock.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadWorkspace, findWork } from "../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../src/mesh-worker-execution.mjs";
import { readRuns, runNodeRecordPath } from "../src/run-store.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedSpawnRuntime, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";

const NODE_ID = "node-a";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

function makeHandler(fx, ws, recorder, spawnOutcome, now) {
  return createMeshWorkerExecutionHandler({
    pushExec: scriptedPushExec(),
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    spawnRuntime: scriptedSpawnRuntime(spawnOutcome),
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
  });
}

export const meshRunLifecycleBracketingTests = [
  {
    name: "run-lifecycle-bracketing/02 accepting mints a node-partitioned run and emits accepted — the run record lands under runs/node-a/",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const handler = makeHandler(fx, ws, recorder, "done", NOW);
      await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-accept", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW });

      assert.ok(recorder.frames.some((f) => f.state === "accepted"), 'an "accepted" assignment-status frame is emitted for the assignment');

      const matches = await findWork(fx.workDir, fx.itemRef);
      const item = matches[0];
      const runs = await readRuns(item);
      assert.equal(runs.length, 1, "a run is minted through the run-store");
      assert.equal(runs[0].node, NODE_ID, "with this node's id as its node key");
      assert.ok(
        existsSync(runNodeRecordPath(item, NODE_ID, runs[0].runId)),
        'the run record lands under "runs/node-a/" (this node\'s partition)',
      );
    }),
  },
  {
    name: "run-lifecycle-bracketing/02 beginning execution sets the assignment runId and emits running carrying that runId",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const handler = makeHandler(fx, ws, recorder, "done", NOW);
      await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-running", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW });

      const runningFrame = recorder.frames.find((f) => f.state === "running");
      assert.ok(runningFrame, 'a "running" assignment-status frame is emitted');
      assert.ok(typeof runningFrame.runId === "string" && runningFrame.runId.length > 0, "carrying the minted run's runId");

      const matches = await findWork(fx.workDir, fx.itemRef);
      const runs = await readRuns(matches[0]);
      assert.equal(runningFrame.runId, runs[0].runId, "the assignment's runId is set to the minted run's id");
    }),
  },
  {
    name: "run-lifecycle-bracketing/02 a run reaching a terminal state emits the matching assignment status — Scenario Outline (done, failed)",
    run: async () => {
      for (const row of [{ outcome: "done", state: "done" }, { outcome: "failed", state: "failed" }]) {
        await withMeshWorkerExecFixture(async (fx) => {
          const NOW = "2026-07-09T09:00:00.000Z";
          const ws = await readyFixture(fx);
          const recorder = createStatusRecorder();
          const handler = makeHandler(fx, ws, recorder, row.outcome, NOW);
          await handler({ kind: "directive", to: NODE_ID, assignmentId: `asg-${row.outcome}`, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW });

          const matches = await findWork(fx.workDir, fx.itemRef);
          const runs = await readRuns(matches[0]);
          assert.equal(runs[0].state, row.outcome, `[${row.outcome}] the run is completed through the run-store with outcome "${row.outcome}"`);
          const terminalFrame = recorder.frames[recorder.frames.length - 1];
          assert.equal(terminalFrame.state, row.state, `[${row.outcome}] a "${row.state}" assignment-status frame is emitted for the assignment`);
        });
      }
    },
  },
  {
    // QA advisory A1 (review fix, 2026-07-09): assert the FULL ordered bracket for
    // BOTH terminal outcomes — previously only the "done" path asserted the ordered
    // sequence; "failed" only checked the last frame, leaving the accepted->running
    // ordering unproven on the failure path.
    name: "run-lifecycle-bracketing/02 one assignment emits accepted then running then its terminal frame in order — Scenario Outline (done, failed)",
    run: async () => {
      for (const row of [{ outcome: "done", state: "done" }, { outcome: "failed", state: "failed" }]) {
        await withMeshWorkerExecFixture(async (fx) => {
          const NOW = "2026-07-09T09:00:00.000Z";
          const ws = await readyFixture(fx);
          const recorder = createStatusRecorder();
          const handler = makeHandler(fx, ws, recorder, row.outcome, NOW);
          await handler({ kind: "directive", to: NODE_ID, assignmentId: `asg-order-${row.outcome}`, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW });

          assert.deepEqual(
            recorder.frames.map((f) => f.state),
            ["accepted", "running", row.state],
            `[${row.outcome}] the emitted assignment-status frames are, in order, "accepted" then "running" then "${row.state}"`,
          );
        });
      }
    },
  },
  {
    name: "run-lifecycle-bracketing/02 the run is minted by passing the node id as data to the mesh-blind run-store",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const handler = makeHandler(fx, ws, recorder, "done", NOW);
      await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-meshblind", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW });

      const matches = await findWork(fx.workDir, fx.itemRef);
      const runs = await readRuns(matches[0]);
      assert.equal(runs[0].node, NODE_ID, "the minted run carries this node's id, supplied as an option to startRun — never a run-store rewrite");

      // The store stays mesh-blind: it imports no mesh module (asserted structurally
      // by the fitness function; here we assert the OBSERVABLE data-as-option shape —
      // the run record carries node as plain DATA, not a re-derived mesh concept).
      const source = await readFile(new URL("../src/run-store.mjs", import.meta.url), "utf8");
      assert.ok(!/from\s+["'][^"']*mesh-[^"']*["']/.test(source), "run-store.mjs imports no mesh module");
    }),
  },
];

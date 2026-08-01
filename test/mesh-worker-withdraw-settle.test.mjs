// test/mesh-worker-withdraw-settle.test.mjs — the OWED lanes from m42's soak day
// (STATE.md §MISSING TESTS, 2026-07-27: "today's code shipped under fire — write
// these before/while merging"). Pins the withdraw/settle family:
//
//   1. createMeshWorkerWithdrawHandler — all three paths: the LIVE-PTY kill
//      (mark consumed by the bracket → record `cancelled`, NO terminal status
//      frame), the no-live-session DIRECT settle (the measured case), and
//      idempotence (absent / already-terminal record, a field-less frame — all
//      logged no-ops).
//   2. settleStrandedRunRecords — a stranded dir settles its running record
//      failed/runtime_offline; an absent record is a logged no-op; one entry's
//      fault never blocks the next.
//   3. The execution bracket's withdraw guards — post-settle proven
//      behaviourally (cancelled + no frame); the PRE-SPAWN consume is pinned
//      structurally (it guards a re-entry race a single-bracket harness cannot
//      produce: the mark exists only while a kill is registered).
//   4. Driver onPtyLive — kill routes to term.kill; the registries clear on
//      settle AND on the generic-catch path (late withdraw falls through to the
//      no-live-session lane both times).
//   5. reportAssignmentFailure → onLog (level warn, code preserved) and the
//      codes on previously code-less failed frames: workspace-load-failed,
//      assignment-ref-unresolved, assignment-execution-failed.
//
// Harness: the SAME fixtures the terminal-input path established — the real
// execution handler over withMeshWorkerExecFixture, the scripted PTY double with
// a captured exit lever, the status recorder for both report channels.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  createMeshWorkerExecutionHandler,
  createMeshWorkerWithdrawHandler,
  settleStrandedRunRecords,
} from "../src/mesh-worker-execution.mjs";
import { loadWorkspace, listItems } from "../src/work.mjs";
import { readRuns } from "../src/run-store.mjs";
import { transitionRunStart } from "../src/effects/run-transitions.mjs";
import { openEffectsJournal, readEvents } from "../src/effects/journal.mjs";
import { resolveWorkspaceId } from "../src/workspace-identity.mjs";
import {
  withMeshWorkerExecFixture,
  markRepoPublished,
  seedNodeWorkspaceMembership,
  createStatusRecorder,
  scriptedPushExec,
  scriptedSpawnRuntime,
} from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

const NODE_ID = "worker-a";
const NOW = "2026-07-27T12:00:00.000Z";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function waitFor(condition, { timeoutMs = 5000, stepMs = 10 } = {}) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

async function itemFor(fx) {
  const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
  const items = await listItems(ws.workDir);
  const item = items.find((row) => row.ref === fx.itemRef);
  assert.ok(item, `fixture item ${fx.itemRef} resolves`);
  return { ws, item };
}

async function completedEvents(env) {
  const journal = await openEffectsJournal({ env });
  try {
    return readEvents(journal, { name: "run.completed" });
  } finally {
    journal.close();
  }
}

export const meshWorkerWithdrawSettleTests = [
  {
    name: "withdraw-settle/1a+3+4 a live-PTY withdrawal: kill routes to term.kill, the bracket consumes the mark — record CANCELLED, no terminal status frame, registries cleared on settle",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const recorder = createStatusRecorder();
      const which = createFakeWhich(["claude"]);
      let exitLever = null;
      const { spawn, ptys } = createFakePtySpawn({ onWrite: ({ emitExit }) => { exitLever = exitLever ?? emitExit; } });

      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: recorder.sendAssignmentStatus,
        sendEffectStep: recorder.sendEffectStep,
        now: () => NOW,
        globalWorkStoreOptions: { env: fx.env },
        ptySpawn: spawn,
        which,
        commandDelayMs: 10,
        watchTranscriptSessionId: async () => null,
      });

      const withdrawLogs = [];
      const withdraw = createMeshWorkerWithdrawHandler({
        loadWs: () => Promise.resolve(ws),
        globalWorkStoreOptions: { env: fx.env },
        onLog: (entry) => withdrawLogs.push(entry),
        now: () => NOW,
      });

      const running = handler({
        kind: "directive", to: NODE_ID, assignmentId: "asg-live", itemRef: fx.itemRef,
        workspaceId: fx.workspaceId, at: NOW, command: "/aof:continue",
      });
      await waitFor(() => exitLever != null && ptys.length === 1);

      // The withdrawal lands mid-run: the LIVE branch marks + kills.
      await withdraw({ kind: "withdraw", assignmentId: "asg-live" });
      assert.equal(ptys[0].killed, true, "the withdraw kill routes to the live term.kill()");
      assert.ok(
        withdrawLogs.some((entry) => entry.code === "withdraw-notify" && /live session killed/.test(entry.message)),
        "the live-kill path logs its decision",
      );

      // The killed child exits; the bracket settles the record itself.
      exitLever(1);
      await running;

      const completed = await completedEvents(fx.env);
      assert.equal(completed.length, 1, "exactly one completion was journaled");
      assert.equal(completed[0].payload?.outcome, "cancelled", "a withdrawn run settles CANCELLED, never failed");
      assert.equal(completed[0].payload?.ref, fx.itemRef);

      const terminalFrames = recorder.frames.filter((frame) =>
        frame.assignmentId === "asg-live" && ["done", "failed", "cancelled"].includes(frame.state));
      assert.deepEqual(terminalFrames, [], "NO terminal status frame is sent — control's row is already terminal (the withdraw wrote it)");

      // Registries cleared on settle: a late withdraw finds no live kill and,
      // with no run fields on the frame, has nothing to settle.
      await withdraw({ kind: "withdraw", assignmentId: "asg-live" });
      assert.ok(
        withdrawLogs.some((entry) => /no run\/item on the frame/.test(entry.message)),
        "a post-settle withdraw falls through to the no-live-session lane (livePtyKills cleared)",
      );
      assert.equal(ptys[0].killed, true, "…and no second kill target exists");
    }),
  },

  {
    name: "withdraw-settle/1b the no-live-session DIRECT settle (the measured case): the frame's run settles cancelled through the seam",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const { ws, item } = await itemFor(fx);
      const { record } = await transitionRunStart(
        item,
        { now: NOW, node: NODE_ID, brief: { assignmentId: "asg-parked", itemRef: fx.itemRef } },
        { journalOptions: { env: fx.env } },
      );
      const logs = [];
      const withdraw = createMeshWorkerWithdrawHandler({
        loadWs: () => Promise.resolve(ws),
        globalWorkStoreOptions: { env: fx.env },
        onLog: (entry) => logs.push(entry),
        now: () => NOW,
      });

      await withdraw({
        kind: "withdraw", assignmentId: "asg-parked", runId: record.runId,
        itemRef: fx.itemRef, workspaceId: resolveWorkspaceId(ws),
      });

      const run = (await readRuns(item)).find((row) => row.runId === record.runId);
      assert.equal(run?.state, "cancelled", "the parked run's record settles cancelled — the duplicate-run guard is clear");
      assert.ok(
        logs.some((entry) => entry.code === "withdraw-notify" && /settled cancelled/.test(entry.message)),
        "the direct settle logs its decision",
      );
      const completed = await completedEvents(fx.env);
      assert.equal(completed[0]?.payload?.outcome, "cancelled", "the settle rode the transition seam (the event is journaled)");
    }),
  },

  {
    name: "withdraw-settle/1c idempotence: an already-terminal record, an absent record, and a field-less frame are each a logged no-op (never a throw)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const { ws, item } = await itemFor(fx);
      const { record } = await transitionRunStart(
        item,
        { now: NOW, node: NODE_ID, brief: { assignmentId: "asg-idem", itemRef: fx.itemRef } },
        { journalOptions: { env: fx.env } },
      );
      const logs = [];
      const withdraw = createMeshWorkerWithdrawHandler({
        loadWs: () => Promise.resolve(ws),
        globalWorkStoreOptions: { env: fx.env },
        onLog: (entry) => logs.push(entry),
        now: () => NOW,
      });
      const frame = {
        kind: "withdraw", assignmentId: "asg-idem", runId: record.runId,
        itemRef: fx.itemRef, workspaceId: resolveWorkspaceId(ws),
      };

      await withdraw(frame); // settles cancelled
      await withdraw(frame); // already terminal — a logged no-op
      assert.ok(
        logs.some((entry) => /already cancelled/.test(entry.message)),
        "an already-terminal record is a logged no-op",
      );
      const run = (await readRuns(item)).find((row) => row.runId === record.runId);
      assert.equal(run?.state, "cancelled", "…and the record is untouched");

      await withdraw({ ...frame, runId: "20990101T000000000Z-9999" });
      assert.ok(
        logs.some((entry) => /has no record on this worker/.test(entry.message)),
        "an absent record is a logged no-op",
      );

      await withdraw({ kind: "withdraw", assignmentId: "asg-idem" });
      assert.ok(
        logs.some((entry) => /no run\/item on the frame/.test(entry.message)),
        "a frame without run fields (no live session either) is a logged no-op",
      );
    }),
  },

  {
    name: "withdraw-settle/2 settleStrandedRunRecords: a stranded dir settles failed/runtime_offline; a faulting entry never blocks the next; an absent record is a logged no-op",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const { item } = await itemFor(fx);
      const { record } = await transitionRunStart(
        item,
        { now: NOW, node: NODE_ID, brief: { assignmentId: "asg-stranded", itemRef: fx.itemRef } },
        { journalOptions: { env: fx.env } },
      );
      const logs = [];
      const worktreeFor = (root, assignmentId) => path.join(root, ".aof", "mesh", "worktrees", assignmentId);

      await settleStrandedRunRecords(
        [
          // (a) a FAULTING entry first: a null worktreePath makes the checkout
          // derivation itself throw — reported per entry, never a thrown scan.
          { assignmentId: "asg-broken", worktreePath: null },
          // (b) the real stranded assignment — settles despite (a).
          { assignmentId: "asg-stranded", worktreePath: worktreeFor(fx.root, "asg-stranded") },
          // (c) a stranded dir with NO running record — a logged no-op.
          { assignmentId: "asg-ghostless", worktreePath: worktreeFor(fx.root, "asg-ghostless") },
        ],
        { globalWorkStoreOptions: { env: fx.env }, now: () => NOW, onLog: (entry) => logs.push(entry) },
      );

      const run = (await readRuns(item)).find((row) => row.runId === record.runId);
      assert.equal(run?.state, "failed", "the stranded record settles failed");
      assert.equal(run?.failureReason, "runtime_offline", "…with the retryable infra classification");
      assert.ok(
        logs.some((entry) => entry.code === "startup-reclaim" && entry.level === "warn" && /asg-broken/.test(entry.message)),
        "the faulting entry is reported",
      );
      assert.ok(
        logs.some((entry) => /asg-stranded.*settled failed\/runtime_offline/.test(entry.message)),
        "the real entry settled AFTER the faulting one — one fault never blocks the next",
      );
      assert.ok(
        logs.some((entry) => /asg-ghostless: no running run record/.test(entry.message)),
        "an absent record is a logged no-op",
      );
      const completed = await completedEvents(fx.env);
      assert.equal(completed[0]?.payload?.outcome, "failed", "the settle rode the transition seam");
      assert.equal(completed[0]?.payload?.failureReason, "runtime_offline");
    }),
  },

  {
    name: "withdraw-settle/3 the PRE-SPAWN withdraw consume is pinned structurally: the bracket checks the mark before spawnRuntime and again after (source order)",
    run: async () => {
      const source = await readFile(path.join(repoRoot, "src", "mesh-worker-execution.mjs"), "utf8");
      const preSpawn = source.indexOf("withdrawnByControl.delete(assignmentId)");
      const spawnCall = source.indexOf("await spawnRuntime(");
      const postSettle = source.indexOf("withdrawnByControl.delete(assignmentId)", spawnCall);
      assert.ok(preSpawn !== -1 && spawnCall !== -1, "the bracket and its guard exist");
      assert.ok(preSpawn < spawnCall, "a withdrawal that already arrived is consumed BEFORE the spawn — a withdrawn run is never spawned");
      assert.ok(postSettle > spawnCall, "…and the mid-run mark is consumed again after the spawn settles");
    },
  },

  {
    name: "withdraw-settle/5 reportAssignmentFailure → onLog (warn, code preserved) and the coded failed frames: workspace-load-failed / assignment-ref-unresolved / assignment-execution-failed (+ the generic-catch registry clear)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });

      // (a) workspace-load-failed: the primary checkout will not load.
      {
        const recorder = createStatusRecorder();
        const logs = [];
        const handler = createMeshWorkerExecutionHandler({
          pushExec: scriptedPushExec(),
          loadWs: () => Promise.reject(new Error("checkout gone")),
          nodeId: NODE_ID,
          sendAssignmentStatus: recorder.sendAssignmentStatus,
          sendEffectStep: recorder.sendEffectStep,
          now: () => NOW,
          globalWorkStoreOptions: { env: fx.env },
          onLog: (entry) => logs.push(entry),
          spawnRuntime: scriptedSpawnRuntime("done"),
        });
        await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-wsl", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW, command: "/aof:continue" });
        const log = logs.find((entry) => entry.code === "workspace-load-failed");
        assert.ok(log, "the failure reaches onLog with its code");
        assert.equal(log.level, "warn", "…at level warn");
        const frame = recorder.frames.find((row) => row.assignmentId === "asg-wsl" && row.state === "failed");
        assert.equal(frame?.code, "workspace-load-failed", "the failed frame carries the code (previously code-less)");
      }

      // (b) assignment-ref-unresolved: the item does not exist in the stream.
      {
        const recorder = createStatusRecorder();
        const logs = [];
        const handler = createMeshWorkerExecutionHandler({
          pushExec: scriptedPushExec(),
          loadWs: () => Promise.resolve(ws),
          nodeId: NODE_ID,
          sendAssignmentStatus: recorder.sendAssignmentStatus,
          sendEffectStep: recorder.sendEffectStep,
          now: () => NOW,
          globalWorkStoreOptions: { env: fx.env },
          onLog: (entry) => logs.push(entry),
          spawnRuntime: scriptedSpawnRuntime("done"),
        });
        await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-ref", itemRef: "99/99", workspaceId: fx.workspaceId, at: NOW, command: "/aof:continue" });
        const log = logs.find((entry) => entry.code === "assignment-ref-unresolved");
        assert.ok(log, "the unresolved ref reaches onLog with its code");
        assert.equal(log.level, "warn");
        const frame = recorder.frames.find((row) => row.assignmentId === "asg-ref" && row.state === "failed");
        assert.equal(frame?.code, "assignment-ref-unresolved", "the failed frame carries the code");
      }

      // (c) assignment-execution-failed via the GENERIC catch — which must also
      // clear the live-PTY registries (lane 4's catch half): the runtime
      // registers a kill, then faults.
      {
        const recorder = createStatusRecorder();
        const logs = [];
        const handler = createMeshWorkerExecutionHandler({
          pushExec: scriptedPushExec(),
          loadWs: () => Promise.resolve(ws),
          nodeId: NODE_ID,
          sendAssignmentStatus: recorder.sendAssignmentStatus,
          sendEffectStep: recorder.sendEffectStep,
          now: () => NOW,
          globalWorkStoreOptions: { env: fx.env },
          onLog: (entry) => logs.push(entry),
          spawnRuntime: async (invocation, opts) => {
            opts.onPtyLive?.(() => {}, () => {});
            throw new Error("driver blew up mid-run");
          },
        });
        await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-boom", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW, command: "/aof:continue" });
        const log = logs.find((entry) => entry.code === "assignment-execution-failed");
        assert.ok(log, "the generic fault reaches onLog with its code");
        assert.equal(log.level, "warn");
        const frame = recorder.frames.find((row) => row.assignmentId === "asg-boom" && row.state === "failed");
        assert.equal(frame?.code, "assignment-execution-failed", "the failed frame carries the code");

        const withdrawLogs = [];
        const withdraw = createMeshWorkerWithdrawHandler({
          loadWs: () => Promise.resolve(ws),
          globalWorkStoreOptions: { env: fx.env },
          onLog: (entry) => withdrawLogs.push(entry),
        });
        await withdraw({ kind: "withdraw", assignmentId: "asg-boom" });
        assert.ok(
          withdrawLogs.some((entry) => /no run\/item on the frame/.test(entry.message)),
          "the generic catch cleared the live-PTY registries — a late withdraw finds no kill to route",
        );
      }
    }),
  },
];

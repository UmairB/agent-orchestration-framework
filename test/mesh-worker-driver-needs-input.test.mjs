// test/mesh-worker-driver-needs-input.test.mjs — traceability for milestone 38 /
// story 05, task 02 (02_needs-input-outcome-and-worktree-retention.feature, ADR-013
// invariant 4). An explicit `NEEDS_INPUT` sentinel observed in the interactive
// session's OWN PTY output yields a THIRD outcome, `needs-input` — distinct from, and
// NEVER re-mapped to, `done`. A `needs-input` session RETAINS its worktree (the
// `failed`-style retention branch, mesh-worker-execution.mjs), never the `done`
// force-remove.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { driveInteractiveClaudeSession, createMeshWorkerExecutionHandler, NEEDS_INPUT_SENTINEL } from "../src/mesh-worker-execution.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { meshWorktreePath, listWorktrees, removeWorktree } from "../src/mesh-worktree.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

const NODE_ID = "worker-a";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

function driveViaRealDriver(fx, ws, assignmentId, recorder, onWrite, now = "2026-07-18T09:00:00.000Z") {
  const which = createFakeWhich(["claude"]);
  const { spawn } = createFakePtySpawn({ onWrite });
  const handler = createMeshWorkerExecutionHandler({
    pushExec: scriptedPushExec(),
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
    ptySpawn: spawn,
    which,
  });
  return handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: now, command: "/aof:refine 38/05 --autonomous" });
}

// terminalOutcomeOf(frames) — this story's outcome is surfaced either as a literal
// `state` (done/failed) or, for needs-input, as `state:"running"` + `code:"needs-input"`
// (mesh-worker-execution.mjs's own documented reasoning: "needs-input" is not in
// assignment-record.mjs's closed state enum). This helper reads whichever shape the
// LAST frame carries so a test can assert against the row's plain outcome name.
function terminalOutcomeOf(frames) {
  const last = frames[frames.length - 1];
  return last?.code === "needs-input" ? "needs-input" : last?.state;
}

export const meshWorkerDriverNeedsInputTests = [
  {
    name: "task02/38-05 a NEEDS_INPUT sentinel yields `needs-input`, never `done` (driveInteractiveClaudeSession over the REAL sentinel-detection path)",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn, ptys } = createFakePtySpawn({
        onWrite: ({ emitData }) => emitData(`some agent output\n${NEEDS_INPUT_SENTINEL}\n`),
      });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which },
      );
      assert.equal(result.outcome, "needs-input", "the outcome is needs-input — a THIRD state, distinct from both done and failed");
      assert.notEqual(result.outcome, "done", "never mapped to done (closing the §4.3 gap)");
      assert.notEqual(result.outcome, "failed");
      assert.equal(ptys[0].killed, true, "the genuine needs-input path DOES kill the live PTY (:841-844)");
    },
  },
  {
    // review fix (m38/05, confirmed defect #1) regression: this FAILED before the
    // anchored-line-match fix — the old `buffer.includes(NEEDS_INPUT_SENTINEL)` was
    // an unanchored substring match, so a clean run's output merely NARRATING the
    // word "NEEDS_INPUT" inside a longer line (or emitting a longer, unrelated
    // token like "NEEDS_INPUTS") false-fired and killed the healthy live PTY,
    // mis-reporting `needs-input` for what was actually a `done` run.
    name: "task02/38-05 REGRESSION: a clean run whose output merely narrates the word NEEDS_INPUT (or the longer token NEEDS_INPUTS) inside a longer line stays `done`, never `needs-input`, and the PTY is NOT killed",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn, ptys } = createFakePtySpawn({
        onWrite: ({ emitData, emitExit }) => {
          emitData("the agent explains: this step NEEDS_INPUT from a human before it can proceed\n");
          emitData("also emitting a longer, unrelated token: NEEDS_INPUTS\n");
          emitExit(0);
        },
      });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which },
      );
      assert.equal(result.outcome, "done", "a run that merely NARRATES NEEDS_INPUT inside a longer line (never a standalone, newline-terminated NEEDS_INPUT line) resolves via its clean exit code, not a false sentinel match");
      assert.notEqual(result.outcome, "needs-input", "never false-fires needs-input off a substring narration");
      assert.equal(ptys[0].killed, false, "the live PTY is NEVER killed for a healthy, narrating-only run — the false-fire this fix closes would have killed it before the clean exit was ever observed");
    },
  },
  {
    name: "task02/38-05 a `needs-input` session retains its worktree — never the done force-remove — and the retained checkout stays a live directory",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const assignmentId = "asg-needs-input";
      await driveViaRealDriver(fx, ws, assignmentId, recorder, ({ emitData }) => emitData(`a genuine judgment call\n${NEEDS_INPUT_SENTINEL}\n`));

      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      assert.equal(existsSync(worktreePath), true, "the worktree is RETAINED — the failed-style retention branch, never the done force-remove");

      const entries = await listWorktrees(fx.root);
      assert.ok(entries.some((e) => e.path.includes(assignmentId)), 'its ".git/worktrees/" admin entry is still registered (removeWorktree(..., {force:true}) was never called for it)');

      assert.equal(terminalOutcomeOf(recorder.frames), "needs-input", 'the assignment surfaces "needs-input" (never a silent done)');
      assert.equal(recorder.frames.some((f) => f.state === "done"), false, "never a clean done");

      await removeWorktree(fx.root, assignmentId, { force: true });
    }),
  },
  {
    name: "task02/38-05 Scenario Outline — each end-signal maps to its own terminal outcome AND worktree disposition (3 rows: NEEDS_INPUT sentinel, clean completion, non-zero/fault exit)",
    run: async () => {
      const rows = [
        { note: "the NEEDS_INPUT sentinel", script: ({ emitData }) => emitData(`...\n${NEEDS_INPUT_SENTINEL}\n`), outcome: "needs-input", worktree: "retained" },
        { note: "a clean completion", script: ({ emitExit }) => emitExit(0), outcome: "done", worktree: "force-removed" },
        { note: "a non-zero / fault exit", script: ({ emitExit }) => emitExit(1), outcome: "failed", worktree: "retained" },
      ];
      for (const row of rows) {
        await withMeshWorkerExecFixture(async (fx) => {
          const ws = await readyFixture(fx);
          const recorder = createStatusRecorder();
          const assignmentId = `asg-outline-${row.outcome}`;
          await driveViaRealDriver(fx, ws, assignmentId, recorder, row.script);

          assert.equal(terminalOutcomeOf(recorder.frames), row.outcome, `[${row.note}] the terminal outcome is "${row.outcome}"`);

          const worktreePath = meshWorktreePath(fx.root, assignmentId);
          if (row.worktree === "retained") {
            assert.equal(existsSync(worktreePath), true, `[${row.note}] the worktree is retained`);
            await removeWorktree(fx.root, assignmentId, { force: true });
          } else {
            assert.equal(existsSync(worktreePath), false, `[${row.note}] the worktree is force-removed`);
          }
        });
      }
    },
  },
];

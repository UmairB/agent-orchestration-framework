// test/mesh-terminal-input-path.test.mjs — m42 "interactive worker terminals"
// (SECURITY T14's read-only decision operator-overridden 2026-07-27; the
// constrained shape is pinned structurally by
// test/arch/acd-fleet-terminal-input-constrained.test.mjs — THIS suite covers the
// behavioural lanes):
//
//   1. the CONTROL router (createTerminalInputRouter): a valid terminal-input
//      relay envelope routes down the worker's stream connection via the SAME
//      dispatchDirective seam the withdraw notify uses; foreign kinds are
//      ignored; malformed frames drop loudly; a not-connected target drops with
//      ONE logged miss per tuple (never a per-keystroke log storm);
//   2. the WORKER stream client dispatches a terminal-input DOWN-frame to the
//      registered onTerminalInput handler (the onDirective/onWithdraw lane);
//   3. the WORKER delivery (over the REAL execution handler + driver + fake
//      PTY): input for the CAPTURED session id reaches term.write; a foreign
//      session id is dropped (logged once); after the run settles the registry
//      is cleared and input is dropped again;
//   4. the PENDING-QUESTION lane (defaultWatchTranscriptCompletion, the REAL
//      producer over a temp CLAUDE_CONFIG_DIR): a live AskUserQuestion fires
//      onPendingInput ONCE and does NOT settle within the short declared window
//      (the session stays alive for the operator to answer); an answered
//      question fires onPendingInputCleared and the watch keeps going to the
//      real completion; the SENTINEL needs-input (turn ended) still settles
//      after the short declared window;
//   5. the `code` column (schema v7): applyAssignmentStatusFrame persists the
//      status-refinement code VERBATIM PER FRAME — set by a needs-input frame,
//      CLEARED by the next code-less frame (deliberately unlike
//      runId/sessionId's absent-is-not-a-clear).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTerminalInputRouter } from "../src/mesh-terminal-input.mjs";
import { TERMINAL_INPUT_KIND, buildTerminalInputEnvelope, TERMINAL_FRAME_KIND, TERMINAL_RESUME_KIND, buildTerminalResumeEnvelope } from "../src/mesh-terminal-relay-bridge.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import {
  createMeshWorkerExecutionHandler,
  createMeshWorkerTerminalInputHandler,
  createMeshWorkerTerminalResumeHandler,
  defaultWatchTranscriptCompletion,
  NEEDS_INPUT_SENTINEL,
  DIRECTIVE_COMPLETE_SENTINEL,
} from "../src/mesh-worker-execution.mjs";
import { meshWorktreePath } from "../src/mesh-worktree.mjs";
import { meshTerminalResumeCommand } from "../src/commands/mesh-terminal-resume.mjs";
import { updateAssignmentState } from "../src/assignment-record.mjs";
import { findWork } from "../src/work.mjs";
import { readRuns } from "../src/run-store.mjs";
import { claudeProjectsDir } from "../src/work-observe.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment } from "../src/assignment-record.mjs";
import { applyAssignmentStatusFrame } from "../src/control-stream-server.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

const NOW = "2026-07-27T10:00:00.000Z";
const NODE_ID = "worker-a";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(predicate, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error("timed out waiting for condition")); return; }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export const meshTerminalInputPathTests = [
  // ── 1. the control router ────────────────────────────────────────────────
  {
    name: "terminal-input/router: a valid envelope routes DOWN the worker's stream connection as { kind, to, sessionId, bytes, at }",
    async run() {
      const dispatched = [];
      const router = createTerminalInputRouter({
        dispatchDirective: (directive) => { dispatched.push(directive); return { sent: true }; },
        now: () => NOW,
      });
      const ok = router.apply(buildTerminalInputEnvelope("worker-a", "sess-1", "yes\r"));
      assert.equal(ok, true);
      assert.deepEqual(dispatched, [{ kind: TERMINAL_INPUT_KIND, to: "worker-a", sessionId: "sess-1", bytes: "yes\r", at: NOW }]);
    },
  },
  {
    name: "terminal-input/router: kind-blind to everything else — a terminal-frame (the mirror's own kind, riding the SAME subscriber socket) is ignored untouched",
    async run() {
      const dispatched = [];
      const router = createTerminalInputRouter({ dispatchDirective: (d) => { dispatched.push(d); return { sent: true }; }, now: () => NOW });
      assert.equal(router.apply({ kind: TERMINAL_FRAME_KIND, nodeId: "worker-a", signal: { sessionId: "sess-1", bytes: "output" } }), false);
      assert.equal(router.apply({ kind: "presence", nodeId: "worker-a" }), false);
      assert.equal(router.apply(null), false);
      assert.equal(dispatched.length, 0, "no foreign kind ever reaches dispatchDirective");
    },
  },
  {
    name: "terminal-input/router: a malformed frame (missing nodeId/sessionId/bytes) drops with a coded warn, never a dispatch",
    async run() {
      const dispatched = [];
      const logs = [];
      const router = createTerminalInputRouter({
        dispatchDirective: (d) => { dispatched.push(d); return { sent: true }; },
        now: () => NOW,
        onLog: (entry) => logs.push(entry),
      });
      assert.equal(router.apply(buildTerminalInputEnvelope("worker-a", null, "x")), false, "no sessionId");
      assert.equal(router.apply(buildTerminalInputEnvelope(null, "sess-1", "x")), false, "no nodeId");
      assert.equal(router.apply(buildTerminalInputEnvelope("worker-a", "sess-1", "")), false, "empty bytes");
      assert.equal(dispatched.length, 0);
      assert.ok(logs.every((l) => l.code === "terminal-input-invalid" && l.level === "warn"), "each drop is a coded warn");
      assert.equal(logs.length, 3);
    },
  },
  {
    name: "terminal-input/router: a not-connected target drops with ONE logged miss per (nodeId, sessionId) — an offline worker never causes a per-keystroke log storm",
    async run() {
      const logs = [];
      const router = createTerminalInputRouter({
        dispatchDirective: () => ({ sent: false, code: "assignment-target-not-connected" }),
        now: () => NOW,
        onLog: (entry) => logs.push(entry),
      });
      assert.equal(router.apply(buildTerminalInputEnvelope("worker-a", "sess-1", "a")), false);
      assert.equal(router.apply(buildTerminalInputEnvelope("worker-a", "sess-1", "b")), false);
      assert.equal(router.apply(buildTerminalInputEnvelope("worker-a", "sess-1", "c")), false);
      const misses = logs.filter((l) => l.code === "terminal-input-target-not-connected");
      assert.equal(misses.length, 1, "the miss is reported once per tuple, then silent");
      assert.equal(router.apply(buildTerminalInputEnvelope("worker-a", "sess-2", "d")), false);
      assert.equal(logs.filter((l) => l.code === "terminal-input-target-not-connected").length, 2, "a DIFFERENT tuple gets its own one report");
    },
  },

  // ── 2. the worker stream client's dispatch lane ──────────────────────────
  {
    name: "terminal-input/client: a terminal-input DOWN-frame dispatches to the registered onTerminalInput handler (the onDirective/onWithdraw lane)",
    async run() {
      let deliver = null;
      const transport = {
        onMessage(fn) { deliver = fn; },
        connect: async () => {},
        send: async () => {},
      };
      const client = createWorkerStreamClient({ nodeId: NODE_ID, workspaceId: "ws-1", transport });
      const received = [];
      client.onTerminalInput((frame) => received.push(frame));
      assert.ok(deliver, "the client registered its receive listener");
      deliver(JSON.stringify({ kind: TERMINAL_INPUT_KIND, to: NODE_ID, sessionId: "sess-1", bytes: "yes\r", at: NOW }));
      assert.equal(received.length, 1);
      assert.equal(received[0].sessionId, "sess-1");
      assert.equal(received[0].bytes, "yes\r");
      // A directive still routes to ITS lane, not this one.
      deliver(JSON.stringify({ kind: "directive", to: NODE_ID, assignmentId: "a1", itemRef: "35/00", workspaceId: "ws-1", at: NOW }));
      assert.equal(received.length, 1, "a directive frame never reaches the terminal-input handler");
    },
  },

  // ── 3. worker delivery over the REAL execution handler + driver + fake PTY ──
  {
    name: "terminal-input/worker: input for the CAPTURED session reaches the live PTY's term.write; a foreign session drops (logged once); a settled run drops (registry cleared)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const recorder = createStatusRecorder();
      const sessionId = "sess-input-live";

      // The fake PTY: capture the exit lever from the driver's own command write,
      // but DO NOT exit — the session stays live while input is injected.
      let exitLever = null;
      const which = createFakeWhich(["claude"]);
      const { spawn, ptys } = createFakePtySpawn({ onWrite: ({ emitExit }) => { exitLever = exitLever ?? emitExit; } });

      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: recorder.sendAssignmentStatus,
        now: () => NOW,
        globalWorkStoreOptions: { env: fx.env },
        ptySpawn: spawn,
        which,
        commandDelayMs: 10,
        watchTranscriptSessionId: async () => sessionId,
      });

      const logs = [];
      const inputHandler = createMeshWorkerTerminalInputHandler({ onLog: (entry) => logs.push(entry) });

      const running = handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-input", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW, command: "/aof:continue 35/00" });

      // Wait until the PTY is live AND the session binding exists (the driver's
      // command write proves the spawn; the binding lands when the injected
      // session-id watch resolves).
      await waitFor(() => exitLever != null && ptys.length === 1);
      await waitFor(() => {
        inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId, bytes: "probe\r" });
        return ptys[0].writes.includes("probe\r");
      });

      // The real assertion: a routed answer reaches the live PTY verbatim.
      inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId, bytes: "option 2\r" });
      assert.ok(ptys[0].writes.includes("option 2\r"), "input for the captured session reaches term.write");

      // A FOREIGN session id is a drop — logged once, never a write, never a redirect.
      const writesBefore = ptys[0].writes.length;
      inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId: "sess-someone-else", bytes: "evil\r" });
      inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId: "sess-someone-else", bytes: "evil2\r" });
      assert.equal(ptys[0].writes.length, writesBefore, "a foreign session id never writes any PTY");
      assert.equal(logs.filter((l) => l.code === "terminal-input").length, 1, "the foreign-session drop is logged ONCE, not per keystroke");

      // Settle the run; the registry must clear — late input is a drop.
      exitLever(0);
      await running;
      const settledWrites = ptys[0].writes.length;
      inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId, bytes: "too late\r" });
      assert.equal(ptys[0].writes.length, settledWrites, "input never reaches a PTY whose bracket has settled (registry cleared)");
    }),
  },

  // ── 4. the pending-question lane (the REAL completion watch) ─────────────
  {
    name: "terminal-input/pending: a live AskUserQuestion fires onPendingInput ONCE and does NOT settle within the short declared window — the session stays answerable",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-pending-question-"));
      try {
        const cwd = path.join(tmp, "project");
        await mkdir(cwd, { recursive: true });
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "claude") };
        const projectsDir = claudeProjectsDir({ cwd, env });
        await mkdir(projectsDir, { recursive: true });
        const sessionId = "sess-pending-1";
        const file = path.join(projectsDir, `${sessionId}.jsonl`);
        await writeFile(file, `${JSON.stringify({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "AskUserQuestion", input: { questions: [] } }] } })}\n`, "utf8");

        let pendingFired = 0;
        let clearedFired = 0;
        let settled = null;
        const watch = defaultWatchTranscriptCompletion({
          cwd, env, sessionId,
          pollMs: 10,
          declaredIdleMs: 40,
          idleMs: 600,
          onPendingInput: () => { pendingFired += 1; },
          onPendingInputCleared: () => { clearedFired += 1; },
        }).then((result) => { settled = result; return result; });

        await waitFor(() => pendingFired >= 1);
        // Well past the short declared window: still NOT settled (the old behaviour
        // parked — killed — the session ~here; the operator now gets the long window).
        await sleep(150);
        assert.equal(settled, null, "a live question does NOT settle at the declared window — the session stays up for the operator's answer");
        assert.equal(pendingFired, 1, "the pending report fires ONCE per episode, not per poll tick");
        assert.equal(clearedFired, 0);

        // Unanswered through the LONG window → the park fallback settles, marked pending.
        const result = await watch;
        assert.equal(result.outcome, "needs-input");
        assert.equal(result.declared, true);
        assert.equal(result.pending, true, "the settled outcome still says it was a live question");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "terminal-input/pending: an ANSWERED question fires onPendingInputCleared and the watch keeps going to the real completion",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-pending-answered-"));
      try {
        const cwd = path.join(tmp, "project");
        await mkdir(cwd, { recursive: true });
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "claude") };
        const projectsDir = claudeProjectsDir({ cwd, env });
        await mkdir(projectsDir, { recursive: true });
        const sessionId = "sess-pending-2";
        const file = path.join(projectsDir, `${sessionId}.jsonl`);
        await writeFile(file, `${JSON.stringify({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "AskUserQuestion", input: {} }] } })}\n`, "utf8");

        let pendingFired = 0;
        let clearedFired = 0;
        const watch = defaultWatchTranscriptCompletion({
          cwd, env, sessionId,
          pollMs: 10,
          declaredIdleMs: 40,
          idleMs: 5000,
          onPendingInput: () => { pendingFired += 1; },
          onPendingInputCleared: () => { clearedFired += 1; },
        });

        await waitFor(() => pendingFired >= 1);
        // The operator answers (through the interactive terminal): the transcript
        // gains the user record, then the turn finishes with a declared completion.
        await appendFile(file, `${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "option 2" }] } })}\n`, "utf8");
        await waitFor(() => clearedFired >= 1);
        assert.equal(clearedFired, 1, "the answered question clears exactly once");
        await appendFile(file, `${JSON.stringify({ type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: `done.\n${DIRECTIVE_COMPLETE_SENTINEL}\n` }] } })}\n`, "utf8");
        const result = await watch;
        assert.equal(result.outcome, "done", "after the answer the watch settles the REAL completion");
        assert.equal(result.declared, true);
        assert.equal(pendingFired, 1);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "terminal-input/pending: the SENTINEL needs-input (turn ENDED on the protocol line) still settles after the short declared window — parking that turn is correct",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-pending-sentinel-"));
      try {
        const cwd = path.join(tmp, "project");
        await mkdir(cwd, { recursive: true });
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "claude") };
        const projectsDir = claudeProjectsDir({ cwd, env });
        await mkdir(projectsDir, { recursive: true });
        const sessionId = "sess-sentinel-1";
        const file = path.join(projectsDir, `${sessionId}.jsonl`);
        await writeFile(file, `${JSON.stringify({ type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: `I need a decision.\n${NEEDS_INPUT_SENTINEL}\n` }] } })}\n`, "utf8");

        let pendingFired = 0;
        const start = Date.now();
        const result = await defaultWatchTranscriptCompletion({
          cwd, env, sessionId,
          pollMs: 10,
          declaredIdleMs: 40,
          idleMs: 60_000,
          onPendingInput: () => { pendingFired += 1; },
        });
        assert.ok(Date.now() - start < 10_000, "the sentinel lane settles on the SHORT window (nowhere near idleMs)");
        assert.equal(result.outcome, "needs-input");
        assert.equal(result.declared, true);
        assert.notEqual(result.pending, true, "an ended turn is NOT a live question");
        assert.equal(pendingFired, 0, "the pending report is for LIVE questions only");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  // ── 5. the `code` column rides the status frame verbatim ─────────────────
  {
    name: "terminal-input/code: applyAssignmentStatusFrame persists the status-refinement code per frame — set by needs-input, CLEARED by the next code-less frame; sessionId keeps its absent-is-not-a-clear",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-code-column-"));
      try {
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          const record = assembleAssignmentRecord({ itemRef: "35/00", workspaceId: "ws-1", targetNodeId: NODE_ID, issuer: "control-a", now: NOW });
          insertAssignment(store, record);

          await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: NODE_ID, assignmentId: record.assignmentId, state: "running", runId: "run-1", sessionId: "sess-1", at: NOW }, { nodeId: NODE_ID, now: NOW });
          assert.equal(readAssignment(store, record.assignmentId).code, null, "a plain running frame carries no code");

          await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: NODE_ID, assignmentId: record.assignmentId, state: "running", runId: "run-1", code: "needs-input", at: NOW }, { nodeId: NODE_ID, now: NOW });
          const waiting = readAssignment(store, record.assignmentId);
          assert.equal(waiting.code, "needs-input", "the needs-input frame sets the code");
          assert.equal(waiting.sessionId, "sess-1", "a code-carrying frame WITHOUT a sessionId never erases the captured one");

          await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: NODE_ID, assignmentId: record.assignmentId, state: "running", runId: "run-1", at: NOW }, { nodeId: NODE_ID, now: NOW });
          const cleared = readAssignment(store, record.assignmentId);
          assert.equal(cleared.code, null, "the next code-less frame CLEARS the code — verbatim per frame, the answered question stops reading as waiting");
          assert.equal(cleared.sessionId, "sess-1");
        } finally {
          store.close?.();
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },

  // ── 6. the RESUME lane (m42 quick-fix: `aof mesh terminal-resume`) ───────
  {
    name: "terminal-resume/router: a valid resume envelope routes DOWN the holder's stream with its worktree-resolution context; a context-less one drops with a coded warn",
    async run() {
      const dispatched = [];
      const logs = [];
      const router = createTerminalInputRouter({
        dispatchDirective: (d) => { dispatched.push(d); return { sent: true }; },
        now: () => NOW,
        onLog: (entry) => logs.push(entry),
      });
      const ok = router.apply(buildTerminalResumeEnvelope("worker-a", { sessionId: "sess-1", assignmentId: "asg-1", workspaceId: "ws-1", itemRef: "18" }));
      assert.equal(ok, true);
      assert.deepEqual(dispatched, [{ kind: TERMINAL_RESUME_KIND, to: "worker-a", sessionId: "sess-1", assignmentId: "asg-1", workspaceId: "ws-1", itemRef: "18", at: NOW }]);
      assert.equal(router.apply(buildTerminalResumeEnvelope("worker-a", { sessionId: "sess-1" })), false, "no assignment/workspace context — dropped");
      assert.ok(logs.some((l) => l.code === "terminal-resume-invalid"), "the context-less drop is a coded warn");
      assert.equal(dispatched.length, 1);
    },
  },
  {
    name: "terminal-resume/client: a terminal-resume DOWN-frame dispatches to the registered onTerminalResume handler",
    async run() {
      let deliver = null;
      const transport = { onMessage(fn) { deliver = fn; }, connect: async () => {}, send: async () => {} };
      const client = createWorkerStreamClient({ nodeId: NODE_ID, workspaceId: "ws-1", transport });
      const received = [];
      client.onTerminalResume((frame) => received.push(frame));
      deliver(JSON.stringify({ kind: TERMINAL_RESUME_KIND, to: NODE_ID, sessionId: "sess-1", assignmentId: "asg-1", workspaceId: "ws-1", itemRef: "18", at: NOW }));
      assert.equal(received.length, 1);
      assert.equal(received[0].assignmentId, "asg-1");
    },
  },
  {
    name: "terminal-resume/worker: a resume is a REAL RUN — record minted, row revived (running/code resumed), the FORKED session id reported + input-bound, completion settling record AND row; missing worktree / already-live are logged no-ops",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const oldSessionId = "sess-resume-old";
      const forkedSessionId = "sess-resume-forked";
      const assignmentId = "asg-resume-1";
      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      await mkdir(worktreePath, { recursive: true });

      const { spawn, spawnCalls, ptys } = createFakePtySpawn({});
      const logs = [];
      const recorder = createStatusRecorder();
      let completionResolve = null;
      const resumeHandler = createMeshWorkerTerminalResumeHandler({
        loadWs: () => Promise.resolve(ws),
        globalWorkStoreOptions: { env: fx.env },
        nodeId: NODE_ID,
        now: () => NOW,
        onLog: (entry) => logs.push(entry),
        onOutputChunk: () => {},
        onSessionEnd: () => {},
        sendAssignmentStatus: recorder.sendAssignmentStatus,
        ptySpawn: spawn,
        which: createFakeWhich(["claude"]),
        commandDelayMs: 0,
        livenessIntervalMs: 0,
        watchTranscriptSessionId: async () => forkedSessionId,
        watchTranscriptCompletion: () => new Promise((resolve) => { completionResolve = resolve; }),
      });
      const inputHandler = createMeshWorkerTerminalInputHandler({ onLog: () => {} });

      // A missing worktree refuses before any spawn or run mint.
      await resumeHandler({ sessionId: "sess-gone", assignmentId: "asg-gone", workspaceId: fx.workspaceId, itemRef: fx.itemRef });
      assert.equal(spawnCalls.length, 0, "no worktree, no spawn");
      assert.ok(logs.some((l) => l.level === "warn" && /worktree is gone/.test(l.message)));

      // The real resume, driven through the REAL driver.
      const running = resumeHandler({ sessionId: oldSessionId, assignmentId, workspaceId: fx.workspaceId, itemRef: fx.itemRef });
      await waitFor(() => spawnCalls.length === 1);
      assert.ok(spawnCalls[0].args.includes("--resume") && spawnCalls[0].args.includes(oldSessionId), "the spawn carries --resume <oldSessionId>");
      assert.equal(spawnCalls[0].options.cwd, worktreePath, "the PTY runs IN the assignment's retained worktree");

      // The row revives FIRST (running + code resumed), then the FORKED session
      // id lands on it — the whole system converges on the live tuple.
      await waitFor(() => recorder.frames.some((f) => f.state === "running" && f.sessionId === forkedSessionId));
      assert.equal(recorder.frames[0].state, "running");
      assert.equal(recorder.frames[0].code, "resumed", "the revival frame carries the sanctioned resume code");
      const captured = recorder.frames.find((f) => f.sessionId === forkedSessionId);
      assert.equal(captured.code, "resumed");

      // Input binds under the FORKED id (the live tuple), not the old one.
      await waitFor(() => {
        inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId: forkedSessionId, bytes: "carry on\r" });
        return ptys[0].writes.includes("carry on\r");
      });
      const writesBefore = ptys[0].writes.length;
      inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId: oldSessionId, bytes: "stale tuple\r" });
      assert.equal(ptys[0].writes.length, writesBefore, "the OLD session id is not a live tuple after the fork");

      // A second resume while live is a no-op (never a second run/PTY).
      await resumeHandler({ sessionId: oldSessionId, assignmentId, workspaceId: fx.workspaceId, itemRef: fx.itemRef });
      assert.equal(spawnCalls.length, 1, "already-live resume never double-spawns");
      assert.ok(logs.some((l) => /already has a live session/.test(l.message)));

      // Completion settles the RUN RECORD and the ROW — like any run.
      completionResolve({ outcome: "done" });
      await running;
      const doneFrame = recorder.frames.at(-1);
      assert.equal(doneFrame.state, "done");
      assert.equal(doneFrame.sessionId, forkedSessionId);
      const item = await findWork(fx.workDir, fx.itemRef).then((m) => m.find((r) => r.ref === fx.itemRef));
      const runs = await readRuns(item);
      const resumedRun = runs.find((r) => r.brief?.resumedFrom === oldSessionId);
      assert.ok(resumedRun, "the resume minted a REAL run record carrying its provenance");
      assert.equal(resumedRun.state, "done", "the run record settled with the session");

      // …and the registries are swept.
      const writesAfter = ptys[0].writes.length;
      inputHandler({ kind: TERMINAL_INPUT_KIND, sessionId: forkedSessionId, bytes: "too late\r" });
      assert.equal(ptys[0].writes.length, writesAfter, "input never reaches a settled resume (registry swept)");
    }),
  },
  {
    name: "terminal-resume/apply-seam: `running` + code `resumed` from the HOLDER revives a FAILED row — and ONLY that (no code stays refused; withdrawn stays terminal)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-resume-revival-"));
      try {
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          const mkFailedRow = () => {
            const record = assembleAssignmentRecord({ itemRef: "18", workspaceId: "ws-1", targetNodeId: NODE_ID, issuer: "control-a", now: NOW });
            insertAssignment(store, record);
            updateAssignmentState(store, record.assignmentId, "failed", { now: NOW });
            return record.assignmentId;
          };

          const revivable = mkFailedRow();
          const revived = await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: NODE_ID, assignmentId: revivable, state: "running", runId: "run-r1", code: "resumed", at: NOW }, { nodeId: NODE_ID, now: NOW });
          assert.equal(revived.applied, true, "the sanctioned revival applies");
          assert.equal(readAssignment(store, revivable).state, "running");
          assert.equal(readAssignment(store, revivable).code, "resumed");

          const stale = mkFailedRow();
          const refused = await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: NODE_ID, assignmentId: stale, state: "running", runId: "run-r2", at: NOW }, { nodeId: NODE_ID, now: NOW });
          assert.equal(refused.skipped, true, "a code-less running frame on a failed row is still the stale-frame class — refused");
          assert.equal(refused.code, "assignment-status-already-terminal");

          const withdrawnId = mkFailedRow();
          updateAssignmentState(store, withdrawnId, "withdrawn", { now: NOW });
          const stillTerminal = await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: NODE_ID, assignmentId: withdrawnId, state: "running", runId: "run-r3", code: "resumed", at: NOW }, { nodeId: NODE_ID, now: NOW });
          assert.equal(stillTerminal.skipped, true, "a WITHDRAWN row does not revive — the operator's own decision stands");

          const notHolder = mkFailedRow();
          const wrongNode = await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: "worker-b", assignmentId: notHolder, state: "running", runId: "run-r4", code: "resumed", at: NOW }, { nodeId: "worker-b", now: NOW });
          assert.equal(wrongNode.skipped, true, "the revival is still holder-only (T6)");
          assert.equal(wrongNode.code, "assignment-status-not-holder");
        } finally {
          store.close?.();
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },
  {
    name: "terminal-resume/cli: resolves the session's assignment from the store, pushes the envelope to the holder (or --node override); unknown session and unconfigured relay refuse loudly",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-resume-cli-"));
      try {
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        let assignmentId;
        try {
          const record = assembleAssignmentRecord({ itemRef: "18", workspaceId: "ws-1", targetNodeId: "umairs-mac-mini", issuer: "control-a", now: NOW });
          insertAssignment(store, record);
          updateAssignmentState(store, record.assignmentId, "running", { now: NOW, runId: "run-17", sessionId: "sess-89d1" });
          assignmentId = record.assignmentId;
        } finally {
          store.close?.();
        }

        const pushed = [];
        const ctx = {
          workspace: { config: {} },
          globalWorkStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          createTerminalResumePush: () => ({ push: async (envelope) => { pushed.push(envelope); }, close() {} }),
        };
        const result = await meshTerminalResumeCommand.run({ session: "sess-89d1" }, ctx);
        assert.equal(result.ok, true);
        assert.equal(result.node, "umairs-mac-mini", "the holder comes from the assignment row");
        assert.equal(result.assignmentId, assignmentId);
        assert.equal(pushed[0].kind, TERMINAL_RESUME_KIND);
        assert.equal(pushed[0].nodeId, "umairs-mac-mini");
        assert.deepEqual(pushed[0].signal, { sessionId: "sess-89d1", assignmentId, workspaceId: "ws-1", itemRef: "18" });

        const overridden = await meshTerminalResumeCommand.run({ session: "sess-89d1", node: "other-node" }, ctx);
        assert.equal(overridden.node, "other-node", "--node overrides the row's holder");

        await assert.rejects(
          () => meshTerminalResumeCommand.run({ session: "sess-nobody" }, ctx),
          (error) => error.code === "session-unknown",
          "a session no assignment captured refuses loudly",
        );
        await assert.rejects(
          () => meshTerminalResumeCommand.run({ session: "sess-89d1" }, { ...ctx, createTerminalResumePush: () => null }),
          (error) => error.code === "relay-unconfigured",
          "no loopback relay here (not the control node) refuses loudly",
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },
];

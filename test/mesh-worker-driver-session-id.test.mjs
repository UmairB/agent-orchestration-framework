// test/mesh-worker-driver-session-id.test.mjs — traceability for milestone 38 /
// story 05, task 03 (03_session-id-captured-and-surfaced.feature, ADR-013
// invariant 3) — REWRITTEN under the ADR-013 AMENDMENT (F-38.05, 2026-07-19). The
// interactive session's `session_id` (DISCARDED before this story — mesh-worker-
// execution.mjs read only terminal_reason/stop_reason) is now resolved by the
// TRANSCRIPT-DIR WATCH (`defaultWatchTranscriptSessionId`, ADR-013 amendment) — the
// PRE-amendment `AOF_SESSION_ID:` PTY marker had NO producer (nothing ever printed
// it), so this suite no longer emits that retired marker: it injects
// `watchTranscriptSessionId` through the driver/handler's own seam instead (the
// feature is over INJECTED seams by design — the injected seam is now the transcript
// watch, not a PTY marker). The resolved id is still surfaced on the
// assignment/presence record via sendAssignmentStatus; a watch that resolves no
// session_id (or an empty one) degrades to absent, never a crash.
//
// REVIEW FAST-FOLLOW (2026-07-19, QA coverage gap closed) — the scenarios above all
// drive the driver/handler over an INJECTED `watchTranscriptSessionId` fake; NONE of
// them exercise `defaultWatchTranscriptSessionId`'s OWN real snapshot / first-new-
// basename / deadline / abort logic (the session-id lane injects a fake past it, the
// needs-input lane aborts it before it ever resolves). The "REAL PRODUCER" block below
// drives that function DIRECTLY against a real temp `CLAUDE_CONFIG_DIR` — fakeable
// with no real `claude`, so `@executable`, never `@manual`.
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { driveInteractiveClaudeSession, createMeshWorkerExecutionHandler, defaultWatchTranscriptSessionId, NEEDS_INPUT_SENTINEL } from "../src/mesh-worker-execution.mjs";
import { claudeProjectsDir } from "../src/work-observe.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { removeWorktree } from "../src/mesh-worktree.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NODE_ID = "worker-a";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

// driveViaRealDriver — the SAME shape the pre-amendment suite used, now ALSO
// threading `watchTranscriptSessionId` through the ONE handler entry point
// (createMeshWorkerExecutionHandler forwards it into spawnRuntime's own options,
// beside ptySpawn/which) — a test injects a fake transcript-dir watch, never a real
// filesystem watch and never a real node-pty/claude.
function driveViaRealDriver(fx, ws, assignmentId, recorder, onWrite, watchTranscriptSessionId, now = "2026-07-18T09:00:00.000Z") {
  const which = createFakeWhich(["claude"]);
  const { spawn } = createFakePtySpawn({ onWrite });
  const handler = createMeshWorkerExecutionHandler({
    pushExec: scriptedPushExec(),
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    sendEffectStep: recorder.sendEffectStep,
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
    ptySpawn: spawn,
    which,
    watchTranscriptSessionId,
  });
  return handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: now, command: "/aof:refine 38/05 --autonomous" });
}

export const meshWorkerDriverSessionIdTests = [
  {
    name: "task03/38-05 a resolved session_id is captured and surfaced for resume (over the REAL handler, via the injected transcript-dir-watch seam)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const assignmentId = "asg-session-id";
      await driveViaRealDriver(fx, ws, assignmentId, recorder, ({ emitExit }) => emitExit(0), async () => "sess-abc123");

      const doneFrame = recorder.frames.find((f) => f.state === "done");
      assert.ok(doneFrame, "a clean done status frame was sent");
      assert.equal(doneFrame.sessionId, "sess-abc123", '"sess-abc123" is captured (no longer discarded) and surfaced on the assignment/presence record so a human can `claude --resume sess-abc123` on the worker');
    }),
  },
  {
    name: "task03/38-05 a run whose transcript watch resolves no session_id degrades gracefully — absent (null), not a crash — and the run still completes to its terminal outcome",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const assignmentId = "asg-no-session-id";
      await driveViaRealDriver(fx, ws, assignmentId, recorder, ({ emitExit }) => emitExit(0), async () => null);

      const doneFrame = recorder.frames.find((f) => f.state === "done");
      assert.ok(doneFrame, "the run still completes to its terminal outcome — no crash of the worker's stream loop");
      assert.equal(doneFrame.sessionId, null, "the session_id is surfaced as ABSENT (null), not an error");
    }),
  },
  {
    name: "task03/38-05 Scenario Outline — session_id capture across watch-resolution shapes (3 rows: well-formed id, no session_id at all, an empty-string session_id)",
    run: async () => {
      const rows = [
        { note: 'a well-formed id "sess-abc123"', resolved: "sess-abc123", surfaced: "sess-abc123" },
        { note: "no session_id at all", resolved: null, surfaced: null },
        { note: 'an empty-string session_id ""', resolved: "", surfaced: null },
      ];
      for (const row of rows) {
        await withMeshWorkerExecFixture(async (fx) => {
          const ws = await readyFixture(fx);
          const recorder = createStatusRecorder();
          const assignmentId = `asg-outline-${row.surfaced ?? "absent"}`;
          await driveViaRealDriver(fx, ws, assignmentId, recorder, ({ emitExit }) => emitExit(0), async () => row.resolved);

          const doneFrame = recorder.frames.find((f) => f.state === "done");
          assert.ok(doneFrame, `[${row.note}] the run completes to its terminal outcome (no crash)`);
          assert.equal(doneFrame.sessionId, row.surfaced, `[${row.note}] the surfaced session_id is ${row.surfaced === null ? "absent" : row.surfaced}`);
        });
      }
    },
  },
  // ------------------------------------------------------------------------------
  // REAL PRODUCER coverage (QA gap closed, review fast-follow 2026-07-19): the ABOVE
  // scenarios all drive the driver/handler over an INJECTED `watchTranscriptSessionId`
  // fake — none of them exercise `defaultWatchTranscriptSessionId`'s OWN
  // snapshot/first-new-basename/deadline/abort logic. These three cases drive that
  // REAL function directly, against a REAL temp filesystem (a real `CLAUDE_CONFIG_DIR`
  // + `claudeProjectsDir`), fakeable with no real `claude` and no real subscription —
  // exactly the "test the producer, not a fixture" discipline this milestone is about,
  // so this stays `@executable`, never `@manual`.
  // ------------------------------------------------------------------------------
  {
    name: "task03/38-05 REAL PRODUCER: defaultWatchTranscriptSessionId resolves the FIRST NEW *.jsonl basename to appear AFTER the watch starts — never a pre-existing one (real temp fs, real claudeProjectsDir)",
    run: async () => {
      const configDir = await mkdtemp(path.join(tmpdir(), "aof-watch-test-"));
      try {
        const cwd = "/tmp/wt-real-fs-watch-test";
        const env = { CLAUDE_CONFIG_DIR: configDir };
        // Computed via the SAME seam the producer itself uses (claudeProjectsDir,
        // work-observe.mjs) — never a hand-rolled/hard-coded slug.
        const projectsDir = claudeProjectsDir({ cwd, env });
        await mkdir(projectsDir, { recursive: true });
        // A PRE-EXISTING transcript, written BEFORE the watch ever starts — the
        // snapshot must exclude it from "new".
        await writeFile(path.join(projectsDir, "old.jsonl"), "{}\n", "utf8");

        const watchPromise = defaultWatchTranscriptSessionId({ cwd, env });

        // Give the watch's FIRST poll tick time to establish its baseline snapshot
        // (capturing ONLY "old.jsonl") before a genuinely NEW transcript appears —
        // mirroring the real production timing ("the session hasn't written its own
        // transcript yet" at the moment the watch starts).
        await sleep(350);
        await writeFile(path.join(projectsDir, "sess-real-123.jsonl"), "{}\n", "utf8");

        const result = await watchPromise;
        assert.equal(result, "sess-real-123", "the FIRST NEW *.jsonl basename (minus extension) to appear after the watch started is resolved");
        assert.notEqual(result, "old", "the pre-existing transcript (present BEFORE the watch started) is NEVER resolved as the session_id");
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "task03/38-05 REAL PRODUCER: defaultWatchTranscriptSessionId degrades to null once its (injectable) maxWaitMs deadline passes with no new transcript ever appearing (real temp fs)",
    run: async () => {
      const configDir = await mkdtemp(path.join(tmpdir(), "aof-watch-test-"));
      try {
        const cwd = "/tmp/wt-real-fs-watch-deadline-test";
        const env = { CLAUDE_CONFIG_DIR: configDir };
        // The directory is never even created — the producer's OWN "dir may not
        // exist -> treat as an empty snapshot, never throw" degrade is exercised too.
        const result = await defaultWatchTranscriptSessionId({ cwd, env, maxWaitMs: 50 });
        assert.equal(result, null, "a watch whose maxWaitMs deadline passes with no new transcript ever appearing degrades to null, never a crash, never an unbounded loop");
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "task03/38-05 REAL PRODUCER: defaultWatchTranscriptSessionId resolves null PROMPTLY once its signal is aborted, never waiting out maxWaitMs (real temp fs)",
    run: async () => {
      const configDir = await mkdtemp(path.join(tmpdir(), "aof-watch-test-"));
      try {
        const cwd = "/tmp/wt-real-fs-watch-abort-test";
        const env = { CLAUDE_CONFIG_DIR: configDir };
        const controller = new AbortController();
        // A generous maxWaitMs — if the abort short-circuit did NOT work, this test
        // would need to wait out the whole deadline (or time out the suite); the
        // abort registration is synchronous (mesh-worker-execution.mjs), so aborting
        // immediately after kicking the watch off resolves it promptly regardless.
        const watchPromise = defaultWatchTranscriptSessionId({ cwd, env, signal: controller.signal, maxWaitMs: 60 * 1000 });
        controller.abort();
        const result = await watchPromise;
        assert.equal(result, null, "an aborted watch resolves null promptly, never waiting out its maxWaitMs deadline");
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  },
  {
    // regression, adapted to the ADR-013-amendment mechanism (F-38.05): the RETIRED
    // `extractSessionIdFromOutput`'s own split-chunk defect (confirmed defect #2) has
    // no analogue here — the watch resolves a whole string in ONE step, never
    // assembled byte-by-byte from PTY output — but the amendment's OWN never-throw
    // contract needs the SAME defensive proof: an injected watch that REJECTS must
    // still degrade to a null sessionId, never crash the run or propagate the
    // rejection out of driveInteractiveClaudeSession.
    name: "task03/38-05 REGRESSION-ADAPTED: a transcript-watch seam that REJECTS degrades to a null sessionId, never a crash (the driver's own guarded-await contract)",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => { throw new Error("watch fault (e.g. a permissions error mid-poll)"); } },
      );
      assert.equal(result.outcome, "done");
      assert.equal(result.sessionId, null, "a rejecting transcript-watch seam degrades to a null sessionId, never an unhandled rejection out of the driver");
    },
  },
  {
    name: "task03/38-05 a resolved session_id also survives a `needs-input` outcome — the DRIVER captures it BEFORE knowing the eventual terminal state",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const recorder = createStatusRecorder();
      const assignmentId = "asg-session-id-needs-input";
      await driveViaRealDriver(
        fx,
        ws,
        assignmentId,
        recorder,
        ({ emitData }) => emitData(`a genuine judgment call\n${NEEDS_INPUT_SENTINEL}\n`),
        async () => "sess-mid-flight",
      );

      const lastFrame = recorder.frames[recorder.frames.length - 1];
      assert.equal(lastFrame.code, "needs-input");
      assert.equal(lastFrame.sessionId, "sess-mid-flight", "the session_id resolved by the transcript watch is still surfaced on the needs-input status frame");
      await removeWorktree(fx.root, assignmentId, { force: true });
    }),
  },
];

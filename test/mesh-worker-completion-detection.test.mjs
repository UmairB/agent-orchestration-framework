// test/mesh-worker-completion-detection.test.mjs — VERIFICATION F-38.06h (live
// two-machine soak, 2026-07-25). An interactive `claude` session NEVER exits when a
// directive finishes — it returns to its idle prompt and stays alive — so the driver's
// only `done` signal (`term.onExit`) never fires, and a completed directive read
// `running` forever (measured live: a `/aof:refine 18` that finished at 14:00 was still
// `running` at 14:50, its session parked). The fix detects completion from the
// TRANSCRIPT claude Code writes with zero model cooperation (the last assistant record's
// `stop_reason: "end_turn"`), settling `done` — or `needs-input` when that finished turn
// carries the sentinel. These lanes drive the REAL driveInteractiveClaudeSession over a
// scripted PTY that (like the real one) NEVER exits, and the REAL
// defaultWatchTranscriptCompletion over a REAL transcript file.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  driveInteractiveClaudeSession,
  defaultWatchTranscriptCompletion,
} from "../src/mesh-worker-execution.mjs";
import { claudeProjectsDir } from "../src/work-observe.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

export const meshWorkerCompletionDetectionTests = [
  {
    name: "F-38.06h the driver settles `done` from the transcript-completion watch even though the interactive PTY NEVER exits — and kills the parked session",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      // onWrite is undefined -> the scripted PTY records the command but NEVER emits an
      // exit, exactly like a real interactive claude parked at its prompt.
      const { spawn, ptys } = createFakePtySpawn();
      let completionArgs = null;
      const result = await driveInteractiveClaudeSession(
        { itemRef: "18", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 18 --autonomous" },
        {
          ptySpawn: spawn,
          which,
          watchTranscriptSessionId: async () => "sess-x",
          watchTranscriptCompletion: async (args) => { completionArgs = args; return { outcome: "done" }; },
          commandDelayMs: 0,
        },
      );
      assert.equal(result.outcome, "done", "a finished directive settles `done` from the transcript, NOT from a PTY exit that never comes");
      assert.equal(result.sessionId, "sess-x", "the resolved session id is threaded onto the outcome");
      assert.equal(completionArgs?.sessionId, "sess-x", "the completion watch is handed the captured session id");
      assert.equal(ptys[0].killed, true, "the parked interactive session is killed once complete (a human resumes with a FRESH claude --resume, never a reattach)");
    },
  },
  {
    name: "F-38.06h a completion watch that resolves `needs-input` settles the run needs-input (the finished turn carried the sentinel), still killing the parked PTY",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn, ptys } = createFakePtySpawn();
      const result = await driveInteractiveClaudeSession(
        { itemRef: "18", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 18 --autonomous" },
        {
          ptySpawn: spawn,
          which,
          watchTranscriptSessionId: async () => "sess-y",
          watchTranscriptCompletion: async () => ({ outcome: "needs-input" }),
          commandDelayMs: 0,
        },
      );
      assert.equal(result.outcome, "needs-input");
      assert.equal(result.sessionId, "sess-y");
      assert.equal(ptys[0].killed, true);
    },
  },
  {
    name: "F-38.06h the PTY-exit path still wins when it fires first — a process that DOES exit settles via onExit, the completion watch is a no-op (never injected here)",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      // This PTY exits cleanly on the command write — onExit must settle `done` and the
      // (real, un-injected) completion watch must never override it. `watchTranscriptSessionId`
      // returns null so the real completion watch never even starts (no session id).
      const { spawn } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "18", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 18 --autonomous" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null, commandDelayMs: 0 },
      );
      assert.equal(result.outcome, "done", "a genuinely-exiting process still settles via onExit");
    },
  },
  {
    name: "F-38.06h defaultWatchTranscriptCompletion reads the REAL transcript: end_turn -> done; end_turn carrying NEEDS_INPUT -> needs-input; a tool_use turn keeps working (never settles)",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-completion-"));
      try {
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "cfg") };
        const cwd = path.join(tmp, "wt");
        const dir = claudeProjectsDir({ cwd, env });
        await mkdir(dir, { recursive: true });
        const asst = (stop, text) => ({ type: "assistant", message: { role: "assistant", stop_reason: stop, content: [{ type: "text", text }] } });
        const write = async (sid, records) => {
          await writeFile(path.join(dir, `${sid}.jsonl`), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
        };

        // end_turn (after some tool_use turns), trailing system record -> done
        await write("done-1", [asst("tool_use", "editing files"), asst("end_turn", "Refine is complete. Both suites green."), { type: "system" }]);
        assert.deepEqual(await defaultWatchTranscriptCompletion({ cwd, env, sessionId: "done-1", pollMs: 15 }), { outcome: "done" });

        // the finished turn carries the NEEDS_INPUT sentinel on its own line -> needs-input
        await write("ni-1", [asst("end_turn", "I hit a blocking decision.\nNEEDS_INPUT")]);
        assert.deepEqual(await defaultWatchTranscriptCompletion({ cwd, env, sessionId: "ni-1", pollMs: 15 }), { outcome: "needs-input" });

        // a transcript whose last turn is tool_use is STILL WORKING — it never settles.
        await write("work-1", [asst("tool_use", "still editing")]);
        const ac = new AbortController();
        const workingP = defaultWatchTranscriptCompletion({ cwd, env, sessionId: "work-1", pollMs: 15, signal: ac.signal });
        await new Promise((r) => setTimeout(r, 90));
        ac.abort();
        assert.equal(await workingP, null, "a session still running tools never settles a completion outcome; abort resolves it null");

        // an absent transcript never settles either (aborts to null).
        const ac2 = new AbortController();
        const missingP = defaultWatchTranscriptCompletion({ cwd, env, sessionId: "nope", pollMs: 15, signal: ac2.signal });
        await new Promise((r) => setTimeout(r, 50));
        ac2.abort();
        assert.equal(await missingP, null, "an absent transcript is 'nothing settled yet', never a throw");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];

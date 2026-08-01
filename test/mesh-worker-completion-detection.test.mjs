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

        // `idleMs: 0` in these lanes: the QUIET-WINDOW rule has its own lanes below (the
        // premature-done regression); here the outcome MAPPING is what is under test, so
        // the window is collapsed rather than waited out.
        const settle = (sessionId, extra = {}) => defaultWatchTranscriptCompletion({ cwd, env, sessionId, pollMs: 15, idleMs: 0, declaredIdleMs: 0, ...extra });

        // end_turn (after some tool_use turns), trailing system record -> done, UNDECLARED
        // (no sentinel — the model never explicitly said it finished).
        await write("done-1", [asst("tool_use", "editing files"), asst("end_turn", "Refine is complete. Both suites green."), { type: "system" }]);
        assert.deepEqual(await settle("done-1"), { outcome: "done", declared: false });

        // the finished turn carries the NEEDS_INPUT sentinel on its own line -> needs-input,
        // DECLARED (the model explicitly stopped for a human).
        await write("ni-1", [asst("end_turn", "I hit a blocking decision.\nNEEDS_INPUT")]);
        assert.deepEqual(await settle("ni-1"), { outcome: "needs-input", declared: true });

        // the finished turn carries the DIRECTIVE_COMPLETE sentinel -> done, DECLARED.
        await write("dc-1", [asst("end_turn", "All stories built and reviewed.\nAOF_DIRECTIVE_COMPLETE")]);
        assert.deepEqual(await settle("dc-1"), { outcome: "done", declared: true });

        // ── the INVISIBLE STOP (measured live 2026-07-27, /aof:autonomous 18) ──
        // The session asked its scope question through the interactive
        // AskUserQuestion widget instead of printing NEEDS_INPUT and ending its
        // turn — a pending question is a tool_use turn, so the pre-fix detector
        // read "still working" and the assignment showed `running` for 28+
        // minutes while the session sat waiting on a human.
        const askPending = {
          type: "assistant",
          message: {
            role: "assistant",
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "I need a decision on the scope split." },
              { type: "tool_use", id: "tu-1", name: "AskUserQuestion", input: { questions: [] } },
            ],
          },
        };
        await write("ask-1", [asst("tool_use", "working"), askPending]);
        // m42 interactive worker terminals: the pending flag marks this as a LIVE
        // question (answerable through the terminal) — the watch reports it
        // immediately but parks it only after the LONG window.
        assert.deepEqual(await settle("ask-1"), { outcome: "needs-input", declared: true, pending: true }, "an UNANSWERED AskUserQuestion is a session waiting on a human — needs-input, declared, and PENDING (live)");

        // The SAME question WITH its answer behind it is a live session again —
        // never settles (the next assistant turn is coming).
        const askAnswered = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-1", content: "Do the split" }] } };
        await write("ask-2", [asst("tool_use", "working"), askPending, askAnswered]);
        const ac3 = new AbortController();
        const answeredP = settle("ask-2", { signal: ac3.signal });
        await new Promise((r) => setTimeout(r, 60));
        ac3.abort();
        assert.equal(await answeredP, null, "an ANSWERED question is a working session — nothing settles");

        // An ordinary pending tool (Bash mid-run) is genuinely still working.
        const bashPending = {
          type: "assistant",
          message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu-2", name: "Bash", input: { command: "npm test" } }] },
        };
        await write("ask-3", [bashPending]);
        const ac4 = new AbortController();
        const bashP = settle("ask-3", { signal: ac4.signal });
        await new Promise((r) => setTimeout(r, 60));
        ac4.abort();
        assert.equal(await bashP, null, "a pending ORDINARY tool call never reads as needs-input");

        // a transcript whose last turn is tool_use is STILL WORKING — it never settles.
        await write("work-1", [asst("tool_use", "still editing")]);
        const ac = new AbortController();
        const workingP = settle("work-1", { signal: ac.signal });
        await new Promise((r) => setTimeout(r, 90));
        ac.abort();
        assert.equal(await workingP, null, "a session still running tools never settles a completion outcome; abort resolves it null");

        // an absent transcript never settles either (aborts to null).
        const ac2 = new AbortController();
        const missingP = settle("nope", { signal: ac2.signal });
        await new Promise((r) => setTimeout(r, 50));
        ac2.abort();
        assert.equal(await missingP, null, "an absent transcript is 'nothing settled yet', never a throw");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  // ── the PREMATURE-DONE regression (live soak 2026-07-25) ──────────────────
  //
  // `end_turn` means the MODEL stopped speaking, not that the WORK finished. The
  // pre-fix watch confirmed an outcome across two consecutive stable-mtime ticks —
  // ~3 SECONDS of silence — so a real run whose agent had just said "Waiting for 3
  // background agents to finish" was declared `done` while those agents were still
  // working: the PTY was killed and a PARTIAL diff was committed and pushed
  // (measured on `/aof:continue 18`, cut off at 14.7 min). A settled outcome must now
  // hold across a FULLY QUIET idle window before the session is called finished.
  {
    name: "premature-done: an `end_turn` that goes quiet but RESUMES (a background agent reporting back) is NEVER settled — only a fully-quiet idle window settles it",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-completion-idle-"));
      try {
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "cfg") };
        const cwd = path.join(tmp, "wt");
        const dir = claudeProjectsDir({ cwd, env });
        await mkdir(dir, { recursive: true });
        const asst = (stop, text) => ({ type: "assistant", message: { role: "assistant", stop_reason: stop, content: [{ type: "text", text }] } });
        const file = path.join(dir, "resume-1.jsonl");
        const write = async (records) => {
          await writeFile(file, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
        };

        // The EXACT live shape: the turn ended while waiting on background work.
        await write([asst("tool_use", "starting the build"), asst("end_turn", "Waiting for 3 background agents to finish.")]);

        // A controllable clock, so the idle window is exercised with no wall-clock wait.
        let clockMs = 1_000_000;
        const now = () => clockMs;
        const IDLE = 5 * 60 * 1000;
        const ac = new AbortController();
        const watch = defaultWatchTranscriptCompletion({ cwd, env, sessionId: "resume-1", pollMs: 5, idleMs: IDLE, now, signal: ac.signal });

        // Let several poll ticks run while only ~3s of quiet has passed — the pre-fix
        // build settled `done` right here, mid-run.
        clockMs += 3000;
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(
          await Promise.race([watch, Promise.resolve("STILL-WATCHING")]),
          "STILL-WATCHING",
          "3 seconds of transcript silence is NOT completion — the pre-fix ~3s confirmation is exactly what truncated a live run",
        );

        // The background agents report back: the transcript MOVES again, so the quiet
        // stretch restarts even though a long time has now elapsed overall.
        clockMs += IDLE;
        await write([asst("tool_use", "starting the build"), asst("end_turn", "Waiting for 3 background agents to finish."), asst("tool_use", "agents reported back — continuing")]);
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(
          await Promise.race([watch, Promise.resolve("STILL-WATCHING")]),
          "STILL-WATCHING",
          "a session that resumed is still working — movement restarts the window and the outcome is no longer settled",
        );

        // It genuinely finishes, then stays quiet for the WHOLE window -> done.
        await write([asst("tool_use", "build green"), asst("end_turn", "All three agents finished. Milestone complete.")]);
        await new Promise((r) => setTimeout(r, 30));
        clockMs += IDLE + 1;
        assert.deepEqual(await watch, { outcome: "done", declared: false }, "a fully-quiet idle window after a real end_turn settles done");
        ac.abort();
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  // ── the SESSION-TREE quiet clock (operator-verified truncation #2, 2026-07-26) ──
  //
  // The 5-minute parent-file window truncated `/aof:continue 18` AGAIN: the parent
  // ended its turn ("waiting for 3 background agents"), its OWN transcript went quiet,
  // and the real work streamed into `<sessionId>/subagents/*.jsonl` — files the watch
  // never looked at. The quiet clock now reads the whole session tree.
  {
    name: "session-tree: an end_turn parent over a STILL-WRITING subagent transcript is never quiet — only tree-wide silence settles",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-completion-tree-"));
      try {
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "cfg") };
        const cwd = path.join(tmp, "wt");
        const dir = claudeProjectsDir({ cwd, env });
        const subDir = path.join(dir, "tree-1", "subagents");
        await mkdir(subDir, { recursive: true });
        const asst = (stop, text) => ({ type: "assistant", message: { role: "assistant", stop_reason: stop, content: [{ type: "text", text }] } });
        await writeFile(
          path.join(dir, "tree-1.jsonl"),
          `${JSON.stringify(asst("end_turn", "Waiting for 3 background agents to finish."))}\n`,
          "utf8",
        );

        let clockMs = 2_000_000;
        const now = () => clockMs;
        const IDLE = 15 * 60 * 1000;
        const ac = new AbortController();
        const watch = defaultWatchTranscriptCompletion({ cwd, env, sessionId: "tree-1", pollMs: 5, idleMs: IDLE, declaredIdleMs: 10_000, now, signal: ac.signal });

        // The parent transcript NEVER changes again. A background developer keeps
        // writing its own transcript — under the pre-fix parent-only clock the parent
        // has been "quiet" for the whole window right here, and the run was killed.
        clockMs += IDLE + 1;
        await writeFile(path.join(subDir, "dev-a.jsonl"), `{"progress":1}\n`, "utf8");
        await new Promise((r) => setTimeout(r, 60));
        clockMs += IDLE + 1;
        await writeFile(path.join(subDir, "dev-a.jsonl"), `{"progress":1}\n{"progress":2}\n`, "utf8");
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(
          await Promise.race([watch, Promise.resolve("STILL-WATCHING")]),
          "STILL-WATCHING",
          "a subagent still writing its transcript IS session activity — the parked parent must never read as quiet",
        );

        // The whole tree goes quiet for the full window -> the undeclared end_turn settles.
        await new Promise((r) => setTimeout(r, 30));
        clockMs += IDLE + 1;
        assert.deepEqual(await watch, { outcome: "done", declared: false }, "tree-wide silence for the whole window settles the undeclared outcome");
        ac.abort();
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "declared completion: the DIRECTIVE_COMPLETE sentinel settles after the SHORT confirmation window, not the long fallback",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-completion-declared-"));
      try {
        const env = { CLAUDE_CONFIG_DIR: path.join(tmp, "cfg") };
        const cwd = path.join(tmp, "wt");
        const dir = claudeProjectsDir({ cwd, env });
        await mkdir(dir, { recursive: true });
        const asst = (stop, text) => ({ type: "assistant", message: { role: "assistant", stop_reason: stop, content: [{ type: "text", text }] } });
        await writeFile(
          path.join(dir, "decl-1.jsonl"),
          `${JSON.stringify(asst("end_turn", "Milestone 18 complete: 7/7 stories done.\nAOF_DIRECTIVE_COMPLETE"))}\n`,
          "utf8",
        );

        let clockMs = 3_000_000;
        const now = () => clockMs;
        const IDLE = 15 * 60 * 1000;
        const DECLARED = 10_000;
        const ac = new AbortController();
        const watch = defaultWatchTranscriptCompletion({ cwd, env, sessionId: "decl-1", pollMs: 5, idleMs: IDLE, declaredIdleMs: DECLARED, now, signal: ac.signal });

        // Let the first ticks anchor the quiet stretch, then advance just under the
        // short window — still confirming (a declared outcome is not instant-settled).
        await new Promise((r) => setTimeout(r, 40));
        clockMs += DECLARED - 1;
        await new Promise((r) => setTimeout(r, 40));
        assert.equal(
          await Promise.race([watch, Promise.resolve("STILL-WATCHING")]),
          "STILL-WATCHING",
          "under the short confirmation window a declared outcome has not settled yet",
        );
        // Past the short window (nowhere near the long one) — the declaration settles.
        clockMs += 2;
        assert.deepEqual(await watch, { outcome: "done", declared: true }, "a declared completion needs only the short confirmation window");
        ac.abort();
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];

// Regression: milestone 38 / story 05 fix (live two-machine soak 2026-07-25,
// VERIFICATION F27) — the worker types the directive command into claude's PTY only
// AFTER a readiness delay, never at t=0. A t=0 write raced claude's interactive-TUI
// startup: the keystrokes were lost and claude sat idle at an empty prompt, never
// starting a session (no transcript -> no sessionId -> nothing for the story-06 terminal
// view to bind to). The delay is injected (options.commandDelayMs); the driver defaults
// to 0 so the rest of the suite stays fast, and mesh-launcher wires the real value.
import assert from "node:assert/strict";
import { driveInteractiveClaudeSession } from "../src/mesh-worker-execution.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

export const meshWorkerCommandTimingTests = [
  {
    name: "F27 the directive command is typed only AFTER commandDelayMs, never at t=0",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const written = [];
      // record each write; emit a clean exit AFTER the (delayed) command lands so the
      // session settles deterministically.
      const { spawn } = createFakePtySpawn({ onWrite: ({ chunk, emitExit }) => { written.push(chunk); emitExit(0); } });
      const p = driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null, commandDelayMs: 60 },
      );
      // 15ms in — well under the 60ms delay — nothing has been typed yet.
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(written.length, 0, "the command is NOT typed before commandDelayMs elapses");
      const result = await p; // resolves after the delayed write -> emitExit(0) -> done
      assert.deepEqual(written, ["/aof:refine 38/05 --autonomous\n"], "exactly the one newline-terminated command is typed, after the delay");
      assert.equal(result.outcome, "done");
    },
  },
  {
    name: "F27 with commandDelayMs 0 (the test/default) the command is still typed (immediate next tick)",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:continue" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null, commandDelayMs: 0 },
      );
      assert.equal(spawnCalls.length, 1);
      assert.equal(result.outcome, "done", "the default-0 delay still drives the command to a clean done");
    },
  },
];

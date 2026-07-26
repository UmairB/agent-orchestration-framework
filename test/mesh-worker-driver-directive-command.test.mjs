// test/mesh-worker-driver-directive-command.test.mjs — traceability for milestone 38
// / story 05, task 01 (01_directive-command-typed-into-pty.feature, ADR-013
// invariant 2). The assignment directive's WHOLE command string is written into the
// interactive session's PTY stdin as ONE whole newline-terminated `pty.write` — never
// baked into the spawn argv as a `-p` prompt — and interactive `claude` is spawned
// ONCE for the assignment's whole run (never re-spawned to deliver the command).
import assert from "node:assert/strict";
import { driveInteractiveClaudeSession, createMeshWorkerExecutionHandler } from "../src/mesh-worker-execution.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

const NODE_ID = "worker-a";

export const meshWorkerDriverDirectiveCommandTests = [
  {
    name: "task01/38-05 Scenario Outline — the directive's command string is typed into the PTY stdin as a whole line, never baked into the spawn argv (3 rows)",
    run: async () => {
      const commands = ["/aof:refine 38/05 --autonomous", "/aof:continue", "/aof:verify 38/05"];
      for (const command of commands) {
        const which = createFakeWhich(["claude"]);
        const { spawn, spawnCalls, ptys } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
        await driveInteractiveClaudeSession(
          { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command },
          { ptySpawn: spawn, which },
        );
        assert.equal(spawnCalls.length, 1, `[${command}] interactive claude is spawned ONCE for the assignment (not re-spawned to deliver the command)`);
        assert.deepEqual(ptys[0].writes, [`${command}\r`], `[${command}] the command is written into that session's PTY stdin as a SINGLE whole carriage-return-terminated pty.write (Enter = \\r, not \\n)`);
        assert.ok(!spawnCalls[0].args.join(" ").includes(command), `[${command}] the command is NOT baked into the spawn argv as a -p prompt`);
      }
    },
  },
  {
    name: "task01/38-05 EXACTLY ONE interactive claude PTY is spawned for the assignment's whole run, and the session is per-assignment (its own worktree), not a single shared session reused across assignments",
    run: async () => {
      const which = createFakeWhich(["claude"]);

      // Assignment A — its own spawn tracker, its own worktreeCwd.
      const a = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const resultA = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt-a", task: "demo-a", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: a.spawn, which },
      );
      assert.equal(a.spawnCalls.length, 1, "assignment A spawns exactly one interactive session for its whole run");
      assert.equal(a.spawnCalls[0].options.cwd, "/tmp/wt-a", "assignment A's session cwd is ITS OWN worktree");

      // Assignment B — a SEPARATE call (a separate assignment), its own tracker/cwd.
      const b = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const resultB = await driveInteractiveClaudeSession(
        { itemRef: "38/06", worktreeCwd: "/tmp/wt-b", task: "demo-b", command: "/aof:continue" },
        { ptySpawn: b.spawn, which },
      );
      assert.equal(b.spawnCalls.length, 1, "assignment B spawns its OWN exactly-one interactive session");
      assert.equal(b.spawnCalls[0].options.cwd, "/tmp/wt-b", "assignment B's session cwd is ITS OWN worktree, distinct from A's");
      assert.notEqual(a.ptys[0], b.ptys[0], "the two assignments never share a single PTY session instance");
      assert.equal(resultA.outcome, "done");
      assert.equal(resultB.outcome, "done");
    },
  },
  {
    name: "task01/38-05 the FULL handler types the REAL directive's command field into the PTY stdin (producer-fed: directive.command, not a test-only convenience field)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const recorder = createStatusRecorder();
      const which = createFakeWhich(["claude"]);
      const { spawn, ptys } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: recorder.sendAssignmentStatus,
        now: () => "2026-07-18T09:00:00.000Z",
        globalWorkStoreOptions: { env: fx.env },
        ptySpawn: spawn,
        which,
      });
      await handler({
        kind: "directive",
        to: NODE_ID,
        assignmentId: "asg-directive-command",
        itemRef: fx.itemRef,
        workspaceId: fx.workspaceId,
        at: "2026-07-18T09:00:00.000Z",
        command: "/aof:verify 38/05",
      });
      assert.deepEqual(ptys[0].writes, ["/aof:verify 38/05\r"], "the REAL directive object's own .command field is what lands in the PTY stdin write (Enter = \\r, not \\n)");
    }),
  },
];

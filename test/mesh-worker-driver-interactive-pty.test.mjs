// test/mesh-worker-driver-interactive-pty.test.mjs — traceability for milestone 38 /
// story 05, task 00 (00_pty-driver-replaces-headless-print.feature, ADR-013
// invariant 1). The worker driver resolves interactive `claude` through the EXISTING
// `terminal-providers` seam (`resolveProvider("claude").buildArgs()` — the
// empty-args interactive form, PLUS the ADR-013-amendment worker-scoped
// `--append-system-prompt NEEDS_INPUT_INSTRUCTION`, F-38.05) and spawns it in a
// node-pty PTY — never `claude -p <prompt> --output-format json`. Exercised over the
// REAL driveInteractiveClaudeSession/resolveInteractiveDriverLaunch/resolveProvider
// chain (mesh-worker-execution.mjs -> terminal-providers.mjs), with ONLY the leaf
// node-pty spawn (createFakePtySpawn), PATH lookup (createFakeWhich), and (per test)
// the session_id transcript watch injected — never a hand-built stub of "what the
// provider ought to emit" (the milestone's producer-fed lesson).
import assert from "node:assert/strict";
import { driveInteractiveClaudeSession, createMeshWorkerExecutionHandler, NEEDS_INPUT_SENTINEL } from "../src/mesh-worker-execution.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

const NODE_ID = "worker-a";

export const meshWorkerDriverInteractivePtyTests = [
  {
    name: "task00/38-05 the worker resolves the interactive `claude` launch, never `claude -p` (driveInteractiveClaudeSession over the REAL terminal-providers seam)",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null },
      );
      assert.equal(spawnCalls.length, 1, "the interactive claude session is spawned exactly once");
      assert.equal(spawnCalls[0].bin, "/fake/bin/claude", 'the spawned binary is the claude path resolved via resolveProvider("claude") (the interactive launch)');
      // the provider's OWN interactive-launch args (buildArgs()) are empty. Milestone 38
      // / story 05 fix (VERIFICATION F24): the launch now carries the worker-scoped
      // `--permission-mode auto` (NEVER bypassPermissions — a genuine pause still
      // surfaces as NEEDS_INPUT) followed by the ADR-013-amendment `--append-system-prompt`
      // (the NEEDS_INPUT producer, F-38.05) — never a one-shot prompt argv.
      assert.deepEqual(spawnCalls[0].args.slice(0, 2), ["--permission-mode", "auto"], "the launch runs in --permission-mode auto (NOT bypassPermissions)");
      assert.equal(spawnCalls[0].args.length, 4, "the spawned argv is buildArgs() (empty) + the --permission-mode auto pair + exactly one --append-system-prompt pair");
      assert.equal(spawnCalls[0].args[2], "--append-system-prompt", "the --append-system-prompt token follows the permission-mode pair");
      assert.equal(typeof spawnCalls[0].args[3], "string", "the appended system-prompt instruction is a string arg");
      assert.ok(spawnCalls[0].args[3].includes(NEEDS_INPUT_SENTINEL), "the appended system-prompt instruction embeds the NEEDS_INPUT sentinel");
      assert.equal(result.outcome, "done", "a clean exit resolves done");
    },
  },
  {
    name: "task00/38-05 no `buildDriverCommand`-shaped `claude -p <prompt> --output-format json` is emitted for the claude driver — through the FULL handler, over an injected ptySpawn/which (the default spawnRuntime, never overridden)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const recorder = createStatusRecorder();
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: recorder.sendAssignmentStatus,
        now: () => "2026-07-18T09:00:00.000Z",
        globalWorkStoreOptions: { env: fx.env },
        // NOTE: spawnRuntime is deliberately NOT overridden here — this drives the
        // REAL production default (defaultSpawnRuntime -> driveInteractiveClaudeSession)
        // wired through the handler's own ptySpawn/which options (mesh-launcher.mjs's
        // production shape, minus the real transport).
        ptySpawn: spawn,
        which,
      });
      await handler({ kind: "directive", to: NODE_ID, assignmentId: "asg-1", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: "2026-07-18T09:00:00.000Z", command: "/aof:refine 38/05 --autonomous" });

      assert.equal(spawnCalls.length, 1, "the worker's default spawnRuntime drives the REAL interactive-pty path exactly once");
      // EXACT array-element checks, never a JSON.stringify substring scan: the
      // ADR-013-amendment "--append-system-prompt" token itself contains the two
      // characters "-p" as a substring (...syste[m-p]rompt), so a naive substring
      // check over the whole stringified argv would false-positive on the very
      // token this amendment intentionally allows.
      assert.ok(!spawnCalls[0].args.includes("-p"), "no bare -p token in the spawned argv");
      assert.ok(!spawnCalls[0].args.includes("--print"), "no --print token in the spawned argv");
      assert.ok(!spawnCalls[0].args.includes("--output-format"), "no --output-format token in the spawned argv");
      assert.ok(spawnCalls[0].args.includes("--append-system-prompt"), "the interactive launch DOES carry the worker-scoped --append-system-prompt (the NEEDS_INPUT producer)");
      assert.ok(spawnCalls[0].bin.endsWith("claude"), "the spawned binary resolves to the claude provider");
      const doneFrame = recorder.frames.find((f) => f.state === "done");
      assert.ok(doneFrame, "the assignment completes done end-to-end through the real driver chain");
    }),
  },
  {
    name: "task00/38-05 Scenario Outline — no headless-print token survives in the spawned worker-driver argv (3 rows: -p, --print, --output-format)",
    run: async () => {
      const forbiddenTokens = ["-p", "--print", "--output-format"];
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:continue" },
        { ptySpawn: spawn, which },
      );
      assert.equal(spawnCalls.length, 1);
      for (const token of forbiddenTokens) {
        assert.ok(!spawnCalls[0].args.includes(token), `[${token}] the spawned argv contains no "${token}"`);
      }
    },
  },
  {
    name: "task00/38-05 an unresolvable claude binary is a coded failed outcome, never a spawn attempt (the honest-degrade gate terminal-ws.mjs's own provider gate keeps)",
    run: async () => {
      const which = createFakeWhich([]); // nothing resolves
      const { spawn, spawnCalls } = createFakePtySpawn();
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:refine 38/05 --autonomous" },
        { ptySpawn: spawn, which },
      );
      assert.equal(result.outcome, "failed");
      assert.equal(spawnCalls.length, 0, "no spawn attempt is made for an unresolvable binary");
    },
  },
];

// m42 wave (b) / TECH_DEBT item 7 — the PTY LIVENESS PROBE. Measured live (run
// 39ec5149, 2026-07-26): the agent process vanished ~11 minutes into a run with no
// onExit ever delivered, so the run — and its assignment — sat `running` for 25+
// minutes while the fleet mirrored a dead process's silence. The probe signal-0s the
// child pid on an interval and settles the run `failed/agent_died` when the OS says
// the process is gone. Pins:
//   - a dead pid settles failed/agent_died (no onExit needed)
//   - a live pid never trips the probe (the run settles via its normal outcome)
//   - a fake PTY without a pid keeps byte-identical behaviour (no probe at all)
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { driveInteractiveClaudeSession, listStrandedWorktreeAssignments } from "../src/mesh-worker-execution.mjs";
import { createFakeWhich } from "./support/mesh-worker-terminal-fixture.mjs";

// A minimal PTY fake matching the driver's contract (onData/onExit subscriptions
// with dispose, write, kill), with an injectable pid.
function fakeTerm({ pid } = {}) {
  const exitHandlers = [];
  return {
    ...(pid != null ? { pid } : {}),
    onData: () => ({ dispose() {} }),
    onExit: (handler) => {
      exitHandlers.push(handler);
      return { dispose() {} };
    },
    write() {},
    kill() {},
    emitExit: (exitCode) => exitHandlers.forEach((h) => h({ exitCode })),
  };
}

const BRIEF = { itemRef: "42/07", worktreeCwd: "/tmp/wt", task: "demo", command: "/aof:continue 42/07" };

export const meshWorkerLivenessTests = [
  {
    name: "liveness/item-7 a DEAD child pid settles the run failed/agent_died — no onExit required (the observed failure)",
    async run() {
      // A pid that cannot exist keeps the probe deterministic: signal-0 throws
      // ESRCH/EINVAL on every platform, which IS the dead-process answer.
      const term = fakeTerm({ pid: 2 ** 30 + 12345 });
      const result = await driveInteractiveClaudeSession(BRIEF, {
        ptySpawn: async () => term,
        which: createFakeWhich(["claude"]),
        watchTranscriptSessionId: async () => null,
        commandDelayMs: 0,
        livenessIntervalMs: 20,
      });
      assert.equal(result.outcome, "failed");
      assert.equal(result.failureReason, "agent_died", "the probe names the class: the process died without reporting");
    },
  },
  {
    name: "liveness/item-7 a LIVE pid never trips the probe — the run settles via its normal outcome",
    async run() {
      const term = fakeTerm({ pid: process.pid }); // this test process: definitely alive
      const driven = driveInteractiveClaudeSession(BRIEF, {
        ptySpawn: async () => term,
        which: createFakeWhich(["claude"]),
        watchTranscriptSessionId: async () => null,
        commandDelayMs: 0,
        livenessIntervalMs: 10,
      });
      // Give the probe several intervals to (wrongly) fire, then settle normally.
      await new Promise((r) => setTimeout(r, 60));
      term.emitExit(0);
      const result = await driven;
      assert.equal(result.outcome, "done", "a live process is never reclaimed by the probe");
    },
  },
  {
    name: "liveness/item-7 a PTY without a pid gets NO probe — injected fakes keep byte-identical behaviour",
    async run() {
      const term = fakeTerm({});
      const driven = driveInteractiveClaudeSession(BRIEF, {
        ptySpawn: async () => term,
        which: createFakeWhich(["claude"]),
        watchTranscriptSessionId: async () => null,
        commandDelayMs: 0,
        livenessIntervalMs: 10,
      });
      await new Promise((r) => setTimeout(r, 40));
      term.emitExit(0);
      assert.equal((await driven).outcome, "done", "no pid -> no probe -> the normal outcome path");
    },
  },
  {
    // Leg 2 — the STARTUP view: worktree DIRECTORIES persist across a daemon
    // restart (the in-memory registry does not), named by assignment id under
    // <checkoutsRoot>/<workspaceId>/.aof/mesh/worktrees/. Each is a run that
    // cannot be alive at startup.
    name: "liveness/item-7 listStrandedWorktreeAssignments scans persisted worktree dirs by assignment id — and an absent checkouts root scans to []",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-stranded-"));
      try {
        const env = { AOF_GLOBAL_HOME: home };
        assert.deepEqual(await listStrandedWorktreeAssignments({ globalWorkStoreOptions: { env } }), [], "a fresh worker (no checkouts) has nothing stranded");

        await mkdir(path.join(home, "mesh", "checkouts", "ws-1", ".aof", "mesh", "worktrees", "asg-dead-1"), { recursive: true });
        await mkdir(path.join(home, "mesh", "checkouts", "ws-1", ".aof", "mesh", "worktrees", "asg-dead-2"), { recursive: true });
        await mkdir(path.join(home, "mesh", "checkouts", "ws-2", ".aof", "mesh"), { recursive: true }); // checkout with NO worktrees dir

        const stranded = await listStrandedWorktreeAssignments({ globalWorkStoreOptions: { env } });
        assert.deepEqual(
          stranded.map((s) => `${s.workspaceId}/${s.assignmentId}`).sort(),
          ["ws-1/asg-dead-1", "ws-1/asg-dead-2"],
          "every persisted worktree dir is reported, keyed by its assignment id; a checkout without worktrees is skipped",
        );
        assert.ok(stranded.every((s) => s.worktreePath.includes("worktrees")), "each entry carries its worktree path for the reclaim warning");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },
];

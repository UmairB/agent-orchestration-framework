// Regression: milestone 38 / story 05 fix (live two-machine soak 2026-07-25,
// VERIFICATION F24) — the worker PRE-TRUSTS each per-assignment worktree so claude's
// one-time "trust this folder?" dialog (which fires BEFORE the system prompt is read)
// never HANGS a headless autonomous run with no human to accept it, and runs the
// session in `--permission-mode auto` (NEVER bypassPermissions — a genuine tool pause
// still surfaces as NEEDS_INPUT for a human to answer remotely).
//
// The trust write targets the REAL ~/.claude.json in production; every case here
// injects a TEMP homedir, so no test run ever touches a real config (the same reason
// the seam is launcher-injected and omitted by every other test).
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureWorktreeTrusted, driveInteractiveClaudeSession } from "../src/mesh-worker-execution.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";

async function tempHomeWithConfig(initial) {
  const home = await mkdtemp(path.join(tmpdir(), "aof-trust-home-"));
  await writeFile(path.join(home, ".claude.json"), JSON.stringify(initial, null, 2));
  return home;
}

export const meshWorkerTrustWorktreeTests = [
  {
    name: "F24 ensureWorktreeTrusted writes hasTrustDialogAccepted for a NEW worktree path, preserving every other key",
    run: async () => {
      const home = await tempHomeWithConfig({
        hasCompletedOnboarding: true,
        projects: { "/existing/project": { hasTrustDialogAccepted: true, allowedTools: ["Bash"] } },
      });
      const wt = "/Users/x/.aof/mesh/checkouts/ws-1/.aof/mesh/worktrees/asg-1";
      await ensureWorktreeTrusted(wt, { homedir: home });
      const cfg = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
      assert.equal(cfg.projects[wt].hasTrustDialogAccepted, true, "the fresh worktree path is now trusted");
      assert.deepEqual(cfg.projects["/existing/project"].allowedTools, ["Bash"], "a sibling project's own keys are preserved");
      assert.equal(cfg.hasCompletedOnboarding, true, "top-level config is preserved");
    },
  },
  {
    name: "F24 ensureWorktreeTrusted is idempotent — an already-trusted worktree is a no-op and never throws",
    run: async () => {
      const wt = "/wt/already-trusted";
      const home = await tempHomeWithConfig({ projects: { [wt]: { hasTrustDialogAccepted: true, marker: "keep" } } });
      await ensureWorktreeTrusted(wt, { homedir: home });
      const cfg = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
      assert.equal(cfg.projects[wt].hasTrustDialogAccepted, true);
      assert.equal(cfg.projects[wt].marker, "keep", "an already-trusted entry is not rewritten/clobbered");
    },
  },
  {
    name: "F24 ensureWorktreeTrusted is best-effort — a missing ~/.claude.json never throws (claude falls back to its own dialog)",
    run: async () => {
      const home = await mkdtemp(path.join(tmpdir(), "aof-trust-empty-")); // no .claude.json written
      await ensureWorktreeTrusted("/wt/asg", { homedir: home }); // must not throw
    },
  },
  {
    name: "F24 ensureWorktreeTrusted ignores a blank/absent worktree path (never writes, never throws)",
    run: async () => {
      const home = await tempHomeWithConfig({ projects: {} });
      await ensureWorktreeTrusted("", { homedir: home });
      await ensureWorktreeTrusted(undefined, { homedir: home });
      const cfg = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
      assert.deepEqual(cfg.projects, {}, "nothing minted for a blank/absent cwd");
    },
  },
  {
    name: "F24 the driver calls the trustWorktree seam with the worktree cwd, and still spawns",
    run: async () => {
      const trustedWith = [];
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt-42", task: "demo", command: "/aof:continue" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null, trustWorktree: async (cwd) => { trustedWith.push(cwd); } },
      );
      assert.deepEqual(trustedWith, ["/tmp/wt-42"], "the worktree cwd was pre-trusted exactly once");
      assert.equal(spawnCalls.length, 1, "the interactive session still spawned");
      assert.equal(result.outcome, "done");
    },
  },
  {
    name: "F24 a throwing trustWorktree seam is swallowed — the driver still spawns (best-effort, never a hard stop)",
    run: async () => {
      const which = createFakeWhich(["claude"]);
      const { spawn, spawnCalls } = createFakePtySpawn({ onWrite: ({ emitExit }) => emitExit(0) });
      const result = await driveInteractiveClaudeSession(
        { itemRef: "38/05", worktreeCwd: "/tmp/wt-99", task: "demo", command: "/aof:continue" },
        { ptySpawn: spawn, which, watchTranscriptSessionId: async () => null, trustWorktree: async () => { throw new Error("config locked"); } },
      );
      assert.equal(spawnCalls.length, 1, "a trust-write fault never blocks the spawn");
      assert.equal(result.outcome, "done");
    },
  },
];

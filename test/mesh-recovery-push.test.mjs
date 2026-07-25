// test/mesh-recovery-push.test.mjs — VERIFICATION (control-driven recovery push, live
// two-machine soak 2026-07-25). Story 07's push-home fires ONLY on an ACTIVE assignment's
// own `done` seam; when a worker STALLS (interactive `claude` parks at an idle prompt so
// `term.onExit` never fires) or an assignment is left terminal with its diff stranded
// UNCOMMITTED in the worktree, there is no active flow to push it home (measured: a full
// refine — 7 stories + ADRs + ~180KB of docs — stuck on the Mac; the board read
// "not-started" over completed work). `aof mesh recover-push <assignmentId>` is the
// operator-driven rescue: run on the control node, it writes a request row the daemon
// tick drains — minting a one-shot write credential (never persisted) and dispatching a
// recovery-push DOWN-frame to the assignment's OWN target worker, which commits + pushes
// its worktree and reports back.
//
// These lanes drive: (A) the store surface + dispatch tick + result-apply holder gate
// against a hermetic store; (B) the REAL worker handler over a REAL local bare origin
// with an UNCOMMITTED diff (the real producer's shape); (C) the CLI core's resolve →
// request → poll → report.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment } from "../src/assignment-record.mjs";
import { addWorktree, meshWorktreePath, meshWorkerBranchName } from "../src/mesh-worktree.mjs";
import { createMeshRecoveryPushHandler } from "../src/mesh-worker-execution.mjs";
import { recoverPush } from "../src/commands/mesh-recover-push.mjs";
import { withMeshWorkerPushFixture } from "./support/mesh-worker-push-fixture.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";
import {
  RECOVERY_PUSH_KIND,
  RECOVERY_PUSH_RESULT_KIND,
  requestRecoveryPush,
  readRecoveryPush,
  markRecoveryPushState,
  applyRecoveryPushResultFrame,
  runRecoveryPushDispatchTick,
} from "../src/mesh-recovery-push.mjs";

// A hermetic store under a throwaway AOF_GLOBAL_HOME (the test-isolation discipline —
// never the real ~/.aof).
async function withIsolatedStore(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-recover-push-"));
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn({ store, env: { AOF_GLOBAL_HOME: home } });
  } finally {
    store.close?.();
    await rm(home, { recursive: true, force: true });
  }
}

// A no-close view of a store handle — the dispatch tick close()s its own store in a
// finally, but the test wants to keep reading the SAME handle after the tick.
function noClose(store) {
  return { db: store.db, paths: store.paths, close() {} };
}

// A fake control stream server: directiveTargets.get resolves a connected node to a
// live-looking socket; dispatchDirective records the frame and reports sent for a
// connected target (the SAME shape sendDirective returns).
function fakeStreamServer({ connected = [] } = {}) {
  const conn = new Set(connected);
  const dispatched = [];
  return {
    dispatched,
    directiveTargets: { get: (nodeId) => (conn.has(nodeId) ? { readyState: 1 } : null) },
    dispatchDirective: (frame) => {
      if (conn.has(frame?.to)) { dispatched.push(frame); return { sent: true }; }
      return { sent: false, code: "assignment-target-not-connected" };
    },
  };
}

function realGitExec(args, { cwd, env } = {}) {
  const r = spawnSyncHardened("git", args, { cwd, env, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

function seedAssignment(store, { assignmentId, itemRef = "18/00", workspaceId = "ws-1", targetNodeId = "worker-a", state = "running" }) {
  insertAssignment(store, assembleAssignmentRecord({
    assignmentId, itemRef, workspaceId, targetNodeId, issuer: "control", state,
    now: "2026-07-25T09:00:00.000Z",
  }));
}

export const meshRecoveryPushTests = [
  {
    name: "recovery-push store: a request writes a `requested` row; a re-request resets a terminal row back to `requested`",
    run: async () => withIsolatedStore(async ({ store }) => {
      const row = requestRecoveryPush(store, { assignmentId: "a1", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:00:00.000Z" });
      assert.equal(row.state, "requested");
      assert.equal(row.targetNodeId, "worker-a");
      assert.equal(row.detail, null);

      markRecoveryPushState(store, "a1", "failed", { detail: "push-failed", now: "2026-07-25T09:01:00.000Z" });
      assert.equal(readRecoveryPush(store, "a1").state, "failed");

      // A re-run of the CLI (INSERT OR REPLACE) resets the terminal row to `requested`,
      // clearing the stale detail — so the daemon re-drives it.
      const reset = requestRecoveryPush(store, { assignmentId: "a1", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:02:00.000Z" });
      assert.equal(reset.state, "requested");
      assert.equal(reset.detail, null);
    }),
  },
  {
    name: "recovery-push tick: a connected target mints the write credential and dispatches a recovery-push frame carrying it, marking the row `dispatched`",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestRecoveryPush(store, { assignmentId: "a1", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:00:00.000Z" });
      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      const mintCalls = [];
      await runRecoveryPushDispatchTick(streamServer, {
        now: "2026-07-25T09:00:05.000Z",
        openStore: async () => noClose(store),
        mintWriteCredential: async (workspaceId, assignmentId) => { mintCalls.push({ workspaceId, assignmentId }); return "wtok-123"; },
      });

      assert.deepEqual(mintCalls, [{ workspaceId: "ws-1", assignmentId: "a1" }], "minted for the row's OWN workspace + assignment");
      assert.equal(streamServer.dispatched.length, 1, "one recovery-push frame dispatched");
      const frame = streamServer.dispatched[0];
      assert.equal(frame.kind, RECOVERY_PUSH_KIND);
      assert.equal(frame.to, "worker-a");
      assert.equal(frame.assignmentId, "a1");
      assert.equal(frame.credential, "wtok-123", "the freshly minted credential rides the frame (one-shot, never persisted)");
      assert.equal(frame.branch, meshWorkerBranchName("18/00", "a1"), "the frame names the assignment's real branch");
      assert.equal(readRecoveryPush(store, "a1").state, "dispatched");

      // The token is NEVER written to the store — only the request + status.
      assert.ok(!JSON.stringify(readRecoveryPush(store, "a1")).includes("wtok-123"), "the write token is never persisted in the store row");
    }),
  },
  {
    name: "recovery-push tick: a target that is NOT connected leaves the row `requested` (retries next tick — never a failure for a transient disconnect)",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestRecoveryPush(store, { assignmentId: "a1", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:00:00.000Z" });
      const streamServer = fakeStreamServer({ connected: [] }); // worker-a offline
      let minted = false;
      await runRecoveryPushDispatchTick(streamServer, {
        openStore: async () => noClose(store),
        mintWriteCredential: async () => { minted = true; return "wtok"; },
      });
      assert.equal(minted, false, "no credential is minted for an offline target — nothing to hand it to");
      assert.equal(streamServer.dispatched.length, 0);
      assert.equal(readRecoveryPush(store, "a1").state, "requested", "the row stays requested to retry when the worker reconnects");
    }),
  },
  {
    name: "recovery-push tick: a mint fault marks the row `failed` LOUDLY (operator re-runs) rather than looping forever",
    run: async () => withIsolatedStore(async ({ store }) => {
      requestRecoveryPush(store, { assignmentId: "a1", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:00:00.000Z" });
      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      await runRecoveryPushDispatchTick(streamServer, {
        openStore: async () => noClose(store),
        mintWriteCredential: async () => { throw Object.assign(new Error("no app key"), { code: "mint-unavailable" }); },
      });
      assert.equal(streamServer.dispatched.length, 0, "nothing dispatched when the mint fails");
      const row = readRecoveryPush(store, "a1");
      assert.equal(row.state, "failed");
      assert.ok(String(row.detail).includes("mint-failed"), "the failure detail names the mint fault");
    }),
  },
  {
    name: "recovery-push result: the holder gate — a result on the WRONG connection nodeId is refused; the row flips only for the assignment's own target",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssignment(store, { assignmentId: "a1", targetNodeId: "worker-a" });
      requestRecoveryPush(store, { assignmentId: "a1", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:00:00.000Z" });
      markRecoveryPushState(store, "a1", "dispatched", { detail: "branch b" });

      // T6: a result arriving on worker-b's connection can never settle worker-a's row.
      const spoof = applyRecoveryPushResultFrame(store, { kind: RECOVERY_PUSH_RESULT_KIND, nodeId: "worker-b", assignmentId: "a1", ok: true }, { nodeId: "worker-b" });
      assert.equal(spoof.applied, false);
      assert.equal(spoof.code, "recovery-push-result-not-holder");
      assert.equal(readRecoveryPush(store, "a1").state, "dispatched", "the spoofed result did not settle the row");

      // The real holder's success flips it to `pushed`.
      const ok = applyRecoveryPushResultFrame(store, { kind: RECOVERY_PUSH_RESULT_KIND, nodeId: "worker-a", assignmentId: "a1", ok: true, branch: "b" }, { nodeId: "worker-a", now: "2026-07-25T09:05:00.000Z" });
      assert.equal(ok.applied, true);
      assert.equal(readRecoveryPush(store, "a1").state, "pushed");
    }),
  },
  {
    name: "recovery-push result: a worker-reported failure flips the row `failed`, carrying the reported code as detail",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssignment(store, { assignmentId: "a2", targetNodeId: "worker-a" });
      requestRecoveryPush(store, { assignmentId: "a2", itemRef: "18/00", workspaceId: "ws-1", targetNodeId: "worker-a", now: "2026-07-25T09:00:00.000Z" });
      markRecoveryPushState(store, "a2", "dispatched");
      const result = applyRecoveryPushResultFrame(store, { kind: RECOVERY_PUSH_RESULT_KIND, nodeId: "worker-a", assignmentId: "a2", ok: false, code: "push-failed" }, { nodeId: "worker-a" });
      assert.equal(result.applied, true);
      const row = readRecoveryPush(store, "a2");
      assert.equal(row.state, "failed");
      assert.equal(row.detail, "push-failed");
    }),
  },
  {
    name: "recovery-push worker handler: the REAL handler commits an UNCOMMITTED worktree diff and pushes it to origin with the carried credential, then reports ok",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const assignmentId = "asg-recover";
      const branch = meshWorkerBranchName(fx.itemRef, assignmentId);
      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      // Materialize the assignment's worktree ON its real branch (as the driver would),
      // then leave an UNCOMMITTED file in it (the real stalled-worker shape).
      await addWorktree(fx.root, assignmentId, "HEAD", { exec: realGitExec, branch });
      await writeFile(path.join(worktreePath, "recovered.md"), "# rescued worker output\n", "utf8");

      const results = [];
      const handler = createMeshRecoveryPushHandler({
        loadWs: () => Promise.resolve(fx.workspace),
        nodeId: "worker-a",
        sendRecoveryPushResult: async (aid, payload) => { results.push({ aid, ...payload }); },
        pushExec: realGitExec,
        globalWorkStoreOptions: { env: fx.env },
      });

      await handler({ kind: RECOVERY_PUSH_KIND, to: "worker-a", assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, branch, credential: null, at: "2026-07-25T09:00:00.000Z" });

      assert.equal(results.length, 1, "exactly one result frame is sent");
      assert.equal(results[0].ok, true, "the recovery push reports success");
      assert.equal(results[0].branch, branch);

      // The UNCOMMITTED file reaches origin on the assignment's branch — committed by the
      // handler (the SAME commit+push seams the done-path uses).
      const show = spawnSyncHardened("git", ["show", `${branch}:recovered.md`], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(show.status, 0, "the stranded file reaches origin");
      assert.equal(show.stdout, "# rescued worker output\n");
      const author = spawnSyncHardened("git", ["log", "-1", "--format=%an", branch], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.ok(author.stdout.includes("aof-mesh"), "committed under the aof-mesh worker identity");
    }),
  },
  {
    name: "recovery-push worker handler: a MISSING worktree (a cleanly-done assignment force-removed it) reports a clear coded result, never a crash",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const results = [];
      const handler = createMeshRecoveryPushHandler({
        loadWs: () => Promise.resolve(fx.workspace),
        nodeId: "worker-a",
        sendRecoveryPushResult: async (aid, payload) => { results.push({ aid, ...payload }); },
        pushExec: realGitExec,
        globalWorkStoreOptions: { env: fx.env },
      });
      const assignmentId = "asg-missing";
      await handler({ kind: RECOVERY_PUSH_KIND, to: "worker-a", assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, branch: meshWorkerBranchName(fx.itemRef, assignmentId), credential: null, at: "t" });
      assert.equal(results.length, 1);
      assert.equal(results[0].ok, false);
      assert.equal(results[0].code, "recovery-worktree-missing");
    }),
  },
  {
    name: "recover-push CLI: an unknown assignmentId is a coded refusal (nothing requested)",
    run: async () => withIsolatedStore(async ({ store, env }) => {
      const result = await recoverPush("does-not-exist", {
        globalWorkStoreOptions: { env },
        openGlobalWorkProjectionStore: async () => noClose(store),
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "recovery-unknown-assignment");
    }),
  },
  {
    name: "recover-push CLI: resolves the assignment's own target, requests, and reports `pushed` when the row settles",
    run: async () => withIsolatedStore(async ({ store, env }) => {
      seedAssignment(store, { assignmentId: "a1", itemRef: "18/03", workspaceId: "ws-1", targetNodeId: "worker-a" });
      // The injected sleep simulates the daemon+worker settling the row between polls.
      const sleep = async () => { markRecoveryPushState(store, "a1", "pushed", { detail: "branch b" }); };
      const result = await recoverPush("a1", {
        globalWorkStoreOptions: { env },
        openGlobalWorkProjectionStore: async () => noClose(store),
        pollMs: 1, timeoutMs: 1000, sleep,
      });
      assert.equal(result.ok, true);
      assert.equal(result.code, "recovery-pushed");
      assert.equal(result.targetNodeId, "worker-a", "the target came from the assignment record, not an operator flag");
      assert.equal(result.itemRef, "18/03");
    }),
  },
  {
    name: "recover-push CLI: reports `failed` when the worker's result settles the row failed",
    run: async () => withIsolatedStore(async ({ store, env }) => {
      seedAssignment(store, { assignmentId: "a1", targetNodeId: "worker-a" });
      const sleep = async () => { markRecoveryPushState(store, "a1", "failed", { detail: "push-failed" }); };
      const result = await recoverPush("a1", {
        globalWorkStoreOptions: { env },
        openGlobalWorkProjectionStore: async () => noClose(store),
        pollMs: 1, timeoutMs: 1000, sleep,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "recovery-push-failed");
      assert.equal(result.detail, "push-failed");
    }),
  },
  {
    name: "recover-push CLI: reports still-pending (never hangs) when the worker never settles the row within the timeout",
    run: async () => withIsolatedStore(async ({ store, env }) => {
      seedAssignment(store, { assignmentId: "a1", targetNodeId: "worker-a" });
      const result = await recoverPush("a1", {
        globalWorkStoreOptions: { env },
        openGlobalWorkProjectionStore: async () => noClose(store),
        timeoutMs: 0, // return the current (requested) state at once
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, "recovery-pending");
      assert.equal(result.state, "requested");
    }),
  },
];

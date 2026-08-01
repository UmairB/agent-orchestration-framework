// test/mesh-assignment-directive.test.mjs — VERIFICATION (UI phase selection,
// 2026-07-25). Story 04 put a UI face on `aof mesh assign`, but the dispatch tick
// hardcoded ONE command for every assignment — `/aof:refine <ref> --autonomous`. The
// operator now picks the lifecycle phase (refine/continue/verify) in the UI; because the
// assignment record is FROZEN (acd-assignment-record-frozen), the phase rides an
// additive side-table (`global_assignment_directives`) keyed by assignment_id, exactly
// like `global_recovery_pushes`. These lanes drive: the phase→command mapper, the
// side-table accessors, the dispatch tick reading the phase (fallback to refine), and
// the REAL route → verb → side-table persistence with the closed-set validation.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, updateAssignmentState } from "../src/assignment-record.mjs";
import { runControlDispatchReclaimTick } from "../src/mesh-assignment-reclaim.mjs";
import { buildDirectiveFrame, applyAssignmentStatusFrame } from "../src/control-stream-server.mjs";
import { applyRecoveryPushResultFrame, buildRecoveryPushResultFrame } from "../src/mesh-recovery-push.mjs";
import { createMeshWorkerExecutionHandler } from "../src/mesh-worker-execution.mjs";
import { meshItemBranchName, meshWorktreePath } from "../src/mesh-worktree.mjs";
import { loadWorkspace } from "../src/work.mjs";
import {
  ASSIGNMENT_PHASES,
  phaseRunsOnItemBranch,
  DEFAULT_ASSIGNMENT_PHASE,
  isAssignmentPhase,
  assignmentDirectiveCommand,
  setAssignmentPhase,
  readAssignmentPhase,
  setItemBranch,
  readItemBranch,
} from "../src/mesh-assignment-directive.mjs";
import { withPublishedAssignFixture } from "./support/mesh-ui-assign-fixture.mjs";
import { withMeshWorkerPushFixture } from "./support/mesh-worker-push-fixture.mjs";
import { markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder } from "./support/mesh-worker-exec-fixture.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

function realGitExec(args, { cwd, env } = {}) {
  const r = spawnSyncHardened("git", args, { cwd, env, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

async function withIsolatedStore(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-assign-directive-"));
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn({ store, home });
  } finally {
    store.close?.();
    await rm(home, { recursive: true, force: true });
  }
}

function noClose(store) {
  return { db: store.db, paths: store.paths, close() {} };
}

function fakeStreamServer({ connected = [] } = {}) {
  const conn = new Set(connected);
  const dispatched = [];
  return {
    dispatched,
    directiveTargets: { get: (nodeId) => (conn.has(nodeId) ? { fake: true } : null) },
    dispatchDirective: (frame) => { dispatched.push(frame); return { sent: true }; },
    updatePeers() {},
    stop() {},
  };
}

function seedAssigned(store, { assignmentId, itemRef, workspaceId = "ws-1", targetNodeId = "worker-a" }) {
  insertAssignment(store, assembleAssignmentRecord({
    assignmentId, itemRef, workspaceId, targetNodeId, issuer: "control-a", state: "assigned",
    now: "2026-07-25T09:00:00.000Z",
  }));
}

async function readPhaseRow(home, assignmentId) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return readAssignmentPhase(store, assignmentId);
  } finally {
    store.close?.();
  }
}

export const meshAssignmentDirectiveTests = [
  {
    name: "assignment-directive: the phase → command mapper (refine carries --autonomous; continue/verify do not; unknown degrades to refine)",
    run: async () => {
      assert.equal(assignmentDirectiveCommand("refine", "18"), "/aof:refine 18 --autonomous");
      assert.equal(assignmentDirectiveCommand("continue", "18"), "/aof:continue 18");
      assert.equal(assignmentDirectiveCommand("verify", "18"), "/aof:verify 18");
      assert.equal(assignmentDirectiveCommand("autonomous", "18"), "/aof:autonomous 18");
      // An unknown/garbage phase never becomes arbitrary PTY text — it maps to the refine default.
      assert.equal(assignmentDirectiveCommand("rm -rf", "18"), "/aof:refine 18 --autonomous");
      assert.equal(assignmentDirectiveCommand(undefined, "18"), "/aof:refine 18 --autonomous");
      assert.deepEqual([...ASSIGNMENT_PHASES], ["refine", "continue", "verify", "autonomous"]);
      assert.equal(DEFAULT_ASSIGNMENT_PHASE, "refine");
    },
  },
  {
    name: "assignment-directive: isAssignmentPhase accepts only the closed set",
    run: async () => {
      for (const p of ["refine", "continue", "verify", "autonomous"]) assert.equal(isAssignmentPhase(p), true, p);
      for (const p of ["", "Refine", "build", "continue ", null, undefined, 3]) assert.equal(isAssignmentPhase(p), false, String(p));
    },
  },
  {
    name: "assignment-directive: setAssignmentPhase / readAssignmentPhase round-trip, overwrite in place, refuse an invalid phase, and return null when absent",
    run: async () => withIsolatedStore(async ({ store }) => {
      assert.equal(readAssignmentPhase(store, "a1"), null, "no row → null (dispatch falls back to refine)");
      setAssignmentPhase(store, "a1", "continue", { now: "2026-07-25T09:00:00.000Z" });
      assert.equal(readAssignmentPhase(store, "a1"), "continue");
      setAssignmentPhase(store, "a1", "verify", { now: "2026-07-25T09:01:00.000Z" });
      assert.equal(readAssignmentPhase(store, "a1"), "verify", "a re-write updates in place");
      assert.throws(() => setAssignmentPhase(store, "a1", "hack"), (e) => e.code === "assignment-phase-invalid");
    }),
  },
  {
    name: "assignment-directive: the dispatch tick runs the recorded phase's command (/aof:continue) and FALLS BACK to the refine default when no phase is recorded",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-cont", itemRef: "18", targetNodeId: "worker-a" });
      seedAssigned(store, { assignmentId: "asg-plain", itemRef: "19", targetNodeId: "worker-a" });
      setAssignmentPhase(store, "asg-cont", "continue");

      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, {
        workspaceId: "ws-1",
        now: "2026-07-25T09:00:05.000Z",
        openStore: async () => noClose(store),
        buildDirectiveFrame,
        dispatchedIds: new Set(),
      });

      const byId = new Map(streamServer.dispatched.map((f) => [f.assignmentId, f]));
      assert.equal(byId.get("asg-cont")?.command, "/aof:continue 18", "the recorded `continue` phase dispatches /aof:continue");
      assert.equal(byId.get("asg-plain")?.command, "/aof:refine 19 --autonomous", "no phase row → the refine default, unchanged");
    }),
  },
  {
    name: "assignment-directive (route→verb→side-table): POST /api/mesh/assign with phase:continue mints the record AND persists the phase; the result echoes it",
    run: async () => withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
      const response = await fetch(new URL("/api/mesh/assign", url), {
        method: "POST",
        headers: { origin: new URL(url).origin, "content-type": "application/json" },
        body: JSON.stringify({ ref: "38/04", nodeId: "worker-a", workspaceId, phase: "continue" }),
      });
      assert.equal(response.status, 200, "the real route accepted the assign");
      const body = await response.json();
      assert.equal(body.phase, "continue", "the result echoes the chosen phase");
      assert.ok(body.assignmentId, "…and carries the minted assignmentId");
      assert.equal(await readPhaseRow(home, body.assignmentId), "continue", "the phase persisted in the side-table, keyed by the minted assignmentId");
    }, { nodes: ["worker-a"] }),
  },
  {
    name: "assignment-directive (route): NO phase persists NO row (the refine default is the dispatch fallback, never a stored refine)",
    run: async () => withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
      const response = await fetch(new URL("/api/mesh/assign", url), {
        method: "POST",
        headers: { origin: new URL(url).origin, "content-type": "application/json" },
        body: JSON.stringify({ ref: "38/04", nodeId: "worker-a", workspaceId }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.phase, "refine", "the result names the default phase");
      assert.equal(await readPhaseRow(home, body.assignmentId), null, "…but writes no side-table row — the dispatch tick's own refine fallback applies");
    }, { nodes: ["worker-a"] }),
  },
  {
    name: "assignment-directive (route): an INVALID phase is coerced to refine (closed-set validation) — never persisted, never arbitrary PTY text",
    run: async () => withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
      const response = await fetch(new URL("/api/mesh/assign", url), {
        method: "POST",
        headers: { origin: new URL(url).origin, "content-type": "application/json" },
        body: JSON.stringify({ ref: "38/04", nodeId: "worker-a", workspaceId, phase: "; rm -rf /" }),
      });
      assert.equal(response.status, 200, "the assign still succeeds — the phase is coerced, not a hard refusal");
      const body = await response.json();
      assert.equal(body.phase, "refine", "the hostile phase coerced to the refine default");
      assert.equal(await readPhaseRow(home, body.assignmentId), null, "…and nothing was persisted, so the worker can never be handed the injected string");
    }, { nodes: ["worker-a"] }),
  },

  // ── continue-on-existing-branch: the item → active-branch map + dispatch + record ──
  {
    name: "item-branch store: setItemBranch/readItemBranch round-trip, most-recent-push wins, blank ignored, absent → null",
    run: async () => withIsolatedStore(async ({ store }) => {
      assert.equal(readItemBranch(store, "ws-1", "18"), null, "no prior push → null (a first dispatch is a refine, needs no base)");
      setItemBranch(store, "ws-1", "18", "aof/mesh/18-refine1", { now: "2026-07-25T09:00:00.000Z" });
      assert.equal(readItemBranch(store, "ws-1", "18"), "aof/mesh/18-refine1");
      setItemBranch(store, "ws-1", "18", "aof/mesh/18-refine1", { now: "2026-07-25T09:05:00.000Z" }); // idempotent-ish, same branch
      assert.equal(readItemBranch(store, "ws-1", "18"), "aof/mesh/18-refine1");
      assert.equal(setItemBranch(store, "ws-1", "18", ""), null, "a blank branch is never recorded");
      assert.equal(readItemBranch(store, "ws-1", "18"), "aof/mesh/18-refine1", "…and leaves the prior value intact");
      assert.equal(readItemBranch(store, "ws-1", "19"), null, "another item is independent");
    }),
  },
  {
    name: "dispatch: a continue for an item WITH a recorded branch carries it as baseBranch; a refine carries none; a continue with NO recorded branch carries none",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-cont", itemRef: "18", targetNodeId: "worker-a" });
      seedAssigned(store, { assignmentId: "asg-refine", itemRef: "20", targetNodeId: "worker-a" });
      seedAssigned(store, { assignmentId: "asg-cont-nobranch", itemRef: "21", targetNodeId: "worker-a" });
      setAssignmentPhase(store, "asg-cont", "continue");
      setAssignmentPhase(store, "asg-cont-nobranch", "continue");
      setItemBranch(store, "ws-1", "18", "aof/mesh/18-73ab17b2");

      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, {
        workspaceId: "ws-1", now: "2026-07-25T09:00:05.000Z",
        openStore: async () => noClose(store), buildDirectiveFrame, dispatchedIds: new Set(),
      });

      const byId = new Map(streamServer.dispatched.map((f) => [f.assignmentId, f]));
      assert.equal(byId.get("asg-cont")?.baseBranch, "aof/mesh/18-73ab17b2", "continue reuses the item's recorded branch");
      assert.equal(byId.get("asg-cont")?.command, "/aof:continue 18");
      assert.equal(byId.get("asg-refine")?.baseBranch, undefined, "a refine branches fresh — no baseBranch");
      assert.equal(byId.get("asg-cont-nobranch")?.baseBranch, undefined, "a continue with no recorded branch carries none (first-ever run falls back to fresh)");
    }),
  },
  {
    // M42 base-commit pin (operator, 2026-08-01): the dispatch stamps the state the
    // assignment was made against — the control checkout's HEAD — onto the frame,
    // so a fresh worker worktree builds from exactly that commit. Unresolvable
    // (the default resolver over a non-repo path) sends none, and the worker keeps
    // its own-HEAD fallback.
    name: "dispatch: the directive carries the assigning checkout's HEAD as `commit` (the base-commit pin); an unresolvable checkout sends none",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-pin", itemRef: "22", targetNodeId: "worker-a" });
      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      const dispatchedIds = new Set();
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, {
        workspaceId: "ws-1", now: "2026-07-25T09:00:05.000Z",
        openStore: async () => noClose(store), buildDirectiveFrame, dispatchedIds,
        resolveDispatchCommit: async () => "abc123def4567890abc123def4567890abc123de",
      });
      const pinned = streamServer.dispatched.find((f) => f.assignmentId === "asg-pin");
      assert.equal(pinned?.commit, "abc123def4567890abc123def4567890abc123de", "the frame carries the resolved assigning commit");

      // The DEFAULT resolver over an unresolvable root (a /tmp/none workspace,
      // no descriptor row): no commit key at all — never a fabricated hash.
      seedAssigned(store, { assignmentId: "asg-nopin", itemRef: "23", targetNodeId: "worker-a" });
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, {
        workspaceId: "ws-1", now: "2026-07-25T09:00:06.000Z",
        openStore: async () => noClose(store), buildDirectiveFrame, dispatchedIds,
      });
      const unpinned = streamServer.dispatched.find((f) => f.assignmentId === "asg-nopin");
      assert.ok(unpinned, "the second dispatch went out");
      assert.equal("commit" in unpinned, false, "an unresolvable checkout sends NO commit — the worker keeps its own-HEAD fallback");
    }),
  },
  {
    // 2026-07-27 (the duplicate-run wall): a withdrawal was a control-side row flip
    // the holder never learned about — its run record stayed `running` and the
    // duplicate-run guard refused every future run for the item. The tick now
    // notifies the target node once per launcher lifetime; feature-gated on the
    // caller passing the Set (an absent Set = byte-identical legacy behaviour).
    name: "dispatch: a WITHDRAWN row is notified to its holder exactly once (kind:withdraw, carrying runId); no Set passed → no withdraw frames at all",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-w1", itemRef: "18", targetNodeId: "worker-a" });
      updateAssignmentState(store, "asg-w1", "running", { now: "2026-07-27T10:00:00.000Z" });
      updateAssignmentState(store, "asg-w1", "withdrawn", { now: "2026-07-27T10:01:00.000Z" });

      const notified = new Set();
      const tickOptions = {
        workspaceId: "ws-1", now: "2026-07-27T10:02:00.000Z",
        openStore: async () => noClose(store), buildDirectiveFrame, dispatchedIds: new Set(),
        withdrawNotifiedIds: notified,
      };
      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, tickOptions);

      const withdraws = streamServer.dispatched.filter((f) => f.kind === "withdraw");
      assert.equal(withdraws.length, 1, "the withdrawn row's holder is notified");
      assert.equal(withdraws[0].assignmentId, "asg-w1");
      assert.equal(withdraws[0].to, "worker-a");
      assert.equal(withdraws[0].itemRef, "18");
      assert.ok(notified.has("asg-w1"), "the once-guard records the notify");

      // Second tick: the once-guard holds — no re-send.
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, tickOptions);
      assert.equal(streamServer.dispatched.filter((f) => f.kind === "withdraw").length, 1, "notified exactly once per launcher lifetime");

      // No Set passed (a legacy caller / every pre-existing test): zero withdraw frames.
      const legacyServer = fakeStreamServer({ connected: ["worker-a"] });
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, legacyServer, {
        workspaceId: "ws-1", now: "2026-07-27T10:03:00.000Z",
        openStore: async () => noClose(store), buildDirectiveFrame, dispatchedIds: new Set(),
      });
      assert.equal(legacyServer.dispatched.filter((f) => f.kind === "withdraw").length, 0, "feature-gated: an absent Set sends nothing");
    }),
  },
  {
    // MEASURED 2026-07-27 (the first autonomous dispatch, milestone 18 live): the
    // tick hand-spelled `phase === "continue" || phase === "verify"` at its call
    // site, so `autonomous` fell to the no-baseBranch default and the worker built
    // the milestone in a FRESH worktree off main — none of the refine's stories
    // existed there. The predicate now lives in ONE home (phaseRunsOnItemBranch):
    // every non-refine phase carries the recorded branch.
    name: "dispatch: an AUTONOMOUS assignment carries the item's recorded branch too — every non-refine phase accumulates on the ONE branch (the 2026-07-27 wrong-base defect)",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-auto", itemRef: "18", targetNodeId: "worker-a" });
      seedAssigned(store, { assignmentId: "asg-verify", itemRef: "22", targetNodeId: "worker-a" });
      setAssignmentPhase(store, "asg-auto", "autonomous");
      setAssignmentPhase(store, "asg-verify", "verify");
      setItemBranch(store, "ws-1", "18", "aof/mesh/18-73ab17b2");
      setItemBranch(store, "ws-1", "22", "aof/mesh/22-feedface");

      const streamServer = fakeStreamServer({ connected: ["worker-a"] });
      await runControlDispatchReclaimTick({ workDir: "/tmp/none", projectRoot: "/tmp/none" }, streamServer, {
        workspaceId: "ws-1", now: "2026-07-27T10:00:00.000Z",
        openStore: async () => noClose(store), buildDirectiveFrame, dispatchedIds: new Set(),
      });

      const byId = new Map(streamServer.dispatched.map((f) => [f.assignmentId, f]));
      assert.equal(byId.get("asg-auto")?.command, "/aof:autonomous 18", "the autonomous phase dispatches the cascade");
      assert.equal(byId.get("asg-auto")?.baseBranch, "aof/mesh/18-73ab17b2", "…ON the item's recorded branch — the refined stories are THERE, never a fresh worktree off main");
      assert.equal(byId.get("asg-verify")?.baseBranch, "aof/mesh/22-feedface", "verify still carries the branch (the one-home predicate covers every non-refine phase)");
      assert.equal(phaseRunsOnItemBranch("refine"), false, "refine mints the branch — it never carries one");
      assert.equal(phaseRunsOnItemBranch("nonsense"), false, "an unknown phase degrades branchless, matching the mapper's refine degrade");
    }),
  },
  {
    name: "record on done: a holder's `done` frame carrying the pushed branch records the item's active branch; a non-holder frame and a non-done state record nothing",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-1", itemRef: "18", workspaceId: "ws-1", targetNodeId: "worker-a" });
      // wrong holder — nothing recorded
      await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: "worker-b", assignmentId: "asg-1", state: "done", branch: "aof/mesh/18-x" }, { nodeId: "worker-b" });
      assert.equal(readItemBranch(store, "ws-1", "18"), null, "a non-holder never records the item branch");
      // non-done — nothing recorded
      await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-1", state: "running", branch: "aof/mesh/18-x" }, { nodeId: "worker-a" });
      assert.equal(readItemBranch(store, "ws-1", "18"), null, "a non-done state records nothing (the push has not happened)");
      // holder + done + branch — recorded
      await applyAssignmentStatusFrame(store, { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-1", state: "done", branch: "aof/mesh/18-73ab17b2" }, { nodeId: "worker-a" });
      assert.equal(readItemBranch(store, "ws-1", "18"), "aof/mesh/18-73ab17b2", "a holder's done records the pushed branch");
    }),
  },
  {
    name: "record on recovery-push: a successful recovery-push result records the item's active branch too",
    run: async () => withIsolatedStore(async ({ store }) => {
      seedAssigned(store, { assignmentId: "asg-1", itemRef: "18", workspaceId: "ws-1", targetNodeId: "worker-a" });
      const frame = buildRecoveryPushResultFrame("worker-a", "asg-1", { ok: true, branch: "aof/mesh/18-73ab17b2", now: "t" });
      applyRecoveryPushResultFrame(store, frame, { nodeId: "worker-a" });
      assert.equal(readItemBranch(store, "ws-1", "18"), "aof/mesh/18-73ab17b2", "recovery-push records the item's active branch");
    }),
  },
  {
    name: "worker reuse: a continue directive carrying baseBranch checks out the EXISTING branch and its commit ACCUMULATES on that branch at origin (refine + continue on ONE branch), and the done frame reports it",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: "worker-a", workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });

      // Simulate a prior refine: create the item's branch with a refine commit and push
      // it to origin, WITHOUT leaving it checked out in the main worktree. The seeded
      // name is the PRE-CURE suffixed shape deliberately (m42): the cache-supplied
      // baseBranch must keep winning for continuity — a pre-cure item's work lives
      // under its old name, and the continue must land THERE, not on the derivation.
      const baseBranch = `${meshItemBranchName(fx.itemRef)}-refine-asg`;
      const seedWt = path.join(fx.tmp, "seed-wt");
      assert.equal(realGitExec(["worktree", "add", "-b", baseBranch, seedWt, "HEAD"], { cwd: fx.root }).status, 0);
      await writeFile(path.join(seedWt, "refine.md"), "# the refine contract\n", "utf8");
      realGitExec(["-c", "user.name=aof-mesh", "-c", "user.email=aof-mesh@users.noreply.github.com", "add", "-A"], { cwd: seedWt });
      realGitExec(["-c", "user.name=aof-mesh", "-c", "user.email=aof-mesh@users.noreply.github.com", "commit", "--no-verify", "-m", "refine-output"], { cwd: seedWt });
      assert.equal(realGitExec(["push", "origin", baseBranch], { cwd: seedWt }).status, 0, "refine branch pushed to origin");
      realGitExec(["worktree", "remove", "--force", seedWt], { cwd: fx.root }); // release the branch

      // Now a CONTINUE assignment on that branch: the scripted agent writes continue output.
      const recorder = createStatusRecorder();
      const continueAsg = "cont-asg";
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(ws),
        nodeId: "worker-a",
        sendAssignmentStatus: recorder.sendAssignmentStatus,
    sendEffectStep: recorder.sendEffectStep,
        spawnRuntime: async (brief) => { await writeFile(path.join(brief.worktreeCwd, "continue.md"), "# the continue output\n", "utf8"); return { outcome: "done" }; },
        now: () => "2026-07-25T10:00:00.000Z",
        globalWorkStoreOptions: { env: fx.env },
        exec: realGitExec,
        pushExec: realGitExec,
        requestWriteCredential: async () => null,
      });
      await handler({ kind: "directive", to: "worker-a", assignmentId: continueAsg, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: "2026-07-25T10:00:00.000Z", command: `/aof:continue ${fx.itemRef}`, baseBranch });

      // The done frame reports the branch it pushed (the SAME base branch — no new one).
      const done = recorder.frames.find((f) => f.state === "done");
      assert.ok(done, "the continue reported done");
      assert.equal(done.branch, baseBranch, "…reporting the reused base branch (so control records it as the item's active branch)");

      // BOTH the refine and the continue outputs are on the ONE branch at origin.
      const refineShow = spawnSyncHardened("git", ["show", `${baseBranch}:refine.md`], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(refineShow.status, 0, "the refine contract is still on the branch");
      const contShow = spawnSyncHardened("git", ["show", `${baseBranch}:continue.md`], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(contShow.status, 0, "the continue output landed on the SAME branch — the work accumulated, never a fresh branch");
      assert.equal(contShow.stdout, "# the continue output\n");
      // The cache-supplied base WON: the item's derived one-branch name was never
      // created — the continue stayed on the pre-cure branch the cache remembered.
      const derivedBranch = meshItemBranchName(fx.itemRef);
      assert.notEqual(derivedBranch, baseBranch);
      assert.notEqual(spawnSyncHardened("git", ["show", `${derivedBranch}:continue.md`], { cwd: fx.bareOrigin, encoding: "utf8" }).status, 0, "the derivation never fired while the cache had the answer — continue stayed on the item's cached branch");
      assert.equal(existsSync(meshWorktreePath(fx.root, continueAsg)), false, "the continue worktree is force-removed after a clean done+push");
    }),
  },
];

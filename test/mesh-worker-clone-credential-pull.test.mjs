// test/mesh-worker-clone-credential-pull.test.mjs — traceability for milestone 38 /
// story 01, task 05 (05_bug-clone-credential-pull.feature, ADR-009, finding F12).
// Every @executable scenario / Scenario Outline row wired to the REAL engine surface:
//   - worker side: createMeshWorkerExecutionHandler / cloneRepoForWorkspace
//     (src/mesh-worker-execution.mjs), createWorkerStreamClient /
//     requestCloneCredential (src/worker-stream-client.mjs).
//   - control side: applyStreamFrame / applyCloneCredentialRequestFrame
//     (src/control-stream-server.mjs) — the REAL authorization + mint + reply path,
//     never hand-authored by this test.
//   - production wiring: startLauncher (src/mesh-launcher.mjs) — constructed the way
//     `aof mesh serve --serve` does, with NO credential-shaped test injection, per the
//     feature's own instruction: "an assertion whose absence let F12 ship is 'the
//     PRODUCTION wiring supplies the credential' — a test that injects the
//     collaborator it is meant to be verifying proves nothing."
//
// Hermetic throughout: an INJECTED clone-exec fake (no real forge, no real network)
// and the house bidirectional stream fixture (test/support/mesh-directive-channel-
// fixture.mjs) drive the wire round-trip through the REAL control-side apply
// function — never a hand-authored stand-in for the thing under test.
import assert from "node:assert/strict";
import { readFile, stat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  createMeshWorkerExecutionHandler,
  cloneRepoForWorkspace,
  meshCheckoutPath,
} from "../src/mesh-worker-execution.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import {
  applyCloneCredentialRequestFrame,
  buildDirectiveFrame,
  CLONE_CREDENTIAL_NOT_HOLDER,
  CLONE_CREDENTIAL_WORKSPACE_MISMATCH,
  CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE,
} from "../src/control-stream-server.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../src/global-work-store.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { TERMINAL_ASSIGNMENT_STATES } from "../src/assignment-record.mjs";
import {
  withMeshCloneFixture,
  createStatusRecorder,
  createRecordingCloneExec,
  scriptedSpawnRuntime,
  scriptedPushExec,
} from "./support/mesh-worker-clone-fixture.mjs";
import { createFakeWorkerTransport, createDirectiveChannelFixture } from "./support/mesh-directive-channel-fixture.mjs";
import { seedAssignment } from "./support/mesh-assign-fixture.mjs";

const CLONE_URL = "https://git.example.com/acme/secret.git";
const NOW = "2026-07-13T09:00:00.000Z";

// waitForFrame(transport, predicate, { timeoutMs }) — polls on a REAL wall-clock
// bound (small setTimeout ticks, not a fixed event-loop-turn count) until the LATEST
// frame on `transport` satisfies `predicate`, or gives up. A fixed turn-count is NOT
// reliable here: the clone-miss path opens the global SQLite store for real before
// ever reaching the credential resolver, and how many event-loop turns that takes
// varies with real disk I/O latency — a wall-clock bound is the only robust wait.
async function waitForFrame(transport, predicate, { timeoutMs = 5000, pollMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = transport.frames.at(-1);
    if (latest != null && predicate(latest)) return latest;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

// invokeAskpassShim(shimPath, prompt) — runs the GIT_ASKPASS one-shot shim exactly as
// git would (mirrors task 03's traceability module) — the ONE sanctioned way to
// observe the credential riding the clone-exec's per-invocation env. MILESTONE 38 /
// STORY 02 (ADR-010 decision 4): the shim is now PROMPT-AWARE, so every call site
// here simulates the real git `"Password for '...'"` prompt (the prompt-kind this
// module's own assertions have always meant to exercise — observing the TOKEN, not
// the username-vs-password distinction, which is task 03's own dedicated module).
function invokeAskpassShim(shimPath, prompt = "Password for 'https://git.example.com'") {
  return new Promise((resolve, reject) => {
    execFile(shimPath, [prompt], { windowsHide: true, shell: process.platform === "win32" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

// A RECORDING-but-delegating exec (the task 02/03 idiom): records every worktree
// call's argv then spawns the REAL git binary so the worktree genuinely
// materializes and the handler reaches spawnRuntime — only the CLONE step itself is
// ever faked.
function delegatingWorktreeExec() {
  const calls = [];
  const exec = (args, opts) => {
    calls.push(args);
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: opts?.cwd, windowsHide: true }, (error, stdout, stderr) => {
        if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
      });
    });
  };
  return { calls, exec };
}

// driveCloneCredentialReply(...) — drives the REAL control-side
// applyCloneCredentialRequestFrame against the up-frame the worker's fake transport
// just captured, then hands the resulting down-frame back to the worker's transport
// exactly as a real ws "message" event would. The "real producer" for the control
// half of every round-trip test below (ADR-008: never hand-author the thing under
// test).
async function driveCloneCredentialReply({ transport, targets, store, requesterNodeId, mintCloneCredential, now = NOW }) {
  const upFrame = await waitForFrame(transport, (f) => f.kind === "clone-credential-request");
  assert.ok(upFrame != null, "a clone-credential-request frame was sent within the wait bound");
  const applied = await applyCloneCredentialRequestFrame(store, upFrame, {
    nodeId: requesterNodeId,
    directiveTargets: targets,
    mintCloneCredential,
    now,
  });
  const socket = targets.get(requesterNodeId);
  const downFrame = socket?.frames?.at(-1) ?? null;
  if (downFrame != null) transport.deliver(downFrame);
  return { upFrame, downFrame, applied };
}

async function withStore({ env }, fn) {
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

// markRepoAlreadyPresent(...) — the task 02 idiom: writes BOTH repo-availability
// facts directly (bypassing a clone) so workerHasRepo() is TRUE and the clone-miss
// branch never runs — the precondition for the "already HAS the repo" scenario.
async function markRepoAlreadyPresent({ workspace, workspaceId, env, nodeId = "worker-a" }) {
  const { writeRepoPublishedMarker } = await import("../src/commands/mesh-repo.mjs");
  const configPath = path.join(workspace.projectRoot, ".aof", "aof.config.json");
  await writeRepoPublishedMarker({ configPath, workspaceId, now: NOW });
  await withStore({ env }, async (store) => {
    store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(nodeId, workspaceId);
  });
  return loadWorkspace(workspace.projectRoot, undefined, { env });
}

// -------------------------------------------------------------------------------
// The PRODUCTION-WIRING fixture (F12 guard scenario) — a worker-role repo wired the
// way `aof mesh serve --serve` wires it (startLauncher), carrying a `mesh.repo.
// cloneUrl` so a clone-miss genuinely fires, and NO credential-shaped test
// injection anywhere in the options passed to startLauncher.
// -------------------------------------------------------------------------------
const PROD_WORKER_ID = "worker-node";
const PROD_CONTROL_ID = "control-node";

function fixturedFabricExec(payload) {
  return async () => ({ stdout: JSON.stringify(payload), status: 0 });
}

function manualTicker() {
  const handles = [];
  return {
    handles,
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
  };
}

// productionLikeWorkerTransport() — mirrors worker-stream-client.mjs's
// createWorkerWsTransport SHAPE (connect/send/close/onDrop/onMessage) as an
// in-memory fake, so startLauncher's REAL worker-branch wiring (createWorkerStreamClient,
// unmodified) runs over it exactly as it would over a real socket.
function productionLikeWorkerTransport() {
  const frames = [];
  let connectCalls = 0;
  let messageHandler = null;
  let dropHandler = null;
  return {
    frames,
    get connectCalls() { return connectCalls; },
    async connect() { connectCalls += 1; return { id: connectCalls }; },
    async send(_handle, frame) { frames.push(frame); },
    close() {},
    onDrop(handler) { dropHandler = typeof handler === "function" ? handler : null; },
    onMessage(handler) { messageHandler = typeof handler === "function" ? handler : null; },
    deliver(frame) { messageHandler?.(typeof frame === "string" ? frame : JSON.stringify(frame)); },
  };
}

async function withProductionWiringFixture(fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-clone-prodwiring-"));
  try {
    const root = path.join(tmp, "repo");
    const workDir = path.join(root, "wiki", "work");
    const milestoneDir = path.join(workDir, "38_milestone_clonedemo");
    const storyDir = path.join(milestoneDir, "stories", "00_story_clonedemo-00");
    await mkdir(storyDir, { recursive: true });
    await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 38\nslug: clonedemo\nstatus: in-progress\ntitle: Demo\n---\n", "utf8");
    await writeFile(path.join(storyDir, "STORY.md"), "---\ntype: story\nnumber: 00\nslug: clonedemo-00\nparent: 38\nstatus: not-started\ntitle: Demo story\n---\n", "utf8");
    const itemRef = "38/00";
    await mkdir(path.join(root, ".aof"), { recursive: true });
    const config = {
      name: "demo",
      work: { dir: "./wiki/work" },
      mesh: {
        nodeId: PROD_WORKER_ID,
        fabric: "tailscale",
        relay: { controlNode: PROD_CONTROL_ID, url: "ws://control-node.test:4182/ws/relay" },
        repo: { cloneUrl: CLONE_URL },
      },
    };
    await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    // review fix (live soak, 2026-07-18) — an ISOLATED AOF_GLOBAL_HOME is not
    // optional here: loadWorkspace/publishNodeRecord/startLauncher all touch
    // real global state without one. Found while mirroring this fixture for
    // mesh-worker-clone-url-pull.test.mjs and having the SAME gap correctly
    // caught before it ran — this file had been shipping with it unnoticed.
    const env = { ...process.env, AOF_GLOBAL_HOME: path.join(tmp, ".global-aof") };
    const ws = await loadWorkspace(root, undefined, { env });
    await publishNodeRecord(ws, PROD_WORKER_ID, { nodeId: PROD_WORKER_ID, host: PROD_WORKER_ID, os: "linux", runtimes: [], skills: [], aofVersion: "1.0.0", publishedAt: NOW });
    await publishNodeRecord(ws, PROD_CONTROL_ID, { nodeId: PROD_CONTROL_ID, host: PROD_CONTROL_ID, os: "linux", runtimes: [], skills: [], aofVersion: "1.0.0", publishedAt: NOW });
    return await fn({ tmp, root, ws, itemRef, env });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export const meshWorkerCloneCredentialPullTests = [
  // ------------------------------------------------------------------
  // Scenario: the worker requests a credential ONLY when it actually hits a clone miss
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: the worker already HAS the repo — it makes NO clone-credential request, and no secret crosses the wire for that directive",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const reloadedWs = await markRepoAlreadyPresent({ workspace, workspaceId, env });
      let resolverCalls = 0;
      const status = createStatusRecorder();
      const worktree = delegatingWorktreeExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(reloadedWs),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneCredential: async () => {
          resolverCalls += 1;
          return "must-never-be-used";
        },
        exec: worktree.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });
      await handler({ assignmentId: "asg-05-hasrepo", itemRef, workspaceId });
      assert.equal(resolverCalls, 0, "the credential resolver is never invoked when the worker already has the repo — per-clone by construction");
      assert.ok(status.frames.some((f) => f.state === "accepted"), "the directive still proceeds normally");
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: on a clone miss the worker pulls a credential and clones with it
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: on a clone miss the worker sends ONE clone-credential-request naming assignmentId+workspaceId, control replies with the credential, and the worker clones with it through GIT_ASKPASS (never --config, never a token in the URL); the credential rides a per-invocation env on the CLONE exec ONLY",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-05-pull";
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId, itemRef, workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });

      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      const serverSocket = channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW });

      let emittedByAskpass = null;
      const cloneExec = createRecordingCloneExec(async (args, opts) => {
        assert.ok(!args.some((a) => typeof a === "string" && a.includes("--config")), "no --config http.extraHeader argument");
        if (opts?.env?.GIT_ASKPASS) {
          emittedByAskpass = (await invokeAskpassShim(opts.env.GIT_ASKPASS)).trim();
        }
        return { status: 0, stdout: "", stderr: "" };
      });

      const status = createStatusRecorder();
      const worktree = delegatingWorktreeExec();
      let agentChildEnv = null;
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneCredential: (request) => client.requestCloneCredential(request),
        cloneExec: cloneExec.exec,
        exec: worktree.exec,
        // Mirrors task 03's own "does the agent child inherit it" observation point:
        // scriptedSpawnRuntime never spawns a real child, so ambient process.env at
        // this observation point is the sanctioned proxy for what a REAL agent child
        // (full env inheritance) would see.
        spawnRuntime: async () => {
          agentChildEnv = { ...process.env };
          return { outcome: "done" };
        },
        globalWorkStoreOptions: { env },
      });

      const beforeKeys = new Set(Object.keys(process.env));
      const handlerPromise = handler({ assignmentId, itemRef, workspaceId });

      const { upFrame, downFrame } = await withStore({ env }, (store) => driveCloneCredentialReply({
        transport,
        targets: channel.targets,
        store,
        requesterNodeId: "worker-a",
        mintCloneCredential: async () => "PULLED-TOKEN-xyz789",
      }));

      assert.equal(upFrame.kind, "clone-credential-request");
      assert.equal(upFrame.assignmentId, assignmentId, "the up-frame names the assignmentId");
      assert.equal(upFrame.workspaceId, workspaceId, "the up-frame names the workspaceId");
      assert.equal(downFrame.kind, "clone-credential");
      assert.equal(downFrame.credential, "PULLED-TOKEN-xyz789");

      await handlerPromise;
      const afterKeys = new Set(Object.keys(process.env));

      // Exactly ONE clone-credential-request was ever sent (never re-requested).
      assert.equal(transport.frames.filter((f) => f.kind === "clone-credential-request").length, 1);
      assert.equal(cloneExec.calls.length, 1);
      assert.ok(cloneExec.calls[0].env?.GIT_ASKPASS, "the clone exec's env carries a GIT_ASKPASS pointer");
      assert.equal(emittedByAskpass, "PULLED-TOKEN-xyz789", "invoking the askpass shim the clone exec's env points at emits the PULLED credential");
      assert.ok(!cloneExec.calls[0].args.some((a) => typeof a === "string" && a.includes("PULLED-TOKEN")), "the credential never rides the clone argv/URL");
      assert.ok(status.frames.some((f) => f.state === "done"), "the assignment reaches done");

      // SECURITY T1/T2/T3, re-armed on the PULLED path: the credential never touches
      // ambient process.env (so the agent child — full env inheritance — can never
      // read it), and it appears in NO OTHER streamed frame — the clone-credential
      // frame is its own dedicated, designed carrier; nothing else ever repeats it.
      assert.deepEqual([...afterKeys].sort(), [...beforeKeys].sort(), "no key was added to process.env");
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes("PULLED-TOKEN-xyz789")), "absent from process.env after the clone");
      assert.ok(agentChildEnv && !Object.values(agentChildEnv).some((v) => typeof v === "string" && v.includes("PULLED-TOKEN-xyz789")), "absent from the agent child's inherited env");
      const otherFrames = transport.frames.filter((f) => f.kind !== "clone-credential-request");
      assert.ok(!JSON.stringify(otherFrames).includes("PULLED-TOKEN-xyz789"), "no OTHER streamed frame (assignment-status, snapshot, delta, presence, directive) ever carries the credential value");
      assert.ok(!JSON.stringify(status.frames).includes("PULLED-TOKEN-xyz789"), "no streamed assignment-status frame carries the credential value");
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: the PRODUCTION wiring supplies the resolver — the F12 guard
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: the PRODUCTION wiring supplies the resolver — startLauncher, constructed exactly as `aof mesh serve --serve` does with NO credential-shaped test injection, genuinely attempts a clone-credential pull on a clone miss (the F12 guard, behavioural — a test that injects the collaborator it verifies proves nothing)",
    run: async () => withProductionWiringFixture(async ({ ws, itemRef, env }) => {
      const exec = fixturedFabricExec({
        BackendState: "Running",
        Self: { HostName: PROD_WORKER_ID, DNSName: `${PROD_WORKER_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
        Peer: { a: { HostName: PROD_CONTROL_ID, DNSName: `${PROD_CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true } },
      });
      const transport = productionLikeWorkerTransport();
      const handle = await startLauncher(ws, {
        exec,
        platform: "linux",
        ticker: manualTicker(),
        peerPollTicker: manualTicker(),
        createWorkerWsTransport: () => transport,
        // review fix (live soak, 2026-07-18) — the SAME isolated env every internal
        // store-open this launcher makes must use, never the real machine's.
        globalWorkStoreOptions: { env },
        // DELIBERATELY NO workerExecutionOptions / createMeshWorkerExecutionHandler /
        // workerExecutionLoadWs override — this is production's OWN wiring, exactly
        // as `aof mesh serve --serve` builds it. A short transport-level bound
        // (NOT a credential collaborator) keeps this test from waiting the full
        // production default — it never supplies the resolver itself.
        workerStreamClientOptions: { cloneCredentialTimeoutMs: 40 },
      });
      try {
        assert.equal(handle.role, "worker");
        transport.deliver({ kind: "directive", to: PROD_WORKER_ID, assignmentId: "asg-05-prodwire", itemRef, workspaceId: workspaceIdFor(ws.projectRoot), at: NOW });
        const request = await waitForFrame(transport, (f) => f.kind === "clone-credential-request");
        assert.ok(request != null, "the production-wired handler genuinely attempted to pull a credential on the clone miss — the resolver reaches a real, working transport, not merely a present-but-inert value");
        assert.equal(request.assignmentId, "asg-05-prodwire");
        // Let the (unanswered) request's short bounded wait settle before stopping,
        // so nothing is left pending.
        await new Promise((resolve) => setTimeout(resolve, 80));
      } finally {
        handle.stop();
      }
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: control authorizes the request before minting — only the holder may ask
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: control authorizes the request before minting — a non-holder's request is refused, mints nothing, and the refusal is loud and coded, never a silent empty reply",
    run: async () => withMeshCloneFixture(async ({ env, workspaceId }) => {
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId: "asg-05-notholder", itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      const channel = createDirectiveChannelFixture();
      const socket = channel.connectWorker("worker-b");
      let minted = 0;
      await withStore({ env }, async (store) => {
        const frame = { kind: "clone-credential-request", nodeId: "worker-b", assignmentId: "asg-05-notholder", workspaceId, at: NOW };
        const result = await applyCloneCredentialRequestFrame(store, frame, {
          nodeId: "worker-b", // the CONNECTION's authenticated identity — genuinely NOT the holder
          directiveTargets: channel.targets,
          mintCloneCredential: async () => { minted += 1; return "SHOULD-NEVER-MINT"; },
          now: NOW,
        });
        assert.equal(result.applied, false, "the request is refused, not applied");
        assert.equal(result.code, CLONE_CREDENTIAL_NOT_HOLDER);
      });
      assert.equal(minted, 0, "mints nothing for a non-holder request");
      assert.equal(socket.frames.length, 1, "a coded reply IS sent — never a silent drop");
      const reply = socket.frames[0];
      assert.equal(reply.kind, "clone-credential");
      assert.equal(reply.credential, null, "no credential is handed back");
      assert.equal(reply.code, CLONE_CREDENTIAL_NOT_HOLDER, "the refusal is CODED, not a silent empty reply");
    }),
  },

  // ------------------------------------------------------------------
  // SECURITY finding F15 (High) — the mint is scoped to the ASSIGNMENT ROW's own
  // workspace_id, never the requester-supplied frame.workspaceId (privilege
  // escalation guard). Driven directly against the REAL applyCloneCredentialRequestFrame
  // with a store whose row workspace_id disagrees with the request — security's own probe.
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull (SECURITY F15): a holder naming a DIFFERENT workspaceId than its assignment's own row is refused clone-credential-workspace-mismatch — the mint is NEVER called, and control never substitutes the row's real workspaceId silently",
    run: async () => withMeshCloneFixture(async ({ env, workspaceId }) => {
      const attackerChosenWorkspaceId = "ws-SOMEONE-ELSES-REPO";
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        // "worker-a" genuinely holds asg-f15, but for the REAL workspaceId below.
        assignmentId: "asg-f15", itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      const channel = createDirectiveChannelFixture();
      const socket = channel.connectWorker("worker-a");
      let mintedFor = null;
      await withStore({ env }, async (store) => {
        // The requester NAMES a different workspaceId than the row it actually holds —
        // exactly the F15 attack shape (a holder of ANY assignment picks an arbitrary repo).
        const frame = { kind: "clone-credential-request", nodeId: "worker-a", assignmentId: "asg-f15", workspaceId: attackerChosenWorkspaceId, at: NOW };
        const result = await applyCloneCredentialRequestFrame(store, frame, {
          nodeId: "worker-a", // the genuine holder — the T6 holder check alone would PASS
          directiveTargets: channel.targets,
          mintCloneCredential: async (ws) => { mintedFor = ws; return "SHOULD-NEVER-MINT"; },
          now: NOW,
        });
        assert.equal(result.applied, false, "the request is refused, not applied, despite holding the assignment");
        assert.equal(result.code, CLONE_CREDENTIAL_WORKSPACE_MISMATCH);
      });
      assert.equal(mintedFor, null, "the mint seam is NEVER invoked on a workspace mismatch — not for the attacker's workspaceId, not for the row's real one either");
      assert.equal(socket.frames.length, 1, "a coded reply IS sent — never a silent drop");
      const reply = socket.frames[0];
      assert.equal(reply.credential, null, "no credential is handed back");
      assert.equal(reply.code, CLONE_CREDENTIAL_WORKSPACE_MISMATCH, "the refusal is CODED, not a silent substitution of the row's real workspaceId");
    }),
  },
  {
    name: "task05/38 clone-credential-pull (SECURITY F15): a request naming the assignment's OWN correct workspaceId is authorized — the mint is called with the ROW's workspace_id (never re-derived from the frame)",
    run: async () => withMeshCloneFixture(async ({ env, workspaceId }) => {
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId: "asg-f15-ok", itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      let mintedFor = null;
      await withStore({ env }, async (store) => {
        const frame = { kind: "clone-credential-request", nodeId: "worker-a", assignmentId: "asg-f15-ok", workspaceId, at: NOW };
        const result = await applyCloneCredentialRequestFrame(store, frame, {
          nodeId: "worker-a",
          directiveTargets: channel.targets,
          mintCloneCredential: async (ws) => { mintedFor = ws; return "REAL-TOKEN"; },
          now: NOW,
        });
        assert.equal(result.applied, true);
      });
      assert.equal(mintedFor, workspaceId, "the mint is scoped to the assignment row's own workspace_id");
    }),
  },

  // ------------------------------------------------------------------
  // SECURITY finding F16 (Medium) — a terminal/inactive assignment mints NOTHING, ever.
  // Scenario Outline over every terminal state assignment-record.mjs's own enum names —
  // never a second, drifting hand-written state list.
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull (SECURITY F16): Examples — a terminal assignment (done/failed/withdrawn/reclaimed) is refused clone-credential-assignment-inactive; the mint is NEVER called",
    run: async () => {
      for (const state of TERMINAL_ASSIGNMENT_STATES) {
        await withMeshCloneFixture(async ({ env, workspaceId }) => {
          await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
            assignmentId: `asg-f16-${state}`, itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state, assignedAt: NOW,
          });
          const channel = createDirectiveChannelFixture();
          const socket = channel.connectWorker("worker-a");
          let minted = 0;
          await withStore({ env }, async (store) => {
            const frame = { kind: "clone-credential-request", nodeId: "worker-a", assignmentId: `asg-f16-${state}`, workspaceId, at: NOW };
            const result = await applyCloneCredentialRequestFrame(store, frame, {
              nodeId: "worker-a", // still the genuine holder — the T6 check alone would PASS
              directiveTargets: channel.targets,
              mintCloneCredential: async () => { minted += 1; return "SHOULD-NEVER-MINT"; },
              now: NOW,
            });
            assert.equal(result.applied, false, `[${state}] a terminal assignment's request is refused`);
            assert.equal(result.code, CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE, `[${state}] the coded refusal names inactivity`);
          });
          assert.equal(minted, 0, `[${state}] the mint seam is never invoked for a terminal assignment`);
          const reply = socket.frames.at(-1);
          assert.equal(reply.credential, null, `[${state}] no credential is handed back`);
          assert.equal(reply.code, CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE, `[${state}] loud and coded, never a silent empty reply`);
        });
      }
    },
  },
  {
    name: "task05/38 clone-credential-pull (SECURITY F16): Examples — every ACTIVE state (assigned/accepted/running) is authorized to mint (the inactive gate refuses ONLY terminal states, not the whole active lifecycle)",
    run: async () => {
      const { ACTIVE_ASSIGNMENT_STATES } = await import("../src/assignment-record.mjs");
      for (const state of ACTIVE_ASSIGNMENT_STATES) {
        await withMeshCloneFixture(async ({ env, workspaceId }) => {
          await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
            assignmentId: `asg-f16-active-${state}`, itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state, assignedAt: NOW,
          });
          const channel = createDirectiveChannelFixture();
          channel.connectWorker("worker-a");
          let minted = 0;
          await withStore({ env }, async (store) => {
            const frame = { kind: "clone-credential-request", nodeId: "worker-a", assignmentId: `asg-f16-active-${state}`, workspaceId, at: NOW };
            const result = await applyCloneCredentialRequestFrame(store, frame, {
              nodeId: "worker-a",
              directiveTargets: channel.targets,
              mintCloneCredential: async () => { minted += 1; return "REAL-TOKEN"; },
              now: NOW,
            });
            assert.equal(result.applied, true, `[${state}] an active-state assignment is authorized to mint`);
          });
          assert.equal(minted, 1, `[${state}] the mint seam IS invoked for an active assignment`);
        });
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the frozen directive frame is untouched
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: buildDirectiveFrame still returns EXACTLY its frozen five keys; a credential handed to the directive builder reaches no frame, ever",
    run: async () => {
      const frame = buildDirectiveFrame("worker-a", {
        assignmentId: "asg-05-frame",
        itemRef: "38/00",
        workspaceId: "ws-05",
        at: NOW,
        cloneCredential: "smuggled-secret-should-never-land",
      });
      assert.deepEqual(Object.keys(frame), ["kind", "to", "assignmentId", "itemRef", "workspaceId", "at"]);
      assert.ok(!JSON.stringify(frame).includes("smuggled-secret"), "no credential value reaches the directive frame");
    },
  },

  // ------------------------------------------------------------------
  // Scenario Outline: a credential that cannot be obtained fails LOUDLY
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: Examples — the request is refused by control -> loud coded assignment-repo-unavailable, no partial checkout left behind",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-05-refused";
      // Deliberately NO seeded assignment row -> applyCloneCredentialRequestFrame
      // refuses (unknown assignment), exactly like the not-holder path — a loud,
      // coded reply, never silence.
      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneCredentialTimeoutMs: 2000 });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneCredential: (request) => client.requestCloneCredential(request),
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
      });

      const handlerPromise = handler({ assignmentId, itemRef, workspaceId });
      await withStore({ env }, (store) => driveCloneCredentialReply({
        transport,
        targets: channel.targets,
        store,
        requesterNodeId: "worker-a",
        mintCloneCredential: async () => "SHOULD-NEVER-MINT",
      }));
      await handlerPromise;

      assert.equal(cloneExec.calls.length, 0, "no clone exec call was ever attempted");
      const finalFrame = status.frames.at(-1);
      assert.equal(finalFrame.state, "failed");
      assert.equal(finalFrame.code, "assignment-repo-unavailable");
      assert.equal(await pathExists(meshCheckoutPath(workspaceId, { env })), false, "no partial checkout is left behind");
    }, { cloneUrl: CLONE_URL }),
  },
  {
    name: "task05/38 clone-credential-pull: Examples — the request times out with no reply -> loud coded assignment-repo-unavailable, no partial checkout left behind, never a hang",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-05-timeout";
      const transport = createFakeWorkerTransport(); // nothing ever delivers a reply
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneCredentialTimeoutMs: 30 });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneCredential: (request) => client.requestCloneCredential(request),
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
      });

      await handler({ assignmentId, itemRef, workspaceId });

      assert.equal(cloneExec.calls.length, 0, "no clone exec call was ever attempted");
      const finalFrame = status.frames.at(-1);
      assert.equal(finalFrame.state, "failed");
      assert.equal(finalFrame.code, "assignment-repo-unavailable");
      assert.equal(await pathExists(meshCheckoutPath(workspaceId, { env })), false, "no partial checkout is left behind");
    }, { cloneUrl: CLONE_URL }),
  },
  {
    name: "task05/38 clone-credential-pull: Examples — the reply carries a blank/absent credential -> loud coded assignment-repo-unavailable, no partial checkout left behind (a malformed reply is never treated as a silent public clone)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-05-blank";
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneCredentialTimeoutMs: 2000 });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneCredential: (request) => client.requestCloneCredential(request),
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
      });

      const handlerPromise = handler({ assignmentId, itemRef, workspaceId });
      const upFrame = await waitForFrame(transport, (f) => f.kind === "clone-credential-request");
      assert.ok(upFrame != null, "a clone-credential-request frame was sent within the wait bound");
      // A MALFORMED down-frame — `credential` is a blank string, distinct from the
      // legitimate explicit `credential: null` "not needed" decision.
      transport.deliver({ kind: "clone-credential", to: "worker-a", assignmentId, credential: "", at: NOW });
      await handlerPromise;

      assert.equal(cloneExec.calls.length, 0, "no clone exec call was ever attempted");
      const finalFrame = status.frames.at(-1);
      assert.equal(finalFrame.state, "failed");
      assert.equal(finalFrame.code, "assignment-repo-unavailable");
      assert.equal(await pathExists(meshCheckoutPath(workspaceId, { env })), false, "no partial checkout is left behind");
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: a PUBLIC repo still clones with no credential and no request
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull: a PUBLIC/unauthenticated repo — no resolver wired -> no request is ever made, no GIT_ASKPASS is set, the clone proceeds exactly as it does today",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const cloneExec = createRecordingCloneExec();
      const checkoutPath = await cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        assignmentId: "asg-05-public",
        cloneUrl: CLONE_URL,
        now: NOW,
        options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } }, // no requestCloneCredential resolver supplied at all
      });
      assert.equal(cloneExec.calls.length, 1);
      // SECURITY T7 / F14 — GIT_TERMINAL_PROMPT=0 and the credential.helper reset
      // apply on EVERY scoped clone, public or not; only the ASKPASS pointer is
      // conditional on an actual credential.
      assert.equal(cloneExec.calls[0].env.GIT_ASKPASS, undefined, "no GIT_ASKPASS on a public/no-resolver clone");
      assert.equal(cloneExec.calls[0].env.GIT_TERMINAL_PROMPT, "0", "the interactive fallback is still disabled on the public path");
      assert.deepEqual(cloneExec.calls[0].args.slice(0, 2), ["-c", "credential.helper="], "the ambient credential.helper is reset even with no credential of our own");
      assert.ok(checkoutPath.endsWith(String(workspaceId)));
    }, { cloneUrl: CLONE_URL }),
  },
  {
    name: "task05/38 clone-credential-pull: control legitimately declines (no token configured for this workspace) -> an explicit `credential: null` reply is a WELL-FORMED success, not a failure — the clone proceeds with no GIT_ASKPASS",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-05-nulldecline";
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId, itemRef, workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const worktree = delegatingWorktreeExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneCredential: (request) => client.requestCloneCredential(request),
        cloneExec: cloneExec.exec,
        exec: worktree.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });

      const handlerPromise = handler({ assignmentId, itemRef, workspaceId });
      await withStore({ env }, (store) => driveCloneCredentialReply({
        transport,
        targets: channel.targets,
        store,
        requesterNodeId: "worker-a",
        mintCloneCredential: async () => null, // no token configured — a legitimate decision
      }));
      await handlerPromise;

      assert.equal(cloneExec.calls.length, 1);
      assert.equal(cloneExec.calls[0].env.GIT_ASKPASS, undefined, "no GIT_ASKPASS set for a legitimately-declined credential");
      assert.equal(cloneExec.calls[0].env.GIT_TERMINAL_PROMPT, "0", "the interactive fallback is still disabled");
      assert.ok(status.frames.some((f) => f.state === "done"), "the clone succeeds — a declined credential is not a failure");
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // SECURITY finding F14 (High) — GIT_ASKPASS alone is not authoritative: a configured
  // ambient credential.helper WINS over it and can (a) silently bypass the relay-minted
  // scoped token in favour of the operator's broad keychain PAT, and (b) persist that
  // token into the OS keychain on success. Every scoped clone must reset the helper
  // chain (`-c credential.helper=`) and disable the interactive fallback
  // (`GIT_TERMINAL_PROMPT=0`) — on BOTH the credentialled and the public/no-credential
  // path (T7).
  // ------------------------------------------------------------------
  {
    name: "task05/38 clone-credential-pull (SECURITY F14): the scoped clone argv leads with `-c credential.helper=` and the env sets GIT_TERMINAL_PROMPT=0 — on the CREDENTIALLED path",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const cloneExec = createRecordingCloneExec();
      await cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        assignmentId: "asg-f14-credentialled",
        cloneUrl: CLONE_URL,
        now: NOW,
        options: { cloneExec: cloneExec.exec, requestCloneCredential: async () => "F14-TOKEN", globalWorkStoreOptions: { env } },
      });
      assert.equal(cloneExec.calls.length, 1);
      const call = cloneExec.calls[0];
      assert.deepEqual(call.args.slice(0, 2), ["-c", "credential.helper="], "the ambient credential.helper chain is reset BEFORE the clone subcommand");
      assert.equal(call.args[2], "clone", "the reset flags precede, never replace, the clone subcommand");
      assert.equal(call.env.GIT_TERMINAL_PROMPT, "0", "the interactive fallback is disabled — a missing/rejected credential fails loudly, never hangs on a prompt");
      assert.ok(call.env.GIT_ASKPASS, "the credentialled path still carries the GIT_ASKPASS pointer");
    }, { cloneUrl: CLONE_URL }),
  },
  {
    name: "task05/38 clone-credential-pull (SECURITY F14): the scoped clone argv leads with `-c credential.helper=` and the env sets GIT_TERMINAL_PROMPT=0 — on the PUBLIC / no-credential path too (a private repo can never be silently rescued by the machine's own keychain)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const cloneExec = createRecordingCloneExec();
      await cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        assignmentId: "asg-f14-public",
        cloneUrl: CLONE_URL,
        now: NOW,
        options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } }, // no resolver at all
      });
      assert.equal(cloneExec.calls.length, 1);
      const call = cloneExec.calls[0];
      assert.deepEqual(call.args.slice(0, 2), ["-c", "credential.helper="], "the ambient credential.helper chain is reset even with no credential of our own");
      assert.equal(call.env.GIT_TERMINAL_PROMPT, "0", "the interactive fallback is disabled on the public path too");
      assert.equal(call.env.GIT_ASKPASS, undefined, "no askpass pointer when there is no credential to carry");
    }, { cloneUrl: CLONE_URL }),
  },

  // ------------------------------------------------------------------
  // Scenario: no credential is left at rest anywhere (T1/T2/T3 re-armed on the PULLED path)
  // ------------------------------------------------------------------
  // (process.env / agent-child-env / other-streamed-frame coverage lives on the
  // "on a clone miss..." success scenario above, over the FULL handler bracket; this
  // scenario adds the REAL git .git/config inspection — a REAL local bare repo, a
  // REAL `git clone`, credential delivered over the PULLED wire mechanism — mirroring
  // task 03's own real-git precedent, driven directly against cloneRepoForWorkspace
  // (the layer that actually shells out to git) rather than through the handler's
  // config-resolved cloneUrl, so the clone target can be the real bare repo.)
  {
    name: "task05/38 clone-credential-pull: a REAL clone completed using a PULLED credential (over the real wire round-trip) leaves nothing in the checkout's .git/config — no url.<cred>@, no http.extraheader, no durable credential.helper store",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const assignmentId = "asg-05-atrest";
      const bareRoot = path.join(workspace.projectRoot, "..", "bare-atrest.git");
      const { spawnSyncHardened } = await import("./support/cli-spawn.mjs");
      const git = (args) => spawnSyncHardened("git", args, { cwd: workspace.projectRoot, encoding: "utf8", shell: process.platform === "win32" });
      git(["init", "--bare", "-q", bareRoot]);
      git(["push", bareRoot, "HEAD:refs/heads/main"]);

      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId, itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });

      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW });

      const clonePromise = cloneRepoForWorkspace(workspace, {
        workspaceId,
        nodeId: "worker-a",
        assignmentId,
        cloneUrl: bareRoot, // the REAL local bare repo — real git, real .git/config
        now: NOW,
        options: { requestCloneCredential: (request) => client.requestCloneCredential(request), globalWorkStoreOptions: { env } },
      });

      await withStore({ env }, (store) => driveCloneCredentialReply({
        transport,
        targets: channel.targets,
        store,
        requesterNodeId: "worker-a",
        mintCloneCredential: async () => "AT-REST-TOKEN-999",
      }));

      const checkoutPath = await clonePromise;
      const gitConfig = await readFile(path.join(checkoutPath, ".git", "config"), "utf8");
      assert.ok(!gitConfig.includes("AT-REST-TOKEN-999"), "the literal credential value appears nowhere in .git/config");
      assert.ok(!/url\s*=.*AT-REST-TOKEN/i.test(gitConfig), "no url.<cred>@ rewrite");
      assert.ok(!/credential\.helper\s*=\s*store/i.test(gitConfig), "no durable credential.helper store");
      assert.ok(!/http\.extraheader/i.test(gitConfig), "no http.extraheader persisted");
      assert.ok(!Object.values(process.env).some((v) => typeof v === "string" && v.includes("AT-REST-TOKEN-999")), "absent from process.env after the clone");
    }, { cloneUrl: CLONE_URL }),
  },
];

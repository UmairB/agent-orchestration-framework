// test/mesh-worker-write-credential-pull.test.mjs — traceability for milestone 38 /
// story 07 (durable-worker-pushback, ADR-015 decision 3 "mechanism"; SECURITY T15/T6).
// The write-credential PULL is the wire this story adds ALONGSIDE the ADR-009
// clone-credential PULL (mirroring it exactly, over its OWN distinct frame kind) —
// REQUIRED so the pre-existing F12 guard (acd-clone-credential-pull-not-pushed)
// stays green once `requestWriteCredential` is a "credential"-shaped collaborator
// createMeshWorkerExecutionHandler consumes (the SAME class of defect F12 exists to
// catch generalizes to any newly-added credential-shaped option, not just the
// original clone one). Every scenario is driven against the REAL
// `createWorkerStreamClient` / `requestWriteCredential` (src/worker-stream-client.mjs)
// and the REAL control-side `applyWriteCredentialRequestFrame`
// (src/control-stream-server.mjs) — the SAME authorization gates
// applyCloneCredentialRequestFrame keeps (SECURITY T6: holder, workspace-match,
// active-state) — over the house bidirectional stream fixture
// (mesh-directive-channel-fixture.mjs). No real GitHub, no network.
import assert from "node:assert/strict";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import {
  applyWriteCredentialRequestFrame,
  WRITE_CREDENTIAL_NOT_HOLDER,
  WRITE_CREDENTIAL_WORKSPACE_MISMATCH,
  WRITE_CREDENTIAL_ASSIGNMENT_INACTIVE,
} from "../src/control-stream-server.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { createFakeWorkerTransport, createDirectiveChannelFixture } from "./support/mesh-directive-channel-fixture.mjs";
import { seedAssignment } from "./support/mesh-assign-fixture.mjs";

const NOW = "2026-07-18T09:00:00.000Z";

async function withStore(env, fn) {
  const store = await openGlobalWorkProjectionStore({ env, paths: globalMeshPaths({ env }) });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

async function waitForFrame(transport, predicate, { timeoutMs = 3000, pollMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = transport.frames.find(predicate);
    if (found != null) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// driveWriteCredentialReply(...) — drives the REAL control-side
// applyWriteCredentialRequestFrame against the up-frame the worker's fake transport
// just captured, then hands the resulting down-frame back to the worker's transport
// exactly as a real ws "message" event would (mirrors story-01's own
// driveCloneCredentialReply, verbatim shape).
async function driveWriteCredentialReply({ transport, targets, store, requesterNodeId, mintWriteCredential, now = NOW }) {
  const upFrame = await waitForFrame(transport, (f) => f.kind === "write-credential-request");
  assert.ok(upFrame != null, "a write-credential-request frame was sent within the wait bound");
  const applied = await applyWriteCredentialRequestFrame(store, upFrame, {
    nodeId: requesterNodeId,
    directiveTargets: targets,
    mintWriteCredential,
    now,
  });
  const socket = targets.get(requesterNodeId);
  const downFrame = socket?.frames?.at(-1) ?? null;
  if (downFrame != null) transport.deliver(downFrame);
  return { upFrame, downFrame, applied };
}

export const meshWorkerWriteCredentialPullTests = [
  // ------------------------------------------------------------------
  // Scenario: a genuine round-trip mint — control authorizes, mints, replies
  // ------------------------------------------------------------------
  {
    name: "write-credential-pull: the worker sends ONE write-credential-request naming assignmentId+workspaceId, control replies with the minted credential, and the worker's requestWriteCredential resolves it",
    run: async () => {
      const home = `${process.env.AOF_GLOBAL_HOME}-wc1`;
      const env = { AOF_GLOBAL_HOME: home };
      const workspaceId = "ws-wc-1";
      await seedAssignment({ home }, { assignmentId: "asg-wc-1", itemRef: "38/07", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });

      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, writeCredentialTimeoutMs: 2000 });
      await client.ensureConnected([]);

      let mintedFor = null;
      const requestPromise = client.requestWriteCredential({ assignmentId: "asg-wc-1", workspaceId });
      await withStore(env, (store) => driveWriteCredentialReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-a",
        mintWriteCredential: async (wsId, asgId) => { mintedFor = { wsId, asgId }; return "FAKE-WRITE-TOKEN"; },
      }));

      const token = await requestPromise;
      assert.equal(token, "FAKE-WRITE-TOKEN");
      assert.deepEqual(mintedFor, { wsId: workspaceId, asgId: "asg-wc-1" }, "the mint is called with the ROW's workspace_id, never re-derived from the frame");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: control legitimately declines (no write mint configured)
  // ------------------------------------------------------------------
  {
    name: "write-credential-pull: control legitimately declines (no write mint configured for this workspace) -> an explicit credential:null reply is a WELL-FORMED success, not a failure",
    run: async () => {
      const home = `${process.env.AOF_GLOBAL_HOME}-wc2`;
      const env = { AOF_GLOBAL_HOME: home };
      const workspaceId = "ws-wc-2";
      await seedAssignment({ home }, { assignmentId: "asg-wc-2", itemRef: "38/07", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });

      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, writeCredentialTimeoutMs: 2000 });
      await client.ensureConnected([]);

      const requestPromise = client.requestWriteCredential({ assignmentId: "asg-wc-2", workspaceId });
      // No mintWriteCredential supplied — the applyWriteCredentialRequestFrame default
      // (defaultMintWriteCredential) is exercised, resolving null.
      await withStore(env, (store) => driveWriteCredentialReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-a",
      }));

      const token = await requestPromise;
      assert.equal(token, null, "an explicit credential:null reply resolves to null — a legitimate, well-formed success (unauthenticated push), never a rejection");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: a non-holder is refused — the mint is NEVER called
  // ------------------------------------------------------------------
  {
    name: "write-credential-pull (SECURITY T6): a non-holder's request is refused write-credential-not-holder — the mint is NEVER called",
    run: async () => {
      const home = `${process.env.AOF_GLOBAL_HOME}-wc3`;
      const env = { AOF_GLOBAL_HOME: home };
      const workspaceId = "ws-wc-3";
      await seedAssignment({ home }, { assignmentId: "asg-wc-3", itemRef: "38/07", workspaceId, targetNodeId: "worker-OTHER", issuer: "control-a", state: "accepted", assignedAt: NOW });

      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-b");
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-b", workspaceId, now: () => NOW, writeCredentialTimeoutMs: 2000 });
      await client.ensureConnected([]);

      let minted = 0;
      const requestPromise = client.requestWriteCredential({ assignmentId: "asg-wc-3", workspaceId }).catch((error) => error);
      await withStore(env, (store) => driveWriteCredentialReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-b",
        mintWriteCredential: async () => { minted += 1; return "SHOULD-NEVER-MINT"; },
      }));

      const error = await requestPromise;
      assert.equal(error?.code, WRITE_CREDENTIAL_NOT_HOLDER);
      assert.equal(minted, 0, "the mint is NEVER called for a non-holder");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: a mismatched workspaceId is refused — F15 discipline extended to the write seam
  // ------------------------------------------------------------------
  {
    name: "write-credential-pull (SECURITY F15 discipline, extended): a request naming a DIFFERENT workspaceId than its assignment's own row is refused write-credential-workspace-mismatch — the mint is NEVER called",
    run: async () => {
      const home = `${process.env.AOF_GLOBAL_HOME}-wc4`;
      const env = { AOF_GLOBAL_HOME: home };
      const realWorkspaceId = "ws-wc-4-real";
      await seedAssignment({ home }, { assignmentId: "asg-wc-4", itemRef: "38/07", workspaceId: realWorkspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });

      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-wc-4-real", now: () => NOW, writeCredentialTimeoutMs: 2000 });
      await client.ensureConnected([]);

      let minted = 0;
      const requestPromise = client.requestWriteCredential({ assignmentId: "asg-wc-4", workspaceId: "ws-wc-4-SPOOFED" }).catch((error) => error);
      await withStore(env, (store) => driveWriteCredentialReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-a",
        mintWriteCredential: async () => { minted += 1; return "SHOULD-NEVER-MINT"; },
      }));

      const error = await requestPromise;
      assert.equal(error?.code, WRITE_CREDENTIAL_WORKSPACE_MISMATCH);
      assert.equal(minted, 0, "the mint is NEVER called on a workspace mismatch");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: a terminal assignment is refused — F16 discipline extended to the write seam
  // ------------------------------------------------------------------
  {
    name: "write-credential-pull (SECURITY F16 discipline, extended): a terminal assignment (done) is refused write-credential-assignment-inactive — the mint is NEVER called",
    run: async () => {
      const home = `${process.env.AOF_GLOBAL_HOME}-wc5`;
      const env = { AOF_GLOBAL_HOME: home };
      const workspaceId = "ws-wc-5";
      await seedAssignment({ home }, { assignmentId: "asg-wc-5", itemRef: "38/07", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "done", assignedAt: NOW });

      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, writeCredentialTimeoutMs: 2000 });
      await client.ensureConnected([]);

      let minted = 0;
      const requestPromise = client.requestWriteCredential({ assignmentId: "asg-wc-5", workspaceId }).catch((error) => error);
      await withStore(env, (store) => driveWriteCredentialReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-a",
        mintWriteCredential: async () => { minted += 1; return "SHOULD-NEVER-MINT"; },
      }));

      const error = await requestPromise;
      assert.equal(error?.code, WRITE_CREDENTIAL_ASSIGNMENT_INACTIVE);
      assert.equal(minted, 0, "the mint is NEVER called for a terminal assignment");
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the WRITE seam is wire-discriminable from the CLONE seam — distinct frame kinds
  // ------------------------------------------------------------------
  {
    name: "write-credential-pull: the write-credential-request/write-credential frame kinds are DISTINCT from clone-credential-request/clone-credential — the two seams never collide on the wire",
    run: async () => {
      const home = `${process.env.AOF_GLOBAL_HOME}-wc6`;
      const workspaceId = "ws-wc-6";
      await seedAssignment({ home }, { assignmentId: "asg-wc-6", itemRef: "38/07", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });

      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, writeCredentialTimeoutMs: 2000, cloneCredentialTimeoutMs: 2000 });
      await client.ensureConnected([]);

      // Fire both requests; only correlate on the DISTINCT frame kinds.
      client.requestWriteCredential({ assignmentId: "asg-wc-6", workspaceId }).catch(() => {});
      client.requestCloneCredential({ assignmentId: "asg-wc-6", workspaceId }).catch(() => {});

      const writeReq = await waitForFrame(transport, (f) => f.kind === "write-credential-request");
      const cloneReq = await waitForFrame(transport, (f) => f.kind === "clone-credential-request");
      assert.ok(writeReq != null && cloneReq != null, "both a write-credential-request and a clone-credential-request were sent");
      assert.notEqual(writeReq.kind, cloneReq.kind, "the two seams carry DISTINCT frame kinds");
    },
  },
];

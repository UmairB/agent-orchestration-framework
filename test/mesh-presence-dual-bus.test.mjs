// Traceability wiring for milestone 23 / story 02 — task 00
// (tasks/00_dual-bus-publish.feature). The node-side presence publish does TWO publishes
// in a structurally-frozen order: git UNCONDITIONALLY first (the durable floor), the relay
// BEST-EFFORT second (a relay-absent / connect-fail / push-fail caught, never thrown).
//
// Covers EVERY @executable scenario, exercising the REAL in-process registry
// (src/command-core.mjs + src/commands/mesh-heartbeat.mjs over src/mesh-presence.mjs +
// the m22 presence seam) against a temp fixture repo, with an INJECTED relay client
// (ctx.relayClient) stubbing the four relay states — NO real ws server. The injected stub
// is modelled on the manualTicker() style (a tiny in-test stub that records calls). One
// test object per @executable scenario / Outline row. node:assert/strict.
//
//   00_dual-bus-publish.feature — across every relay state (up / down-connect-fails /
//     unconfigured / push-throws) the DURABLE git record is written BYTE-IDENTICALLY and
//     the heartbeat result SUCCEEDS; on the happy path the relay IS pushed (best-effort ≠
//     skipped) with the frozen { kind:"presence", nodeId, signal } envelope; unconfigured
//     SKIPS the push (not attempted); a push that throws is CAUGHT and reported as a
//     non-fatal best-effort failure, the git write intact.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, presenceRecordPath } from "../src/mesh-store.mjs";
import { PRESENCE_SIGNAL_KIND } from "../src/mesh-relay-client.mjs";

const NODE_ID = "test-node-a";
const FIXED_INSTANT = "2026-06-30T10:00:00.000Z";

// A fixture repo whose config PINS mesh.nodeId (so the resolved id is stable + known).
// When `relayUrl` is set, config.mesh.relay.url is written so the production path would
// build a client — but every scenario INJECTS ctx.relayClient, so the stub is what runs;
// the url presence/absence models the "configured vs unconfigured" distinction.
async function makeRepo({ relayConfigured = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-dualbus-"));
  const workDir = path.join(repo, "wiki", "work");
  const milestoneDir = path.join(workDir, "23_milestone_control-node-relay");
  await mkdir(milestoneDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mesh = relayConfigured
    ? { nodeId: NODE_ID, relay: { controlNode: NODE_ID, url: "ws://127.0.0.1:7777/ws/relay" } }
    : { nodeId: NODE_ID };
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    `---\ntype: milestone\nnumber: 23\nslug: control-node-relay\nstatus: in-progress\ntitle: "Control Node Relay"\ncreated: 2026-06-30\nupdated: 2026-06-30\n---\n# 23\n`,
    "utf8"
  );
  return { repo, workDir, milestoneDir };
}

// An INJECTED relay-client stub (the manualTicker() style — a tiny in-test stub that
// records calls). The `state` selects the relay state:
//   - "up"           : connect resolves, push resolves → records the pushed envelope;
//   - "connect-fails": connect throws (the relay is configured but unreachable);
//   - "push-throws"  : connect resolves, push throws (a mid-send failure).
// "unconfigured" is modelled by injecting `null` (no client to push to) — see below.
function makeRelayStub(state) {
  const calls = { connects: 0, pushes: 0, pushed: [], closes: 0 };
  return {
    calls,
    client: {
      async connect() {
        calls.connects += 1;
        if (state === "connect-fails") throw new Error("relay connect refused (unreachable)");
        return { close() { calls.closes += 1; } };
      },
      async push(envelope) {
        calls.pushes += 1;
        if (state === "push-throws") throw new Error("relay push failed mid-send");
        calls.pushed.push(envelope);
      },
    },
  };
}

const ctxFor = async (repo, relayClient) => ({ workspace: await loadWorkspace(repo), relayClient });

// Compute the relay-UP baseline bytes: a heartbeat at the fixed instant with the relay up.
// Every other relay-state row must persist a byte-identical record.
async function relayUpBaseline() {
  const { repo } = await makeRepo({ relayConfigured: true });
  try {
    const stub = makeRelayStub("up");
    const ctx = await ctxFor(repo, stub.client);
    await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, ctx);
    return await readFile(presenceRecordPath(ctx.workspace, NODE_ID), "utf8");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

export const meshPresenceDualBusTests = [
  // ══ Scenario Outline: the git presence record is written byte-identically and the
  //    heartbeat succeeds for every relay state (up / down / unconfigured / push throws) ══
  {
    name: "mesh-presence-dual-bus/00 the git presence record is byte-identical and the heartbeat succeeds for every relay state",
    async run() {
      const baseline = await relayUpBaseline();
      // Each row pins the EXACT relay outcome the state must produce — so the "no relay
      // failure propagated to the heartbeat result" invariant is asserted as the genuine
      // success shape, not the weaker "an error implies attempted" tautology. `failing`
      // marks the rows where the relay actually failed (connect/push threw): the failure
      // must surface in result.relay (error set, attempted, not pushed) AND be CAUGHT —
      // the command still returns the success shape and never throws.
      const rows = [
        { state: "up", configured: true, attempted: true, pushed: true, failing: false },
        { state: "connect-fails", configured: true, attempted: true, pushed: false, failing: true },
        { state: "unconfigured", configured: false, attempted: false, pushed: false, failing: false },
        { state: "push-throws", configured: true, attempted: true, pushed: false, failing: true },
      ];
      for (const { state, configured, attempted, pushed, failing } of rows) {
        const { repo } = await makeRepo({ relayConfigured: configured });
        try {
          // unconfigured → inject null (no relay to push to); else inject the state stub.
          const relayClient = state === "unconfigured" ? null : makeRelayStub(state).client;
          const ctx = await ctxFor(repo, relayClient);
          // The command does NOT throw — a relay failure is CAUGHT on the publish path and
          // never propagates as a failed command (asserted explicitly for the failing rows).
          let result;
          await assert.doesNotReject(async () => {
            result = await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, ctx);
          }, `[${state}] the command returns success — a relay failure never propagated as a throw`);
          // The heartbeat result SUCCEEDS (a relay failure never reds it).
          assert.ok(result != null && typeof result.nodeId === "string", `[${state}] the heartbeat result is success (a record was returned)`);
          // The relay outcome is the EXACT expected shape for this state, and for the
          // failing rows the genuine invariant holds: error set, attempted, not pushed —
          // the failure stayed in result.relay and the command still succeeded.
          assert.equal(result.relay.attempted, attempted, `[${state}] result.relay.attempted is ${attempted}`);
          assert.equal(result.relay.pushed, pushed, `[${state}] result.relay.pushed is ${pushed}`);
          if (failing) {
            assert.ok(result.relay.error != null, `[${state}] the relay failure surfaced in result.relay.error (caught, not thrown)`);
            assert.equal(result.relay.attempted, true, `[${state}] the failing relay push was attempted`);
            assert.equal(result.relay.pushed, false, `[${state}] the failing relay push did not deliver`);
          } else {
            assert.equal(result.relay.error, null, `[${state}] a non-failing relay state carries no error`);
          }
          // A presence record for this node's id is persisted under the presence seam.
          const onDiskPath = presenceRecordPath(ctx.workspace, NODE_ID);
          assert.ok(onDiskPath.startsWith(meshDir(ctx.workspace)), `[${state}] persisted under the partition root's presence seam`);
          const onDisk = await readFile(onDiskPath, "utf8");
          // The persisted git record is BYTE-IDENTICAL to the relay-up baseline (the
          // durable write does not depend on relay state).
          assert.equal(onDisk, baseline, `[${state}] the persisted git presence record is byte-identical to the relay-up baseline`);
          // No relay failure propagated to the heartbeat result (the command did not throw).
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: when the relay is up the presence signal is pushed (best-effort ≠ skipped) ══
  {
    name: "mesh-presence-dual-bus/00 when the relay is up the presence signal is pushed over the relay (best-effort is not skipped)",
    async run() {
      const { repo } = await makeRepo({ relayConfigured: true });
      try {
        const stub = makeRelayStub("up");
        const ctx = await ctxFor(repo, stub.client);
        const result = await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, ctx);
        // Exactly one presence signal was pushed over the relay client.
        assert.equal(stub.calls.pushes, 1, "exactly one presence signal was pushed over the relay client");
        assert.equal(stub.calls.pushed.length, 1, "exactly one envelope was recorded as pushed");
        const env = stub.calls.pushed[0];
        // The pushed envelope carries kind "presence" and this node's nodeId.
        assert.equal(env.kind, PRESENCE_SIGNAL_KIND, "the pushed envelope carries kind 'presence'");
        assert.equal(env.kind, "presence", "the kind literal is 'presence'");
        assert.equal(env.nodeId, NODE_ID, "the pushed envelope carries this node's nodeId");
        // The pushed envelope's opaque signal carries this node's presence record.
        assert.equal(env.signal.nodeId, NODE_ID, "the opaque signal carries this node's presence record (nodeId)");
        assert.equal(env.signal.heartbeatAt, FIXED_INSTANT, "the opaque signal carries the presence record's heartbeatAt");
        assert.deepEqual(Object.keys(env.signal), ["nodeId", "heartbeatAt", "activeRuns", "aofVersion"], "the opaque signal is the frozen-schema presence record");
        // The heartbeat result is success and the relay outcome reports the push.
        assert.equal(result.relay.pushed, true, "the result reports the relay push happened");
        assert.equal(result.relay.error, null, "the relay-up push reports no error");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: with no relay configured the relay push is skipped and the git write lands ══
  {
    name: "mesh-presence-dual-bus/00 with no relay configured the relay push is skipped and the git write still lands",
    async run() {
      const baseline = await relayUpBaseline();
      const { repo } = await makeRepo({ relayConfigured: false });
      try {
        // unconfigured → inject null: there is no relay to push to.
        const ctx = await ctxFor(repo, null);
        const result = await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, ctx);
        // No presence signal push was attempted over the relay (skip ≠ attempt-then-catch).
        assert.equal(result.relay.attempted, false, "no presence signal push was attempted over the relay (it was skipped)");
        assert.equal(result.relay.pushed, false, "nothing was pushed");
        assert.equal(result.relay.error, null, "a skip is not an error");
        // A presence record for this node's id is persisted under the presence seam.
        const onDisk = await readFile(presenceRecordPath(ctx.workspace, NODE_ID), "utf8");
        // The persisted git record is byte-identical to the relay-up baseline.
        assert.equal(onDisk, baseline, "the persisted git presence record is byte-identical to the relay-up baseline");
        // The heartbeat result is success.
        assert.ok(result.nodeId === NODE_ID, "the heartbeat result is success");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a relay push that throws is caught and never fails the heartbeat ══
  {
    name: "mesh-presence-dual-bus/00 a relay push that throws is caught and never fails the heartbeat, and the git write is intact",
    async run() {
      const baseline = await relayUpBaseline();
      const { repo } = await makeRepo({ relayConfigured: true });
      try {
        const stub = makeRelayStub("push-throws");
        const ctx = await ctxFor(repo, stub.client);
        // The heartbeat does NOT throw (the push error was caught — the throw did not
        // propagate). assert.doesNotReject pins that explicitly.
        let result;
        await assert.doesNotReject(async () => {
          result = await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, ctx);
        }, "the relay push error was caught (the throw did not propagate)");
        // The push WAS attempted (connect resolved, push threw) and the error recorded.
        assert.equal(stub.calls.connects, 1, "the relay connect was attempted");
        assert.equal(stub.calls.pushes, 1, "the relay push was attempted (and threw)");
        assert.equal(result.relay.attempted, true, "the push was attempted");
        assert.equal(result.relay.pushed, false, "the push did not succeed");
        // The heartbeat result is success.
        assert.ok(result.nodeId === NODE_ID, "the heartbeat result is success");
        // A presence record is persisted, byte-identical to the relay-up baseline.
        const onDisk = await readFile(presenceRecordPath(ctx.workspace, NODE_ID), "utf8");
        assert.equal(onDisk, baseline, "the persisted git presence record is byte-identical to the relay-up baseline (data safe, liveness lost)");
        // The result reports the relay push as a non-fatal best-effort failure.
        assert.ok(typeof result.relay.error === "string" && result.relay.error.length > 0, "the result reports the relay push as a non-fatal best-effort failure (error message present)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

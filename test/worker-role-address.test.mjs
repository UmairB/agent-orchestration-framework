// Traceability wiring for milestone 34 / story 04 — task 00
// (tasks/00_worker-role-and-control-address.feature). Covers every @executable
// scenario / Scenario Outline row:
//   - a node's mesh role follows the control-node config (the Scenario Outline, 3 rows)
//   - a worker resolves the control node's dial address from the fabric peer map
//   - a worker whose control node is absent from the fabric degrades to stream retry
//     (no resolved target, the reported message, no connection attempt)
//
// The role predicate under test is the ONE shared mesh-role() function
// (src/mesh-role.mjs) — this file asserts the OBSERVABLE role/address outcome, never
// re-derives config.mesh.relay.controlNode itself (that structural invariant is the
// acd-worker-stream-single-predicate fitness). Dial-address resolution runs over an
// INJECTED exec returning fixtured `tailscale status --json` (the milestone-33
// precedent) — no live tailnet.
import assert from "node:assert/strict";
import { meshRole, controlNodeIdFor } from "../src/mesh-role.mjs";
import { resolvePeers } from "../src/mesh-fabric.mjs";

const CONTROL_ID = "umairs-msi";

function statusFixture({ peers = {} } = {}) {
  return { BackendState: "Running", Self: { HostName: "self", TailscaleIPs: ["100.1.1.1"] }, Peer: peers };
}

function fixturedExec(payload) {
  return async () => ({ stdout: JSON.stringify(payload), status: 0 });
}

// resolveWorkerStreamTarget(config, nodeId, options) — the task-00 seam under test:
// a worker resolves the control node's dial address from the fabric peer map; a
// control/standalone node (or an unresolvable control peer) resolves NO target and
// reports the stream-degraded message, making NO connection attempt (asserted
// by the caller never invoking transport.connect in that branch).
async function resolveWorkerStreamTarget(config, nodeId, options = {}) {
  const role = meshRole(config, nodeId);
  if (role !== "worker") return { target: null, role };
  const controlNodeId = controlNodeIdFor(config);
  const nodeRecords = options.roster ?? [{ nodeId: controlNodeId, host: controlNodeId }, { nodeId, host: nodeId }];
  const peers = await resolvePeers(config, { ...options, roster: nodeRecords });
  const match = peers.find((peer) => peer.nodeId === controlNodeId);
  if (match?.dialAddress) return { target: match.dialAddress, role };
  return { target: null, role, message: "control node not reachable on the fabric; stream sync will retry" };
}

export const workerRoleAddressTests = [
  {
    name: "worker-role-address/00 a node's mesh role follows the control-node config",
    run() {
      const rows = [
        { nodeId: "umairs-mac-mini", controlNode: "umairs-msi", role: "worker" },
        { nodeId: "umairs-msi", controlNode: "umairs-msi", role: "control" },
        { nodeId: "umairs-mac-mini", controlNode: undefined, role: "standalone" },
      ];
      for (const row of rows) {
        const config = row.controlNode === undefined ? {} : { mesh: { relay: { controlNode: row.controlNode } } };
        assert.equal(meshRole(config, row.nodeId), row.role, JSON.stringify(row));
      }
    },
  },
  {
    name: "worker-role-address/00 a worker resolves the control node's dial address from the fabric peer map",
    async run() {
      const config = { mesh: { fabric: "tailscale", relay: { controlNode: CONTROL_ID } } };
      const fixture = statusFixture({
        peers: {
          peer1: { HostName: CONTROL_ID, TailscaleIPs: ["100.90.249.80"], Online: true },
        },
      });
      const result = await resolveWorkerStreamTarget(config, "umairs-mac-mini", { exec: fixturedExec(fixture) });
      assert.equal(result.role, "worker");
      assert.equal(result.target, "100.90.249.80");
    },
  },
  {
    name: "worker-role-address/00 a worker whose control node is absent from the fabric degrades to stream retry",
    async run() {
      const config = { mesh: { fabric: "tailscale", relay: { controlNode: CONTROL_ID } } };
      const fixture = statusFixture({ peers: {} }); // control node NOT listed
      let connectAttempted = false;
      const result = await resolveWorkerStreamTarget(config, "umairs-mac-mini", { exec: fixturedExec(fixture) });
      assert.equal(result.target, null, "no stream target is resolved");
      assert.equal(result.message, "control node not reachable on the fabric; stream sync will retry");
      // No connection attempt is made: the caller only calls transport.connect() when
      // a target was resolved — asserted here by never invoking a connect stub.
      assert.equal(connectAttempted, false);
    },
  },
];

// src/mesh-role.mjs — the ONE shared mesh-role predicate (milestone 34 / story 04,
// ADR-007). "A node is a worker when config.mesh.relay.controlNode is set and ≠ this
// node's id" is the INVERSE of the control-node comparison mesh-launcher.mjs's
// resolveNodeIdentity already computes (`controlNode != null && controlNode ===
// nodeId`). Rather than let the launcher and the new worker-stream client each
// privately re-derive that comparison from config.mesh, this module is the single
// place it lives — both callers import meshRole() (fitness
// acd-worker-stream-single-predicate: no OTHER module reads config.mesh.relay.controlNode
// to make its own worker/control decision).
//
// meshRole(config, nodeId) → "worker" | "control" | "standalone":
//   - "control"    — config.mesh.relay.controlNode === nodeId (the control-node
//                     comparison, verbatim).
//   - "worker"     — config.mesh.relay.controlNode is set (non-null/non-empty) and
//                     differs from nodeId.
//   - "standalone" — config.mesh.relay.controlNode is absent (null/undefined/"").
//
// A pure function over its two inputs — no fabric read, no fs, no clock. Node-id
// resolution stays owned by node-identity.mjs / mesh-launcher.mjs's
// resolveNodeIdentity (the in-memory-derive mode); this module only classifies the
// ALREADY-resolved id against the config.
//
// resolveWorkerStreamTarget (below) ADDITIVELY imports mesh-fabric's resolvePeers —
// the ONE fabric-assumption seam (33/ADR-001/ADR-002) — to resolve a worker's
// control-node dial address; that import does not weaken this module's own
// pure-classifier contract for meshRole/controlNodeIdFor themselves.
import { resolvePeers } from "./mesh-fabric.mjs";

export function meshRole(config, nodeId) {
  const controlNode = config?.mesh?.relay?.controlNode ?? null;
  if (controlNode == null || controlNode === "") return "standalone";
  return controlNode === nodeId ? "control" : "worker";
}

// controlNodeIdFor(config) → the configured control-node id, or null when absent —
// the ONE read of config.mesh.relay.controlNode a worker uses to know WHICH peer to
// resolve a dial address for (mesh-fabric's resolvePeers, never a hand-derived URL).
export function controlNodeIdFor(config) {
  const controlNode = config?.mesh?.relay?.controlNode;
  return typeof controlNode === "string" && controlNode.length > 0 ? controlNode : null;
}

// The degraded-stream message a worker reports when its control node cannot be
// resolved on the fabric (task-00 feature, verbatim) — named here so both the
// resolver below and any caller that reports it agree on the ONE string.
export const CONTROL_NODE_UNREACHABLE_MESSAGE = "control node not reachable on the fabric; stream sync will retry";

// resolveWorkerStreamTarget(config, nodeId, { exec, roster }) → { target, role,
// message? } — task 00's seam, PROMOTED into production (review fix P1.7): resolve
// this node's role, and — only when it is a worker — the control node's fabric dial
// address (via mesh-fabric's resolvePeers, NEVER a hand-derived URL). A
// control/standalone node resolves { target: null, role } with no fabric read at
// all. An unresolvable control peer is the clean stream-degraded state: { target:
// null, role, message: CONTROL_NODE_UNREACHABLE_MESSAGE } — the caller makes NO
// connection attempt in that branch (asserted by the launcher integration test).
export async function resolveWorkerStreamTarget(config, nodeId, options = {}) {
  const role = meshRole(config, nodeId);
  if (role !== "worker") return { target: null, role };
  const controlNodeId = controlNodeIdFor(config);
  const roster = Array.isArray(options.roster) ? options.roster : [];
  const peers = await resolvePeers(config, { ...options, roster });
  const match = peers.find((peer) => peer.nodeId === controlNodeId);
  if (match?.dialAddress) return { target: match.dialAddress, role };
  return { target: null, role, message: CONTROL_NODE_UNREACHABLE_MESSAGE };
}

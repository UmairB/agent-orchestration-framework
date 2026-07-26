// src/commands/mesh-gate.mjs — the ONE config.mesh gate predicate the run-lifecycle
// commands share (m26 story 02; ADR-004/ADR-005/ADR-006 all hang their mesh branches
// off the SAME question): a mesh-configured install is one whose config carries a
// non-empty string mesh.nodeId. Every run-* command derives its `meshNodeId` gate
// variable from THIS helper, so the predicate can never drift between the claim path
// (run-start), the release path (run-complete), and the lineage path (run-retry).
// story 01's read faces (next.mjs / mesh-identity.mjs) carry the same semantics
// inline — aligned there at Contract, not re-homed here.

// meshNodeIdOf(config) → the configured node id (string), or null when mesh is
// unconfigured (absent / empty / non-string) — null drives the byte-identical
// single-node floor in every consumer.
export function meshNodeIdOf(config) {
  const nodeId = config?.mesh?.nodeId;
  return typeof nodeId === "string" && nodeId.length > 0 ? nodeId : null;
}

// mesh:revoke <node> — the enrollment authority's revocation act (milestone 24 /
// story 02 / ADR-004). A registered command-core command carrying the frozen
// { id, input, run, cli } contract (08/ADR-002), thin over story 00's registry seam:
//
//   1. GUARD — only the nominated control node revokes (the isControlNode /
//      relayMode predicate — revocation is an AUTHORITY decision). A non-control
//      invocation is a STRUCTURED refusal: no roster removal, no revocation append,
//      the registry file byte-unchanged.
//   2. REMOVE — the node is filtered out of the registry roster (composed on the
//      registry VALUE, add-only over every OTHER entry — the removal targets only
//      this nodeId; peers are carried by reference, byte-unchanged).
//   3. RECORD — an EXPLICIT-DENY revocation { nodeId, revokedAt, reason } is appended
//      via story 00's appendRevocation (add-only — a pre-existing revocation is
//      byte-unchanged). Removal + explicit deny land in ONE writeRegistry call (THE
//      single control-node-guarded write seam — acd-registry-write-scope). The deny is
//      what the relay auth-gate (task 00) honours on the revoked node's NEXT connect,
//      regardless of roster-sync lag (T6 revocation completeness).
// revokedAt is an INJECTED white-box input (the 22/R2 inject-the-clock discipline — the
// task feature drives the revocation instant over it); the live CLI face passes no flag
// for it, so production revokes against wall-clock.
import {
  isControlNode,
  readRegistry,
  writeRegistry,
  appendRevocation,
} from "../mesh-registry.mjs";
import { MESH_WORKSPACE_FLAG, guardMeshPositionals } from "./mesh-face-shared.mjs";

// A structured command error the mesh face renders as ONE { ok:false, error, code }
// envelope (the property is ASSIGNED, not an object-literal field).
function refusal(message, token) {
  const error = new Error(message);
  error.code = token;
  return error;
}



export const meshRevokeCommand = {
  id: "mesh:revoke",
  input: {
    type: "object",
    properties: {
      // The node to revoke (the CLI positional).
      node: { type: "string" },
      // The reason recorded on the revocation (optional; the CLI face passes none).
      reason: { type: "string" },
      // The injected revocation instant (ISO-8601) — a white-box test input, never a
      // CLI flag (22/R2). Absent ⇒ wall-clock.
      revokedAt: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const config = ws.config ?? {};

    const nodeId = typeof input?.node === "string" ? input.node.trim() : "";
    if (nodeId.length === 0) {
      throw refusal("mesh:revoke requires the nodeId to revoke — `aof mesh revoke <node>`.", "invalid-input");
    }

    // (1) The control-node guard — revocation is an AUTHORITY decision (the same
    // predicate relayMode/writeRegistry serve under). A non-control node refuses
    // cleanly BEFORE any read/mutate: no roster removal, no revocation append, the
    // registry byte-unchanged.
    if (!isControlNode(config)) {
      throw refusal(
        "mesh:revoke requires the control node — only the nominated enrollment authority (config.mesh.relay.controlNode === config.mesh.nodeId) can revoke a node.",
        "not-control-node"
      );
    }

    // The revocation instant: injected when supplied (deterministic), else wall-clock.
    // An unparseable injected instant is an input error, not a revoke.
    const revokedAt =
      typeof input?.revokedAt === "string" && input.revokedAt.length > 0
        ? input.revokedAt
        : new Date().toISOString();
    if (Number.isNaN(Date.parse(revokedAt))) {
      throw refusal(`mesh:revoke could not parse the injected revokedAt "${revokedAt}" as an instant.`, "invalid-input");
    }
    const reason = typeof input?.reason === "string" && input.reason.length > 0 ? input.reason : null;

    // (2)+(3) Read the live registry, REMOVE the node from the roster (targeted — every
    // other entry carried by reference, byte-unchanged), APPEND the explicit-deny
    // revocation (add-only — a pre-existing revocation byte-unchanged), and persist BOTH
    // in ONE atomic writeRegistry (story 00's single control-node-guarded write seam).
    const registry = await readRegistry(ws);
    const removed = {
      ...registry,
      roster: (registry.roster ?? []).filter((entry) => entry?.nodeId !== nodeId),
    };
    const next = appendRevocation(removed, { nodeId, revokedAt, reason });
    const persisted = await writeRegistry(ws, next, config);
    if (!persisted.written) {
      // Belt-and-braces: the seam re-checks the same predicate — a refused persist must
      // never report a revocation recorded nowhere.
      throw refusal("mesh:revoke could not persist the revocation (the registry seam refused a non-control write).", "not-control-node");
    }

    return { revoked: true, nodeId, revokedAt, reason };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; meshVerbCli's cli.mjs ladder branch is deleted.
    route: ["mesh", "revoke"],
    spec: {
      usage: "aof mesh revoke <node> [--workspace <path|id>] [--json]",
      flags: { ...MESH_WORKSPACE_FLAG },
    },

    // `aof mesh revoke <node>` — ONE positional: the nodeId to revoke. (revokedAt is a
    // white-box input, not a flag; production revokes against wall-clock.)
    argv: (positionals) => {
      guardMeshPositionals("revoke", positionals, { max: 1 });
      return { node: positionals[0] };
    },

    render(result) {
      return `Revoked ${result.nodeId} at ${result.revokedAt} — removed from the roster and recorded as revoked.`;
    },

    // The --json face reports the revoked nodeId + the recorded revokedAt.
    json: (result) => result,
  },
};

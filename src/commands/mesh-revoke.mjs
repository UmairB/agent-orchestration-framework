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
//   4. DE-PROVISION — git-remote access is removed on the control node's OWN clone via
//      the shell-less spawnSync("git", ["remote","remove",name]) argv idiom (13/ADR-002
//      / the inverse of ADR-003 move 3's provision — a shell string would word-split a
//      name on Windows; acd-enroll-git-argv-no-shell greps the argv form here). The
//      remote name is the <nodeId>-remote convention (injectable for white-box tests);
//      an absent remote is a tolerated no-op, never a throw, and no git verb touches a
//      foreign source tree (the read-only-source discipline — it edits THIS clone's
//      config only).
//
// revokedAt is an INJECTED white-box input (the 22/R2 inject-the-clock discipline — the
// task feature drives the revocation instant over it); the live CLI face passes no flag
// for it, so production revokes against wall-clock.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  isControlNode,
  readRegistry,
  writeRegistry,
  appendRevocation,
} from "../mesh-registry.mjs";

// A structured command error the mesh face renders as ONE { ok:false, error, code }
// envelope (the property is ASSIGNED, not an object-literal field).
function refusal(message, token) {
  const error = new Error(message);
  error.code = token;
  return error;
}

// The control node's OWN clone: walk up from the workspace's work stream to the
// containing git repo (the mesh-join findRepoRoot shape), falling back to a projectRoot
// that is itself a repo. Null ⇒ no repo to de-provision (a structured degraded outcome
// on the result, never a crash).
function findRepoRoot(workspace) {
  const start = workspace.workDir ?? workspace.projectRoot;
  let dir = start ? path.resolve(start) : null;
  while (dir) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const projectRoot = workspace.projectRoot ? path.resolve(workspace.projectRoot) : null;
  if (projectRoot && existsSync(path.join(projectRoot, ".git"))) return projectRoot;
  return null;
}

// De-provision the revoked node's git remote on the control node's OWN clone — the
// shell-less argv idiom ONLY (13/ADR-002: spawnSync("git", ["remote","remove",name]) with
// the name as ONE argv token, never a shell string a name could word-split on Windows).
// Tolerant: no repo / an absent remote are structured outcomes on the result, never
// throws — the only git verb used is the remote-configuration verb on THIS clone (remote
// remove), no write verb against any foreign source tree (the read-only-source discipline).
function deprovisionGitRemote(workspace, remoteName) {
  if (typeof remoteName !== "string" || remoteName.length === 0) {
    return { deprovisioned: false, reason: "no-remote-name" };
  }
  const repoRoot = findRepoRoot(workspace);
  if (repoRoot == null) {
    return { deprovisioned: false, reason: "no-git-repo", name: remoteName };
  }
  // Probe first (a read of THIS clone's config) — an absent remote is a tolerated no-op,
  // not a failure (the node may never have had a remote provisioned on this clone).
  const probe = spawnSync("git", ["remote", "get-url", remoteName], { cwd: repoRoot, encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    return { deprovisioned: false, reason: "no-such-remote", name: remoteName };
  }
  const removed = spawnSync("git", ["remote", "remove", remoteName], { cwd: repoRoot, encoding: "utf8" });
  if (removed.error || removed.status !== 0) {
    const detail = removed.error ? String(removed.error.message ?? removed.error) : (removed.stderr ?? "").trim();
    return { deprovisioned: false, reason: "git-remote-remove-failed", detail, name: remoteName };
  }
  return { deprovisioned: true, name: remoteName };
}

// The remote-name convention: the credential's git-remote grant is provisioned on the
// joining node under a fixed name; on the control node's own tracking clone the revoked
// node's remote follows the <nodeId>-remote convention. Injectable for white-box tests.
function remoteNameFor(nodeId, injected) {
  if (typeof injected === "string" && injected.length > 0) return injected;
  return `${nodeId}-remote`;
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
      // The git remote name to de-provision — a white-box override; absent ⇒ the
      // <nodeId>-remote convention.
      remoteName: { type: "string" },
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

    // (4) De-provision git-remote on the control node's OWN clone (argv-form git).
    const gitRemote = deprovisionGitRemote(ws, remoteNameFor(nodeId, input?.remoteName));

    return { revoked: true, nodeId, revokedAt, reason, gitRemote };
  },

  cli: {
    // `aof mesh revoke <node>` — ONE positional: the nodeId to revoke. (revokedAt is a
    // white-box input, not a flag; production revokes against wall-clock.)
    argv: (positionals) => ({ node: positionals[0] }),

    render(result) {
      const remoteLine = result.gitRemote?.deprovisioned
        ? `git remote "${result.gitRemote.name}" removed`
        : `no git remote de-provisioned (${result.gitRemote?.reason ?? "none"})`;
      return [
        `Revoked ${result.nodeId} at ${result.revokedAt} — removed from the roster and recorded as revoked.`,
        remoteLine,
      ].join("\n");
    },

    // The --json face reports the revoked nodeId + the recorded revokedAt + the
    // de-provision outcome.
    json: (result) => result,
  },
};

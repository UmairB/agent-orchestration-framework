// src/workspace-identity.mjs — THE workspace-identity home (m42 wave (b), TECH_DEBT
// item 4: "one identity rule, re-derived seventeen times, each with its own fallback").
//
// A workspace's mesh identity answered ONE question in fourteen different places,
// each spelling `config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot ?? workDir)`
// with its own null-handling. When two derivations disagreed across machines, the
// worker→control stream silently discarded 100% of its frames for days; when a CLI
// verb derived from the wrong cwd, a withdraw reported "no assignment" over a live
// row. This module is the single owner; every caller asks it.
//
// THE PRECEDENCE (one rule):
//   1. an explicit override the caller was HANDED (an assignment's workspaceId, a
//      store row's id) — identity that arrived as data outranks re-derivation;
//   2. the workspace's own pinned `config.mesh.workspaceId` (written at clone time
//      for scoped checkouts, or by an operator) — the durable cross-machine id;
//   3. the path derivation (sha256 of the lowercased absolute project root) — the
//      legacy per-machine fallback, correct only for single-machine workspaces.
// No caller spells a fallback of its own; a workspace with no anchor resolves null
// (the caller's absent case), never a fabricated id.
import { createHash } from "node:crypto";
import path from "node:path";

// workspaceIdFromPath(projectRoot) — the ONE derivation (formerly global-work-store's
// workspaceIdFor, re-exported there for compatibility; the bytes are identical).
export function workspaceIdFromPath(projectRoot) {
  const resolved = path.resolve(projectRoot ?? "");
  return createHash("sha256").update(resolved.toLowerCase()).digest("hex").slice(0, 16);
}

// resolveWorkspaceId(workspace, { override }) — the ONE precedence.
export function resolveWorkspaceId(workspace, { override } = {}) {
  if (typeof override === "string" && override.length > 0) return override;
  const pinned = workspace?.config?.mesh?.workspaceId;
  if (typeof pinned === "string" && pinned.length > 0) return pinned;
  const anchor = workspace?.projectRoot ?? workspace?.workDir;
  if (anchor == null || anchor === "") return null;
  return workspaceIdFromPath(anchor);
}

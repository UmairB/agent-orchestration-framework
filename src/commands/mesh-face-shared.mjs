// The mesh family's shared CLI-face vocabulary (m42 wave (d) leg d1, wave 3) —
// what meshVerbCli owned before the registered mesh verbs moved onto the
// registry-derived route table + the ONE generic face (src/spine/face.mjs).
// Three pieces, each now declared per-command instead of hand-kept in cli.mjs:
//   - the `--workspace` flag every mesh verb accepts (the face resolves it);
//   - the positional discipline (no stray id / at most one id / no empty id),
//     thrown from the argv adapter so the face's envelope discipline applies;
//   - the read-miss split (a supplied ref resolving to null is a FACE-level
//     node-not-found; the command's null return stays a command-level absent).
import { commandError } from "./errors.mjs";

// `--workspace <path|id>` — the cwd-independent target selector (m42 wave (b)
// item 4): a path loads that workspace; a bare id resolves its registered
// projectRoot through the global descriptor store. Resolution lives in the
// generic face (resolveWorkspaceRoot); declaring the flag here is what admits it
// past spec-parse.
export const MESH_WORKSPACE_FLAG = Object.freeze({
  workspace: Object.freeze({ type: "string", description: "target workspace: a path, or a registered workspace id" }),
});

// The positional discipline meshVerbCli owned: verbs that take no id refuse a
// stray positional; verbs that take one refuse a second and an empty string.
// Byte-identical refusal text; code `invalid-input` (the pinned matrix).
export function guardMeshPositionals(verb, positionals, { max = 0 } = {}) {
  if (max === 0 && positionals.length > 0) {
    throw commandError(`"${verb}" takes no positional argument (got "${positionals[0]}").`, "invalid-input", 400);
  }
  if (max === 1) {
    if (positionals.length > 1) {
      throw commandError(`"${verb}" takes at most one id (got ${positionals.length}).`, "invalid-input", 400);
    }
    if (positionals.length === 1 && positionals[0] === "") {
      throw commandError("An empty id is not a readable node id.", "invalid-input", 400);
    }
  }
}

// The read-miss split: a READ (a ref was supplied) that resolves to null is a
// face-level node-not-found — thrown from the render/json adapters so the
// command-level null (which other faces consume by design) is untouched.
export function refuseReadMiss(result, faceCtx = {}) {
  const ref = faceCtx.positionals?.[0];
  if (result == null && typeof ref === "string" && ref.length > 0) {
    throw commandError(`No node record for "${ref}".`, "node-not-found", 404);
  }
}

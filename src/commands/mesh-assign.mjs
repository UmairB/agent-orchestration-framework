// `aof mesh assign <ref> --to <nodeId>` / `--withdraw` — the operator-directed
// dispatch verb (milestone 35 / story 00). A CLI-only nested verb (ADR-007, a sibling
// of `aof mesh repo publish`): it resolves the ref EXACTLY (`findWork`, `work.mjs`),
// mints a first-class `assigned` record in the NEW `global_assignments` table
// (ADR-001), enforces the store-uniqueness single-runner invariant (ADR-003 — at most
// one ACTIVE assignment per (workspaceId, itemRef)), and checks the control-side
// repo-availability gate (this node's target must actually HOLD the workspace's
// published repo, resolved via `global_node_workspaces` + `mesh.repo.published`,
// mirroring `commands/mesh-repo.mjs`'s own read of that marker). Kept out of cli.mjs
// so it is unit-testable without spawning the CLI (the `mesh-repo.mjs` precedent).
//
// Arbitration is a plain store query — no lease/issuance/sync module, no git read
// (ADR-003 / acd-assignment-arbitration-store-not-git). Every miss is a CODED, loud
// refusal (34/ADR-008) that mints nothing; nothing here silently returns.
import { openGlobalWorkProjectionStore } from "../global-work-store.mjs";
import { resolveWorkspaceId } from "../workspace-identity.mjs";
import { globalMeshPaths } from "../workspace.mjs";
import { findWork } from "../work.mjs";
import {
  assembleAssignmentRecord,
  findActiveAssignment,
  insertAssignment,
  isActiveAssignmentState,
  listAssignmentsForItem,
  updateAssignmentState,
} from "../assignment-record.mjs";
// VERIFICATION (UI phase selection, 2026-07-25) — the operator-chosen lifecycle phase
// (refine/continue/verify) rides an additive side-table keyed by assignmentId; it cannot
// live on the FROZEN assignment record. Written here right after the mint, within the
// SAME open store.
import { isAssignmentPhase, setAssignmentPhase, DEFAULT_ASSIGNMENT_PHASE } from "../mesh-assignment-directive.mjs";
import { commandError } from "./errors.mjs";
import { MESH_WORKSPACE_FLAG } from "./mesh-face-shared.mjs";

function assignError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

async function openStore(ctx) {
  const storeOptions = ctx.globalWorkStoreOptions ?? {};
  const paths = storeOptions.paths ?? globalMeshPaths(storeOptions);
  const openFn = ctx.openGlobalWorkProjectionStore ?? openGlobalWorkProjectionStore;
  return openFn({ ...storeOptions, paths });
}

// resolveTarget(store, workspaceId, nodeId) — the control-side repo-availability gate
// (ADR-001 / 34-ADR-008 / SECURITY T3), joining the two named store facts:
//   (a) is `nodeId` a REAL, known node at all — a row in `global_nodes` (never a
//       self-declared/opaque miss: an unknown nodeId is refused BEFORE the repo check).
//   (b) does `nodeId` actually HOLD this workspace's repo — a row in
//       `global_node_workspaces` for (nodeId, workspaceId) (`global-node-registry.mjs
//       :141-143`'s join: a node is linked to a workspace only when it is a live
//       member of that workspace's mesh roster at snapshot time) AND the workspace's
//       repo has actually been PUBLISHED into the mesh at all — `workspaces
//       .last_published_at IS NOT NULL` (the store-side durable echo of the LOCAL
//       `mesh.repo.published` marker `commands/mesh-repo.mjs:33-50` writes: the control
//       node cannot read a remote worker's on-disk config directly, so the marker's
//       existence must be evidenced by SOME publish having reached this workspace row).
// Returns { ok:true } or { ok:false, code, message }, never throws — the caller decides
// how to surface it.
function resolveTarget(store, workspaceId, nodeId) {
  const node = store.db.prepare("SELECT * FROM global_nodes WHERE node_id = ?").get(nodeId);
  if (!node) {
    return {
      ok: false,
      code: "assignment-target-unknown",
      message: `"${nodeId}" is not a known node in this mesh — it has never appeared in the global registry.`,
    };
  }

  const membership = store.db.prepare(
    "SELECT 1 FROM global_node_workspaces WHERE node_id = ? AND workspace_id = ?",
  ).get(nodeId, workspaceId);
  const workspaceRow = store.db.prepare(
    "SELECT last_published_at FROM workspaces WHERE workspace_id = ?",
  ).get(workspaceId);
  const published = Boolean(workspaceRow?.last_published_at);

  if (!membership || !published) {
    return {
      ok: false,
      code: "assignment-repo-unavailable",
      message: `Node "${nodeId}" does not hold a published repo for this workspace — the directive would fail on arrival.`,
    };
  }

  return { ok: true };
}

// resolveWorkspaceId(workspace, workDir, ref) — resolves the item + its canonical
// workspaceId together. Exact resolution only (findWork's ref-based match, work.mjs);
// an unresolvable/typo'd ref refuses coded `ref-not-found`, minting nothing.
async function resolveItem(workspace) {
  const workspaceId = resolveWorkspaceId(workspace);
  return { workspaceId };
}

// assignWork(workspace, ref, nodeId, ctx) — the assign core. Resolves the ref exactly,
// enforces the ADR-003 uniqueness invariant, runs the repo-availability gate, then
// mints an `assigned` record. On ANY miss, mints nothing and returns a structured
// { ok:false, error, code, ...extra } result — never throws for an expected refusal
// (a genuine fault, e.g. the store failing to open, still throws).
export async function assignWork(workspace, ref, nodeId, ctx = {}) {
  const store = await openStore(ctx);
  try {
    const matches = await findWork(workspace.workDir, ref);
    if (matches.length !== 1) {
      return {
        ok: false,
        error: `No work item resolves for ref "${ref}".`,
        code: "ref-not-found",
      };
    }
    const item = matches[0];
    const { workspaceId } = await resolveItem(workspace);

    const active = findActiveAssignment(store, workspaceId, item.ref);
    if (active) {
      return {
        ok: false,
        error: `Item "${item.ref}" already has an active assignment held by "${active.targetNodeId}" (state "${active.state}").`,
        code: "assignment-already-active",
        holder: active.targetNodeId,
      };
    }

    const gate = resolveTarget(store, workspaceId, nodeId);
    if (!gate.ok) {
      return { ok: false, error: gate.message, code: gate.code, target: nodeId };
    }

    const issuer = ctx.issuer ?? workspace.config?.mesh?.nodeId ?? null;
    const now = ctx.now ?? new Date().toISOString();
    const record = assembleAssignmentRecord({
      itemRef: item.ref,
      workspaceId,
      targetNodeId: nodeId,
      issuer,
      now,
      assignmentId: ctx.assignmentId,
    });
    insertAssignment(store, record);
    // VERIFICATION (UI phase selection) — record the operator-chosen lifecycle phase for
    // this assignment so the dispatch tick runs `/aof:continue`/`/aof:verify` instead of
    // the refine default. Written only for an explicit NON-default phase: a CLI assign
    // (no phase) or an explicit `refine` writes NO row, so the dispatch tick's own refine
    // fallback applies and legacy behaviour is byte-identical. The phase can NEVER live on
    // the frozen record — it rides the additive side-table (mesh-assignment-directive.mjs).
    const phase = isAssignmentPhase(ctx.phase) ? ctx.phase : DEFAULT_ASSIGNMENT_PHASE;
    if (phase !== DEFAULT_ASSIGNMENT_PHASE) {
      setAssignmentPhase(store, record.assignmentId, phase, { now });
    }
    return { ok: true, phase, ...record };
  } finally {
    store.close?.();
  }
}

// withdrawWork(workspace, ref, ctx) — the withdraw core (ADR-001/003). Flips the
// LATEST assignment for the item to `withdrawn` IN PLACE (a state write, never a row
// delete) — but ONLY when that latest row is the ACTIVE assignment (state IN
// assigned/accepted/running — matches the feature's "flips the ACTIVE assignment"
// wording, QA advisory A3): idempotent-safe on an already-`withdrawn` row (re-writing
// withdrawn→withdrawn is a no-op-shaped success, never an error); and a benign
// `{ ok:true, assignment:null }` (fabricates/rewrites NOTHING) both when no assignment
// has ever existed for the ref AND when the latest row is already terminal but NOT
// `withdrawn` (done/failed/reclaimed) — withdraw never resurrects or reclassifies a
// run-store-owned terminal outcome.
export async function withdrawWork(workspace, ref, ctx = {}) {
  const store = await openStore(ctx);
  try {
    const matches = await findWork(workspace.workDir, ref);
    if (matches.length !== 1) {
      return {
        ok: false,
        error: `No work item resolves for ref "${ref}".`,
        code: "ref-not-found",
      };
    }
    const item = matches[0];
    const { workspaceId } = await resolveItem(workspace);

    const rows = listAssignmentsForItem(store, workspaceId, item.ref);
    if (rows.length === 0) {
      return { ok: true, assignment: null };
    }

    const latest = rows[0];
    if (!isActiveAssignmentState(latest.state) && latest.state !== "withdrawn") {
      // The latest row is terminal-but-not-withdrawn (done/failed/reclaimed) —
      // benign null, fabricates/rewrites nothing.
      return { ok: true, assignment: null };
    }

    const now = ctx.now ?? new Date().toISOString();
    const updated = updateAssignmentState(store, latest.assignmentId, "withdrawn", { now });
    return { ok: true, assignment: updated };
  } finally {
    store.close?.();
  }
}

export { assignError };

// mesh:assign — the registered Command over the two cores above (m42 wave (d)
// leg d1, wave-3 tail): `aof mesh assign <ref> --to <nodeId>` / `--withdraw`
// rides the route table + the ONE generic face; cli.mjs's meshAssignCommand
// face copy is deleted. A core-level coded refusal ({ ok:false, error, code })
// becomes a THROWN command error here, so the face's one envelope/exit policy
// applies; the cores themselves keep returning structured results for their
// white-box tests and any non-CLI caller. Declaring `--workspace` closes the
// m42 STATE residual (the cwd-independent assign the wrong-directory withdraw
// incident called for) — the generic face resolves it.
export const meshAssignCommand = {
  id: "mesh:assign",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      to: { type: "string" },
      withdraw: { type: "boolean" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const result = input.withdraw
      ? await withdrawWork(ctx.workspace, input.ref, {})
      : await assignWork(ctx.workspace, input.ref, input.to, {});
    if (!result.ok) {
      throw commandError(result.error, result.code);
    }
    return result;
  },

  cli: {
    route: ["mesh", "assign"],
    spec: {
      usage: "aof mesh assign <ref> --to <nodeId> | --withdraw [--workspace <path|id>] [--json]",
      flags: {
        to: { type: "string", description: "the node to assign the item to" },
        withdraw: { type: "boolean", description: "withdraw the active assignment instead" },
        ...MESH_WORKSPACE_FLAG,
      },
    },

    // The refusal matrix the retired cli.mjs face owned, byte-identical text.
    argv: (positionals, options = {}) => {
      const ref = positionals[0];
      if (typeof ref !== "string" || ref.length === 0) {
        throw commandError(
          "`aof mesh assign` needs a work ref.\n\nUsage:\n  aof mesh assign <ref> --to <nodeId>   assign a work item to a node\n  aof mesh assign <ref> --withdraw      withdraw the active assignment",
          "invalid-input",
          400,
        );
      }
      if (positionals.length > 1) {
        throw commandError(`"mesh assign" takes exactly one positional ref (got "${positionals[1]}").`, "invalid-input", 400);
      }
      if (options.withdraw && options.to) {
        throw commandError(`"mesh assign" takes either --to <nodeId> or --withdraw, not both.`, "invalid-input", 400);
      }
      if (!options.withdraw && (typeof options.to !== "string" || options.to.length === 0)) {
        throw commandError("`aof mesh assign <ref>` needs --to <nodeId> (or --withdraw).", "invalid-input", 400);
      }
      return {
        ref,
        ...(typeof options.to === "string" && options.to.length > 0 ? { to: options.to } : {}),
        ...(options.withdraw ? { withdraw: true } : {}),
      };
    },

    render(result, faceCtx = {}) {
      const ref = faceCtx.positionals?.[0];
      if (faceCtx.options?.withdraw) {
        return result.assignment == null
          ? `No assignment exists for "${ref}"; nothing to withdraw.`
          : `Withdrew the assignment for "${ref}" (assignmentId ${result.assignment.assignmentId}).`;
      }
      return `Assigned "${ref}" to "${result.targetNodeId}" (assignmentId ${result.assignmentId}).`;
    },

    // ONE `--json` envelope, byte-identical to the retired face: `{ ok:true,
    // assignment }` for a withdraw, `{ ok:true, …record }` for a mint.
    json: (result, faceCtx = {}) =>
      faceCtx.options?.withdraw ? { ok: true, assignment: result.assignment } : { ok: true, ...result },
  },
};

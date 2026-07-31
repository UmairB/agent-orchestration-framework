// `aof mesh assign <ref> --to <nodeId>` / `--withdraw` — the operator-directed
// dispatch verb (milestone 35 / story 00). The VERB only: its route, its refusal
// matrix and its one `--json` envelope. The assign/withdraw behaviour lives in
// src/mesh-assignment.mjs (m42 wave (d) leg d1 — see that module's header for why
// it sits below the command layer).
import { commandError } from "../command-error.mjs";
import { MESH_WORKSPACE_FLAG } from "./mesh-face-shared.mjs";
import { assignWork, withdrawWork } from "../mesh-assignment.mjs";

// mesh:assign — the registered Command over the two cores above (m42 wave (d)
// leg d1, wave-3 tail): `aof mesh assign <ref> --to <nodeId>` / `--withdraw`
// rides the route table + the ONE generic face; cli.mjs's meshAssignCommand
// face copy is deleted. A core-level coded refusal ({ ok:false, error, code, … })
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


// work:continue — "continue this task", with ONE option: WHERE to continue it.
//
// THE DEFECT (operator, 2026-07-26): there were three different doors to the same act.
// The board's Continue button opened a LOCAL agent on whatever machine serves the board;
// the fleet's Run [continue] → Assign dispatched to a chosen node; the slash command
// `/aof:continue <ref>` was typed by hand inside whichever session you happened to have.
// So clicking Continue on a milestone a worker had been building started a second,
// divergent line of work on the control node — against a checkout holding none of it.
//
// THE RULE (operator, verbatim): "The endpoint should be singular, as is the CLI:
// continue this task. With an option indicating where to continue it. Default is the
// last node that worked on it."
//
// So this command answers exactly one question — WHERE does this continue happen — and
// every face (board button, CLI, fleet) goes through it:
//
//   node given          → there.
//   no node, ran before → the node that last ran it (the SAME execution overlay the
//                         board already reads for its status column, so "the node the
//                         board says last ran this" and "the node this continues on"
//                         can never disagree).
//   no node, never ran  → here, locally.
//
// It does NOT spawn anything itself. A local continue returns the command for the
// caller's own terminal to run (the board's dock, the CLI's session); a remote continue
// mints the assignment and the worker's daemon picks it up. One decision, one place.
import { commandError } from "./errors.mjs";
import { assignWork } from "./mesh-assign.mjs";
import { readExecutionOverlay } from "../board-mesh-execution.mjs";

export const continueCommand = {
  id: "work:continue",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      node: { type: "string" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    if (ref === "") throw commandError("A work ref is required.", "missing-ref", 400);

    const storeOptions = ctx.globalWorkStoreOptions ?? {};
    const localNodeId = ctx.workspace?.config?.mesh?.nodeId ?? null;

    // Explicit target wins; otherwise the node that last ran this item; otherwise here.
    let node = typeof input.node === "string" ? input.node.trim() : "";
    let resolvedBy = node === "" ? null : "requested";
    if (node === "") {
      const overlay = await readExecutionOverlay(ctx.workspace, { globalWorkStoreOptions: storeOptions });
      const last = overlay.get(ref)?.nodeId ?? "";
      if (last !== "") {
        node = last;
        resolvedBy = "last-node";
      }
    }

    // Local — either nothing has ever run this, or the resolved node IS this node. The
    // caller runs it in its own session; nothing is minted, so a local continue can never
    // leave an assignment row behind for a run that only ever existed in a terminal.
    if (node === "" || (localNodeId != null && node === localNodeId)) {
      return {
        ok: true,
        ref,
        where: "local",
        node: localNodeId,
        resolvedBy: resolvedBy ?? "no-prior-run",
        command: `/aof:continue ${ref}`,
      };
    }

    const result = await assignWork(ctx.workspace, ref, node, { phase: "continue", globalWorkStoreOptions: storeOptions });
    if (result?.ok !== true) {
      // assignWork returns expected refusals structurally (already-active, unknown node,
      // repo unavailable) — surfaced as a coded error, never a silent fall back to a
      // local run, which is the exact surprise this command exists to remove.
      throw commandError(result?.error ?? "The continue was refused.", result?.code ?? "continue-refused", 409);
    }
    return {
      ok: true,
      ref: result.itemRef ?? ref,
      where: "remote",
      node,
      resolvedBy,
      assignmentId: result.assignmentId,
      command: `/aof:continue ${ref}`,
    };
  },

  cli: {
    // `aof work continue <ref> [--node <id>]`
    argv: (positionals, options = {}) => ({
      ref: positionals[0],
      ...(typeof options.node === "string" ? { node: options.node } : {}),
    }),
    render: (result) =>
      result.where === "remote"
        ? `Continuing "${result.ref}" on ${result.node} (assignment ${result.assignmentId}).`
        : `Continue "${result.ref}" here — run: ${result.command}`,
    json: (result) => result,
  },
};

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
import { readExecutionOverlay, resolveScopedExecution, executionScopeRef } from "../board-mesh-execution.mjs";

// resolveContinueDecision(overlay, ref, { requestedNode, localNodeId }) — the PURE
// where-does-this-continue-happen decision, extracted so it is unit-testable without a
// store (the effectful run() below only executes what this decides).
//
// EXECUTION SCOPE (operator, 2026-07-26 — the story-continue defect): runs, assignments,
// branches and worktrees are recorded against the TOP-LEVEL item, so a story ref has no
// execution row of its own. The original decision looked up the overlay by EXACT ref,
// found nothing for "18/02" while milestone 18 ran on a worker, and fell through to
// "here" — a rival local run, the one-door defect one level down. The decision now
// resolves through the ONE scope rule (board-mesh-execution.mjs), and adds a third
// answer alongside local/remote:
//
//   scope actively running  → "running" — the act is ALREADY happening on <node>;
//                             nothing is minted, nothing local is spawned. Running work
//                             is watched, not restarted.
//   scope ran before        → "remote", dispatched at the SCOPE ref (the unit of mesh
//                             execution — assigning the child ref would mint a second
//                             branch/worktree beside the milestone's, the divergence
//                             this door exists to prevent).
//   never ran / this node   → "local", at the EXACT ref (a local session can continue
//                             a single story directly).
//
// An explicit requestedNode still wins (the operator said where); a dispatch into an
// active assignment is refused loudly by the assign core, never silently rerouted.
export function resolveContinueDecision(overlay, ref, { requestedNode = "", localNodeId = null } = {}) {
  const scopeRef = executionScopeRef(ref);
  const scoped = resolveScopedExecution(overlay, ref);

  if (requestedNode !== "") {
    if (localNodeId != null && requestedNode === localNodeId) {
      return { where: "local", node: localNodeId, dispatchRef: ref, scopeRef, resolvedBy: "requested" };
    }
    return { where: "remote", node: requestedNode, dispatchRef: scopeRef, scopeRef, resolvedBy: "requested" };
  }

  if (scoped?.execution?.active === true) {
    return {
      where: "running",
      node: scoped.execution.nodeId ?? null,
      dispatchRef: scoped.scopeRef,
      scopeRef: scoped.scopeRef,
      resolvedBy: "active-run",
      execution: scoped.execution,
    };
  }

  const last = scoped?.execution?.nodeId ?? "";
  if (last === "" || (localNodeId != null && last === localNodeId)) {
    return {
      where: "local",
      node: localNodeId,
      dispatchRef: ref,
      scopeRef,
      resolvedBy: last === "" ? "no-prior-run" : "last-node",
    };
  }
  return { where: "remote", node: last, dispatchRef: scopeRef, scopeRef, resolvedBy: "last-node" };
}

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

    const requestedNode = typeof input.node === "string" ? input.node.trim() : "";
    const overlay = await readExecutionOverlay(ctx.workspace, { globalWorkStoreOptions: storeOptions });
    const decision = resolveContinueDecision(overlay, ref, { requestedNode, localNodeId });

    // Already in flight (the ref itself, or its scope — the milestone a story belongs
    // to). Nothing is minted and nothing local is spawned: the honest answer is WHERE
    // it is running, so the caller can watch it instead of racing it.
    if (decision.where === "running") {
      return {
        ok: true,
        ref,
        where: "running",
        node: decision.node,
        scopeRef: decision.scopeRef,
        state: decision.execution?.state ?? null,
        assignmentId: decision.execution?.assignmentId ?? null,
        sessionId: decision.execution?.sessionId ?? null,
        resolvedBy: decision.resolvedBy,
      };
    }

    // Local — either nothing has ever run this scope, or the resolved node IS this
    // node. The caller runs it in its own session; nothing is minted, so a local
    // continue can never leave an assignment row behind for a run that only ever
    // existed in a terminal. Local continues keep the EXACT ref (a session can
    // continue one story directly).
    if (decision.where === "local") {
      return {
        ok: true,
        ref,
        where: "local",
        node: decision.node,
        resolvedBy: decision.resolvedBy,
        command: `/aof:continue ${ref}`,
      };
    }

    // Remote — dispatched at the SCOPE ref (the unit of mesh execution: one branch,
    // one worktree per top-level item; assigning a child ref would mint a divergent
    // second line beside the milestone's own).
    const result = await assignWork(ctx.workspace, decision.dispatchRef, decision.node, { phase: "continue", globalWorkStoreOptions: storeOptions });
    if (result?.ok !== true) {
      // assignWork returns expected refusals structurally (already-active, unknown node,
      // repo unavailable) — surfaced as a coded error, never a silent fall back to a
      // local run, which is the exact surprise this command exists to remove.
      throw commandError(result?.error ?? "The continue was refused.", result?.code ?? "continue-refused", 409);
    }
    return {
      ok: true,
      ref,
      where: "remote",
      node: decision.node,
      scopeRef: decision.scopeRef,
      resolvedBy: decision.resolvedBy,
      assignmentId: result.assignmentId,
      command: `/aof:continue ${decision.dispatchRef}`,
    };
  },

  cli: {
    // `aof work continue <ref> [--node <id>]`
    argv: (positionals, options = {}) => ({
      ref: positionals[0],
      ...(typeof options.node === "string" ? { node: options.node } : {}),
    }),
    render: (result) => {
      if (result.where === "running") {
        const scope = result.scopeRef && result.scopeRef !== result.ref ? ` (via ${result.scopeRef})` : "";
        return `"${result.ref}" is already running on ${result.node ?? "a worker"}${scope} — watch it, don't restart it.`;
      }
      if (result.where === "remote") {
        const scope = result.scopeRef && result.scopeRef !== result.ref ? ` as ${result.scopeRef}` : "";
        return `Continuing "${result.ref}"${scope} on ${result.node} (assignment ${result.assignmentId}).`;
      }
      return `Continue "${result.ref}" here — run: ${result.command}`;
    },
    json: (result) => result,
  },
};

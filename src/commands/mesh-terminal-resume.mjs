// mesh:terminal-resume — re-attach a PARKED/KILLED worker session (m42 quick-fix,
// operator-requested: "run `claude --resume <id>` so it can continue from the
// terminated session").
//
// `aof mesh terminal-resume <sessionId> [--node <id>]` — control-node CLI:
//   1. resolve the assignment that captured this session id (the store is the
//      one place the (sessionId -> assignment/worktree/holder) join lives);
//   2. push a terminal-resume envelope into the LOOPBACK relay (the same
//      same-machine IPC the terminal-input lane rides — the serve process's
//      self-subscribed router routes it down the holder's stream connection);
//   3. the worker spawns `claude --resume <sessionId>` in the assignment's
//      RETAINED worktree, stamping its PTY frames with the RESUMED session id —
//      so the fleet's EXISTING (nodeId, sessionId) tuple (the row's own, the one
//      an already-open dock tab is subscribed to) comes back to life, mirrored
//      AND typeable.
//
// FIRE-AND-FORGET by design (the relay push has no reply channel): the command
// reports WHAT it dispatched and WHERE to watch; the worker's own log + the
// terminal stream are the confirmation. Control-node only — an unconfigured
// relay (not the control machine) is a loud coded refusal, never a silent no-op.
import { commandError } from "./errors.mjs";
import { openGlobalWorkProjectionStore } from "../global-work-store.mjs";
import { globalMeshPaths } from "../workspace.mjs";
import { buildTerminalResumeEnvelope, createTerminalRelayPushTransport } from "../mesh-terminal-relay-bridge.mjs";
import { reportDegrade } from "../degrade.mjs";

export const meshTerminalResumeCommand = {
  id: "mesh:terminal-resume",
  input: {
    type: "object",
    properties: { session: { type: "string" }, node: { type: "string" } },
    required: ["session"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const sessionId = typeof input.session === "string" ? input.session.trim() : "";
    if (sessionId.length === 0) {
      throw commandError("A session id is required: aof mesh terminal-resume <sessionId>.", "invalid-input", 400);
    }

    // 1. The (sessionId -> assignment) join — the LATEST row that captured it.
    const storeOptions = ctx?.globalWorkStoreOptions ?? {};
    const store = await openGlobalWorkProjectionStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
    let row;
    try {
      row = store.db.prepare(
        "SELECT assignment_id, item_ref, workspace_id, target_node_id, state, session_id FROM global_assignments WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1",
      ).get(sessionId);
    } finally {
      store.close?.();
    }
    if (row == null) {
      throw commandError(`No assignment ever captured session "${sessionId}" — nothing to resume (the join key is the assignment row's session_id).`, "session-unknown", 404);
    }
    const nodeId = typeof input.node === "string" && input.node.trim().length > 0 ? input.node.trim() : row.target_node_id;

    // 2. Push over the loopback relay — the injectable seam keeps the command
    //    testable without a live broker; production resolves the real transport
    //    from THIS workspace's config (null = not the control machine).
    const createPush = ctx?.createTerminalResumePush ?? createTerminalRelayPushTransport;
    const push = createPush(ctx?.workspace?.config);
    if (push == null) {
      throw commandError(
        "No mesh relay is configured here (config.mesh.relay.url) — terminal-resume runs on the CONTROL node, whose serve daemon routes it to the holder.",
        "relay-unconfigured",
        400,
      );
    }
    const dispatchedAt = new Date().toISOString();
    try {
      await push.push(buildTerminalResumeEnvelope(nodeId, {
        sessionId,
        assignmentId: row.assignment_id,
        workspaceId: row.workspace_id,
        itemRef: row.item_ref,
      }));
    } finally {
      try { push.close?.(); } catch (error) { reportDegrade("mesh-terminal-resume", error); }
    }

    // 3. CONFIRM AT THE SOURCE — never report a fire-and-forget push as success
    //    (measured 2026-07-27: two resumes were dropped — one in a serve-restart
    //    race, one against a dead worker — while this command printed a
    //    success-shaped message both times). The dispatch is real the moment the
    //    WORKER's lifecycle frames land back in the store: poll the assignment
    //    row for an update newer than the dispatch. Not confirmed within the
    //    window = say so, with the exact places the truth lives.
    const confirmTimeoutMs = Number.isFinite(ctx?.confirmTimeoutMs) ? ctx.confirmTimeoutMs : 10_000;
    let confirmedRow = null;
    const deadline = Date.now() + confirmTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, confirmTimeoutMs)));
      const probe = await openGlobalWorkProjectionStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
      try {
        const current = probe.db.prepare(
          "SELECT state, run_id, session_id, code, updated_at FROM global_assignments WHERE assignment_id = ?",
        ).get(row.assignment_id);
        if (current != null && typeof current.updated_at === "string" && current.updated_at > dispatchedAt) {
          confirmedRow = current;
          break;
        }
      } finally {
        probe.close?.();
      }
    }

    return {
      ok: true,
      dispatched: true,
      confirmed: confirmedRow != null,
      sessionId,
      node: nodeId,
      assignmentId: row.assignment_id,
      itemRef: row.item_ref,
      workspaceId: row.workspace_id,
      assignmentState: confirmedRow?.state ?? row.state,
      confirmedCode: confirmedRow?.code ?? null,
      confirmedRunId: confirmedRow?.run_id ?? null,
    };
  },

  cli: {
    // `aof mesh terminal-resume <sessionId> [--node <id>]`.
    argv: (positionals, options = {}) => ({
      ...(typeof positionals[0] === "string" && positionals[0].length > 0 ? { session: positionals[0] } : {}),
      ...(typeof options.node === "string" && options.node.length > 0 ? { node: options.node } : {}),
    }),

    render(result) {
      if (!result.confirmed) {
        return [
          `resume dispatched but NOT CONFIRMED: session ${result.sessionId} -> ${result.node} — the assignment row did not move within the confirmation window.`,
          `Most likely the worker daemon on ${result.node} is not running or its stream is down (a dead daemon still reads "live" on mesh status — that is FABRIC liveness, the machine, not the daemon).`,
          `Check: \`aof mesh logs mesh-serve --tail 20\` on the control (a routed dispatch logs terminal-resume-dispatched; a dead target logs terminal-resume-target-not-connected), then start the worker and re-run this command.`,
        ].join("\n");
      }
      return [
        `resume CONFIRMED: session ${result.sessionId} -> ${result.node} (assignment ${result.assignmentId}, item ${result.itemRef})`,
        `row: ${result.assignmentState}${result.confirmedCode ? ` (code: ${result.confirmedCode})` : ""}${result.confirmedRunId ? ` · run ${result.confirmedRunId}` : ""}`,
        `The board's terminal affordance re-arms on the live session as it reports in.`,
      ].join("\n");
    },

    json: (result) => result,
  },
};

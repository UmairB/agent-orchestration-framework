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

    return {
      ok: true,
      dispatched: true,
      sessionId,
      node: nodeId,
      assignmentId: row.assignment_id,
      itemRef: row.item_ref,
      workspaceId: row.workspace_id,
      assignmentState: row.state,
    };
  },

  cli: {
    // `aof mesh terminal-resume <sessionId> [--node <id>]`.
    argv: (positionals, options = {}) => ({
      ...(typeof positionals[0] === "string" && positionals[0].length > 0 ? { session: positionals[0] } : {}),
      ...(typeof options.node === "string" && options.node.length > 0 ? { node: options.node } : {}),
    }),

    render(result) {
      return [
        `resume dispatched: session ${result.sessionId} -> ${result.node} (assignment ${result.assignmentId}, item ${result.itemRef}, row ${result.assignmentState})`,
        `The worker resumes it as a REAL run: a run record is minted, the row revives to running (code: resumed),`,
        `and the board's terminal affordance re-arms on the live session as it reports in — watch the item on the board,`,
        `or \`aof mesh logs --node ${result.node}\` for the worker's terminal-resume lines.`,
        ...(result.assignmentState !== "failed" && result.assignmentState !== "running"
          ? [`NOTE: the row is ${result.assignmentState} — only a FAILED row revives (done/withdrawn stay terminal); the session still resumes and streams, but the row will not flip.`]
          : []),
      ].join("\n");
    },

    json: (result) => result,
  },
};

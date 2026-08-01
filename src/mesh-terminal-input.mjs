// src/mesh-terminal-input.mjs — the CONTROL-SIDE half of m42's "interactive worker
// terminals" (SECURITY T14's read-only decision operator-overridden; the constrained
// shape is pinned by acd-fleet-terminal-input-constrained). The INPUT direction's
// router: the mesh-ui process wraps a browser keystroke in a `terminal-input` relay
// envelope (tuple-bound at the socket, mesh-ui-serve.mjs) and pushes it into the
// loopback broker; the serve process SELF-SUBSCRIBES to its own broker and hands
// every inbound frame here. This router:
//   - is KIND-BLIND to everything but TERMINAL_INPUT_KIND (the mirror's own
//     discipline — the same subscriber socket also carries every terminal-frame
//     the control pushes for the fleet mirror; those return false untouched),
//   - validates SHAPE only (a non-empty target nodeId, a non-empty sessionId, a
//     non-empty string of bytes) — the WORKER is the authority on whether that
//     session is live (its input registry writes only an exactly-matched live
//     PTY), and the targeting map is the authority on admission (populated only
//     post-admission, SECURITY T5),
//   - routes DOWN the worker's admitted stream connection via the SAME
//     dispatchDirective seam the withdraw notify uses ({ kind, to, ... } — the
//     down-frame carries sessionId + bytes; the relay envelope never crosses the
//     fabric),
//   - never throws, never logs a keystroke's CONTENT (input may be an operator's
//     answer to a secret prompt — codes and counts only).
//
// PURE IN-MEMORY: no fs, no store, no durable write — a lost input frame is a
// keystroke the operator retypes, never a correctness fault.
import { TERMINAL_INPUT_KIND, TERMINAL_RESUME_KIND } from "./mesh-terminal-relay-bridge.mjs";
import { reportDegrade } from "./degrade.mjs";

// createTerminalInputRouter({ dispatchDirective, now, onLog }) → { apply(frame) }.
// The `apply` shape is deliberately the terminal MIRROR's own consumer contract
// (createTerminalMirror().apply) so the EXISTING subscriber machinery
// (startTerminalMirrorSubscriber + createTerminalMirrorSubscriberTransport —
// parse, backoff, reconnect) drives this router with zero new transport code: the
// serve process hands this object in as the "mirror".
export function createTerminalInputRouter({ dispatchDirective, now, onLog } = {}) {
  const resolveNow = () => (typeof now === "function" ? now() : now ?? new Date().toISOString());
  // A not-connected target is reported ONCE per (nodeId, sessionId) per router
  // lifetime — a worker that is offline while an operator types would otherwise
  // log every keystroke.
  const reportedMisses = new Set();
  const log = (level, code, message) => {
    try {
      onLog?.({ level, code, message });
    } catch (error) {
      reportDegrade("mesh-terminal-input", error);
    }
  };
  return {
    // apply(envelope) → boolean (true iff the frame was routed down a live worker
    // connection). Mirrors createTerminalMirror().apply's guarantees: never
    // throws, ignores every foreign kind, drops an unroutable frame without
    // disturbing anything else.
    apply(envelope) {
      if (envelope == null || typeof envelope !== "object") return false;
      if (envelope.kind !== TERMINAL_INPUT_KIND && envelope.kind !== TERMINAL_RESUME_KIND) return false;
      if (typeof dispatchDirective !== "function") return false;
      const signal = envelope.signal;
      const nodeId = typeof envelope.nodeId === "string" && envelope.nodeId.length > 0 ? envelope.nodeId : null;
      const sessionId = signal != null && typeof signal.sessionId === "string" && signal.sessionId.length > 0 ? signal.sessionId : null;

      // The RESUME lane (m42 quick-fix): a CLI-pushed request to re-attach a
      // parked/killed session — routed down the holder's stream like the input
      // lane, carrying the worktree-resolution context. Logged (a resume is a
      // deliberate operator act, one line — unlike a keystroke).
      if (envelope.kind === TERMINAL_RESUME_KIND) {
        const assignmentId = signal != null && typeof signal.assignmentId === "string" && signal.assignmentId.length > 0 ? signal.assignmentId : null;
        const workspaceId = signal != null && typeof signal.workspaceId === "string" && signal.workspaceId.length > 0 ? signal.workspaceId : null;
        const itemRef = signal != null && typeof signal.itemRef === "string" && signal.itemRef.length > 0 ? signal.itemRef : null;
        if (nodeId == null || sessionId == null || assignmentId == null || workspaceId == null) {
          log("warn", "terminal-resume-invalid", "terminal-resume frame dropped: missing nodeId/sessionId/assignmentId/workspaceId");
          return false;
        }
        let result;
        try {
          result = dispatchDirective({ kind: TERMINAL_RESUME_KIND, to: nodeId, sessionId, assignmentId, workspaceId, itemRef, at: resolveNow() });
        } catch (error) {
          reportDegrade("mesh-terminal-input", error);
          return false;
        }
        if (result?.sent !== true) {
          log("warn", "terminal-resume-target-not-connected", `terminal resume for session ${sessionId} dropped: node ${nodeId} has no live stream connection (${result?.code ?? "no-code"})`);
          return false;
        }
        log("info", "terminal-resume-dispatched", `terminal resume dispatched: session ${sessionId} (assignment ${assignmentId}) -> ${nodeId}`);
        return true;
      }

      const bytes = signal != null && typeof signal.bytes === "string" && signal.bytes.length > 0 ? signal.bytes : null;
      if (nodeId == null || sessionId == null || bytes == null) {
        log("warn", "terminal-input-invalid", "terminal-input frame dropped: missing nodeId/sessionId/bytes");
        return false;
      }
      let result;
      try {
        result = dispatchDirective({ kind: TERMINAL_INPUT_KIND, to: nodeId, sessionId, bytes, at: resolveNow() });
      } catch (error) {
        reportDegrade("mesh-terminal-input", error);
        return false;
      }
      if (result?.sent !== true) {
        const missKey = `${nodeId}::${sessionId}`;
        if (!reportedMisses.has(missKey)) {
          reportedMisses.add(missKey);
          log("warn", "terminal-input-target-not-connected", `terminal input for session ${sessionId} dropped: node ${nodeId} has no live stream connection (${result?.code ?? "no-code"}); further drops for this tuple are silent`);
        }
        return false;
      }
      return true;
    },
  };
}

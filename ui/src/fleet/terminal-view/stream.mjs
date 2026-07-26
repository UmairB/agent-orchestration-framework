// The fleet terminal-VIEW's stream RESOLUTION (milestone 38 / story 06 / task 04;
// BLOCKER F-38.06c. ARCHITECTURE ADR-013 + ADR-014 invariant 4; DESIGN §Surface 3
// V1/V8). A framework-free ESM module — no React, no DOM, no I/O, no clock — the
// terminal-view SIBLING of ui/src/board/terminal/{dock-state,provider-picker,
// resize}.mjs: ALL the logic lives here so the @executable scenarios run headlessly
// (no browser, no socket), and FleetTerminalView.tsx stays a thin consumer that
// imports exactly these functions.
//
// WHAT THIS ANSWERS: given the assignment row the fleet read shape hands a card
// (src/global-mesh-query.mjs's `projectAssignment` — `targetNodeId` plus the NEW
// ADR-013 `sessionId`), WHICH terminal stream — if any — may this card open?
//
// ADR-014 invariant 4, load-bearing: routing is by the FULL (nodeId, sessionId)
// tuple. A half-tuple resolves to NO stream — never a guessed, defaulted, or
// sibling session, and never a node-only subscription that would bleed another
// session's bytes into this card. "No stream" is a first-class, honest outcome:
// the card simply shows no terminal and opens no socket.

// The reasons a card legitimately has NO stream to open. Each is a NORMAL state
// (an assignment whose worker has not launched/captured its interactive session
// yet is the common one), never an error.
export const NO_STREAM = {
  NO_ASSIGNMENT: "no-assignment",
  NO_NODE: "no-node",
  NO_SESSION: "no-session",
};

// The route the fleet face serves for the read-only mirror (src/mesh-ui-serve.mjs's
// ONE upgrade carve-out). Named once, here, so the component cannot drift onto the
// board-side bidirectional `/ws/terminal` by accident.
export const TERMINAL_VIEW_PATH = "/ws/terminal-view";

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// terminalStreamKey(nodeId, sessionId) — the ONE (nodeId, sessionId) → string key
// the view uses to identify/multiplex a stream, mirroring the server-side mirror's
// own `routingKey` join (src/mesh-terminal-mirror.mjs). The FULL tuple, never the
// node alone (V8) — two assignments on the SAME node with different sessions get
// two DIFFERENT keys, so two cards can never cross-wire. A missing half yields
// null (no accidental "node-a::undefined" that would match a real subscription).
export function terminalStreamKey(nodeId, sessionId) {
  const node = nonEmpty(nodeId);
  const session = nonEmpty(sessionId);
  if (node == null || session == null) return null;
  return `${node}::${session}`;
}

// resolveTerminalStream(assignment) — the resolution itself. PURE over the row it
// is handed; never mutates it, never reaches for a fallback elsewhere in the
// payload (no "the node's other assignment", no "the only live session"). Returns
// either:
//   { resolved: false, reason }                     — no terminal, no socket
//   { resolved: true, nodeId, sessionId, key }      — exactly this stream
export function resolveTerminalStream(assignment) {
  if (assignment == null || typeof assignment !== "object") {
    return { resolved: false, reason: NO_STREAM.NO_ASSIGNMENT };
  }
  const nodeId = nonEmpty(assignment.targetNodeId);
  const sessionId = nonEmpty(assignment.sessionId);
  // Order matters only for the REASON reported (both halves are required); the
  // node is checked first because a row with no target node is a malformed
  // dispatch, whereas a row with no session is the normal not-yet-captured case.
  if (nodeId == null) return { resolved: false, reason: NO_STREAM.NO_NODE };
  if (sessionId == null) return { resolved: false, reason: NO_STREAM.NO_SESSION };
  return { resolved: true, nodeId, sessionId, key: terminalStreamKey(nodeId, sessionId) };
}

// terminalViewSocketUrl(stream, location) — the read-only mirror's socket URL for a
// RESOLVED stream, or null for an unresolved one (the caller opens nothing). Built
// from the page's own origin (same-origin, like every other fleet read) with the
// tuple carried as query params the fleet route already reads. An UNRESOLVED
// stream can never produce a URL — the structural half of "opens no socket".
export function terminalViewSocketUrl(stream, { protocol = "http:", host = "" } = {}) {
  if (stream == null || stream.resolved !== true) return null;
  const scheme = protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({ nodeId: stream.nodeId, sessionId: stream.sessionId });
  return `${scheme}://${host}${TERMINAL_VIEW_PATH}?${params.toString()}`;
}

// terminalStreamHeader(stream, { itemRef, assignmentId }) — the V1 stream-identity
// header model: WHICH stream this is, resolved to the human assignment/ref it
// belongs to, never a raw id alone. Returns null when the stream is unresolved OR
// when the view cannot name an owner — "a terminal with no visible owner is never
// rendered" (V1) is enforced HERE, structurally, rather than left to the render.
//
// `ref` prefers the human work-item ref (`38/06`); it degrades to the assignment
// id ONLY when no ref is available, so the header still names a real owner rather
// than showing a bare session hash.
export function terminalStreamHeader(stream, { itemRef, assignmentId } = {}) {
  if (stream == null || stream.resolved !== true) return null;
  const ref = nonEmpty(itemRef) ?? nonEmpty(assignmentId);
  if (ref == null) return null;
  return {
    ref,
    nodeId: stream.nodeId,
    sessionId: stream.sessionId,
    key: stream.key,
    // The one-line identity the header renders: the owner ref, the node whose PTY
    // this is, and the session — all three, so two open views are never confusable.
    label: `${ref} → ${stream.nodeId}`,
    sessionLabel: `session ${stream.sessionId}`,
    // V2/V6 — the read-only posture travels as an explicit LABEL (never colour or
    // the absence of an input box alone). Named here so the component cannot ship
    // the posture as styling only.
    readOnlyLabel: "read-only",
  };
}

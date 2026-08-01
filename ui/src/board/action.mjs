// The state-aware PRIMARY action for the detail panel (DESIGN — "Run agent" is
// state-aware; ARCHITECTURE ADR-006). The detail panel's primary button derives
// BOTH its label and the aof slash-command it runs from the selected item's
// DERIVED status along the ACD lifecycle (refine → continue → verify). The
// command is later typed into the spawned agent as ordinary PTY input
// (TerminalDock). Pure data — no React, no IO — so the mapping is unit-testable
// headlessly. Authored as .mjs (+ action.d.mts) so the test imports it on Node
// >=20 without type-stripping, matching the terminal/*.mjs convention.

// Derive the primary action for an item. Pure: status + ctx in, action out.
//   ctx.liveForRef  — dock open + bound to THIS ref → "View terminal" (wins over status)
//   ctx.hasBreakdown— item already broken down (milestone w/ >=1 story; else true)
export function primaryAction(item, ctx) {
  // A live session bound to this item wins over status — view it, don't re-run.
  if (ctx.liveForRef) {
    return { kind: "view", label: "View terminal" };
  }

  // …and so does a run in flight on a WORKER (2026-07-26). `liveForRef` only knows
  // about a LOCAL dock session, so an item a worker was actively executing still
  // offered "Continue" — clicking it dispatched a second run, which the assign core
  // then refused ("already has an active assignment held by <node>"). The row already
  // carries the answer (`execution.active` + the node), so read it here rather than
  // letting the operator discover it by being refused. Running work is watched, not
  // restarted.
  // Its own kind, NOT "view": the board's terminal dock is a LOCAL pty, so reusing
  // "view" here would open an empty dock and look like it did something. Disabled and
  // labelled with the node — the honest answer is "this is running over there".
  if (item.execution?.active === true) {
    // With a captured session, running work is WATCHABLE — and, since m42's
    // terminal-input path, ANSWERABLE: the dock opens the worker's live session
    // over the tuple-bound terminal-view socket (one terminal surface; a remote
    // session is a SOURCE of the dock, never a second widget). A session the
    // worker reports as WAITING ON A HUMAN (code: needs-input) leads with that —
    // the affordance is the answer's door, not just a viewport. Without a
    // captured session (the pre-session window), the honest disabled state.
    if (item.execution.sessionId && item.execution.nodeId) {
      const needsInput = item.execution.code === "needs-input";
      return {
        kind: "mirror",
        label: needsInput
          ? `Answer on ${item.execution.nodeId}`
          : `Open terminal — ${item.execution.nodeId}`,
        needsInput,
        nodeId: item.execution.nodeId,
        sessionId: item.execution.sessionId,
      };
    }
    return {
      kind: "running",
      label: item.execution.nodeId ? `Running on ${item.execution.nodeId}` : "Running",
      disabled: true,
    };
  }

  switch (item.status) {
    case "blocked":
      return { kind: "blocked", label: "Blocked", disabled: true };
    case "in-review":
      return { kind: "verify", label: "Verify", command: `/aof:verify ${item.ref}` };
    case "not-started":
      // No contract yet → refine it first; otherwise carry on (continue).
      return ctx.hasBreakdown
        ? { kind: "continue", label: "Continue", command: `/aof:continue ${item.ref}` }
        : { kind: "refine", label: "Refine", command: `/aof:refine ${item.ref}` };
    case "in-progress":
      return { kind: "continue", label: "Continue", command: `/aof:continue ${item.ref}` };
    case "done":
    default:
      // Done / null / unknown → an ad-hoc interactive agent (no command typed).
      return { kind: "adhoc", label: "Run agent" };
  }
}

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

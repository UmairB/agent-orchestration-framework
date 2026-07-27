// Type declarations for action.mjs (the state-aware primary-action mapping).
import type { WorkItem } from "./api";

// The action the primary button represents:
//   view     — a live LOCAL session is already bound to this item → "View terminal"
//   mirror   — a worker is executing it AND its session is captured → the dock opens
//              the worker's live session over the tuple-bound terminal-view socket
//              (m42: INTERACTIVE — one terminal surface; a remote session is a
//              SOURCE of the dock, never a second widget). `needsInput` marks a
//              session the worker reports waiting on a human (code: needs-input) —
//              the label leads with Answer.
//   running  — a worker node is executing it, session not yet captured → disabled,
//              names the node (2026-07-26: offering "Continue" here dispatched a
//              second run that the assign core then refused — running work is
//              watched, not restarted)
//   refine   — a thin/not-started contract → /aof:refine <ref>
//   continue — work in flight (or refined-but-not-done) → /aof:continue <ref>
//   verify   — in-review, ready for verification → /aof:verify <ref>
//   adhoc    — done/unknown → spawn an interactive agent, no command
//   blocked  — waiting on dependencies → disabled
export type PrimaryActionKind = "view" | "mirror" | "running" | "refine" | "continue" | "verify" | "adhoc" | "blocked";

export type PrimaryAction = {
  kind: PrimaryActionKind;
  label: string;
  command?: string;
  disabled?: boolean;
  needsInput?: boolean;
  nodeId?: string;
  sessionId?: string;
};

// Context the board resolves for the selected item.
export type PrimaryActionCtx = {
  hasBreakdown: boolean;
  liveForRef: boolean;
};

export function primaryAction(item: WorkItem, ctx: PrimaryActionCtx): PrimaryAction;

// Type declarations for action.mjs (the state-aware primary-action mapping).
import type { WorkItem } from "./api";

// The action the primary button represents:
//   view     — a live LOCAL session is already bound to this item → "View terminal"
//   running  — a worker node is executing it right now → disabled, names the node
//              (2026-07-26: offering "Continue" here dispatched a second run that the
//              assign core then refused — running work is watched, not restarted)
//   refine   — a thin/not-started contract → /aof:refine <ref>
//   continue — work in flight (or refined-but-not-done) → /aof:continue <ref>
//   verify   — in-review, ready for verification → /aof:verify <ref>
//   adhoc    — done/unknown → spawn an interactive agent, no command
//   blocked  — waiting on dependencies → disabled
export type PrimaryActionKind = "view" | "running" | "refine" | "continue" | "verify" | "adhoc" | "blocked";

export type PrimaryAction = {
  kind: PrimaryActionKind;
  label: string;
  command?: string;
  disabled?: boolean;
};

// Context the board resolves for the selected item.
export type PrimaryActionCtx = {
  hasBreakdown: boolean;
  liveForRef: boolean;
};

export function primaryAction(item: WorkItem, ctx: PrimaryActionCtx): PrimaryAction;

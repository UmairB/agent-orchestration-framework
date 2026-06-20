// Type declarations for action.mjs (the state-aware primary-action mapping).
import type { WorkItem } from "./api";

// The action the primary button represents:
//   view     — a live session is already bound to this item → "View terminal"
//   refine   — a thin/not-started contract → /aof:refine <ref>
//   continue — work in flight (or refined-but-not-done) → /aof:continue <ref>
//   verify   — in-review, ready for verification → /aof:verify <ref>
//   adhoc    — done/unknown → spawn an interactive agent, no command
//   blocked  — waiting on dependencies → disabled
export type PrimaryActionKind = "view" | "refine" | "continue" | "verify" | "adhoc" | "blocked";

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

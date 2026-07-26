// Type declarations for view-state.mjs (the fleet terminal-VIEW's honest state
// ramp; milestone 38 / story 06 / task 04). Shipped alongside the .mjs so
// `tsc -b && vite build` stays green — the node suite does NOT type-check the
// fleet TS, so a missing companion breaks the UI build silently.
import type { WorkAssignment } from "../api";

export declare const TERMINAL_VIEW_STATES: {
  WAITING: "waiting";
  STREAMING: "streaming";
  ENDED: "ended";
  DISCONNECTED: "disconnected";
};

export type TerminalViewState = "waiting" | "streaming" | "ended" | "disconnected";

// An unrecognised state LABELS ITSELF rather than impersonating `waiting`
// (QA SHOULD-FIX 2) — so a descriptor's own state is the ramp's four PLUS the
// self-declared `unknown` fallback.
export type TerminalViewDescriptorState = TerminalViewState | "unknown";

export type TerminalViewDescriptor = {
  state: TerminalViewDescriptorState;
  text: string;
  // The viewport-bar REASON (V11), present ONLY on the terminal-assignment WAITING
  // case: `text` stays the short header-chip STATE (`no live output`) while `reason`
  // carries the full `no live output — assignment <label>[ · <note>]`. Absent on
  // every other path — a caller renders `descriptor.reason ?? descriptor.text`.
  reason?: string;
  token: "muted" | "primary" | "destructive" | string;
  reads: "normal" | "failure";
  motion: "none" | "pulse";
  live: boolean;
};

export declare function initialTerminalViewState(): TerminalViewState;
export declare function terminalViewOnBytes(current?: TerminalViewState): TerminalViewState;
export declare function terminalViewOnClose(current?: TerminalViewState): TerminalViewState;
export declare function terminalViewOnError(current?: TerminalViewState): TerminalViewState;
// `assignment` is OPTIONAL and presentation-only (DESIGN §Surface 3 V10, corrected
// §Correction 3): when the view has no bytes AND its assignment settles through
// `assignmentChip` to a terminal label (`done`/`failed` — which is where `withdrawn`
// and reclaimed/`stale` land too), the WAITING copy reads `no live output` in the
// chip and `no live output — assignment <label>[ · <note>]` in the bar, instead of
// promising output that can never arrive. Terminal-ness AND the wording come from the
// chip, never a hand-maintained list. Resolution is never state-filtered — only the
// label changes.
export declare function describeTerminalViewState(
  state: TerminalViewState | string | null | undefined,
  options?: { assignment?: Partial<WorkAssignment> | null }
): TerminalViewDescriptor;

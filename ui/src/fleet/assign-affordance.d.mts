// Type declarations for assign-affordance.mjs (the pure assign-affordance state
// machine; milestone 38 / story 04 / task 06 — DESIGN §Surface 2 A7/A8/A9/A10 and
// the affordance States table, amended 2026-07-24 for F22).
import type { WorkAssignment } from "./api";

export declare const POLL_MS: number;
export declare const ASSIGN_SENT_HOLD_MS: number;
// DG-14 clause 1 — 2 × POLL_MS, derived (never a second literal).
export declare const ASSIGN_TIMEOUT_MS: number;

export declare const ASSIGN_PHASE_REST: "rest";
export declare const ASSIGN_PHASE_SENDING: "sending";
export declare const ASSIGN_PHASE_SENT: "sent";
export declare const ASSIGN_PHASE_REFUSED: "refused";

export declare const ASSIGN_LABEL_REST: "Assign →";
export declare const ASSIGN_LABEL_SENDING: "Assigning…";
export declare const ASSIGN_LABEL_SENT: "Sent";

// DG-13 — the row's binding geometry (A10 amended 2026-07-24).
export declare const ASSIGN_ACTION_LABELS: readonly string[];
export declare const ASSIGN_ACTION_WIDTH_CH: number;
export declare const ASSIGN_PICKER_FLOOR_CH: number;
export declare const ASSIGN_PICKER_CHROME: string;

// DG-14 clause 3 — the timed-out copy, and the honest long form for the `title`.
export declare const ASSIGN_MESSAGE_TIMED_OUT: "no answer — timed out";
export declare const ASSIGN_DETAIL_TIMED_OUT: string;

// DG-13 clause 4 — outcome > holder > all else, keyed by the verb's own code.
export declare const ASSIGN_REFUSAL_COPY: Readonly<Record<string, string>>;
// DG-17 — the message slot's character budget and the copy LADDER that keeps the
// holder atomic (renders whole, or is omitted; never CSS-truncated mid-id).
export declare const ASSIGN_MESSAGE_BUDGET_CH: number;
export declare const ASSIGN_REFUSAL_SHORT_OUTCOME: string;
export declare function assignRefusalLadder(outcome: string, holder: string | null, budgetCh?: number): string;
// DG-20 — region 5's workspace-name budget: the name renders beside a chip only
// when it FITS in full, and is dropped whole otherwise.
export declare const REGION5_NAME_BUDGET_CH: number;
// DG-19 — the chip slot's budget: when `→ <target> · <when> · <note>` exceeds it
// the TAIL is dropped whole rather than ellipsised, so nothing partial renders.
export declare const REGION5_CHIP_SLOT_BUDGET_CH: number;
export declare const REGION5_DRILLIN_ABBREV_AT_CH: number;

export type AssignPhase = "rest" | "sending" | "sent" | "refused";

// A coded refusal envelope as the api client throws it: the verb's own
// `{ ok:false, code, holder }` surfaced onto the Error (src/mesh-ui-serve.mjs
// forwards the verb's extra fields verbatim; ui/src/fleet/api.ts carries them).
export type AssignRefusalCause = {
  message?: string;
  code?: string;
  holder?: string;
  target?: string;
};

export type AssignAffordanceState = {
  phase: AssignPhase;
  error: string | null;
  // The FULL server text behind a shaped `error` — what the message slot puts
  // in its native `title` (DG-13 clause 3).
  detail: string | null;
};

export type AssignAffordanceView = {
  phase: AssignPhase;
  pickerDisabled: boolean;
  pickerPlaceholder: string | null;
  actionLabel: string;
  actionDisabled: boolean;
  actionTone: "primary" | "muted";
  // Phase-INDEPENDENT geometry (DG-13 clauses 1 + 2).
  actionWidth: string;
  pickerMinWidth: string;
  message: string | null;
  messageTitle: string | null;
  messageTone: "destructive" | null;
  holdMs: number | null;
};

export declare function assignAtRest(): AssignAffordanceState;
export declare function assignBegin(): AssignAffordanceState;
export declare function assignSucceeded(): AssignAffordanceState;
export declare function assignRefused(cause: AssignRefusalCause | string | null | undefined): AssignAffordanceState;
export declare function assignTimedOut(): AssignAffordanceState;
export declare function assignAckExpired(state: AssignAffordanceState | null | undefined): AssignAffordanceState;

export declare function assignAffordanceView(ctx: {
  phase?: AssignPhase;
  error?: string | null;
  detail?: string | null;
  hasOptions?: boolean;
  selected?: string;
}): AssignAffordanceView;

export declare function runAssign(
  deps: {
    assign: (ref: string, nodeId: string, workspaceId: string) => Promise<WorkAssignment>;
    onAssigned?: (() => void) | null;
    onState?: ((next: AssignAffordanceState) => void) | null;
    timeoutMs?: number;
  },
  request: { ref: string; nodeId: string; workspaceId: string }
): Promise<
  | { ok: true; record: WorkAssignment }
  | { ok: false; error: unknown; timedOut?: undefined }
  | { ok: false; timedOut: true; error?: undefined }
>;

// Type declarations for resync.mjs (the Resync affordance's state machine —
// milestone 43 / story 04, DESIGN §Surface 1c's Resync state table).

// The affordance's own phase axis. `idle` is BOTH the pristine state and the one
// the acknowledgement decays back into (DESIGN: "back at rest, with nothing left
// over"); the three terminal outcomes all render the control at rest and
// retryable, and differ only in what the message slot says and in which tone.
export type ResyncPhase = "idle" | "sending" | "accepted" | "no-answer" | "unreachable" | "self" | "refused";

// The episode's state, as the consumer holds it. `unreachable` is deliberately
// NOT derivable from `phase`: it is the persistent FACT that survives the
// acknowledgement's decay and rides the provenance line, not the message slot.
export type ResyncState = {
  phase: ResyncPhase;
  code: string | null;
  detail: string | null;
  unreachable: boolean;
  // The WATCH leg, tracked independently of the phase: the acknowledgement
  // decays after one poll interval while the window runs for three, so between
  // them the control is at rest and the surface is still waiting for a push.
  watching: boolean;
};

// The face's coded outcome document (`src/commands/resync.mjs`), passed through
// verbatim by `POST /api/work/resync` at 200 whatever the answer was.
export type ResyncOutcome = {
  ok: boolean;
  code?: string | null;
  ref?: string;
  node?: string | null;
  message?: string | null;
};

// Everything the row renders, derived once. `holdMs`/`watchMs` are the two
// timers the consumer schedules; null schedules nothing.
export type ResyncViewModel = {
  phase: ResyncPhase;
  label: string;
  tone: "primary" | "muted";
  disabled: boolean;
  ariaBusy: boolean;
  ariaLabel: string;
  labelWidth: string;
  message: string | null;
  messageTone: "muted" | "destructive" | null;
  messageTitle: string | null;
  lineNote: string | null;
  holdMs: number | null;
  watchMs: number | null;
  // The REQUEST leg's bound, derived from the board's own poll cadence. Null
  // when the cadence is unknown — the consumer then makes an UNBOUNDED call
  // rather than one abandoned against a number nobody chose.
  requestMs: number | null;
};

// The two bounds, in POLL INTERVALS — never in milliseconds, so neither can
// drift from the cadence it is racing (43/ADR-014).
export declare const RESYNC_REQUEST_INTERVALS: number;
export declare const RESYNC_WATCH_INTERVALS: number;

export declare const RESYNC_PHASE_IDLE: "idle";
export declare const RESYNC_PHASE_SENDING: "sending";
export declare const RESYNC_PHASE_ACCEPTED: "accepted";
export declare const RESYNC_PHASE_NO_ANSWER: "no-answer";
export declare const RESYNC_PHASE_UNREACHABLE: "unreachable";
export declare const RESYNC_PHASE_SELF: "self";
export declare const RESYNC_PHASE_REFUSED: "refused";

export declare const RESYNC_GLYPH: string;
export declare const RESYNC_LABEL_IDLE: string;
export declare const RESYNC_LABEL_SENDING: string;
export declare const RESYNC_LABEL_ACCEPTED: string;
export declare const RESYNC_LABELS: readonly string[];
export declare const RESYNC_LABEL_WIDTH_CH: number;

export declare const RESYNC_CODE_OK: string;
export declare const RESYNC_CODE_PENDING: string;
export declare const RESYNC_CODE_NOT_CONNECTED: string;
export declare const RESYNC_CODE_UNREACHABLE: string;
export declare const RESYNC_CODE_OWNER_IS_SELF: string;
export declare const RESYNC_CODE_NO_OWNER: string;
export declare const RESYNC_LINE_NOTE_UNREACHABLE: string;

// The provenance line's relative age (`12m ago`) as the adjectival form the
// failure messages use (`12m`); null for a shape that does not fit.
export declare function resyncAgeWord(age: string | null | undefined): string | null;

export declare function resyncAtRest(): ResyncState;
export declare function resyncBegin(): ResyncState;
export declare function resyncAnswered(outcome: ResyncOutcome | null | undefined): ResyncState;
export declare function resyncTimedOut(): ResyncState;
export declare function resyncWatchExpired(state: ResyncState | null | undefined): ResyncState;
export declare function resyncAckExpired(state: ResyncState | null | undefined): ResyncState;

export declare function resyncView(ctx?: {
  phase?: ResyncPhase;
  code?: string | null;
  detail?: string | null;
  unreachable?: boolean;
  watching?: boolean;
  node?: string | null;
  ref?: string | null;
  ageWord?: string | null;
  pollMs?: number | null;
}): ResyncViewModel;

export declare function runResync(
  deps: {
    resync: (ref: string) => Promise<ResyncOutcome>;
    onState?: (state: ResyncState) => void;
    // `resyncView`'s `requestMs`. Omitted ⇒ no deadline at all, never a default.
    timeoutMs?: number;
  },
  request: { ref: string },
): Promise<{ ok: boolean; timedOut?: boolean; error?: unknown; document?: ResyncOutcome }>;


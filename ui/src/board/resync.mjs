// The RESYNC affordance's own state machine — milestone 43 / story 04
// (DESIGN §Surface 1c "Resync states — and the honest answer for an offline
// owner"; ARCHITECTURE 43/ADR-006 + ADR-010 R4.2/R4.3).
//
// WHY THIS IS A PURE HELPER, and not logic inside DetailPanel.tsx. The house
// pattern (ui/src/fleet/assign-affordance.mjs, ./runs.mjs, ./freshness.mjs):
// render-logic that must be node:test-exercisable lives in a pure .mjs with a
// .d.mts sibling, and the .tsx is a thin consumer that holds NO transition logic
// of its own. Every label, tone, disabled/busy flag, timer duration and message
// string this affordance ever shows is derived HERE, once.
//
// ── THE ONE SENTENCE THE WHOLE DESIGN HANGS ON ──────────────────────────────
// THE BUTTON REPORTS THE CALL; THE PROVENANCE LINE REPORTS THE DATA. `Requested`
// means the request went out. Only the age resetting and the badge clearing
// prove a fresh copy actually landed — which is exactly why there is NO SUCCESS
// TOAST anywhere in this module and no "resynced!" vocabulary to render one
// with. This is m38's F22 rule verbatim ("it reports the CALL; region 5 reports
// the ASSIGNMENT"), one milestone on: a toast would confirm the CLICK and let
// the operator believe the DATA is fresh.
//
// ── THE FOUR RULES THE STATE TABLE ENCODES ──────────────────────────────────
//  1. MUTED = the world did not answer. DESTRUCTIVE = the request was rejected.
//     An unreachable owner cost us NOTHING — the cached copy is intact and is
//     still the only readable one — so painting it red would over-alarm exactly
//     the condition this milestone exists to normalise. A coded refusal is a
//     fault we own and reads red like every other coded refusal on these
//     surfaces.
//  2. ACKNOWLEDGEMENTS DECAY; FACTS PERSIST. `Requested` decays after exactly
//     one poll interval (`holdMs`). `owner <node> unreachable` is a statement
//     about the WORLD, so it persists on the provenance line (`lineNote`), not
//     in the message slot, until a fresher copy lands or a later attempt
//     re-evaluates it.
//  3. NEVER PRE-DISABLED ON PRESENCE. Nothing here reads a presence signal —
//     the board's wire carries none, presence lags by design, and one rule for
//     both surfaces beats a rule that forks by surface. Attempt, then report.
//  4. THE CACHED COPY IS NEVER HIDDEN BY A FAILURE. Every outcome message names
//     the age of the copy still on screen (`ageWord`), and none of them replaces
//     the provenance facts — the message has its own reserved slot.
//
// ── AND THE BOUND ───────────────────────────────────────────────────────────
// No indefinite spinner, on either leg, and the two legs are DISTINCT:
//   - the REQUEST leg (`RESYNC_REQUEST_TIMEOUT_MS`) bounds the round trip to the
//     face. Past it the affordance stops waiting and reports "no answer".
//   - the WATCH leg (`RESYNC_WATCH_INTERVALS` × the board's poll interval)
//     bounds how long an ACCEPTED request is given for a fresher copy to arrive.
// Folding them into one timeout would silently swallow a slow-but-successful
// push, which is the defect the two-leg split exists to prevent.

// ── the two bounds ──────────────────────────────────────────────────────────

// DESIGN's request round-trip bound ("no indefinite spinner … 10s for the
// request round trip"), expressed in POLL INTERVALS rather than as the
// millisecond literal DESIGN quotes. Two reasons, and the second is why the
// literal is FORBIDDEN rather than merely discouraged:
//
//   (a) the same reasoning m38's assign affordance already fixed for its own
//       hung-POST deadline — "one interval is too eager for a cross-machine
//       POST; two is past the point any answer is still useful";
//   (b) 43/ADR-014's review measured a REAL defect in the fixed form: a bound
//       shorter than the drain cadence made roughly one in three HEALTHY
//       resyncs report "no answer", because the deadline expired before the
//       daemon's own tick could possibly have answered. A bound that does not
//       move with the cadence it is racing is a bound that lies.
//
// TWO intervals, so it stays strictly INSIDE the three-interval watch window and
// the two legs remain distinguishable by construction rather than by arithmetic
// anyone could break.
export const RESYNC_REQUEST_INTERVALS = 2;

// DESIGN's watch window: "a watch window of 3 poll intervals for the pushed copy
// to arrive". Expressed in INTERVALS, never in milliseconds, because the
// interval itself is the BOARD's own poll cadence and is supplied by the
// consumer (`pollMs`) rather than re-declared here. One number, defined where it
// is used, measured where it is consumed — never a second literal beside it.
export const RESYNC_WATCH_INTERVALS = 3;

// ── the phases ──────────────────────────────────────────────────────────────
//
// `idle` covers BOTH the pristine state and the state the acknowledgement decays
// back into: DESIGN's terminal resting state IS the initial one — "back at rest,
// with nothing left over".
export const RESYNC_PHASE_IDLE = "idle";
export const RESYNC_PHASE_SENDING = "sending";
export const RESYNC_PHASE_ACCEPTED = "accepted";
export const RESYNC_PHASE_NO_ANSWER = "no-answer";
export const RESYNC_PHASE_UNREACHABLE = "unreachable";
// 43/ADR-014/E2 — the row is this node's OWN publication, so there is no peer to
// pull from. Muted like every other "the world did not answer" outcome, and its
// own phase because it is a different fact: not "we could not reach them" but
// "there is nobody to reach".
export const RESYNC_PHASE_SELF = "self";
export const RESYNC_PHASE_REFUSED = "refused";

// ── the labels ──────────────────────────────────────────────────────────────
//
// `⟳`, never `↻`. In this product `⟳` already means "fetch the data again"
// (`⟳ sync`, `⟳ refreshed Ns ago`, `⟳ Retry`) while `↻` means "re-run the work"
// (the RUNS tab's `↻ Rerun`). Resync fetches; it does not re-run.
export const RESYNC_GLYPH = "⟳";
export const RESYNC_LABEL_IDLE = `${RESYNC_GLYPH} Resync`;
export const RESYNC_LABEL_SENDING = "Resyncing…";
export const RESYNC_LABEL_ACCEPTED = "Requested";

// Every label the control ever reads. Its inner span reserves the width of the
// LONGEST of them in EVERY state, so a label swap can never reflow the row
// (m38 DG-13 clause 1). DERIVED, so renaming a label cannot leave the width
// behind.
export const RESYNC_LABELS = Object.freeze([RESYNC_LABEL_IDLE, RESYNC_LABEL_SENDING, RESYNC_LABEL_ACCEPTED]);
export const RESYNC_LABEL_WIDTH_CH = Math.max(...RESYNC_LABELS.map((label) => label.length));

// ── the coded outcomes, and the tone each one earns ─────────────────────────
//
// The wire contract is `src/mesh-resync.mjs`'s, read here and nowhere else in
// `ui/`. The mapping onto DESIGN's state table is 1:1 and deliberate:
//
//   resync-requested            → accepted     (the request reached the owner)
//   resync-pending              → no answer    (the request leg's own bound)
//   resync-owner-not-connected  → unreachable  (MUTED — the world did not answer)
//   resync-owner-unreachable    → unreachable  (MUTED)
//   resync-owner-is-self        → SELF         (MUTED — no call was made at all)
//   resync-no-owner             → refused      (DESTRUCTIVE — a fault we own)
//   anything else               → refused      (DESTRUCTIVE, code shown verbatim)
//
// Only a REJECTION is destructive. Everything else is the world failing to
// answer, and the cached copy is intact throughout.
//
// `resync-owner-is-self` is 43/ADR-014's correction, and it earns its own state
// rather than borrowing `owner unreachable`: a row THIS node authored goes stale
// exactly when this node's own publish tick stops, and answering "not connected"
// pointed the operator at a network that was never even consulted. No call is
// made in this case, so no connectivity fact can honestly be reported — the
// answer is that there is no peer to ask.
export const RESYNC_CODE_OK = "resync-requested";
export const RESYNC_CODE_PENDING = "resync-pending";
export const RESYNC_CODE_NOT_CONNECTED = "resync-owner-not-connected";
export const RESYNC_CODE_UNREACHABLE = "resync-owner-unreachable";
export const RESYNC_CODE_OWNER_IS_SELF = "resync-owner-is-self";
export const RESYNC_CODE_NO_OWNER = "resync-no-owner";

// The persistent clause a failed delivery adds to the PROVENANCE LINE (never to
// the message slot, which is where the decaying acknowledgements live). It is a
// fact about the world, so it stays until the world changes.
export const RESYNC_LINE_NOTE_UNREACHABLE = "owner unreachable";

// The one phrase every "we could not reach the owner" outcome uses for the copy
// still on screen, so rule 4 ("a failure never hides the data") is structural
// rather than remembered: the message cannot be composed without naming it.
function copyPhrase(ageWord) {
  return ageWord == null ? "the cached copy" : `the ${ageWord}-old copy`;
}

// resyncAgeWord(age) — the provenance line's relative age (`12m ago`) reduced to
// the adjectival form the messages use (`12m`). Null for any age this shape does
// not fit (`just now`, `yesterday`, an unknown instant), so the message falls
// back to "the cached copy" rather than reading "the yesterday-old copy". The
// AGE ITSELF is never re-derived here — it comes from the product's one
// `relativeTime` formatter, through the freshness ramp.
export function resyncAgeWord(age) {
  if (typeof age !== "string") return null;
  const trimmed = age.replace(/\s*ago$/, "").trim();
  return /^\d+[smhd]$/.test(trimmed) ? trimmed : null;
}

// ── the state transitions ───────────────────────────────────────────────────

// `watching` is deliberately NOT derivable from `phase`, and that is the whole
// two-leg split in one field: the acknowledgement decays back to `idle` after ONE
// poll interval while the watch window runs for THREE, so between them the
// control is at rest and the surface is still legitimately waiting for a pushed
// copy. A single phase axis could not express both at once, and collapsing them
// would either cut the watch short or freeze the button for three intervals.
export function resyncAtRest() {
  return { phase: RESYNC_PHASE_IDLE, code: null, detail: null, unreachable: false, watching: false };
}

// A click. The persistent unreachable clause is RE-EVALUATED by the new attempt
// rather than accumulating a second copy — it is cleared here and re-set only if
// this episode also fails to deliver.
export function resyncBegin() {
  return { phase: RESYNC_PHASE_SENDING, code: null, detail: null, unreachable: false, watching: false };
}

// resyncAnswered(outcome) — the face's coded document (`{ ok, code, node,
// message }`), turned into a phase. Note there is NO path from `sending` back to
// `idle` on success: the button never passes back through `⟳ Resync` between
// `Resyncing…` and `Requested`.
export function resyncAnswered(outcome) {
  const code = typeof outcome?.code === "string" && outcome.code.length > 0 ? outcome.code : null;
  const detail = typeof outcome?.message === "string" && outcome.message.length > 0 ? outcome.message : null;
  // ACCEPTED is the only outcome that arms the watch: it is the only one in which
  // a copy could still be coming. Every other answer is already terminal for the
  // episode, so waiting three more intervals for a push nobody promised would be
  // the "structurally guaranteed no-answer" the watch exists to avoid.
  if (outcome?.ok === true) return { phase: RESYNC_PHASE_ACCEPTED, code, detail, unreachable: false, watching: true };
  if (code === RESYNC_CODE_PENDING) return { phase: RESYNC_PHASE_NO_ANSWER, code, detail, unreachable: false, watching: false };
  if (code === RESYNC_CODE_NOT_CONNECTED || code === RESYNC_CODE_UNREACHABLE) {
    return { phase: RESYNC_PHASE_UNREACHABLE, code, detail, unreachable: true, watching: false };
  }
  // No call was made, so NO persistent connectivity clause is written to the
  // line — `owner unreachable` would be a claim about a network nobody touched.
  if (code === RESYNC_CODE_OWNER_IS_SELF) {
    return { phase: RESYNC_PHASE_SELF, code, detail, unreachable: false, watching: false };
  }
  return { phase: RESYNC_PHASE_REFUSED, code, detail, unreachable: false, watching: false };
}

// The REQUEST leg's deadline, and the transport failing outright, are the same
// answer: the world did not answer. Muted, retryable, and honest — the request
// may still have reached the owner, so nothing here claims it did not.
export function resyncTimedOut() {
  return { phase: RESYNC_PHASE_NO_ANSWER, code: RESYNC_CODE_PENDING, detail: null, unreachable: false, watching: false };
}

// The WATCH leg's deadline: the request WAS accepted, and no fresher copy
// arrived inside the window. Same terminal outcome, same tone — the difference
// between the two legs is which bound elapsed, never what the operator is told
// about their data. It fires against a control that has usually already decayed
// back to `idle` (the hold is one interval, the window three), which is exactly
// why it is guarded on `watching` and not on the phase.
export function resyncWatchExpired(state) {
  if (state?.watching !== true) return state ?? resyncAtRest();
  return {
    phase: RESYNC_PHASE_NO_ANSWER,
    code: RESYNC_CODE_PENDING,
    detail: null,
    unreachable: state.unreachable === true,
    watching: false,
  };
}

// The acknowledgement hold expiring. ONLY `Requested` decays: a terminal outcome
// is a fact the operator is reading, and a stray timer may never blank it. The
// watch keeps running underneath — the decay of an acknowledgement is not the
// end of the episode, only of its acknowledgement.
export function resyncAckExpired(state) {
  return state?.phase === RESYNC_PHASE_ACCEPTED
    ? { ...resyncAtRest(), unreachable: state.unreachable === true, watching: state.watching === true }
    : (state ?? resyncAtRest());
}

// ── the ONE derivation of everything the row renders ────────────────────────
//
// `resyncView(ctx)` — labels, tones, the two timers and the message, for one
// phase. Three properties are PHASE-INDEPENDENT by construction (there is no
// `phase` anywhere in their expressions), which is what makes the geometry rules
// structural rather than remembered: `labelWidth` (a label swap may never move
// another element), the message slot's existence (it is a permanently-present
// live region, so it is the CONSUMER that always renders it — this only supplies
// its text), and `ariaLabel` (the control names its object in every state).
//
//   `node`    — the owning node the request is aimed at (from the provenance).
//   `ref`     — the item, so the control's accessible name states its object.
//   `ageWord` — the adjectival age of the copy on screen (`12m`), so every
//               failure message names the data the operator is still looking at.
//   `pollMs`  — the BOARD's own list-poll cadence, supplied by the consumer.
//               The acknowledgement hold IS that number (one number, not two:
//               "a hold of exactly one poll interval is what guarantees there is
//               never a moment between the click and a confirmation in which the
//               surface says nothing"), and the watch window is three of them.
export function resyncView(ctx = {}) {
  const phase = ctx.phase ?? RESYNC_PHASE_IDLE;
  const node = typeof ctx.node === "string" && ctx.node.length > 0 ? ctx.node : null;
  const ref = typeof ctx.ref === "string" && ctx.ref.length > 0 ? ctx.ref : null;
  const ageWord = typeof ctx.ageWord === "string" && ctx.ageWord.length > 0 ? ctx.ageWord : null;
  const pollMs = typeof ctx.pollMs === "number" && Number.isFinite(ctx.pollMs) && ctx.pollMs > 0 ? ctx.pollMs : null;
  const busy = phase === RESYNC_PHASE_SENDING;
  const held = phase === RESYNC_PHASE_ACCEPTED;

  const label = busy ? RESYNC_LABEL_SENDING : held ? RESYNC_LABEL_ACCEPTED : RESYNC_LABEL_IDLE;
  const owner = node ?? "the owning node";

  // The message slot's copy, outcome-first. Every non-empty rung names either
  // the node or the code FIRST, and the muted rungs additionally name the copy
  // still on screen — so no message can be read as "your data is gone".
  let message = null;
  let messageTone = null;
  if (held) {
    message = `waiting for ${owner} to push`;
    messageTone = "muted";
  } else if (phase === RESYNC_PHASE_NO_ANSWER) {
    message = `no answer from ${owner} — still showing ${copyPhrase(ageWord)}`;
    messageTone = "muted";
  } else if (phase === RESYNC_PHASE_UNREACHABLE) {
    message = `owner ${owner} unreachable — showing ${copyPhrase(ageWord)}`;
    messageTone = "muted";
  } else if (phase === RESYNC_PHASE_SELF) {
    // Outcome first, and MUTED: nothing is broken, nothing was refused, and the
    // cached copy is intact — it is simply this node's own publication, which
    // this node's own publish tick is what refreshes.
    message = `no peer to ask — ${owner} is this node, still showing ${copyPhrase(ageWord)}`;
    messageTone = "muted";
  } else if (phase === RESYNC_PHASE_REFUSED) {
    // The ONE destructive rung. `resync-no-owner` has its own sentence because
    // it is DESIGN's own worked example and it reads as an outcome already;
    // every other code is stated outcome-first with the code after it, so an
    // unknown refusal is still legible without being re-worded on a guess.
    message = ctx.code === RESYNC_CODE_NO_OWNER || ctx.code == null
      ? "no owning node recorded"
      : `resync refused — ${ctx.code}`;
    messageTone = "destructive";
  }

  return {
    phase,
    label,
    // DESIGN's tone rule for the CONTROL: `primary` at rest and after every
    // terminal outcome (it is retryable — never wedged), `muted` while the call
    // is in flight or held. The muted state DROPS the primary tint rather than
    // adding anything to it, which makes it the quietest state the row renders.
    tone: busy || held ? "muted" : "primary",
    disabled: busy || held,
    // `aria-busy` belongs to the IN-FLIGHT leg alone: `Requested` is a held
    // acknowledgement of a COMPLETED call, not an operation still running.
    ariaBusy: busy,
    // The control NAMES ITS OBJECT (a11y rule 4). A bare "Resync" is not a
    // sufficient name on a panel that shows one item among many.
    ariaLabel: `Resync ${ref ?? "this item"} from ${owner}`,
    // m38 DG-13 clause 1 — no `phase` in this expression, by construction.
    labelWidth: `${RESYNC_LABEL_WIDTH_CH}ch`,
    message,
    messageTone,
    // The full server sentence, for the slot's native `title` — the truncating
    // slot shows the shaped copy, and nothing is discarded, only ranked.
    messageTitle: message == null ? null : (ctx.detail ?? message),
    // The PERSISTENT clause the provenance line carries. Unlike the message it
    // does not decay: it is a fact about the world, true until the world changes.
    lineNote: ctx.unreachable === true ? RESYNC_LINE_NOTE_UNREACHABLE : null,
    // The two timers the consumer must schedule, on their two INDEPENDENT keys.
    // A null schedules nothing, which is what makes "only an acknowledgement
    // decays" and "the watch window is armed only by an ACCEPTED request"
    // structural rather than remembered — and keying them separately is what
    // stops the one-interval hold from cancelling the three-interval watch.
    holdMs: held && pollMs != null ? pollMs : null,
    watchMs: ctx.watching === true && pollMs != null ? pollMs * RESYNC_WATCH_INTERVALS : null,
    // The REQUEST leg's bound, derived from the same one number. Unlike the two
    // timers above it is PHASE-INDEPENDENT: it is a property of the call the
    // consumer is about to make, not of the state it is in, and it must be the
    // same on every attempt.
    requestMs: pollMs == null ? null : pollMs * RESYNC_REQUEST_INTERVALS,
  };
}

// ── the click orchestration ─────────────────────────────────────────────────
//
// runResync(deps, request) — the WHOLE episode, so the production component
// holds none of it: begin → POST → (accepted | no-answer | unreachable |
// refused), bounded by the REQUEST leg's deadline.
//
// There is deliberately NO AbortController, NO retry and NO second cadence.
// Aborting would make a request that may already have reached the owner
// ambiguous, and the honest report of a deadline is "no answer", not "it
// failed". A LATE answer is terminal for the affordance: it may not resurrect
// `Requested` and may not overwrite the outcome the operator is already reading
// (the m38 DG-14 clause 5 lesson, relocated to this axis).
const RESYNC_DEADLINE = Symbol("resync-deadline");

// `timeoutMs` is REQUIRED from the caller rather than defaulted here — it is
// `resyncView`'s `requestMs`, derived from the board's own cadence, and a
// default would be exactly the fixed literal 43/ADR-014 removed. A caller that
// supplies none gets NO deadline rather than a guessed one: the honest failure
// is a request that waits, not one abandoned against a number nobody chose.
export async function runResync({ resync, onState, timeoutMs } = {}, { ref } = {}) {
  onState?.(resyncBegin());

  // Normalised to a promise so a synchronously-throwing client takes the same
  // path as a rejecting one.
  const call = Promise.resolve().then(() => resync(ref));

  // Swallowed deliberately, and wired before the race so it can never be missed:
  // a LATE answer changes NOTHING on the surface. Only a fresher COPY is allowed
  // to change what the row says — which is "no success toast" seen from the
  // other end. (Unlike m38's assign, there is no A8 re-load to fire either: the
  // watch window's own bounded poll is what looks for the pushed copy.)
  call.then(
    () => { /* a late acceptance does not resurrect `Requested` */ },
    () => { /* nor does a late refusal overwrite the no-answer the operator reads */ },
  );

  const answer = call.then((document) => ({ document }), (error) => ({ error }));
  const bounded = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0;
  const deadline = bounded
    ? new Promise((resolve) => {
      const timer = setTimeout(() => resolve(RESYNC_DEADLINE), timeoutMs);
      call.then(() => clearTimeout(timer), () => clearTimeout(timer));
    })
    : null;

  const outcome = await (deadline == null ? answer : Promise.race([answer, deadline]));

  if (outcome === RESYNC_DEADLINE) {
    onState?.(resyncTimedOut());
    return { ok: false, timedOut: true };
  }
  if ("error" in outcome) {
    // A transport-level failure carries the route's coded envelope when it has
    // one (the api client attaches `code`), and is otherwise an unnamed refusal.
    const error = outcome.error;
    const answered = resyncAnswered({
      ok: false,
      code: typeof error?.code === "string" ? error.code : null,
      message: typeof error?.message === "string" ? error.message : null,
    });
    onState?.(answered);
    return { ok: false, error };
  }
  onState?.(resyncAnswered(outcome.document));
  return { ok: outcome.document?.ok === true, document: outcome.document };
}


// The fleet terminal-VIEW's state ramp (milestone 38 / story 06 / task 04;
// BLOCKER F-38.06c. DESIGN §Surface 3 — the terminal-view States table + V7/V9).
// A framework-free ESM module — no React, no DOM, no socket, no clock — the
// terminal-view sibling of ui/src/board/terminal/dock-state.mjs, whose ramp shape
// (`state` + a describe() that names the token and the text) it deliberately
// mirrors rather than inventing a fleet-local one.
//
// THE HONEST-STATE AXIS. The mirror is EPHEMERAL and never a system of record
// (ADR-014), so "no bytes yet" is the DESIGNED cold-start, not a failure:
//   V7 — before the first byte (fresh subscribe, or a mirror rebuilt empty) the
//        view reads an honest `waiting for output`. NOT an endless spinner, NOT a
//        fabricated line, NOT a red error.
//   V9 — a session that ended, or a stream that dropped, SAYS so (`stream ended` /
//        `disconnected`) instead of freezing on the last frame as if still live.
//        A dead stream must never masquerade as a live one.
// Only a genuine TRANSPORT failure reads as a failure, on the pre-existing fleet
// read-failure token (`destructive`) — no terminal-local error primitive.
import { assignmentChip } from "../assignments.mjs";

// The four states of a subscribed view (the DESIGN States table, minus
// `multiplexed` and `unresolvable`, which are not states of ONE view: multiplexing
// is two independent views keyed by their own tuple, and an unresolvable tuple
// means no view is rendered at all — see stream.mjs's resolveTerminalStream).
export const TERMINAL_VIEW_STATES = {
  WAITING: "waiting",
  STREAMING: "streaming",
  ENDED: "ended",
  DISCONNECTED: "disconnected",
};

// TERMINAL-ness is NOT a second vocabulary here (DESIGN §Surface 3 V10, corrected
// 2026-07-23 §Correction 3). A hand-maintained set of terminal `state` strings drifts
// the moment a state is added — and it did: the original `{done, failed, reclaimed}`
// set LEAKED `withdrawn` (operator-stop, ADR-001) and `stale`, so those two terminal
// assignments sat on `waiting for output` forever. The m35 `assignmentChip(row)`
// (../assignments.mjs) ALREADY decides which states are terminal AND owns the words:
// `withdrawn` reads `failed`, `reclaimed`/`stale` (with `reclaimedAt`) read `failed`
// + a `· reclaimed` note, an unrecognised state degrades to `unknown`. So the copy
// below derives BOTH terminal-ness and the wording from that ONE chip:
//   TERMINAL  iff  chip.label === "done" || chip.label === "failed".
// Everything else — including the forward-compat `unknown` — is NOT terminal and
// keeps `waiting for output` (we may not assert output is impossible for a state
// neither this module nor the chip recognises). Read ONLY by the copy below; the
// resolution stays tuple-only (V10 is explicit that a state FILTER would hide a real
// captured stream) — it is the LABEL that must tell the truth, not the routing.
function terminalAssignmentReason(assignment) {
  const chip = assignmentChip(assignment);
  if (chip.label !== "done" && chip.label !== "failed") return null;
  const note = chip.note ? ` · ${chip.note}` : "";
  return `no live output — assignment ${chip.label}${note}`;
}

// The fixed ramp. `token` names a THEME token resolved through the SAME
// `runChipClasses(token)` map the run chip / assignment chip already use — never a
// hex, never a fleet-local palette (V3/S5). `reads` says whether this state is a
// NORMAL one or a genuine failure: only `disconnected` is a failure, so an empty
// or ended stream can never be painted as an error (V7/V9). `motion` is "none"
// everywhere except the genuinely-live state — in particular WAITING carries no
// motion at all, so the cold-start can never render as a spinner-forever.
const RAMP = {
  [TERMINAL_VIEW_STATES.WAITING]: {
    state: TERMINAL_VIEW_STATES.WAITING,
    text: "waiting for output",
    token: "muted",
    reads: "normal",
    motion: "none",
    live: false,
  },
  [TERMINAL_VIEW_STATES.STREAMING]: {
    state: TERMINAL_VIEW_STATES.STREAMING,
    text: "streaming",
    token: "primary",
    reads: "normal",
    motion: "pulse",
    live: true,
  },
  [TERMINAL_VIEW_STATES.ENDED]: {
    state: TERMINAL_VIEW_STATES.ENDED,
    text: "stream ended",
    token: "muted",
    reads: "normal",
    motion: "none",
    live: false,
  },
  [TERMINAL_VIEW_STATES.DISCONNECTED]: {
    state: TERMINAL_VIEW_STATES.DISCONNECTED,
    text: "disconnected",
    token: "destructive",
    reads: "failure",
    motion: "none",
    live: false,
  },
};

// An unrecognised/absent state LABELS ITSELF (QA SHOULD-FIX 2, 2026-07-23). It used
// to degrade to the WAITING descriptor — so a state this module has not learned yet
// rendered the words `waiting for output`, asserting a specific, checkable fact
// ("bytes are still plausibly coming") that nothing had established. That is the
// milestone's own anti-lie discipline broken in miniature, and it is NOT what the
// house idiom does: fleet/assignments.mjs's `UNKNOWN_CHIP` and the board run chip's
// fallback both read the literal word `unknown` on the quiet muted token. This
// mirrors them verbatim — forward-compatible (never throws), quiet (never a red
// error), and honest (it says it does not know instead of impersonating a state it
// does know).
const UNKNOWN = {
  state: "unknown",
  text: "unknown",
  token: "muted",
  reads: "normal",
  motion: "none",
  live: false,
};

// The initial state of a view that has just subscribed: waiting, no byte yet.
export function initialTerminalViewState() {
  return TERMINAL_VIEW_STATES.WAITING;
}

// The first (and every subsequent) PTY byte → streaming live. Bytes arriving after
// an `ended`/`disconnected` state legitimately revive the view — the source is
// asserting liveness again, and V9's rule is about never showing a liveness the
// source no longer asserts, not the reverse.
export function terminalViewOnBytes() {
  return TERMINAL_VIEW_STATES.STREAMING;
}

// A clean socket close → ended. An ALREADY-disconnected view stays disconnected:
// the close that follows a transport error is that error's own tail, and
// relabelling it "ended" would launder a failure into a clean finish.
export function terminalViewOnClose(current) {
  return current === TERMINAL_VIEW_STATES.DISCONNECTED
    ? TERMINAL_VIEW_STATES.DISCONNECTED
    : TERMINAL_VIEW_STATES.ENDED;
}

// A transport failure (socket error / refused upgrade) → disconnected, legibly.
export function terminalViewOnError() {
  return TERMINAL_VIEW_STATES.DISCONNECTED;
}

// describeTerminalViewState(state, { assignment }) — the state → descriptor mapping
// the view renders. An unknown/absent state degrades to the quiet self-labelling
// UNKNOWN form above (never throws — the forward-compatible fallback dock-state.mjs /
// assignments.mjs both keep), because "we do not recognise this" must never surface
// as a red error.
//
// `assignment` is OPTIONAL and PRESENTATION-ONLY (DESIGN §Surface 3 V10, ruled
// 2026-07-23 — GAP-3; corrected §Correction 3). `waiting for output` is a PROMISE:
// honest while the run could still speak, and the same species of lie as a stuck
// `working` once the assignment has finished — the operator sits watching a window
// that will never move. So when (and ONLY when) the view has received NO bytes AND
// its assignment settles through `assignmentChip` to a terminal label, the copy
// tells the truth, on the SAME muted token, with no new primitive and no new state —
// it is the same WAITING state, told truthfully. The CHIP/BAR split (V11):
//   - `text` carries the short STATE for the header chip: `no live output` (14 chars,
//      in-family and scannable — a chip that grows into a sentence wraps the header);
//   - `reason` carries the full REASON for the viewport bar: `no live output —
//      assignment failed · reclaimed` (the m35 ramp's own word + its trailing note).
// A caller renders `descriptor.text` in the chip and `descriptor.reason ?? text` in
// the bar; on every non-terminal path `reason` is absent and the bar falls back.
//
// Everything else is deliberately untouched — the stream is still RESOLVED by the
// (nodeId, sessionId) tuple alone, the toggle is still offered (an operator may
// legitimately want to look and find it quiet), and a view that DID receive bytes
// keeps its own ramp (`streaming` / `stream ended`), which is a stronger fact than
// the assignment's state.
export function describeTerminalViewState(state, { assignment } = {}) {
  const descriptor = { ...(RAMP[state] ?? UNKNOWN) };
  if (descriptor.state !== TERMINAL_VIEW_STATES.WAITING) return descriptor;
  const reason = terminalAssignmentReason(assignment);
  if (reason == null) return descriptor;
  return { ...descriptor, text: "no live output", reason };
}

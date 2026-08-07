// The SURFACE → SHELL CHANNEL (milestone 45 / story 03; ADR-005's contract points 3 and 5).
//
// The shell owns three things a mounted surface needs to reach: the surface SLOT in the top
// bar, the NOTICE RAIL above it, and the one fullscreen door. This module is how a surface
// reaches them — a tiny framework-free store, with no React and no DOM, so the shell's half
// stays testable and the surfaces stay ignorant of the shell's internals.
//
// WHY A STORE AND NOT A PROP OR A CONTEXT, stated because both are the obvious alternatives:
//   - a PROP would mean the shell passes each surface a handle, and task 00's own scenario
//     forbids it in terms ("no surface is passed a route, a shell handle or a mode value it
//     did not receive before"). It would also make every surface's signature a shell
//     dependency, which is how 46, 47 and 49 end up renegotiating the shell to ship;
//   - a React CONTEXT would put the channel inside the framework, where this repo's headless
//     harness cannot reach it (test/support/mini-react.mjs implements the five hooks the
//     production surfaces use and no context), so the fleet's and the board's existing
//     behavioural suites would have to be rewritten around a shell they do not mount.
//
// THE DEGRADED PATH IS THE POINT, not a fallback. When NO shell is present — which is exactly
// what test/support/{fleet,board}-app-harness.mjs do, mounting the surface COMPONENT directly
// — a contribution renders IN PLACE, where the surface's own bar renders it today. So the
// harnesses need no edit, every existing behavioural suite keeps its expectations, and the
// surface is honest when mounted alone.
//
// Driven headlessly by test/shell-regions.test.mjs (the two contribution regions, through the
// REAL shell and the REAL surfaces) and test/shell-not-found-and-fullscreen.test.mjs (the
// fullscreen door).

// The two contribution regions a surface may fill. The names are constants for the same
// reason the region names are: a string typed twice is a string that disagrees once.
export const SLOT_SURFACE = "surface-slot";
export const SLOT_NOTICE = "notice-rail";

// Whether an app shell exists in this bundle at all. Declared at Shell.tsx's MODULE scope,
// not in an effect: a surface asks this question while RENDERING its own bar, which happens
// before any parent effect has run, so an effect-time flag would make every surface render
// its contribution in place on the first pass and then move it — the one thing DESIGN's
// binding rail 2 forbids.
let shellPresent = false;

// The shell's delivery handler, attached while the Shell component is mounted.
let deliver = null;

// Contributions live here between a surface publishing one and the shell reading it, keyed by
// region. At most ONE notice at a time (DESIGN §The chrome budget clause 4 — that cap is
// load-bearing for the 25% bound) and one slot contribution: the routed surface is one
// surface, and a second contributor would be a second surface mounted at once, which the
// content region does not allow.
const contributions = new Map();

export function declareShellPresent() {
  shellPresent = true;
}

export function hasShellHost() {
  return shellPresent;
}

// attachShellHost(handler) — the Shell component's subscription, returning its own detach.
// The handler is called with the region whose contribution changed; the shell then reads it
// back with `contributionFor`.
export function attachShellHost(handler) {
  deliver = typeof handler === "function" ? handler : null;
  return () => {
    if (deliver === handler) deliver = null;
  };
}

// contribute(region, node) — publish, and return the release that withdraws it. A surface
// calls this from an effect and returns the release as the effect's cleanup, so a surface
// that unmounts takes its contribution with it and never leaves a control in a bar belonging
// to a surface that is gone.
export function contribute(region, node) {
  contributions.set(region, node);
  deliver?.(region);
  return () => {
    if (contributions.get(region) !== node) return;
    contributions.delete(region);
    deliver?.(region);
  };
}

export function contributionFor(region) {
  return contributions.get(region) ?? null;
}

// Test-only reset. Named for what it is rather than hidden behind a flag: the store is module
// state, and a suite that mounted a shell must be able to hand the next one a clean one.
export function resetShellBus() {
  shellPresent = false;
  deliver = null;
  contributions.clear();
}

// ─────────────────────────────────────────────────── the fullscreen request ───
//
// ADR-005 [Build-1]: a surface ASKS the shell to present a LIVE NODE; it does not build its
// own overlay and it does not hand over a React element to be re-rendered somewhere else.
// The request therefore carries the node itself — `node` is a real DOM element the shell
// ADOPTS (re-parents into the overlay region and returns to `home` on dismiss), which is what
// guarantees one xterm, one socket, one PTY through both transitions.
//
// Nothing in milestone 45 calls this: the one fullscreen overlay that exists today
// (FleetTerminalView.tsx:412) is the named, shrink-only exemption that retires with m46, and
// m46 is the caller this door is built for. It is here, with its shape fixed, so that m46
// arrives to a contract rather than to a negotiation.
let fullscreenListener = null;

export function attachFullscreenHost(handler) {
  fullscreenListener = typeof handler === "function" ? handler : null;
  return () => {
    if (fullscreenListener === handler) fullscreenListener = null;
  };
}

// requestFullscreen({ id, label, node, home, opener, claimsEscape, onLayout }) — ask the shell
// to present. Returns a dismiss function, so the caller never needs to name the slot again.
//
//   node        — the LIVE DOM element to adopt. Presenting must not unmount, remount, re-key
//                 or re-create the occupant, and dismissing must return the SAME node to
//                 `home`.
//   home        — where the node came from, so dismissal can put it back exactly there.
//   opener      — the control that opened it: focus returns THERE on dismissal, never to the
//                 document body.
//   claimsEscape— [Build-2] an INTERACTIVE occupant may claim `Escape` (m46's terminal
//                 forwards stdin, so `Esc` is a live keystroke for the TUI on the far end).
//                 The visible exit control stays mandatory either way — for a claiming
//                 occupant it is the only remaining exit.
//   onLayout    — called after present AND after dismiss, one frame later, so a surface that
//                 sizes itself to its box re-measures once its new box is live.
export function requestFullscreen(request) {
  fullscreenListener?.({ type: "present", occupant: request });
  // The returned dismiss is CLOSED OVER THIS REQUEST'S ID, and the shell checks it — see
  // `dismissFullscreen`. That is what makes handing a dismiss function to a caller safe.
  return () => dismissFullscreen(request?.id);
}

// dismissFullscreen(id) — dismiss the occupant with THIS id. A dismiss whose id is not the
// occupant currently presented is a NO-OP, exactly like dismissing an empty slot: no tick, no
// focus move, no teardown.
//
// THE ID IS NOT OPTIONAL DECORATION, and the case is m46's. Occupants never stack — a second
// request REPLACES the first — so the moment a second terminal is presented, the first
// terminal's component is still holding a live dismiss function for a session that is no
// longer on screen. It fires on unmount, on a socket close, on a stray click; without the id
// it would tear down SOMEONE ELSE'S fullscreen, and the operator would watch the terminal
// they are typing into vanish for a reason that is three components away. The shell's own two
// exits (`Escape`, the visible exit control) pass no id and target whatever is presented,
// which is correct by construction: both are properties of the presented state.
export function dismissFullscreen(id) {
  fullscreenListener?.({ type: "dismiss", id, via: "control" });
}

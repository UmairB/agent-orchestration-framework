// The ENTRY'S DECISION (milestone 45 / story 03, task 00; ADR-001, ADR-002, ADR-003).
//
// `ui/src/main.tsx` stops being a surface and becomes three acts: mount, apply the legacy
// translation ONCE, render the shell around the surface the route table names. THIS module is
// the middle act's decision, extracted so it can be exercised at all: the "exactly once,
// before the first render" clauses have no headless channel if the decision stays inline in
// the entry beside `createRoot`, and task 00's own FEASIBILITY note says so in terms — a
// `@executable` scenario that needs a browser is the failure mode this milestone's test
// posture exists to avoid.
//
// So the entry's decision is a pure function of the incoming URL PARTS, in exactly the shape
// ui/src/fleet/scope.mjs:42 hands `withScopeParam`'s result back for the caller to wire into
// history:
//
//     entryPlanFor({ pathname, search, hash })
//       → { replace: { pathname, search, hash } | null, surface, route, address, history }
//
// main.tsx does nothing with it but call `applyEntryPlan` and hand `surface` to the shell. It
// takes NO origin, host, port or server-flag input — one bundle, one table, three origins
// (ADR-002's origin-blind rule, stated as the sharpest observable there is: the decision has
// nowhere to PUT an origin).
//
// ORDER IS THE WHOLE POINT. The surface is selected from the POST-rewrite address, never from
// the one that arrived. Selecting first would render the shell landing for every legacy
// address this system has ever advertised — their pathname is a bare "/" — and it would look
// like a harmless reordering in review.
//
// Driven headlessly by test/shell-entry-plan.test.mjs.
import { legacyRedirectFor, routeFor } from "./routes.mjs";

// The three parts, normalised the way a browser's `location` presents them and the way a
// hand-written test writes them. A missing part is the empty string, never `undefined`: the
// caller passes this straight to `history.replaceState`, and `"undefined"` in an address bar
// is the class of defect that only shows up in production.
function partsOf(input) {
  const source = input == null || typeof input !== "object" ? {} : input;
  return {
    pathname: typeof source.pathname === "string" && source.pathname.length > 0 ? source.pathname : "/",
    search: typeof source.search === "string" ? source.search : "",
    hash: typeof source.hash === "string" ? source.hash : "",
  };
}

// The one place a plan's address becomes a string. Kept HERE rather than at the call site
// because `legacyRedirectFor` returns a `search` that already carries its own "?" (or the
// empty string) and a `hash` verbatim — composing that by hand is how a missing "#" corrupts
// a board deep link, which is exactly the shape QA measured (F-45-01-G).
export function addressToString({ pathname, search, hash }) {
  return `${pathname}${search}${hash}`;
}

export const HISTORY_REPLACE = "replace";
export const HISTORY_NONE = "none";

// entryPlanFor(parts) — the whole decision, as one value.
//
//   replace  — the canonical parts to `history.replaceState` to, or null when the address is
//              already canonical. NEVER a push: a pushed entry makes the back button bounce
//              between the legacy URL and the canonical one, and the legacy URL then
//              re-redirects. A replace leaves the history stack exactly as deep as the
//              operator's own navigation made it.
//   surface  — the route id (ADR-002's binding `id` column) the shell mounts.
//   address  — the parts the SURFACE is handed: the rewritten ones when there was a rewrite,
//              and byte-identically what arrived when there was not.
//
// IT IS IDEMPOTENT BY CONSTRUCTION, because `legacyRedirectFor` is: re-deciding over a plan's
// own output asks for nothing further, so the rewrite cannot loop (and a `replaceState` loop
// is invisible until the address bar starts flickering).
//
// THE ONE CONTESTED ROW, settled and stated here as task 00 asks. A legacy `mode` on an
// address that ALREADY carries a path — `/fleet?mode=board` — resolves to the PATH's surface
// (Fleet), and nothing is rewritten: the stray parameter is carried through untouched like
// every other parameter the router has never heard of. Two reasons, and story 01's committed
// route module already rules the same way: a legacy query parameter that could override a
// real address is precisely backwards for a milestone whose point is that the address bar is
// the truth; and deleting it would mean the router treating `mode` as special on an address
// where it is not a selector, i.e. rewriting an address that nothing asked to be rewritten.
// Nothing in the wild produces this shape — no producer emits a canonical path AND a `mode` —
// so it is a robustness choice, not a compatibility one. What it is NOT is a 404: an address
// that names a real surface never means nothing.
export function entryPlanFor(parts) {
  const incoming = partsOf(parts);
  const replace = legacyRedirectFor(incoming);
  const address = replace === null ? incoming : { pathname: replace.pathname, search: replace.search, hash: replace.hash };
  const route = routeFor(address.pathname);

  return Object.freeze({
    replace: replace === null ? null : Object.freeze({ ...replace }),
    history: replace === null ? HISTORY_NONE : HISTORY_REPLACE,
    // The surface is read from the POST-rewrite address. Never from `incoming`.
    surface: route.id,
    route,
    address: Object.freeze(address),
    url: addressToString(address),
  });
}

// applyEntryPlan(plan, history) — the plan's ONE side effect, lifted out of `main.tsx` so it
// is drivable (QA F-45-03-E). Returns the address it wrote, or null when it wrote nothing.
//
// WHY THIS IS A FUNCTION AND NOT TWO LINES AT THE RENDER ROOT. The clauses task 00 asserts are
// about the WIRING — "exactly once", "a replace and never a push", "the plan's own address,
// composed by the one composer" — and every one of them is a property of the call, not of the
// plan. Left inline beside `createRoot` they had no headless channel at all: a suite would be
// asserting that a value is correct and hoping the entry passes it on. Here a spy history sees
// the whole obligation.
//
// It is defensive about `history` for the same reason the shell is about `window`: this runs
// BEFORE the first render, and a throw here is a blank page — on every origin at once.
export function applyEntryPlan(plan, history) {
  if (plan == null || plan.replace == null) return null;
  const url = addressToString(plan.replace);
  // `replaceState`, NEVER `pushState`: a pushed entry makes the back button bounce between the
  // legacy URL and the canonical one, and the legacy URL then re-redirects. `null` state and
  // `""` title are the two arguments every browser ignores and every implementation requires.
  if (typeof history?.replaceState === "function") history.replaceState(null, "", url);
  return url;
}

// ───────────────────────────────────────────── which surface the entry mounts ──
//
// The two route ids the SHELL renders itself. They are absent from the entry's surface map on
// purpose — `/` is milestone 49's terminals home (the shell renders its placeholder today) and
// `not-found` has no path at all — so "no surface component for this id" is a NORMAL condition
// for these two and a DEFECT for anything else.
export const SHELL_RENDERED_ROUTES = Object.freeze(["landing", "not-found"]);

// surfaceMountFor(routeId, surfaceIds) — what the entry does with the route it resolved.
//
// THE FAILURE THIS EXISTS TO MAKE LOUD. The entry's surface map is keyed by the route table's
// `id` column, and the two are edited in different files by different milestones: 47 and 49
// both add a table row. A row whose id nothing maps used to mount `null` — a shell with an
// EMPTY `<main>`, no error, no log, nothing in the address bar to explain it. That is the
// worst failure shape this milestone can produce, because it looks exactly like a surface
// whose own content is empty, and the operator has no way to tell which. It is now the shell's
// own surface-failed state, which NAMES the surface and offers the retry — the same treatment
// a code-split chunk that did not arrive gets, and for the same reason: from the operator's
// side those two conditions are the same condition.
export function surfaceMountFor(routeId, surfaceIds = []) {
  const ids = Array.isArray(surfaceIds) ? surfaceIds : Object.keys(surfaceIds ?? {});
  const shellRenders = SHELL_RENDERED_ROUTES.includes(routeId);
  const known = ids.includes(routeId);
  return Object.freeze({
    routeId,
    // The shell renders this route itself; there is nothing to mount and nothing is wrong.
    shellRenders,
    // Mount the surface component this id names.
    mounts: !shellRenders && known,
    // A route id the entry has no surface for: the shell's failed state, naming it.
    surfaceFailed: !shellRenders && !known,
  });
}

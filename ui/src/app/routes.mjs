// The ROUTE MODEL (milestone 45 / story 01; ARCHITECTURE ADR-001, ADR-002, ADR-003,
// ADR-006). ONE hand-rolled, pure route table that says what a URL means, plus the ONE
// legacy translation that says what every `?mode=` URL this product has ever advertised
// becomes. No React, no DOM, no globals of its own — the caller passes the URL parts IN
// and wires the answer to the History API. That is not a style preference: this repo has
// NO React test harness (no vitest, no testing-library), so a route decision that can only
// be exercised through a component is a route decision with no tests. The house pattern is
// ui/src/fleet/scope.mjs + ui/src/board/{runs,action,freshness}.mjs, driven headlessly by
// node:test — here, test/app-routes.test.mjs.
//
// It lives in ui/src/app/ — deliberately NEITHER surface's folder. The shell and the
// router are shared by construction; a shared primitive placed inside board/ or fleet/ is
// TECH_DEBT item 18a, which this milestone is the first to have a reason to start paying.
//
// Pinned by test/arch/acd-route-logic-framework-free.test.mjs (React-free, DOM-free,
// node-loadable; names no query key but `mode`; never imports the scope helper) and
// test/arch/acd-ui-single-route-table.test.mjs (this is the ONE table, and the render root
// selects through it and by no other means).

// ------------------------------------------------------------ the table -------
//
// ADR-002. FOUR addressable paths plus ONE shared not-found entry, and the `id` column is
// BINDING — a route entry a caller cannot name is a route entry no test can confirm.
//
//   "/"        landing    the shell landing (a placeholder today; m49 replaces what it
//                         RENDERS, never the route, so this id survives that milestone)
//   "/fleet"   fleet      <Fleet>, unchanged
//   "/board"   board      <Board>, unchanged — the `#ref` fragment keeps its meaning
//   "/config"  config     <App>, the config editor, at its NEW address
//   anything   not-found  the shell's not-found surface, rendered IN PLACE
//
// `/config` and not `/assets`: the built bundle emits its own JavaScript and CSS into
// `/assets/` (vite sets no `base` and no `build.assetsDir`), so a route by that name would
// collide with the directory that serves the application's own code on every origin. The
// legacy MODE value is `assets`; the PATH never is.
//
// The table is ORIGIN-BLIND. One bundle is served from three origins with different API
// surfaces, and the table must not learn which — `routeFor` takes a pathname and nothing
// else, so there is no origin for an origin conditional to read. A surface reached on an
// origin that cannot serve its API degrades through its own existing error state, exactly
// as `?mode=fleet` on a board origin does today.
//
// Every entry, and the table itself, is FROZEN: a table handed out by reference is one
// careless `entry.id = …` away from a route that changes meaning mid-session, in a way no
// other test would ever see.

// The shell's not-found surface. ONE of them, shared by every unknown path — never one per
// typo, and never an alias of "/". `path` is null because it is not addressable: it is what
// every address the table does not know resolves to.
export const NOT_FOUND_ROUTE = Object.freeze({ id: "not-found", path: null });

export const ROUTES = Object.freeze([
  Object.freeze({ id: "landing", path: "/" }),
  Object.freeze({ id: "fleet", path: "/fleet" }),
  Object.freeze({ id: "board", path: "/board" }),
  Object.freeze({ id: "config", path: "/config" }),
  NOT_FOUND_ROUTE,
]);

// routeFor(pathname) — TOTAL: it answers for every input, and it never throws. An unknown,
// shapeless or hostile pathname resolves to the not-found entry and keeps its address;
// nothing here redirects, and nothing here normalises the input against an origin (a table
// that built a URL against the current origin would resolve "//evil.example.com/fleet" to
// another HOST and accept it as a "pathname" — the open-redirect shape one layer down).
//
// Matching is CASE-SENSITIVE ("/Fleet" is an unknown path, not a redirect to "/fleet") and
// tolerant of a SINGLE trailing slash, which is matched IN PLACE: "/fleet/" resolves to the
// fleet entry and the address bar is NOT rewritten. The asymmetry is deliberate — a
// trailing slash is a punctuation variant of the same path, while a case variant is a
// different path that happens to look similar. A DOUBLE trailing slash ("/fleet//") is
// outside that tolerance and stays unknown — and so is the bare "//" (PO ruling at review,
// 2026-08-07): normalising it would make the protocol-relative root a second spelling of
// the landing, one character away from "//host" which must stay unknown.
export function routeFor(pathname) {
  if (typeof pathname !== "string") return NOT_FOUND_ROUTE;
  const candidate =
    pathname.length > 1 && pathname.endsWith("/") && !pathname.endsWith("//")
      ? pathname.slice(0, -1)
      : pathname;
  return ROUTES.find((route) => route.path !== null && route.path === candidate) ?? NOT_FOUND_ROUTE;
}

// --------------------------------------------------- the legacy translation ---
//
// ADR-003. Every URL this product has ever advertised carries a `mode` selector
// (board-serve.mjs, mesh-ui-serve.mjs, commands/assets-ui.mjs, the desktop tray's compiled
// constant, and the page URL `/api/mesh/board-url` returns); NOTHING advertises a bare "/".
// So this translation's coverage is total, and it is measured rather than promised.
//
// An unrecognised mode value maps to `/config` — main.tsx's `else` branch rendered <App>
// for anything that was not exactly "fleet" or "board", and that meaning is kept VERBATIM
// rather than silently becoming a 404: a bookmark that renders the config editor today
// must render the config editor tomorrow, however odd the mode value that got it there.
const LEGACY_MODE_TARGETS = new Map([
  ["fleet", "/fleet"],
  ["board", "/board"],
  ["assets", "/config"],
]);
const LEGACY_FALLBACK_TARGET = "/config";

// The SINGLE URL-building site (ADR-006). Everything that leaves this module as a search
// string is spelled here, so the "?"-prefix rule has one home: an emptied query is the
// EMPTY string and never a bare "?" — a naked question mark is a second spelling of the
// same address, which is exactly the drift this milestone exists to remove.
function toSearchString(params) {
  const text = params.toString();
  return text.length > 0 ? `?${text}` : "";
}

// legacyRedirectFor({ pathname, search, hash }) — returns the canonical
// `{ pathname, search, hash }`, or null when there is nothing to rewrite. The caller
// applies it EXACTLY ONCE, at the entry, before the first render, as a `replaceState`
// (never a push — a pushed entry makes the back button bounce between the legacy URL and
// the canonical one). A null answer means no rewrite is issued and the address bar is left
// exactly as the operator found it.
//
// THE PATH WINS. Only a bare "/" is ever rewritten: a URL that already carries a path is
// returned unchanged, whatever a stale `mode` on it says. Otherwise a legacy query
// parameter could override a real address — precisely backwards for a milestone whose
// point is that the address bar is the truth — and an unknown path carrying a legacy mode
// ("/nope?mode=fleet") would be rescued into a surface instead of showing the operator the
// evidence of the typo.
//
// `mode` IS THE ONLY THING REMOVED, and the mechanism is what guarantees it: copy the
// incoming URLSearchParams and delete `mode`, NEVER rebuild from a known list. A rebuild is
// drop-by-default, so `scope`, `group`, milestone 47's future repo filter and anything this
// codebase has never heard of would vanish the moment a deep link was redirected; a copy is
// preserve-by-default, and 47's repo filter works through the router for free. Deleting
// through URLSearchParams also removes EVERY occurrence of a repeated `mode` (measured) —
// a hand-rolled strip typically removes only the first, answering "/board?mode=fleet",
// which is a legacy URL again, and the address would flip between two surfaces forever.
//
// The FIRST occurrence picks the target (that is what `.get` returns), and the fragment is
// carried VERBATIM — it is never parsed, never interpreted, and only the client can carry
// it at all, since a fragment is never sent to the server.
//
// It is IDEMPOTENT by construction: applied to its own output, the pathname is no longer
// "/", so the answer is null and a rewrite can never loop. It never mutates the parts
// object it was handed — the entry reads a location-shaped record and may well reuse it —
// and it never throws on a shapeless input, because a throw at the entry, before the first
// render, is a blank page.
export function legacyRedirectFor(parts) {
  if (parts == null || typeof parts !== "object") return null;

  const pathname = typeof parts.pathname === "string" ? parts.pathname : "";
  if (pathname !== "/") return null;

  // A search composed by hand frequently omits the leading "?" that a browser always
  // supplies; URLSearchParams parses both identically (measured), so answering them
  // identically removes a whole class of "works in the browser, not in the test".
  const params = new URLSearchParams(typeof parts.search === "string" ? parts.search : "");
  if (!params.has("mode")) return null;

  const target = LEGACY_MODE_TARGETS.get(params.get("mode")) ?? LEGACY_FALLBACK_TARGET;
  params.delete("mode");

  return {
    pathname: target,
    search: toSearchString(params),
    hash: typeof parts.hash === "string" ? parts.hash : "",
  };
}

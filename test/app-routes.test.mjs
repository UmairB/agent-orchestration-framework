// Traceability wiring for milestone 45 / story 01 (the route model) — ui/src/app/routes.mjs,
// the ONE pure route table and the ONE legacy `?mode=` translation.
//
// THE CHANNEL. This module is PURE and has NO CLI surface, so the black-box channel every
// scenario below is confirmed through is `node:test` importing the module directly and
// asserting on RETURNED VALUES — no bundler, no DOM, no React harness (this repo has none
// at all). That is the house pattern: test/fleet-scope.test.mjs does exactly this for
// ui/src/fleet/scope.mjs. Nothing here reads the module's source; the two PLACEMENT
// invariants (React-free/DOM-free, and "names no query key but `mode`") are owned by
// test/arch/acd-route-logic-framework-free.test.mjs, and "the entry applies the translation
// exactly once" is story 45/03's, owned by acd-ui-single-route-table.
//
//   tasks/00_route-table.feature (@executable) — six scenarios:
//     - each of the four paths resolves to exactly one named surface;
//     - an unknown path resolves to the shell's ONE 404 surface, and the address is not
//       rewritten (the redirect function declines);
//     - a single trailing slash is matched IN PLACE, with no rewrite;
//     - nothing under the bundle's own asset directory is a route at all;
//     - a shapeless or hostile pathname resolves to not-found and never throws (including
//       the two host-swap shapes a URL-normalising table would silently accept);
//     - the table is total, deterministic and single-valued — frozen against caller
//       mutation, and blind to any second argument (ADR-002's ORIGIN-BLIND rule).
//   tasks/01_legacy-mode-redirect.feature (@executable) — seven scenarios:
//     - every `?mode=` URL the product has ever advertised maps onto its path;
//     - `mode` is the only parameter removed, including the shapes a regex strip eats;
//     - a URL that already carries a path is returned unchanged (the PATH wins);
//     - applying the rewrite to its own output is a no-op — `replaceState` cannot loop;
//     - a bare `/` carrying no `mode` is not rewritten;
//     - a shapeless input is answered, never thrown at;
//     - the parts object handed in is never mutated, and the answer is a NEW object.
//   tasks/02_query-and-fragment-passthrough.feature (@executable) — seven scenarios:
//     - `?scope=` survives a redirect intact, unvalidated and undefaulted by the router;
//     - a parameter the router has never heard of survives (repeated keys, value-less keys);
//     - parameter ORDER survives from every position `mode` can occupy;
//     - every surviving value reads back as the same text (the satisfiable reading of
//       "unmangled" — decodes identically, in order, same entry count; NOT byte-identical,
//       which the mandated copy-and-delete mechanism cannot deliver: F-45-01-B);
//     - the board drill-in still lands on item 18 after the rewrite;
//     - the `#ref` fragment survives whatever it carries, and is never interpreted;
//     - a canonical URL carrying every exotic parameter at once is not touched.
//
// Feature 00's Background line about the built bundle emitting `ui/dist/assets/index-*.js`
// is a GIVEN about vite's output, not a Then: it is what makes `/assets` unroutable, and it
// is asserted through behaviour (the asset-directory scenario) rather than by reading a
// build artefact that a clean checkout has not produced yet.
import assert from "node:assert/strict";
import { ROUTES, NOT_FOUND_ROUTE, routeFor, legacyRedirectFor } from "../ui/src/app/routes.mjs";

// A surviving query string is read back the way every consumer in this codebase reads it —
// with URLSearchParams, IN ORDER. Tolerant of the leading "?" and order-SENSITIVE, because
// ADR-006 preserves a URL as text rather than merely as a set.
function entriesOf(search) {
  return [...new URLSearchParams(search ?? "").entries()];
}

export const appRoutesTests = [
  // ======================================================================
  // tasks/00_route-table.feature
  // ======================================================================
  {
    name: "app-routes/00 each of the four paths resolves to exactly one named surface (00 scenario 1: /, /fleet, /board, /config)",
    run() {
      const rows = [
        { pathname: "/", surface: "landing" },
        { pathname: "/fleet", surface: "fleet" },
        { pathname: "/board", surface: "board" },
        { pathname: "/config", surface: "config" },
      ];
      for (const { pathname, surface } of rows) {
        const route = routeFor(pathname);
        assert.equal(route.id, surface, `routeFor("${pathname}") is named ${surface}`);
        assert.equal(route.path, pathname, `the ${surface} entry carries its own path`);
        assert.equal(
          ROUTES.filter((candidate) => candidate.id === surface).length,
          1,
          `no OTHER path in the exported route table carries the name ${surface}`,
        );
        assert.deepEqual(routeFor(pathname), route, `routeFor("${pathname}") a second time returns a deep-equal entry`);
      }
    },
  },
  {
    name: "app-routes/00 an unknown path resolves to the shell's ONE 404 surface, and the address is not rewritten (00 scenario 2)",
    run() {
      const unknown = [
        "/fleeet", // a near-miss typo of a real route
        "/nope", // a path nothing has ever served
        "/fleet//", // a DOUBLE trailing slash — only a SINGLE one is tolerated
        "//", // the bare protocol-relative root — never normalised into the landing (PO ruling, 2026-08-07)
        "/Fleet", // a real route in the wrong case — URL paths are case-sensitive
        "/config/editor", // a real route used as the PREFIX of a deeper path
        "/board/42", // the board's item deep-link written as a PATH segment (it is a FRAGMENT)
        "/a/deep/path", // a deep path no table row could ever cover
      ];
      const reference = routeFor("/some-other-unknown-path");
      for (const pathname of unknown) {
        const route = routeFor(pathname);
        assert.equal(route.id, "not-found", `routeFor("${pathname}") is named not-found`);
        assert.deepEqual(route, reference, `"${pathname}" resolves to the SAME not-found entry — one 404 surface, never one per typo`);
        assert.notDeepEqual(
          route,
          routeFor("/"),
          `"${pathname}" is never aliased or redirected to the landing — a redirect makes a typo, a stale bookmark and a broken in-app link indistinguishable from a working one`,
        );
        assert.equal(
          legacyRedirectFor({ pathname, search: "", hash: "" }),
          null,
          `no rewrite is issued for "${pathname}", so the address bar keeps it verbatim`,
        );
      }
    },
  },
  {
    name: "app-routes/00 a single trailing slash on a real route is matched in place, and the address is not rewritten (00 scenario 3; ADR-002 [Amigos-6])",
    run() {
      const rows = [
        { pathname: "/fleet/", canonical: "/fleet", surface: "fleet" },
        { pathname: "/board/", canonical: "/board", surface: "board" },
        { pathname: "/config/", canonical: "/config", surface: "config" },
      ];
      for (const { pathname, canonical, surface } of rows) {
        const route = routeFor(pathname);
        assert.equal(route.id, surface, `routeFor("${pathname}") is named ${surface}`);
        assert.deepEqual(route, routeFor(canonical), `"${pathname}" and "${canonical}" are ONE entry, not a slash-variant twin`);
        assert.equal(
          legacyRedirectFor({ pathname, search: "", hash: "" }),
          null,
          `"${pathname}" is understood IN PLACE — the matcher is tolerant, the address bar keeps the slash the operator typed`,
        );
      }
    },
  },
  {
    name: "app-routes/00 a request under the bundle's own asset directory is not matched by the route table at all (00 scenario 4: the /assets collision)",
    run() {
      const paths = [
        "/assets", // the asset directory itself
        "/assets/", // …with a trailing slash
        "/assets/index-DkR2xu9f.js", // the bundle's own hashed JavaScript
        "/assets/index-B7yQ1a2c.css", // the bundle's own hashed stylesheet
        "/index.html", // the bundle's entry document
        "/favicon.ico", // a root-level static file
        "/api/mesh/status", // an API path — never the client's to answer
      ];
      for (const pathname of paths) {
        const route = routeFor(pathname);
        assert.equal(route.id, "not-found", `routeFor("${pathname}") is named not-found`);
        assert.notEqual(
          route.id,
          "config",
          `"${pathname}" is NOT the config surface — the legacy MODE value is \`assets\`, the PATH never is`,
        );
      }
    },
  },
  {
    name: "app-routes/00 a shapeless or hostile pathname resolves to not-found and never throws (00 scenario 5, incl. the two host-swap shapes)",
    run() {
      const inputs = [
        "", // an empty pathname
        null, // no pathname at all
        undefined, // an undefined pathname
        42, // a value that is not a string
        "fleet", // a pathname with no leading slash
        "//fleet", // a protocol-relative-looking path
        "//evil.example.com/fleet", // a path that names ANOTHER HOST
      ];
      for (const pathname of inputs) {
        assert.doesNotThrow(() => routeFor(pathname), `routeFor(${JSON.stringify(pathname)}) does not throw`);
        const route = routeFor(pathname);
        assert.deepEqual(route, NOT_FOUND_ROUTE, `routeFor(${JSON.stringify(pathname)}) returns the not-found entry`);
        assert.notEqual(route.id, "fleet", `${JSON.stringify(pathname)} never resolves to a surface`);
      }
      // The host-swap rows are not pedantry: new URL("//evil.example.com/fleet",
      // "http://127.0.0.1:4181") resolves to http://evil.example.com/fleet (measured). A
      // table that normalised its input against the current origin would accept a host
      // swap as a "pathname" — the open-redirect shape one layer down.
      assert.equal(routeFor("//evil.example.com/fleet").path, null, "a host-swapping input names no surface and carries no path");
    },
  },
  {
    name: "app-routes/00 the table is total, deterministic and single-valued — frozen against caller mutation, and blind to any second argument (00 scenario 6)",
    run() {
      // FOUR addressable entries plus ONE not-found entry.
      const addressable = ROUTES.filter((route) => route.path !== null);
      const notFound = ROUTES.filter((route) => route.path === null);
      assert.equal(addressable.length, 4, "the table holds exactly FOUR addressable entries");
      assert.equal(notFound.length, 1, "…plus exactly ONE not-found entry");
      assert.equal(ROUTES.length, 5);
      assert.deepEqual(notFound[0], NOT_FOUND_ROUTE);

      // Pairwise distinct: no path names two surfaces, and no surface is named by two paths.
      const ids = ROUTES.map((route) => route.id);
      assert.deepEqual(ids, ["landing", "fleet", "board", "config", "not-found"]);
      assert.equal(new Set(ids).size, 5, "the five names are pairwise distinct");
      const paths = addressable.map((route) => route.path);
      assert.equal(new Set(paths).size, 4, "no path appears twice in the table");

      // Every addressable entry answers for its own path.
      for (const route of addressable) {
        assert.deepEqual(routeFor(route.path), route, `routeFor("${route.path}") returns that same entry`);
      }

      // Deterministic: no memo, no hidden state, no dependence on call order.
      for (const pathname of ["/", "/fleet", "/board", "/config", "/nope"]) {
        assert.deepEqual(routeFor(pathname), routeFor(pathname), `routeFor("${pathname}") answers deep-equal twice in a row`);
      }

      // A caller that mutates what it was handed cannot change the next answer. The entries
      // are frozen, so under ESM's strict mode the assignment THROWS rather than silently
      // failing — either way the table is unchanged, which is what the scenario asserts.
      const handedOut = routeFor("/fleet");
      try {
        handedOut.id = "hijacked";
      } catch {
        /* frozen — the strongest possible answer to the mutation line */
      }
      try {
        handedOut.path = "/hijacked";
      } catch {
        /* frozen */
      }
      try {
        ROUTES.push({ id: "smuggled", path: "/smuggled" });
      } catch {
        /* frozen */
      }
      assert.equal(routeFor("/fleet").id, "fleet", "a mutated entry does not change what the next call answers");
      assert.equal(routeFor("/fleet").path, "/fleet");
      assert.equal(ROUTES.length, 5, "the exported table cannot be extended by a caller");
      assert.equal(routeFor("/smuggled").id, "not-found");

      // ORIGIN-BLIND (ADR-002): the table takes a pathname and nothing else, so there is no
      // origin for an origin conditional to read.
      const plain = routeFor("/board");
      assert.deepEqual(routeFor("/board", "http://127.0.0.1:4181"), plain, "a second argument changes nothing");
      assert.deepEqual(routeFor("/board", { origin: "http://127.0.0.1:9999" }), plain, "an origin-shaped second argument changes nothing");
      assert.deepEqual(routeFor("/board", undefined, "extra"), plain, "no argument beyond the pathname is read");
    },
  },

  // ======================================================================
  // tasks/01_legacy-mode-redirect.feature
  // ======================================================================
  {
    name: "app-routes/01 every `?mode=` URL the product has ever advertised maps onto its path (01 scenario 1: the measured advertised set)",
    run() {
      const rows = [
        // case, then the parts in / the parts out.
        { case: "the fleet server's advertised URL AND the desktop tray's compiled constant", search: "?mode=fleet&scope=global", hash: "", to: "/fleet", toSearch: "?scope=global", toHash: "" },
        { case: "the same server advertising local scope", search: "?mode=fleet&scope=local", hash: "", to: "/fleet", toSearch: "?scope=local", toHash: "" },
        { case: "the fleet's bare advertised URL (mesh-ui-serve.mjs)", search: "?mode=fleet", hash: "", to: "/fleet", toSearch: "", toHash: "" },
        { case: "the board server's advertised URL (board-serve.mjs)", search: "?mode=board", hash: "", to: "/board", toSearch: "", toHash: "" },
        { case: "board-url's drill-in for a milestone (mesh-ui-serve.mjs)", search: "?mode=board", hash: "#18", to: "/board", toSearch: "", toHash: "#18" },
        { case: "the in-app board cross-link (Fleet.tsx)", search: "?mode=board", hash: "", to: "/board", toSearch: "", toHash: "" },
        { case: "the config editor's launcher (assets-ui.mjs)", search: "?mode=assets", hash: "", to: "/config", toSearch: "", toHash: "" },
        { case: "an UNRECOGNISED mode value — main.tsx's `else` branch, kept verbatim", search: "?mode=wat", hash: "", to: "/config", toSearch: "", toHash: "" },
        { case: "an EMPTY mode value — also the `else` branch", search: "?mode=", hash: "", to: "/config", toSearch: "", toHash: "" },
        { case: "mode in the WRONG CASE — \"Fleet\" !== \"fleet\", so the `else` branch again", search: "?mode=Fleet", hash: "", to: "/config", toSearch: "", toHash: "" },
        { case: "mode given TWICE — the FIRST wins, and BOTH copies are removed", search: "?mode=board&mode=fleet", hash: "", to: "/board", toSearch: "", toHash: "" },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: row.hash });
        assert.ok(result != null, `${row.case}: a legacy URL yields a rewrite`);
        assert.equal(result.pathname, row.to, `${row.case}: → ${row.to}`);
        assert.deepEqual(entriesOf(result.search), entriesOf(row.toSearch), `${row.case}: its search reads back as ${row.toSearch || "(empty)"}`);
        assert.equal(result.hash, row.toHash, `${row.case}: its hash is ${JSON.stringify(row.toHash)}`);
      }
      // The bare-fleet row's empty search is deliberate: with `mode` deleted the search must
      // be the EMPTY string and never a bare "?" — a naked question mark is a second
      // spelling of the same address, and it is exactly the drift an unconditionally
      // prefixed toString() produces.
      assert.equal(legacyRedirectFor({ pathname: "/", search: "?mode=fleet", hash: "" }).search, "", 'an emptied search is "" and never "?"');
      // The double-mode row is the LOOP GUARD: a rewrite that removed only the FIRST
      // occurrence would answer /board?mode=fleet, which is a legacy URL again, and the
      // address would flip between two surfaces forever.
      const doubled = legacyRedirectFor({ pathname: "/", search: "?mode=board&mode=fleet", hash: "" });
      assert.equal(doubled.search, "", "BOTH copies of a repeated `mode` are removed");
      assert.equal(new URLSearchParams(doubled.search).has("mode"), false);
    },
  },
  {
    name: "app-routes/01 `mode` is the only parameter removed, including the shapes a regex strip eats (01 scenario 2)",
    run() {
      const rows = [
        { case: "`?scope=` — a live deep-link contract with server-side consumers", search: "?mode=fleet&scope=global", surviving: [["scope", "global"]] },
        { case: "`?group=` — read today by useGroupName() (Fleet.tsx)", search: "?mode=fleet&group=alpha", surviving: [["group", "alpha"]] },
        { case: "milestone 47's repo filter, which does not exist yet", search: "?mode=fleet&repo=aof", surviving: [["repo", "aof"]] },
        { case: "a parameter this codebase has never heard of", search: "?mode=fleet&zz=1", surviving: [["zz", "1"]] },
        { case: 'keys whose NAMES merely CONTAIN "mode"', search: "?mode=fleet&modes=1&mode_hint=2", surviving: [["modes", "1"], ["mode_hint", "2"]] },
        { case: 'a key whose VALUE contains "mode="', search: "?mode=fleet&q=mode%3Dboard", surviving: [["q", "mode=board"]] },
        { case: "`mode` is the only parameter — the result is an EMPTY search", search: "?mode=fleet", surviving: [] },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: "" });
        assert.ok(result != null, `${row.case}: a rewrite is issued`);
        assert.equal(result.pathname, "/fleet", `${row.case}: → /fleet`);
        assert.deepEqual(entriesOf(result.search), row.surviving, `${row.case}: exactly the non-mode parameters survive, in order`);
        assert.equal(new URLSearchParams(result.search).has("mode"), false, `${row.case}: the key "mode" is absent from the answer`);
      }
      assert.equal(legacyRedirectFor({ pathname: "/", search: "?mode=fleet", hash: "" }).search, "", 'nothing at all survives as "", never "?"');
    },
  },
  {
    name: "app-routes/01 a URL that already carries a path is returned unchanged — the PATH wins, never the param (01 scenario 3)",
    run() {
      const rows = [
        { case: "a canonical fleet URL carrying its scope", pathname: "/fleet", search: "?scope=global", hash: "" },
        { case: "a canonical board URL carrying its drill-in fragment", pathname: "/board", search: "", hash: "#18" },
        { case: "the canonical config editor", pathname: "/config", search: "", hash: "" },
        { case: "a canonical path STILL carrying a stale `mode`", pathname: "/fleet", search: "?mode=board", hash: "" },
        { case: "an UNKNOWN path carrying a legacy mode — never rescued into a surface", pathname: "/nope", search: "?mode=fleet", hash: "" },
        { case: "a path under the bundle's asset directory", pathname: "/assets/index-DkR2xu9f.js", search: "", hash: "" },
      ];
      for (const row of rows) {
        assert.equal(
          legacyRedirectFor({ pathname: row.pathname, search: row.search, hash: row.hash }),
          null,
          `${row.case}: no rewrite is issued, and the address bar keeps ${row.pathname}${row.search}${row.hash} verbatim`,
        );
      }
      // The unknown-path row is the boundary between two rules that both want it: ADR-002's
      // "an unknown path renders the 404 surface and is NEVER redirected" wins, because
      // destroying the evidence in the address bar is the exact failure it prevents.
      assert.equal(routeFor("/nope").id, "not-found", "/nope?mode=fleet still renders the 404 surface at /nope");
    },
  },
  {
    name: "app-routes/01 applying the rewrite to its own output is a no-op — `replaceState` can never loop (01 scenario 4: idempotence)",
    run() {
      const tray = { pathname: "/", search: "?mode=fleet&scope=global", hash: "" };
      const once = legacyRedirectFor(tray);
      assert.equal(once.pathname, "/fleet");
      assert.deepEqual(entriesOf(once.search), [["scope", "global"]]);
      assert.equal(once.hash, "");
      assert.equal(legacyRedirectFor(once), null, "a second call on its own output returns null");

      const doubledOnce = legacyRedirectFor({ pathname: "/", search: "?mode=board&mode=fleet", hash: "" });
      assert.equal(doubledOnce.pathname, "/board");
      assert.equal(doubledOnce.search, "");
      assert.equal(legacyRedirectFor(doubledOnce), null, "the double-mode URL settles after ONE rewrite");

      const drillOnce = legacyRedirectFor({ pathname: "/", search: "?mode=board", hash: "#18" });
      assert.equal(drillOnce.pathname, "/board");
      assert.equal(drillOnce.hash, "#18");
      assert.equal(legacyRedirectFor(drillOnce), null, "board-url's drill-in settles after ONE rewrite");
    },
  },
  {
    name: "app-routes/01 a bare `/` carrying no `mode` is not rewritten, including the two shapes that LOOK like one (01 scenario 5)",
    run() {
      const rows = [
        { case: "the bare landing", search: "", hash: "" },
        { case: "the landing carrying a scope but no mode", search: "?scope=global", hash: "" },
        { case: "the landing carrying only a fragment", search: "", hash: "#18" },
        { case: "an UPPERCASE `MODE` key — `mode` is matched exactly", search: "?MODE=fleet", hash: "" },
        { case: 'a key that merely STARTS with "mode"', search: "?modes=1", hash: "" },
      ];
      for (const row of rows) {
        const parts = { pathname: "/", search: row.search, hash: row.hash };
        assert.equal(legacyRedirectFor(parts), null, `${row.case}: no rewrite`);
        assert.equal(parts.search, row.search, `${row.case}: the search it was handed is left exactly as it is`);
        assert.equal(parts.hash, row.hash, `${row.case}: the hash it was handed is left exactly as it is`);
      }
      assert.equal(routeFor("/").id, "landing", "a bare `/` renders the shell landing (ADR-003's ONE URL whose meaning changes)");
    },
  },
  {
    name: "app-routes/01 a shapeless input is answered, never thrown at — a throw at the entry is a blank page (01 scenario 6)",
    run() {
      assert.doesNotThrow(() => legacyRedirectFor(), "no argument at all");
      assert.equal(legacyRedirectFor(), null);

      assert.doesNotThrow(() => legacyRedirectFor(null), "null");
      assert.equal(legacyRedirectFor(null), null);

      assert.doesNotThrow(() => legacyRedirectFor({}), "an empty object");
      assert.equal(legacyRedirectFor({}), null);

      assert.doesNotThrow(() => legacyRedirectFor({ pathname: "/" }), "a pathname only, no search or hash keys");
      assert.equal(legacyRedirectFor({ pathname: "/" }), null);

      assert.doesNotThrow(() => legacyRedirectFor({ pathname: "/", search: null, hash: null }), "null search and null hash");
      assert.equal(legacyRedirectFor({ pathname: "/", search: null, hash: null }), null);

      // A caller composing parts by hand frequently omits the "?" a browser always supplies;
      // URLSearchParams parses both identically (measured), so answering them identically
      // removes a whole class of "works in the browser, not in the test".
      const noQuestionMark = legacyRedirectFor({ pathname: "/", search: "mode=fleet", hash: "" });
      assert.ok(noQuestionMark != null, 'a search with NO leading "?" is parsed the same');
      assert.equal(noQuestionMark.pathname, "/fleet");
      assert.equal(noQuestionMark.search, "");
      assert.equal(noQuestionMark.hash, "");
    },
  },
  {
    name: "app-routes/01 the parts object handed in is never mutated, and the answer is a NEW object (01 scenario 7)",
    run() {
      const parts = { pathname: "/", search: "?mode=fleet&scope=global", hash: "#x" };
      const result = legacyRedirectFor(parts);
      assert.equal(parts.pathname, "/", "the caller's own record still reads pathname /");
      assert.equal(parts.search, "?mode=fleet&scope=global", "…and its search is untouched");
      assert.equal(parts.hash, "#x", "…and its hash is untouched");
      assert.notEqual(result, parts, "the answer is a NEW object, not the same object with its fields rewritten");
      assert.equal(result.pathname, "/fleet");
      assert.deepEqual(entriesOf(result.search), [["scope", "global"]]);
      assert.equal(result.hash, "#x");
    },
  },

  // ======================================================================
  // tasks/02_query-and-fragment-passthrough.feature
  // ======================================================================
  {
    name: "app-routes/02 `?scope=` survives a redirect intact, and the router neither validates nor defaults it (02 scenario 1)",
    run() {
      const rows = [
        { case: "global — the desktop app's compiled constant and the fleet server's default", search: "?mode=fleet&scope=global", to: "/fleet", toSearch: "?scope=global" },
        { case: "local — the other half of the contract", search: "?mode=fleet&scope=local", to: "/fleet", toSearch: "?scope=local" },
        { case: "a scope value the router has no opinion about", search: "?mode=fleet&scope=bogus", to: "/fleet", toSearch: "?scope=bogus" },
        { case: "an EMPTY scope value — a present-but-empty key is still a key", search: "?mode=fleet&scope=", to: "/fleet", toSearch: "?scope=" },
        { case: "scope on the BOARD's legacy URL, where nothing reads it — carried anyway", search: "?mode=board&scope=local", to: "/board", toSearch: "?scope=local" },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: "" });
        assert.ok(result != null, `${row.case}: a rewrite is issued`);
        assert.equal(result.pathname, row.to, `${row.case}: → ${row.to}`);
        assert.deepEqual(entriesOf(result.search), entriesOf(row.toSearch), `${row.case}: its search reads back as exactly ${row.toSearch}`);
      }
      // The "bogus" row is the point of the whole scenario: scope.mjs already defaults an
      // invalid scope to "global" when it READS it. If the router ALSO normalised it, scope
      // would have two homes and they would disagree the first time m47 changed one.
      assert.equal(
        new URLSearchParams(legacyRedirectFor({ pathname: "/", search: "?mode=fleet&scope=bogus", hash: "" }).search).get("scope"),
        "bogus",
        "the router carries the value it was given, exactly, and says nothing about it",
      );
    },
  },
  {
    name: "app-routes/02 a parameter the router has never heard of survives — repeated keys and value-less keys included (02 scenario 2)",
    run() {
      const rows = [
        { case: "milestone 47's repo filter, which does not exist yet", search: "?mode=fleet&repo=aof", surviving: [["repo", "aof"]] },
        { case: "a repo filter whose value carries a slash", search: "?mode=fleet&repo=owner%2Fname", surviving: [["repo", "owner/name"]] },
        { case: "`?group=`, read today by useGroupName() (Fleet.tsx)", search: "?mode=fleet&group=alpha", surviving: [["group", "alpha"]] },
        { case: "a key repeated — BOTH copies survive, in order", search: "?mode=fleet&tag=a&tag=b", surviving: [["tag", "a"], ["tag", "b"]] },
        { case: "a key with no value at all", search: "?mode=fleet&debug", surviving: [["debug", ""]] },
        { case: "a tracking parameter nobody in this repo has ever named", search: "?mode=fleet&utm_source=slack", surviving: [["utm_source", "slack"]] },
        { case: "four unknown keys at once, none of them ever added to a list", search: "?mode=fleet&a=1&b=2&c=3&d=4", surviving: [["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"]] },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: "" });
        assert.ok(result != null, `${row.case}: a rewrite is issued`);
        assert.equal(result.pathname, "/fleet", `${row.case}: → /fleet`);
        assert.deepEqual(entriesOf(result.search), row.surviving, `${row.case}: reading its search back yields exactly the expected entries, in that order`);
      }
      // The repeated-key row guards a build that copies parameters through a plain object or
      // a Map, both of which silently collapse tag=a&tag=b to one entry.
      assert.equal(entriesOf(legacyRedirectFor({ pathname: "/", search: "?mode=fleet&tag=a&tag=b", hash: "" }).search).length, 2, "a repeated key is not collapsed");
      // The value-less row proves the MECHANISM rather than the outcome, and it is where
      // "byte-identical" fails (F-45-01-B): the key survives and reads back with the same
      // empty value; the serialised text gains one character.
      assert.equal(new URLSearchParams(legacyRedirectFor({ pathname: "/", search: "?mode=fleet&debug", hash: "" }).search).get("debug"), "", "a value-less key survives as present-and-empty");
    },
  },
  {
    name: "app-routes/02 parameter ORDER survives, whatever position `mode` was in (02 scenario 3)",
    run() {
      const rows = [
        { case: "mode FIRST — the advertised shape", search: "?mode=fleet&scope=global&repo=aof", toSearch: "?scope=global&repo=aof" },
        { case: "mode in the MIDDLE", search: "?scope=global&mode=fleet&repo=aof", toSearch: "?scope=global&repo=aof" },
        { case: "mode LAST", search: "?scope=global&repo=aof&mode=fleet", toSearch: "?scope=global&repo=aof" },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: "" });
        assert.ok(result != null, `${row.case}: a rewrite is issued`);
        assert.equal(result.pathname, "/fleet", `${row.case}: → /fleet`);
        assert.deepEqual(
          entriesOf(result.search),
          entriesOf(row.toSearch),
          `${row.case}: same keys, same values, same ORDER — a build that rebuilds the query from a known list passes the set assertions and fails this one`,
        );
        assert.deepEqual(entriesOf(result.search).map(([key]) => key), ["scope", "repo"], `${row.case}: the surviving key ORDER is the incoming order`);
      }
    },
  },
  {
    name: "app-routes/02 every surviving value reads back as the same text it read as before (02 scenario 4: the encoding rows, each measured in node)",
    run() {
      const rows = [
        { case: "a percent-encoded space", search: "?mode=fleet&q=a%20b", key: "q", value: "a b" },
        { case: "a plus sign, which IS a space in query text", search: "?mode=fleet&q=a+b", key: "q", value: "a b" },
        { case: "a percent-encoded ampersand inside a value", search: "?mode=fleet&q=a%26b", key: "q", value: "a&b" },
        { case: "a percent-encoded equals inside a value", search: "?mode=fleet&q=mode%3Dboard", key: "q", value: "mode=board" },
        { case: "a percent-encoded slash", search: "?mode=fleet&repo=owner%2Fname", key: "repo", value: "owner/name" },
        { case: "a percent-encoded hash inside a value", search: "?mode=fleet&q=%2318", key: "q", value: "#18" },
        { case: "a non-ASCII value", search: "?mode=fleet&name=caf%C3%A9", key: "name", value: "café" },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: "" });
        assert.ok(result != null, `${row.case}: a rewrite is issued`);
        const readBack = new URLSearchParams(result.search);
        assert.equal(readBack.get(row.key), row.value, `${row.case}: reading "${row.key}" off the rewrite yields exactly ${JSON.stringify(row.value)}`);
        // Not double-encoded, not truncated at a reserved character, not dropped.
        assert.equal(entriesOf(result.search).length, 1, `${row.case}: exactly the one surviving parameter, none dropped and none invented`);
        assert.equal(readBack.get(row.key), new URLSearchParams(row.search).get(row.key), `${row.case}: the value decodes to the same text it decoded to before the rewrite`);
      }
    },
  },
  {
    name: "app-routes/02 the board drill-in still lands on item 18 after the rewrite (02 scenario 5: the operator-visible regression)",
    run() {
      // /api/mesh/board-url returned http://127.0.0.1:PORT/?mode=board#18 and Fleet.tsx:514
      // navigated the browser to it.
      const result = legacyRedirectFor({ pathname: "/", search: "?mode=board", hash: "#18" });
      assert.ok(result != null);
      assert.equal(result.pathname, "/board");
      assert.equal(result.search, "", 'its search is the EMPTY string — not a bare "?"');
      assert.equal(result.hash, "#18");

      // Board.tsx's hashRef() is `hash.replace(/^#/, "").trim() || null` — it reads
      // "18" off this fragment and selects the same item it selects today.
      assert.equal(result.hash.replace(/^#/, "").trim() || null, "18", "hashRef() reads 18 back off the carried fragment");

      // The address the browser is left on.
      const origin = "http://127.0.0.1:4173";
      assert.equal(new URL(`${result.pathname}${result.search}${result.hash}`, origin).toString(), `${origin}/board#18`);

      // …and /api/mesh/board-url's response SHAPE is untouched by any of this — discharged
      // by construction: this story edits no producer. The shape's own home is the live
      // HTTP coverage in test/mesh-ui-serve.test.mjs; pinning the producer's source text
      // here froze a body ADR-002 promises stays ADDITIVE for m46 (architect review,
      // 2026-08-07), so the source read was removed.
    },
  },
  {
    name: "app-routes/02 the `#ref` fragment survives whatever it carries, and the router never interprets it (02 scenario 6)",
    run() {
      const rows = [
        { case: "a milestone ref — the measured shape", search: "?mode=board", hash: "#18", toSearch: "", toHash: "#18" },
        { case: "a story ref, whose slash is NOT a path separator", search: "?mode=board", hash: "#42/03", toSearch: "", toHash: "#42/03" },
        { case: "a fragment alongside a surviving query parameter", search: "?mode=fleet&scope=local", hash: "#deep", toSearch: "?scope=local", toHash: "#deep" },
        { case: "a fragment that itself looks like a query string", search: "?mode=board", hash: "#a?b=c", toSearch: "", toHash: "#a?b=c" },
        { case: "a percent-encoded fragment", search: "?mode=board", hash: "#a%20b", toSearch: "", toHash: "#a%20b" },
        { case: "a fragment on a URL whose only parameter was `mode`", search: "?mode=assets", hash: "#x", toSearch: "", toHash: "#x" },
        { case: "no fragment at all", search: "?mode=board", hash: "", toSearch: "", toHash: "" },
      ];
      for (const row of rows) {
        const result = legacyRedirectFor({ pathname: "/", search: row.search, hash: row.hash });
        assert.ok(result != null, `${row.case}: a rewrite is issued`);
        assert.equal(result.hash, row.toHash, `${row.case}: its hash is exactly ${JSON.stringify(row.toHash)} — carried verbatim, never parsed`);
        assert.deepEqual(entriesOf(result.search), entriesOf(row.toSearch), `${row.case}: its search reads back as exactly ${row.toSearch || "(empty)"}`);
        // The "?"-prefix rule, asserted at the strength ADR-006 [Amigos-3] actually claims:
        // an emptied search is "" and never a bare "?", and a surviving one keeps its "?".
        // (The BYTES of a surviving search are deliberately not pinned — URLSearchParams
        // re-serialises, and "decodes identically, in order" is the satisfiable invariant.)
        if (row.toSearch === "") assert.equal(result.search, "", `${row.case}: an emptied search is "" and never "?"`);
        else assert.ok(result.search.startsWith("?"), `${row.case}: a surviving search keeps its leading "?"`);
      }
      // The percent-encoded row is the sharp one: the fragment is never decoded, so it
      // arrives at the surface exactly as it left the producer.
      assert.equal(legacyRedirectFor({ pathname: "/", search: "?mode=board", hash: "#a%20b" }).hash, "#a%20b", "the fragment is not decoded, re-encoded or normalised");
    },
  },
  {
    name: "app-routes/02 a canonical URL carrying every exotic parameter at once is not touched (02 scenario 7)",
    run() {
      const parts = { pathname: "/fleet", search: "?scope=local&repo=owner%2Fname&tag=a&tag=b&debug&q=a%20b", hash: "#deep" };
      assert.equal(legacyRedirectFor(parts), null, "nothing is rewritten, so nothing can be normalised, reordered or dropped");

      const readBack = entriesOf(parts.search);
      assert.deepEqual(readBack, [
        ["scope", "local"],
        ["repo", "owner/name"],
        ["tag", "a"],
        ["tag", "b"],
        ["debug", ""],
        ["q", "a b"],
      ], "the parts object handed in still reads back with all six parameters, in order");
      assert.equal(readBack.length, 6);
      assert.equal(parts.hash, "#deep", "…and its fragment");

      // The table matches on PATHNAME only and has no query-parameter conditions.
      assert.equal(routeFor("/fleet").id, "fleet", "routeFor names the fleet surface whatever that URL's query string carries");
      assert.deepEqual(routeFor("/fleet"), routeFor("/fleet"), "the answer does not depend on the query string it never saw");
    },
  },
];

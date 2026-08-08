// Fitness function: acd-route-logic-framework-free (m45 / ADR-001 + ADR-003 + ADR-006) —
//
//   "The route table is a PURE module: no React, no DOM, no clock, no `location` of its
//    own — so `node:test` drives the one decision this milestone exists to make. And the
//    router is a PATH router: it reads exactly one query parameter (`mode`, only to delete
//    it) and carries every other parameter and the fragment through untouched."
//
// EXPECTED RED until milestone 45's stories land: `ui/src/app/routes.mjs` does not exist.
//
// WHY PURITY IS THE STRUCTURAL RULE AND NOT A STYLE PREFERENCE. There is NO React test
// harness in this repo — no vitest, no testing-library. Every UI surface keeps its
// decisions in framework-free `.mjs` beside the component so node:test drives them
// headlessly: ui/src/fleet/scope.mjs (whose own header states the rule), ui/src/board/
// {runs,action,freshness,resync}.mjs, ui/src/board/terminal/*.mjs. The canonical shape is
// test/fleet-scope.test.mjs. If the route table were JSX/hook-shaped — a router library's
// <Routes>/<Navigate>/loader config — the URL-to-surface mapping would be the one thing in
// this milestone that CANNOT be tested here. That, and not bundle size, is why m45/ADR-001
// rejects react-router-dom for a four-route surface. `scope.mjs`'s discipline is copied
// verbatim: "PURE — the caller wires this into history.pushState/replaceState; this module
// touches no `window`/`location` itself (headless-testable)."
//
// WHY THE PASSTHROUGH IS AN INVARIANT AND NOT A NICETY. `?scope=` is a live deep-link
// contract with server-side consumers (mesh-ui-serve.mjs:143 advertises it,
// queryGlobalMeshStatus honours it, ui/src/fleet/api.ts:279 sends it), and milestone 47 adds
// a repo filter beside it. The failure mode is banal and common: a router that "normalises"
// the query string and quietly drops what it does not recognise, so a deep link works right
// up until the moment it is redirected. ADR-006's rule is therefore COPY-AND-DELETE
// (preserve by default), never build-from-a-known-list (drop by default) — and the router
// never imports ui/src/fleet/scope.mjs, because the router not knowing that `scope` exists
// is exactly what makes milestone 47's change local to the fleet.
//
// THE FRAGMENT IS PART OF THE CONTRACT. `/api/mesh/board-url` returns
// `http://127.0.0.1:PORT/?mode=board#ref` (mesh-ui-serve.mjs:278), Fleet.tsx:514 navigates to
// it, and Board.tsx:585 reads the fragment back to select an item. A fragment is never sent
// to the server, so only the CLIENT can preserve it across the legacy translation — which is
// itself one of ADR-003's reasons for a client-side replaceState over a server-side 3xx.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTE_MODULE = "ui/src/app/routes.mjs";

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function loadRoutes() {
  try {
    return await import(new URL(`../../${ROUTE_MODULE}`, import.meta.url).href);
  } catch (error) {
    assert.fail(
      `${ROUTE_MODULE} is not loadable by plain node (${error.code ?? error.message}). m45/ADR-001: the route table is a framework-free .mjs module, drivable by node:test with no bundler and no DOM — the house pattern (ui/src/fleet/scope.mjs, ui/src/board/*.mjs), which is not optional because this repo has no React test harness at all.`,
    );
  }
}

// Compare a returned search string tolerantly (with or without a leading "?") but
// ORDER-SENSITIVELY — ADR-006 preserves a URL as TEXT, not merely as a set, which is what
// makes a bookmark comparison honest.
function searchEntries(search) {
  return [...new URLSearchParams(search ?? "").entries()];
}

export const archTests = [
  {
    name: "arch/45 ADR-001 (acd-route-logic-framework-free): the route module loads under plain node and imports no React, no DOM and no `location` of its own",
    run: async () => {
      await loadRoutes(); // the load itself is the proof — a JSX/hook-shaped table cannot do this.

      const code = stripComments(await readFile(path.join(repoRoot, ROUTE_MODULE), "utf8"));
      const imports = [...code.matchAll(/\bimport\s+[^;]*?\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);

      const framework = imports.filter((spec) => /^react(-dom)?(\/|$)|\.tsx?$|\/jsx-runtime$/.test(spec));
      assert.deepEqual(framework, [], `${ROUTE_MODULE} imports a framework/component module (${framework.join(", ")}) — the route table must stay headless (m45/ADR-001)`);

      // ADR-006: the router does not import the scope helper. Not knowing `scope` exists is
      // what keeps milestone 47's repo filter local to the fleet.
      assert.ok(
        !imports.some((spec) => /scope\.mjs$/.test(spec)),
        `${ROUTE_MODULE} imports the scope helper — ADR-006: the router carries EVERY unrecognised parameter through untouched and knows about none of them by name; ui/src/fleet/scope.mjs stays the sole owner of \`scope\``,
      );

      for (const global of ["window", "document", "location", "navigator", "history"]) {
        assert.ok(
          !new RegExp(`(^|[^.\\w])${global}\\s*\\.`).test(code),
          `${ROUTE_MODULE} reaches for the \`${global}\` global — the caller passes the URL parts IN and wires the result to history, exactly as ui/src/fleet/scope.mjs:42-54 does. A module with a DOM global in it is not headless-testable.`,
        );
      }
    },
  },

  {
    name: "arch/45 ADR-002 (acd-route-logic-framework-free): routeFor maps the four paths to four distinct surfaces, and an unknown path resolves to the not-found entry — NEVER to `/`",
    run: async () => {
      const { routeFor } = await loadRoutes();
      assert.equal(typeof routeFor, "function", "routeFor(pathname) is exported");

      const table = ["/", "/fleet", "/board", "/config"].map((pathname) => ({ pathname, route: routeFor(pathname) }));
      for (const entry of table) {
        assert.ok(entry.route != null, `routeFor("${entry.pathname}") resolves to a route entry`);
      }
      const distinct = new Set(table.map((entry) => JSON.stringify(entry.route)));
      assert.equal(distinct.size, 4, "the four paths of m45/ADR-002 resolve to four DISTINCT surfaces (/ shell landing, /fleet, /board, /config)");

      // An unknown path is the shell's not-found surface — one entry, shared, and NOT `/`.
      const missA = routeFor("/fleeet");
      const missB = routeFor("/definitely-not-a-route");
      assert.deepEqual(missA, missB, "every unknown path resolves to the SAME not-found entry");
      assert.notDeepEqual(
        missA,
        routeFor("/"),
        'an unknown path renders the shell\'s not-found surface — it is NEVER silently aliased or redirected to "/" (m45/ADR-002). A redirect makes a typo, a stale bookmark and a broken in-app link indistinguishable from a working one, at exactly the moment routing is newly introduced and in-app links are newly rewritten.',
      );
    },
  },

  {
    name: "arch/45 ADR-003+006 (acd-route-logic-framework-free): legacyRedirectFor translates every advertised legacy URL, drops ONLY `mode`, and carries `scope`, unknown parameters and the fragment through untouched",
    run: async () => {
      const { legacyRedirectFor } = await loadRoutes();
      assert.equal(typeof legacyRedirectFor, "function", "legacyRedirectFor({ pathname, search, hash }) is exported");

      // The URLs actually in the wild — the desktop app's compiled constant, board-url's
      // return value, and the assets launcher's announce.
      const cases = [
        { name: "the desktop tray's compiled MESH_UI_URL (supervisor.rs:44)", input: { pathname: "/", search: "?mode=fleet&scope=global", hash: "" }, pathname: "/fleet", params: [["scope", "global"]], hash: "" },
        { name: "board-url's drill-in (mesh-ui-serve.mjs:278 → Fleet.tsx:514)", input: { pathname: "/", search: "?mode=board", hash: "#42/03" }, pathname: "/board", params: [], hash: "#42/03" },
        { name: "the assets launcher's announce (assets-ui.mjs:45)", input: { pathname: "/", search: "?mode=assets", hash: "" }, pathname: "/config", params: [], hash: "" },
        // main.tsx:1266's `else` branch: ANY unrecognised mode rendered <App>. It keeps its
        // meaning verbatim rather than silently becoming a 404.
        { name: "an unrecognised mode value (main.tsx:1266's else branch)", input: { pathname: "/", search: "?mode=wat", hash: "" }, pathname: "/config", params: [], hash: "" },
        // ADR-006: preserve-by-default. `scope`, milestone 47's future repo filter and an
        // outright unknown key all survive, IN ORDER, alongside the fragment.
        { name: "scope + a future repo filter + an unknown key + a fragment, all at once", input: { pathname: "/", search: "?mode=fleet&scope=local&repo=aof&zz=1", hash: "#deep" }, pathname: "/fleet", params: [["scope", "local"], ["repo", "aof"], ["zz", "1"]], hash: "#deep" },
      ];

      for (const testCase of cases) {
        const result = legacyRedirectFor(testCase.input);
        assert.ok(result != null, `${testCase.name}: a legacy URL yields a redirect`);
        assert.equal(result.pathname, testCase.pathname, `${testCase.name}: → ${testCase.pathname}`);
        assert.deepEqual(
          searchEntries(result.search),
          testCase.params,
          `${testCase.name}: \`mode\` is the ONLY parameter removed, and the rest survive IN ORDER (ADR-006 is copy-and-delete, never build-from-a-known-list)`,
        );
        assert.equal(
          (result.hash ?? "").replace(/^#?/, "#").replace(/^#$/, ""),
          testCase.hash,
          `${testCase.name}: the fragment survives verbatim — a fragment never reaches the server, so only the client can preserve it (ADR-003's reason for replaceState over a server-side 3xx), and Board.tsx:585 reads it back`,
        );
      }
    },
  },

  {
    name: "arch/45 ADR-003 (acd-route-logic-framework-free): the translation is IDEMPOTENT — an already-canonical URL yields null, and re-applying it to its own output changes nothing",
    run: async () => {
      const { legacyRedirectFor } = await loadRoutes();

      for (const canonical of [
        { pathname: "/fleet", search: "?scope=global", hash: "" },
        { pathname: "/board", search: "", hash: "#42/03" },
        { pathname: "/config", search: "", hash: "" },
        { pathname: "/", search: "", hash: "" },
        { pathname: "/typo-not-a-route", search: "", hash: "" },
      ]) {
        assert.equal(
          legacyRedirectFor(canonical),
          null,
          `${canonical.pathname}${canonical.search}${canonical.hash} is already canonical — legacyRedirectFor returns null so the entry does nothing (ADR-003: applied EXACTLY ONCE, and running it twice must be a no-op)`,
        );
      }

      const once = legacyRedirectFor({ pathname: "/", search: "?mode=fleet&scope=global", hash: "" });
      assert.equal(legacyRedirectFor(once), null, "re-applying the translation to its own output is a no-op — replaceState can never loop");
    },
  },

  {
    name: "arch/45 ADR-006 (acd-route-logic-framework-free): the route module names NO query key but `mode` — a router that knows a parameter's name is a router that can drop it",
    run: async () => {
      await loadRoutes(); // guided failure when the module is absent, not a raw ENOENT.
      const code = stripComments(await readFile(path.join(repoRoot, ROUTE_MODULE), "utf8"));
      const named = [...code.matchAll(/\.(?:get|set|has|delete|getAll)\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
      const foreign = [...new Set(named)].filter((key) => key !== "mode");
      assert.deepEqual(
        foreign,
        [],
        `${ROUTE_MODULE} names the query key(s) ${foreign.join(", ")}. m45/ADR-006: the router matches on PATHNAME only; the ONE key it may name is \`mode\`, and the only thing it may do with it is delete it during the legacy translation. Every other parameter — \`scope\` today, milestone 47's repo filter tomorrow, anything unknown — is carried through by copying the incoming URLSearchParams, never by rebuilding from a known list.`,
      );
      // Non-vacuity: the detector genuinely reads this module's query handling.
      assert.ok(named.length > 0, `the analyzer found the route module's query handling (non-vacuous): ${JSON.stringify(named)}`);
    },
  },
];

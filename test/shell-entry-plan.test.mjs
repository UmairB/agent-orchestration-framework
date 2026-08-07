// Traceability wiring for milestone 45 / story 03, task 00 —
// `stories/03_story_app-shell-and-entry/tasks/00_entry-selects-a-surface.feature` (@executable).
//
// THE CHANNEL. The feature's own LITMUS: "every Then is a returned VALUE from a framework-free
// `.mjs` module that node:test loads with no bundler, no DOM and no browser". That module is
// `ui/src/app/entry.mjs` — the entry's decision, extracted exactly as the feature's FEASIBILITY
// note requires ("the steps read a plan of the shape `{ replace: {pathname,search,hash}|null,
// surface }` derived from the incoming URL parts"). `ui/src/main.tsx` does nothing with the
// plan but call `history.replaceState` when `replace` is non-null and hand `surface` to the
// shell, so nothing about the decision is left where a test cannot reach it.
//
// The two PLACEMENT invariants the feature explicitly does NOT assert here — "the entry imports
// surfaces and defines none", "there is exactly ONE route table and the render root reaches it"
// — belong to test/arch/acd-ui-single-route-table.test.mjs, and the route module's own purity
// and idempotence belong to acd-route-logic-framework-free. What is BEHAVIOURAL, and is the
// whole of this task, is the WIRING those two cannot see.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ROUTES, routeFor } from "../ui/src/app/routes.mjs";
import {
  applyEntryPlan,
  entryPlanFor,
  addressToString,
  surfaceMountFor,
  HISTORY_NONE,
  HISTORY_REPLACE,
} from "../ui/src/app/entry.mjs";
import { scopeFromSearch } from "../ui/src/fleet/scope.mjs";
import { withShellApp } from "./support/shell-app-harness.mjs";
import { findAll, textOf } from "./support/mini-react.mjs";

// A history that RECORDS instead of navigating. The entry's obligations are all about the
// call — one `replaceState`, no `pushState` ever, to the plan's own composed address — and a
// spy is the only thing that can see any of them: the plan being right says nothing about
// whether the entry passed it on, which is exactly the wiring F-45-03-E asked for.
function spyHistory() {
  const calls = [];
  return {
    calls,
    replaceState(...args) {
      calls.push({ method: "replaceState", args });
    },
    pushState(...args) {
      calls.push({ method: "pushState", args });
    },
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A `location`-shaped record, the way the entry reads one and the way a browser presents one:
// `search` carries its own "?", `hash` its own "#", and either may be "". Composing a URL
// string instead is how a fragment gets corrupted (F-45-01-G), which is why the entry takes
// parts and never a string.
function partsOf(address) {
  const [beforeHash, ...hashRest] = address.split("#");
  const hash = hashRest.length > 0 ? `#${hashRest.join("#")}` : "";
  const [pathname, ...searchRest] = beforeHash.split("?");
  const search = searchRest.length > 0 ? `?${searchRest.join("?")}` : "";
  return { pathname, search, hash };
}

// How the BOARD reads its fragment back (ui/src/board/Board.tsx:601-605, verbatim). The
// fragment is a live deep-link contract, so the passthrough is asserted through the surface's
// OWN reader rather than through the router's.
function boardFragmentRead(hash) {
  const ref = hash.replace(/^#/, "").trim();
  return ref || null;
}

export const shellEntryPlanTests = [
  // ======================================================================
  // Scenario Outline: each canonical path selects its own surface and asks for no rewrite
  // ======================================================================
  {
    name: "shell-entry/00 each canonical path selects its own surface and asks for NO history rewrite (00 scenario 1: /, /fleet, /board, /config)",
    run() {
      const rows = [
        { address: "/", surface: "landing" },
        { address: "/fleet", surface: "fleet" },
        { address: "/board", surface: "board" },
        { address: "/config", surface: "config" },
      ];
      for (const { address, surface } of rows) {
        const plan = entryPlanFor(partsOf(address));
        assert.equal(plan.surface, surface, `${address} selects ${surface}`);
        assert.equal(plan.replace, null, `${address} is already canonical — the entry writes NO history at all`);
        assert.equal(plan.history, HISTORY_NONE);
        assert.equal(addressToString(plan.address), address, `the surface's address is ${address}, byte-identical to what the operator typed`);
      }
      // The four are DISTINCT — "/" and "/config" most of all. Today they are the SAME thing:
      // no `?mode=` renders <App>, so on the config origin bare "/" IS the config editor. That
      // equality ending is the ONE URL whose meaning this milestone changes.
      const surfaces = rows.map((row) => entryPlanFor(partsOf(row.address)).surface);
      assert.equal(new Set(surfaces).size, 4, "four canonical addresses, four distinct surfaces");
    },
  },

  // ======================================================================
  // Scenario Outline: every advertised legacy address still lands on the surface it lands on
  // today, rewritten exactly once
  // ======================================================================
  {
    name: "shell-entry/00 every advertised legacy `?mode=` address lands on the same surface it lands on today, rewritten EXACTLY ONCE as a replace (00 scenario 2, all six rows)",
    run() {
      const rows = [
        // the desktop tray's compiled constant (supervisor.rs:44)
        { address: "/?mode=fleet&scope=global", surface: "fleet", canonical: "/fleet?scope=global" },
        // board-url's drill-in (mesh-ui-serve.mjs:278)
        { address: "/?mode=board#42/03", surface: "board", canonical: "/board#42/03" },
        // the assets launcher's announce (assets-ui.mjs:45)
        { address: "/?mode=assets", surface: "config", canonical: "/config" },
        // an UNRECOGNISED mode — main.tsx:1266's `else` branch, kept VERBATIM rather than
        // silently becoming a 404
        { address: "/?mode=wat", surface: "config", canonical: "/config" },
        // an EMPTY mode value — the boundary the ternary answers by accident today: "" is not
        // `fleet` and not `board`, so it falls through to <App>
        { address: "/?mode=", surface: "config", canonical: "/config" },
        // ROW 6, THE CONTESTED ROW, SETTLED AT BUILD: a legacy `mode` on an address that
        // ALREADY carries a path resolves to the PATH's surface, and nothing is rewritten —
        // the stray parameter rides through untouched like every other parameter the router
        // has never heard of. The reason is stated in ui/src/app/entry.mjs's header and in
        // routes.mjs's ("THE PATH WINS"): a legacy query parameter that could override a real
        // address is backwards for a milestone whose point is that the address bar is the
        // truth. What it is NOT is a 404.
        { address: "/fleet?mode=board", surface: "fleet", canonical: "/fleet?mode=board", noRewrite: true },
      ];

      for (const row of rows) {
        const plan = entryPlanFor(partsOf(row.address));
        assert.equal(plan.surface, row.surface, `${row.address} → ${row.surface}, the same surface this address renders today`);
        if (row.noRewrite) {
          assert.equal(plan.replace, null, `${row.address} carries a real path, so nothing is rewritten`);
        } else {
          assert.notEqual(plan.replace, null, `${row.address} asks for exactly ONE history rewrite`);
          assert.equal(addressToString(plan.replace), row.canonical, `${row.address} → ${row.canonical}`);
          // A REPLACE, never a push — the history stack stays exactly as deep as the
          // operator's own navigation made it.
          assert.equal(plan.history, HISTORY_REPLACE);
        }
        assert.equal(addressToString(plan.address), row.canonical, "the surface is handed the canonical address");
      }
    },
  },

  // ======================================================================
  // Scenario Outline: the surface is selected from the POST-rewrite address
  // ======================================================================
  {
    name: "shell-entry/00 the surface is selected from the POST-rewrite address, never the bare `/` that arrived (00 scenario 3)",
    run() {
      const rows = [
        { address: "/?mode=fleet&scope=global", surface: "fleet", canonical: "/fleet?scope=global" },
        { address: "/?mode=board#42/03", surface: "board", canonical: "/board#42/03" },
        { address: "/?mode=assets", surface: "config", canonical: "/config" },
      ];
      for (const row of rows) {
        const incoming = partsOf(row.address);
        assert.equal(incoming.pathname, "/", "every advertised legacy address has a bare `/` pathname — which is the whole hazard");
        const plan = entryPlanFor(incoming);
        assert.equal(plan.surface, row.surface, `${row.address} selects ${row.surface}, NOT the shell landing that bare "/" names`);
        assert.notEqual(plan.surface, "landing");
        assert.equal(addressToString(plan.address), row.canonical);
        // Selecting BEFORE rewriting would have answered `landing` for all three, and it would
        // have looked like a harmless reordering in review. The plan exposes no second surface
        // derived from the pre-rewrite address for anything to mount.
        assert.equal(routeFor(incoming.pathname).id, "landing", "the PRE-rewrite address does name the landing…");
        assert.equal(plan.route.id, row.surface, "…and the plan does not carry it: the only route in the plan is the post-rewrite one");
      }
    },
  },

  // ======================================================================
  // Scenario: the translation is applied once per load and re-deciding over its own output
  // asks for nothing further
  // ======================================================================
  {
    name: "shell-entry/00 the translation is applied ONCE per load, and re-deciding over its own output asks for nothing further — a replaceState cannot loop (00 scenario 4)",
    run() {
      const first = entryPlanFor(partsOf("/?mode=fleet&scope=global"));
      assert.equal(addressToString(first.replace), "/fleet?scope=global", "the first decision asks for one rewrite");

      const second = entryPlanFor(first.address);
      assert.equal(second.replace, null, "the second asks for NO rewrite at all");
      assert.equal(second.history, HISTORY_NONE);
      assert.equal(first.surface, "fleet");
      assert.equal(second.surface, "fleet", "both name the same surface, Fleet");

      // Landing DIRECTLY on the already-rewritten address is indistinguishable from the second
      // decision — the entry does nothing.
      const direct = entryPlanFor(partsOf("/fleet?scope=global"));
      assert.deepEqual(direct, second, "a fresh load of the canonical address and a re-decision over the rewrite's output are the same plan");
    },
  },

  // ======================================================================
  // Scenario: the translation is applied once per load — THE WIRING, through a spy history
  // ======================================================================
  {
    name: "shell-entry/00 the entry APPLIES the plan exactly once, as a replaceState to the plan's own address, and never a pushState (00 scenario 4, the wiring)",
    run() {
      // A legacy address: exactly ONE `replaceState`, with the address the plan composed, and
      // no `pushState` at all. The arguments are asserted whole — `(null, "", url)` is the
      // shape every browser requires and the third is the only one that means anything.
      const history = spyHistory();
      const plan = entryPlanFor(partsOf("/?mode=fleet&scope=global"));
      const written = applyEntryPlan(plan, history);

      assert.equal(history.calls.length, 1, "exactly one history call is made");
      assert.equal(history.calls[0].method, "replaceState");
      assert.deepEqual(history.calls[0].args, [null, "", "/fleet?scope=global"], "…to the plan's own address, composed by the one composer");
      assert.equal(history.calls[0].args[2], addressToString(plan.replace), "…and it IS the plan's address, not a second composition");
      assert.equal(written, "/fleet?scope=global", "the applier reports what it wrote");
      assert.equal(history.calls.filter((call) => call.method === "pushState").length, 0, "NEVER a push: a pushed entry makes Back bounce between the legacy URL and the canonical one");

      // A CANONICAL address writes NOTHING — not a replace, not a push, not a same-address
      // replace. A no-op that still called `replaceState` would show up as a history entry
      // rewritten on every load, which is invisible until something else reads the stack.
      const quiet = spyHistory();
      const nothing = applyEntryPlan(entryPlanFor(partsOf("/fleet?scope=global")), quiet);
      assert.deepEqual(quiet.calls, [], "a plan with no rewrite touches history not at all");
      assert.equal(nothing, null);

      // Re-applying the SAME plan's output is also silent, which is what makes "exactly once"
      // safe rather than merely intended: even a double application cannot loop.
      const again = spyHistory();
      applyEntryPlan(entryPlanFor(plan.address), again);
      assert.deepEqual(again.calls, []);

      // It is defensive about `history` itself, because this runs BEFORE the first render and
      // a throw here is a blank page on every origin at once.
      assert.doesNotThrow(() => applyEntryPlan(plan, null));
      assert.doesNotThrow(() => applyEntryPlan(plan, {}));
      assert.doesNotThrow(() => applyEntryPlan(null, spyHistory()));
    },
  },

  // ======================================================================
  // Scenario: a route id the entry has NO surface for is loud, never a blank content region
  // ======================================================================
  {
    name: "shell-entry/00 a route id the entry has no surface for renders the shell's FAILED state naming it — never a silent blank `<main>` (00 scenario 8, the loudness clause)",
    async run() {
      // The entry's surface map today. `landing` and `not-found` are absent ON PURPOSE — the
      // shell renders both itself — and everything else absent is a defect.
      const mapped = ["fleet", "board", "config"];

      for (const id of mapped) {
        const mount = surfaceMountFor(id, mapped);
        assert.equal(mount.mounts, true, `${id} mounts its surface`);
        assert.equal(mount.surfaceFailed, false);
        assert.equal(mount.shellRenders, false);
      }
      for (const id of ["landing", "not-found"]) {
        const mount = surfaceMountFor(id, mapped);
        assert.equal(mount.shellRenders, true, `${id} is rendered by the shell itself`);
        assert.equal(mount.mounts, false, "…so there is nothing to mount…");
        assert.equal(mount.surfaceFailed, false, "…and nothing is wrong");
      }

      // THE FIFTH ROUTE. This is the shape milestones 47 and 49 produce — a table row added in
      // one file, a surface map edited in another — and the old answer was `null`: an EMPTY
      // content region inside a working shell, with no error, no log and nothing in the
      // address bar to explain it. Indistinguishable, from the operator's side, from a surface
      // that has nothing to show.
      const orphan = surfaceMountFor("terminals", mapped);
      assert.equal(orphan.shellRenders, false, "`terminals` is not one of the two the shell renders itself");
      assert.equal(orphan.mounts, false, "…nothing is mounted for it…");
      assert.equal(orphan.surfaceFailed, true, "…so the shell's FAILED state is what stands, not a blank region");

      // …and the REAL shell really renders that state, naming the surface and offering the
      // retry that re-attempts the MOUNT.
      await withShellApp(
        { routeId: "terminals", address: partsOf("/terminals"), identity: "aof", viewportWidth: 1280, surfaceFailed: true },
        async (app) => {
          const main = app.mains()[0];
          const text = textOf(main);
          assert.match(text, /terminals/, "the failed state NAMES the surface that did not mount");
          assert.match(text, /Retry/, "…and offers the retry");
          assert.notEqual(textOf(main).trim(), "", "the content region is never blank");
          // The chrome is intact and fully usable — a surface that did not mount must never
          // trap the operator on it.
          assert.equal(app.navItems().length, 4);
          assert.ok(app.row("top-bar"), "the top bar stands");
        },
      );

      // The map's own keys are what the entry passes: a shape change there (an array, an
      // object) must not silently make every route "unknown".
      assert.deepEqual(surfaceMountFor("fleet", { fleet: () => null }), surfaceMountFor("fleet", ["fleet"]));
    },
  },

  // ======================================================================
  // Scenario Outline: everything but `mode` reaches the surface untouched, in order, and the
  // surface's own reader still finds it
  // ======================================================================
  {
    name: "shell-entry/00 everything but `mode` reaches the surface untouched and in ORDER, and the surface's own reader still finds it (00 scenario 5, all six rows)",
    run() {
      const rows = [
        {
          address: "/?mode=fleet&scope=local",
          surface: "fleet",
          survives: [["scope", "local"]],
          read: (plan) => assert.equal(scopeFromSearch(plan.address.search), "local", "`scopeFromSearch` (ui/src/fleet/scope.mjs) reads back \"local\""),
        },
        {
          address: "/?mode=fleet&scope=global&repo=aof",
          surface: "fleet",
          survives: [["scope", "global"], ["repo", "aof"]],
          read: (plan) => {
            assert.equal(scopeFromSearch(plan.address.search), "global");
            assert.equal(new URLSearchParams(plan.address.search).get("repo"), "aof", "milestone 47's future repo filter is untouched");
          },
        },
        {
          address: "/?mode=fleet&zz=1&scope=local",
          surface: "fleet",
          survives: [["zz", "1"], ["scope", "local"]],
          read: (plan) => {
            assert.equal(scopeFromSearch(plan.address.search), "local");
            assert.equal([...new URLSearchParams(plan.address.search).keys()][0], "zz", "`zz` — a parameter nothing in this repo knows — is still FIRST");
          },
        },
        {
          address: "/?mode=board#42/03",
          surface: "board",
          survives: [],
          read: (plan) => assert.equal(boardFragmentRead(plan.address.hash), "42/03", "the board's own fragment read (Board.tsx:601-605) → \"42/03\""),
        },
        {
          address: "/?mode=board&scope=local#42/03",
          surface: "board",
          survives: [["scope", "local"]],
          read: (plan) => {
            assert.equal(boardFragmentRead(plan.address.hash), "42/03");
            assert.equal(plan.address.search, "?scope=local", "the query is intact beside the fragment");
          },
        },
        {
          address: "/?mode=fleet&q=a%2Fb",
          surface: "fleet",
          survives: [["q", "a/b"]],
          read: (plan) => assert.equal(new URLSearchParams(plan.address.search).get("q"), "a/b", "the encoded value decodes to \"a/b\", as it does today"),
        },
        // THE RE-ENCODING ROWS (QA F-45-03-A; PO ruling 2026-08-07). The translation's
        // mechanism is copy-and-delete through `URLSearchParams`, which is what makes it
        // preserve-by-default — and `URLSearchParams.toString()` NORMALISES as it serialises:
        // a space comes back as "+" rather than "%20", and the sub-delimiters come back
        // percent-encoded. The ruling is that the mechanism stays (a hand-rolled strip would
        // buy byte-identity at the cost of dropping repeated `mode`s and re-opening the
        // two-vocabularies problem), and that EQUALITY IS DECODED PAIRS per ADR-006
        // [Amigos-3]: what a surface's own reader gets back is what must be preserved, because
        // that is what every consumer in this repo actually reads.
        {
          // A SPACE. "%20" in, "+" out — two spellings of the same value, and the fleet's
          // reader cannot tell them apart because `URLSearchParams` decodes both to " ".
          address: "/?mode=fleet&q=a%20b",
          surface: "fleet",
          survives: [["q", "a b"]],
          read: (plan) => {
            assert.equal(new URLSearchParams(plan.address.search).get("q"), "a b", "the value reads back as \"a b\"");
            assert.equal(plan.address.search, "?q=a+b", "…re-serialised as `+`, which is the same value and not the same bytes — the decoded pair is the contract");
          },
        },
        {
          // A VALUELESS parameter — the shape a feature flag takes. It must survive as
          // PRESENT-with-empty-value, never be dropped for having nothing to carry and never
          // become the string "undefined".
          address: "/?mode=fleet&debug",
          surface: "fleet",
          survives: [["debug", ""]],
          read: (plan) => {
            const params = new URLSearchParams(plan.address.search);
            assert.equal(params.has("debug"), true, "`debug` is still PRESENT");
            assert.equal(params.get("debug"), "", "…carrying the empty value it arrived with");
            assert.equal(plan.address.search.includes("undefined"), false);
          },
        },
        {
          // THE SUB-DELIMITERS. `~!*'()` are legal unencoded in a query and come back
          // percent-encoded; the DECODED text is byte-identical, which is the whole ruling.
          address: "/?mode=fleet&q=~!*'()",
          surface: "fleet",
          survives: [["q", "~!*'()"]],
          read: (plan) => {
            assert.equal(new URLSearchParams(plan.address.search).get("q"), "~!*'()", "the value reads back as the same text it arrived as");
            assert.notEqual(plan.address.search, "?q=~!*'()", "…through different bytes — re-encoded, never re-interpreted");
          },
        },
      ];

      for (const row of rows) {
        const plan = entryPlanFor(partsOf(row.address));
        assert.equal(plan.surface, row.surface);
        // Same keys, same values, same ORDER — order is asserted because a URL is preserved as
        // TEXT and not merely as a set, and because the third row is the one that tells a
        // copy-and-delete builder apart from a build-from-a-known-list one (which would drop
        // `zz` and pass every other row).
        assert.deepEqual([...new URLSearchParams(plan.address.search).entries()], row.survives, `${row.address} carries its parameters through unchanged, in order`);
        assert.equal(new URLSearchParams(plan.address.search).has("mode"), false, "`mode` is the ONLY thing removed");
        row.read(plan);
      }
    },
  },

  // ======================================================================
  // Scenario: the landing and the config editor are two different surfaces at two different
  // addresses
  // ======================================================================
  {
    name: "shell-entry/00 the landing and the config editor are two DIFFERENT surfaces at two different addresses (00 scenario 6)",
    run() {
      const landing = entryPlanFor(partsOf("/"));
      const config = entryPlanFor(partsOf("/config"));
      assert.notEqual(landing.surface, config.surface, "the two things that are one thing today are now two");
      assert.equal(landing.surface, "landing");
      assert.equal(config.surface, "config");
      // Neither is reachable by the other's address.
      assert.notEqual(entryPlanFor(partsOf("/")).surface, "config");
      assert.notEqual(entryPlanFor(partsOf("/config")).surface, "landing");
      // The config editor's surface is the SAME one every legacy `?mode=assets` and
      // unrecognised-mode address resolves to.
      for (const legacy of ["/?mode=assets", "/?mode=wat", "/?mode="]) {
        assert.equal(entryPlanFor(partsOf(legacy)).surface, config.surface, `${legacy} resolves to the config editor`);
      }
    },
  },

  // ======================================================================
  // Scenario: the entry's decision takes no origin input at all
  // ======================================================================
  {
    name: "shell-entry/00 the entry's decision takes NO origin input at all — one bundle, one table, three origins (00 scenario 7)",
    run() {
      // The same address offered on the fleet origin, on a board origin and on the config
      // origin. There is nowhere to PUT an origin: the decision's whole input is the three URL
      // parts, so the three cannot differ.
      const plans = ["fleet", "board", "config"].map(() => entryPlanFor({ pathname: "/board", search: "", hash: "" }));
      assert.equal(new Set(plans.map((plan) => plan.surface)).size, 1, "all three name the same surface");
      assert.equal(plans[0].surface, "board");
      // An extra argument (an origin, a host, a server flag) changes nothing, because the
      // function has no parameter to receive one.
      assert.equal(entryPlanFor.length, 1, "entryPlanFor takes exactly one argument — the URL parts");
      assert.deepEqual(
        entryPlanFor({ pathname: "/board", search: "", hash: "" }, { origin: "http://127.0.0.1:4181" }),
        plans[0],
        "a second argument is not read, because there is no origin conditional for it to feed",
      );
    },
  },

  // ======================================================================
  // Scenario: each surface is mounted with no new inputs, and the suites that already drive
  // the surfaces stay green untouched
  // ======================================================================
  {
    name: "shell-entry/00 the route table names the surface and carries no per-surface configuration, and the two surface harnesses still mount the COMPONENT directly (00 scenario 8)",
    async run() {
      for (const id of ["fleet", "board", "config"]) {
        const entry = ROUTES.find((route) => route.id === id);
        assert.ok(entry, `the table has an entry for ${id}`);
        // It names the surface and carries NOTHING a surface must read to render: no mode, no
        // shell handle, no route object threaded down.
        assert.deepEqual(Object.keys(entry).sort(), ["id", "path"], `the ${id} entry carries only its name and its path`);
      }

      // The harnesses mount the surface COMPONENT directly, never through the entry — so this
      // story forces no edit on them, and every existing behavioural suite driving those two
      // surfaces keeps its expectations.
      for (const [harness, surface] of [
        ["test/support/fleet-app-harness.mjs", "ui/src/fleet/Fleet.tsx"],
        ["test/support/board-app-harness.mjs", "ui/src/board/Board.tsx"],
      ]) {
        const source = await readFile(path.join(repoRoot, harness), "utf8");
        const parts = surface.split("/");
        assert.ok(
          source.includes(`"${parts[parts.length - 1]}"`) || source.includes(parts[parts.length - 1]),
          `${harness} mounts ${surface}`,
        );
        assert.ok(!source.includes("main.tsx"), `${harness} does NOT mount through the application entry`);
      }
    },
  },
];

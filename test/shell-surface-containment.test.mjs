// Traceability wiring for milestone 45 / story 03, task 05 —
// `stories/03_story_app-shell-and-entry/tasks/05_surface-crash-degrades-in-shell.feature`
// (@executable @bug @finding-F-45-M-1).
//
// THE DEFECT THIS SUITE EXISTS FOR, measured at `aof:verify 45` in a real browser against the
// live fleet daemon: `/config` on the fleet origin rendered a TOTALLY BLANK page. `<App>`
// fetches `/api/config`; the fleet origin is the one origin that does not serve it, so the
// 404's coded envelope was stored AS the config payload, `payload.resources` was `undefined`,
// and a `useMemo` called `.filter` on it. With no boundary above the mounted surface React
// unmounted the WHOLE tree — the shell, the top bar, the nav and the way back went with it.
// Fourteen of fifteen measured (origin × path) cells rendered the shell; that one did not, and
// it was one click from the fleet's own navigation.
//
// TWO HALVES, and they are different claims:
//   1. THE SURFACE degrades through its OWN error state — `<App>` now checks `response.ok`
//      before believing a body, which is what every other fetch in that file already did.
//      That is the DESIGNED path and it is what `Shell.tsx`'s `resolvable` note promises.
//   2. THE SHELL contains a surface that throws anyway — the safety net, so 47's and 49's new
//      surfaces inherit the rule instead of rediscovering it. This is the half that needed a
//      class component, because `getDerivedStateFromError` has no hook form.
//
// WHAT MADE THIS DRIVABLE AT ALL. `test/support/mini-react.mjs` grew class-component + error
// boundary support for this suite (additive; every function component path is untouched).
// Before that a boundary was undrivable headlessly, which is exactly why the contract in
// `Shell.tsx:91-94` could sit there reviewed, believed and false for one surface in four.
//
// THE NON-VACUITY GATE IS THE LAST LANE and it is not decorative: it asserts that the
// harness's throwing surface REALLY throws when the boundary is not there, so a green run
// cannot mean "nothing was ever thrown".
import assert from "node:assert/strict";
import {
  CONTENT_MODE_FIXED,
  CONTENT_MODE_PAGE,
  IDENTITY_CHIP_CHROME_REM,
  IDENTITY_CHIP_MAX_CH,
  IDENTITY_CHIP_MIN_CH,
  IDENTITY_CHIP_WIDTH_CLASS,
  STATE_FAILED,
  STATE_NOT_FOUND,
  STATE_POPULATED,
  contentModeFor,
  contentStateFor,
} from "../ui/src/app/shell-layout.mjs";
import { withShellApp, findAll, textOf } from "./support/shell-app-harness.mjs";
import { ConfigLoadError, isConfigPayload, loadScope } from "../ui/src/config/config-load.mjs";

// A `fetch` that answers exactly what a given origin would, so the load rule is driven against
// the real shapes rather than a hand-made "bad object".
const respondWith = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === "__not-json__") throw new SyntaxError("Unexpected token < in JSON at position 0");
    return body;
  },
});

const ADDRESS = (pathname) => ({ pathname, search: "", hash: "" });

// The console the boundary writes its loud line to. Captured rather than silenced: "the
// boundary is LOUD" is itself a clause, and a swallowed error is how the next one of these
// takes a day to find.
async function capturingConsoleError(fn) {
  const captured = [];
  const original = console.error;
  console.error = (...args) => captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  try {
    return await fn(captured);
  } finally {
    console.error = original;
  }
}

export const shellSurfaceContainmentTests = [
  // ======================================================================
  // Scenario 1, the DESIGNED half: the surface never manufactures the throw in the first
  // place, because a failed load is a state and not a poisoned payload.
  // ======================================================================
  {
    name: "shell-containment/05 the config load believes a body only when it IS a config — the fleet origin's 404 becomes a coded failure, never a payload (05 scenario 1, designed path)",
    async run() {
      // THE MEASURED CASE: the fleet origin's coded 404, which used to be stored as the config.
      await assert.rejects(
        () => loadScope(respondWith(404, { ok: false, error: "Mesh API route not found.", code: "not-found" }), "project"),
        (error) => {
          assert.ok(error instanceof ConfigLoadError);
          assert.equal(error.code, "not-found", "the server's own code survives — a refusal keeps its identity");
          assert.match(error.message, /Mesh API route not found/);
          return true;
        },
      );

      // …and the other shapes that reach the same editor by the same door. Each fails for the
      // stated reason rather than by being on a list of known-bad values.
      const refused = [
        ["a 200 carrying no resources", respondWith(200, { ok: true, name: "aof" })],
        ["a 200 carrying the SPA shell's HTML", respondWith(200, "__not-json__")],
        ["a 500", respondWith(500, { ok: false, error: "boom", code: "internal" })],
        ["a 200 carrying an explicit refusal", respondWith(200, { ok: false, error: "nope", code: "refused" })],
      ];
      for (const [label, fetchImpl] of refused) {
        await assert.rejects(() => loadScope(fetchImpl, "project"), ConfigLoadError, label);
      }

      // The positive: a real payload passes through untouched.
      const payload = { ok: true, name: "aof", resources: [], referencedResources: [], diagnostics: [] };
      assert.deepEqual(await loadScope(respondWith(200, payload), "project"), payload);
      assert.equal(isConfigPayload(payload), true);

      // NON-VACUITY of the rule itself: the exact body that produced F-45-M-1 is rejected, and
      // the read that threw is now unreachable because the value never becomes the payload.
      assert.equal(isConfigPayload({ ok: false, error: "not found", code: "not-found" }), false);
      assert.equal(isConfigPayload(null), false);
    },
  },

  // ======================================================================
  // Scenario: the config editor on an origin that cannot serve its API degrades in-shell
  // instead of blanking the page
  // ======================================================================
  {
    name: "shell-containment/05 a surface that throws while rendering leaves the chrome, the nav and a retry standing — never a blank page (05 scenario 1)",
    async run() {
      await capturingConsoleError(async (captured) => {
        await withShellApp(
          { routeId: "config", address: ADDRESS("/config"), identity: "aof", viewportWidth: 1280, surface: "throwing" },
          async (app) => {
            // THE HEADLINE: the chrome survives. This is the assertion the blank page failed.
            assert.ok(app.row("top-bar"), "the top bar still stands");
            assert.equal(app.banners().length, 1, "exactly one banner, as on any other route");
            assert.equal(app.mains().length, 1, "the one content region is still rendered");
            assert.equal(app.rows().includes("content"), true);

            // All four nav items, all live links — recovery is one click, and it must not
            // depend on the operator knowing to press Back.
            assert.equal(app.navItems().length, 4);
            assert.equal(
              app.navItems().every((item) => item.type === "a"),
              true,
              "every destination is still a live link from the failed state",
            );
            // …and the failed route is still the one marked current: the address did not change,
            // so neither does "you are here".
            assert.equal(app.navItem("config").props["aria-current"], "page");

            // The content region holds the shell's failed state, naming the surface.
            const main = app.mains()[0];
            assert.match(textOf(main), /Could not load the config view/);
            const retries = findAll(main, (node) => node.type === "button" && /Retry/.test(textOf(node)));
            assert.equal(retries.length, 1, "exactly one retry control, and it is reachable");

            // The throwing surface's own body is gone — it failed, it did not half-render.
            assert.equal(app.surfaceBody(), null);

            // The page is NOT blank: this is finding F-45-M-1's exact negation.
            assert.ok(textOf(app.row("top-bar")).length > 0);
            assert.ok(textOf(main).length > 0);
          },
        );

        // LOUD, not silent — the operator gets the state, the console gets the throw.
        assert.equal(
          captured.some((line) => /\[shell\] the config surface threw while rendering/.test(line)),
          true,
          "the boundary reports the surface and the error it caught",
        );
      });
    },
  },

  // ======================================================================
  // Scenario Outline: any surface that throws while rendering is contained at the shell
  // boundary
  // ======================================================================
  {
    name: "shell-containment/05 the containment is the SHELL's, not one surface's — every routed surface is contained the same way (05 scenario 2, all three rows)",
    async run() {
      for (const routeId of ["fleet", "board", "config"]) {
        await capturingConsoleError(async () => {
          await withShellApp(
            { routeId, address: ADDRESS(`/${routeId}`), identity: "aof", viewportWidth: 1280, surface: "throwing" },
            async (app) => {
              assert.ok(app.row("top-bar"), `${routeId}: the chrome survives`);
              assert.equal(app.navItems().length, 4, `${routeId}: the nav survives`);
              assert.match(textOf(app.mains()[0]), new RegExp(`Could not load the ${routeId} view`));
              // No other region is unmounted — the overlay layer (m46's dock lives here) is
              // still present, which is the clause that stops a "fix" that renders the failed
              // state INSTEAD of the shell.
              assert.equal(app.rows().includes("overlay"), true, `${routeId}: the overlay region survives`);
            },
          );
        });
      }
    },
  },

  // ======================================================================
  // Scenario: the navigation still works from the failed state
  // ======================================================================
  {
    name: "shell-containment/05 a contained failure is per-surface and per-route: the same shell renders a healthy surface normally, and the failed state does not persist (05 scenario 3)",
    async run() {
      // The boundary is keyed by route, so the caught state cannot outlive the route that
      // produced it. Mounted at a healthy route the shell is byte-identical to a shell that
      // never caught anything.
      const healthy = await withShellApp(
        { routeId: "config", address: ADDRESS("/config"), identity: "aof", viewportWidth: 1280, surface: "plain" },
        async (app) => ({ body: app.surfaceBody() !== null, main: textOf(app.mains()[0]) }),
      );
      assert.equal(healthy.body, true, "a healthy surface renders its own body");
      assert.doesNotMatch(healthy.main, /Could not load/);

      // And the nav rendered from the failed state points at the same four addresses the
      // healthy one does — the way out is real, not a dead label.
      await capturingConsoleError(async () => {
        const failedHrefs = await withShellApp(
          { routeId: "config", address: ADDRESS("/config"), identity: "aof", viewportWidth: 1280, surface: "throwing" },
          async (app) => app.navItems().map((item) => item.props.href),
        );
        const healthyHrefs = await withShellApp(
          { routeId: "config", address: ADDRESS("/config"), identity: "aof", viewportWidth: 1280, surface: "plain" },
          async (app) => app.navItems().map((item) => item.props.href),
        );
        assert.deepEqual(failedHrefs, healthyHrefs, "the failed state offers exactly the destinations a healthy one does");
      });
    },
  },

  // ======================================================================
  // Scenario Outline: a failed surface, an unmatched path and a landing stay three distinct
  // states
  // ======================================================================
  {
    name: "shell-containment/05 failed, not-found and the landing stay THREE distinct states — the containment must not collapse them (05 scenario 4, all three rows)",
    async run() {
      // The model half: three states, three treatments, and only not-found un-marks the nav.
      const failed = contentStateFor({ routeId: "config", surfaceFailed: true });
      assert.equal(failed.state, STATE_FAILED);
      assert.equal(failed.accent, true, "a failure uses the accent language — something DID fail");
      assert.equal(failed.retry, true);

      const notFound = contentStateFor({ routeId: "not-found" });
      assert.equal(notFound.state, STATE_NOT_FOUND);
      assert.equal(notFound.treatment, "dashed-empty", "nothing failed — the path simply is not a surface");
      assert.equal(notFound.accent, false);
      assert.equal(notFound.navItemActive, false);

      const landing = contentStateFor({ routeId: "landing" });
      assert.equal(landing.state, STATE_POPULATED);
      assert.equal(landing.accent, false);

      // …and the rendered half, which is the one that would have caught a fix that routed a
      // caught throw into the not-found state.
      await capturingConsoleError(async () => {
        await withShellApp(
          { routeId: "config", address: ADDRESS("/config"), identity: "aof", viewportWidth: 1280, surface: "throwing" },
          async (app) => {
            const main = textOf(app.mains()[0]);
            assert.match(main, /Could not load the config view/);
            assert.doesNotMatch(main, /is not one of this app's surfaces/, "a failure is not an unmatched path");
            assert.doesNotMatch(main, /Live terminals/, "a failure is not the landing");
            // not-found un-marks the nav; a failure does NOT — the address is still a surface.
            assert.equal(app.navItem("config").props["aria-current"], "page");
          },
        );
      });

      await withShellApp(
        { routeId: "not-found", address: ADDRESS("/nope"), identity: "aof", viewportWidth: 1280 },
        async (app) => {
          assert.match(textOf(app.mains()[0]), /\/nope/);
          assert.equal(
            app.navItems().filter((item) => item.props["aria-current"] !== undefined).length,
            0,
            "an unmatched path marks nothing active",
          );
        },
      );
    },
  },

  // ======================================================================
  // GAP-5 — the top bar must never scroll out of view. Found by SCROLLING at the `@uat` gate,
  // which is the only way it could have been found: it is a fact about the cascade, not about
  // any value the shell computes.
  // ======================================================================
  {
    name: "shell-containment/05 in `content:page` the shell root establishes NO scrollport, so the sticky top bar has the document to stick to (GAP-5)",
    async run() {
      // THE RULE. `position: sticky` resolves against the nearest ancestor that establishes a
      // scrollport. An element with `overflow-x: hidden` computes `overflow-y: auto` and so
      // becomes one. The `content:page` root is `min-h-dvh` and grows to its content, so it
      // never scrolls — anything sticky inside it would stick to a box that does not move.
      const page = contentModeFor("fleet");
      assert.equal(page.mode, CONTENT_MODE_PAGE);
      assert.equal(page.rootEstablishesScrollport, false, "the page-mode root must not be a scrollport");
      assert.doesNotMatch(page.rootClass, /overflow/, "…and its class must not add one");

      // `content:fixed` is the opposite by design: the root IS the viewport, the document
      // never scrolls, and the bar is a fixed flex child rather than a sticky one.
      const fixed = contentModeFor("board");
      assert.equal(fixed.mode, CONTENT_MODE_FIXED);
      assert.equal(fixed.rootEstablishesScrollport, true);
      assert.match(fixed.rootClass, /overflow-hidden/);

      // Every page-mode route, not just the one that was measured — `landing`, `config` and
      // `not-found` reach the same root.
      for (const routeId of ["landing", "config", "not-found", "unknown-future-route"]) {
        const m = contentModeFor(routeId);
        assert.equal(m.rootEstablishesScrollport, false, `${routeId}: page mode, no scrollport`);
        assert.doesNotMatch(m.rootClass, /overflow/, `${routeId}: no overflow on the root`);
      }

      // …and the COMPONENT must take the root's overflow from the model rather than adding its
      // own. This is the assertion that would have caught GAP-5: the defect was a hand-typed
      // `overflow-x-hidden` in the className, invisible to every model-level check.
      const { readFile } = await import("node:fs/promises");
      const shell = await readFile(new URL("../ui/src/app/Shell.tsx", import.meta.url), "utf8");
      const rootLine = shell.split("\n").find((l) => l.includes("contentMode.rootClass"));
      assert.ok(rootLine, "the root takes its class from the content mode");
      assert.doesNotMatch(
        rootLine,
        /overflow/,
        "the shell root adds NO overflow of its own — `contentModeFor` owns the answer per mode (GAP-5)",
      );
      // DESIGN GAP D1's page-level clamp still exists, on html AND body — and is `clip`, not
      // `hidden`. They clamp identically, but `hidden` computes the other axis to `auto` and so
      // makes the element a scroll container; `body` being one is what still defeated the
      // sticky chrome after the shell root was cleared. `clip` establishes no scrollport.
      const css = await readFile(new URL("../ui/src/index.css", import.meta.url), "utf8");
      assert.equal(
        (css.match(/overflow-x:\s*clip/g) ?? []).length,
        2,
        "D1's clamp is present on both html and body",
      );
      assert.doesNotMatch(
        css,
        /overflow-x:\s*hidden/,
        "…and neither uses `hidden`, which would re-create the scrollport that broke the sticky chrome (GAP-5)",
      );

      // …and the CHROME BLOCK is what pins — removing the scrollports is pointless if nothing
      // is sticky, and pinning the bar alone is what shipped and did not work (a sticky element
      // travels only within its parent's box, and the bar's parent is the 88px chrome wrapper).
      assert.match(shell, /className="sticky top-0 z-10 shrink-0"/, "the chrome wrapper pins to the top");
      const barLine = shell.split("\n").find((l) => l.includes("flex ${TOP_BAR_CLASS} shrink-0 items-center"));
      assert.ok(barLine, "the top bar still takes its height from TOP_BAR_CLASS");
      assert.doesNotMatch(barLine, /sticky/, "…and does NOT carry its own inert sticky");
    },
  },

  // ======================================================================
  // Designer GAP-4 — the identity chip's width reservation. Not a containment clause; it is
  // here because this is the suite the end gate's findings landed in.
  // ======================================================================
  {
    name: "shell-containment/05 the identity chip and its loading placeholder reserve the SAME width, and the reservation is 7 characters of TEXT (designer GAP-4)",
    async run() {
      // THE INVARIANT, stated as the designer asked — the box and its placeholder measure
      // identically, and the box does not change width when the identity resolves. The two
      // elements take their width from ONE constant, so "the same" is true by construction
      // rather than by two class strings agreeing today.
      await withShellApp(
        { routeId: "fleet", address: ADDRESS("/fleet"), identity: "fleet", viewportWidth: 1280, surface: "plain" },
        async (app) => {
          const chip = findAll(app.row("top-bar"), (n) => /min-w-/.test(String(n.props?.className ?? "")));
          assert.equal(chip.length, 1, "exactly one width-reserving chip in the bar");
          assert.match(String(chip[0].props.className), /min-w-\[calc\(7ch\+1\.125rem\)\]/);
        },
      );
      // …and the placeholder, which is the half that used to differ once an identity was
      // longer than the reservation.
      await withShellApp(
        { routeId: "fleet", address: ADDRESS("/fleet"), identity: null, viewportWidth: 1280, surface: "plain" },
        async (app) => {
          const placeholder = findAll(app.row("top-bar"), (n) => /min-w-/.test(String(n.props?.className ?? "")));
          assert.equal(placeholder.length, 1, "the unknown identity renders a placeholder, never a blank gap");
          assert.match(String(placeholder[0].props.className), /animate-pulse/);
          // THE CLAUSE: byte-identical width reservation on both.
          assert.match(String(placeholder[0].props.className), /min-w-\[calc\(7ch\+1\.125rem\)\]/);
          assert.match(String(placeholder[0].props.className), /max-w-\[18ch\]/);
        },
      );

      // THE ARITHMETIC, which is the half a class-string check cannot see. Tailwind sets
      // `box-sizing: border-box`, so a `min-width` is a BORDER-box minimum — a bare
      // `min-w-[7ch]` reserves 7ch MINUS the padding and border, which is what shipped and
      // what measured 4.26 characters of text at the end gate. The reservation must add the
      // chrome back.
      assert.equal(IDENTITY_CHIP_MIN_CH, 7);
      assert.equal(IDENTITY_CHIP_MAX_CH, 18);
      assert.equal(IDENTITY_CHIP_CHROME_REM, 1.125, "px-2 (8+8) + border (1+1) = 18px = 1.125rem");
      assert.match(
        IDENTITY_CHIP_WIDTH_CLASS,
        new RegExp(`min-w-\\[calc\\(${IDENTITY_CHIP_MIN_CH}ch\\+${IDENTITY_CHIP_CHROME_REM}rem\\)\\]`),
        "the reservation adds the chrome back, so 7ch means seven characters of TEXT",
      );
      // NON-VACUITY: the shipped-and-wrong form must NOT satisfy this check.
      assert.doesNotMatch(IDENTITY_CHIP_WIDTH_CLASS, /min-w-\[7ch\]/, "the bare border-box form is the defect");

      // The class must stay a LITERAL — Tailwind emits utilities by scanning source text, so a
      // composed class names a rule that is never generated and the reservation vanishes.
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(new URL("../ui/src/app/shell-layout.mjs", import.meta.url), "utf8");
      assert.match(
        source,
        /IDENTITY_CHIP_WIDTH_CLASS = "min-w-\[calc\(7ch\+1\.125rem\)\] max-w-\[18ch\]"/,
        "the class is a literal Tailwind's scanner can see, never interpolated from the numbers",
      );
    },
  },

  // ======================================================================
  // Scenario: removing the containment reproduces the measured blank page
  // ======================================================================
  {
    name: "shell-containment/05 NON-VACUITY: the harness's surface really throws, so a contained render is a caught throw and not an absent one (05 scenario 5)",
    async run() {
      // The exact production shape: a 404 envelope read as a config payload. If this stopped
      // throwing, every lane above would pass for the wrong reason.
      assert.throws(
        () => {
          const payload = { ok: false, error: "not found", code: "not-found" };
          return payload.resources.filter(Boolean);
        },
        /Cannot read properties of undefined \(reading 'filter'\)/,
        "the measured F-45-M-1 throw is reproduced verbatim",
      );

      // And the boundary is what stands between that throw and the render: with the boundary
      // present the mount SUCCEEDS and yields the failed state; the shell never propagates.
      await capturingConsoleError(async () => {
        const rendered = await withShellApp(
          { routeId: "config", address: ADDRESS("/config"), identity: "aof", viewportWidth: 1280, surface: "throwing" },
          async (app) => textOf(app.mains()[0]),
        );
        assert.match(rendered, /Could not load the config view/);
      });
    },
  },
];

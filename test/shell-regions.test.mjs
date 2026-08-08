// Traceability wiring for milestone 45 / story 03, task 01 —
// `stories/03_story_app-shell-and-entry/tasks/01_shell-regions.feature` (@executable).
//
// THE CHANNEL. The feature's LITMUS: "every Then is a returned VALUE from
// `ui/src/app/shell-layout.mjs` — the framework-free module ADR-005 names, loaded by node:test
// with no bundler and no DOM. The shell's LAYOUT is therefore tested as a MODEL." Every lane
// below reads that model.
//
// THREE CLAUSES ARE ABOUT THE DOCUMENT, NOT THE MODEL, and they are driven through the REAL
// rendered tree instead (test/support/shell-app-harness.mjs, and the fleet's and board's own
// harnesses): that exactly one `banner` and one `<main>` SURVIVE the absorption of the
// surfaces' own bars, that the skip link is the FIRST focusable element, and that no routed
// surface paints a brand mark or a wordmark of its own. A model cannot see any of those, and
// they are precisely what the absorption could regress.
//
// WHAT STAYS IN TASK 04's @uat RENDER VERDICT: whether 88px of chrome really leaves 432px in
// the Rust app's window, whether the page double-scrolls, whether the rail really pushes rather
// than overlays, whether the bar survives the 390 squeeze without a horizontal scrollbar. Those
// are pixel facts judged by a person over renders — the m43 split, structural half here.
import assert from "node:assert/strict";
import {
  BRAND_MARK,
  CHROME_BUDGET,
  CHROME_HEIGHT_PROPERTY,
  CONTENT_FLOOR,
  CONTENT_HEIGHT_EXPRESSION,
  CONTENT_MODE_FIXED,
  CONTENT_MODE_PAGE,
  CONTENT_REGION_ID,
  NOTICE_RAIL_CLASS,
  NOTICE_RAIL_MAX_VIEWPORT_FRACTION,
  REGIONS,
  REGION_CHROME,
  REGION_CONTENT,
  REGION_OVERLAY,
  ROW_ORDER,
  SHELL_CARD_CLASS,
  SHELL_CARD_WRAPPER_CLASS,
  SURFACE_BAR_CLASS,
  SURFACE_BAR_HEIGHT,
  TOP_BAR_CLASS,
  IDENTITY_CHIP_WIDTH_CLASS,
  TOP_BAR_HEIGHT,
  TOP_BAR_LEFT_OF_SLOT,
  WORDMARK,
  Z_LADDER,
  Z_LADDER_FLOOR,
  chromeModel,
  contentModeFor,
  landmarksModel,
  rungFor,
  shellRows,
  surfaceBarStands,
  topBarModel,
} from "../ui/src/app/shell-layout.mjs";
import { routeFor } from "../ui/src/app/routes.mjs";
import { withShellApp, withShellComposedFleet } from "./support/shell-app-harness.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";
import { withBoardApp } from "./support/board-app-harness.mjs";
import { withPublishedAssignFixture } from "./support/mesh-ui-assign-fixture.mjs";
import { findAll, textOf } from "./support/mini-react.mjs";

// An origin nothing is listening on. These lanes are STRUCTURAL — they ask what a surface
// contributes and what landmarks it declares, which is true in every page state — so the
// surface's own error state is as good a state to read as any, and it needs no fixture server.
const NO_SERVER = "http://127.0.0.1:9";

export const shellRegionsTests = [
  // ======================================================================
  // Scenario Outline: the five regions are yielded in the declared order, and a conditional
  // one absent occupies zero height
  // ======================================================================
  {
    name: "shell-regions/01 the five rows are yielded in ONE declared order, and a conditional one absent occupies zero height (01 scenario 1, all four rows)",
    run() {
      const rows = [
        { name: "the ordinary desktop shell", notice: null, surfaceBar: false, r1: 0, r3: 0 },
        { name: "the board's serverGone strip up", notice: { height: 33 }, surfaceBar: false, r1: 33, r3: 0 },
        { name: "narrow, the slot has dropped", notice: null, surfaceBar: true, r1: 0, r3: 40 },
        { name: "both conditionals present", notice: { height: 33 }, surfaceBar: true, r1: 33, r3: 40 },
      ];

      for (const row of rows) {
        const yielded = shellRows({ notice: row.notice, surfaceBar: row.surfaceBar });
        assert.deepEqual(
          yielded.map((region) => region.row),
          ["notice-rail", "top-bar", "surface-bar", "content", "overlay"],
          `${row.name}: their order is exactly notice rail, top bar, surface bar, content, overlay`,
        );
        assert.equal(yielded[0].height, row.r1, `${row.name}: the notice rail's height`);
        assert.equal(yielded[2].height, row.r3, `${row.name}: the surface bar's height`);
        // "measured", not a constant: the rail's height is content-driven and is an INPUT to
        // the model, never a number the model invents.
        assert.equal(yielded[0].measured, true, "the rail's height is measured, never assumed");
        assert.equal(yielded[1].height, TOP_BAR_HEIGHT, "the top bar is a fixed 48px");
        // The content region is the FOURTH region in every combination — its position never
        // depends on what is present above it.
        assert.equal(yielded[3].row, "content", `${row.name}: content is the fourth region`);
        assert.equal(yielded[3].region, REGION_CONTENT);
        // The overlay is out of flow and contributes zero to the height of anything.
        assert.equal(yielded[4].inFlow, false);
        assert.equal(yielded[4].height, 0);
      }

      // [Build-4] — five visual ROWS, THREE exported region constants. R1–R3 are interior
      // structure of `chrome`; a module exporting five would put two conditional, purely
      // internal names into the vocabulary of milestones 46, 47 and 49.
      assert.deepEqual([...REGIONS], [REGION_CHROME, REGION_CONTENT, REGION_OVERLAY]);
      assert.equal(REGIONS.length, 3, "exactly three region constants");
      assert.deepEqual([...ROW_ORDER].length, 5, "…and five rows");
      assert.deepEqual(
        shellRows().filter((region) => region.region === REGION_CHROME).map((region) => region.row),
        ["notice-rail", "top-bar", "surface-bar"],
        "R1–R3 all belong to the ONE region named `chrome`",
      );
    },
  },

  // ======================================================================
  // Scenario Outline: the chrome budget holds at the desktop window's height, and the one
  // combination that breaches it is reported rather than absorbed
  // ======================================================================
  {
    name: "shell-regions/01 the chrome budget holds at 520 tall, and the one combination that breaches it is REPORTED rather than absorbed (01 scenario 2, all six rows)",
    run() {
      // Each row carries its EXACT verdict, not just the boolean (QA F-45-03-G). `within` and
      // `at-budget` are both "within budget" and are NOT the same measurement — one has room
      // and the other has exactly none — so a boolean cannot tell a model that reports the
      // floor correctly from one that reports it as comfortable. The DESIGN table's six rows
      // are the six answers, and the verdict is the value an outsider (or m46's dock) reads.
      const rows = [
        { name: "one bar, the primary judgement width", width: 1280, notice: null, surfaceBar: false, chrome: 48, content: 472, within: true, verdict: "within" },
        { name: "the desktop-app proxy, slot dropped", width: 768, notice: null, surfaceBar: true, chrome: 88, content: 432, within: true, verdict: "at-budget" },
        { name: "mobile, slot dropped", width: 390, notice: null, surfaceBar: true, chrome: 88, content: 432, within: true, verdict: "at-budget" },
        { name: "a notice on a wide viewport", width: 1280, notice: { height: 33 }, surfaceBar: false, chrome: 81, content: 439, within: true, verdict: "within" },
        { name: "a notice AND a surface bar", width: 768, notice: { height: 33 }, surfaceBar: true, chrome: 121, content: 399, within: false, verdict: "breach" },
        { name: "a fullscreen occupant is presented", width: 768, notice: null, surfaceBar: true, fullscreen: true, chrome: 0, content: 520, within: true, verdict: "hidden" },
      ];

      for (const row of rows) {
        const model = chromeModel({ viewportHeight: 520, viewportWidth: row.width, notice: row.notice, surfaceBar: row.surfaceBar, fullscreen: row.fullscreen === true });
        assert.equal(model.height, row.chrome, `${row.name}: the chrome height is ${row.chrome}`);
        assert.equal(model.contentHeight, row.content, `${row.name}: the content region's available height is ${row.content}`);
        assert.equal(model.verdict, row.verdict, `${row.name}: the verdict is exactly \`${row.verdict}\``);
        assert.equal(model.withinBudget, row.within, `${row.name}: …and whether that verdict holds the budget`);
      }
      // The six rows really do exercise all four verdicts — otherwise the assertion above is
      // one value asserted six times.
      assert.deepEqual(
        [...new Set(rows.map((row) => row.verdict))].sort(),
        ["at-budget", "breach", "hidden", "within"],
        "the DESIGN table's rows cover every verdict the model can return",
      );

      // ROW 2/3 — 88px of chrome leaves EXACTLY the 432px floor. The feature spells the same
      // measurement two ways ("AT the budget — the exact floor" and "within"); the model
      // answers with one value for one measurement, and both readings agree that it holds.
      const atFloor = chromeModel({ viewportHeight: 520, viewportWidth: 768, surfaceBar: true });
      assert.equal(atFloor.verdict, "at-budget");
      assert.equal(atFloor.contentHeight, CONTENT_FLOOR);
      assert.equal(atFloor.barsHeight, CHROME_BUDGET, "the two BARS are exactly the 88px the budget counts");

      // ROW 5 — THE EDGE CASE THIS TASK EXISTS TO SURFACE. The rail is exempt from the cap and
      // ADDITIVE to it, so the published height grows by its measured height and every surface
      // sizing against it stays correct; only the VERDICT changes, and it is a value an
      // outsider can read. Nothing is absorbed: no blank band is reserved, the content region
      // is not clamped to preserve 432, and no bar scrolls away to make room.
      const breach = chromeModel({ viewportHeight: 520, viewportWidth: 768, notice: { height: 33 }, surfaceBar: true });
      assert.equal(breach.verdict, "breach");
      assert.equal(breach.noticeRailExempt, true);
      assert.equal(breach.barsHeight, CHROME_BUDGET, "the BARS are still within their cap — the rail is what breached the floor");
      assert.equal(breach.barsWithinBudget, true);
      assert.equal(breach.height, 121, "the published height GREW by the rail rather than the rail being clamped");
      assert.match(breach.reason, /notice rail/, "the breach names its own cause");
      assert.equal(breach.contentHeight < CONTENT_FLOOR, true);

      // …and the exemption is BOUNDED, so it cannot run away: one notice, and at most 25% of
      // the viewport height, past which the rail scrolls INSIDE ITSELF rather than truncating
      // the sentence an alert exists to speak.
      assert.equal(breach.noticeRailCap, 130, "25% of a 520-tall viewport");
      assert.equal(breach.noticeRailScrollsInsideItself, false, "a 33px rail is nowhere near the bound");
      assert.equal(chromeModel({ viewportHeight: 520, notice: { height: 200 } }).noticeRailScrollsInsideItself, true, "past the bound it scrolls inside itself");

      // ROW 6 — chrome GONE means the occupant gets the whole viewport, which is exactly why
      // the budget is a published number rather than a constant.
      const fullscreen = chromeModel({ viewportHeight: 520, surfaceBar: true, fullscreen: true });
      assert.equal(fullscreen.height, 0, "chrome is hidden, not overlaid");
      assert.equal(fullscreen.contentHeight, 520);
      assert.equal(fullscreen.verdict, "hidden");
    },
  },

  // ======================================================================
  // Scenario: the chrome height is published as ONE variable in dynamic viewport units
  // ======================================================================
  {
    name: "shell-regions/01 the chrome height is published ONCE, under one name, in `dvh` — never the constant 48 and never `vh` (01 scenario 3)",
    async run() {
      const model = chromeModel({ viewportHeight: 520, notice: { height: 33 }, surfaceBar: true });
      // Published once, under one name, as the measured sum of every region above the content
      // region.
      assert.equal(model.property, "--aof-shell-chrome-height");
      assert.equal(model.property, CHROME_HEIGHT_PROPERTY);
      assert.equal(model.value, "121px");
      assert.equal(model.height, shellRows({ notice: { height: 33 }, surfaceBar: true }).slice(0, 3).reduce((sum, row) => sum + row.height, 0), "…the measured SUM of R1 + R2 + R3");

      // The sizing expression a surface is given subtracts that ONE name from 100dvh.
      assert.equal(CONTENT_HEIGHT_EXPRESSION, "calc(100dvh - var(--aof-shell-chrome-height))");
      assert.equal(model.sizingExpression, CONTENT_HEIGHT_EXPRESSION);
      assert.match(model.sizingExpression, /100dvh/);
      assert.equal(/\dvh\b/.test(model.sizingExpression.replace(/dvh/g, "")), false, "it names `dvh`, never `vh` — a mobile browser's collapsing URL bar changes the viewport");
      assert.equal(model.unit, "dvh");

      // It is NEVER the literal 48, which is wrong in every combination where a notice rail or
      // a surface bar is present.
      assert.notEqual(model.height, TOP_BAR_HEIGHT);
      assert.equal(chromeModel({ surfaceBar: true }).height, TOP_BAR_HEIGHT + SURFACE_BAR_HEIGHT);

      // A surface derives its available height from it WITHOUT measuring the document — and
      // the REAL shell really does publish it, on its own root, where m46's dock will read it.
      await withShellApp({ routeId: "board", address: { pathname: "/board", search: "", hash: "" }, identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        assert.equal(app.chromeHeight(), "48px", "the rendered shell publishes the height it modelled");
        const root = findAll(app.tree(), (node) => typeof node.props?.["data-shell-chrome-height"] === "string")[0];
        assert.equal(root.props.style[CHROME_HEIGHT_PROPERTY], "48px", "…as the ONE named CSS custom property, on the shell root");
      });
    },
  },

  // ======================================================================
  // Scenario Outline: each route declares one content mode, and the mode declares exactly one
  // scroll owner — never the content region itself
  // ======================================================================
  {
    name: "shell-regions/01 each route declares one content mode with exactly one scroll owner, never the content region itself (01 scenario 4, all five rows)",
    run() {
      const rows = [
        { name: "the landing", pathname: "/", mode: CONTENT_MODE_PAGE, owner: "page" },
        { name: "the fleet, as it is today", pathname: "/fleet", mode: CONTENT_MODE_PAGE, owner: "page" },
        { name: "the config editor", pathname: "/config", mode: CONTENT_MODE_PAGE, owner: "page" },
        { name: "the board, as it is today", pathname: "/board", mode: CONTENT_MODE_FIXED, owner: "descendants" },
        { name: "no route matched", pathname: "/nope", mode: CONTENT_MODE_PAGE, owner: "page" },
      ];

      for (const row of rows) {
        const mode = contentModeFor(routeFor(row.pathname).id);
        assert.equal(mode.mode, row.mode, `${row.name}: the mode`);
        assert.equal(mode.scrollOwner, row.owner, `${row.name}: the declared scroll owner`);
        // `min-height: 0` is load-bearing and non-obvious — a flex child defaults to
        // `min-height: auto`, so an overflowing child silently grows the parent and every
        // "size to the box" calculation is wrong in a way that only shows up with real content.
        assert.equal(mode.minHeight, 0, `${row.name}: the content region declares min-height 0 in BOTH modes`);
        assert.match(mode.contentClass, /min-h-0/);
        // In `content:fixed` the content region is NEVER itself the scroll owner.
        assert.equal(mode.regionOwnsScroll, false);
        // DESIGN GAP D1's backstop survives in both modes — the shell must not remove it.
        assert.equal(mode.pageRootOverflowX, "hidden");
      }

      assert.notEqual(contentModeFor("board").mode, contentModeFor("fleet").mode, "the two modes are genuinely different, and neither is redesigned");
    },
  },

  // ======================================================================
  // Scenario: the shell owns exactly one banner and exactly one `<main>`, and the content
  // region is the single mount point
  // ======================================================================
  {
    name: "shell-regions/01 the shell owns exactly ONE banner and ONE `<main>`, the content region is the single mount point, and the skip link is the first focusable element (01 scenario 5)",
    async run() {
      const landmarks = landmarksModel();
      assert.deepEqual([...landmarks.banner], ["top-bar"], "exactly one region declares the `banner` landmark — the top bar");
      assert.deepEqual([...landmarks.main], ["content"], "exactly one region declares `main` — the content region");
      assert.equal(landmarks.skipLinkTarget, `#${CONTENT_REGION_ID}`);

      // The REAL shell, with a surface mounted: one banner, one main, and the skip link first.
      await withShellApp(
        { routeId: "fleet", address: { pathname: "/fleet", search: "", hash: "" }, identity: "aof", surface: "contributing", slotLabels: ["Scope"], viewportWidth: 1280 },
        async (app) => {
          assert.equal(app.banners().length, 1, "exactly one banner in the rendered document");
          assert.equal(app.mains().length, 1, "exactly one <main>");
          assert.equal(app.mains()[0].props.id, CONTENT_REGION_ID);
          // The content region holds exactly one mounted surface, or one of the shell's own
          // states, and never both.
          assert.equal(findAll(app.mains()[0], (node) => typeof node.props?.["data-stub-surface"] === "string").length, 1);
          const first = app.focusables()[0];
          assert.equal(first.type, "a");
          assert.equal(first.props.href, `#${CONTENT_REGION_ID}`, "the FIRST focusable element in the document is the skip link, targeting the content region's id");
        },
      );

      // …and NO ROUTED SURFACE CONTRIBUTES A SECOND ONE. This is the regression the absorption
      // of the surfaces' own top bars could produce, and it is invisible to the model: both
      // surfaces are mounted for real, and both used to declare a `<header>` (Fleet.tsx:281,
      // Board.tsx:423) and a `<main>` (Board.tsx:409, and three inside the fleet).
      await withFleetApp({ url: NO_SERVER }, async (app) => {
        assert.equal(findAll(app.tree(), (node) => node.type === "header").length, 0, "<Fleet> contributes no second banner");
        assert.equal(findAll(app.tree(), (node) => node.type === "main").length, 0, "<Fleet> contributes no second <main>");
      });
      await withBoardApp({ url: NO_SERVER }, async (app) => {
        assert.equal(findAll(app.tree(), (node) => node.type === "header").length, 0, "<Board> contributes no second banner");
        assert.equal(findAll(app.tree(), (node) => node.type === "main").length, 0, "<Board> contributes no second <main>");
      });
    },
  },

  // ======================================================================
  // Scenario Outline: everything left of the surface slot is identical on every route, and the
  // slot's contents can never push the nav
  // ======================================================================
  {
    name: "shell-regions/01 everything LEFT of the surface slot is byte-identical on every route, and the slot is yielded after the nav so it can never push it (01 scenario 6, all five rows)",
    async run() {
      // The slot's contents per route are the SURFACE's, in the surface's own order — so they
      // are read off the REAL surfaces rather than asserted from a fixture list.
      const fleetSlot = await withFleetApp({ url: NO_SERVER }, async (app) => slotLabelsOf(app.tree()));
      const boardSlot = await withBoardApp({ url: NO_SERVER }, async (app) => slotLabelsOf(app.tree()));
      assert.deepEqual(fleetSlot, ["Scope", "Legend", "Refresh the fleet view"], "the fleet contributes the scope control, the freshness legend and the refresh button");
      assert.deepEqual(boardSlot, ["Status legend", "Sync work stream"], "the board contributes the status legend and the sync button");

      const rows = [
        { name: "the landing", routeId: "landing", slot: [] },
        { name: "the fleet", routeId: "fleet", slot: fleetSlot },
        { name: "the board", routeId: "board", slot: boardSlot },
        { name: "the config editor", routeId: "config", slot: [] },
        { name: "no route matched", routeId: "not-found", slot: [] },
      ];

      const leftOfSlot = new Set();
      for (const row of rows) {
        const bar = topBarModel({ routeId: row.routeId, slot: row.slot });
        assert.deepEqual(
          [...bar.leftOfSlot],
          ["skip-link", "brand-mark", "wordmark", "identity-chip", "divider", "nav"],
          `${row.name}: the content left of the slot, in that order`,
        );
        leftOfSlot.add(JSON.stringify(bar.leftOfSlot));
        assert.deepEqual([...bar.slot.contents], [...row.slot], `${row.name}: the slot holds what the surface contributed`);
        assert.equal(bar.slot.empty, row.slot.length === 0);
        // Right-anchored: yielded AFTER the nav, so its contents grow leftward and can never
        // displace it.
        assert.equal(bar.slot.anchor, "ml-auto");
        assert.equal(bar.slot.yieldedAfterNav, true);
        assert.equal(bar.leftOfSlot.indexOf("nav"), bar.leftOfSlot.length - 1, "the nav is the LAST thing left of the slot");
        // The identity chip is a LABEL and not a control.
        assert.equal(bar.identityChip.control, false);
        assert.equal(bar.identityChip.focusable, false);
        assert.equal(bar.identityChip.blank, false);
      }
      assert.equal(leftOfSlot.size, 1, "that left-of-slot content is byte-identical on every route, at every load state");
      assert.deepEqual([...TOP_BAR_LEFT_OF_SLOT], ["skip-link", "brand-mark", "wordmark", "identity-chip", "divider", "nav"]);

      // …and the REAL shell renders the chip as a non-interactive, non-blank label.
      await withShellApp({ routeId: "landing", address: { pathname: "/", search: "", hash: "" }, identity: "workspace-a", viewportWidth: 1280 }, async (app) => {
        const chip = findAll(app.tree(), (node) => node.props?.title === "workspace-a")[0];
        assert.ok(chip, "the chip renders its value");
        assert.equal(chip.type, "span", "…as a label, not a button");
        assert.equal(chip.props.onClick, undefined, "…that is not a control");
        // Asserted through the SHARED CONSTANT, never a re-typed literal. These two lanes used
        // to pin `min-w-[7ch]` by hand and so froze the very defect they existed to prevent
        // (designer GAP-4 at the m45 end gate: under `border-box` that reserved ~4.26 characters
        // of text, not 7, so any longer identity moved the nav when it resolved). A lane that
        // names a class can only ever confirm the class; naming the constant makes the chip and
        // its placeholder provably the same thing.
        assert.ok(chip.props.className.includes(IDENTITY_CHIP_WIDTH_CLASS), "the chip takes its width from the one shared reservation");
      });
    },
  },

  // ======================================================================
  // Scenario: the shell paints ONE brand mark and one wordmark, and no surface paints its own
  // ======================================================================
  {
    name: "shell-regions/01 the shell paints ONE brand mark and one wordmark on all five routes, and no routed surface paints its own (01 scenario 7, DG-45-1)",
    async run() {
      const marks = new Set();
      const wordmarks = new Set();
      for (const routeId of ["landing", "fleet", "board", "config", "not-found"]) {
        const bar = topBarModel({ routeId });
        marks.add(JSON.stringify(bar.brandMark));
        wordmarks.add(bar.wordmark);
      }
      assert.equal(marks.size, 1, "exactly one brand mark is yielded, and it is the same mark on all five");
      assert.equal(wordmarks.size, 1);
      assert.deepEqual([...wordmarks], ["aof"], "the wordmark reads `aof` alone — the route words `Mesh` and `Work Board` are retired, because the nav names the route");
      assert.equal(WORDMARK, "aof");

      // The fixed 24px FILLED tile — a mark whose optical size does not move with the bar's
      // type ramp (which is exactly what a bare glyph at `text-lg` does).
      assert.equal(BRAND_MARK.size, 24);
      assert.equal(BRAND_MARK.shape, "filled-tile");
      assert.match(BRAND_MARK.className, /h-6 w-6/);
      assert.match(BRAND_MARK.className, /bg-primary/);
      // Decorative: it carries `aria-hidden` and contributes no accessible name.
      assert.equal(BRAND_MARK.ariaHidden, true);
      assert.equal(BRAND_MARK.accessibleName, "");

      await withShellApp({ routeId: "config", address: { pathname: "/config", search: "", hash: "" }, identity: "aof", viewportWidth: 1280 }, async (app) => {
        const painted = findAll(app.tree(), (node) => node.props?.className === BRAND_MARK.className);
        assert.equal(painted.length, 1, "the rendered shell paints exactly one brand mark");
        assert.equal(painted[0].props["aria-hidden"], "true");
        assert.equal(textOf(painted[0]), BRAND_MARK.glyph);
      });

      // NO ROUTED SURFACE CONTRIBUTES A MARK OR A WORDMARK. Recorded so a reviewer does not log
      // it as a regression: the board's bar GAINS a filled mark it did not have, and both
      // surfaces LOSE their second word.
      await withFleetApp({ url: NO_SERVER }, async (app) => {
        assert.equal(findAll(app.tree(), (node) => node.props?.className === BRAND_MARK.className).length, 0, "<Fleet> paints no brand mark of its own");
        assert.equal(textOf(app.tree()).includes("Mesh"), false, "…and no `Mesh` route word");
      });
      await withBoardApp({ url: NO_SERVER }, async (app) => {
        assert.equal(findAll(app.tree(), (node) => node.props?.className === BRAND_MARK.className).length, 0, "<Board> paints no brand mark of its own");
        assert.equal(textOf(app.tree()).includes("Work Board"), false, "…and no `Work Board` route word");
      });
    },
  },

  // ======================================================================
  // Scenario: the shell owns one named z ladder, fullscreen is alone on its top rung, and a
  // rung that is not on the ladder cannot be asked for
  // ======================================================================
  {
    name: "shell-regions/01 the shell owns ONE named z ladder in ascending order, `content` is its floor, and a rung it does not name is refused (01 scenario 8, DG-45-2)",
    run() {
      // The z-CARRYING rungs, in ascending order.
      assert.deepEqual(Object.keys(Z_LADDER), ["stickyChrome", "popover", "dock", "toast", "fullscreen"]);
      assert.deepEqual(Object.values(Z_LADDER), [10, 20, 30, 40, 50]);
      assert.deepEqual([...Object.values(Z_LADDER)].sort((a, b) => a - b), Object.values(Z_LADDER), "in ascending order");

      // PO ruling 2026-08-07: `content` is the ladder's FLOOR — the absence of a rung (z auto),
      // documented in the module and NEVER a value on the ladder itself (the committed arch
      // test computes the rung set from these values and pins it to exactly {10,20,30,40,50}).
      assert.equal(Z_LADDER_FLOOR.name, "content");
      assert.equal(Z_LADDER_FLOOR.z, "auto");
      assert.equal(Object.values(Z_LADDER).includes("auto"), false);
      assert.equal(Object.hasOwn(Z_LADDER, "content"), false);

      // The fullscreen rung is the highest, and the `shell:fullscreen` occupant is its ONLY
      // occupant.
      assert.equal(Z_LADDER.fullscreen, Math.max(...Object.values(Z_LADDER)));
      assert.equal(Object.values(Z_LADDER).filter((value) => value === Z_LADDER.fullscreen).length, 1);

      // The three things that share ONE rung today resolve to three DIFFERENT rungs.
      const toast = rungFor("toast");
      const popover = rungFor("popover");
      const fullscreen = rungFor("fullscreen");
      assert.equal(new Set([toast, popover, fullscreen]).size, 3, "the dispatch toast, the milestone switcher and the fullscreen terminal are three different rungs now");
      assert.equal(toast, 40);
      assert.equal(popover, 20);
      assert.equal(fullscreen, 50);

      // The notice rail, the top bar, the surface bar and in-surface sticky headers all resolve
      // to the ONE `sticky chrome` rung.
      assert.equal(rungFor("stickyChrome"), 10);

      // Asking for a rung the ladder does not name is REFUSED with the ladder's own names,
      // never answered with an invented number.
      assert.throws(() => rungFor("modal"), (error) => {
        assert.match(error.message, /stickyChrome, popover, dock, toast, fullscreen/, "the refusal names the ladder");
        assert.match(error.message, /GAP/, "…and says what to do: add the rung to the ladder first");
        return true;
      });
      assert.throws(() => rungFor("content"), /FLOOR/, "even the floor is refused as a rung, and the refusal says why");
    },
  },

  // ======================================================================
  // Scenario: the notice rail pushes the chrome down rather than overlaying it
  // ======================================================================
  {
    name: "shell-regions/01 the notice rail PUSHES the chrome down rather than overlaying it, and is never a reserved blank band (01 scenario 9)",
    async run() {
      const standing = shellRows({ notice: { height: 33 } });
      assert.equal(standing[0].row, "notice-rail", "the notice rail is the FIRST region, above the top bar");
      assert.equal(standing[0].fullBleed, true);
      assert.equal(standing[0].inFlow, true, "in flow — it pushes, it does not overlay");

      // The chrome height GROWS by the rail's measured height, so the top bar moves down rather
      // than being covered.
      const without = chromeModel({ viewportHeight: 520 });
      const with33 = chromeModel({ viewportHeight: 520, notice: { height: 33 } });
      assert.equal(with33.height - without.height, 33);
      assert.equal(with33.contentHeight, without.contentHeight - 33, "the content region takes the dip");

      // With no notice standing the rail's height is EXACTLY 0 — no reserved band, no minimum
      // height, no empty border.
      assert.equal(without.noticeHeight, 0);
      assert.equal(shellRows()[0].height, 0);
      assert.equal(shellRows()[0].present, false);

      // The rail carries at most ONE notice at a time — that cap is load-bearing for the 25%
      // bound — and it is contributed BY the surface: the shell provides the region and asserts
      // nothing about what a notice means.
      await withShellApp(
        { routeId: "board", address: { pathname: "/board", search: "", hash: "" }, identity: "aof", surface: "contributing", noticeText: "This board's server is gone.", viewportWidth: 1280 },
        async (app) => {
          const alerts = findAll(app.tree(), (node) => node.props?.role === "alert");
          assert.equal(alerts.length, 1, "exactly one notice stands");
          assert.equal(textOf(alerts[0]).includes("This board's server is gone."), true, "the surface's own sentence, unchanged — the shell says nothing about what it means");
          const rail = app.row("notice-rail");
          assert.ok(rail, "the rail region stands");
          assert.equal(findAll(rail, (node) => node === alerts[0]).length, 1, "the notice is IN the rail, above the top bar");
          assert.equal(app.rows()[0], "notice-rail", "…and the rail is the first row rendered");
        },
      );

      // With nothing contributed the rail is not rendered at all.
      await withShellApp({ routeId: "board", address: { pathname: "/board", search: "", hash: "" }, identity: "aof", surface: "plain", viewportWidth: 1280 }, async (app) => {
        assert.equal(app.row("notice-rail"), null, "no notice, no rail — not even an empty one");
        assert.equal(app.rows()[0], "top-bar");
      });
    },
  },

  // ======================================================================
  // Scenario Outline: the surface bar appears in whole discrete drops
  // ======================================================================
  {
    name: "shell-regions/01 the surface bar appears in WHOLE DISCRETE DROPS, and never as a third bar at a width that already has one (01 scenario 10, all four rows)",
    async run() {
      const rows = [
        { name: "the primary judgement width", width: 1280, declares: false, present: false, home: "top-bar" },
        { name: "the desktop-app proxy", width: 768, declares: false, present: true, home: "surface-bar" },
        { name: "mobile", width: 390, declares: false, present: true, home: "surface-bar" },
        { name: "a surface that declares its own bar", width: 1280, declares: true, present: true, home: "surface-bar" },
      ];

      for (const row of rows) {
        const stands = surfaceBarStands({ viewportWidth: row.width, surfaceDeclaresBar: row.declares });
        assert.equal(stands, row.present, `${row.name}: the surface bar`);
        const yielded = shellRows({ surfaceBar: stands });
        assert.equal(yielded[2].present, row.present);
        assert.equal(yielded[2].height, row.present ? SURFACE_BAR_HEIGHT : 0);
        // There is never more than ONE surface bar.
        assert.equal(yielded.filter((region) => region.row === "surface-bar").length, 1);
        const bar = topBarModel({ routeId: "fleet", slot: ["a", "b"], surfaceBar: stands });
        assert.equal(bar.slot.home, row.home, `${row.name}: the slot is held by the ${row.home}`);
        // The slot MOVES; its CONTENTS are the same components in the same order wherever it
        // lives.
        assert.deepEqual([...bar.slot.contents], ["a", "b"]);
      }

      // …and the REAL shell moves it, with the same contents, at the same two widths.
      for (const [width, home] of [[1280, "top-bar"], [768, "surface-bar"], [390, "surface-bar"]]) {
        await withShellApp(
          { routeId: "fleet", address: { pathname: "/fleet", search: "", hash: "" }, identity: "aof", surface: "contributing", slotLabels: ["Scope", "Refresh"], viewportWidth: width },
          async (app) => {
            assert.equal(app.slotHome(), home, `at ${width} the slot is held by the ${home}`);
            assert.deepEqual(app.slotLabels(), ["Scope", "Refresh"], `at ${width} the slot's contents are unchanged in form and order`);
            assert.equal(findAll(app.tree(), (node) => node.props?.["data-shell-row"] === "surface-bar").length, home === "surface-bar" ? 1 : 0, "never two surface bars");
          },
        );
      }
    },
  },

  // ======================================================================
  // Scenario: each bar's height has ONE home — the model's number and the rendered class are
  // the same number (01 scenario 2, the coupling)
  // ======================================================================
  {
    name: "shell-regions/01 each bar's height has ONE home: the model's number and the class the shell RENDERS are coupled, and neither can move alone (01 scenario 2)",
    async run() {
      // Tailwind's spacing scale is quarter-rem: `h-12` is 3rem is 48px, `h-10` is 40px. The
      // coupling is asserted arithmetically rather than by a literal pair, so a change to
      // either side has to change the other or fail here — which is the whole point. Both
      // constants exist at all because Tailwind scans SOURCE TEXT: a class composed from the
      // number (`h-${TOP_BAR_HEIGHT / 4}`) is a class that never gets generated, which is the
      // same reason `Z_CLASSES` sits beside `Z_LADDER`.
      assert.equal(TOP_BAR_CLASS, `h-${TOP_BAR_HEIGHT / 4}`, "the top bar's class IS its height");
      assert.equal(SURFACE_BAR_CLASS, `h-${SURFACE_BAR_HEIGHT / 4}`, "the surface bar's class IS its height");
      assert.equal(TOP_BAR_CLASS, "h-12");
      assert.equal(SURFACE_BAR_CLASS, "h-10");
      assert.notEqual(TOP_BAR_CLASS, SURFACE_BAR_CLASS, "…and they are genuinely two different numbers");

      // …and the RENDERED bars carry those very classes. A second `h-12` typed into the JSX is
      // exactly the drift this pins: the published chrome height (which m46's dock subtracts)
      // is computed from the NUMBERS, and the operator sees the CLASSES.
      await withShellApp({ routeId: "fleet", address: { pathname: "/fleet", search: "", hash: "" }, identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        assert.match(app.row("top-bar").props.className, new RegExp(`(^|\\s)${TOP_BAR_CLASS}(\\s|$)`), "the rendered top bar is TOP_BAR_CLASS tall");
        assert.equal(app.row("surface-bar"), null, "no surface bar at 1280");
      });
      await withShellApp({ routeId: "fleet", address: { pathname: "/fleet", search: "", hash: "" }, identity: "aof", viewportWidth: 768, surface: "plain" }, async (app) => {
        assert.match(app.row("surface-bar").props.className, new RegExp(`(^|\\s)${SURFACE_BAR_CLASS}(\\s|$)`), "the rendered surface bar is SURFACE_BAR_CLASS tall");
      });
    },
  },

  // ======================================================================
  // Scenario: the rail's measured height reaches the published chrome height (01 scenario 3,
  // through the RENDERED shell rather than the model alone)
  // ======================================================================
  {
    name: "shell-regions/01 a standing notice rail really grows the PUBLISHED chrome height and moves the verdict — measured through the rendered shell, not the model alone (01 scenario 3)",
    async run() {
      const base = { routeId: "board", address: { pathname: "/board", search: "", hash: "" }, identity: "aof", viewportWidth: 1280 };

      // No rail: 48px of chrome, and the content region has room to spare.
      await withShellApp({ ...base, surface: "plain" }, async (app) => {
        assert.equal(app.chromeHeight(), "48px");
        assert.equal(app.budgetVerdict(), "within");
        assert.equal(app.row("notice-rail"), null);
      });

      // A rail STANDING, at a measured 200px: the published number GROWS by exactly that, and
      // the verdict moves to `breach` — the rail is exempt from the bar cap and ADDITIVE to
      // it, so a surface sizing against the published number stays correct straight through.
      // (`noticeHeight` is the seam: a mini-React tree has no layout, so the measurement the
      // production `ResizeObserver` makes has to be supplied. Without it this coupling — the
      // one m46's dock binds to — was assertable on the pure model only.)
      await withShellApp({ ...base, surface: "contributing", noticeText: "This board's server is gone.", noticeHeight: 200 }, async (app) => {
        assert.ok(app.row("notice-rail"), "the rail stands");
        assert.equal(app.chromeHeight(), "248px", "the published height is the two bars PLUS the rail's measured height");
        assert.equal(app.budgetVerdict(), "breach", "…and the verdict says so, rather than the rail being clamped to preserve it");
        const root = findAll(app.tree(), (node) => typeof node.props?.["data-shell-chrome-height"] === "string")[0];
        assert.equal(root.props.style[CHROME_HEIGHT_PROPERTY], "248px", "…published as the ONE custom property, on the shell root");
      });

      // A SMALLER rail moves the same number by exactly its own height and leaves the verdict
      // alone — so the coupling is the height, not the mere presence of a rail.
      await withShellApp({ ...base, surface: "contributing", noticeText: "This board's server is gone.", noticeHeight: 33 }, async (app) => {
        assert.equal(app.chromeHeight(), "81px");
        assert.equal(app.budgetVerdict(), "within");
      });

      // …and a rail with nothing in it publishes nothing: the seam cannot manufacture a height
      // for a rail that is not standing (which would be a reserved blank band by the back door).
      await withShellApp({ ...base, surface: "plain", noticeHeight: 200 }, async (app) => {
        assert.equal(app.row("notice-rail"), null, "no notice, no rail");
        assert.equal(app.chromeHeight(), "48px", "…and no height");
      });
    },
  },

  // ======================================================================
  // Scenario: past its bound the rail scrolls INSIDE ITSELF with its first line pinned
  // (01 scenario 9, DESIGN §The chrome budget clause 4)
  // ======================================================================
  {
    name: "shell-regions/01 past the 25% bound the notice rail scrolls INSIDE ITSELF with its first line PINNED — the sentence an alert exists to speak is never truncated (01 scenario 9)",
    async run() {
      // The bound, as the model states it: one notice, 25% of the viewport height.
      assert.equal(NOTICE_RAIL_MAX_VIEWPORT_FRACTION, 0.25);
      const under = chromeModel({ viewportHeight: 520, notice: { height: 33 } });
      const over = chromeModel({ viewportHeight: 520, notice: { height: 200 } });
      assert.equal(under.noticeRailCap, 130, "25% of a 520-tall viewport");
      assert.equal(under.noticeRailScrollsInsideItself, false);
      assert.equal(over.noticeRailScrollsInsideItself, true, "past the bound, the rail scrolls inside itself");
      // The pin is UNCONDITIONAL rather than a property of the height — an alert clipped at
      // any height is an accessibility defect, and a rule that only applies past a threshold
      // is a rule with a state nobody tests.
      assert.equal(under.noticeRailFirstLinePinned, true);
      assert.equal(over.noticeRailFirstLinePinned, true);
      // The rail stays EXEMPT and ADDITIVE through the bound: the published height still grows
      // by the full measured height, so nothing sizing against it is wrong while it scrolls.
      assert.equal(over.height, TOP_BAR_HEIGHT + 200);
      assert.equal(over.noticeRailExempt, true);

      // The rule is spelled ONCE, in the class the rail renders with — the cap AND the pin.
      assert.match(NOTICE_RAIL_CLASS, /max-h-\[25dvh\]/, "the cap is the 25% bound, in `dvh`");
      assert.match(NOTICE_RAIL_CLASS, /overflow-y-auto/, "…past which the rail scrolls INSIDE ITSELF");
      assert.equal(/overflow-hidden|truncate|line-clamp/.test(NOTICE_RAIL_CLASS), false, "…and never clips, truncates or clamps the sentence");
      assert.match(NOTICE_RAIL_CLASS, /first-child\]:sticky/, "the strip's first line is STICKY inside the scrolling rail…");
      assert.match(NOTICE_RAIL_CLASS, /first-child\]:top-0/, "…pinned at its top");

      // …and the RENDERED rail carries it, whatever the rail's height happens to be: the shell
      // does not decide per-notice whether the rule applies.
      for (const noticeHeight of [33, 200]) {
        await withShellApp(
          { routeId: "board", address: { pathname: "/board", search: "", hash: "" }, identity: "aof", viewportWidth: 1280, surface: "contributing", noticeText: "This board's server is gone.", noticeHeight },
          async (app) => {
            const rail = app.row("notice-rail");
            assert.equal(rail.props.className, NOTICE_RAIL_CLASS, `at ${noticeHeight}px the rail renders the ONE rule, unconditionally`);
            // The notice itself is untouched — the shell caps and scrolls the RAIL, and says
            // nothing about the strip inside it.
            const alert = findAll(rail, (node) => node.props?.role === "alert")[0];
            assert.ok(alert, "the surface's own strip is inside it");
            assert.equal(/max-h|overflow|truncate/.test(alert.props.className ?? ""), false, "…unmodified: the shell does not reach into the notice");
          },
        );
      }
    },
  },

  // ======================================================================
  // Scenario: the identity chip while the name is unknown (01 scenario 6, the pulse state)
  // ======================================================================
  {
    name: "shell-regions/01 while the origin's identity is unknown the chip PULSES at its final size — never blank, never a control, and the bar's child order is unchanged (01 scenario 6)",
    async run() {
      const address = { pathname: "/", search: "", hash: "" };
      // The bar's own signature: what it renders, in order, with the chip reduced to the facts
      // that must not change with its state. If the unknown chip collapsed, became a button,
      // or moved, this signature would differ — which is the regression the pulse exists to
      // prevent (a collapsed chip pushes the nav sideways when the name lands).
      const signatureOf = (app) => {
        const bar = app.row("top-bar");
        return (bar.children ?? []).map((child) => ({
          type: child.type,
          mono: typeof child.props?.className === "string" && child.props.className.includes("mono"),
          minCh: typeof child.props?.className === "string" && child.props.className.includes("min-w-[7ch]"),
          maxCh: typeof child.props?.className === "string" && child.props.className.includes("max-w-[18ch]"),
          interactive: typeof child.props?.onClick === "function" || child.props?.tabIndex !== undefined,
        }));
      };

      const known = await withShellApp({ routeId: "landing", address, identity: "workspace-a", viewportWidth: 1280 }, async (app) => signatureOf(app));

      await withShellApp({ routeId: "landing", address, identity: null, viewportWidth: 1280 }, async (app) => {
        const bar = app.row("top-bar");
        const chip = (bar.children ?? []).find((child) => typeof child.props?.className === "string" && child.props.className.includes(IDENTITY_CHIP_WIDTH_CLASS));
        assert.ok(chip, "a chip renders even with no name — an ABSENT chip is what pushes the nav sideways when the name lands");
        // NEVER BLANK: it is a sized block, not an empty string in a shrink-wrapped span.
        assert.match(chip.props.className, /animate-pulse/, "…as a pulse block");
        // AT ITS FINAL WIDTH — the same shared reservation the resolved chip uses, so "same-sized"
        // is true by construction rather than by two literals happening to agree (GAP-4).
        assert.ok(chip.props.className.includes(IDENTITY_CHIP_WIDTH_CLASS), "…at its FINAL minimum width, from the one reservation");
        assert.match(chip.props.className, /h-5/, "…and its final height, so the bar's own height never moves");
        assert.equal(textOf(chip), "", "it carries no text — an empty chip with a border reads as a loading state, which is exactly what it is");
        // Announced as decoration, not as an empty label: a screen reader must not read a
        // nameless chip out as a blank.
        assert.equal(chip.props["aria-hidden"], "true");
        // NOT a control, in any state.
        assert.equal(chip.props.onClick, undefined);
        assert.equal(chip.props.tabIndex, undefined);
        assert.notEqual(chip.type, "button");
        // The probe is never run when the seam supplies the answer, so this lane makes no
        // request at all — the unknown state is a state, not a pending fetch.
        assert.deepEqual(app.requests(), []);

        // …and the BAR is byte-identical in shape either way: same children, same order, same
        // chip geometry, differing only in whether the chip has a name in it.
        assert.deepEqual(signatureOf(app), known, "the bar's child order and the chip's geometry are unchanged by not knowing the name");
      });
    },
  },

  // ======================================================================
  // Scenario: the shell's own two card states share ONE wrapper (01 scenario 5)
  // ======================================================================
  {
    name: "shell-regions/01 the shell's own card states (the landing and not-found) share ONE centred wrapper with a real height — never `min-h-full` against a parent that has none (01 scenario 5)",
    async run() {
      // The height is spelled from the PUBLISHED primitive, with the `0px` fallback so the
      // card is still right mounted outside a shell. `min-h-full` is what centred neither: R4
      // is a flex child, so a percentage min-height resolves against a parent with no definite
      // height in `content:page` and the wrapper collapses to its own card.
      assert.match(SHELL_CARD_WRAPPER_CLASS, /min-h-\[calc\(100dvh_-_var\(--aof-shell-chrome-height,0px\)\)\]/, "a real height, from the ONE published name");
      assert.equal(SHELL_CARD_WRAPPER_CLASS.includes("min-h-full"), false);
      assert.match(SHELL_CARD_WRAPPER_CLASS, /place-items-center/, "centred on BOTH axes");
      assert.match(SHELL_CARD_CLASS, /w-full/, "the card takes its bound…");
      assert.match(SHELL_CARD_CLASS, /max-w-md/, "…and stops there");
      assert.equal(SHELL_CARD_WRAPPER_CLASS.includes(String(TOP_BAR_HEIGHT)), false, "never the literal 48 — the chrome height is a variable");

      // Both states render the SAME wrapper and the SAME card, because they are the same
      // object: one bounded card, centred in a region that has a height.
      const wrapperOf = async (props) =>
        withShellApp({ identity: "aof", viewportWidth: 1280, ...props }, async (app) => {
          const main = app.mains()[0];
          const wrapper = (main.children ?? [])[0];
          return { wrapper: wrapper.props.className, card: (wrapper.children ?? [])[0].props.className };
        });

      const landing = await wrapperOf({ routeId: "landing", address: { pathname: "/", search: "", hash: "" } });
      const notFound = await wrapperOf({ routeId: "not-found", address: { pathname: "/nope", search: "", hash: "" } });

      assert.equal(landing.wrapper, SHELL_CARD_WRAPPER_CLASS, "the landing's wrapper is the shared one");
      assert.equal(notFound.wrapper, SHELL_CARD_WRAPPER_CLASS, "…and so is not-found's");
      assert.equal(landing.wrapper, notFound.wrapper, "one rule, both places");
      assert.equal(landing.card.startsWith(SHELL_CARD_CLASS), true, "the landing's card is the shared card…");
      assert.equal(notFound.card.startsWith(SHELL_CARD_CLASS), true, "…and so is not-found's, plus its own muted type");
    },
  },

  // ======================================================================
  // Scenario: the REAL fleet inside the REAL shell — one bundle, one bus (01 scenario 6)
  // ======================================================================
  {
    name: "shell-regions/01 the REAL <Fleet/> inside the REAL <Shell/>, in ONE bundle: the scope control leaves the fleet's body and arrives in the shell's slot, in the loading state AND the populated one (01 scenario 6)",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        // THE LOADING STATE FIRST, because it is the one where the control would be missing.
        // The fleet contributes its slot OUTSIDE its loading/error/empty/populated ternary
        // precisely so the scope control is present in all four — a contribution published
        // only once data lands would leave the bar empty for the whole first round trip, and
        // neither existing harness can see it (the fleet's has no shell, the shell's has no
        // fleet, and the bus is MODULE state so each bundle has its own copy).
        await withShellComposedFleet(
          {
            url,
            routeId: "fleet",
            address: { pathname: "/fleet", search: "", hash: "" },
            identity: "aof",
            viewportWidth: 1280,
            settle: "render",
            // The fleet's FIRST status request is held before the mount. `settle: "render"`
            // alone loses the race on a loopback fixture — the response lands inside the
            // render loop's own yield — and a loading state that is merely raced for is a
            // loading state a lane silently stops reading.
            holdFromStart: "/api/mesh/status",
          },
          async (app) => {
            // It really IS the loading state: the fleet's own `<LoadingState/>` owns the
            // content region (its four `aria-busy` region placeholders, which carry their
            // label in `aria-label` because their blocks are decorative), and its data is
            // still in flight.
            const busy = findAll(app.mains()[0], (node) => node.props?.["aria-busy"] === "true");
            assert.deepEqual(
              busy.map((node) => node.props["aria-label"]),
              ["Loading Workspaces", "Loading Milestones", "Loading Nodes", "Loading Diagnostics"],
              "the fleet's own loading state is what is on screen",
            );

            assert.equal(app.slotHome(), "top-bar", "the slot is in the shell's top bar at 1280");
            assert.deepEqual(
              app.slotControls(),
              ["Scope", "Legend", "Refresh the fleet view"],
              "…and the fleet's contributions are IN it before the first request has landed — the bar is above the loading/error/empty/populated ternary, which is the invariant `acd-mesh-ui-scope-visible` has pinned since m34/ADR-006",
            );
            const scope = app.byLabel("Scope");
            assert.ok(scope, "the REAL scope control is rendered");
            assert.equal(scope.props.role, "group", "…the real one: a role=group of two buttons, not a stand-in");
            // It is in the shell's slot and NOWHERE ELSE — the contribution MOVED, it was not
            // copied. (`hasShellHost()` is what makes the surface render nothing in place, and
            // it is true here only because this is one bundle with one bus.)
            assert.equal(findAll(app.tree(), (node) => node.props?.["aria-label"] === "Scope").length, 1, "exactly one scope control in the document");
            assert.equal(findAll(app.slot(), (node) => node.props?.["aria-label"] === "Scope").length, 1, "…and it is inside the shell's slot");
            assert.equal(findAll(app.mains()[0], (node) => node.props?.["aria-label"] === "Scope").length, 0, "…and NOT in the fleet's own body");
            // The shell's own landmarks survive the composition: one banner, one <main>.
            assert.equal(app.banners().length, 1);
            assert.equal(app.mains().length, 1);

            // …and now the SAME mount's populated state: release the held response and let the
            // fleet settle. One mount across both states is the stronger claim — it rules out a
            // contribution that appears only once data lands (and one that vanishes when it does).
            //
            // SETTLED BY RENDER PASSES RATHER THAN `flush()`, and the reason is a property of
            // the INSTRUMENT, recorded here because it looks like a workaround otherwise.
            // `flush()` waits for the render to go STABLE, and this composition never does
            // under `test/support/mini-react.mjs`: that renderer re-invokes every function
            // component on every pass (it has no equivalent of React's bail-out when a child
            // ELEMENT is referentially identical), so `<Fleet>` is re-invoked whenever the
            // shell re-renders, its `onRefresh` (Fleet.tsx:222, an inline arrow at the call
            // site) is a new function each time, its `SurfaceSlot` deps therefore differ, the
            // contribution re-publishes, the shell re-renders — forever. Production does NOT
            // spin, because `main.tsx` builds the surface element ONCE and React skips a
            // subtree whose element reference has not changed. What the loop does show is that
            // the fleet's slot deps are one refactor away from a genuine "Maximum update
            // depth" in the browser; that is reported as a finding against Fleet.tsx rather
            // than papered over here, since a stable `onRefresh` (`useCallback`) removes it.
            const [held] = app.startHolds();
            await held.answered();
            held.release();
            const stillLoading = () => findAll(app.mains()[0], (node) => node.props?.["aria-busy"] === "true").length > 0;
            for (let attempt = 0; attempt < 60 && stillLoading(); attempt += 1) {
              await new Promise((resolve) => setImmediate(resolve));
              await app.renderOnly();
            }

            assert.equal(findAll(app.mains()[0], (node) => node.props?.["aria-busy"] === "true").length, 0, "the fleet's loading state has yielded");
            assert.match(textOf(app.mains()[0]), /Workspaces/, "…to its populated body");
            assert.deepEqual(
              app.slotControls(),
              ["Scope", "Legend", "Refresh the fleet view"],
              "the fleet's three contributions are STILL in the shell's slot, in the surface's own order",
            );
            assert.equal(app.slotHome(), "top-bar");
            assert.equal(app.banners().length, 1, "still exactly one banner — the fleet's own header is absorbed, not added");
            assert.equal(app.mains().length, 1);
            assert.equal(findAll(app.tree(), (node) => node.type === "header" && node.props?.["data-shell-row"] !== "top-bar").length, 0, "<Fleet> contributes no second banner inside the shell either");
            assert.equal(app.requests().some((request) => request.url.includes("/api/mesh/status")), true, "the REAL fleet really fetched its own data");
          },
        );

        // At 768 the SAME contributions move with the slot into the surface bar — the slot
        // moves, its contents never change form. (Held from the start for the reason above:
        // this composition is settled by render passes, not by `flush()`.)
        await withShellComposedFleet(
          {
            url,
            routeId: "fleet",
            address: { pathname: "/fleet", search: "", hash: "" },
            identity: "aof",
            viewportWidth: 768,
            settle: "render",
            holdFromStart: "/api/mesh/status",
          },
          async (app) => {
            assert.equal(app.slotHome(), "surface-bar", "the slot has dropped into R3");
            assert.deepEqual(app.slotControls(), ["Scope", "Legend", "Refresh the fleet view"], "…carrying the same contributions, in the same order, unchanged in form");
            assert.equal(findAll(app.tree(), (node) => node.props?.["data-shell-row"] === "surface-bar").length, 1, "never two surface bars");
            const [held] = app.startHolds();
            await held.answered();
            held.release();
          },
        );
      });
    },
  },
];

// The labels of the controls a surface contributes, read off the REAL rendered tree by
// accessible name — the way an operator addresses them, and the way DESIGN names them.
function slotLabelsOf(tree) {
  const slot = findAll(tree, (node) => typeof node.props?.className === "string" && node.props.className.includes("text-muted-foreground") && findAll(node, (inner) => typeof inner.props?.["aria-label"] === "string").length > 0)[0];
  if (!slot) return [];
  const labelled = findAll(slot, (node) => typeof node.props?.["aria-label"] === "string");
  const seen = [];
  for (const node of labelled) {
    const label = node.props["aria-label"];
    // The scope control is a `role="group"` wrapper around its two buttons; the group is the
    // control, so its children are not separate slot contributions.
    if (seen.includes(label)) continue;
    if (labelled.some((other) => other !== node && findAll(other, (inner) => inner === node).length > 0)) continue;
    seen.push(label);
  }
  return seen;
}

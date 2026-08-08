// The SHELL'S LAYOUT MODEL (milestone 45 / story 03; ARCHITECTURE ADR-005 with its five
// [Build-N] amendments, DESIGN §"The shell's layout primitives", §Surface 1's binding
// checklist, §The chrome budget, DG-45-1 and DG-45-2).
//
// Framework-free by contract, exactly as ui/src/app/routes.mjs is: no React, no DOM, no
// `window`, no clock. This repo has NO React test harness for layout decisions, so a shell
// that kept its regions, its stacking rungs and its fullscreen transitions inside JSX would
// keep the one set of decisions milestones 46 and 49 bind to in the one place nothing can
// check. `test/arch/acd-shell-z-ladder-single-home.test.mjs` imports this module under plain
// `node` — that import IS the first assertion, and it is why every DOM-shaped concern
// (adopting a live node into the overlay, moving focus, measuring a rail) lives in
// ui/src/app/Shell.tsx and never here.
//
// WHAT THIS MODULE IS FOR, stated once. Three downstream milestones consume it:
//   - m46 unifies the terminal control and needs a BOX whose height is knowable without
//     measuring the document, a rung for its dock, and one fullscreen door;
//   - m47 adds a repo filter beside the scope control and needs the surface SLOT;
//   - m49 puts a grid of live terminals at "/" and needs all of the above at once.
// So every export below is a name one of them binds to, and nothing here is decoration.
//
// Driven headlessly by test/shell-regions.test.mjs and
// test/shell-not-found-and-fullscreen.test.mjs.

// ─────────────────────────────────────────────────────── the three regions ────
//
// [Build-4] — THREE exported region constants, FIVE visual rows. DESIGN draws five rows
// (notice rail, top bar, surface bar, content, overlay) and ADR-005 names three regions:
// R1–R3 are INTERIOR STRUCTURE of `chrome` (all three sit above the content region, all
// three are summed into the published chrome height, two of the three are conditional),
// R4 is `content` and R5 is `overlay`. A module exporting five would put `noticeRail` and
// `surfaceBar` into the vocabulary of every downstream milestone, and 46, 47 and 49 would
// each have to know which of the five exist in a given viewport state. Three names are true
// in every state.

export const REGION_CHROME = "chrome";
export const REGION_CONTENT = "content";
export const REGION_OVERLAY = "overlay";

// The same three names as a frozen list, for iteration and for a consumer that wants to
// assert the set. It is NOT a fourth region.
export const REGIONS = Object.freeze([REGION_CHROME, REGION_CONTENT, REGION_OVERLAY]);

// The five visual ROWS, in the one declared order. R1 and R3 are conditional; the content
// region is the FOURTH row in every combination, so its position never depends on what is
// present above it. The overlay is out of flow and contributes zero to the height of
// anything — which is what lets a fullscreen occupant cover the chrome without a stacking
// fight, and (from m46, [Build-3]) lets the dock survive a route change.
export const ROW_NOTICE_RAIL = "notice-rail";
export const ROW_TOP_BAR = "top-bar";
export const ROW_SURFACE_BAR = "surface-bar";
export const ROW_CONTENT = "content";
export const ROW_OVERLAY = "overlay";

export const ROW_ORDER = Object.freeze([ROW_NOTICE_RAIL, ROW_TOP_BAR, ROW_SURFACE_BAR, ROW_CONTENT, ROW_OVERLAY]);

// The two bars are fixed; the rail is MEASURED. DESIGN: "a variable, not the constant 48"
// — the notice rail and the surface bar are both conditional, so 48px is wrong in most
// combinations, and wrong by exactly the amount that makes a fitted terminal overflow.
export const TOP_BAR_HEIGHT = 48;
export const SURFACE_BAR_HEIGHT = 40;

// The SAME two numbers as the Tailwind utilities that produce them, and they live here for
// exactly the reason `Z_CLASSES` does: Tailwind scans SOURCE TEXT for class strings, so a
// height composed at the call site (`h-${TOP_BAR_HEIGHT / 4}`) would name a utility that is
// never generated. Spelling the literal at the call site instead is what let the number have
// two homes — one in this module (which the budget, the published chrome height and every
// downstream milestone read) and one in Shell.tsx's JSX (which is what the operator actually
// sees) — free to disagree with nobody noticing. `test/shell-regions.test.mjs` asserts the
// COUPLING (`TOP_BAR_CLASS === \`h-${TOP_BAR_HEIGHT / 4}\``), so changing one without the
// other fails at the door rather than in a screenshot review.
export const TOP_BAR_CLASS = "h-12";
export const SURFACE_BAR_CLASS = "h-10";

// DESIGN §Responsive form — WHOLE DISCRETE DROPS, keyed to the viewport because the bar's
// width IS the viewport width. The slot rides in the top bar at 1280 and drops into its own
// 40px surface bar at 768 and below. The threshold sits below Tailwind's `lg` (1024) rather
// than at 769: DESIGN pins the three judged widths (1280 absent, 768 present, 390 present) and
// leaves the boundary between them to the build, and an existing token is a better place to
// put it than a number invented here.
export const SURFACE_BAR_MAX_WIDTH = 1023;

// surfaceBarStands({ viewportWidth, surfaceDeclaresBar }) — R3's presence, as one decision
// with one home. A surface may also declare its own bar at any width; there is never more
// than one surface bar either way.
export function surfaceBarStands({ viewportWidth = 1280, surfaceDeclaresBar = false } = {}) {
  return surfaceDeclaresBar === true || viewportWidth <= SURFACE_BAR_MAX_WIDTH;
}

// DESIGN §Render breakpoints: the Rust app's own window is 760×520
// (app/desktop/ui/styles.css:50), so at 520 tall the shell's STEADY-STATE chrome must never
// exceed 88px (48 + 40), leaving at least 432px for content. A third BAR is a GAP, not a
// variant. The notice rail is not a bar — see chromeModel below.
export const CHROME_BUDGET = TOP_BAR_HEIGHT + SURFACE_BAR_HEIGHT;
export const DESKTOP_WINDOW_HEIGHT = 520;
export const CONTENT_FLOOR = DESKTOP_WINDOW_HEIGHT - CHROME_BUDGET;

// The rail's own bound ([DESIGN §The chrome budget clause 4]): at most ONE notice, and never
// more than 25% of the viewport height. Past that it scrolls INSIDE ITSELF with its first
// line pinned — truncating the sentence an alert exists to speak is forbidden, and clipped
// `role="alert"` content is an accessibility defect besides.
export const NOTICE_RAIL_MAX_VIEWPORT_FRACTION = 0.25;

// …and the rule as the RAIL'S OWN CLASS, spelled once, here, beside the fraction it
// implements (the `Z_CLASSES` reason again: Tailwind scans source text, and a class composed
// from the constant would never be emitted).
//
// THE PIN IS THE PART A REVIEWER SHOULD MEET RATHER THAN DISCOVER. The rail is the scroll
// container, so the obvious build — `sticky top-0` on the strip itself — pins NOTHING: a
// sticky element whose box fills its containing block has a sticky range of exactly zero, so
// the strip would scroll away with its own content and the clause would be decoration. The
// element that CAN pin is one level in: the strip's own first line — its leading element
// child — whose containing block is the strip (taller than the scrollport) and whose nearest
// scrolling ancestor is the rail. Hence the descendant variant rather than a class on the
// rail itself. `bg-inherit` comes with it because a pinned line with no background of its own
// would have the rest of the sentence scrolling visibly through it.
//
// What this means for a CONTRIBUTOR, stated because it is now part of the notice contract:
// the strip's first element child is its opening line, and that is what stays on screen. The
// one notice that exists today (the board's `serverGone` strip) is nowhere near the bound at
// any documented width, so the pin is a guarantee for the notices m46/m49 add rather than a
// behaviour visible now — and whether it READS right at the bound is task 04's render verdict.
export const NOTICE_RAIL_CLASS =
  "max-h-[25dvh] shrink-0 overflow-y-auto [&>*>*:first-child]:sticky [&>*>*:first-child]:top-0 [&>*>*:first-child]:bg-inherit";

// The one id the skip link targets and the one element that carries `main`.
export const CONTENT_REGION_ID = "aof-shell-content";

// ─────────────────────────────────── the identity chip's width reservation ──
//
// ONE home for the chip's width, shared by the resolved chip AND its loading placeholder,
// because the whole rule is that those two measure the SAME (DESIGN §R2: "a same-sized pulse
// block, never a collapsed chip that then pushes the nav sideways"; m43 documented-default-3:
// "the chip keeps its right-edge anchor so nothing moves at the threshold").
//
// WHY THIS IS A CONSTANT AND NOT TWO COPIES OF A CLASS STRING (designer GAP-4, measured at the
// `aof:verify 45` end gate). The chip shipped as `min-w-[7ch]` on both elements — which LOOKS
// like it reserves seven characters and does not. Tailwind sets `box-sizing: border-box`, so a
// `min-width` is a BORDER-box minimum: subtract `px-2` (16px) and the border (2px) and
// `min-w-[7ch]` reserves 7ch − 18px of TEXT room. Measured in the shipped bundle: 1ch = 6.609px,
// so the reservation was 46.184px total = 28.18px of text ≈ **4.26 characters**. An identity of
// five or more grew the box and took the nav with it — `fleet` measured 51px against the
// placeholder's 46.184px, a 4.8px jump at the moment the identity resolved. The prose and the
// class disagreed, and the class is what shipped.
//
// `calc(7ch + 1.125rem)` adds back the 16px of padding and the 2px of border, so the
// reservation is what it says: seven characters of TEXT. `max-w-[18ch]` is left as-is — it is a
// truncation ceiling, not an anchor, and `truncate` handles the overflow.
//
// The class is a LITERAL, never composed from the numbers below. Tailwind generates utilities by
// scanning source text for class strings, so a template-interpolated `min-w-[calc(...)]` would
// name a rule Tailwind never emits — the reservation would silently vanish and the chip would
// fall back to its content width, which is a worse version of the bug being fixed here.
export const IDENTITY_CHIP_WIDTH_CLASS = "min-w-[calc(7ch+1.125rem)] max-w-[18ch]";
// …and the same numbers as values, so the arithmetic above is checkable rather than a claim in
// a comment. `IDENTITY_CHIP_CHROME_REM` is px-2 (8+8) + border (1+1) = 18px = 1.125rem.
export const IDENTITY_CHIP_MIN_CH = 7;
export const IDENTITY_CHIP_MAX_CH = 18;
export const IDENTITY_CHIP_CHROME_REM = 1.125;

// ───────────────────────────────────── the shell's own card states, as classes ──
//
// The landing and the not-found state are the two things the SHELL renders in the content
// region itself, and they are the same object: one bounded card, centred on both axes in a
// region that has a real height. They share one rule because the designer's conformance
// review (2026-08-07) found them failing it in two different ways — the landing card
// top-anchored and shrink-wrapped to ~250px, the not-found card the same defect at ~306px —
// which is exactly what two hand-typed wrappers produce.
//
// `min-h-full` was the defect's cause and is why the height is spelled from the PUBLISHED
// primitive instead: R4 is a flex child with `flex-1`, so `min-h-full` resolves against a
// parent that has no definite height in `content:page`, and the wrapper collapses to its
// content. `calc(100dvh - var(--aof-shell-chrome-height, 0px))` is a definite height in every
// mode, tracks the rail and the surface bar as they come and go, and carries the `0px`
// fallback so the card is still correct mounted outside a shell. NEVER the literal 48.
export const SHELL_CARD_WRAPPER_CLASS = "grid min-h-[calc(100dvh_-_var(--aof-shell-chrome-height,0px))] place-items-center p-6";

// The card itself: `w-full` so it really takes the bound (a shrink-wrapped card is the
// designer's finding), `max-w-md` so it stops there.
export const SHELL_CARD_CLASS = "w-full max-w-md rounded-md border border-dashed border-border p-6 text-center";

// shellRows({ notice, surfaceBar, fullscreen }) — the five rows, in order, always all five.
// A conditional row that is absent is yielded with `present: false` and height 0: it never
// disappears from the model, because "the content region is the fourth region in EVERY
// combination" is only checkable if the rows above it are always countable.
//
//   notice     — null when nothing is standing, else `{ height }`. The height is an INPUT:
//                the board's serverGone strip is `px-4 py-2 text-xs` plus a ~145-character
//                sentence, so it wraps differently at 1280, 768 and 390. A rail height the
//                model INVENTED would be wrong by exactly the amount that makes a fitted
//                terminal overflow.
//   surfaceBar — whether R3 stands (the viewport has dropped the slot out of R2, or the
//                surface declares its own bar).
//   fullscreen — while an occupant is presented the chrome is HIDDEN, not overlaid: a
//                translucent bar behind a dark terminal is the thing DESIGN forbids.
export function shellRows({ notice = null, surfaceBar = false, fullscreen = false } = {}) {
  const noticeHeight = fullscreen ? 0 : noticeHeightOf(notice);
  const rows = [
    {
      row: ROW_NOTICE_RAIL,
      region: REGION_CHROME,
      present: !fullscreen && noticeHeight > 0,
      height: noticeHeight,
      // The rail's height is content-driven and measured; the bars' are fixed.
      measured: true,
      inFlow: true,
      fullBleed: true,
      landmark: null,
      scrollOwner: noticeHeight > 0 ? "self-when-capped" : "none",
    },
    {
      row: ROW_TOP_BAR,
      region: REGION_CHROME,
      present: !fullscreen,
      height: fullscreen ? 0 : TOP_BAR_HEIGHT,
      measured: false,
      inFlow: true,
      fullBleed: true,
      landmark: "banner",
      scrollOwner: "none",
    },
    {
      row: ROW_SURFACE_BAR,
      region: REGION_CHROME,
      present: !fullscreen && surfaceBar === true,
      height: !fullscreen && surfaceBar === true ? SURFACE_BAR_HEIGHT : 0,
      measured: false,
      inFlow: true,
      fullBleed: true,
      landmark: null,
      scrollOwner: "none",
    },
    {
      row: ROW_CONTENT,
      region: REGION_CONTENT,
      present: true,
      height: null, // it takes what is left — see chromeModel for the number.
      measured: false,
      inFlow: true,
      fullBleed: true,
      landmark: "main",
      scrollOwner: "declared-by-content-mode",
    },
    {
      row: ROW_OVERLAY,
      region: REGION_OVERLAY,
      present: true,
      // Out of flow: it contributes ZERO to the height of anything, in every state.
      height: 0,
      measured: false,
      inFlow: false,
      fullBleed: true,
      landmark: null,
      scrollOwner: "occupant",
    },
  ];
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function noticeHeightOf(notice) {
  if (notice == null || notice === false) return 0;
  if (notice === true) return 0;
  const height = Number(notice.height);
  return Number.isFinite(height) && height > 0 ? height : 0;
}

// ────────────────────────────────────────────── the published chrome height ───
//
// ADR-005 contract point 7 ([Build-5], promoted OUT of the story-default paragraph because
// m46 binds to the NAME): the shell publishes the measured height of everything above the
// content region as ONE CSS custom property, and a height-constrained surface sizes itself
// against it. m46's dock clamps its drag-resize to `window.innerHeight / 2` today
// (TerminalDock.tsx:120) — a clamp against the VIEWPORT, which under a shell is wrong by
// exactly the chrome height. It needs a named number it can subtract.
export const CHROME_HEIGHT_PROPERTY = "--aof-shell-chrome-height";

// `dvh`, never `vh`: a mobile browser's collapsing URL bar changes the viewport, and a
// terminal sized to `vh` overflows the moment it does.
export const CONTENT_HEIGHT_EXPRESSION = `calc(100dvh - var(${CHROME_HEIGHT_PROPERTY}))`;

// The budget VERDICT, as a value an outsider can read (DESIGN §The chrome budget clause 2:
// "the breach is REPORTED, never absorbed"). Forbidden alternatives, named so a later
// author meets the decision: reserving a blank band against the rail, clamping the content
// region to preserve 432, letting a bar scroll away to make room.
export const BUDGET_WITHIN = "within";
export const BUDGET_AT_FLOOR = "at-budget";
export const BUDGET_BREACH = "breach";
export const BUDGET_CHROME_HIDDEN = "hidden";

// chromeModel({ viewportHeight, viewportWidth, notice, surfaceBar, fullscreen }) — the one
// number the shell publishes, the content height that follows from it, and the verdict.
//
// THE RULE, and it is DESIGN's four clauses read together:
//   1. the 88px cap counts the two BARS only; the rail is EXEMPT from it and ADDITIVE to it,
//      so `--aof-shell-chrome-height` grows by the rail's measured height and every surface
//      sizing against it stays correct straight through the breach;
//   2. the VERDICT is judged on the content floor (>= 432px at the desktop window's height),
//      which is the number the budget exists to protect — a rail that pushes content below
//      it is a breach even though the bars are within their cap;
//   3. nothing yields to the rail (m38's DG-20 lesson: an element that disappears only when
//      a condition happens to be true makes its own absence a second, accidental signal for
//      that condition);
//   4. the rail is bounded — one notice, 25% of the viewport height — which is what stops
//      the exemption running away.
export function chromeModel({
  viewportHeight = DESKTOP_WINDOW_HEIGHT,
  viewportWidth = null,
  notice = null,
  surfaceBar = false,
  fullscreen = false,
} = {}) {
  const rows = shellRows({ notice, surfaceBar, fullscreen });
  const noticeHeight = rows[0].height;
  const barsHeight = rows[1].height + rows[2].height;
  const height = noticeHeight + barsHeight;
  const contentHeight = Math.max(0, viewportHeight - height);

  const railCap = Math.round(viewportHeight * NOTICE_RAIL_MAX_VIEWPORT_FRACTION);
  const verdict = fullscreen
    ? BUDGET_CHROME_HIDDEN
    : contentHeight > CONTENT_FLOOR
      ? BUDGET_WITHIN
      : contentHeight === CONTENT_FLOOR
        ? BUDGET_AT_FLOOR
        : BUDGET_BREACH;

  return Object.freeze({
    // The property and its value — published ONCE, under one name.
    property: CHROME_HEIGHT_PROPERTY,
    height,
    value: `${height}px`,
    // The expression a height-constrained surface is given. It subtracts the ONE name from
    // 100dvh and is never the literal 48.
    sizingExpression: CONTENT_HEIGHT_EXPRESSION,
    unit: "dvh",
    viewportHeight,
    viewportWidth,
    contentHeight,
    barsHeight,
    noticeHeight,
    // The bar cap, and whether a THIRD bar has appeared (a GAP, not a variant).
    budget: CHROME_BUDGET,
    barsWithinBudget: barsHeight <= CHROME_BUDGET,
    contentFloor: CONTENT_FLOOR,
    verdict,
    withinBudget: verdict === BUDGET_WITHIN || verdict === BUDGET_AT_FLOOR || verdict === BUDGET_CHROME_HIDDEN,
    // The rail's exemption, stated in the model rather than left in prose.
    noticeRailExempt: true,
    noticeRailCap: railCap,
    noticeRailScrollsInsideItself: noticeHeight > railCap,
    // …and when it does scroll, it scrolls with its FIRST LINE PINNED (DESIGN §The chrome
    // budget clause 4). Truncating the sentence an alert exists to speak is forbidden, and
    // clipped `role="alert"` content is an accessibility defect besides — so the rule is
    // unconditional rather than a property of the height, and NOTICE_RAIL_CLASS carries it.
    noticeRailFirstLinePinned: true,
    reason:
      verdict === BUDGET_BREACH
        ? `the notice rail adds ${noticeHeight}px above the ${barsHeight}px of bars, so content is ${contentHeight}px — ${CONTENT_FLOOR - contentHeight}px under the ${CONTENT_FLOOR}px floor. The rail is exempt and additive: the dip is reported, never absorbed.`
        : verdict === BUDGET_CHROME_HIDDEN
          ? "a fullscreen occupant is presented: the chrome is HIDDEN, not overlaid, so the occupant gets the whole viewport."
          : null,
  });
}

// ─────────────────────────────────────────────────────── the content modes ────
//
// DESIGN §"The shell's layout primitives" 2. Neither mode is redesigned — `content:page` is
// what Fleet.tsx does today and `content:fixed` is what Board.tsx does today. They are NAMED
// so the shell can host both without either surface changing.
export const CONTENT_MODE_PAGE = "content:page";
export const CONTENT_MODE_FIXED = "content:fixed";

// Keyed by the ROUTE ID (ui/src/app/routes.mjs's `id` column, which ADR-002 makes binding),
// never by pathname — the mode is a property of the surface, and the route table already
// owns the path→surface mapping. A route this table does not know is `content:page`, which
// is also the not-found state's mode.
const CONTENT_MODES = new Map([
  ["landing", CONTENT_MODE_PAGE],
  ["fleet", CONTENT_MODE_PAGE],
  ["config", CONTENT_MODE_PAGE],
  ["board", CONTENT_MODE_FIXED],
  ["not-found", CONTENT_MODE_PAGE],
]);

// contentModeFor(routeId) — the mode, its ONE declared scroll owner, and the two facts a
// consumer must not re-derive.
//
// `min-height: 0` is load-bearing and non-obvious, which is most of the point of stating it
// here: a flex child defaults to `min-height: auto`, so an overflowing child silently grows
// the parent and every "size to the box" calculation is wrong in a way that only shows up
// with real content. BINDING for m46: a surface that hosts a terminal is always
// `content:fixed`, because a fitted xterm inside a page-scrolling column has no stable
// height to fit to.
export function contentModeFor(routeId) {
  const mode = CONTENT_MODES.get(routeId) ?? CONTENT_MODE_PAGE;
  return Object.freeze({
    mode,
    // Exactly one owner per axis per region, declared and never emergent.
    scrollOwner: mode === CONTENT_MODE_FIXED ? "descendants" : "page",
    // The content region is NEVER itself the scroll owner in `content:fixed`.
    regionOwnsScroll: false,
    minHeight: 0,
    // DESIGN GAP D1's backstop (index.css:27-36) survives in BOTH modes — the shell must
    // not remove it. Scoped regions still scroll internally.
    pageRootOverflowX: "hidden",
    // THE ROOT MUST NOT ESTABLISH A SCROLLPORT IN `content:page` (measured at the m45 `@uat`
    // gate, 2026-08-08). The shell root carried its own `overflow-x-hidden` — a THIRD copy of
    // the D1 backstop, on top of `html` and `body`, which already have it. Under CSS, an
    // element with `overflow-x: hidden` computes `overflow-y` to `auto` and therefore
    // establishes a scrollport; `position: sticky` resolves against the nearest such ancestor.
    // The root is `min-h-dvh` and grows to its content (measured 18,470px on `/fleet`), so it
    // never scrolls — the `html` element does. The chrome's `sticky top-0` was therefore
    // sticking to a box that does not move, and the top bar scrolled clean out of view:
    // measured at y = −1200 after a 1200px wheel on `/fleet`, against DESIGN's R2 row which
    // says in terms "none — it never scrolls out of view (`sticky top-0` in `content:page`)".
    //
    // So `content:page`'s root carries NO overflow of its own. `content:fixed` keeps
    // `overflow-hidden` because there the root IS the viewport by design, the document never
    // scrolls, and the bar is a fixed flex child rather than a sticky one — the two modes want
    // genuinely different answers, which is why this belongs here and not in a class on the
    // component.
    rootEstablishesScrollport: mode === CONTENT_MODE_FIXED,
    rootClass: mode === CONTENT_MODE_FIXED ? "h-dvh overflow-hidden flex flex-col" : "min-h-dvh flex flex-col",
    contentClass: mode === CONTENT_MODE_FIXED ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1",
  });
}

// ───────────────────────────────────────────────────────── the top bar model ──
//
// DESIGN §Surface 1's R2, and binding rail 2: "nothing in the shell moves as you navigate".
// Everything LEFT of the surface slot is byte-identical on every route at every load state;
// the slot is right-anchored, so it is yielded AFTER the nav, its contents grow leftward,
// and they can never displace the navigation.

// R2, left → right, in this exact order. A list, so "byte-identical to every other route's"
// is one comparison rather than six.
export const TOP_BAR_LEFT_OF_SLOT = Object.freeze(["skip-link", "brand-mark", "wordmark", "identity-chip", "divider", "nav"]);

// DG-45-1 — one product, one mark. The fleet's FILLED 24px tile wins over the board's bare
// glyph: it is a fixed 24px box, so it survives the 390 squeeze without a type-size
// decision, and a bare glyph at `text-lg` changes optical size with the bar's type ramp,
// which a mark must not. Recorded so a reviewer does not log it as a regression: the board's
// bar GAINS a filled mark it did not have.
export const BRAND_MARK = Object.freeze({
  glyph: "✦",
  shape: "filled-tile",
  size: 24,
  ariaHidden: true,
  accessibleName: "",
  className: "grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground",
});

// The bar renders `aof` ALONE. The fleet appends `Mesh` today and the board appends
// `Work Board` — a route-varying second word. Under the shell the NAV names the route, so a
// second word would say it twice and would violate binding rail 2 by changing as you move.
export const WORDMARK = "aof";

// topBarModel({ routeId, slot }) — `slot` is what the SURFACE contributed, in the surface's
// own order. The shell provides the region and asserts nothing about what a control means:
// on `/fleet` it holds the scope control, the freshness legend and the refresh button; on
// `/board` the status legend and sync; on `/` and `/config` it is empty. That ruling
// (DESIGN §The scope-control ruling) is why `?scope=` stays a fleet contract end to end.
export function topBarModel({ routeId = "landing", slot = [], surfaceBar = false } = {}) {
  const contents = Object.freeze([...slot]);
  return Object.freeze({
    routeId,
    landmark: "banner",
    height: TOP_BAR_HEIGHT,
    // Byte-identical on every route, at every load state.
    leftOfSlot: TOP_BAR_LEFT_OF_SLOT,
    brandMark: BRAND_MARK,
    wordmark: WORDMARK,
    identityChip: Object.freeze({
      // A LABEL, not a control: non-interactive, never focusable, never a switcher in this
      // milestone, and never blank — an empty chip reads as a loading state, so while the
      // name is unknown it renders a SAME-SIZED pulse block rather than a collapsed chip
      // that would then push the nav sideways.
      control: false,
      focusable: false,
      blank: false,
      mono: true,
      minCh: 7,
      maxCh: 18,
      titleCarriesFullValue: true,
    }),
    slot: Object.freeze({
      // Right-anchored: yielded AFTER the nav, grows leftward, can never displace it.
      anchor: "ml-auto",
      yieldedAfterNav: true,
      // Where the slot LIVES at this width. The slot moves; its contents never change form.
      home: surfaceBar ? ROW_SURFACE_BAR : ROW_TOP_BAR,
      contents,
      empty: contents.length === 0,
    }),
  });
}

// landmarksModel() — DESIGN §Accessibility 6, and it is a NEW obligation: persistent chrome
// above every surface has never existed here, so "two banners" is a regression the
// absorption of the surfaces' own headers could produce. The shell owns the single
// `<header>` banner and the single `<main>`; Fleet.tsx's and Board.tsx's top bars are
// absorbed into the shell's bar and their contents become surface-slot contributions.
export function landmarksModel() {
  return Object.freeze({
    banner: Object.freeze([ROW_TOP_BAR]),
    main: Object.freeze([ROW_CONTENT]),
    contentRegionId: CONTENT_REGION_ID,
    // WCAG 2.1 AA 2.4.1, and the direct cost of the chrome this milestone introduces.
    skipLinkIsFirstFocusable: true,
    skipLinkTarget: `#${CONTENT_REGION_ID}`,
    // Focus order follows visual order.
    focusOrder: Object.freeze(["skip-link", "nav", "surface-slot", "content"]),
  });
}

// ─────────────────────────────────────────────── the shell's content states ───
//
// DESIGN §Surface 1's four states. Exactly ONE is on screen at a time — "the shell's is the
// outer one and yields the instant the surface mounts", which is what stops a skeleton
// rendering inside a skeleton.
export const STATE_NOT_FOUND = "not-found";
export const STATE_MOUNTING = "mounting";
export const STATE_POPULATED = "populated";
export const STATE_FAILED = "failed";

// contentStateFor({ routeId, surfaceLoaded, surfaceFailed }) — the situation → the state.
//   the address names no surface           → not-found
//   the surface's module has not loaded yet → mounting
//   the surface's module could not be loaded → failed
//   the surface is mounted (fetching its own data, or rendering) → populated
export function contentStateFor({ routeId = "landing", surfaceLoaded = true, surfaceFailed = false } = {}) {
  const state = routeId === "not-found"
    ? STATE_NOT_FOUND
    : surfaceFailed
      ? STATE_FAILED
      : surfaceLoaded
        ? STATE_POPULATED
        : STATE_MOUNTING;

  const marks = {
    // The established dashed empty language. NOT `accent` and NOT `destructive`: nothing
    // failed — the path simply is not a surface — and dressing it as an error teaches an
    // operator to distrust their own address bar.
    [STATE_NOT_FOUND]: {
      treatment: "dashed-empty",
      tone: "muted",
      accent: false,
      destructive: false,
      navItemActive: false,
      retry: false,
      namesThePath: true,
      pointsAtNav: true,
    },
    // ONE neutral pulse placeholder, in the RegionPlaceholder shape.
    [STATE_MOUNTING]: {
      treatment: "pulse-placeholder",
      tone: "muted",
      accent: false,
      destructive: false,
      ariaBusy: true,
      labelNamesTheSurface: true,
      retry: false,
    },
    // The shell shows NOTHING: the surface's own loading state (or its content) owns the
    // region, and the shell adds no wrapper padding, no max-width and no background.
    [STATE_POPULATED]: {
      treatment: "none",
      tone: null,
      accent: false,
      destructive: false,
      shellChrome: "intact",
      wrapperPadding: false,
      wrapperMaxWidth: false,
      wrapperBackground: false,
      retry: false,
    },
    // The `accent` pill with its `!` mark plus a `⟳ Retry` that re-attempts the MOUNT, not a
    // fetch. NEVER `destructive`: a chunk that did not arrive is a retryable transport
    // condition, not data loss.
    [STATE_FAILED]: {
      treatment: "accent-pill",
      tone: "accent",
      accent: true,
      destructive: false,
      retry: true,
      retryReattempts: "mount",
      copyNamesTheSurface: true,
    },
  };

  return Object.freeze({
    state,
    // Exactly one, always: the content region holds this state and no other.
    exclusive: true,
    // In every state the chrome is intact and usable — a failed surface must never trap the
    // operator on it.
    chrome: "intact",
    ...marks[state],
  });
}

// ─────────────────────────────────────────────────────────── the z ladder ─────
//
// DESIGN DG-45-2, and ADR-005 [Amigos-5]: the shell owns the ladder, it is declared HERE
// beside the region names, and `test/arch/acd-shell-z-ladder-single-home.test.mjs` fails CI
// if a `z-50` literal or an undeclared rung appears anywhere else in ui/src.
//
// FIVE z-CARRYING RUNGS, in ascending order. `content` is the ladder's FLOOR — the ABSENCE
// of a rung (z auto), never a value on the ladder itself (PO ruling, 2026-08-07: the
// committed arch test computes the rung set from these values and pins it to exactly
// {10,20,30,40,50}; DESIGN's own table gives its `content` row z `auto`, i.e. no number).
export const Z_LADDER = Object.freeze({
  // notice rail, top bar, surface bar, and in-surface sticky headers (BoardLanes.tsx:181)
  stickyChrome: 10,
  // legends (Fleet.tsx:360), the nav disclosure, the milestone switcher and its listbox
  popover: 20,
  // reserved for m46's unified terminal control ([Build-3]: its region home is `overlay`)
  dock: 30,
  // dispatch notices (Board.tsx), the config editor's message (config/App.tsx)
  toast: 40,
  // the `shell:fullscreen` occupant — the top rung, ALONE
  fullscreen: 50,
});

// The floor, documented and named — deliberately NOT a member of the ladder above.
export const Z_LADDER_FLOOR = Object.freeze({ name: "content", z: "auto", description: "the mounted surface: the absence of a rung" });

// The Tailwind utility for each rung. These literals also exist so the utilities are
// EMITTED: Tailwind scans source for class strings, so a rung composed at a call site
// (`z-${Z_LADDER.toast}`) would produce a class that never gets generated. A surface
// therefore still writes the literal — and this ladder plus the fitness function are what
// keep the number findable and closed.
export const Z_CLASSES = Object.freeze({
  stickyChrome: "z-10",
  popover: "z-20",
  dock: "z-30",
  toast: "z-40",
  fullscreen: "z-50",
});

// rungFor(name) — the closure rule, enforced. "An element that needs a rung not on this list
// is a GAP whose fix is to add the rung HERE first", so an unknown name is REFUSED with the
// ladder's own names rather than answered with an invented number.
export function rungFor(name) {
  if (Object.hasOwn(Z_LADDER, name)) return Z_LADDER[name];
  const floor = name === Z_LADDER_FLOOR.name
    ? ` \`content\` is the ladder's FLOOR — it carries no rung (z auto) and is never asked for.`
    : "";
  throw new Error(
    `unknown stacking rung ${JSON.stringify(name)}. The ladder is CLOSED (DESIGN DG-45-2) and names exactly: ${Object.keys(Z_LADDER).join(", ")}.${floor} An element that needs a rung this list does not name is a GAP whose fix is to add the rung to ui/src/app/shell-layout.mjs first, with a stated meaning.`,
  );
}

// ────────────────────────────────────────── the fullscreen state machine ──────
//
// ADR-005's third contract point. ONE mechanism, owned by the shell — not the browser
// Fullscreen API (it takes the whole browser chrome, is gesture-gated, and in the desktop
// webview changes what the operator's WINDOW is), and not a `position: fixed` portal per
// surface (which is how two z vocabularies and two `Escape` handlers appear — the
// duplication m46 exists to delete, reintroduced one layer up).
//
// THIS IS THE PURE HALF. [Build-1] is emphatic that "present a node" GUARANTEES the
// occupant's INSTANCE AND DOM IDENTITY across present AND dismiss — one xterm, one socket,
// one PTY — and that the identity-preserving DOM work (adopting a live node into the
// overlay, and returning the SAME node to its host on dismiss) belongs to Shell.tsx. What
// lives here is the state, the closed set of transitions, and the two facts the DOM half
// reads back: the layout TICK it must emit after each transition, and where focus returns.
export const FULLSCREEN_EMPTY = "empty";
export const FULLSCREEN_PRESENTING = "presenting";

// The initial state. Frozen, and re-derivable — `fullscreenState()` yields a fresh one so a
// caller can never mutate the shared value out from under the next test or the next mount.
export function fullscreenState() {
  return Object.freeze({
    status: FULLSCREEN_EMPTY,
    occupant: null,
    occupants: 0,
    chrome: "visible",
    // [Build-1] The shell emits a layout tick after present AND after dismiss: an occupant
    // is not laid out on the tick it is presented, so a surface that sizes itself to its box
    // must be told to re-measure one frame later — and again on dismiss, when the box
    // changes back. Both existing implementations discovered this independently
    // (FleetTerminalView.tsx:265-268 runs fit() then requestAnimationFrame(fit)). Putting
    // the tick in the contract is what stops 46 and 49 each re-deriving a one-frame defer
    // against a shell they do not own and getting it subtly different.
    layoutTick: 0,
    // Where focus returns on dismissal — the control that opened it, never the document body.
    restoreFocusTo: null,
    changed: false,
  });
}

// fullscreenReducer(state, action) — the CLOSED set of transitions. There is no transition a
// history entry could drive, and no action carries a path, a query parameter or a fragment:
// fullscreen is a property of one control INSTANCE, not of an address, so Back is never the
// way out of it.
//
//   { type: "present", occupant: { id, label, opener, claimsEscape } }
//   { type: "dismiss", id, via: "control" | "escape" | <anything else> }
//   { type: "escape" }   — the key, which the OCCUPANT may have claimed ([Build-2])
//
// THE DISMISS CARRIES THE ID IT AIMS AT, and a dismiss that names a DIFFERENT occupant than
// the one presented is a no-op — the same answer as dismissing an empty slot. This is the
// STALE DISMISSER, and it is m46's shape rather than a hypothetical: `requestFullscreen`
// hands every caller a dismiss function closed over its own id, so a terminal that was
// replaced by a second one (occupants never stack — the second request REPLACES the first)
// still holds a live dismiss for a session that is no longer on screen. Firing it — on
// unmount, on a socket close, on a stray click — would tear down SOMEONE ELSE'S fullscreen.
// An id-less dismiss (the `Escape` key, the shell's own exit control) targets whatever is
// presented, which is correct by construction: both are properties of the presented state.
export function fullscreenReducer(state, action) {
  const current = state ?? fullscreenState();
  const type = action?.type;

  if (type === "present") {
    const occupant = normaliseOccupant(action.occupant);
    if (occupant === null) return unchanged(current);
    // The SAME occupant asking again is not a re-present: nothing is torn down, nothing is
    // re-adopted, and the tick does not fire. This is the pure shadow of [Build-1]'s
    // identity guarantee — a second request for the occupant already presented must not
    // become a remount.
    if (current.status === FULLSCREEN_PRESENTING && current.occupant.id === occupant.id) {
      return Object.freeze({ ...current, occupant: current.occupant, changed: false });
    }
    // A SECOND, different request REPLACES the first. Occupants never stack.
    return Object.freeze({
      status: FULLSCREEN_PRESENTING,
      occupant,
      occupants: 1,
      // Chrome HIDDEN, not overlaid: a translucent overlay would put a light-theme bar
      // behind a dark terminal. The measurable consequence is chromeModel's — the published
      // chrome height is 0, so the occupant gets the whole viewport.
      chrome: "hidden",
      layoutTick: current.layoutTick + 1,
      restoreFocusTo: occupant.opener,
      changed: true,
    });
  }

  if (type === "escape") {
    // [Build-2] The occupant MAY CLAIM `Escape`, and the shell must honour that: m46's
    // terminal forwards stdin (TerminalDock.tsx:155 `disableStdin: false`, :261-263 sends
    // every keystroke down the socket), so `Esc` is a live keystroke for the `claude` TUI on
    // the far end. A shell that swallowed it would make the one key a TUI needs most mean
    // "leave". The VISIBLE exit control is what makes the claim safe, and it is mandatory in
    // BOTH cases — for a claiming occupant it is the only remaining exit.
    if (current.status === FULLSCREEN_PRESENTING && current.occupant.claimsEscape) {
      // Identity-stable in the steady state, for the same reason `unchanged` is: a claiming
      // occupant sees this branch on EVERY keystroke, and a fresh object each time is a React
      // re-render per keystroke of a state that did not change.
      return current.changed === false && current.escapeClaimedByOccupant === true
        ? current
        : Object.freeze({ ...current, changed: false, escapeClaimedByOccupant: true });
    }
    return dismiss(current, "escape");
  }

  if (type === "dismiss") return dismiss(current, action?.via ?? "control", action?.id);

  return unchanged(current);
}

// dismiss(current, via, id) — `id` is the occupant the caller AIMS AT, or null/undefined for
// "whatever is presented" (the key and the shell's own exit control, both properties of the
// presented state rather than of a caller).
function dismiss(current, via, id) {
  // Dismissing an empty slot is a no-op — pressing `Esc` with nothing presented, or hitting
  // the control twice, changes nothing and emits no tick.
  if (current.status !== FULLSCREEN_PRESENTING) return unchanged(current);
  // …and so is a dismiss aimed at an occupant that is not the one presented. A stale
  // dismisser must be exactly as harmless as an empty slot: no tick, no focus move, no
  // teardown of the occupant that IS on screen.
  if (id != null && id !== current.occupant.id) return unchanged(current);
  return Object.freeze({
    ...fullscreenState(),
    // The tick fires on dismiss too: the box changes back, so a fitted surface must
    // re-measure.
    layoutTick: current.layoutTick + 1,
    // Focus returns to the control that opened it — carried out of the transition so the DOM
    // half has one place to read it from.
    restoreFocusTo: current.occupant.opener,
    dismissedVia: via,
    changed: true,
  });
}

// The no-change path yields the CURRENT state OBJECT, not a fresh frozen copy of it. Object
// identity is the signal every React store uses to decide whether to re-render, so allocating
// here would make a state that did not change look like one that did — and the paths that
// land here are the high-frequency ones: an action the machine does not name, a dismiss aimed
// at an occupant that is gone, and (from m46) a claimed `Escape` arriving per keystroke.
// A copy is made ONLY when `changed` itself has to be cleared, which happens at most once
// after each real transition.
function unchanged(current) {
  return current.changed === false ? current : Object.freeze({ ...current, changed: false });
}

function normaliseOccupant(occupant) {
  if (occupant == null || typeof occupant !== "object") return null;
  const id = typeof occupant.id === "string" && occupant.id.length > 0 ? occupant.id : null;
  if (id === null) return null;
  return Object.freeze({
    id,
    // The `aria-label` naming the session — DESIGN §Accessibility 10.
    label: typeof occupant.label === "string" ? occupant.label : id,
    // The control that opened it, so focus can go back exactly there.
    opener: occupant.opener ?? null,
    // [Build-2].
    claimsEscape: occupant.claimsEscape === true,
  });
}

// presentedStateModel(state) — what a PRESENTED occupant declares, and the two exits it must
// carry. DESIGN §`shell:fullscreen` + §Accessibility 10: the occupant is the existing idiom
// verbatim (`fixed inset-0 flex flex-col`, `role="dialog"`, `aria-modal="true"`, an
// `aria-label` naming the session, and an exit control at `ml-auto` in its own header —
// FleetTerminalView.tsx:409-424). m46 inherits it; it does not invent one.
//
// "Exit is `Esc` AND a visible control", both, always: a state that can only be left by a
// key the operator has to know about is a trap for anyone who does not, and REMOVING EITHER
// would leave the other as a single point of escape.
export function presentedStateModel(state) {
  if (state?.status !== FULLSCREEN_PRESENTING) return null;
  return Object.freeze({
    role: "dialog",
    ariaModal: true,
    ariaLabel: state.occupant.label,
    focusTrapped: true,
    restoreFocusTo: state.occupant.opener,
    rung: "fullscreen",
    z: Z_LADDER.fullscreen,
    // Mandatory in BOTH cases — and non-negotiable when the occupant claims `Escape`,
    // because then it is the only remaining exit.
    exitControl: Object.freeze({
      visible: true,
      // The same anchor position as the control that entered fullscreen, so the eye does not
      // have to search for the way out.
      anchor: "ml-auto",
      dismissesVia: "control",
    }),
    escapeDismisses: state.occupant.claimsEscape !== true,
    escapeClaimedByOccupant: state.occupant.claimsEscape === true,
    chrome: "hidden",
  });
}

// The SHELL'S NAVIGATION MODEL (milestone 45 / story 03, task 02; DESIGN §The navigation
// model, §Cross-origin honesty, §Responsive form, §Accessibility 1-4 and 9).
//
// Framework-free, beside the route table and for the same reason (ADR-001): this repo has no
// React test harness, so the nav's decisions — which items, in what order, which one is
// current, what each `href` carries, which destinations are not reachable from here, and what
// form the row takes at a width — live in a pure module `node:test` drives with no bundler
// and no DOM. Shell.tsx renders what this returns and adds nothing of its own.
//
// THE ITEMS COME FROM THE ROUTE TABLE, never from a hand-typed list. Milestones 47 and 49 add
// a surface by adding a table row; the nav must pick it up without an edit here, and must
// REPORT rather than absorb it when the row breaks DESIGN's bar budget (four items, ten
// characters).
//
// WHY RESOLVABILITY IS AN INPUT AND NOT SOMETHING THIS MODULE DISCOVERS. The four surfaces do
// not share one origin: `/` and `/fleet` are the fixed :4181 fleet server, the board is a
// per-workspace server on an EPHEMERAL port that changes on every daemon restart
// (Board.tsx:47-51), and the config editor is the setup-ui origin. Whether a board exists
// right now is a live probe the fleet already makes (GET /api/mesh/board-url); the SHELL does
// the asking, and this model is pure over the answer. That is what keeps the whole task
// headless.
//
// Driven headlessly by test/shell-navigation.test.mjs.
import { ROUTES } from "./routes.mjs";

// DESIGN §Which items: "provisional labels, to be replaced by the table's own names". The
// table's `id` column is the binding name (ADR-002 [Amigos-6]); these are its LABELS, and
// they live here rather than in routes.mjs because a label is chrome vocabulary and the route
// table is deliberately origin-blind and render-blind. A table row with no label here still
// renders — under its id — and is REPORTED by the budget below rather than silently dropped.
const LABELS = new Map([
  ["landing", "Terminals"],
  ["fleet", "Fleet"],
  ["board", "Board"],
  ["config", "Config"],
]);

// What an operator would RUN to make an unreachable destination reachable. DESIGN §Cross-
// origin honesty: an item whose destination cannot be resolved from this origin is "visibly
// present, marked unavailable, carrying in `title` what to run to get it — never a dead
// `href` that dead-ends here". The reason it carries is a COMMAND, not an apology.
const COMMANDS = new Map([
  ["landing", "aof mesh ui"],
  ["fleet", "aof mesh ui"],
  ["board", "aof work ui"],
  ["config", "aof assets ui"],
]);

// What an item says while the probe has not answered. It is a SEPARATE sentence from the
// unavailable one, and that is the whole point (PO ruling, 2026-08-07, on QA F-45-03-C):
// "not yet known" must not be told to an assistive technology as "disabled". `aria-disabled`
// is reserved for UNAVAILABLE, where it is TRUE — the item really does not navigate anywhere.
// An UNKNOWN item is one whose answer is still in flight; announcing it disabled would tell a
// screen-reader user a destination is closed at the exact moment it is most likely to open,
// and it would then have to be un-announced. So UNKNOWN carries no `aria-disabled` at all and
// says what is actually happening instead. The SIGHTED treatment is unchanged either way: the
// slot is still held at its final width without a live `href`, so nothing moves when the
// answer lands.
const UNKNOWN_TITLE = "Checking whether this surface is reachable from here";

// DESIGN §Responsive form — whole discrete drops, keyed to the viewport because the bar's
// width IS the viewport width. (This is the case m43's "the form is chosen by the SURFACE,
// not the viewport" rule explicitly is not: that rule applies to a card in an `auto-fill`
// grid, whose width is viewport-invariant. A full-width bar is the opposite case.)
export const NAV_FORM_TABS = "tabs";
export const NAV_FORM_DISCLOSURE = "disclosure";
export const NAV_DISCLOSURE_BREAKPOINT = 390;

// The bar is designed for FOUR items and labels of at most TEN characters. Five or more, or a
// longer label, is a GAP whose fix is a shorter label or a table change — never a truncated
// nav label. Reported, so 47 and 49 meet the limit at the door instead of discovering it in a
// screenshot review three milestones later.
export const NAV_ITEM_BUDGET = 4;
export const NAV_LABEL_BUDGET = 10;

// Availability, as three values rather than a boolean — because "not yet known" is a real
// third state (the board probe has not answered) and DESIGN forbids answering it with either
// of the other two: a live link that may dead-end, or an item that pops into existence when
// the answer lands.
export const AVAILABLE = "available";
export const UNAVAILABLE = "unavailable";
export const UNKNOWN = "unknown";

// The active marking, and DESIGN binding rail 4: "colour is never the only signal". Three
// non-colour signals travel with the active item — a 2px bottom RULE (shape), the heavier of
// the two type WEIGHTS, and `aria-current` (programmatic) — and colour is emphasis on top.
// An inactive-but-available item carries a TRANSPARENT rule of the SAME thickness, so the
// active mark is a change of appearance and never a change of size.
const MARKINGS = {
  [`${AVAILABLE}:current`]: Object.freeze({
    rule: Object.freeze({ width: 2, style: "solid", colourToken: "border-primary" }),
    weight: "font-semibold",
    colourToken: "text-primary",
    className: "border-b-2 border-primary text-primary font-semibold",
  }),
  [`${AVAILABLE}:rest`]: Object.freeze({
    rule: Object.freeze({ width: 2, style: "solid", colourToken: "border-transparent" }),
    weight: "font-medium",
    colourToken: "text-muted-foreground",
    className: "border-b-2 border-transparent text-muted-foreground font-medium hover:text-foreground",
  }),
  // The unavailable signal is the DASHED bottom rule — this product's existing
  // "not-yet / absent / degraded" primitive (the `not-started` ring at status.tsx:121, the
  // no-presence dot at Fleet.tsx:1096, every dashed placeholder) — plus `aria-disabled` plus
  // the `title`. Never colour alone.
  [`${UNAVAILABLE}:rest`]: Object.freeze({
    rule: Object.freeze({ width: 2, style: "dashed", colourToken: "border-muted-foreground/40" }),
    weight: "font-medium",
    colourToken: "text-muted-foreground/60",
    className: "border-b-2 border-dashed border-muted-foreground/40 text-muted-foreground/60",
  }),
  // The probe has not answered yet. The slot is held at its FINAL width without a live
  // `href`, so the nav cannot move under the operator's cursor when the answer lands, and no
  // click can dead-end. (The rejected alternatives are named in DESIGN: a spinner in the bar,
  // a collapsed slot, or an item that pops into existence.)
  [`${UNKNOWN}:rest`]: Object.freeze({
    rule: Object.freeze({ width: 2, style: "solid", colourToken: "border-transparent" }),
    weight: "font-medium",
    colourToken: "text-muted-foreground",
    className: "border-b-2 border-transparent text-muted-foreground font-medium",
  }),
};

function markingFor(availability, current) {
  return MARKINGS[`${availability}:${current ? "current" : "rest"}`] ?? MARKINGS[`${availability}:rest`];
}

// The addressable rows of the table, in the table's declared order. `not-found` is excluded
// because it has no path: it is what every address the table does not know resolves to, not a
// place you can navigate to.
function addressableRoutes() {
  return ROUTES.filter((route) => typeof route.path === "string");
}

// navModel({ address, viewportWidth, resolvable }) — the whole nav, as values.
//
//   address     — `{ pathname, search, hash }`, location-shaped (never a composed string:
//                 the parts are what the caller already has, and composing one is how a
//                 missing "#" corrupts a fragment).
//   viewportWidth — the drop is keyed to it; 390 and below is the disclosure.
//   resolvable  — per route id: `true` (in-origin), `{ origin }` (a live link to another
//                 origin), `false` (not resolvable from here), `null` (the probe has not
//                 answered). A route id ABSENT from this object is resolvable — the shell's
//                 own origin serves the address it is already serving, and the nav's default
//                 must not be "unavailable" or every page would open with four dead items.
export function navModel({ address = {}, viewportWidth = 1280, resolvable = {} } = {}) {
  const pathname = typeof address.pathname === "string" ? address.pathname : "/";
  const search = typeof address.search === "string" ? address.search : "";
  const hash = typeof address.hash === "string" ? address.hash : "";

  const routes = addressableRoutes();
  const currentId = currentRouteId(pathname, routes);

  const items = routes.map((route) => {
    const id = route.id;
    const label = LABELS.get(id) ?? id;
    const current = id === currentId;
    const availability = availabilityOf(resolvable, id);
    const origin = originOf(resolvable, id);

    // THE HREF RULE, and it is POSITIONAL rather than per-parameter — it has to be, because
    // ADR-006 forbids the shell from knowing that `scope` exists. The item for the CURRENT
    // route carries the current search and fragment byte-identically (clicking "you are here"
    // is a no-op, and copying its address yields the address you are on); EVERY OTHER item is
    // its bare path. A rule that forwarded fleet parameters onto the board would require the
    // shell to know which parameters belong to which surface — which is exactly what keeps
    // milestone 47's repo filter local to the fleet.
    const carried = current ? `${search}${hash}` : "";
    const href = availability === AVAILABLE ? `${origin ?? ""}${route.path}${carried}` : null;

    return Object.freeze({
      id,
      label,
      path: route.path,
      href,
      // A real link, never a `<button>` that pushes state: middle-click, Ctrl-click and
      // "copy link address" must all work, and the whole milestone exists so the address is
      // worth copying.
      element: "a",
      current,
      ariaCurrent: current ? "page" : null,
      availability,
      // `aria-disabled="true"` is reserved for UNAVAILABLE — see UNKNOWN_TITLE above. UNKNOWN
      // gets null, and the difference is programmatic: an item whose availability is still
      // being determined is not a disabled item.
      ariaDisabled: availability === UNAVAILABLE ? "true" : null,
      // An item skipped by the keyboard hides its explanation from exactly the users who need
      // it (DESIGN §Accessibility 4), so an unavailable item stays FOCUSABLE and simply does
      // not navigate.
      focusable: true,
      navigates: availability === AVAILABLE,
      title:
        availability === UNAVAILABLE
          ? `Run \`${COMMANDS.get(id) ?? "aof"}\` to open this surface`
          : availability === UNKNOWN
            ? UNKNOWN_TITLE
            : null,
      command: availability === UNAVAILABLE ? COMMANDS.get(id) ?? null : null,
      marking: markingFor(availability, current),
      // Target size (WCAG 2.2 SC 2.5.8): every item fills the bar's full height — a hit
      // target rather than a padded text run, and NOT achieved by padding the text and
      // growing the bar. No item's height changes with its state.
      height: 48,
      fillsBarHeight: true,
      // The slot an item occupies never changes width with its availability, so the nav does
      // not reflow when a board appears or disappears.
      holdsItsSlot: true,
    });
  });

  const form = viewportWidth <= NAV_DISCLOSURE_BREAKPOINT ? NAV_FORM_DISCLOSURE : NAV_FORM_TABS;
  const currentItem = items.find((item) => item.current) ?? null;

  return Object.freeze({
    landmark: Object.freeze({ element: "nav", ariaLabel: "Surfaces" }),
    form,
    items: Object.freeze(items),
    currentId,
    ariaCurrentCount: items.filter((item) => item.ariaCurrent === "page").length,
    // Whole discrete drops: no label is truncated, abbreviated or shrunk by a scale factor;
    // no item is dropped; the nav never yields two rows or a horizontally-scrolling row (an
    // operator cannot see that there is more).
    labelsTruncated: false,
    rows: 1,
    horizontallyScrolls: false,
    disclosure: form === NAV_FORM_DISCLOSURE ? disclosureModel(currentItem, items) : null,
    budget: navBudgetFor(items),
  });
}

// The disclosure at 390 takes the existing milestone-switcher trigger shape
// (BoardLanes.tsx:361-367) and declares `aria-haspopup="menu"` + `aria-expanded`; `Esc`
// closes it and returns focus to the trigger, and arrow keys move within it.
//
// ITS LABEL IS THE ACTIVE SURFACE'S NAME, so "you are here" survives the collapse — and on an
// unmatched path it names NO surface. The fallback this forbids is the tempting one: labelling
// the trigger `Terminals` because it is first would tell an operator who typed a bad URL that
// they are on the terminals home.
function disclosureModel(currentItem, items) {
  return Object.freeze({
    label: currentItem ? currentItem.label : "Surfaces",
    namesASurface: currentItem !== null,
    ariaHasPopup: "menu",
    ariaExpanded: false,
    escapeCloses: true,
    escapeReturnsFocusToTrigger: true,
    arrowKeysMoveWithin: true,
    className: "flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium",
    caret: "▾",
    // Opening it still offers ALL FOUR surfaces, in the table's order.
    items: Object.freeze(items),
  });
}

// navBudgetFor(items) — the budget, REPORTED rather than absorbed. It is never answered by
// truncating a label, ellipsising one, shrinking the type, wrapping to a second row, or
// dropping an item.
//
// EXPORTED, and that is a test-seam decision worth stating (QA F-45-03-D). The budget's whole
// job is to fail when milestone 47 or 49 adds a fifth surface or a long label — a condition
// that by definition does not exist in the route table today. A suite that reimplemented the
// arithmetic over a hypothetical fifth row would have been asserting against its own copy:
// green forever, including on the day this function stopped counting. Taking `items` rather
// than reading ROUTES itself is what lets the tripwire be driven from outside without adding
// a row to the real table (which would change the answer for every other lane, and for the
// fitness functions).
export function navBudgetFor(items) {
  const tooMany = items.length > NAV_ITEM_BUDGET;
  const longLabels = items.filter((item) => item.label.length > NAV_LABEL_BUDGET).map((item) => item.label);
  const breaches = [
    ...(tooMany ? [`the route table yields ${items.length} addressable surfaces; the bar is designed for ${NAV_ITEM_BUDGET}`] : []),
    ...longLabels.map((label) => `the label ${JSON.stringify(label)} is ${label.length} characters; the budget is ${NAV_LABEL_BUDGET}`),
  ];
  return Object.freeze({
    items: items.length,
    itemBudget: NAV_ITEM_BUDGET,
    labelBudget: NAV_LABEL_BUDGET,
    within: breaches.length === 0,
    breaches: Object.freeze(breaches),
    // The four things a breach must NEVER be answered with.
    absorbedBy: null,
  });
}

// Which item is current. A single trailing slash matches in place (ADR-002 [Amigos-6]) and
// matching is case-sensitive; an unmatched path makes NO item current, because none is —
// marking one would tell the operator they are somewhere they are not.
function currentRouteId(pathname, routes) {
  const candidate = pathname.length > 1 && pathname.endsWith("/") && !pathname.endsWith("//") ? pathname.slice(0, -1) : pathname;
  return routes.find((route) => route.path === candidate)?.id ?? null;
}

function availabilityOf(resolvable, id) {
  if (!Object.hasOwn(resolvable ?? {}, id)) return AVAILABLE;
  const answer = resolvable[id];
  if (answer === false) return UNAVAILABLE;
  if (answer === null || answer === undefined) return UNKNOWN;
  return AVAILABLE;
}

function originOf(resolvable, id) {
  const answer = (resolvable ?? {})[id];
  if (answer && typeof answer === "object" && typeof answer.origin === "string") return answer.origin;
  return null;
}

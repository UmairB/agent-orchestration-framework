// Traceability wiring for milestone 45 / story 03, task 02 —
// `stories/03_story_app-shell-and-entry/tasks/02_navigation.feature` (@executable).
//
// THE CHANNEL. The feature's LITMUS: "every Then is a returned VALUE from the shell's
// framework-free nav model — a `.mjs` module in `ui/src/app/` beside the route table, loaded by
// node:test with no bundler and no DOM. The model is PURE over the facts the shell hands it:
// the current address (pathname / search / hash), the viewport width, and whether each
// destination is resolvable from this origin." That module is `ui/src/app/shell-nav.mjs`.
//
// The one thing added on top, because it is the claim a model cannot make: the REAL shell
// renders those items as REAL `<a href>` elements in a real `<nav aria-label="Surfaces">`
// landmark — middle-click, Ctrl-click and "copy link address" only work on an anchor, and the
// entire milestone exists so the address is worth copying.
//
// NOT HERE, by the feature's own words: whether the active marking READS as "you are here"
// without colour, whether the labels fit at 390, whether the nav reflows when a board appears.
// Pixel and perceptual facts — task 04's @uat verdict.
import assert from "node:assert/strict";
import {
  AVAILABLE,
  NAV_FORM_DISCLOSURE,
  NAV_FORM_TABS,
  NAV_ITEM_BUDGET,
  NAV_LABEL_BUDGET,
  UNAVAILABLE,
  UNKNOWN,
  navBudgetFor,
  navModel,
} from "../ui/src/app/shell-nav.mjs";
import { ROUTES } from "../ui/src/app/routes.mjs";
import { withShellApp } from "./support/shell-app-harness.mjs";
import { findAll } from "./support/mini-react.mjs";

function addressOf(address) {
  const [beforeHash, ...hashRest] = address.split("#");
  const hash = hashRest.length > 0 ? `#${hashRest.join("#")}` : "";
  const [pathname, ...searchRest] = beforeHash.split("?");
  return { pathname, search: searchRest.length > 0 ? `?${searchRest.join("?")}` : "", hash };
}

export const shellNavigationTests = [
  // ======================================================================
  // Scenario Outline: the nav offers all four surfaces as real links on every route, with
  // exactly one — or, on an unmatched path, no — item marked current
  // ======================================================================
  {
    name: "shell-nav/02 the nav offers all four surfaces as REAL LINKS on every route, with exactly one — or on an unmatched path NO — item current (02 scenario 1, all five rows)",
    async run() {
      const rows = [
        { name: "the landing", address: "/", current: "landing", count: 1 },
        { name: "the fleet, deep-linked", address: "/fleet?scope=local", current: "fleet", count: 1 },
        { name: "the board, with a fragment", address: "/board#42/03", current: "board", count: 1 },
        { name: "the config editor", address: "/config", current: "config", count: 1 },
        { name: "no route matched", address: "/nope", current: null, count: 0 },
      ];

      for (const row of rows) {
        const nav = navModel({ address: addressOf(row.address) });
        // Exactly four items, in the ROUTE TABLE's order, with the table's own names.
        assert.deepEqual(nav.items.map((item) => item.label), ["Terminals", "Fleet", "Board", "Config"], `${row.name}: four items, in the table's order`);
        assert.deepEqual(
          nav.items.map((item) => item.id),
          ROUTES.filter((route) => route.path !== null).map((route) => route.id),
          `${row.name}: the items ARE the table's addressable rows — never a hand-typed list`,
        );
        // Every item is a link carrying an `href`, never a button that pushes state.
        for (const item of nav.items) {
          assert.equal(item.element, "a", `${row.name}: ${item.id} is an anchor`);
          assert.equal(typeof item.href, "string", `${row.name}: ${item.id} carries an href`);
        }
        assert.equal(nav.currentId, row.current, `${row.name}: the item marked current`);
        assert.equal(nav.ariaCurrentCount, row.count, `${row.name}: the number of items carrying aria-current="page"`);
        // No item is hidden, dropped or reordered on any of them.
        assert.equal(nav.items.length, 4);
      }

      // …and the RENDERED nav is a real landmark holding real anchors.
      await withShellApp({ routeId: "fleet", address: addressOf("/fleet?scope=local"), identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        const nav = app.nav();
        assert.equal(nav.props["aria-label"], "Surfaces", "<nav aria-label=\"Surfaces\">");
        assert.equal(app.navItems().length, 4);
        for (const item of app.navItems()) assert.equal(item.type, "a", "a real <a href>, never a <button> that pushes state");
        assert.equal(app.navItems().filter((item) => item.props["aria-current"] === "page").length, 1, "exactly one aria-current in the document");
      });

      // The unmatched path renders NO aria-current anywhere — marking one would tell the
      // operator they are somewhere they are not.
      await withShellApp({ routeId: "not-found", address: addressOf("/nope"), identity: "aof", viewportWidth: 1280 }, async (app) => {
        assert.equal(app.navItems().length, 4, "the nav still offers all four surfaces");
        assert.equal(app.navItems().filter((item) => item.props["aria-current"] !== undefined).length, 0, "…and NOTHING is marked current");
      });
    },
  },

  // ======================================================================
  // Scenario: the active item is marked by shape, weight and a programmatic signal
  // ======================================================================
  {
    name: "shell-nav/02 the active item is marked by SHAPE, WEIGHT and a PROGRAMMATIC signal, with colour as the fourth and never the only one (02 scenario 2)",
    run() {
      const nav = navModel({ address: addressOf("/fleet") });
      const active = nav.items.find((item) => item.id === "fleet");
      const inactive = nav.items.find((item) => item.id === "board");

      // Shape: a 2px SOLID bottom rule.
      assert.equal(active.marking.rule.width, 2);
      assert.equal(active.marking.rule.style, "solid");
      // Weight: the heavier of the two type weights.
      assert.equal(active.marking.weight, "font-semibold");
      assert.equal(inactive.marking.weight, "font-medium");
      // Programmatic.
      assert.equal(active.ariaCurrent, "page");
      assert.equal(inactive.ariaCurrent, null);

      // With every COLOUR token removed, two independent signals still distinguish it.
      const colourless = (item) => ({ width: item.marking.rule.width, style: item.marking.rule.style, weight: item.marking.weight, ariaCurrent: item.ariaCurrent });
      const a = colourless(active);
      const b = colourless(inactive);
      const differing = Object.keys(a).filter((key) => a[key] !== b[key]);
      assert.equal(differing.length >= 2, true, `two independent non-colour signals survive: ${differing.join(", ")}`);
      assert.deepEqual(differing.sort(), ["ariaCurrent", "weight"]);

      // An inactive-but-available item carries a TRANSPARENT rule of the SAME thickness, so the
      // active mark is a change of appearance and never a change of size.
      assert.equal(inactive.marking.rule.width, active.marking.rule.width);
      assert.equal(inactive.marking.rule.colourToken, "border-transparent");
      assert.equal(active.marking.rule.colourToken, "border-primary");

      // No item's height changes with its state: every item fills the bar's full 48px — a hit
      // target rather than a padded text run (WCAG 2.2 SC 2.5.8).
      assert.equal(new Set(nav.items.map((item) => item.height)).size, 1);
      for (const item of nav.items) {
        assert.equal(item.height, 48);
        assert.equal(item.fillsBarHeight, true);
      }
    },
  },

  // ======================================================================
  // Scenario Outline: the item pointing at the route you are on carries the address's own
  // parameters; every other item is the bare path, and invents nothing
  // ======================================================================
  {
    name: "shell-nav/02 the CURRENT item carries the address's own parameters; every other item is the bare path and invents nothing (02 scenario 3, all eight rows)",
    run() {
      const rows = [
        { name: "the fleet's own item, deep-linked to local scope", address: "/fleet?scope=local", item: "fleet", href: "/fleet?scope=local" },
        { name: "the desktop app's entry address, unchanged", address: "/fleet?scope=global", item: "fleet", href: "/fleet?scope=global" },
        { name: "47's future filter rides along, in order", address: "/fleet?scope=global&repo=aof", item: "fleet", href: "/fleet?scope=global&repo=aof" },
        { name: "the board's own item keeps its fragment", address: "/board#42/03", item: "board", href: "/board#42/03" },
        { name: "leaving the fleet for the board", address: "/fleet?scope=local", item: "board", href: "/board" },
        { name: "leaving the board for the fleet — INVENTS NOTHING", address: "/board#42/03", item: "fleet", href: "/fleet" },
        { name: "from the landing", address: "/", item: "fleet", href: "/fleet" },
        { name: "from an unmatched path, nothing is carried", address: "/nope?scope=local", item: "fleet", href: "/fleet" },
      ];

      for (const row of rows) {
        const nav = navModel({ address: addressOf(row.address) });
        const item = nav.items.find((candidate) => candidate.id === row.item);
        assert.equal(item.href, row.href, `${row.name}: the ${row.item} item's href`);
        // It carries no parameter the current address does not carry, in no order the current
        // address does not use.
        const carried = [...new URLSearchParams(item.href.split("?")[1]?.split("#")[0] ?? "").entries()];
        const available = [...new URLSearchParams(addressOf(row.address).search).entries()];
        for (const [key, value] of carried) {
          assert.deepEqual(available.find(([k]) => k === key), [key, value], `${row.name}: ${key} came from the current address`);
        }
        assert.deepEqual(carried, carried.length === 0 ? [] : available, `${row.name}: …in the current address's own order`);
      }

      // The model names NO query key at all — `scope`, milestone 47's repo filter and an
      // unknown key are indistinguishable to it, which is precisely what keeps 47's change
      // local to the fleet (ADR-006).
      const exotic = navModel({ address: addressOf("/fleet?zz=1&scope=local&repo=aof") });
      assert.equal(exotic.items.find((item) => item.id === "fleet").href, "/fleet?zz=1&scope=local&repo=aof", "every parameter rides, in order, none named");
    },
  },

  // ======================================================================
  // Scenario Outline: a destination that cannot be resolved from this origin is present,
  // unavailable and explained
  // ======================================================================
  {
    name: "shell-nav/02 an unresolvable destination is present, unavailable and EXPLAINED — never a dead link and never a missing slot (02 scenario 4, all five rows)",
    async run() {
      const rows = [
        { name: "no board server is running", item: "board", resolvable: { board: false }, href: null, availability: UNAVAILABLE, title: /aof work ui/ },
        { name: "a board IS running on its ephemeral port", item: "board", resolvable: { board: { origin: "http://127.0.0.1:53211" } }, href: "http://127.0.0.1:53211/board", availability: AVAILABLE, title: null },
        { name: "the config editor is not being served", item: "config", resolvable: { config: false }, href: null, availability: UNAVAILABLE, title: /aof assets ui/ },
        { name: "the fleet is always the fixed :4181 origin", item: "fleet", resolvable: { fleet: { origin: "http://127.0.0.1:4181" } }, href: "http://127.0.0.1:4181/fleet", availability: AVAILABLE, title: null },
        // ROW 5, SETTLED AT BUILD: for the interval before a probe returns, the slot is HELD at
        // its final width without a live `href` — the option DESIGN names first. The rejected
        // third answers are a spinner in the bar, a collapsed slot, and an item that pops into
        // existence; the rejected second is a live link that may dead-end on one click.
        //
        // ITS TITLE IS NOT THE UNAVAILABLE ONE, and it is not absent either (PO ruling on QA
        // F-45-03-C): "not yet known" is its own answer, so the item says the answer is coming
        // rather than naming a command the operator has no reason to run yet.
        { name: "the probe has not answered yet", item: "board", resolvable: { board: null }, href: null, availability: UNKNOWN, title: /reachable|Checking/ },
      ];

      const baseline = navModel({ address: addressOf("/") });
      for (const row of rows) {
        const nav = navModel({ address: addressOf("/"), resolvable: row.resolvable });
        const item = nav.items.find((candidate) => candidate.id === row.item);
        assert.equal(item.href, row.href, `${row.name}: the ${row.item} item's href`);
        assert.equal(item.availability, row.availability, `${row.name}: its rendering`);
        if (row.title === null) assert.equal(item.title, null, `${row.name}: no title`);
        else assert.match(item.title, row.title, `${row.name}: its title names the command`);

        // The nav still yields four items in the same order, and the item still occupies its
        // own slot at its own width.
        assert.equal(nav.items.length, 4);
        assert.deepEqual(nav.items.map((candidate) => candidate.id), baseline.items.map((candidate) => candidate.id));
        assert.equal(item.holdsItsSlot, true);
        // Nothing about the other three items changes.
        for (const other of nav.items.filter((candidate) => candidate.id !== row.item)) {
          assert.deepEqual(other, baseline.items.find((candidate) => candidate.id === other.id), `${row.name}: the ${other.id} item is untouched`);
        }
      }

      // An item that LEAVES THE ORIGIN renders identically in form to one that does not: same
      // shape, same marking, same availability — port topology is not the operator's problem.
      // `aria-disabled` IS RESERVED FOR UNAVAILABLE (PO ruling on QA F-45-03-C). The three
      // availabilities are three programmatic answers, not two-and-a-half: an item whose probe
      // is still out is NOT disabled — announcing it so would tell a screen-reader user a
      // destination is closed at the moment it is most likely to open, and it would then have
      // to be un-announced when the answer lands. The SIGHTED treatment is unchanged: the slot
      // is held at its final width with no live `href` either way.
      const availability = (answer) => navModel({ address: addressOf("/"), resolvable: { board: answer } }).items.find((item) => item.id === "board");
      const unknown = availability(null);
      const unavailable = availability(false);
      const available = availability(true);
      assert.equal(unavailable.ariaDisabled, "true", "UNAVAILABLE is `aria-disabled`, because it really does not navigate");
      assert.equal(unknown.ariaDisabled, null, "UNKNOWN is NOT `aria-disabled` — it is not known yet, which is a different thing");
      assert.equal(available.ariaDisabled, null);
      assert.equal(unknown.href, null, "…and it still has no live `href` to dead-end on");
      assert.equal(unknown.navigates, false);
      assert.equal(unknown.holdsItsSlot, true, "…and still holds its slot at its final width, so nothing moves when the answer lands");
      assert.equal(unknown.command, null, "no command: there is nothing for the operator to run about an answer that is coming");
      assert.notEqual(unknown.title, null, "it SAYS its availability is being determined…");
      assert.notEqual(unknown.title, unavailable.title, "…in words that are not the unavailable ones");
      assert.equal(/Run `/.test(unknown.title), false);
      // Its sighted marking is the plain transparent rule, never the dashed absent/degraded
      // primitive — that one means "not there", and this one means "not answered".
      assert.equal(unknown.marking.rule.style, "solid");
      assert.equal(unavailable.marking.rule.style, "dashed");
      assert.equal(unknown.marking.rule.width, unavailable.marking.rule.width, "the same thickness either way: the slot never changes size");

      // …and the RENDERED item carries exactly that: present, focusable, titled, and with NO
      // `aria-disabled` attribute in the document at all.
      await withShellApp({ routeId: "landing", address: addressOf("/"), identity: "aof", viewportWidth: 1280, resolvable: { board: null } }, async (app) => {
        const board = app.navItem("board");
        assert.equal(board.type, "span", "no href, so not an anchor");
        assert.equal(board.props["aria-disabled"], undefined, "…and NOT announced as disabled");
        assert.equal(board.props.tabIndex, 0, "…still focusable");
        assert.match(board.props.title, /reachable|Checking/);
        assert.equal(app.navItems().length, 4, "the nav does not reflow");
      });

      const crossOrigin = navModel({ address: addressOf("/"), resolvable: { board: { origin: "http://127.0.0.1:53211" } } }).items.find((item) => item.id === "board");
      const inOrigin = baseline.items.find((item) => item.id === "board");
      assert.deepEqual(crossOrigin.marking, inOrigin.marking);
      assert.equal(crossOrigin.availability, inOrigin.availability);
      assert.equal(crossOrigin.element, inOrigin.element);

      // …and the REAL shell renders an unavailable destination as a non-link that keeps its
      // slot.
      await withShellApp({ routeId: "landing", address: addressOf("/"), identity: "aof", viewportWidth: 1280, resolvable: { board: false } }, async (app) => {
        const board = app.navItem("board");
        assert.equal(board.type, "span", "not an anchor — there is no href to dead-end on");
        assert.equal(board.props["aria-disabled"], "true");
        assert.match(board.props.title, /aof work ui/);
        assert.equal(app.navItems().length, 4, "the nav does not reflow");
      });
    },
  },

  // ======================================================================
  // Scenario: an unavailable item stays focusable, states its reason without colour, and does
  // not navigate
  // ======================================================================
  {
    name: "shell-nav/02 an unavailable item stays FOCUSABLE, states its reason without colour, and does not navigate (02 scenario 5)",
    async run() {
      const nav = navModel({ address: addressOf("/"), resolvable: { board: false } });
      const board = nav.items.find((item) => item.id === "board");

      assert.equal(board.ariaDisabled, "true");
      // NOT removed from the tab order — an item skipped by the keyboard hides its explanation
      // from exactly the users who need it.
      assert.equal(board.focusable, true);
      // Activating it navigates nowhere and changes no address.
      assert.equal(board.navigates, false);
      assert.equal(board.href, null);
      // The unavailable signal is the DASHED bottom rule — the product's existing
      // "not-yet / absent / degraded" primitive — plus `aria-disabled` plus the `title`, never
      // colour alone.
      assert.equal(board.marking.rule.style, "dashed");
      assert.equal(board.marking.rule.width, 2);
      // The reason it carries is a COMMAND the operator can run, not an apology or an error.
      assert.equal(board.command, "aof work ui");
      assert.match(board.title, /^Run `aof work ui`/);
      assert.equal(/sorry|error|failed|unable/i.test(board.title), false);

      // It uses the SAME unavailable treatment the landing's destination row uses for the same
      // condition — one rule, both places. The landing's row is built from these very items.
      await withShellApp({ routeId: "landing", address: addressOf("/"), identity: "aof", viewportWidth: 1280, resolvable: { board: false } }, async (app) => {
        const disabled = findAll(app.tree(), (node) => node.props?.["aria-disabled"] === "true");
        assert.equal(disabled.length, 2, "the nav item AND the landing's destination link");
        for (const node of disabled) {
          assert.equal(node.props.tabIndex, 0, "…both stay focusable");
          assert.match(node.props.className, /border-dashed/, "…both take the dashed treatment");
          assert.match(node.props.title, /aof work ui/, "…both name the same command");
        }
      });
    },
  },

  // ======================================================================
  // Scenario Outline: the nav's form drops in whole discrete steps
  // ======================================================================
  {
    name: "shell-nav/02 the nav's form drops in WHOLE DISCRETE STEPS, and the active surface stays visible at every one (02 scenario 6, all three rows)",
    async run() {
      const rows = [
        { name: "the primary judgement width", width: 1280, form: NAV_FORM_TABS },
        { name: "the desktop-app proxy", width: 768, form: NAV_FORM_TABS },
        { name: "mobile", width: 390, form: NAV_FORM_DISCLOSURE },
      ];

      for (const row of rows) {
        const nav = navModel({ address: addressOf("/fleet"), viewportWidth: row.width });
        assert.equal(nav.form, row.form, `${row.name}: the nav's form`);
        if (row.form === NAV_FORM_TABS) {
          assert.equal(nav.items.length, 4, `${row.name}: four items, full labels`);
          assert.equal(nav.items.find((item) => item.id === "fleet").current, true, `${row.name}: …and the active one marked`);
        } else {
          // The disclosure's label is the ACTIVE surface's name, so "you are here" survives the
          // collapse.
          assert.equal(nav.disclosure.label, "Fleet");
          assert.equal(nav.disclosure.namesASurface, true);
          assert.equal(nav.disclosure.ariaHasPopup, "menu");
          assert.equal(nav.disclosure.items.length, 4, "opening it still offers all four");
        }
        // No label is truncated, abbreviated or shrunk by a scale factor; no item is dropped;
        // the nav never yields two rows or a horizontally-scrolling row (an operator cannot see
        // that there is more).
        assert.equal(nav.labelsTruncated, false);
        assert.equal(nav.rows, 1);
        assert.equal(nav.horizontallyScrolls, false);
        assert.deepEqual(nav.items.map((item) => item.label), ["Terminals", "Fleet", "Board", "Config"], `${row.name}: every label whole`);
      }

      // The REAL shell renders the disclosure trigger at 390, with the switcher's own
      // `aria-haspopup` / `aria-expanded` contract.
      await withShellApp({ routeId: "fleet", address: addressOf("/fleet"), identity: "aof", viewportWidth: 390, surface: "plain" }, async (app) => {
        const trigger = findAll(app.tree(), (node) => node.props?.["aria-haspopup"] === "menu")[0];
        assert.ok(trigger, "the disclosure trigger stands");
        assert.equal(trigger.props["aria-expanded"], false);
        assert.equal(app.navItems().length, 0, "…and the four tabs are collapsed behind it, not dropped");
      });
    },
  },

  // ======================================================================
  // Scenario: at 390 on an unmatched path the disclosure names no surface
  // ======================================================================
  {
    name: "shell-nav/02 at 390 on an unmatched path the disclosure names NO surface, because none is current (02 scenario 7)",
    run() {
      const nav = navModel({ address: addressOf("/nope"), viewportWidth: 390 });
      assert.equal(nav.form, NAV_FORM_DISCLOSURE);
      // It does not fall back to the first item, to the landing, or to the last surface
      // visited — labelling the trigger `Terminals` because it is first would tell an operator
      // who typed a bad URL that they are on the terminals home.
      assert.equal(nav.disclosure.namesASurface, false);
      const labels = nav.items.map((item) => item.label);
      assert.equal(labels.includes(nav.disclosure.label), false, `the disclosure's label ${JSON.stringify(nav.disclosure.label)} is not any surface's name`);
      // No item inside the disclosure carries `aria-current`.
      assert.equal(nav.ariaCurrentCount, 0);
      assert.equal(nav.disclosure.items.filter((item) => item.ariaCurrent !== null).length, 0);
      // Opening it still offers all four surfaces, in the table's order.
      assert.deepEqual(nav.disclosure.items.map((item) => item.label), ["Terminals", "Fleet", "Board", "Config"]);
    },
  },

  // ======================================================================
  // Scenario: the nav's budget is four items and ten characters
  // ======================================================================
  {
    name: "shell-nav/02 the nav's budget is FOUR items and TEN characters, and exceeding it is REPORTED rather than absorbed (02 scenario 8)",
    run() {
      const nav = navModel({ address: addressOf("/") });
      assert.equal(nav.items.length, NAV_ITEM_BUDGET);
      assert.equal(nav.budget.items, 4);
      for (const item of nav.items) {
        assert.equal(item.label.length <= NAV_LABEL_BUDGET, true, `${item.label} is within the ${NAV_LABEL_BUDGET}-character budget`);
      }
      assert.equal(nav.budget.within, true);
      assert.deepEqual([...nav.budget.breaches], []);

      // A fifth entry, or a label longer than ten characters, is REPORTED — and it is never
      // absorbed by truncating, ellipsising, shrinking the type, wrapping to a second row, or
      // dropping an item. This is the guard that makes 47's and 49's route additions cheap:
      // they meet the budget at the door instead of discovering the bar's limits in a
      // screenshot review three milestones later.
      //
      // IT IS THE PRODUCTION FUNCTION BEING DRIVEN, not a copy of its arithmetic (QA
      // F-45-03-D). This lane used to rebuild the budget locally over a hypothetical fifth
      // row, which made the one condition the budget exists for — a fifth surface, a long
      // label — assertable only against the test's own code: green forever, including on the
      // day `navBudgetFor` stopped counting. `navBudgetFor` takes the items so the tripwire can
      // be driven from outside without adding a row to the REAL table (which would change the
      // answer for every other lane here, and for the fitness functions).
      const overBudget = [...nav.items, { ...nav.items[0], id: "extra", label: "Observability" }];
      const budget = navBudgetFor(overBudget);
      assert.equal(budget.within, false);
      assert.equal(budget.breaches.length, 2, "both breaches are named: a fifth item, and a 13-character label");
      assert.match(budget.breaches.join(" "), /5 addressable surfaces/);
      assert.match(budget.breaches.join(" "), /"Observability" is 13 characters/);
      assert.equal(budget.absorbedBy, null, "nothing is truncated, ellipsised, shrunk, wrapped or dropped to make it fit");
      assert.equal(overBudget.length, 5, "…the fifth item is still THERE, reported rather than hidden");
      // The two tripwires fire INDEPENDENTLY — a fifth item with a short label is still a
      // breach, and a fourth item with a long one is too. Asserted separately because a
      // single-condition implementation passes the combined row above.
      const fifthOnly = navBudgetFor([...nav.items, { ...nav.items[0], id: "extra", label: "Runs" }]);
      assert.equal(fifthOnly.within, false, "a FIFTH item breaches on its own");
      assert.deepEqual([...fifthOnly.breaches].length, 1);
      assert.match(fifthOnly.breaches[0], /5 addressable surfaces/);
      const longOnly = navBudgetFor(nav.items.map((item) => (item.id === "board" ? { ...item, label: "Observability" } : item)));
      assert.equal(longOnly.within, false, "a LONG LABEL breaches on its own, at four items");
      assert.equal(longOnly.items, 4);
      assert.match(longOnly.breaches[0], /"Observability" is 13 characters/);
      // The exact boundary, both ways: the budget is `>`, never `>=`.
      assert.equal(navBudgetFor(nav.items).within, true, "four items is WITHIN four");
      assert.equal(navBudgetFor([{ label: "x".repeat(NAV_LABEL_BUDGET) }]).within, true, `${NAV_LABEL_BUDGET} characters is within ${NAV_LABEL_BUDGET}`);
      assert.equal(navBudgetFor([{ label: "x".repeat(NAV_LABEL_BUDGET + 1) }]).within, false, "…and one more is not");
      // The model's own budget IS this function's answer over its own items — one home.
      assert.deepEqual(nav.budget, navBudgetFor(nav.items));
      assert.equal(nav.budget.itemBudget, NAV_ITEM_BUDGET);
      assert.equal(nav.budget.labelBudget, NAV_LABEL_BUDGET);
    },
  },
];

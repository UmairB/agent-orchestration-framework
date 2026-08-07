// Traceability wiring for milestone 45 / story 03, task 03 —
// `stories/03_story_app-shell-and-entry/tasks/03_unmatched-path-and-fullscreen.feature`
// (@executable).
//
// TWO STATES THAT ARE NOT SURFACES, sharing one rule: neither is allowed to touch the address
// bar. An unmatched path renders IN the shell at the path the operator typed, with the
// navigation right there; fullscreen is a transient view state that gets no path, no query
// parameter and no history entry, so Back is never the way out of it.
//
// THE CHANNEL. The feature's LITMUS: "every Then is a returned VALUE from a framework-free
// `.mjs` module loaded by node:test with no bundler and no DOM — `routeFor` from
// `ui/src/app/routes.mjs`, the entry's own decision plan, the shell's region/state model, and
// the fullscreen state machine that ADR-005 puts in `ui/src/app/shell-layout.mjs`."
//
// PLUS the rendered document where a clause is about the document: that the not-found state
// really renders inside the chrome with the nav usable, and that the presented occupant really
// declares `role="dialog"` / `aria-modal` / its label and really hands focus back to the
// control that opened it.
//
// WHAT THIS DELIBERATELY CANNOT SHOW, and ADR-005 [Build-1] says so itself: the occupant's
// INSTANCE and DOM identity surviving present and dismiss. These scenarios drive a PURE state
// machine, "where instance identity is not observable at all; the violation is therefore
// invisible in 45 and fatal in 46 … the honest pin is a behavioural one in m46, where a real
// socket and a real PTY exist to survive the transition." What IS pinned here is everything the
// machine can carry: the closed transition set, the replace-on-second-request, the no-op
// dismissals, the layout TICK on both transitions, the claimed `Escape`, and the focus restore.
import assert from "node:assert/strict";
import {
  CONTENT_MODE_PAGE,
  FULLSCREEN_EMPTY,
  FULLSCREEN_PRESENTING,
  STATE_FAILED,
  STATE_MOUNTING,
  STATE_NOT_FOUND,
  STATE_POPULATED,
  Z_LADDER,
  chromeModel,
  contentModeFor,
  contentStateFor,
  fullscreenReducer,
  fullscreenState,
  presentedStateModel,
} from "../ui/src/app/shell-layout.mjs";
import { routeFor } from "../ui/src/app/routes.mjs";
import { entryPlanFor, addressToString } from "../ui/src/app/entry.mjs";
import { navModel } from "../ui/src/app/shell-nav.mjs";
import { withShellApp } from "./support/shell-app-harness.mjs";
import { findAll, textOf } from "./support/mini-react.mjs";

function addressOf(address) {
  const [beforeHash, ...hashRest] = address.split("#");
  const hash = hashRest.length > 0 ? `#${hashRest.join("#")}` : "";
  const [pathname, ...searchRest] = beforeHash.split("?");
  return { pathname, search: searchRest.length > 0 ? `?${searchRest.join("?")}` : "", hash };
}

const OCCUPANT_A = { id: "session-a", label: "Session 42/03 on aof-mac", node: null, home: null };
const OCCUPANT_B = { id: "session-b", label: "Session 44/01 on aof-wsl", node: null, home: null };

export const shellNotFoundAndFullscreenTests = [
  // ======================================================================
  // Scenario Outline: an unknown path selects the not-found surface and the entry asks for no
  // rewrite at all
  // ======================================================================
  {
    name: "shell-notfound/03 an unknown path selects the not-found surface and the entry asks for NO rewrite at all (03 scenario 1, all eight rows)",
    run() {
      const rows = [
        { name: "a plain typo", address: "/nope", surface: "not-found" },
        { name: "a near-miss of a real route", address: "/fleeet", surface: "not-found" },
        { name: "scope as a PATH segment — it is a query param", address: "/fleet/local", surface: "not-found" },
        { name: "a board ref as a path — the ref is a fragment", address: "/board/42/03", surface: "not-found" },
        // ADR-002's naming collision seen from the client: the legacy MODE value is `assets`
        // but the PATH cannot be, because ui/dist/assets/ is where the bundle serves its own
        // JavaScript from. The honest answer is the not-found surface — never the config editor.
        { name: "the bundle's own asset directory, bare", address: "/assets", surface: "not-found" },
        { name: "the legacy MODE value as a path", address: "/config", surface: "config" },
        // ROW 7, CONTESTED, SETTLED BY THE COMMITTED ROUTE MODULE: paths are CASE-SENSITIVE and
        // lowercase is canonical, so `/Fleet` is an unknown path and renders not-found IN
        // PLACE. Not a redirect (that is the address-rewriting this feature exists to forbid),
        // and not a case-insensitive match (which would leave two addresses meaning one
        // surface, and force a decision about what `/FLEET` should say in the address bar).
        { name: "wrong case", address: "/Fleet", surface: "not-found" },
        // ROW 8, CONTESTED, SETTLED THE OTHER WAY AND DELIBERATELY ASYMMETRIC: a single
        // trailing slash is a PUNCTUATION variant of the same path, so `/fleet/` matches IN
        // PLACE with no rewrite. The server agrees — `shouldServeAppShell("/fleet/")` is true —
        // and the two halves must not disagree.
        { name: "a trailing slash on a real route", address: "/fleet/", surface: "fleet" },
      ];

      for (const row of rows) {
        const plan = entryPlanFor(addressOf(row.address));
        assert.equal(plan.surface, row.surface, `${row.name}: ${row.address} → ${row.surface}`);
        // NO history rewrite — not a replace, not a push, not a redirect to "/".
        assert.equal(plan.replace, null, `${row.name}: the plan asks for no rewrite`);
        assert.equal(plan.history, "none");
        assert.equal(addressToString(plan.address), row.address, `${row.name}: the address the surface is handed is byte-identical to what arrived`);
      }

      // Every unknown path resolves to the ONE shared not-found entry, and never to "/".
      assert.deepEqual(routeFor("/nope"), routeFor("/Fleet"));
      assert.notDeepEqual(routeFor("/nope"), routeFor("/"));
    },
  },

  // ======================================================================
  // Scenario: the not-found surface renders INSIDE the shell, with the chrome and the
  // navigation intact and fully usable
  // ======================================================================
  {
    name: "shell-notfound/03 the not-found state renders INSIDE the shell with the chrome and navigation intact and fully usable (03 scenario 2)",
    async run() {
      const address = addressOf("/nope");
      const nav = navModel({ address });
      // The nav offers all four surfaces as LIVE links…
      assert.equal(nav.items.length, 4);
      for (const item of nav.items) assert.equal(typeof item.href, "string");
      // …and no item is marked active, and no item carries `aria-current`.
      assert.equal(nav.currentId, null);
      assert.equal(nav.ariaCurrentCount, 0);
      // The content mode is `content:page`.
      assert.equal(contentModeFor("not-found").mode, CONTENT_MODE_PAGE);

      await withShellApp({ routeId: "not-found", address, identity: "aof", viewportWidth: 1280 }, async (app) => {
        // The top bar renders exactly as it does on any other route.
        const notFoundBar = app.row("top-bar");
        assert.ok(notFoundBar, "the top bar stands");
        assert.equal(app.banners().length, 1);
        // The slot REGION is always there (right-anchored, so its width never moves the nav);
        // on an unmatched path nothing is mounted to fill it, so it holds nothing.
        assert.deepEqual(app.slotLabels(), [], "the surface slot is empty — nothing is mounted to fill it");
        assert.equal(app.slot().props.children, null);
        assert.equal(app.navItems().length, 4);
        assert.equal(app.navItems().every((item) => item.type === "a"), true, "all four are live links, so recovery is one click");
        assert.equal(app.navItems().filter((item) => item.props["aria-current"] !== undefined).length, 0);
        // The not-found state occupies the content region — the one `<main>` — and nothing else
        // about the shell differs from a matched route.
        assert.equal(app.mains().length, 1);
        assert.match(textOf(app.mains()[0]), /\/nope/);
      });

      // "Exactly as it does on any other route" — the same bar model, byte for byte.
      const matched = await withShellApp({ routeId: "config", address: addressOf("/config"), identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => barSignature(app));
      const unmatched = await withShellApp({ routeId: "not-found", address, identity: "aof", viewportWidth: 1280 }, async (app) => barSignature(app));
      assert.deepEqual(unmatched, matched, "same mark, same wordmark, same identity chip, same divider, same nav");
    },
  },

  // ======================================================================
  // Scenario: the not-found state names the path, points at the nav, and uses the not-yet
  // language rather than the error language
  // ======================================================================
  {
    name: "shell-notfound/03 the not-found state names the path VERBATIM, points at the nav, and uses the not-yet language — never the error language (03 scenario 3)",
    async run() {
      const state = contentStateFor({ routeId: "not-found" });
      assert.equal(state.state, STATE_NOT_FOUND);
      assert.equal(state.namesThePath, true);
      assert.equal(state.pointsAtNav, true);
      // The established dashed empty-state form — the product's absent/not-yet primitive.
      assert.equal(state.treatment, "dashed-empty");
      // NO `accent` and NO `destructive`: nothing failed, the path simply is not a surface.
      assert.equal(state.accent, false);
      assert.equal(state.destructive, false);
      // It is a DIFFERENT state from the shell's failed-to-load state, which names a surface and
      // offers a Retry that re-attempts a mount.
      const failed = contentStateFor({ routeId: "fleet", surfaceFailed: true });
      assert.notEqual(failed.state, state.state);
      assert.equal(failed.retry, true);
      assert.equal(state.retry, false);
      assert.equal(failed.accent, true);
      assert.equal(failed.copyNamesTheSurface, true);

      // IT NAMES THE WHOLE ADDRESS, not just the pathname (PO ruling on QA F-45-03-K). The
      // assertion is EXACT rather than a substring, because a substring match on "/nope" is
      // satisfied by a state that silently drops the query — and then `/nope?scope=local` and
      // `/nope?scope=global` render the same sentence, so the operator cannot confirm what
      // they actually asked for. The query is also where a mistyped deep link's real mistake
      // usually is.
      const typedAddressOn = async (address) =>
        withShellApp({ routeId: "not-found", address: addressOf(address), identity: "aof", viewportWidth: 1280 }, async (app) => {
          const main = app.mains()[0];
          const mono = findAll(main, (node) => typeof node.props?.className === "string" && node.props.className.includes("mono"))[0];
          assert.ok(mono, "the address is set in `mono`, the way every literal in this product is");
          assert.match(textOf(main), /navigation/i, "…and it points at the navigation as the way on");
          const card = findAll(main, (node) => typeof node.props?.className === "string" && node.props.className.includes("border-dashed"))[0];
          assert.ok(card, "the dashed empty-state form");
          assert.equal(/accent|destructive/.test(card.props.className), false, "no accent, no destructive — nothing failed");
          return textOf(mono);
        });

      assert.equal(await typedAddressOn("/nope?scope=local"), "/nope?scope=local", "the address is carried VERBATIM — pathname, query and all");
      assert.equal(await typedAddressOn("/nope?scope=global"), "/nope?scope=global");
      assert.equal(await typedAddressOn("/nope"), "/nope", "…and a bare path is exactly itself, with no invented `?`");
      assert.equal(await typedAddressOn("/board/42/03#x"), "/board/42/03#x", "…fragment included: it is part of what the operator typed");
      // The two scopes are TELLABLE APART, which is the whole point of the ruling.
      assert.notEqual(await typedAddressOn("/nope?scope=local"), await typedAddressOn("/nope?scope=global"));
    },
  },

  // ======================================================================
  // Scenario Outline: the shell has four content states, exactly one is selected at a time
  // ======================================================================
  {
    name: "shell-notfound/03 the shell has FOUR content states, exactly one is selected at a time, and each is distinguishable (03 scenario 4, all five rows)",
    async run() {
      const rows = [
        { name: "no route matched", input: { routeId: "not-found" }, state: STATE_NOT_FOUND },
        { name: "the surface's code is in flight", input: { routeId: "fleet", surfaceLoaded: false }, state: STATE_MOUNTING },
        { name: "the surface is fetching its data", input: { routeId: "fleet", surfaceLoaded: true }, state: STATE_POPULATED },
        { name: "the surface failed to load", input: { routeId: "fleet", surfaceFailed: true }, state: STATE_FAILED },
        { name: "normal", input: { routeId: "fleet" }, state: STATE_POPULATED },
      ];

      for (const row of rows) {
        const state = contentStateFor(row.input);
        assert.equal(state.state, row.state, `${row.name}: the state`);
        assert.equal(state.exclusive, true, `${row.name}: the content region holds that state and no other`);
        // In EVERY row the chrome is intact and usable — a failed surface must never trap the
        // operator on it.
        assert.equal(state.chrome, "intact");
      }

      // ROW 2 — ONE neutral pulse placeholder carrying `aria-busy` and a label naming the
      // surface.
      const mounting = contentStateFor({ routeId: "fleet", surfaceLoaded: false });
      assert.equal(mounting.ariaBusy, true);
      assert.equal(mounting.labelNamesTheSurface, true);
      // ROW 3 IS THE ONE THAT PREVENTS TWO SPINNERS: the shell shows NOTHING while the surface
      // fetches its own data — the surface's own loading state owns the region.
      assert.equal(contentStateFor({ routeId: "fleet" }).treatment, "none");
      // ROW 4 is never `destructive`: a chunk that did not arrive is a retryable transport
      // condition, not data loss.
      assert.equal(contentStateFor({ routeId: "fleet", surfaceFailed: true }).destructive, false);
      // ROW 5 — the shell adds no wrapper padding, no max-width and no background of its own.
      const populated = contentStateFor({ routeId: "fleet" });
      assert.equal(populated.wrapperPadding, false);
      assert.equal(populated.wrapperMaxWidth, false);
      assert.equal(populated.wrapperBackground, false);

      // The three the shell renders ITSELF are all really renderable, and each is distinguishable
      // in the document — including the two only milestone 49's code-split surfaces can reach.
      const seen = [];
      for (const props of [
        { routeId: "not-found", address: addressOf("/nope") },
        { routeId: "fleet", address: addressOf("/fleet"), surfaceLoaded: false },
        { routeId: "fleet", address: addressOf("/fleet"), surfaceFailed: true },
      ]) {
        await withShellApp({ ...props, identity: "aof", viewportWidth: 1280 }, async (app) => {
          const main = app.mains()[0];
          // The mounting placeholder carries its label in `aria-label` (its blocks are
          // decorative), so a state's readable signature is its text PLUS its busy label.
          const busy = findAll(main, (node) => node.props?.["aria-busy"] === "true")[0] ?? null;
          seen.push(`${textOf(main)}${busy ? ` [${busy.props["aria-label"]}]` : ""}`);
          assert.equal(findAll(main, (node) => typeof node.props?.["data-stub-surface"] === "string").length, 0, "no surface is mounted beside the shell's own state");
          // The chrome is intact in every one of them.
          assert.equal(app.navItems().length + (app.row("top-bar") ? 1 : 0) > 0, true);
        });
      }
      assert.equal(new Set(seen).size, 3, "the three states an operator can reach are all distinguishable from each other");
      assert.match(seen[1], /Loading/i, "the mounting placeholder names the surface it is waiting for");
      assert.match(seen[2], /Retry/, "the failed state offers a Retry that re-attempts the mount");
    },
  },

  // ======================================================================
  // Scenario Outline: the fullscreen slot holds exactly one occupant, and every transition is
  // one of a closed set
  // ======================================================================
  {
    name: "shell-fullscreen/03 the fullscreen slot holds exactly ONE occupant, and every transition is one of a closed set (03 scenario 5, all eight rows)",
    run() {
      const empty = fullscreenState();
      const presentingA = fullscreenReducer(empty, { type: "present", occupant: OCCUPANT_A });

      const rows = [
        { name: "nothing is presented", before: empty, action: null, status: FULLSCREEN_EMPTY, occupants: 0, chrome: "visible" },
        { name: "a surface asks to be presented", before: empty, action: { type: "present", occupant: OCCUPANT_A }, status: FULLSCREEN_PRESENTING, occupant: "session-a", occupants: 1, chrome: "hidden" },
        { name: "a SECOND request replaces the first", before: presentingA, action: { type: "present", occupant: OCCUPANT_B }, status: FULLSCREEN_PRESENTING, occupant: "session-b", occupants: 1, chrome: "hidden" },
        { name: "the same occupant asks again", before: presentingA, action: { type: "present", occupant: OCCUPANT_A }, status: FULLSCREEN_PRESENTING, occupant: "session-a", occupants: 1, chrome: "hidden" },
        { name: "Esc dismisses", before: presentingA, action: { type: "escape" }, status: FULLSCREEN_EMPTY, occupants: 0, chrome: "visible" },
        { name: "the visible control dismisses", before: presentingA, action: { type: "dismiss", via: "control" }, status: FULLSCREEN_EMPTY, occupants: 0, chrome: "visible" },
        { name: "Esc with nothing presented is a no-op", before: empty, action: { type: "escape" }, status: FULLSCREEN_EMPTY, occupants: 0, chrome: "visible" },
        { name: "dismissing twice is a no-op", before: empty, action: { type: "dismiss", via: "control" }, status: FULLSCREEN_EMPTY, occupants: 0, chrome: "visible" },
      ];

      for (const row of rows) {
        const after = row.action === null ? row.before : fullscreenReducer(row.before, row.action);
        assert.equal(after.status, row.status, `${row.name}: the slot is ${row.status}`);
        assert.equal(after.occupants, row.occupants, `${row.name}: the number of occupants — occupants never stack`);
        assert.equal(after.chrome, row.chrome, `${row.name}: the shell's chrome is ${row.chrome}`);
        if (row.occupant) assert.equal(after.occupant.id, row.occupant, `${row.name}: which occupant`);
      }

      // ROW 4 — the SAME occupant asking again is not a re-present: nothing is torn down,
      // nothing is re-adopted, and the layout tick does NOT fire. This is the pure shadow of
      // [Build-1]'s identity guarantee.
      const again = fullscreenReducer(presentingA, { type: "present", occupant: OCCUPANT_A });
      assert.equal(again.layoutTick, presentingA.layoutTick, "no tick: the occupant never moved");
      assert.equal(again.occupant, presentingA.occupant, "…and it is the very same occupant record");
      assert.equal(again.changed, false);

      // [Build-1] — the shell emits a layout TICK after present AND after dismiss, because the
      // occupant is not laid out on the tick it is presented and the box changes back on the
      // way out.
      assert.equal(presentingA.layoutTick, empty.layoutTick + 1, "a tick on present");
      assert.equal(fullscreenReducer(presentingA, { type: "escape" }).layoutTick, presentingA.layoutTick + 1, "…and a tick on dismiss");
      // A no-op emits none.
      assert.equal(fullscreenReducer(empty, { type: "escape" }).layoutTick, empty.layoutTick);
      assert.equal(fullscreenReducer(empty, { type: "dismiss" }).layoutTick, empty.layoutTick);

      // "Chrome hidden" is not "chrome covered": the measurable consequence is that the
      // published chrome height is 0, so the occupant gets the whole viewport rather than the
      // whole viewport minus a bar nobody can see.
      assert.equal(chromeModel({ viewportHeight: 520, surfaceBar: true, fullscreen: true }).height, 0);

      // [Build-2] — an INTERACTIVE occupant may CLAIM `Escape`, and then the shell's `Esc`
      // dismissal does not apply (m46's terminal forwards stdin: `Esc` is a live keystroke for
      // the TUI on the far end). The visible exit control still dismisses it, which is what
      // makes the claim safe.
      const claiming = fullscreenReducer(fullscreenState(), { type: "present", occupant: { ...OCCUPANT_A, claimsEscape: true } });
      const afterEsc = fullscreenReducer(claiming, { type: "escape" });
      assert.equal(afterEsc.status, FULLSCREEN_PRESENTING, "the occupant claimed `Escape`, so the shell does not swallow it");
      assert.equal(afterEsc.escapeClaimedByOccupant, true);
      assert.equal(fullscreenReducer(claiming, { type: "dismiss", via: "control" }).status, FULLSCREEN_EMPTY, "…and the visible control is still a way out");
    },
  },

  // ======================================================================
  // Scenario: entering and leaving fullscreen adds no history entry, changes no path and
  // invents no parameter
  // ======================================================================
  {
    name: "shell-fullscreen/03 entering and leaving fullscreen adds NO history entry, changes no path and invents no parameter (03 scenario 6)",
    run() {
      const address = addressOf("/board#42/03");
      const before = entryPlanFor(address);
      const presenting = fullscreenReducer(fullscreenState(), { type: "present", occupant: OCCUPANT_A });
      const dismissed = fullscreenReducer(presenting, { type: "escape" });

      // NO transition yields a path, a query parameter, a fragment or a history operation of
      // any kind — the state carries no such field for one to hide in.
      for (const state of [presenting, dismissed]) {
        for (const forbidden of ["pathname", "search", "hash", "history", "url", "route"]) {
          assert.equal(Object.hasOwn(state, forbidden), false, `the fullscreen state carries no \`${forbidden}\``);
        }
      }
      // The address is byte-identical before, during and after.
      const after = entryPlanFor(address);
      assert.equal(addressToString(before.address), "/board#42/03");
      assert.deepEqual(after, before);
      // The route the shell resolves is unchanged throughout.
      assert.equal(routeFor(address.pathname).id, "board");

      // Back is never the way out: the machine has no transition a history entry could drive.
      // Every action it answers is one of these three, and none of them is a navigation.
      const unknown = fullscreenReducer(presenting, { type: "popstate" });
      assert.equal(unknown.status, presenting.status, "an action the machine does not name changes nothing");
      assert.equal(unknown.changed, false);

      // The same holds on every route, including an unmatched path — fullscreen is a property
      // of one control instance, not of an address.
      for (const path of ["/", "/fleet", "/board", "/config", "/nope"]) {
        const plan = entryPlanFor(addressOf(path));
        const state = fullscreenReducer(fullscreenState(), { type: "present", occupant: OCCUPANT_A });
        assert.equal(state.status, FULLSCREEN_PRESENTING, `${path}: presenting works the same`);
        assert.deepEqual(entryPlanFor(addressOf(path)), plan, `${path}: and the address is untouched`);
      }
    },
  },

  // ======================================================================
  // Scenario: the presented occupant declares itself modal, traps focus, and hands focus back
  // ======================================================================
  {
    name: "shell-fullscreen/03 the presented occupant declares itself modal, traps focus, and hands focus back to the control that opened it (03 scenario 7)",
    async run() {
      const opened = { focused: 0, focus() { this.focused += 1; } };
      const presenting = fullscreenReducer(fullscreenState(), { type: "present", occupant: { ...OCCUPANT_A, opener: opened } });
      const presented = presentedStateModel(presenting);

      assert.equal(presented.role, "dialog");
      assert.equal(presented.ariaModal, true);
      assert.equal(presented.ariaLabel, OCCUPANT_A.label, "an `aria-label` naming the session");
      assert.equal(presented.focusTrapped, true);
      assert.equal(presented.restoreFocusTo, opened, "focus returns to the control that opened it, not to the document body");
      assert.equal(fullscreenReducer(presenting, { type: "escape" }).restoreFocusTo, opened, "…and the dismissal carries it out of the transition");
      // The occupant sits on the ladder's `fullscreen` rung, ALONE (DG-45-2).
      assert.equal(presented.rung, "fullscreen");
      assert.equal(presented.z, Z_LADDER.fullscreen);
      assert.equal(presentedStateModel(fullscreenState()), null, "nothing is declared while nothing is presented");

      // …and the REAL shell renders those declarations, and really calls the opener's `focus`
      // on dismissal.
      await withShellApp({ routeId: "board", address: addressOf("/board#42/03"), identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        const opener = { focused: 0, focus() { this.focused += 1; } };
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty");
        assert.equal(app.row("top-bar") !== null, true, "the chrome stands before");

        await app.present({ id: "session-a", label: "Session 42/03 on aof-mac", node: null, home: null, opener });
        const overlay = app.fullscreen();
        assert.equal(overlay.props["data-shell-fullscreen"], "presenting");
        assert.equal(overlay.props.role, "dialog");
        assert.equal(overlay.props["aria-modal"], true);
        assert.equal(overlay.props["aria-label"], "Session 42/03 on aof-mac");
        assert.equal(overlay.props.style.zIndex, Z_LADDER.fullscreen, "on the ladder's top rung, taken from the ladder rather than retyped");
        // The chrome is HIDDEN, not overlaid.
        assert.equal(app.row("top-bar"), null, "the top bar is gone while an occupant is presented");
        assert.equal(app.chromeHeight(), "0px", "…so the published chrome height is 0 and the occupant gets the whole viewport");

        await app.dismissFullscreen("session-a");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty");
        assert.equal(app.row("top-bar") !== null, true, "the chrome comes back");
        assert.equal(opener.focused, 1, "focus was handed back to the control that opened it, exactly once");
      });
    },
  },

  // ======================================================================
  // Scenario: every presented state carries a visible way out, anchored where the way in was
  // ======================================================================
  {
    name: "shell-fullscreen/03 every presented state carries a VISIBLE way out, anchored where the way in was, and `Esc` dismisses the same state to the same result (03 scenario 8)",
    async run() {
      const presenting = fullscreenReducer(fullscreenState(), { type: "present", occupant: OCCUPANT_A });
      const presented = presentedStateModel(presenting);

      // A presented state with no visible dismiss is unreachable: the model yields the control
      // with the state, not beside it.
      assert.equal(presented.exitControl.visible, true);
      // …at the same `ml-auto` anchor as the control that entered fullscreen, so the eye does
      // not have to search for the way out.
      assert.equal(presented.exitControl.anchor, "ml-auto");

      // `Esc` dismisses the SAME state the control dismisses, to the same result.
      const viaEscape = fullscreenReducer(presenting, { type: "escape" });
      const viaControl = fullscreenReducer(presenting, { type: "dismiss", via: "control" });
      assert.equal(viaEscape.status, viaControl.status);
      assert.equal(viaEscape.occupants, viaControl.occupants);
      assert.equal(viaEscape.chrome, viaControl.chrome);
      assert.deepEqual({ ...viaEscape, dismissedVia: null }, { ...viaControl, dismissedVia: null }, "the same result by either route, differing only in which route it was");
      assert.equal(viaEscape.dismissedVia, "escape");
      assert.equal(viaControl.dismissedVia, "control");

      // NEITHER ROUTE IS THE ONLY ONE: removing either would leave the other as a single point
      // of escape — and for an occupant that has CLAIMED `Escape` the visible control is
      // already the only remaining exit, which is exactly why it is non-negotiable.
      const claiming = fullscreenReducer(fullscreenState(), { type: "present", occupant: { ...OCCUPANT_A, claimsEscape: true } });
      assert.equal(presentedStateModel(claiming).exitControl.visible, true);
      assert.equal(presentedStateModel(claiming).escapeDismisses, false);
      assert.equal(presentedStateModel(presenting).escapeDismisses, true);

      await withShellApp({ routeId: "board", address: addressOf("/board"), identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        await app.present({ id: "session-a", label: "Session 42/03", node: null, home: null });
        const exit = findAll(app.fullscreen(), (node) => node.type === "button")[0];
        assert.ok(exit, "the presented state carries a visible exit control");
        assert.match(exit.props.className, /ml-auto/, "…at the same anchor position as the way in");
        assert.match(textOf(exit), /Exit fullscreen/);
        exit.props.onClick();
        await app.flush();
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty", "and it really dismisses");
      });
    },
  },

  // ======================================================================
  // Scenario: a dismiss aimed at an occupant that is not the one presented is a no-op
  // ======================================================================
  {
    name: "shell-fullscreen/03 a dismiss aimed at an occupant that is NOT the one presented is a NO-OP — the stale dismisser cannot tear down its successor (03 scenario 5, the stale-dismisser row)",
    async run() {
      // THE SHAPE, and it is m46's rather than a hypothetical. Occupants never stack: a second
      // request REPLACES the first. So the moment a second terminal is presented, the first
      // terminal's component is still holding the dismiss function `requestFullscreen` handed
      // it — closed over an id that is no longer on screen. It fires on unmount, on a socket
      // close, on a stray click.
      const presentingA = fullscreenReducer(fullscreenState(), { type: "present", occupant: OCCUPANT_A });
      const presentingB = fullscreenReducer(presentingA, { type: "present", occupant: OCCUPANT_B });
      assert.equal(presentingB.occupant.id, "session-b", "the second request replaced the first");

      const stale = fullscreenReducer(presentingB, { type: "dismiss", id: "session-a", via: "control" });
      assert.equal(stale.status, FULLSCREEN_PRESENTING, "session-a's stale dismiss changes nothing");
      assert.equal(stale.occupant.id, "session-b", "…session-b is still presented");
      assert.equal(stale.layoutTick, presentingB.layoutTick, "…no layout tick fires");
      assert.equal(stale.changed, false);
      assert.equal(Object.hasOwn(stale, "dismissedVia"), false, "…and nothing was dismissed");
      // It is EXACTLY as harmless as dismissing an empty slot — same answer, same no-op.
      const empty = fullscreenState();
      assert.equal(fullscreenReducer(empty, { type: "dismiss", id: "session-a" }).status, FULLSCREEN_EMPTY);
      assert.equal(fullscreenReducer(empty, { type: "dismiss", id: "session-a" }).layoutTick, empty.layoutTick);

      // The MATCHING dismiss still works, and an id-LESS one still targets whatever is
      // presented — which is what the key and the shell's own exit control pass, correctly:
      // both are properties of the presented state, not of a caller that could go stale.
      assert.equal(fullscreenReducer(presentingB, { type: "dismiss", id: "session-b", via: "control" }).status, FULLSCREEN_EMPTY, "its OWN id dismisses it");
      assert.equal(fullscreenReducer(presentingB, { type: "dismiss", via: "control" }).status, FULLSCREEN_EMPTY, "…and an id-less dismiss targets whatever is presented");
      assert.equal(fullscreenReducer(presentingB, { type: "escape" }).status, FULLSCREEN_EMPTY, "…as does `Esc`");

      // …and the REAL shell honours it through the REAL bus door, which is where the guard
      // actually has to live: the machine having it and the component dropping the id would be
      // a guard that never runs.
      await withShellApp({ routeId: "board", address: addressOf("/board"), identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        const openerA = { focused: 0, focus() { this.focused += 1; } };
        const openerB = { focused: 0, focus() { this.focused += 1; } };
        await app.present({ id: "session-a", label: "Session 42/03", node: null, home: null, opener: openerA });
        await app.present({ id: "session-b", label: "Session 44/01", node: null, home: null, opener: openerB });
        assert.equal(app.fullscreen().props["aria-label"], "Session 44/01", "the second occupant replaced the first");

        // The first terminal's stale dismisser fires.
        await app.dismissFullscreen("session-a");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "presenting", "…and session-b is untouched");
        assert.equal(app.fullscreen().props["aria-label"], "Session 44/01");
        assert.equal(app.row("top-bar"), null, "the chrome is still hidden — nothing was torn down");
        assert.equal(openerB.focused, 0, "…and focus was not yanked back to session-b's opener");

        // Its own dismisser still works.
        await app.dismissFullscreen("session-b");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty");
        assert.ok(app.row("top-bar"), "the chrome comes back");
      });
    },
  },

  // ======================================================================
  // Scenario: the occupant goes HOME on dismissal, and a layout tick fires on BOTH transitions
  // ======================================================================
  {
    name: "shell-fullscreen/03 the shell returns the SAME node to its home on dismissal and emits a layout tick on BOTH transitions — through the real shell, not the machine (03 scenario 5, [Build-1])",
    async run() {
      await withShellApp({ routeId: "board", address: addressOf("/board"), identity: "aof", viewportWidth: 1280, surface: "plain" }, async (app) => {
        // A SENTINEL node and a sentinel home. What is being measured is the shell's own
        // teardown contract — that the occupant is handed BACK, once, and that it is the very
        // object that was handed over. The ADOPTION half (appendChild INTO the overlay) needs
        // a real DOM and belongs to m46, where a real xterm and a real socket exist to survive
        // the transition; faking a DOM here would prove the fake, not the shell.
        const node = { id: "the-live-node" };
        const adopted = [];
        const home = { appendChild: (child) => adopted.push(child) };
        const layouts = [];
        const opener = { focused: 0, focus() { this.focused += 1; } };

        await app.present({ id: "session-a", label: "Session 42/03", node, home, opener, onLayout: () => layouts.push("tick") });
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "presenting");
        // A tick on PRESENT: an occupant is not laid out on the tick it is presented, so a
        // surface that sizes itself to its box must be told to re-measure.
        assert.equal(layouts.length, 1, "one layout tick on present");
        assert.deepEqual(adopted, [], "…and nothing has gone home yet — it is on screen");
        // The overlay's adoption HOST is a dedicated, React-childless element: the adopted node
        // and React's own children must not share a parent, or React's position-based
        // reconciliation and an imperative `appendChild` end up fighting over the same slot
        // (m46's dock is the named next occupant of this region).
        const host = app.fullscreenHost();
        assert.ok(host, "the overlay carries a dedicated adoption host");
        assert.deepEqual(host.children, [], "…and React renders NOTHING into it");
        assert.notEqual(host, app.fullscreen(), "…it is not the overlay itself");

        await app.dismissFullscreen("session-a");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty");
        // THE RETURN. The same object, exactly once — not a copy, not twice, not never.
        assert.equal(adopted.length, 1, "the occupant went home exactly once");
        assert.equal(adopted[0], node, "…and it is the SAME node, not a re-created one");
        // …and a tick on DISMISS, because the box changes back.
        assert.equal(layouts.length, 2, "a second layout tick on dismiss");
        assert.equal(opener.focused, 1, "focus returned to the control that opened it, exactly once");
      });
    },
  },

  // ======================================================================
  // Scenario: `Esc` through the REAL shell, and the occupant that claims it
  // ======================================================================
  {
    name: "shell-fullscreen/03 `Esc` dismisses through the REAL shell's own document listener, an occupant that CLAIMS it keeps it, and the visible control is still the way out (03 scenario 8)",
    async run() {
      const base = { routeId: "board", address: addressOf("/board"), identity: "aof", viewportWidth: 1280, surface: "plain" };

      // THE ORDINARY OCCUPANT. `Esc` is the shell's by default, and the listener is on the
      // DOCUMENT because the whole point is that the key works wherever focus happens to be —
      // which is why this can only be driven through the real component and not by calling the
      // reducer (STATE.md F-38.06e: "a state satisfied by calling the reducer directly proved
      // nothing, because production could never drive it").
      await withShellApp(base, async (app) => {
        const opener = { focused: 0, focus() { this.focused += 1; } };
        await app.present({ id: "session-a", label: "Session 42/03", node: null, home: null, opener });
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "presenting");
        assert.equal(app.document().listenerCount("keydown"), 1, "the shell listens for the key on the document, exactly once");

        await app.press("Escape");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty", "`Esc` empties the slot");
        assert.ok(app.row("top-bar"), "…the chrome comes back");
        assert.equal(opener.focused, 1, "…and focus goes back to the control that opened it");
        // The listener is REMOVED with the presented state — a document listener that outlives
        // its state is how a later `Esc` dismisses something that is not there.
        assert.equal(app.document().listenerCount("keydown"), 0);

        // …and with nothing presented, `Esc` does nothing at all.
        await app.press("Escape");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty");
      });

      // THE CLAIMING OCCUPANT ([Build-2]). m46's terminal forwards stdin, so `Esc` is a live
      // keystroke for the `claude` TUI on the far end; a shell that swallowed it would make the
      // one key a TUI needs most mean "leave".
      await withShellApp(base, async (app) => {
        const opener = { focused: 0, focus() { this.focused += 1; } };
        await app.present({ id: "session-a", label: "Session 42/03", node: null, home: null, opener, claimsEscape: true });
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "presenting");

        // Every keystroke, not just the first — this is the path that fires per key in m46.
        for (let press = 0; press < 3; press += 1) await app.press("Escape");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "presenting", "the occupant claimed `Escape`, so the shell does not take it");
        assert.equal(app.row("top-bar"), null, "…the chrome is still hidden");
        assert.equal(opener.focused, 0, "…and focus has not moved");

        // THE VISIBLE CONTROL IS STILL THE WAY OUT, and for a claiming occupant it is the ONLY
        // one — which is exactly why it is non-negotiable.
        const exit = findAll(app.fullscreen(), (node) => node.type === "button")[0];
        assert.ok(exit, "the presented state still carries its visible exit");
        exit.props.onClick();
        await app.flush();
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "empty", "…and it really dismisses");
        assert.equal(opener.focused, 1);
      });

      // A key that is neither `Escape` nor `Tab` is ignored: the shell's listener reports one
      // key and traps another, and touches nothing else.
      await withShellApp(base, async (app) => {
        await app.present({ id: "session-a", label: "Session 42/03", node: null, home: null });
        await app.press("a");
        await app.press("Enter");
        assert.equal(app.fullscreen().props["data-shell-fullscreen"], "presenting");
      });
    },
  },

  // ======================================================================
  // Scenario: a transition that changes nothing yields the SAME state object
  // ======================================================================
  {
    name: "shell-fullscreen/03 a transition that changes nothing yields the SAME state object — a no-change path must not look like a change (03 scenario 5)",
    run() {
      // Object identity is how every React store decides whether to re-render, so a no-op that
      // allocates a fresh state is a no-op that costs a render. The path that matters is the
      // CLAIMED `Escape`: in m46 it fires on every keystroke a TUI receives.
      const empty = fullscreenState();
      assert.equal(fullscreenReducer(empty, { type: "dismiss" }), empty, "dismissing an empty slot returns the very same state");
      assert.equal(fullscreenReducer(empty, { type: "escape" }), empty, "…as does `Esc` with nothing presented");
      assert.equal(fullscreenReducer(empty, { type: "popstate" }), empty, "…and an action the machine does not name");
      assert.equal(fullscreenReducer(empty, { type: "present", occupant: { id: "" } }), empty, "…and a present with no usable occupant");

      const claiming = fullscreenReducer(fullscreenState(), { type: "present", occupant: { ...OCCUPANT_A, claimsEscape: true } });
      const first = fullscreenReducer(claiming, { type: "escape" });
      assert.equal(first.status, FULLSCREEN_PRESENTING, "the claim is honoured…");
      assert.equal(first.escapeClaimedByOccupant, true, "…and reported…");
      assert.equal(first.changed, false, "…as a non-change");
      // EVERY SUBSEQUENT keystroke is the same object — no allocation, no re-render.
      const second = fullscreenReducer(first, { type: "escape" });
      assert.equal(second, first, "the second `Esc` yields the SAME object");
      assert.equal(fullscreenReducer(second, { type: "escape" }), first, "…and so does the third");
      // The stale dismisser is on the same path, and it fires on unmount in m46.
      const presenting = fullscreenReducer(fullscreenState(), { type: "present", occupant: OCCUPANT_A });
      const settled = fullscreenReducer(presenting, { type: "dismiss", id: "session-b" });
      assert.equal(fullscreenReducer(settled, { type: "dismiss", id: "session-b" }), settled, "a repeated stale dismiss allocates nothing");
      // None of that loses the state: it is still the same occupant, still presented.
      assert.equal(settled.occupant, presenting.occupant);
      assert.equal(settled.status, FULLSCREEN_PRESENTING);
      // …and a REAL transition still yields a new value, or nothing would ever re-render.
      assert.notEqual(fullscreenReducer(presenting, { type: "escape" }), presenting);
    },
  },
];

// Everything left of the surface slot, as one comparable value read off the RENDERED bar.
function barSignature(app) {
  const bar = app.row("top-bar");
  return {
    mark: findAll(bar, (node) => node.props?.["aria-hidden"] === "true" && textOf(node) === "✦").length,
    wordmark: findAll(bar, (node) => textOf(node) === "aof").length,
    chip: findAll(bar, (node) => typeof node.props?.title === "string" && node.props.className?.includes("mono")).map((node) => node.props.title),
    dividers: findAll(bar, (node) => node.props?.className === "h-4 w-px bg-border").length,
    navLabels: findAll(bar, (node) => typeof node.props?.["data-nav-item"] === "string").map((node) => textOf(node)),
  };
}

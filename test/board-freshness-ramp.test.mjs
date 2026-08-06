// Traceability wiring for milestone 43 / story 04 / task 03 —
// tasks/03_freshness-ramp-and-stale-badge.feature (@executable).
//
// DRIVEN TWO WAYS, exactly as the task's LITMUS requires:
//   1. the PURE ramp module (ui/src/board/freshness.mjs) for its return value
//      over injected inputs — the state, both renderings, the tooltip sentence;
//   2. the REAL, UNMODIFIED production <Board/> tree, mounted headlessly against
//      a REAL board face (src/board-ui.mjs) over an isolated global store, on a
//      CONTROLLABLE clock that owns `Date.now()`. Element text, `className`
//      tokens, attributes, sibling ORDER and THE COUNT OF FETCHES THE APP MADE
//      are all read off that rendered tree and the app's own traffic. No source
//      read anywhere in this file.
//
// WHY BOTH, AND WHY THE SECOND ONE MATTERS MORE. The F-38.06e lesson: "a state
// satisfied by calling the reducer directly proved nothing, because production
// could never drive it." A ramp module that emits `◌ stale · 12m ago` proves
// nothing about whether the board paints it, where it paints it, or whether it
// paints it WITHOUT a network round trip — which is the whole of AC 8.
//
// THE ZERO-NETWORK CLAUSE IS THE LOAD-BEARING ONE. The board only re-polls its
// list while something is EXECUTING, so a settled stale item — the common case,
// since a row is stale precisely because its owner stopped reporting — would
// never grow a badge if the crossing were fetch-driven. Counting the app's own
// requests across the crossing is what distinguishes "computed off the clock"
// from "computed off a fetch that happened to land".
//
// PIXEL facts (does the chip's right edge really not move; does the ramp read as
// degraded rather than broken; does the pinned form actually fit the 360px fleet
// card) are NOT claimed here — they are task 09's `@uat` render verdict, exactly
// as m38's DG-13 lanes split.
//
// ── TWO THINGS THIS FILE RECORDS RATHER THAN PAPERS OVER ────────────────────
//
// DEV-1 (raised, and now RESOLVED IN THE CONTRACT). The first Examples row of
// the three-states outline used to state `4 seconds before now` → `synced 4s
// ago`. The same scenario's own note says those words are the product's ONE
// `relativeTime` formatter's words, "not this ramp's" — and that formatter
// renders any span under five seconds as `just now` (runs.mjs), so the two could
// not both hold. The PO corrected the CELL rather than the code (2026-08-03):
// the row now reads `10 seconds before now` → `synced 10s ago`, which keeps the
// row's subject (a seconds-grain fresh age) with no second time vocabulary. This
// lane follows the corrected cell.
//
// DEV-2 (raised as blocked; now CLOSED on both halves, and the second half was
// closed by the CONTRACT moving rather than by the code). The fourth Examples row
// of the forms outline used to render the MINIMAL form on the FLEET milestone
// card at its narrowest.
//   - The WIRE half is CLOSED: `/api/mesh/status` now carries the same two
//     per-row keys and the same `stalenessSeconds` as the board's envelope, so a
//     fleet card CAN be fed a stale row and the badge mounts for real. Task 04's
//     lane does exactly that against the real fleet face.
//   - The FORM-SELECTION half was raised as an unassertable PIXEL fact ("which of
//     the three forms a 360px card picks is a width decision; the rendered
//     element tree has no width"). DESIGN WITHDREW the viewport-keyed ladder
//     outright on 2026-08-03, because it was keyed to the wrong variable: the
//     fleet grid is `repeat(auto-fill, minmax(320px, 1fr))`, so it adds COLUMNS
//     rather than width and the card sits in a ~300–370px band at EVERY
//     breakpoint — it is NARROWER at 2560 than at 1280. The binding rule is now
//     "the form is chosen by the SURFACE, not by the viewport", and the PO
//     corrected the cell to `short` at all widths. That makes the row ASSERTABLE
//     here, and the forms lane below now mounts the real <Fleet/> and reads it —
//     the flag's own condition ("if the yield is wanted as behaviour") answered
//     by removing the yield rather than by inventing a budget number.
// The ramp's minimal RENDERING is asserted here and its a11y contract in task 08;
// `minimal` is RESERVED with no painter in this milestone.
import assert from "node:assert/strict";
import { isStale } from "../src/run-store.mjs";
import { cacheFreshness } from "../src/cache-provenance.mjs";
import {
  BADGE_FORMS,
  FRESHNESS_GLYPH,
  badgeText,
  freshness,
  freshnessState,
  isCachePublished,
  readStalenessWindow,
} from "../ui/src/board/freshness.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp, BOARD_EPOCH, findAll, visibleTextOf, isBadgeNode } from "./support/board-app-harness.mjs";
import { withPublishedAssignFixture } from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";

// The window the whole feature is written against (Background: `stalenessSeconds`
// = 300). It is stated ONCE here, put on the wire by the fixture, and read back
// off the envelope by the app — never defaulted in `ui/`.
const WINDOW = 300;
const NODE = "umairs-mac-mini";

// An instant relative to the mounted app's own wall clock, usable BEFORE the app
// mounts (seeding the face is the Given, so it happens first).
const at = (secondsFromNow) => new Date(BOARD_EPOCH + secondsFromNow * 1000).toISOString();

// The whole workspace reported by one node at one instant, through the REAL
// publisher into the REAL store (see board-face-fixture.mjs's producer-fed note).
const reportedAt = (face, seconds, node = NODE) => face.reportedBy(node, at(seconds));

export const boardFreshnessRampTests = [
  // ══ Scenario Outline: the ramp turns facts + an injected `now` into one of
  //    exactly three states, and only `stale` earns a mark ══
  {
    name: "board-freshness-ramp/03 the ramp module turns the wire's facts and an injected `now` into one of exactly three states, and only `stale` earns a mark",
    run: async () => {
      const now = BOARD_EPOCH;
      const rows = [
        // case, syncedAt, state, badge, label
        ["freshly reported", at(-10), "fresh", null, `synced 10s ago · from ${NODE}`],
        ["inside the window", at(-120), "fresh", null, `synced 2m ago · from ${NODE}`],
        ["past the window", at(-720), "stale", `${FRESHNESS_GLYPH} stale · 12m ago`, `stale · synced 12m ago · from ${NODE}`],
        ["never stamped", null, "unknown", null, `synced time unknown · from ${NODE}`],
      ];
      for (const [label, syncedAt, state, badge, line] of rows) {
        const view = freshness({ syncedAt, reportedBy: NODE }, { now, windowSeconds: WINDOW });
        assert.equal(view.state, state, `${label}: the state`);
        assert.equal(badgeText(view, "full"), badge, `${label}: the badge rendering`);
        assert.equal(view.label, line, `${label}: the provenance-label rendering`);
      }
      // `unknown` renders NO badge and an explicit words-form label: a fact slot
      // degrades to "unknown", an ASSERTION is withheld. It is NEVER `stale`.
      const missing = freshness({ syncedAt: null, reportedBy: NODE }, { now, windowSeconds: WINDOW });
      assert.notEqual(missing.state, "stale", "a missing instant is never rendered as stale");
      assert.equal(missing.badge, null, "…and never earns a mark");
      // A FUTURE instant is a copy from ahead of this clock, not an old copy.
      assert.equal(freshness({ syncedAt: at(60), reportedBy: NODE }, { now, windowSeconds: WINDOW }).state, "fresh");
    },
  },

  // ══ Scenario Outline: the client ramp uses strict `>` and returns the SAME
  //    verdict as the server's shared predicate at the threshold instant ══
  {
    name: "board-freshness-ramp/03 the client ramp uses strict `>` and returns the SAME verdict as the server's shared predicate at the threshold instant — 299 / EXACTLY 300 / 301",
    run: async () => {
      const now = BOARD_EPOCH;
      const rows = [
        ["one second under", 299, "fresh"],
        ["EXACTLY at the window", 300, "fresh"],
        ["one second over", 301, "stale"],
      ];
      for (const [label, age, state] of rows) {
        const syncedAt = at(-age);
        const client = freshnessState(syncedAt, now, WINDOW);
        // `src/`'s ONE predicate (run-store.mjs's isStale, re-exposed as
        // isNodeStale), called over the STORAGE column the wire's `syncedAt` is
        // mapped from — the same shape the cache read boundary uses.
        const server = isStale({ updatedAt: syncedAt }, now, WINDOW * 1000) ? "stale" : "fresh";
        assert.equal(client, state, `${label}: the client's state`);
        assert.equal(server, state, `${label}: the server's verdict is the same state`);
        assert.equal(client, server, `${label}: the two never disagree at this point`);
      }
      // The disagreement this pins out: the forbidden `>=` form differs from the
      // real predicate at exactly the threshold instant, and nowhere else.
      const atWindow = at(-300);
      const forbiddenGte = now - Date.parse(atWindow) >= WINDOW * 1000;
      assert.notEqual(forbiddenGte, freshnessState(atWindow, now, WINDOW) === "stale", "strict `>` and `>=` disagree AT the window — which is why the ramp is `>`");
    },
  },

  // ══ AC 4, the same claim over the OTHER argument: the two DEFINITIONS OF
  //    RECORD agree about a window they cannot use, not only about an instant ══
  //
  // The lane above compares `ui/`'s ramp to the SHARED PREDICATE (`isStale`).
  // That is the comparison the threshold instant needs, but it is not the whole
  // of AC 4: `src/` states its own verdict through `cacheFreshness`
  // (src/cache-provenance.mjs), which is the function a future server-side reader
  // reaches for and the one whose header claims to state the shape the browser
  // must agree with. Comparing the ramp only to `isStale` leaves the two
  // DEFINITIONS unchecked against each other, and they diverged: measured
  // 2026-08-03, they agreed on all ten INSTANT shapes and disagreed on all three
  // WINDOW shapes, because `cacheFreshness` substituted the documented default
  // for a window it had not been given while the ramp answered `unknown`.
  //
  // Not user-visible then (ADR-014/E8: `cacheFreshness` has no production caller),
  // and pinned here precisely because of that — the first server-side reader to
  // call it without a window is the one who would have found it, and by then the
  // two surfaces would already be saying different things about one row.
  {
    name: "board-freshness-ramp/03 the two DEFINITIONS OF RECORD agree on every shape — `src`'s cacheFreshness and `ui`'s freshnessState return the same verdict for each instant AND for each way the window can fail to arrive, which is the disagreement that made this a defect rather than a variant",
    run: async () => {
      const now = BOARD_EPOCH;
      // Every shape either side can be handed: the ten INSTANT shapes (including
      // the threshold triple and a zero window, which is falsy and is the classic
      // way a real window silently reads as "unset" on one side only), then the
      // three WINDOW shapes — absent, negative, NaN.
      const shapes = [
        ["299s old, window 300", at(-299), WINDOW, "fresh"],
        ["EXACTLY 300s old, window 300", at(-300), WINDOW, "fresh"],
        ["301s old, window 300", at(-301), WINDOW, "stale"],
        ["1s old, window 0", at(-1), 0, "stale"],
        ["0s old, window 0", at(0), 0, "fresh"],
        ["a future instant", at(120), WINDOW, "fresh"],
        ["the epoch", "1970-01-01T00:00:00.000Z", WINDOW, "stale"],
        ["an empty string", "", WINDOW, "unknown"],
        ["unparseable text", "sometime last tuesday", WINDOW, "unknown"],
        ["null", null, WINDOW, "unknown"],
        // ── the three WINDOW shapes, which is where they used to differ ──
        ["window ABSENT (undefined)", at(-720), undefined, "unknown"],
        ["window NEGATIVE (-1)", at(-720), -1, "unknown"],
        ["window NaN", at(-720), Number.NaN, "unknown"],
      ];
      for (const [label, syncedAt, windowSeconds, state] of shapes) {
        const server = cacheFreshness({ syncedAt }, { nowMs: now, stalenessSeconds: windowSeconds });
        const client = freshnessState(syncedAt, now, windowSeconds);
        assert.equal(server, state, `${label}: \`src\`'s definition of record`);
        assert.equal(client, state, `${label}: \`ui\`'s definition of record`);
        assert.equal(server, client, `${label}: the two definitions of record never disagree`);
      }
      // …and a window that DID arrive is still judged against, `0` included. The
      // fallback that left the VERDICT is not the CONFIG-level one: resolving a
      // meaningless configured value to the documented default — while honouring
      // an aggressive-but-meaningful zero — is a different layer and is unchanged,
      // pinned end to end by `staleness/01`'s four configured-window lanes.
      assert.equal(cacheFreshness({ syncedAt: at(-1) }, { nowMs: now, stalenessSeconds: 0 }), "stale", "a CONFIGURED zero window is honoured, not treated as unset");
      assert.notEqual(cacheFreshness({ syncedAt: at(-720) }, { nowMs: now }), "stale", "…while a window that never arrived yields no verdict at all — never a degraded mark on the strength of our own missing configuration");
    },
  },

  // ══ Scenario: the badge appears within one second of the crossing, driven by
  //    the cosmetic tick, with NO network request ══
  {
    name: "board-freshness-ramp/03 the badge appears within ONE SECOND of the crossing, driven by the cosmetic tick, with ZERO additional requests — and no new polling cadence is started",
    run: async () => {
      await withBoardFace(async (face) => {
        // A SETTLED item: nothing is executing, so the board schedules no list
        // poll at all — which is exactly why the crossing must be clock-driven.
        await reportedAt(face, -299);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.badges().length, 0, "one second under the window the row carries no badge anywhere");

          const before = app.requests().length;
          const listsBefore = app.requestsMatching("/api/work/list").length;

          // One tick: the row is now EXACTLY at the window, which is still FRESH
          // (strict `>`), so the surface must still say nothing.
          await app.advance(1000);
          assert.equal(app.badges().length, 0, "EXACTLY at the window is fresh — the badge has not appeared yet");

          // The next tick crosses it.
          await app.advance(1000);
          const badge = app.detail().badge;
          assert.ok(badge, "the badge is present in the rendered tree");
          assert.equal(badge.text, `${FRESHNESS_GLYPH} stale · 5m ago`, "…reading the full form");

          assert.equal(app.requests().length, before, "the app made ZERO additional requests across the crossing — no list fetch, no doc fetch, no probe");
          assert.equal(app.requestsMatching("/api/work/list").length, listsBefore, "…and in particular no list fetch");

          // The age on the provenance line continued counting on the SAME tick,
          // gaining its `stale ·` prefix in that tick.
          assert.equal(app.detail().provenanceLine, `stale · synced 5m ago · from ${NODE}`);

          // No new polling cadence was started: over the following minute the app
          // makes exactly the requests it would have made anyway — the lane-card
          // run-status probe, on its own pre-existing 5s cadence and nothing else.
          const mark = app.requests().length;
          await app.advance(60_000);
          const after = app.requests().slice(mark);
          assert.ok(after.length > 0, "the minute is not vacuous — the pre-existing probe did keep polling");
          assert.deepEqual(
            [...new Set(after.map((entry) => new URL(entry.url).pathname))],
            ["/api/work/run-status"],
            "the only traffic over the minute is the pre-existing run-status probe — no list fetch, no doc fetch, no probe of its own",
          );
          const rounds = [...new Set(after.map((entry) => entry.at))].sort((a, b) => a - b);
          const gaps = [...new Set(rounds.slice(1).map((value, index) => value - rounds[index]))];
          assert.deepEqual(gaps, [5000], `every poll round is exactly one probe interval apart — no second cadence (rounds at ${rounds.join(", ")})`);
        });
      });
    },
  },

  // ══ Scenario: at the threshold the badge enters the cluster to the LEFT of the
  //    status chip, which keeps its right-edge anchor ══
  {
    name: "board-freshness-ramp/03 at the threshold the badge enters the header cluster immediately BEFORE the status chip, the chip keeps its right-edge anchor, and nothing else on the row changes",
    run: async () => {
      await withBoardFace(async (face) => {
        await reportedAt(face, -299);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const before = app.detail();
          const beforeChildren = before.row1Children;
          const beforeMotion = app.motionClasses();
          assert.equal(before.badge, null, "one second under the window there is no badge");
          assert.equal(app.alerts().length, 0);

          await app.advance(2000);

          const after = app.detail();
          const cluster = after.clusterChildren;
          assert.equal(cluster.length, 2, "the row-1 cluster holds exactly the badge and the status chip");
          assert.ok(after.badge, "the badge is in the cluster");
          assert.equal(cluster[0], after.badge.node, "the badge is the sibling immediately BEFORE the status chip, in DOM order");
          assert.equal(cluster[1], after.statusChip, "…and the status chip follows it");
          assert.ok(
            String(after.cluster.props.className).includes("ml-auto"),
            "the `ml-auto` anchor is carried by the CLUSTER, so the status chip is still the last, right-anchored element of the row",
          );

          // The ring, the mono ref and the type chip are untouched — same text,
          // same classes, same order.
          assert.deepEqual(after.row1Children.slice(0, 3), beforeChildren.slice(0, 3), "the ring, the mono ref and the type chip are unchanged");
          assert.equal(after.title, before.title, "the title is unchanged");
          assert.equal(
            after.row1Children[3].className,
            beforeChildren[3].className,
            "the cluster itself keeps its class set — only its membership grew",
          );
          const chipOf = (detail) => ({ className: detail.statusChip.props.className, text: detail.statusChip.children.map(String).join("") });
          assert.deepEqual(chipOf(after), chipOf(before), "the status chip is byte-identical either side of the threshold");

          assert.deepEqual(app.motionClasses(), beforeMotion, "no element gained an animation, transition, pulse or shimmer class in the transition");
          assert.deepEqual(app.alerts(), [], "no toast, banner, dialog or page-level message appeared");
        });
      });
    },
  },

  // ══ Scenario Outline: the badge is always the `muted` degraded ramp — never
  //    `destructive`, whatever the item's own status is ══
  {
    name: "board-freshness-ramp/03 the badge is always the `muted` degraded ramp — never `destructive`, never `accent` — whatever the item's own status is, including a BLOCKED one",
    run: async () => {
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const rows = [
            ["an ordinary stale item", "43/04", "in-progress", false],
            ["a BLOCKED stale item", "43/05", "blocked", true],
            ["a done stale item", "43/03", "done", false],
          ];
          for (const [label, ref, status, ownsDestructive] of rows) {
            await app.selectCard(ref);
            const detail = app.detail();
            const badge = detail.badge;
            assert.ok(badge, `${label}: the stale badge renders`);
            assert.ok(badge.className.includes("text-muted-foreground"), `${label}: the badge carries the muted-foreground text token`);
            assert.ok(badge.className.includes("bg-transparent"), `${label}: …a transparent background`);
            assert.ok(
              badge.className.includes("border-dashed") && badge.className.includes("border-muted-foreground/45"),
              `${label}: …and a dashed muted-foreground/45 border`,
            );
            assert.ok(!badge.className.includes("destructive"), `${label}: the badge carries no destructive token`);
            assert.ok(!badge.className.includes("accent"), `${label}: …and no accent token`);

            // The `destructive` token on that item, if present at all, belongs to
            // the ITEM-STATUS ramp and to nothing else. In the header's row-1
            // cluster — the badge beside the chip — the claim is literal: only
            // the status chip may carry it. (The panel's StatusRing carries it
            // too for a blocked item; both come from the same status.tsx
            // `blocked` entry, so it is ONE vocabulary, not two.)
            const clusterDestructive = detail.clusterChildren.filter((node) => String(node.props?.className ?? "").includes("destructive"));
            assert.equal(
              clusterDestructive.length,
              ownsDestructive ? 1 : 0,
              `${label}: the destructive token in the cluster belongs to ${ownsDestructive ? "the status chip alone" : "nothing on the item"}`,
            );
            if (ownsDestructive) assert.equal(clusterDestructive[0], detail.statusChip, `${label}: …and that one element IS the status chip`);
            // Panel-wide (scoped to this item's header, so the blocked LANE's own
            // tint is not counted as a fact about the item), every
            // destructive-token element belongs to the item-status ramp painting
            // THIS item's status — never to the freshness ramp.
            const panelDestructive = app.destructiveNodes(detail.panel);
            assert.equal(
              panelDestructive.length > 0,
              status === "blocked",
              `${label}: the destructive token appears on the item's header only for a blocked item`,
            );
            assert.ok(
              // status.tsx's `blocked` entry paints exactly two things: the ring
              // (the bare `!` glyph) and the chip (`! blocked`). Both carry the
              // mark, which is what makes them one vocabulary rather than two.
              panelDestructive.every((node) => node.text.includes("!")),
              `${label}: …and every one of them is the status ramp speaking (${JSON.stringify(panelDestructive.map((node) => node.text))})`,
            );

            // Status outranks freshness: the badge's type is strictly below the
            // chip's (`text-[11px]` vs `text-xs`, i.e. 11px vs 12px).
            assert.ok(badge.className.includes("text-[11px]"), `${label}: the badge is text-[11px]`);
            assert.ok(String(detail.statusChip.props.className).includes("text-xs"), `${label}: the status chip is text-xs`);
          }
          // Two degraded facts on one card stay TWO vocabularies: the blocked
          // row's chip is destructive and its badge is muted, on the same panel.
          await app.selectCard("43/05");
          const blocked = app.detail();
          assert.ok(String(blocked.statusChip.props.className).includes("destructive"));
          assert.ok(blocked.badge.className.includes("muted-foreground"));
        });
      });
    },
  },

  // ══ Scenario Outline: the badge has exactly three forms, chosen by a yield
  //    order of whole drops, and never spends its width on a node id ══
  {
    name: "board-freshness-ramp/03 the badge has exactly three forms — full on the detail header and the overview card, short on the lane card and on the FLEET milestone card — and never spends its visible width on the reporting node's id",
    run: async () => {
      assert.deepEqual(BADGE_FORMS, ["full", "short", "minimal"], "there are exactly three forms, in their PRIORITY order (which outranks which when a surface must be pinned narrower) — not a runtime ladder");
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        await withBoardApp({ url: face.url }, async (app) => {
          // the overview milestone card — FULL
          const overview = app.overviewCard("43");
          assert.equal(overview.badge.text, `${FRESHNESS_GLYPH} stale · 12m ago`, "the overview card row 1 paints the full form");
          assertNamesNoNode(overview.badge);

          await app.openMilestone("43");

          // the detail panel header — FULL
          const detail = app.detail();
          assert.equal(detail.badge.text, `${FRESHNESS_GLYPH} stale · 12m ago`, "the detail panel header row 1 paints the full form");
          assertNamesNoNode(detail.badge);

          // the lane card meta line — SHORT
          const lane = app.laneCard("43/04");
          assert.equal(lane.badge.text, `${FRESHNESS_GLYPH} stale`, "the lane card meta line paints the short form");
          assertNamesNoNode(lane.badge);
          assert.ok(
            String(lane.badge.node.props.className).includes("shrink-0"),
            "the badge never shrinks — the yield is a discrete drop between whole forms, never a shrink factor",
          );
        });
      });

      // ── the FLEET milestone card — SHORT, at every width (the outline's fourth
      //    Examples row, as corrected 2026-08-03). It is asserted on the REAL
      //    mounted <Fleet/> over the real fleet face, so the form this card paints
      //    is PINNED rather than incidental: DESIGN's ruling is that the form is
      //    chosen by the SURFACE, so the only honest proof is the surface's own
      //    rendered element — and a rendered tree has no width to consult, which
      //    is precisely why this is now assertable at all.
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url, search: "?mode=fleet&scope=global" }, async (app) => {
          const cluster = findAll(app.tree(), (node) => typeof node.props?.className === "string"
            && node.props.className.includes("ml-auto")
            && node.props.className.includes("shrink-0")
            && findAll(node, isBadgeNode).length > 0)[0] ?? null;
          assert.ok(cluster, "the fleet milestone card's row-1 cluster carries a badge (non-vacuous: the fleet's own wire feeds a stale row)");
          const badge = findAll(cluster, isBadgeNode)[0];
          assert.equal(
            visibleTextOf(badge),
            `${FRESHNESS_GLYPH} stale`,
            "the fleet milestone card paints the SHORT form — at every width, because its width is viewport-invariant (auto-fill adds COLUMNS, so the card is narrower at 2560 than at 1280)",
          );
          assert.ok(
            !visibleTextOf(badge).includes("control-a"),
            "…and it still never spends its visible width on the reporting node's id",
          );
          assert.ok(
            String(badge.props.className).includes("shrink-0"),
            "…and it does not shrink — a form is a whole discrete choice, never a shrink factor",
          );
        });
      }, { nodes: ["worker-a"] });

      // The MINIMAL form's rendering, from the same one ramp. It is RESERVED and
      // unpainted in this milestone (DESIGN, 2026-08-03) — a rendering with a
      // binding `role="img"` + `aria-label` contract (task 08) rather than a rung
      // of a runtime ladder, so the ramp is where it is exercised.
      const view = freshness({ syncedAt: at(-720), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: WINDOW });
      assert.equal(badgeText(view, "minimal"), FRESHNESS_GLYPH, "the minimal form is the glyph alone");
      assert.ok(!badgeText(view, "minimal").includes(NODE));
      assert.ok(view.badge.title.includes(NODE) && view.badge.title.includes("12m ago") && view.badge.title.includes("5 minutes"));
    },
  },

  // ══ Scenario Outline: no badge is rendered unless the row is known to be stale ══
  {
    name: "board-freshness-ramp/03 no badge is rendered unless the row is KNOWN to be stale — not while loading, not on a non-mesh workspace, not for an unknown instant, not on a failed list, not for a fresh row, and never on a `uat` gate bar",
    run: async () => {
      // first load — the list request has not answered yet
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        const stall = face.stallList();
        await withBoardApp({ url: face.url, settle: "render" }, async (app) => {
          assert.equal(app.screen(), "loading", "the board is in its loading branch");
          assert.equal(app.badges().length, 0, "no stale badge appears anywhere");
          assert.ok(!app.tree() || app.badges().length === 0, "no skeleton badge and no placeholder pill stands in for one");
          stall.release();
          await app.flush();
          assert.ok(app.badges().length > 0, "…and the badges do arrive once the response does (non-vacuous)");
        });
      });

      // a workspace that is not mesh-enabled — the rows carry no provenance keys
      await withBoardFace(async (face) => {
        // Nothing is ever published, so the cache holds no rows for this
        // workspace and the face leaves every row BYTE-IDENTICAL — no provenance
        // keys at all, which is the wire's non-mesh shape.
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.badges().length, 0, "the board keeps its plain local default with no freshness vocabulary");
          assert.equal(app.detail().provenanceBox, null, "…and no provenance region at all");
        });
      });

      // an unknown instant — `syncedAt` is null
      await withBoardFace(async (face) => {
        // A row whose INSTANT was never stamped — `updated_at` reads NULL, while
        // the reporting node is still recorded. The row is 12 minutes old by any
        // other measure, and must still not be called stale.
        await reportedAt(face, -720);
        await face.forget("*", ["syncedAt"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.badges().length, 0, "an unknown instant earns no badge — it is never rendered as stale");
          assert.equal(app.detail().provenanceLine, `synced time unknown · from ${NODE}`, "the provenance line says so in words instead");
        });
      });

      // the list request errored
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        face.failListWith(500, "Board face refused the list");
        await withBoardApp({ url: face.url }, async (app) => {
          assert.equal(app.screen(), "error", "the existing page-level error line owns the failure, unchanged");
          assert.equal(app.badges().length, 0, "no stale badge appears anywhere");
        });
      });

      // a fresh row — 60 seconds old inside a 300s window
      await withBoardFace(async (face) => {
        await reportedAt(face, -60);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.badges().length, 0, "freshness is the norm and earns no mark");
          assert.equal(app.detail().provenanceLine, `synced 1m ago · from ${NODE}`, "…the age is stated on the provenance line only");
        });
      });

      // a `uat` gate bar — a local acceptance item with no cached provenance
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        await withBoardApp({ url: face.url }, async (app) => {
          const gate = app.gateBar("44");
          assert.ok(gate, "the acceptance gate bar renders (non-vacuous)");
          assert.equal(gate.badge, null, "gates are local acceptance items with no cached provenance — absent, not `fresh`");
        });
      });
    },
  },

  // ══ Scenario: the badge inside a lane card or an overview card is a
  //    non-interactive element, because the card itself is a button ══
  {
    name: "board-freshness-ramp/03 the badge inside a lane card or an overview card is NON-INTERACTIVE — the card is itself a `<button>` and stays a single focus stop",
    run: async () => {
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        await withBoardApp({ url: face.url }, async (app) => {
          const overview = app.overviewCard("43");
          await app.openMilestone("43");
          const lane = app.laneCard("43/04");

          for (const [label, card] of [["the overview milestone card", overview], ["the lane card", lane]]) {
            assert.equal(card.type, "button", `${label} is itself a <button>`);
            assert.ok(card.badge, `${label} carries the badge`);
            assert.equal(card.badge.node.type, "span", `${label}'s badge is a plain <span>`);
            assert.equal(card.badge.interactive, false, `${label}'s badge has no onClick, no tabindex, no href`);
            assert.equal(card.badge.role, null, `${label}'s badge takes no role — it is real text`);
            assert.equal(card.buttons.length, 0, `${label} nests no <button>`);
            assert.equal(card.links.length, 0, `${label} nests no <a> — it remains a single focus stop and a single activation target`);
          }
        });
      });
    },
  },

  // ══ Scenario: when a fresher copy lands the badge simply disappears and the
  //    age resets — with no flourish ══
  {
    name: "board-freshness-ramp/03 when a fresher copy lands the badge simply DISAPPEARS and the age resets — no toast, no banner, no highlight, no animation, and nothing else on the row changes",
    run: async () => {
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const before = app.detail();
          assert.equal(before.badge.text, `${FRESHNESS_GLYPH} stale · 12m ago`);
          assert.equal(before.provenanceLine, `stale · synced 12m ago · from ${NODE}`);
          const badgesBefore = app.badges().length;
          assert.ok(badgesBefore > 1, "the badge is showing on more than one surface (non-vacuous)");
          const motionBefore = app.motionClasses();

          // A list response arrives carrying a `syncedAt` of just now for that row
          // — through the app's OWN door (the top bar's `⟳ sync`), since a settled
          // board schedules no list poll of its own.
          await reportedAt(face, 0);
          await app.sync();

          assert.equal(app.badges().length, 0, "the badge is gone from every surface that showed it");
          const after = app.detail();
          assert.equal(after.provenanceLine, `synced just now · from ${NODE}`, "the provenance line resets, with no `stale ·` prefix");
          assert.deepEqual(app.alerts(), [], "no toast, no banner and no dialog appeared");
          assert.ok(!app.detail().text.includes("refreshed"), "no \"refreshed\" message appeared anywhere");
          assert.deepEqual(app.motionClasses(), motionBefore, "no highlight and no animation was added");
          assert.deepEqual(after.row1Children.slice(0, 3), before.row1Children.slice(0, 3), "no other element on the row changed");
          assert.equal(after.title, before.title);
        });
      });
    },
  },

  // ══ Background / AC 5 — the window comes off the wire, and `ui/` carries no
  //    default. The degrade is WORDS, never a guessed number. ══
  {
    name: "board-freshness-ramp/03 the window arrives on the list envelope and is read in ONE place — and when the wire does not carry it the ramp withholds the verdict rather than guessing a number",
    run: async () => {
      assert.equal(readStalenessWindow({ items: [], stalenessSeconds: 300 }), 300, "the configured window is read off the envelope");
      for (const [label, envelope] of [
        ["field absent", { items: [] }],
        ["explicit null", { items: [], stalenessSeconds: null }],
        ["non-numeric", { items: [], stalenessSeconds: "5m" }],
        ["not finite", { items: [], stalenessSeconds: Number.NaN }],
      ]) {
        assert.equal(readStalenessWindow(envelope), null, `${label}: the window is not known — and is never substituted`);
      }
      // With no window the verdict is UNKNOWABLE, so no badge may be asserted —
      // while the age itself, which IS known, is still stated.
      const view = freshness({ syncedAt: at(-720), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: null });
      assert.equal(view.state, "unknown");
      assert.equal(view.badge, null, "no window ⇒ no stale claim");
      assert.equal(view.label, `synced 12m ago · from ${NODE}`, "…but the age is still stated, because it is known");

      // …and the same holds end to end: the envelope omits the key, so the board
      // paints no badge on a row that is twelve minutes old.
      await withBoardFace(async (face) => {
        await reportedAt(face, -720);
        face.withdrawWindow();
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.badges().length, 0, "with no window on the wire the board makes no staleness claim");
          assert.equal(app.detail().provenanceLine, `synced 12m ago · from ${NODE}`);
        });
      });
    },
  },

  // ══ The per-workspace presence rule the whole ramp rests on ══
  {
    name: "board-freshness-ramp/03 cache-publication is read from the PRESENCE of the provenance keys, not their value — a null instant is a designed `unknown`, an absent pair is a non-mesh workspace",
    run: async () => {
      assert.equal(isCachePublished({ ref: "43/04", syncedAt: null, reportedBy: null }), true, "explicitly-present nulls ARE a cache-published row (the unknown state)");
      assert.equal(isCachePublished({ ref: "43/04" }), false, "an omitted pair is a workspace the cache does not publish");
      assert.equal(isCachePublished(null), false);
    },
  },
];

function assertNamesNoNode(badge) {
  assert.ok(!badge.text.includes(NODE), "the badge does not contain the reporting node's id in its visible text");
  assert.ok(badge.title.includes(NODE), "the full sentence naming the node is carried in the badge's `title`");
  assert.ok(/\d+[smhd] ago|just now|yesterday/.test(badge.title), "…with the age");
  assert.ok(badge.title.includes("5 minutes"), "…and the window");
  assert.ok(/ at .*\d/.test(badge.title), "…and the last-synced local time");
}

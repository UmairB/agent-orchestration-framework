// Traceability wiring for milestone 43 / story 04 / task 07 —
// tasks/07_freshness-legend-documents-the-window.feature (@executable).
//
// A new read-only vocabulary that is not in the legend is a vocabulary the
// operator must guess. Both legends gain a Freshness block painting the REAL
// badge beside its label, and the block states the window from the ONE number
// that arrives on the wire — degrading to WORDS, never to a guessed number, when
// the wire does not carry it.
//
// WHY THE DEGRADE MATTERS MORE THAN IT LOOKS. The threshold is configured ONCE in
// `src/` and travels on the response; `ui/` carries no default and no literal
// (that half is a structural ABSENCE and is asserted by
// `acd-cache-staleness-single-predicate`, not restated here). The consequence is
// that when the wire does not carry the number the UI genuinely does not know it
// — and the only honest legend row is one that names the window without
// quantifying it. A "5 minutes" fallback baked into the legend would be a SECOND
// threshold by another route: it would keep reading "5 minutes" long after an
// operator configured 30, and the operator would have no way to notice.
//
// THE LEGEND MUST MIRROR THE PAINTED RAMP 1:1 — the rule the board legend's own
// comment already states, and the reason m35's assignment block paints real chips
// rather than drawings. So the swatch is asserted to be the SAME component, with
// the SAME token set, as the badge the surface paints on a real stale item.
//
// Driven off the RENDERED TREES of the REAL <Board/> and the REAL <Fleet/>,
// mounted against their REAL faces. The window arrives by being CONFIGURED in the
// workspace's own `.aof/aof.config.json` and resolved by the face's own resolver
// — never injected into a response.
import assert from "node:assert/strict";
import { FRESHNESS_GLYPH } from "../ui/src/board/freshness.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp, BOARD_EPOCH, isBadgeNode } from "./support/board-app-harness.mjs";
import { withPublishedAssignFixture } from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp, findAll } from "./support/fleet-app-harness.mjs";
import { visibleTextOf } from "./support/mini-react.mjs";

const NODE = "umairs-mac-mini";
const at = (secondsFromNow) => new Date(BOARD_EPOCH + secondsFromNow * 1000).toISOString();

const STALE_ROW = `${FRESHNESS_GLYPH} stale —`;
const FRESH_ROW = "(no badge) — synced within the window";
const UNQUANTIFIED = `${FRESHNESS_GLYPH} stale — no fresh copy inside the staleness window`;

// The FLEET's legend is a CSS-hover popover, so its panel is always in the tree.
// Read the same three facts the board harness exposes, scoped to that panel.
function fleetLegend(app) {
  const panel = findAll(app.tree(), (node) => typeof node.props?.className === "string"
    && node.props.className.includes("bg-popover")
    && node.props.className.includes("group-hover:block"))[0] ?? null;
  if (!panel) return null;
  return {
    panel,
    headings: findAll(panel, (node) => typeof node.props?.className === "string"
      && node.props.className.includes("uppercase")
      && node.props.className.includes("tracking-wide")).map(visibleTextOf),
    rows: findAll(panel, (node) => typeof node.props?.className === "string"
      && node.props.className.includes("flex items-center gap-1.5")).map((node) => ({
      text: visibleTextOf(node),
      badge: findAll(node, isBadgeNode)[0] ?? null,
    })),
    badges: findAll(panel, isBadgeNode),
  };
}

export const boardFreshnessLegendTests = [
  // ══ Scenario Outline: each legend gains a Freshness block as its last
  //    section, painting the REAL badge beside its label ══
  {
    name: "board-freshness-legend/07 the BOARD legend gains a Freshness block as its LAST section — five status rows, a divider, then the block — painting the REAL badge component beside its label, with exactly two rows",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url }, async (app) => {
          const legend = await app.openLegend();
          assert.ok(legend, "the `◷ status legend` opens");

          // ORDER: the five status rows, a divider, then Freshness.
          const blocks = legend.blocks;
          const statusRows = blocks.filter((block) => block.type === "p");
          assert.equal(statusRows.length, 5, "the five status rows come first");
          const dividerIndex = blocks.findIndex((block) => block.className.includes("border-t"));
          assert.equal(dividerIndex, 5, "…then a divider…");
          assert.ok(
            blocks.slice(dividerIndex + 1).some((block) => block.text.startsWith("Freshness")),
            "…and then the Freshness block, LAST",
          );

          assert.deepEqual(legend.headings, ["Freshness"], "the block carries the existing uppercase legend heading treatment");
          assert.equal(legend.freshnessRows.length, 2, "it lists exactly two rows");

          // The mark is the SAME badge component the surface paints.
          const swatch = legend.freshnessRows[0].badge;
          assert.ok(swatch, "the `stale` row carries a mark");
          assert.ok(isBadgeNode(swatch.node), "…and it is the REAL badge component — not a hand-drawn swatch, a static glyph or a copied class string");
          assert.ok(legend.freshnessRows[0].text.startsWith(STALE_ROW), "…beside its label");

          // …and the `(no badge)` row shows the ABSENCE itself.
          assert.equal(legend.freshnessRows[1].badge, null, "the `(no badge)` row shows the absence itself, matching the \"fresh renders nothing\" rule");
          assert.equal(legend.freshnessRows[1].text, FRESH_ROW);
        });
      });
    },
  },

  {
    name: "board-freshness-legend/07 the FLEET legend gains the same Freshness block as its FOURTH section — Node liveness, Run state, Assignment, then Freshness — painting the same real badge",
    run: async () => {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url, search: "?mode=fleet&scope=global" }, async (app) => {
          const legend = fleetLegend(app);
          assert.ok(legend, "the `◷ legend` panel renders");
          assert.deepEqual(
            legend.headings,
            ["Node liveness", "Run state", "Assignment", "Freshness"],
            "its sections appear in that order, with Freshness LAST",
          );

          const freshnessRows = legend.rows.filter((row) => row.text.startsWith(STALE_ROW) || row.text === FRESH_ROW);
          assert.equal(freshnessRows.length, 2, "the block lists exactly two rows");
          assert.ok(freshnessRows[0].badge, "the `stale` row's mark is a badge…");
          assert.ok(isBadgeNode(freshnessRows[0].badge), "…the REAL badge component the surface paints");
          assert.equal(freshnessRows[1].badge, null, "…and the `(no badge)` row shows the absence itself");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario Outline: the `stale` row states the configured window, taken
  //    from the number on the wire ══
  {
    name: "board-freshness-legend/07 the `stale` row states the CONFIGURED window in words, taken from the number on the wire — 60 / 300 / 3600 / 86400 / 0 — and never a value of the legend's own",
    run: async () => {
      const rows = [
        ["one minute", 60, "1 minute"],
        ["five minutes", 300, "5 minutes"],
        ["one hour", 3600, "1 hour"],
        ["one day", 86400, "1 day"],
        // zero — every copy is immediately stale. A valid, if aggressive,
        // threshold, and one a "falsy means unset" reading would silently drop.
        ["zero", 0, "0 seconds"],
      ];
      for (const [label, configured, words] of rows) {
        await withBoardFace(async (face) => {
          await face.reportedBy(NODE, at(-720));
          await withBoardApp({ url: face.url }, async (app) => {
            const legend = await app.openLegend();
            assert.equal(
              legend.freshnessRows[0].text,
              `${FRESHNESS_GLYPH} stale — no fresh copy for over ${words}`,
              `${label}: the row states the CONFIGURED window`,
            );
            assert.equal(legend.freshnessRows[1].text, FRESH_ROW, `${label}: …and the second row is unchanged`);
          });
          // The window is configured in the workspace's own config and resolved
          // by the face's own resolver, so this really is the number in force.
        }, { stalenessSeconds: configured });
      }
    },
  },

  // ══ Scenario Outline: when the wire does not carry the window the row
  //    degrades to WORDS — never to a number ══
  {
    name: "board-freshness-legend/07 when the wire does not carry the window the row degrades to WORDS — no number, no duration, no unit anywhere in its text — and the block is still rendered",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.withdrawWindow();
        await withBoardApp({ url: face.url }, async (app) => {
          const legend = await app.openLegend();
          assert.equal(legend.freshnessRows[0].text, UNQUANTIFIED, "the `stale` row reads the unquantified sentence exactly");
          assert.ok(!/\d/.test(legend.freshnessRows[0].text), "the row contains no NUMBER anywhere in its text");
          assert.ok(
            !/\b(second|minute|hour|day|week|ms|s|m|h|d)s?\b/.test(legend.freshnessRows[0].text.replace("staleness", "")),
            "…no duration and no unit either",
          );
          assert.equal(legend.freshnessRows.length, 2, "the block is STILL rendered — the degrade is a rewording, not a disappearance");
          assert.equal(legend.freshnessRows[1].text, FRESH_ROW);

          // …and no other surface substituted a window of its own: with no
          // window the ramp withholds every verdict, so nothing is painted stale.
          assert.equal(app.badges().length, 1, "the only badge on the page is the legend's own swatch");
          assert.ok(isBadgeNode(legend.freshnessRows[0].badge.node), "…which is the ramp's mark, not a claim about any row");
        });
      });

      // The ramp's own reader answers `null` for EVERY way the number can fail
      // to arrive — absent, explicit null, non-numeric, non-finite — so all four
      // Examples degrade identically by construction rather than by four
      // separate code paths. (The reader itself is `readStalenessWindow`, whose
      // four-way behaviour task 03 pins; what matters HERE is that the legend
      // renders the SAME words for every one of them.)
      const { freshnessLegendRows } = await import("../ui/src/board/freshness.mjs");
      for (const [label, value] of [["field absent", undefined], ["explicit null", null], ["non-numeric", "5m"], ["not finite", Number.NaN]]) {
        assert.equal(
          freshnessLegendRows(value)[0].text,
          "— no fresh copy inside the staleness window",
          `${label}: degrades to the SAME words`,
        );
      }
    },
  },

  // ══ Scenario: the legend renders correctly before any data has arrived ══
  {
    name: "board-freshness-legend/07 the legend renders correctly BEFORE any data has arrived — from the ramp module alone, with no loading, error or empty state — in its words form, and states the window on the next render once the first response lands",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        const stall = face.stallList();
        await withBoardApp({ url: face.url, settle: "render" }, async (app) => {
          assert.equal(app.screen(), "loading", "no list response has arrived yet");

          const before = await app.openLegend();
          assert.ok(before, "the legend opens anyway — it renders from the ramp module alone");
          assert.equal(before.freshnessRows.length, 2, "the Freshness block is present with its two rows");
          assert.equal(
            before.freshnessRows[0].text,
            UNQUANTIFIED,
            "the `stale` row is in its unquantified WORDS form, because no window has been received",
          );

          // …and the first response quantifies it on the next render.
          stall.release();
          await app.flush();
          const after = app.legend();
          assert.equal(
            after.freshnessRows[0].text,
            `${FRESHNESS_GLYPH} stale — no fresh copy for over 5 minutes`,
            "once the first list response arrives carrying the window, the row states it on the next render",
          );
        });
      }, { stalenessSeconds: 300 });
    },
  },

  // ══ Scenario: the legend's swatch and the surface's badge stay identical ══
  {
    name: "board-freshness-legend/07 the legend's SWATCH and the surface's BADGE are the same thing — one ramp, one source, the same token set — and neither carries a `destructive` or `accent` token",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url }, async (app) => {
          const onItem = app.overviewCard("43").badge;
          assert.ok(onItem, "a stale item is on the board, carrying its badge");

          const legend = await app.openLegend();
          const swatch = legend.freshnessRows[0].badge;
          assert.ok(swatch, "…and the legend is open, carrying its swatch");

          assert.equal(
            swatch.className,
            onItem.className,
            "both are produced by the same freshness ramp module and carry the SAME token set",
          );
          for (const token of ["border-dashed", "border-muted-foreground/45", "bg-transparent", "text-muted-foreground"]) {
            assert.ok(swatch.className.includes(token), `…including \`${token}\``);
          }
          assert.ok(!swatch.className.includes("destructive"), "neither carries a `destructive` token");
          assert.ok(!swatch.className.includes("accent"), "…nor an `accent` token");
          assert.ok(!onItem.className.includes("destructive"));
          assert.ok(!onItem.className.includes("accent"));

          // The swatch is a distinct PRIMITIVE from every other mark on the page.
          // The distinguishing signature is the one the design fixes and the one
          // the harness addresses it by: a dashed pill that is ALSO a PADDED,
          // TEXT-BEARING inline-flex. (Dashed alone is deliberately shared — the
          // `not-started` ring already carries that exact border literal, which
          // is the learned "degraded / not-yet" connotation this ramp REUSES on
          // purpose. What must be unclaimed is the pill, not the dash.) The pixel
          // verdict is task 09's; what is structural is that no other element
          // wears the badge's full signature.
          const pills = findAll(app.tree(), isBadgeNode);
          assert.ok(pills.length > 0, "the dashed-pill primitive is in use…");
          const impostors = findAll(app.tree(), (node) => typeof node.props?.className === "string"
            && node.props.className.includes("rounded-full")
            && node.props.className.includes("border-dashed")
            && node.props.className.includes("px-2")
            && !isBadgeNode(node));
          assert.deepEqual(
            impostors.map((node) => node.props.className),
            [],
            "…and nothing else on the page is a dashed, padded, rounded-full mark, so the ramp cannot be confused with the presence dot, the run chip or the assignment chip",
          );
          // …and the marks that DO share the dash are a different shape: the
          // status ring is an unpadded circle carrying no text of its own.
          const sharesTheDash = findAll(app.tree(), (node) => typeof node.props?.className === "string"
            && node.props.className.includes("border-dashed")
            && node.props.className.includes("rounded-full")
            && !isBadgeNode(node));
          for (const mark of sharesTheDash) {
            assert.ok(
              !mark.props.className.includes("text-[11px]"),
              `a mark sharing the dashed border is a different primitive, never the badge's type (${mark.props.className})`,
            );
          }
        });
      });
    },
  },
];

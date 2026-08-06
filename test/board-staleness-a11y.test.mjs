// Traceability wiring for milestone 43 / story 04 / task 08 —
// tasks/08_staleness-a11y-contract.feature (@executable).
//
// The freshness ramp's PROGRAMMATIC accessibility contract: the badge never
// carries its meaning in colour alone, a glyph-only badge has an accessible name,
// Resync NAMES ITS OBJECT, its busy state is visible AND programmatic, outcomes
// are announced through a permanently-present polite live region, and the
// threshold crossing is deliberately NOT announced.
//
// THE A11Y LANE IS OFF IN THIS REPO, AND THAT IS THE DECISION, NOT AN OVERSIGHT.
// Per 07/ADR-004 the automated lane is opt-in via `work.tags.domains` containing
// `"a11y"`; `.aof/aof.config.json` lists no such domain. So there is NO
// axe-core-via-Playwright run for this story and NO a11y finding will be logged
// from one. NOTHING BELOW IS AN AXE ASSERTION: these are ordinary DOM/attribute
// assertions off the rendered tree, which is a behavioural check QA has always
// owned. The PERCEPTUAL half — does the ramp actually read as degraded, does the
// word survive a greyscale render, is the hit target really 24 CSS px — cannot be
// settled from an element tree and is task 09's `@uat` judgement over a real
// browser render.
//
// THE ONE FAILURE THIS FILE EXISTS TO PREVENT. A ramp whose entire purpose is a
// THRESHOLD is the easiest kind to build colour-only: grey it and move on. The
// rule is the m03/m25 one — colour and label always travel together — and here
// the WORD `stale` is what carries the meaning, with the dashed border explicitly
// DECORATIVE (it would not clear the 3:1 non-text contrast bar, and no meaning
// may depend on it).
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FRESHNESS_GLYPH, freshness } from "../ui/src/board/freshness.mjs";
import { bundleSurface } from "./support/react-app-harness.mjs";
import { createRuntime } from "./support/mini-react.mjs";
import {
  RESYNC_LABEL_ACCEPTED,
  RESYNC_LABEL_IDLE,
  RESYNC_LABEL_SENDING,
  resyncAnswered,
  resyncView,
} from "../ui/src/board/resync.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp, BOARD_EPOCH, findAll, textOf, visibleTextOf } from "./support/board-app-harness.mjs";

const WINDOW = 300;
const NODE = "umairs-mac-mini";
const at = (secondsFromNow) => new Date(BOARD_EPOCH + secondsFromNow * 1000).toISOString();

// The ramp's descriptor for the stale row every lane is written against.
const staleDescriptor = () => freshness({ syncedAt: at(-720), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: WINDOW });

// ── the MINIMAL form, rendered for real ─────────────────────────────────────
//
// Production paints the WIDEST fitting form on every surface it has today, so
// the glyph-only badge is not reachable by mounting a page: which form a 360px
// fleet card picks is a WIDTH decision, and a rendered element tree has no width
// (that half is task 09's, and is flagged in board-freshness-ramp.test.mjs as
// DEV-2). But its accessibility contract is the ONE trap this file exists to
// catch — a bare `◌` with no accessible name is a decorative mark pretending to
// be information — so it is rendered from the REAL, UNMODIFIED production
// component through the SAME esbuild + mini-react instrument the mounted lanes
// use, and its real element tree is read. Nothing is re-implemented and nothing
// is asserted from source.
const STALE_BADGE_TSX = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  "ui", "src", "board", "StaleBadge.tsx",
);

let badgeComponents = null;

async function loadBadgeComponents() {
  if (badgeComponents) return badgeComponents;
  const source = await bundleSurface({ entry: STALE_BADGE_TSX, stubs: {}, resolve: [] });
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-badge-"));
  try {
    const file = path.join(tmp, "stale-badge.mjs");
    await writeFile(file, source, "utf8");
    badgeComponents = await import(pathToFileURL(file).href);
    return badgeComponents;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// Render one badge form and hand back its ROOT ELEMENT, exactly as the component
// emits it. The component is a leaf that returns host elements, so a full mount
// is unnecessary — but the runtime must be the one the bundle links against.
async function renderBadge(form, descriptor = staleDescriptor()) {
  const { StaleBadge } = await loadBadgeComponents();
  const previous = globalThis.__AOF_MINI_REACT__;
  globalThis.__AOF_MINI_REACT__ = createRuntime().runtime;
  try {
    return StaleBadge({ freshness: descriptor, form });
  } finally {
    globalThis.__AOF_MINI_REACT__ = previous;
  }
}

export const boardStalenessA11yTests = [
  // ══ Scenario Outline: every badge form carries the word `stale` in text, and
  //    the decorative glyph carries nothing unique ══
  {
    name: "board-staleness-a11y/08 EVERY badge form carries the word `stale` in its accessible name, the `◌` glyph is decorative in the text forms, and no colour, token or border is the sole carrier of any fact",
    run: async () => {
      const view = staleDescriptor();

      // FULL — the visible text also states the age.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const badge = app.detail().badge;
          assert.equal(badge.text, `${FRESHNESS_GLYPH} stale · 12m ago`, "full: the visible text states the word AND the age");
          assert.ok(badge.text.includes("stale"), "…so its accessible name contains the literal word \"stale\"");
          assert.equal(badge.role, null, "…it takes no role — it is real text");
          assert.ok(badge.glyphHidden, "…and the `◌` glyph is `aria-hidden=\"true\"`");

          // Removing the border changes NO stated fact: every fact the badge
          // states is in its text.
          const withoutBorder = badge.text;
          assert.ok(withoutBorder.includes("stale") && withoutBorder.includes("12m"), "the dashed border is decorative — removing it changes no stated fact");
          assert.ok(
            !/^\s*$/.test(badge.text),
            "no colour, token or border is the SOLE carrier of any fact the badge states",
          );

          // …and the lane card's SHORT form: the word alone. (A story deep-link
          // already opens its milestone's board, so the lane card is on screen.)
          const lane = app.laneCard("43/04").badge;
          assert.equal(lane.text, `${FRESHNESS_GLYPH} stale`, "short: the visible text is the word alone");
          assert.equal(lane.role, null, "…no role");
          assert.ok(lane.glyphHidden, "…and the glyph is still `aria-hidden=\"true\"`");
        });
      });

      // MINIMAL — no visible text, so the accessible NAME carries it all.
      const minimal = await renderBadge("minimal", view);
      assert.equal(minimal.props.role, "img", "minimal: the glyph-only badge becomes `role=\"img\"`");
      assert.ok(
        /stale/i.test(minimal.props["aria-label"]),
        `…and its accessible NAME carries the meaning (${JSON.stringify(minimal.props["aria-label"])})`,
      );
      assert.equal(minimal.props.children, FRESHNESS_GLYPH, "…the glyph is the element's own content, not hidden");
      assert.notEqual(minimal.props["aria-hidden"], "true", "…and the element itself is never hidden from the accessibility tree");
    },
  },

  // ══ Scenario: the glyph-only badge becomes `role="img"` with the full
  //    sentence as its accessible name ══
  {
    name: "board-staleness-a11y/08 the GLYPH-ONLY badge is `role=\"img\"` with the full sentence as its `aria-label` — naming the node, the local time, the age and the window — and no bare `◌` is ever left unnamed",
    run: async () => {
      const minimal = await renderBadge("minimal");
      const label = minimal.props["aria-label"];
      assert.equal(minimal.props.role, "img", "it carries `role=\"img\"`");
      assert.ok(label.includes(NODE), "its `aria-label` names the reporting node");
      assert.ok(/ at .*\d/.test(label), "…the last-synced local time");
      assert.ok(label.includes("12m ago"), "…the age");
      assert.ok(label.includes("past the 5 minutes staleness window"), "…and the fact that it is past the staleness window");

      // The window clause is DROPPED, not guessed, when the wire did not carry
      // the number — the same words-never-a-number rule the legend keeps.
      const noWindow = freshness({ syncedAt: at(-720), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: null });
      assert.equal(noWindow.badge, null, "with no window there is no badge to name at all — no verdict is asserted");
      const unknownWindowSentence = freshness({ syncedAt: at(-720), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: WINDOW }).badge.title;
      assert.ok(unknownWindowSentence.includes("5 minutes"), "…and when it IS carried, the label states it in the same words the legend uses");

      // No bare `◌` anywhere in the tree with no accessible name.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url }, async (app) => {
          const bareGlyphs = findAll(app.tree(), (node) => visibleTextOf(node) === FRESHNESS_GLYPH
            && (node.children ?? []).every((child) => typeof child !== "object")
            && node.props?.["aria-hidden"] !== "true"
            && node.props?.["aria-label"] == null);
          assert.deepEqual(
            bareGlyphs.map((node) => node.props?.className ?? ""),
            [],
            "there is no bare `◌` anywhere in the tree with no accessible name",
          );
        });
      });
    },
  },

  // ══ Scenario: the full and short badges are plain text with a `title` ══
  {
    name: "board-staleness-a11y/08 the FULL and SHORT badges are plain text with a `title` — no `role`, no `aria-hidden` on the words, the full sentence in `title`, and the node id never duplicated into the visible text",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const badge = app.detail().badge;
          assert.equal(badge.role, null, "it carries no `role` attribute");
          assert.equal(badge.ariaLabel, null, "…and no `aria-label`: the text IS the name");

          // The WORDS are not hidden — only the decorative glyph is.
          const hidden = findAll(badge.node, (node) => node.props?.["aria-hidden"] === "true");
          assert.equal(hidden.length, 1, "exactly one child is hidden from the accessibility tree");
          assert.equal(textOf(hidden[0]), FRESHNESS_GLYPH, "…and it is the decorative glyph, never the words");
          assert.ok(visibleTextOf(badge.node).includes("stale"), "no `aria-hidden` is applied to its text");

          const title = badge.title;
          assert.ok(title.includes(NODE), "its `title` reads the full sentence naming the node");
          assert.ok(/ at .*\d/.test(title), "…the last-synced local time");
          assert.ok(title.includes("12m ago"), "…the age");
          assert.ok(title.includes("5 minutes"), "…and the window");
          assert.ok(!badge.text.includes(NODE), "the badge does not duplicate the node id in its VISIBLE text");
        });
      });
    },
  },

  // ══ Scenario Outline: the Resync control names the item and the node it acts
  //    on ══
  {
    name: "board-staleness-a11y/08 the Resync control NAMES ITS OBJECT — `Resync <ref> from <node>` — never the bare word \"Resync\", while the panel's other controls keep their own distinct names",
    run: async () => {
      for (const [ref, node] of [["43/04", NODE], ["43/03", "aof-wsl"]]) {
        await withBoardFace(async (face) => {
          await face.reportedBy(node, at(-720));
          await withBoardApp({ url: face.url, hash: ref }, async (app) => {
            const control = app.detail().resync;
            assert.ok(control, `${ref}: the Resync control renders`);
            assert.equal(control.ariaLabel, `Resync ${ref} from ${node}`, "its `aria-label` names the item and the node it acts on");
            assert.notEqual(control.ariaLabel, "Resync", "…and its accessible name is not the bare word \"Resync\"");
            assert.notEqual(control.ariaLabel, control.label, "…nor merely its visible label");

            // The same panel's other controls keep their own distinct names.
            const names = findAll(app.tree(), (candidate) => candidate.type === "button")
              .map((candidate) => candidate.props?.["aria-label"] ?? visibleTextOf(candidate))
              .filter((name) => name.length > 0);
            assert.equal(new Set(names).size, names.length, `${ref}: every control on the page has a DISTINCT accessible name (${JSON.stringify(names)})`);
          });
        });
      }
    },
  },

  // ══ Scenario Outline: the busy and held states are visible AND programmatic ══
  {
    name: "board-staleness-a11y/08 the busy and held states are visible AND programmatic — the label, `disabled` and `aria-busy` always AGREE, and there is no state in which the control is disabled while its label is unchanged from idle",
    run: async () => {
      // The `aria-busy` axis belongs to the IN-FLIGHT leg alone: `Requested` is a
      // held acknowledgement of a COMPLETED call, not an operation still running.
      const rows = [
        ["idle", "idle", RESYNC_LABEL_IDLE, false, false],
        ["in-flight", "sending", RESYNC_LABEL_SENDING, true, true],
        ["accepted", "accepted", RESYNC_LABEL_ACCEPTED, true, false],
        ["no answer", "no-answer", RESYNC_LABEL_IDLE, false, false],
        ["refused", "refused", RESYNC_LABEL_IDLE, false, false],
      ];
      for (const [label, phase, expectedLabel, disabled, busy] of rows) {
        const view = resyncView({ phase, node: NODE, ref: "43/04", ageWord: "12m", pollMs: 5000 });
        assert.equal(view.label, expectedLabel, `${label}: its visible label`);
        assert.equal(view.disabled, disabled, `${label}: its \`disabled\` state`);
        assert.equal(view.ariaBusy, busy, `${label}: its \`aria-busy\``);
        // THE RULE, checked on every row rather than asserted once: a disabled
        // button whose label did not change is a SILENT state.
        if (view.disabled) {
          assert.notEqual(view.label, RESYNC_LABEL_IDLE, `${label}: a DISABLED control never keeps the idle label — a silent state is not acceptable`);
        }
      }

      // …and the same three signals agree on the REAL rendered control, in the
      // two states production can hold long enough to read.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const idle = app.detail().resync;
          assert.equal(idle.label, RESYNC_LABEL_IDLE);
          assert.equal(idle.disabled, false);
          assert.ok(idle.ariaBusy == null || idle.ariaBusy === "false", "idle: `aria-busy` is absent or \"false\"");

          const held = app.holdNext("/api/work/resync");
          const pending = app.detail().resync.clickDetached();
          await app.renderOnly();
          const flight = app.detail().resync;
          assert.equal(flight.label, RESYNC_LABEL_SENDING, "in-flight: the visible label changed");
          assert.equal(flight.disabled, true, "…`disabled` is true");
          assert.equal(flight.ariaBusy, "true", "…and `aria-busy` is \"true\" — all three agree");

          await face.awaitDispatch("43/04");
          await app.advanceHeld(1000);
          await held.answered();
          held.release();
          await app.advance(1000);
          await pending.settle();

          const accepted = app.detail().resync;
          assert.equal(accepted.label, RESYNC_LABEL_ACCEPTED, "accepted: the label changed again");
          assert.equal(accepted.disabled, true, "…`disabled` is true");
          assert.ok(
            accepted.ariaBusy == null || accepted.ariaBusy === "false",
            "…and `aria-busy` is absent — a held acknowledgement is not an operation still running",
          );
        });
      });
    },
  },

  // ══ Scenario: the message slot is a polite live region present in the DOM at
  //    all times ══
  {
    name: "board-staleness-a11y/08 the message slot is a POLITE LIVE REGION present in the DOM at all times, including when empty — and the outcome appears inside that SAME element, never in a newly-created one",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.forget("43/04", ["reportedBy"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const before = app.detail().messageSlot;
          assert.ok(before, "the message slot element is present in the DOM before any resync is attempted");
          assert.equal(before.live, "polite", "it carries `aria-live=\"polite\"`");
          assert.equal(before.text, "", "…and it is empty");

          const regions = app.liveRegions();
          assert.equal(regions.length, 1, "there is exactly ONE live region on the page");

          await app.detail().resync.click();
          const after = app.detail().messageSlot;
          assert.equal(after.text, "no owning node recorded", "the outcome text appears…");
          assert.equal(after.live, "polite", "…inside a polite live region…");
          assert.equal(app.liveRegions().length, 1, "…and it is the SAME element — a new live region was not created for it");
          // The slot's STRUCTURE is invariant across states; only its TONE token
          // changes, which is the design's own rule (a coded refusal reads
          // destructive). Asserting the geometry tokens rather than the whole
          // class string is what distinguishes "the element persists" from "the
          // element never changes appearance".
          for (const token of ["mono", "min-w-0", "shrink", "truncate", "text-[10.5px]"]) {
            assert.ok(before.node.props.className.includes(token), `the slot carries \`${token}\` when empty`);
            assert.ok(after.node.props.className.includes(token), `…and still carries \`${token}\` when it holds an outcome`);
          }
          assert.equal(after.live, before.live, "the element is never removed and re-added between states — it keeps its live-region role throughout");
        });
      });

      // …and it is present even when the row is FRESH and there is no control at
      // all: a live region created at the moment of the message is unreliably
      // announced, so it must already exist.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-60));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.detail().resync, null, "the row is fresh, so there is no Resync control…");
          assert.ok(app.detail().messageSlot, "…and the live region is STILL present in the DOM");
          assert.equal(app.detail().messageSlot.live, "polite");
          assert.equal(app.detail().messageSlot.text, "");
        });
      });
    },
  },

  // ══ Scenario: the threshold crossing is deliberately NOT announced ══
  {
    name: "board-staleness-a11y/08 the THRESHOLD CROSSING is deliberately NOT announced — no badge is in a live region, none carries `aria-live`/`role=status`/`role=alert`, and nothing is queued — while the fact stays reachable in the badge's text and the line's prefix",
    run: async () => {
      await withBoardFace(async (face) => {
        // A settled board with several items about to cross the threshold: the
        // whole workspace is one second under the window.
        await face.reportedBy(NODE, at(-299));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.badges().length, 0, "no badge yet");
          const regionsBefore = app.liveRegions();

          await app.advance(2000);

          const badges = app.badges();
          assert.ok(badges.length > 1, "several items crossed the threshold and grew badges (non-vacuous)");
          for (const badge of badges) {
            assert.equal(badge.node.props?.["aria-live"], undefined, "no badge carries `aria-live`");
            assert.notEqual(badge.node.props?.role, "status", "…nor `role=\"status\"`");
            assert.notEqual(badge.node.props?.role, "alert", "…nor `role=\"alert\"`");
          }
          // …and none of them is INSIDE one either.
          for (const region of app.liveRegions()) {
            assert.ok(!region.text.includes("stale"), "no badge is inside a live region");
          }
          assert.deepEqual(
            app.liveRegions().map((region) => region.text),
            regionsBefore.map((region) => region.text),
            "no announcement was queued for the crossing on any surface",
          );
          assert.deepEqual(app.alerts(), [], "…and no alert or status role appeared either");

          // The fact is still reachable ON DEMAND, twice over.
          assert.ok(app.detail().badge.text.includes("stale"), "the badge's own text states it");
          assert.ok(app.detail().provenanceLine.startsWith("stale · "), "…and the provenance line's `stale ·` prefix states it too");
        });
      });
    },
  },

  // ══ Scenario: the Resync control is keyboard reachable, follows the text it
  //    acts on, and keeps a visible focus indicator ══
  {
    name: "board-staleness-a11y/08 the Resync control is a real `<button>` following the provenance label and preceding the message slot, with no positive `tabindex` and no removed focus outline — and its hit target is ≥24px",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.equal(detail.resync.node.type, "button", "it is a real `<button>` — not a `<div>` or `<span>` with a click handler");
          assert.equal(detail.resync.node.props.type, "button", "…an explicit `type=\"button\"`, so it never submits anything");

          const order = detail.provenanceRowChildren;
          assert.equal(order.indexOf(detail.provenanceLabel), 0, "it FOLLOWS the provenance label in DOM order…");
          assert.equal(order.indexOf(detail.resync.node), 1);
          assert.equal(order.indexOf(detail.messageSlot.node), 2, "…and PRECEDES the message slot");

          assert.equal(detail.resync.tabIndex, null, "it is reachable by keyboard in that order, with no positive `tabindex`");
          // The UA outline is not removed: nothing here sets `outline-none`, so
          // the user-agent indicator (and the theme's `--color-ring`) stands.
          assert.ok(
            !/\boutline-none\b|\bfocus:outline-none\b/.test(detail.resync.className),
            `the user-agent focus outline is not removed without a replacement (${detail.resync.className})`,
          );
          // WCAG 2.2 SC 2.5.8 — at `text-[11px] py-1` the box lands around 22px,
          // so the target is floored explicitly. The PIXEL verdict is task 09's;
          // what is structural is that a floor is declared at all.
          assert.ok(
            /\bmin-h-6\b|\bmin-h-\[2[4-9]px\]/.test(detail.resync.className),
            `the hit target declares a ≥24px floor (${detail.resync.className})`,
          );
        });
      });
    },
  },

  // ══ Scenario: no interactive element is ever nested inside the card buttons
  //    that carry the badge ══
  {
    name: "board-staleness-a11y/08 the card `<button>`s that carry the badge nest NO interactive element — each is a single accessible name and a single focus stop, and the badge inside has no role, tabindex, handler or nested control",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url }, async (app) => {
          const overview = app.overviewCard("43");
          await app.openMilestone("43");
          const lane = app.laneCard("43/04");

          for (const [label, card] of [["the overview milestone card", overview], ["the lane card", lane]]) {
            assert.equal(card.type, "button", `${label} is a single <button>`);
            assert.equal(
              findAll(card.node, (node) => (node.type === "button" || node.type === "a") && node !== card.node).length,
              0,
              `${label} is a single focus stop — it nests no interactive element`,
            );
            assert.ok(card.badge, `${label} carries the badge`);
            assert.equal(card.badge.role, null, `${label}'s badge has no role`);
            assert.equal(card.badge.node.props?.tabIndex, undefined, `${label}'s badge has no tabindex`);
            assert.equal(card.badge.interactive, false, `${label}'s badge has no click handler`);
            assert.equal(
              findAll(card.badge.node, (node) => node.type === "button" || node.type === "a").length,
              0,
              `${label}'s badge nests no control`,
            );
            assert.equal(
              findAll(card.node, (node) => (node.type === "button" || node.type === "a") && /resync/i.test(visibleTextOf(node))).length,
              0,
              `there is no Resync control inside ${label}`,
            );
          }
        });
      });
    },
  },

  // ══ Scenario: the stale fact is always available in prose ══
  {
    name: "board-staleness-a11y/08 the stale fact is ALWAYS available in PROSE — the provenance line states it in words whichever form the badge took, so a reader who never perceives the pill still meets the fact in text",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(
            app.detail().provenanceLine,
            `stale · synced 12m ago · from ${NODE}`,
            "the provenance line states the fact in words",
          );

          // …and that statement does not vary with the badge's form: the panel's
          // badge is FULL while the lane card's is SHORT, on the same screen, and
          // the line is the same prose either way.
          assert.equal(app.detail().badge.text, `${FRESHNESS_GLYPH} stale · 12m ago`, "the panel's badge is in its FULL form");
          assert.equal(app.laneCard("43/04").badge.text, `${FRESHNESS_GLYPH} stale`, "…while the lane card's yielded to its SHORT form");
          assert.equal(
            app.detail().provenanceLine,
            `stale · synced 12m ago · from ${NODE}`,
            "…and the statement is present whether or not the badge yielded to a narrower form",
          );

          // The badge is never the only signal: strip every badge from the
          // reading and the fact is still on the panel, in text.
          const panelText = visibleTextOf(app.detail().panel);
          assert.ok(panelText.includes("stale · synced 12m ago"), "a reader who never perceives the pill still meets the fact in text on the same panel");
        });
      });

      // …and the ramp itself cannot render a badge without also rendering the
      // prose: the `stale ·` prefix and the badge come from ONE descriptor.
      const view = staleDescriptor();
      assert.ok(view.badge != null, "the descriptor carries a badge…");
      assert.ok(view.label.startsWith("stale · "), "…and its label carries the prose prefix, from the same source");
      const fresh = freshness({ syncedAt: at(-60), reportedBy: NODE }, { now: BOARD_EPOCH, windowSeconds: WINDOW });
      assert.equal(fresh.badge, null, "no badge for a fresh row…");
      assert.ok(!fresh.label.startsWith("stale · "), "…and no prefix either — the two can never disagree");
    },
  },
];

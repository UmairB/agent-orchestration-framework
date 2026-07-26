// Traceability wiring for milestone 38 / story 04 / task 07 —
// tasks/07_assign-row-geometry-holds.feature (@executable).
//
// DG-13 / F-38.04g, from the REAL-assign render of 2026-07-24 (§Surface 2's
// first real verdict: GAPS at 1280). DESIGN §Surface 2 "Amendment 2026-07-24
// (b) — F-38.04g / F-38.04f, judged from the REAL-assign render", five binding
// clauses; the AMENDED A10 ("'Rhythm' is binding geometry"); DG-13 in the
// design-gap list, with DG-11 re-scoped into clause 5.
//
// WHAT THE PIXELS SHOWED:
//   - in the REFUSED frame the picker (`flex-1 min-w-0 truncate`) collapsed to a
//     BARE CHEVRON — ~26px, down from ~284px — while the inline error took the
//     row, so the operator could not see which node was selected at the exact
//     moment they had to re-aim, and the error truncated before naming the
//     holder (`Item "18" already has an active assignment …`);
//   - in the SUCCESS frame the action narrowed 67px -> 44px on the `Sent` label
//     swap and the picker absorbed the difference — the row reflowed on every
//     state change;
//   - region 5's chip target truncated in EVERY frame that had one
//     (`→ umairs-m…`, `→ aaa-firs…`).
//
// HOW THESE LANES ARE DRIVEN, AND WHAT THEY CAN PROVE. Every clause is asserted
// off the REAL, unmodified production <Fleet/> mounted headlessly against the
// REAL fleet face (test/support/fleet-app-harness.mjs), reading the RENDERED
// props/classNames the component actually emits — the house idiom for a render
// fact. That makes each clause a CLASS/STRUCTURE fact:
//   - "the action's reserved width is the SAME value in every state, and it is
//     derived from the longest label";
//   - "the picker carries a minimum width, and carries no `min-w-0`";
//   - "the message slot is the shrinking/truncating element and carries the full
//     text in `title`";
//   - "region 5 is a YIELD order — the name is dropped whole, `Open board →`
//     degrades to its abbreviated form, and the target yields LAST".
//
// AMENDED 2026-07-24 by §Surface 2's SECOND real verdict — the re-render taken
// after this file was first written. It closed DG-14 and GAP-S2-3 outright and
// closed DG-13 as filed, but opened three successors, all built and asserted
// here: DG-15 (the target's `shrink-0` OVERPRINTED `Open board →` — clause 5
// gains "no two elements in region 5 may occupy the same pixels", and priority
// becomes a YIELD order, never a paint order), DG-16 (the workspace name STUBBED
// to `l…` instead of dropping — full or nothing), and DG-17 (clause 4's own
// exemplar copy could not fit the row clauses 1+2 leave — the holder is atomic
// and the copy steps down a ladder).
// It does NOT make them a PIXEL verdict. Whether the reserved width really does
// contain `Assigning…` at 11px semibold, whether the floor really does show
// fourteen characters beside the chevron, whether the row's height is still 38px
// and whether the wider action still reads as A2's quiet carve-out are all
// claims about pixels, and only a render can settle them. That render is owed to
// the designer and is NOT claimed here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSIGN_ACTION_LABELS,
  ASSIGN_ACTION_WIDTH_CH,
  ASSIGN_PICKER_FLOOR_CH,
  ASSIGN_PICKER_CHROME,
  ASSIGN_LABEL_REST,
  ASSIGN_LABEL_SENDING,
  ASSIGN_LABEL_SENT,
  ASSIGN_REFUSAL_COPY,
  ASSIGN_MESSAGE_BUDGET_CH,
  ASSIGN_REFUSAL_SHORT_OUTCOME,
  REGION5_NAME_BUDGET_CH,
  REGION5_CHIP_SLOT_BUDGET_CH,
  assignAffordanceView,
  assignRefused,
  assignRefusalLadder,
} from "../ui/src/fleet/assign-affordance.mjs";
import {
  withPublishedAssignFixture,
  sameOriginAssign,
  seedTargetNode,
} from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp, findAll, textOf } from "./support/fleet-app-harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLEET_API_TS = path.join(repoRoot, "ui", "src", "fleet", "api.ts");

// The four phases the row ever renders. Kept here (not derived from the view) so
// a phase quietly dropped from the state machine would be noticed rather than
// silently un-asserted.
const EVERY_PHASE = ["rest", "sending", "sent", "refused"];

// codedRefusalFromRoute(url, request) — a REAL refusal, taken from the REAL
// route, rebuilt into the Error the REAL api client throws. `ui/src/fleet/api
// .ts`'s safeError lifts `error`/`code` and (after this pass) the verb's own
// extra fields `holder`/`target` onto the Error; this mirrors that lift exactly,
// so `assignRefused` is fed the same envelope production feeds it. The lift
// itself is asserted structurally against api.ts in its own lane below, which is
// what joins the two halves.
async function codedRefusalFromRoute(url, { ref, nodeId, workspaceId }) {
  const response = await fetch(new URL("/api/mesh/assign", url), {
    method: "POST",
    headers: { origin: new URL(url).origin, "content-type": "application/json" },
    body: JSON.stringify({ ref, nodeId, workspaceId }),
  });
  assert.ok(!response.ok, `the route really refused this dispatch — got ${response.status}`);
  const body = await response.json();
  const error = new Error(body.error ?? `Request failed (${response.status})`);
  error.code = body.code;
  error.status = response.status;
  if (typeof body.holder === "string") error.holder = body.holder;
  if (typeof body.target === "string") error.target = body.target;
  return { error, body };
}

// The card's REGION 5 — the footer row: the workspace name, then the attention
// cluster (the m35 chip + the secondary token) and the right-aligned drill-in.
// Addressed STRUCTURALLY (never by index), so a layout change fails loudly.
function region5(card) {
  const footer = findAll(
    card,
    (node) =>
      node.type === "div"
      && typeof node.props?.className === "string"
      && node.props.className.includes("justify-between")
      && node.props.className.includes("border-t"),
  )[0] ?? null;
  assert.ok(footer, "the card renders its region-5 footer row");
  const children = (footer.children ?? []).filter(Boolean);
  // Addressed by IDENTITY, not position: DG-16 makes the workspace name a
  // CONDITIONAL child (dropped whole once the attention cluster needs the row),
  // so a positional `[workspaceName, cluster]` would silently hand back the
  // cluster the moment the name is absent — and the assertion "the name is gone"
  // would pass against the wrong element. The name is the direct-child span in
  // the `mono` ramp; the cluster wrapper carries no ramp of its own.
  const workspaceName = children.find(
    (node) => node && node.type === "span" && typeof node.props?.className === "string" && /\bmono\b/.test(node.props.className),
  ) ?? null;
  const cluster = children.find((node) => node && node !== workspaceName) ?? null;
  // The drill-in is addressed by its `title`, not its TEXT: DG-19's last clause
  // makes the words a conditional child, so a text match would stop finding the
  // element in exactly the abbreviated state that most needs asserting.
  const drillIn = findAll(
    footer,
    (node) => node.type === "span" && typeof node.props?.title === "string" && /^Open(ing)? board|^Open failed/.test(node.props.title),
  )[0] ?? null;
  // The chip's mono text slot is addressed by the ONE fact that identifies it
  // without assuming the very classes this file is here to assert: it is the
  // element carrying the whole `→ <target> · <when> · <note>` string as its
  // native `title`. Its two children are the target half and the tail half.
  const chipText = findAll(
    footer,
    (node) => node.type === "span" && typeof node.props?.title === "string" && node.props.title.startsWith("→ "),
  )[0] ?? null;
  const [target = null, tail = null] = chipText ? (chipText.children ?? []).filter((child) => child && typeof child === "object") : [];
  return { footer, children, workspaceName, cluster, drillIn, target, chipText, tail };
}

export const fleetAssignRowGeometryTests = [
  // ══ clause 1 — the action's width is FIXED ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 1: the action reserves the SAME width in EVERY state — rest, in-flight, `Sent` and refused — and it is sized to the LONGEST label the action ever reads",
    async run() {
      // The derivation, asserted where it lives: the reserved width comes from
      // the label SET, so renaming or adding a label cannot leave it behind.
      assert.deepEqual(
        [...ASSIGN_ACTION_LABELS].sort(),
        [ASSIGN_LABEL_REST, ASSIGN_LABEL_SENDING, ASSIGN_LABEL_SENT].sort(),
        "the label set the width is sized from is the label set the action renders",
      );
      assert.equal(
        ASSIGN_ACTION_WIDTH_CH,
        Math.max(...ASSIGN_ACTION_LABELS.map((label) => label.length)),
        "the reserved width is the LONGEST label's, derived — not a number chosen beside them",
      );
      assert.equal(ASSIGN_ACTION_WIDTH_CH, ASSIGN_LABEL_SENDING.length, "…which is `Assigning…`, exactly as the design says");

      // …and phase-independence, asserted at the derivation: there is no phase
      // for which the view yields a different width.
      const widths = new Set(EVERY_PHASE.map((phase) => assignAffordanceView({ phase, hasOptions: true, selected: "worker-a" }).actionWidth));
      assert.equal(widths.size, 1, `the reserved width does not vary with the phase — got ${JSON.stringify([...widths])}`);
      // …including the DISABLED empty-roster row, whose action carries no target.
      assert.equal(
        assignAffordanceView({ phase: "rest", hasOptions: false, selected: "" }).actionWidth,
        [...widths][0],
        "…nor with the roster: the disabled empty-roster action reserves the same width (clause 1 says `in every state including disabled`)",
      );

      // Now the same fact READ OFF THE REAL RENDERED TREE, state by state.
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const seen = new Map();
          const record = (label, view) => {
            assert.ok(view.actionSizerStyle?.width, `${label}: the action renders a reserved width`);
            seen.set(label, view.actionSizerStyle.width);
          };

          record(`rest (${app.affordance("38").actionLabel})`, app.affordance("38"));

          // in-flight, read between the click's own state change and the answer
          const held = app.holdNext("/api/mesh/assign");
          const inFlight = app.affordance("38").clickDetached();
          await app.renderOnly();
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENDING);
          record("in-flight (Assigning…)", app.affordance("38"));
          held.release();
          await inFlight.settle();

          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENT);
          record("acknowledged (Sent)", app.affordance("38"));

          // …and a REAL refusal: the verb's own single-runner gate refuses the
          // second dispatch of the same item.
          await app.advance(6000);
          await app.affordance("38").click();
          assert.ok(app.affordance("38").message, "the second dispatch is really refused");
          record("refused (Assign →, with a message beside it)", app.affordance("38"));

          const distinct = new Set(seen.values());
          assert.equal(
            distinct.size,
            1,
            `the action's reserved width must be IDENTICAL in every state — a label swap may not move another element. Got ${JSON.stringify([...seen])}`,
          );
          assert.equal([...distinct][0], `${ASSIGN_ACTION_WIDTH_CH}ch`, "…and it is the derived, longest-label width");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ clause 1 — including the DISABLED empty-roster row, on the real tree ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 1: the DISABLED empty-roster action reserves the same width on the REAL rendered tree — `in every state including disabled`",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const empty = app.affordance("38");
          assert.equal(empty.actionDisabled, true, "the empty-roster action is disabled");
          assert.equal(empty.actionSizerStyle?.width, `${ASSIGN_ACTION_WIDTH_CH}ch`, "…and still reserves the longest label's width");
        });
      });
    },
  },

  // ══ clause 2 — the picker has a FLOOR and never goes anonymous ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 2: the picker keeps a FLOOR of ≥14ch of the node id PLUS the chevron in every state, carries no `min-w-0`, and still names its target under a long refusal — a bare chevron is FORBIDDEN",
    async run() {
      assert.ok(ASSIGN_PICKER_FLOOR_CH >= 14, `the floor renders at least fourteen characters of the node id — got ${ASSIGN_PICKER_FLOOR_CH}`);
      const floors = new Set(EVERY_PHASE.map((phase) => assignAffordanceView({ phase, hasOptions: true, selected: "worker-a" }).pickerMinWidth));
      assert.equal(floors.size, 1, `the floor does not vary with the phase — got ${JSON.stringify([...floors])}`);
      assert.equal(
        [...floors][0],
        `calc(${ASSIGN_PICKER_FLOOR_CH}ch + ${ASSIGN_PICKER_CHROME})`,
        "the chevron's own room is ADDED to the floor, not eaten out of it (`box-sizing: border-box` counts the select's padding, border and chevron inside a width)",
      );

      await withPublishedAssignFixture(async ({ url }) => {
        // The item already has an active assignment, so the very next click
        // draws the REAL refusal — the frame the render caught collapsing.
        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200);

        await withFleetApp({ url }, async (app) => {
          const rest = app.affordance("38");
          assert.ok(rest.selectStyle?.minWidth, "the picker renders a minimum width at rest");
          assert.ok(
            !/\bmin-w-0\b/.test(rest.selectClassName),
            `the picker carries NO min-w-0 — that is the class that let the real render collapse it to a bare chevron. Got ${JSON.stringify(rest.selectClassName)}`,
          );

          await app.affordance("38").click();
          const refused = app.affordance("38");
          assert.ok(refused.message, "the refusal really rendered");
          assert.equal(
            refused.selectStyle?.minWidth,
            rest.selectStyle?.minWidth,
            "the picker's floor is UNCHANGED under a refusal — it never yields to the message",
          );
          assert.equal(
            refused.selectedNode,
            "worker-a",
            "…and the picker still NAMES its target at the exact moment the operator must re-aim it",
          );
          assert.deepEqual(refused.options, ["worker-a"], "…with the roster still rendered as options, not swallowed");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ clause 3 — the message slot is the element that YIELDS ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 3: the message slot is the element that yields — it truncates, it carries the FULL server sentence in its native `title`, and neither the picker nor the action is what gives way",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200);

        await withFleetApp({ url }, async (app) => {
          await app.affordance("38").click();
          const refused = app.affordance("38");

          assert.match(refused.messageClassName, /\btruncate\b/, "the message slot truncates");
          assert.match(refused.messageClassName, /\bmin-w-0\b/, "…and may shrink to nothing (min-w-0 belongs HERE, on the yielding element)");
          assert.match(refused.messageClassName, /\bshrink\b/, "…it is the shrinking element of the row");
          assert.ok(!/\bshrink-0\b/.test(refused.messageClassName), "…and is emphatically not shrink-0");

          assert.ok(refused.messageTitle, "the slot carries a native title attribute");
          assert.match(
            refused.messageTitle,
            /already has an active assignment/,
            `the title carries the FULL server sentence, whole — nothing is discarded, only ranked. Got ${JSON.stringify(refused.messageTitle)}`,
          );
          assert.ok(
            refused.messageTitle.length > refused.message.length,
            "…and it is longer than what the row shows, which is the point of the idiom (the same one DG-10 uses for the session id)",
          );

          // …and the two elements that must NOT give way.
          assert.match(refused.actionClassName, /\bshrink-0\b/, "the action does not give way");
          assert.match(refused.selectClassName, /\bflex-1\b/, "the picker GROWS into free space rather than yielding out of it");
          assert.ok(refused.selectStyle?.minWidth, "…and is floored besides");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ clause 4, as SUPERSEDED by DG-17 — the holder is ATOMIC ══
  //
  // The 2026-07-24 re-render judged clause 4 "CLOSED IN COPY, NOT IN PIXELS":
  // the string was exactly `already assigned → umairs-msi` and it still rendered
  // `already assigned → uma…`. The arithmetic proved the rule unsatisfiable —
  // clause 2's picker floor + clause 1's fixed action leave ~137px of a 360.66px
  // row, while clause 4's OWN exemplar needs ~197px. The RULE changed: the
  // holder renders WHOLE or is omitted, chosen by a graduated LADDER, never by
  // handing one long string to CSS `truncate`.
  {
    name: "fleet-assign-row-geometry/07 DG-17 (supersedes DG-13 clause 4): the holder is an ATOMIC substring — the copy steps DOWN a ladder to keep it whole, and never leads with the ref region 1 already shows",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200, "the item already has an active assignment held by worker-a");

        await withFleetApp({ url }, async (app) => {
          await app.affordance("38").click();
          const refused = app.affordance("38");

          // `already assigned → worker-a` is 27ch against the 22ch budget, so the
          // ladder steps down ONE rung rather than cutting the id.
          assert.equal(
            refused.message,
            "refused · worker-a",
            `the ladder picks the longest rung that FITS, keeping the holder whole. Got ${JSON.stringify(refused.message)}`,
          );
          // DG-21: and the rung it picked still NAMES THE OUTCOME. A rung that
          // dropped the outcome word left the row reading `held by umairs-msi`
          // in red beside region 5's `assigned → umairs-msi` — the same node id
          // twice, with only the colour distinguishing "someone else holds this"
          // from "your assign succeeded". A9/S4: colour and label always travel
          // together, never colour alone.
          assert.match(
            refused.message,
            /refused|already assigned/,
            "…and EVERY rung names the outcome — the destructive tint may never be the only thing carrying it",
          );
          assert.ok(
            refused.message.length <= ASSIGN_MESSAGE_BUDGET_CH,
            "…and the rung it picked really does fit the slot's budget — otherwise CSS would cut it anyway",
          );
          assert.ok(
            !refused.message.startsWith("Item "),
            "…it does NOT lead with the ref: region 1 already shows it, and the raw sentence truncates the holder away spending width on it",
          );
          assert.ok(!refused.message.includes("38"), "…the ref does not appear in the message at all");
          assert.ok(
            refused.message.includes("worker-a"),
            "…and the HOLDER does, WHOLE: it is the only fact no other region on this card carries",
          );
          assert.ok(
            refused.messageTitle.includes("38") && refused.messageTitle.includes("worker-a"),
            "the server's own sentence — ref and all — is not discarded; it is exactly what the `title` carries",
          );
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ DG-17 — the ladder itself, over the holder lengths that decide it ══
  {
    name: "fleet-assign-row-geometry/07 DG-17: the ladder NEVER renders a partial holder — every rung names the holder whole, and when even the shortest cannot fit, the holder is OMITTED rather than mutilated",
    async run() {
      const outcome = ASSIGN_REFUSAL_COPY["assignment-already-active"];
      const rows = [
        // holder, expected copy, why
        ["msi", `${outcome} → msi`, "a short holder fits the top rung verbatim — DESIGN's own worked example shape"],
        ["worker-a", "refused · worker-a", "27ch does not fit, so it steps to `refused · <holder>` (18ch)"],
        ["umairs-mac-mini", outcome, "`refused · …` is 25ch — the holder is OMITTED, never cut"],
        ["umairs-mac-mini-build-agent-02", outcome, "a long holder cannot ride any rung — the outcome stands alone"],
      ];

      for (const [holder, expected, why] of rows) {
        assert.equal(assignRefusalLadder(outcome, holder), expected, `${holder}: ${why}`);

        const rendered = assignRefusalLadder(outcome, holder);
        assert.ok(
          rendered.length <= ASSIGN_MESSAGE_BUDGET_CH,
          `${holder}: every rung the ladder can pick fits the slot — the ladder is what sizes the copy, not CSS`,
        );
        // The atomicity clause, stated as the property that matters: the holder
        // is present WHOLE or absent ENTIRELY. A prefix is the forbidden state —
        // three glyphs of a node id are indistinguishable from three other node
        // ids on the same roster, which is worse than saying nothing.
        const partial = holder.slice(0, Math.max(1, holder.length - 1));
        assert.ok(
          rendered.includes(holder) || !rendered.includes(partial),
          `${holder}: the holder is atomic — whole, or gone; never a prefix`,
        );
        // DG-21 — the rail the first ladder broke: the OUTCOME never leaves the
        // string, at any rung. Without it the row said `held by <node>` in red
        // beside region 5's `assigned → <node>`: the same id twice, and only the
        // colour telling the operator which one was the refusal.
        assert.ok(
          rendered.startsWith(outcome) || rendered.startsWith(ASSIGN_REFUSAL_SHORT_OUTCOME),
          `${holder}: every rung leads with an outcome word — colour is never the only carrier`,
        );
      }

      // No holder at all ⇒ the outcome stands alone, at every budget.
      assert.equal(assignRefusalLadder(outcome, null), outcome, "no holder ⇒ the outcome alone");
      assert.equal(assignRefusalLadder(outcome, ""), outcome, "a blank holder is no holder");

      // The budget is a parameter, not a hidden constant — a future row width
      // widens the copy without touching the ladder.
      assert.equal(
        assignRefusalLadder(outcome, "umairs-mac-mini", 40),
        `${outcome} → umairs-mac-mini`,
        "given a wider slot the ladder climbs BACK to the top rung — it is width-driven, not a downgrade",
      );
    },
  },

  // ══ clause 4 — the Scenario Outline, over REAL coded refusals ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 4 (Outline): every verb refusal whose sentence leads with a fact another region already carries is shaped outcome-first from the CODED envelope, and keeps its full sentence in the `title`",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        // A node that is KNOWN to the verb but holds no published repo for this
        // workspace — the producer for `assignment-repo-unavailable`, seeded
        // through the fixture's own seam rather than hand-built.
        await seedTargetNode({ home }, { nodeId: "stranded-node", workspaceId, member: false, published: true });

        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200, "…so the next dispatch of 38 is refused already-active");

        const rows = [
          {
            code: "assignment-already-active",
            request: { ref: "38", nodeId: "worker-a", workspaceId },
            // DG-17: the ladder steps down one rung to keep `worker-a` whole.
            message: "refused · worker-a",
            sentenceCarries: /already has an active assignment/,
          },
          {
            code: "assignment-target-unknown",
            request: { ref: "38/04", nodeId: "ghost-node", workspaceId },
            message: ASSIGN_REFUSAL_COPY["assignment-target-unknown"],
            sentenceCarries: /not a known node in this mesh/,
          },
          {
            code: "assignment-repo-unavailable",
            request: { ref: "38/04", nodeId: "stranded-node", workspaceId },
            message: ASSIGN_REFUSAL_COPY["assignment-repo-unavailable"],
            sentenceCarries: /does not hold a published repo/,
          },
          {
            code: "ref-not-found",
            request: { ref: "99/99", nodeId: "worker-a", workspaceId },
            message: ASSIGN_REFUSAL_COPY["ref-not-found"],
            sentenceCarries: /No work item resolves for ref/,
          },
        ];

        for (const row of rows) {
          const { error, body } = await codedRefusalFromRoute(url, row.request);
          assert.equal(body.code, row.code, `${row.code}: the REAL route raised the code this row is about`);

          const state = assignRefused(error);
          assert.equal(state.phase, "refused", `${row.code}: it lands in the refused state`);
          assert.equal(state.error, row.message, `${row.code}: the row renders the shaped, outcome-first copy`);
          assert.equal(state.detail, body.error, `${row.code}: the title carries the server's own sentence, byte-for-byte`);
          assert.match(state.detail, row.sentenceCarries, `${row.code}: …which really is the verb's sentence`);
          assert.ok(
            state.error.length < state.detail.length,
            `${row.code}: the shaped copy is shorter than the sentence it ranks — otherwise there is nothing for the title to do`,
          );

          const view = assignAffordanceView({ ...state, hasOptions: true, selected: "worker-a" });
          assert.equal(view.message, row.message, `${row.code}: …and that is what the view hands the row`);
          assert.equal(view.messageTitle, body.error, `${row.code}: …with the sentence in the title`);
          assert.equal(view.messageTone, "destructive", `${row.code}: in the token the refused state already uses`);
        }

        // An UNMAPPED code keeps the server's own sentence rather than being
        // re-worded on a guess — the route's workspace/identity codes already
        // lead with their outcome.
        const workspaceMiss = await codedRefusalFromRoute(url, { ref: "38/04", nodeId: "worker-a", workspaceId: "0000000000000000" });
        assert.equal(workspaceMiss.body.code, "workspace-not-found");
        const unmapped = assignRefused(workspaceMiss.error);
        assert.equal(unmapped.error, workspaceMiss.body.error, "an unmapped code renders the server's sentence, unshaped");
        assert.equal(unmapped.detail, workspaceMiss.body.error, "…and the title carries the same, so the slot still truncates against the whole of it");
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ clause 4 — the client half: the envelope must REACH the affordance ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 4: the api client carries the verb's CODED envelope onto the thrown error — without `holder` on the wire and on the Error, the affordance could not name the holder at all",
    async run() {
      const source = (await readFile(FLEET_API_TS, "utf8")).replace(/\/\/[^\n]*/g, "");
      assert.match(source, /error\.holder = body\.holder/, "api.ts lifts the verb's `holder` onto the thrown Error");
      assert.match(source, /error\.target = body\.target/, "…and its `target`");
      assert.match(source, /error\.code = body\.code/, "…beside the code the copy is keyed on");

      // …and end-to-end, through the REAL route: the field really is on the wire.
      await withPublishedAssignFixture(async ({ url, workspaceId }) => {
        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200);
        const { body } = await codedRefusalFromRoute(url, { ref: "38", nodeId: "worker-a", workspaceId });
        assert.equal(body.code, "assignment-already-active");
        assert.equal(body.holder, "worker-a", "the route forwards the verb's own `holder` field verbatim — the fact the copy is built from");
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ A10 — the row's membership and rhythm are unchanged ══
  {
    name: "fleet-assign-row-geometry/07 DG-13 + A10: the fixed width adds NO element to the row — its children stay picker · action · (message), the sizing shell lives INSIDE the action, and the row keeps the card's own divider+padding idiom",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const rest = app.affordance("38");
          assert.deepEqual(rest.rowChildTypes, ["select", "button"], "at rest the row is picker · action, and nothing else");
          assert.ok(rest.actionSizerClassName, "the reserved width lives on a shell INSIDE the action…");
          assert.equal(
            findAll(rest.row, (node) => node.type === "span" && node.props?.style?.width != null).length,
            1,
            "…and there is exactly one such shell in the whole row — it is a sizing shell, not a fourth element",
          );

          const held = app.holdNext("/api/mesh/assign");
          const inFlight = app.affordance("38").clickDetached();
          await app.renderOnly();
          assert.deepEqual(app.affordance("38").rowChildTypes, ["select", "button"], "in flight: unchanged membership");
          held.release();
          await inFlight.settle();
          assert.deepEqual(app.affordance("38").rowChildTypes, ["select", "button"], "acknowledged: unchanged membership — `Sent` is a label swap inside the existing control");

          await app.advance(6000);
          await app.affordance("38").click();
          const refused = app.affordance("38");
          assert.ok(refused.message);
          assert.deepEqual(
            refused.rowChildTypes,
            ["select", "button", "span"],
            "refused: the message slot is the ONLY element any state adds, and it is appended after the action — the picker and the action do not move in the order",
          );

          const rowClasses = (refused.row?.props?.className ?? "").split(/\s+/);
          for (const idiom of ["mt-3", "border-t", "border-border", "pt-3", "gap-2", "text-xs", "items-center"]) {
            assert.ok(rowClasses.includes(idiom), `the row keeps the card's own divider+padding rhythm idiom: ${idiom} (got ${JSON.stringify(rowClasses)})`);
          }
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ clause 5, as AMENDED by DG-15/DG-16 — a YIELD order, never a paint order ══
  //
  // The re-render caught clause 5's headline MET (the target rendered in full,
  // 30 characters of it) and its MECHANISM broken twice: the target's `shrink-0`
  // inside a `min-w-0` wrapper overflowed and PAINTED OVER `Open board →` — the
  // id's trailing glyph and the action's leading glyph on the same pixels,
  // destroying both (DG-15) — while the workspace name STUBBED to `l…` instead
  // of dropping (DG-16, which also falsified DG-11's "does not reproduce" note).
  // Clause 5 therefore gains a SIXTH clause: no two elements in region 5 may
  // occupy the same pixels. Priority is expressed as who yields FIRST, and every
  // element can yield — the target last, and inside its own box.
  {
    name: "fleet-assign-row-geometry/07 DG-13 clause 5 + DG-15/DG-16: region 5 is a YIELD order — the name is dropped whole rather than stubbed, `Open board →` gives way next, and the target yields LAST and never overprints",
    async run() {
      const longNode = "umairs-mac-mini-worker";
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          // A REAL minted record, from a REAL click — never a hand-seeded
          // assignment (the milestone's earned lesson: a seeded fixture judges
          // the chrome and never the feature).
          const before = region5(app.affordance("38").card);
          assert.ok(before.workspaceName, "BEFORE any chip, region 5 renders the workspace name in full");
          assert.ok(
            !/\bhidden\b/.test(before.workspaceName.props?.className ?? ""),
            "…there is room for it, so it is present — the drop is pressure-driven, not unconditional",
          );

          await app.affordance("38").click();
          const card = app.affordance("38").card;
          assert.ok(card, "the clicked card is in the tree");

          const r5 = region5(card);
          assert.ok(r5.target, "region 5 renders the chip's `→ <target>`");
          assert.equal(textOf(r5.target), `→ ${longNode}`, "…naming the node in FULL");

          // ── DG-16 + DG-20: the name is FULL or GONE, and the gate is FIT.
          // `flex-1 truncate` does not drop — it stubs, and a one-to-three-glyph
          // workspace name communicates nothing while spending the row's
          // scarcest resource. A workspace name's PREFIX carries no meaning, so
          // it is the one element never truncated. But the gate may not be mere
          // chip-presence either (DG-20): that would make absence-of-name an
          // accidental second signal for "this card has an assignment", which
          // the chip already states. This fixture's workspace is `demo` — short
          // enough to fit — so it must STILL RENDER beside the chip.
          assert.ok(
            r5.workspaceName,
            "a name that FITS keeps rendering beside the chip — the gate is fit, not the chip's mere presence (DG-20)",
          );
          assert.equal(textOf(r5.workspaceName), "demo", "…and it renders WHOLE — never a stub of itself");
          assert.ok(
            "demo".length <= REGION5_NAME_BUDGET_CH,
            "…which is exactly why: it is inside region 5's derived name budget",
          );

          // ── DG-19: the placeholder `·` leaves once the chip occupies the
          // cluster. `·` stands in for an ABSENT token so the row is not empty;
          // with a chip present the row is not empty, and §2a already says the
          // chip replaces it. Rendering both left a lone `·` floating between
          // the chip and the drill-in, spending width the yield order then had
          // to claw back from higher-priority elements.
          assert.ok(
            !/(^|[^·])·(\s*)$/.test(textOf(r5.cluster).replace(/\s+/g, " ").trim()),
            `the placeholder \`·\` is gone once the chip speaks — got ${JSON.stringify(textOf(r5.cluster))}`,
          );

          // ── DG-15: `Open board →` is the next to yield, and it really CAN —
          // but it yields to its ABBREVIATED form, never to nothing. The words
          // shrink (their prefix still reads as "Open board", unlike a workspace
          // name's); the `→` glyph is pinned, so the affordance is never
          // invisible. The first cut of this fix let it collapse to zero width,
          // which trades an overprint for a vanished control.
          assert.ok(r5.drillIn, "the drill-in still renders");
          const drillIn = r5.drillIn.props?.className ?? "";
          assert.ok(!/\bshrink-0\b/.test(drillIn), "`Open board →` is NO LONGER pinned — a pinned neighbour is what forced the overprint");
          assert.match(drillIn, /\bshrink-1000\b/, "…absorbing essentially ALL the pressure before anything else moves");
          assert.ok(r5.drillIn.props?.title, "…with its label recoverable in the native `title`");
          // DG-19: and it carries an EXPLICIT floor sized to the arrow — the
          // picker-floor idiom (clause 2) one element to the right. Both
          // alternatives are defects, and both were measured, not reasoned:
          // `min-w-0` let the box shrink to ZERO while its own pinned `→`
          // overflowed it and sat outside the card's content box (the
          // shrink-0-inside-min-w-0 shape that caused DG-15); no min-width at
          // all made `min-width:auto` resolve to the box's FULL content width,
          // so it never yielded and the chip's target truncated instead.
          assert.ok(!/\bmin-w-0\b/.test(drillIn), "…never `min-w-0`: that lets the pinned `→` escape the card's content box");
          assert.match(
            drillIn,
            /\bmin-w-\d/,
            "…it carries an EXPLICIT floor instead — small enough to yield its words, large enough to hold its arrow (DG-19)",
          );

          const drillInParts = (r5.drillIn.children ?? []).filter((child) => child && typeof child === "object");
          assert.equal(drillInParts.length, 2, "the drill-in is TWO parts — the shrinkable words and the pinned glyph");
          const [words, glyph] = drillInParts;
          assert.match(words.props?.className ?? "", /\bmin-w-0\b/, "the WORDS are what give way");
          assert.match(words.props?.className ?? "", /\btruncate\b/, "…truncating inside their own box, never over a neighbour");
          assert.equal(textOf(words), "Open board", "…and they are the label's words alone");
          assert.match(glyph.props?.className ?? "", /\bshrink-0\b/, "the `→` glyph is PINNED — the abbreviated form the rule asks for");
          assert.equal(textOf(glyph), " →", "…so the affordance survives as `→` when the words cannot fit");
          assert.equal(textOf(r5.drillIn), "Open board →", "…and the un-pressed label is byte-identical to what it always read");

          // ── The tail — "all else" — still yields before the target.
          assert.ok(r5.tail, "the `· <when> · <note>` tail is its own element");
          assert.match(r5.tail.props?.className ?? "", /\btext-ellipsis\b/, "the tail is what truncates first inside the chip");
          assert.match(r5.tail.props?.className ?? "", /\bmin-w-0\b/, "…and may shrink to nothing");
          assert.match(r5.tail.props?.className ?? "", /\bshrink-1000000\b/, "…it yields even more readily than the drill-in");

          // ── The target: still the highest-priority element, but no longer
          // able to overprint. It yields LAST, and inside its own box.
          const target = r5.target.props?.className ?? "";
          assert.ok(
            !/\bshrink-0\b/.test(target),
            "the `→ <target>` is NOT `shrink-0`: that is exactly what let it overflow its `min-w-0` wrapper and paint over its neighbour (DG-15)",
          );
          assert.match(target, /\bmin-w-0\b/, "…it can shrink within its own box");
          assert.match(target, /\btruncate\b/, "…so an id that cannot fit is CLIPPED, never overprinted — no two elements share pixels");

          // The ORDER is the rule, and it is readable off the shrink factors
          // alone: tail (9999) yields before the drill-in (999), which yields
          // before the target (1). The target is last precisely because it is
          // the fact the chip exists to say.
          const factor = (className, fallback) => {
            const match = /\bshrink-(\d+)\b/.exec(className);
            return match ? Number(match[1]) : fallback;
          };
          const tailFactor = factor(r5.tail.props?.className ?? "", 1);
          const drillInFactor = factor(drillIn, 1);
          const targetFactor = factor(target, 1);
          assert.ok(
            tailFactor > drillInFactor && drillInFactor > targetFactor,
            `the yield order is tail > drill-in > target — got ${tailFactor} / ${drillInFactor} / ${targetFactor}`,
          );

          // …and the rendered TEXT is byte-identical to the single-slot version
          // this clause split in two: the split is a geometry change, not a copy
          // change.
          assert.match(textOf(r5.chipText), new RegExp(`^→ ${longNode} · `), "the chip's text still reads `→ <target> · <when>` — the split changed the geometry, not a character of the copy");
        });
      }, { nodes: [longNode] });
    },
  },

  // ══ DG-19's substance — at maximum pressure the tail DROPS, it does not stub ══
  //
  // The fourth verdict closed DG-19's box and its annihilated-affordance halves
  // and left this one open: the render still showed `· just…` — the LOWEST
  // priority element surviving as an ellipsised fragment — while the drill-in's
  // words, ranked ABOVE it, rendered zero glyphs. Shrink factors, however
  // lopsided, are a squeeze, and a squeeze cannot express a terminal drop. The
  // instrument is the derived budget this surface already uses twice.
  {
    name: "fleet-assign-row-geometry/07 DG-19: at maximum pressure the chip's tail is DROPPED WHOLE, never ellipsised to a fragment — the target keeps the room and nothing partial renders",
    async run() {
      const veryLongNode = "umairs-mac-mini-build-agent-02";
      // `→ ` + 30 + ` · just now` = 43ch against a 41ch slot, so the tail cannot
      // ride along and is dropped rather than cut.
      assert.ok(
        `→ ${veryLongNode} · just now`.length > REGION5_CHIP_SLOT_BUDGET_CH,
        "the fixture really does exceed the slot's budget — otherwise this lane proves nothing",
      );
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          await app.affordance("38").click();
          const r5 = region5(app.affordance("38").card);

          assert.equal(
            r5.tail,
            null,
            "the tail is GONE from the flow — not a `· just…` fragment, which is the DG-16 stub defect at a third address",
          );
          assert.equal(
            textOf(r5.chipText),
            `→ ${veryLongNode}`,
            "…and the target — the fact the chip exists to say — renders WHOLE in the room the tail gave up",
          );
          assert.ok(
            !/…/.test(textOf(r5.chipText)),
            "…with nothing ellipsised anywhere in the slot",
          );
          // Nothing is LOST: the `title` still carries the whole string, the same
          // idiom clause 3 uses for the server sentence.
          assert.match(
            r5.chipText.props?.title ?? "",
            /· just now/,
            "the `when` is not discarded — the wrapper's native `title` still carries the whole `→ <target> · <when>`",
          );
        });
      }, { nodes: [veryLongNode] });
    },
  },
];

// Traceability wiring for milestone 38 / story 04 / task 06 —
// tasks/06_assign-acknowledges-on-success.feature (@executable).
//
// F22, observed LIVE at the 2026-07-24 two-machine soak: a `200 ok` produced no
// transition, no pending indicator and no chip; the operator only knew the call
// had succeeded by reading the raw API response. DESIGN §Surface 2's
// "Amendment 2026-07-24 (F22, live soak)" decides BOTH treatments — (a) exactly
// ONE additional silent, keep-last-good status re-load so region 5's m35 chip
// lands within a round trip (A8), and (b) the SAME button reading `Sent`,
// `muted`, disabled, picker frozen, held one poll interval, then decaying to
// rest (A7).
//
// DRIVEN TWO WAYS, deliberately:
//   1. the PURE state machine (ui/src/fleet/assign-affordance.mjs) — the house
//      pattern, since this repo ships no React harness;
//   2. the REAL, UNMODIFIED production <Fleet/> component tree, mounted
//      headlessly against the REAL fleet face, with a real click going through
//      the real api client to the real route and minting a real record on a
//      CONTROLLABLE clock. This is the F-38.06e lesson honoured rather than
//      repeated: *"a state satisfied by calling the reducer directly proved
//      nothing, because production could never drive it."* A pure-helper lane
//      alone would be that defect class again.
//
// REVIEW FIXES (2026-07-24):
//   - QA-b — the two States rows that were reachable ONLY through the reducer
//     (`empty-roster`, `assigning`) are now ALSO read off the RENDERED tree.
//   - QA-c — the "the hold is one poll interval" claim is measured at both
//     CONSUMPTION sites (the app's own poll traffic, the app's own decay),
//     never at the definition where it is a tautology.
//   - F-D — the third, SOURCE-SHAPE lane (the component delegates to the helper;
//     the hold and the poll cadence are ONE number that cannot drift) has moved
//     to the milestone fitness
//     test/arch/acd-fleet-assign-targets-item-workspace.test.mjs. A structural
//     invariant sitting in story acceptance ages with the story.
//
// DG-14 / F-38.04f (2026-07-24, DESIGN §Surface 2 Amendment (b)) — the LAST
// block of lanes in this file arms the States table's NEW row, `timed out (no
// answer)`: a POST that never answers is a REFUSAL, not a limbo. It is driven
// the same way the rest of the file is — the REAL mounted app, a REAL POST to
// the REAL route, with only the response's DELIVERY held (the request is really
// issued and really answered; the app's own await simply stays pending, exactly
// as a hung round trip leaves it) on a controllable clock.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  POLL_MS,
  ASSIGN_SENT_HOLD_MS,
  ASSIGN_TIMEOUT_MS,
  ASSIGN_LABEL_REST,
  ASSIGN_LABEL_SENDING,
  ASSIGN_LABEL_SENT,
  ASSIGN_MESSAGE_TIMED_OUT,
  ASSIGN_DETAIL_TIMED_OUT,
  assignAtRest,
  assignAckExpired,
  assignAffordanceView,
  assignTimedOut,
  runAssign,
} from "../ui/src/fleet/assign-affordance.mjs";
import {
  withPublishedAssignFixture,
  sameOriginAssign,
  readAssignmentRows,
  advanceAssignmentState,
} from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSIGN_AFFORDANCE_MJS = path.join(repoRoot, "ui", "src", "fleet", "assign-affordance.mjs");

// withHungAssign(app, fn) — click "Assign →" with the route's ANSWER held, let
// the affordance's deadline elapse, and hand the caller the released-response
// handle so the LATE answer can be delivered afterwards. `advanceHeld` (not
// `advance`) is what makes this possible: `flush()` waits for every in-flight
// request to land, and a deliberately-held one never will — which is the exact
// condition DG-14 is about.
async function clickAndHang(app, ref = "38") {
  const held = app.holdNext("/api/mesh/assign");
  const inFlight = app.affordance(ref).clickDetached();
  await app.renderOnly();
  assert.ok(held.claimed(), "the assign POST really is in flight — the request is issued, only its answer is held");
  assert.equal(app.affordance(ref).actionLabel, ASSIGN_LABEL_SENDING, "…and the row is in flight while it hangs");
  // The REAL server answers here; the app never sees it. That is the honest
  // shape of the failure DG-14 is about — the dispatch may well have LANDED,
  // and the affordance simply never learns whether it did.
  await held.answered();
  await app.advanceHeld(ASSIGN_TIMEOUT_MS - 1);
  assert.equal(
    app.affordance(ref).actionLabel,
    ASSIGN_LABEL_SENDING,
    "one millisecond before the deadline the action still reads `Assigning…` — the affordance is still waiting",
  );
  assert.equal(app.affordance(ref).actionDisabled, true, "…and is still disabled");
  await app.advanceHeld(2);
  return { held, inFlight };
}

// A real browser POST, driven straight through the affordance's own orchestrator
// — the REAL route, so the state sequence is producer-SEQUENCED (F-38.06d), not
// a sequence the test invented.
function routeBackedAssign(url) {
  return async (ref, nodeId, workspaceId) => {
    const response = await fetch(new URL("/api/mesh/assign", url), {
      method: "POST",
      headers: { origin: new URL(url).origin, "content-type": "application/json" },
      body: JSON.stringify({ ref, nodeId, workspaceId }),
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error ?? `Request failed (${response.status})`);
      error.code = body.code;
      throw error;
    }
    return body;
  };
}

export const fleetAssignAcknowledgmentTests = [
  // ══ Scenario: acknowledged AT the action ══
  {
    name: "fleet-assign-acknowledgment/06 a successful assign is acknowledged AT the action — the REAL production affordance reads `Sent`, muted + disabled, picker frozen on the chosen node",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const rest = app.affordance("38");
          assert.ok(rest, "the affordance renders at rest");
          assert.equal(rest.actionLabel, ASSIGN_LABEL_REST);
          assert.equal(rest.selectedNode, "worker-a");
          assert.equal(rest.actionDisabled, false);
          assert.ok(/text-primary/.test(rest.actionClassName), "at rest the action carries the low-emphasis `primary` tint");
          const restRowChildren = rest.action ? 1 : 0;

          await rest.click();

          const sent = app.affordance("38");
          assert.equal(sent.actionLabel, ASSIGN_LABEL_SENT, "the SAME button reads `Sent`");
          assert.notEqual(sent.actionLabel, "Assigned", "`Assigned` is the m35 ramp's word for the assignment's STATE — the affordance never claims it");
          assert.ok(!/[✓✔]/.test(sent.actionLabel), "no mark is borrowed — `✓` is the ramp's mark for `done`");
          assert.equal(sent.actionDisabled, true, "the action is disabled — it has spent itself, and it guards a re-click");
          assert.ok(/bg-muted/.test(sent.actionClassName) && /text-muted-foreground/.test(sent.actionClassName), "the acknowledgment is in the `muted` ramp");
          assert.ok(
            !/text-primary/.test(sent.actionClassName) && !/bg-primary/.test(sent.actionClassName),
            "the `primary` tint is DROPPED, not added to — the quietest state the row ever renders (A9)",
          );
          assert.equal(sent.selectDisabled, true, "the picker is frozen");
          assert.equal(sent.selectedNode, "worker-a", "…on the CHOSEN node, so the row reads `Sent` beside the target's name — it is named for free");
          assert.equal(sent.message, null, "no message, no toast, no badge is added");
          assert.equal(sent.action ? 1 : 0, restRowChildren, "no new element appears in the row — it is a label swap inside the existing control (A10)");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: held one poll interval, then decays to rest ══
  {
    name: "fleet-assign-acknowledgment/06 the acknowledgment is held for EXACTLY one poll interval and then decays to the terminal resting state — selection preserved, nothing persists",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          await app.affordance("38").click();
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENT);

          await app.advance(ASSIGN_SENT_HOLD_MS - 1);
          const justBefore = app.affordance("38");
          assert.equal(justBefore.actionLabel, ASSIGN_LABEL_SENT, "one millisecond before the interval elapses the button still reads `Sent`");
          assert.equal(justBefore.actionDisabled, true, "…and is still disabled");

          await app.advance(2);
          const decayed = app.affordance("38");
          assert.equal(decayed.actionLabel, ASSIGN_LABEL_REST, "once the interval has elapsed the action is back to `Assign →`");
          assert.equal(decayed.actionDisabled, false, "…enabled");
          assert.ok(/text-primary/.test(decayed.actionClassName), "…in its `primary` tint");
          assert.equal(decayed.selectDisabled, false, "the picker is enabled again");
          assert.equal(decayed.selectedNode, "worker-a", "the SAME node is still selected — nothing resets");
          assert.equal(decayed.message, null, "the message slot is empty");
          assert.ok(!decayed.cardText.includes(ASSIGN_LABEL_SENT), "nothing of the acknowledgment persists anywhere on the card");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: `Assigning…` flows INTO `Sent` ══
  {
    name: "fleet-assign-acknowledgment/06 `Assigning…` flows INTO `Sent` — driven through the REAL route, the action never passes back through `Assign →` between them",
    async run() {
      await withPublishedAssignFixture(async ({ url, workspaceId }) => {
        const observed = [];
        const result = await runAssign(
          { assign: routeBackedAssign(url), onState: (next) => observed.push(next.phase) },
          { ref: "38/04", nodeId: "worker-a", workspaceId },
        );
        assert.equal(result.ok, true, "the REAL route answered 2xx");
        assert.deepEqual(observed, ["sending", "sent"], "the sequence a real dispatch produces is sending → sent, with no rest in between");

        assert.equal(assignAffordanceView({ phase: "sending", hasOptions: true, selected: "worker-a" }).actionLabel, ASSIGN_LABEL_SENDING);
        assert.equal(assignAffordanceView({ phase: "sending", hasOptions: true, selected: "worker-a" }).actionDisabled, true);
        assert.equal(
          assignAffordanceView({ phase: "sending", hasOptions: true, selected: "worker-a" }).holdMs,
          null,
          "`Assigning…` schedules no hold — it is an honest in-flight state, never the acknowledgment (it is sub-perceptual on a local POST)",
        );
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: EXACTLY ONE additional silent re-load ══
  {
    name: "fleet-assign-acknowledgment/06 a successful assign fires EXACTLY ONE additional SILENT status re-load — region 5's m35 `assigned` chip lands within a round trip, the board never unmounts, and no second cadence starts",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const before = app.statusLoads();
          const affordance = app.affordance("38");
          assert.ok(!affordance.cardText.includes("assigned"), "region 5 carries no assignment chip before the click");

          await affordance.click();

          assert.equal(app.assignPosts(), 1, "exactly one assign POST");
          assert.equal(
            app.statusLoads() - before,
            1,
            "EXACTLY ONE additional GET /api/mesh/status — no more, no fewer (A8: one load, not a new cadence and not a retry ladder)",
          );

          const after = app.affordance("38");
          assert.ok(
            after.cardText.includes("assigned") && after.cardText.includes("worker-a"),
            `region 5 renders the m35 \`assigned\` chip naming the target WITHOUT waiting for the next scheduled poll — got ${JSON.stringify(after.cardText)}`,
          );
          // A non-silent load would flip the page into its loading state and
          // unmount the populated board — a far worse answer than saying nothing.
          assert.ok(after.action != null, "the board did not unmount — the re-load was the SILENT, keep-last-good one");

          // Over the following poll interval the app makes exactly the ONE
          // scheduled poll it would have made anyway: no second cadence.
          const beforeIdle = app.statusLoads();
          await app.advance(POLL_MS);
          assert.equal(app.statusLoads() - beforeIdle, 1, "over the next poll interval exactly ONE scheduled poll fires — the steady state is unchanged");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: a REFUSED assign gets the inline destructive error, no `Sent` ══
  {
    name: "fleet-assign-acknowledgment/06 a REFUSED assign gets the inline `destructive` error and NO acknowledgment — no `Sent`, no hold, no extra re-load, the action enabled again at once",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        // The verb's own single-runner gate does the refusing — a REAL coded
        // refusal, not a synthesized failure.
        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200, "the item already has an active assignment");
        assert.equal((await readAssignmentRows({ home }, workspaceId, "38")).length, 1);

        await withFleetApp({ url }, async (app) => {
          const before = app.statusLoads();
          await app.affordance("38").click();

          const refused = app.affordance("38");
          assert.notEqual(refused.actionLabel, ASSIGN_LABEL_SENT, "a refusal is NEVER acknowledged as `Sent`");
          assert.equal(refused.actionLabel, ASSIGN_LABEL_REST, "the action reads `Assign →` again");
          assert.equal(refused.actionDisabled, false, "…and is enabled again at once — there is no hold");
          assert.equal(refused.selectDisabled, false, "the picker is enabled again");
          assert.ok(refused.message, "the verb's coded refusal is surfaced inline");
          // DG-17: the copy is a LADDER, so which rung renders depends on the
          // holder's length — but every rung names the verb's own cause (the
          // outcome, the holder, or both), and never a generic "Assign failed".
          assert.match(refused.message, /already|active|assigned|held by|worker-a/i, `the inline message names the verb's own cause — got ${JSON.stringify(refused.message)}`);
          assert.equal(app.statusLoads() - before, 0, "NO additional status re-load was fired for the refusal");
          assert.equal(
            (await readAssignmentRows({ home }, workspaceId, "38")).length,
            1,
            "still exactly one row — the refused click minted nothing",
          );
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: the affordance never claims the ASSIGNMENT's state ══
  {
    name: "fleet-assign-acknowledgment/06 the affordance never claims the ASSIGNMENT's state — a dispatch that is sent and then FAILS leaves region 5 speaking the failure alone",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        await withFleetApp({ url }, async (app) => {
          await app.affordance("38").click();
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENT, "the CALL was acknowledged");

          // The soak's own sequence: sent, and then the assignment fails ~1.5s
          // later. Both statements stay true on screen — which is exactly why
          // the word is `Sent` and not `Assigned`.
          const rows = await readAssignmentRows({ home }, workspaceId, "38");
          assert.equal(rows.length, 1);
          await advanceAssignmentState({ home }, rows[0].assignment_id, "failed", { now: "2026-07-24T12:10:00.000Z" });

          await app.advance(POLL_MS);
          const settled = app.affordance("38");
          assert.ok(settled.cardText.includes("failed"), `region 5's m35 chip speaks the failure — got ${JSON.stringify(settled.cardText)}`);
          assert.equal(settled.actionLabel, ASSIGN_LABEL_REST, "the affordance decayed on its own schedule and never mirrored the lifecycle");
          assert.equal(settled.message, null, "a spent control does not re-report a lifecycle it no longer owns");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: the hold IS the poll interval, by construction ══
  //
  // REVIEW FIX QA-c (2026-07-24) — this lane used to open with
  // `assert.equal(ASSIGN_SENT_HOLD_MS, POLL_MS)`, which is a TAUTOLOGY
  // (`export const ASSIGN_SENT_HOLD_MS = POLL_MS`): it asserts the claim at the
  // DEFINITION, where it cannot fail, and nothing asserted it at the
  // CONSUMPTION site. `setInterval(…, POLL_MS)` in Fleet.tsx was unpinned, so
  // changing that one argument to anything in (POLL_MS/2, POLL_MS) would break
  // "the hold is one poll interval" with every lane still green. Both windows
  // are therefore MEASURED here, on the REAL mounted app's own controllable
  // clock, at the sites that consume them.
  //
  // REVIEW FIX F-D — the SOURCE-SHAPE half of this lane (the component
  // delegates to the helper; the hold and the cadence are one number that cannot
  // drift) has MOVED to the milestone fitness
  // test/arch/acd-fleet-assign-targets-item-workspace.test.mjs, where a
  // structural invariant belongs: a structural assertion living in story
  // acceptance ages with the story instead of standing as an invariant.
  {
    name: "fleet-assign-acknowledgment/06 the hold IS one poll interval, MEASURED at both consumption sites — the mounted app polls on exactly POLL_MS, and the acknowledgment decays on exactly that same window",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          // (a) the CADENCE, measured off the app's ACTUAL traffic: a scheduled
          // poll has NOT fired one millisecond before the interval, and EXACTLY
          // one has fired two milliseconds later. Any other literal in the
          // component — larger or smaller — moves one of these two counts.
          const before = app.statusLoads();
          await app.advance(POLL_MS - 1);
          assert.equal(app.statusLoads() - before, 0, "no scheduled poll has fired one millisecond before the interval elapses");
          await app.advance(2);
          assert.equal(app.statusLoads() - before, 1, "…and EXACTLY one has fired once it has — the cadence is POLL_MS at the site that schedules it, not only at the site that exports it");

          // (b) the HOLD, measured on the SAME clock, through a real click.
          await app.affordance("38").click();
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENT);
          await app.advance(ASSIGN_SENT_HOLD_MS - 1);
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENT, "the acknowledgment still stands one millisecond before its window elapses");
          await app.advance(2);
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_REST, "…and has decayed once it has");
        });
      }, { nodes: ["worker-a"] });

      // The two MEASURED windows above are the same number — which is the point:
      // the worst case for the next scheduled poll landing after a click is
      // exactly one interval, so a hold of one interval guarantees there is never
      // a moment between the click and a confirmation in which the surface says
      // nothing.
      assert.equal(ASSIGN_SENT_HOLD_MS, POLL_MS);
      assert.equal(assignAffordanceView({ phase: "sent", hasOptions: true, selected: "worker-a" }).holdMs, POLL_MS);
    },
  },

  // ══ the States table's two REDUCER-ONLY rows, read off the RENDERED tree ══
  //
  // REVIEW FIX QA-b (2026-07-24) — the F-38.06e shape, narrowly: `empty-roster`
  // and `assigning` were asserted ONLY through `assignAffordanceView(...)`, while
  // task 06's Background says "the REAL production <Fleet/> mounted against it",
  // so the scenario READ as component-driven when it was not. The harness could
  // do both all along: an empty-roster fixture renders the real disabled row, and
  // holding the response's DELIVERY makes the in-flight state readable between
  // the click's synchronous `onState(sending)` and the awaited fetch.
  {
    name: "fleet-assign-acknowledgment/06 the States table's `empty-roster` row, read off the REAL rendered tree — the production picker is disabled with its ONE honest placeholder and no invented target",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const empty = app.affordance("38");
          assert.ok(empty, "the card still renders its affordance row when there is nothing to assign to — never hidden");
          assert.deepEqual(empty.options, [""], "no node option at all — and no invented `any`/placeholder TARGET the verb would refuse");
          assert.equal(empty.pickerPlaceholder, "No worker nodes yet", "the one honest placeholder");
          assert.equal(empty.selectDisabled, true, "the picker is disabled");
          assert.equal(empty.actionDisabled, true, "…and so is the action — there is nothing to dispatch to");
          assert.equal(empty.actionLabel, ASSIGN_LABEL_REST, "the action still reads its rest label — an empty roster is not an error state");
          assert.ok(/text-primary/.test(empty.actionClassName), "…in the `primary` tint (the `muted` ramp is the acknowledgment's alone)");
          assert.equal(empty.message, null, "no message: 'nothing to assign to' is not a refusal");
        });
      });
    },
  },
  {
    name: "fleet-assign-acknowledgment/06 the States table's `assigning` row, read off the REAL rendered tree MID-FLIGHT — between the click's own state change and the route's answer",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          // The POST is really issued to the real route; only its DELIVERY back
          // to the app is held, exactly as a slow round trip holds it.
          const held = app.holdNext("/api/mesh/assign");
          const inFlight = app.affordance("38").clickDetached();
          await app.renderOnly();
          assert.ok(held.claimed(), "the assign POST really is in flight — the response is issued but not yet delivered");

          const assigning = app.affordance("38");
          assert.equal(assigning.actionLabel, ASSIGN_LABEL_SENDING, "the REAL component renders `Assigning…` while the call is out");
          assert.equal(assigning.actionDisabled, true, "…disabled");
          assert.equal(assigning.selectDisabled, true, "…with the picker frozen");
          assert.equal(assigning.selectedNode, "worker-a", "…on the chosen node");
          assert.equal(assigning.message, null, "no message slot in flight");
          assert.ok(
            /text-primary/.test(assigning.actionClassName) && !/bg-muted/.test(assigning.actionClassName),
            "the in-flight state is NOT the `muted` acknowledgment — `Assigning…` is an honest pending state, never the confirmation",
          );

          held.release();
          await inFlight.settle();
          assert.equal(app.affordance("38").actionLabel, ASSIGN_LABEL_SENT, "…and it flows straight into `Sent` once the answer lands");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ the pure state machine — the States table, exhaustively ══
  {
    name: "fleet-assign-acknowledgment/06 the affordance's own state axis — every row of the DESIGN States table derives exactly one view, and only `sent` schedules a hold",
    async run() {
      const rows = [
        { state: "empty-roster", ctx: { phase: "rest", hasOptions: false, selected: "" }, label: ASSIGN_LABEL_REST, actionDisabled: true, pickerDisabled: true, tone: "primary", placeholder: "No worker nodes yet", message: null, holdMs: null },
        { state: "one-node / many-nodes (at rest)", ctx: { phase: "rest", hasOptions: true, selected: "worker-a" }, label: ASSIGN_LABEL_REST, actionDisabled: false, pickerDisabled: false, tone: "primary", placeholder: null, message: null, holdMs: null },
        { state: "assigning", ctx: { phase: "sending", hasOptions: true, selected: "worker-a" }, label: ASSIGN_LABEL_SENDING, actionDisabled: true, pickerDisabled: true, tone: "primary", placeholder: null, message: null, holdMs: null },
        { state: "sent", ctx: { phase: "sent", hasOptions: true, selected: "worker-a" }, label: ASSIGN_LABEL_SENT, actionDisabled: true, pickerDisabled: true, tone: "muted", placeholder: null, message: null, holdMs: ASSIGN_SENT_HOLD_MS },
        { state: "refused", ctx: { phase: "refused", error: "Node \"ghost\" is not registered.", hasOptions: true, selected: "worker-a" }, label: ASSIGN_LABEL_REST, actionDisabled: false, pickerDisabled: false, tone: "primary", placeholder: null, message: "Node \"ghost\" is not registered.", holdMs: null },
      ];
      for (const row of rows) {
        const view = assignAffordanceView(row.ctx);
        assert.equal(view.actionLabel, row.label, `${row.state}: action label`);
        assert.equal(view.actionDisabled, row.actionDisabled, `${row.state}: action disabled`);
        assert.equal(view.pickerDisabled, row.pickerDisabled, `${row.state}: picker disabled`);
        assert.equal(view.actionTone, row.tone, `${row.state}: action tone`);
        assert.equal(view.pickerPlaceholder, row.placeholder, `${row.state}: picker placeholder`);
        assert.equal(view.message, row.message, `${row.state}: message slot`);
        assert.equal(view.messageTone, row.message ? "destructive" : null, `${row.state}: message tone`);
        assert.equal(view.holdMs, row.holdMs, `${row.state}: only \`sent\` schedules a hold`);
      }

      // A9 — the ONLY tones this affordance ever speaks.
      const tones = new Set(rows.map((row) => assignAffordanceView(row.ctx).actionTone));
      assert.deepEqual([...tones].sort(), ["muted", "primary"], "no new colour primitive — only the existing tokens");

      // The decay only ever fires from `sent`: a refused error must stand until
      // the next attempt, and a stray timer can never blank an in-flight call.
      assert.deepEqual(assignAckExpired({ phase: "sent", error: null }), assignAtRest());
      assert.deepEqual(assignAckExpired({ phase: "refused", error: "boom" }), { phase: "refused", error: "boom" });
      assert.deepEqual(assignAckExpired({ phase: "sending", error: null }), { phase: "sending", error: null });
    },
  },

  // ══ runAssign — exactly one onAssigned, only on success ══
  {
    name: "fleet-assign-acknowledgment/06 runAssign fires onAssigned EXACTLY ONCE and ONLY on a 2xx — driven against the REAL route for both legs",
    async run() {
      await withPublishedAssignFixture(async ({ url, workspaceId }) => {
        let reloads = 0;
        const success = await runAssign(
          { assign: routeBackedAssign(url), onAssigned: () => { reloads += 1; }, onState: () => {} },
          { ref: "38/04", nodeId: "worker-a", workspaceId },
        );
        assert.equal(success.ok, true);
        assert.equal(reloads, 1, "exactly ONE re-load on a real 2xx");

        // The REAL single-runner gate refuses the second one.
        const observed = [];
        const refused = await runAssign(
          { assign: routeBackedAssign(url), onAssigned: () => { reloads += 1; }, onState: (next) => observed.push(next.phase) },
          { ref: "38/04", nodeId: "worker-a", workspaceId },
        );
        assert.equal(refused.ok, false, "the REAL verb gate refused the second dispatch");
        assert.equal(reloads, 1, "a refusal fires NO re-load — the count is unchanged");
        assert.deepEqual(observed, ["sending", "refused"], "a refusal goes sending → refused, never through `sent`");
      }, { nodes: ["worker-a"] });
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DG-14 / F-38.04f — a hung POST is a REFUSAL, not a limbo.
  // DESIGN §Surface 2 Amendment 2026-07-24 (b); the amended A7; the NEW States
  // row `timed out (no answer) — a leg of refused`.
  // ══════════════════════════════════════════════════════════════════════════

  // ══ Scenario: the hung POST lands in the EXISTING refused presentation ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: a POST that never answers TIMES OUT into the EXISTING `refused` presentation, verbatim — picker re-enabled on the same node, `Assign →` back in its `primary` tint, inline `destructive`, no `Sent`, no hold",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const { held, inFlight } = await clickAndHang(app);

          const out = app.affordance("38");
          // The row reads the state the design ALREADY has — no new vocabulary.
          assert.equal(out.actionLabel, ASSIGN_LABEL_REST, "the action is back to `Assign →`");
          assert.notEqual(out.actionLabel, ASSIGN_LABEL_SENT, "a timed-out call is NEVER acknowledged as `Sent`");
          assert.equal(out.actionDisabled, false, "…enabled: the row was never wedged");
          assert.ok(/text-primary/.test(out.actionClassName), "…in its `primary` tint (the `muted` ramp stays the acknowledgment's alone)");
          assert.equal(out.selectDisabled, false, "the picker is re-enabled");
          assert.equal(out.selectedNode, "worker-a", "…with the SAME node still selected — the selection is kept, so a re-aim starts from where the operator was");
          assert.ok(out.message, "an inline message stands — never a frozen `Assigning…` with an empty message slot");
          assert.ok(/text-destructive/.test(out.messageClassName), "…in the `destructive` token the refused state already uses (A9: no new colour primitive)");
          assert.equal(
            assignAffordanceView({ phase: "refused", error: ASSIGN_MESSAGE_TIMED_OUT, hasOptions: true, selected: "worker-a" }).holdMs,
            null,
            "no hold is scheduled — the timeout is a leg of `refused`, and a refusal stands until the next attempt",
          );
          assert.ok(!out.cardText.includes(ASSIGN_LABEL_SENT), "`destructive` and `Sent` may never co-exist");

          held.release();
          await inFlight.settle();
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: the copy reports the CALL, never the assignment ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: the copy is `no answer — timed out` — never \"not sent\", never \"failed\" — and region 5's poll still lands the chip on its own, because the dispatch DID reach the server",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        await withFleetApp({ url }, async (app) => {
          const { held, inFlight } = await clickAndHang(app);

          const out = app.affordance("38");
          assert.equal(out.message, ASSIGN_MESSAGE_TIMED_OUT, "the copy is the designer's, verbatim");
          assert.ok(
            !/not sent|failed|refused|rejected|nothing/i.test(out.message),
            `the message must NOT claim nothing was assigned — a timed-out POST may have succeeded server-side. Got ${JSON.stringify(out.message)}`,
          );
          assert.equal(out.messageTitle, ASSIGN_DETAIL_TIMED_OUT, "the full text sits in the slot's native `title`");
          assert.match(out.messageTitle, /may still have succeeded/i, "…and it says the outcome is UNKNOWN, not negative");
          assert.match(out.messageTitle, /poll remains the authority/i, "…naming region 5's poll as the authority (A7's boundary: the affordance reports the CALL)");

          // The request really reached the server — the hold delays only the
          // ANSWER — so the record is there, and the surface's own poll is what
          // says so. This is exactly why the copy may not say "not sent".
          assert.equal(
            (await readAssignmentRows({ home }, workspaceId, "38")).length,
            1,
            "the dispatch DID land: the affordance abandoned its WAIT, not the call",
          );
          assert.ok(
            out.cardText.includes("assigned") && out.cardText.includes("worker-a"),
            `region 5 remains the sole authority and has already spoken for itself — the poll kept running underneath. Got ${JSON.stringify(out.cardText)}`,
          );

          held.release();
          await inFlight.settle();
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: the deadline is 2 × POLL_MS, measured at its consumption site ══
  //
  // Measured on the MOUNTED app's own clock, at the site that consumes it —
  // never at the definition, where `POLL_MS * 2` is a tautology. The `Assigning…`
  // assertions at deadline-1ms live in clickAndHang(), so every lane in this
  // block re-measures the window rather than trusting one of them to.
  {
    name: "fleet-assign-acknowledgment/06 DG-14: the deadline is EXACTLY two poll intervals, measured on the mounted app's own clock — derived from the one constant the surface speaks in, never a second literal",
    async run() {
      assert.equal(ASSIGN_TIMEOUT_MS, POLL_MS * 2, "the deadline is TWO poll intervals");
      assert.equal(ASSIGN_TIMEOUT_MS, ASSIGN_SENT_HOLD_MS * 2, "…i.e. twice the `Sent` hold — one family of windows, one number");

      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          // clickAndHang asserts `Assigning…` at deadline-1ms; here we assert the
          // flip at deadline+1ms, so the window is bracketed on both sides.
          const { held, inFlight } = await clickAndHang(app);
          assert.equal(app.affordance("38").message, ASSIGN_MESSAGE_TIMED_OUT, "…and the refusal lands the millisecond the window closes");
          held.release();
          await inFlight.settle();
        });
      }, { nodes: ["worker-a"] });

      // The SOURCE shape of clause 6, which no behavioural lane can see: the
      // deadline abandons the affordance's WAIT, never the call. An
      // AbortController-driven cancel would make a possibly-successful
      // server-side mint ambiguous — and clause 3's whole point is that the
      // call's outcome is unknown and the surface should say so honestly.
      const source = await readFile(ASSIGN_AFFORDANCE_MJS, "utf8");
      const code = source.replace(/\/\/[^\n]*/g, "");
      assert.ok(!/AbortController/.test(code), "no AbortController — the timeout abandons the WAIT, not the CALL (DG-14 clause 6)");
      assert.ok(!/\.abort\s*\(/.test(code), "nothing is aborted");
      assert.ok(!/setInterval\s*\(/.test(code), "no second cadence is started by the timeout (DG-14 clause 6)");
      assert.match(
        code,
        /export const ASSIGN_TIMEOUT_MS = POLL_MS \* 2;/,
        "the deadline is DERIVED from the cadence constant — pinned exactly the way ASSIGN_SENT_HOLD_MS is (DG-14 clause 1)",
      );
      assert.ok(
        !new RegExp(`\\b${ASSIGN_TIMEOUT_MS}\\b`).test(code),
        "…and the window never appears anywhere as a literal, so there is no second copy of the number to drift",
      );
    },
  },

  // ══ Scenario: the timeout abandons the WAIT, not the CALL ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: the timeout starts no retry, no second dispatch and no second cadence — EXACTLY ONE assign POST leaves the app across the whole episode",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        await withFleetApp({ url }, async (app) => {
          const { held, inFlight } = await clickAndHang(app);
          assert.equal(app.assignPosts(), 1, "exactly ONE assign POST at the deadline — the timeout fires no retry");

          held.release();
          await inFlight.settle();
          assert.equal(app.assignPosts(), 1, "…and still exactly one after the late answer lands — no retry ladder");
          assert.equal(
            (await readAssignmentRows({ home }, workspaceId, "38")).length,
            1,
            "…and exactly ONE record was ever minted: a retry would have collected a `destructive` refusal against the surface's own first dispatch",
          );

          // No second cadence: over the following poll interval the app makes
          // exactly the ONE scheduled poll it would have made anyway.
          const before = app.statusLoads();
          await app.advance(POLL_MS);
          assert.equal(app.statusLoads() - before, 1, "the steady state is unchanged — one scheduled poll, no second cadence");
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: a LATE 2xx is TERMINAL for the affordance ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: a LATE 2xx is TERMINAL for the affordance — it never resurrects `Sent` and never clears the error; it is honoured ONLY by A8's one silent keep-last-good re-load",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        await withFleetApp({ url }, async (app) => {
          const { held, inFlight } = await clickAndHang(app);
          assert.equal(app.affordance("38").message, ASSIGN_MESSAGE_TIMED_OUT);

          const before = app.statusLoads();
          held.release();
          await inFlight.settle();

          const late = app.affordance("38");
          assert.notEqual(late.actionLabel, ASSIGN_LABEL_SENT, "the late 2xx does NOT resurrect `Sent`");
          assert.equal(late.actionLabel, ASSIGN_LABEL_REST, "the action stays at rest");
          assert.equal(late.message, ASSIGN_MESSAGE_TIMED_OUT, "…and the message the operator is reading is NOT cleared out from under them");
          assert.ok(!late.cardText.includes(ASSIGN_LABEL_SENT), "`destructive` and `Sent` may never co-exist");
          assert.equal(
            app.statusLoads() - before,
            1,
            "EXACTLY ONE additional silent keep-last-good re-load — the ONE thing a late 2xx is honoured by, so region 5 gets its chip",
          );
          assert.ok(late.action != null, "the board did not unmount — it is the SILENT load, the same one the ⟳ control fires");
          assert.ok(
            late.cardText.includes("assigned") && late.cardText.includes("worker-a"),
            `region 5 carries the m35 chip — the durable record, spoken by region 5 alone. Got ${JSON.stringify(late.cardText)}`,
          );
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: a LATE non-2xx changes nothing at all ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: a LATE non-2xx changes NOTHING — it does not overwrite the timed-out message the operator is already reading, and it fires no re-load",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        // The verb's OWN single-runner gate does the refusing — a real coded
        // refusal that arrives AFTER the affordance has stopped waiting.
        const first = await sameOriginAssign(url, "38", "worker-a", "OWN");
        assert.equal(first.status, 200, "the item already has an active assignment");

        await withFleetApp({ url }, async (app) => {
          const { held, inFlight } = await clickAndHang(app);
          assert.equal(app.affordance("38").message, ASSIGN_MESSAGE_TIMED_OUT);

          const before = app.statusLoads();
          held.release();
          await inFlight.settle();

          const late = app.affordance("38");
          assert.equal(
            late.message,
            ASSIGN_MESSAGE_TIMED_OUT,
            `a late REFUSAL does not replace the message already on screen — the operator's answer must not change under them. Got ${JSON.stringify(late.message)}`,
          );
          assert.notEqual(late.actionLabel, ASSIGN_LABEL_SENT, "…and certainly no `Sent`");
          assert.equal(app.statusLoads() - before, 0, "NO status re-load is fired for a late non-2xx");
          assert.equal(
            (await readAssignmentRows({ home }, workspaceId, "38")).length,
            1,
            "…and the refused dispatch minted nothing (still exactly the one pre-existing row)",
          );
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ Scenario: the message stands, and a RE-CLICK is permitted ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: the timed-out message STANDS until the next attempt, and a re-click is permitted — if the dispatch DID land, it draws the ordinary `already assigned → <node>` refusal, a correct answer rather than a new failure mode",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        await withFleetApp({ url }, async (app) => {
          const { held, inFlight } = await clickAndHang(app);
          held.release();
          await inFlight.settle();
          assert.equal(app.affordance("38").message, ASSIGN_MESSAGE_TIMED_OUT, "the message stands until the next attempt");

          // The re-click: the row was never wedged, so this is possible at all.
          await app.affordance("38").click();

          const again = app.affordance("38");
          assert.equal(
            again.message,
            "refused · worker-a",
            `the ordinary refusal comes back, naming the HOLDER WHOLE — the fact no other region carries (DG-13 clause 4, as superseded by DG-17's ladder). Got ${JSON.stringify(again.message)}`,
          );
          assert.ok(again.message.includes("worker-a"), "…the holder is present in full, never a prefix of it");
          assert.equal(again.actionLabel, ASSIGN_LABEL_REST, "…the action is enabled again at once");
          assert.equal(again.actionDisabled, false);
          assert.equal(
            (await readAssignmentRows({ home }, workspaceId, "38")).length,
            1,
            "…and the re-click minted nothing: it is a correct answer to a correct question, not a second dispatch",
          );
        });
      }, { nodes: ["worker-a"] });
    },
  },

  // ══ the pure state machine — the NEW States row derives the refused view ══
  {
    name: "fleet-assign-acknowledgment/06 DG-14: `assignTimedOut()` IS the refused state — the same phase, so the row's whole presentation is literally the same derivation, only the copy differs",
    async run() {
      const timedOut = assignTimedOut();
      assert.equal(timedOut.phase, "refused", "the timeout is a LEG of `refused`, not a new state");
      assert.equal(timedOut.error, ASSIGN_MESSAGE_TIMED_OUT);
      assert.equal(timedOut.detail, ASSIGN_DETAIL_TIMED_OUT);

      const view = assignAffordanceView({ ...timedOut, hasOptions: true, selected: "worker-a" });
      const gateMiss = assignAffordanceView({ phase: "refused", error: "refused · worker-a", detail: "…", hasOptions: true, selected: "worker-a" });
      for (const key of ["pickerDisabled", "actionLabel", "actionDisabled", "actionTone", "messageTone", "holdMs", "actionWidth", "pickerMinWidth"]) {
        assert.deepEqual(view[key], gateMiss[key], `the timed-out leg renders the refused presentation VERBATIM: ${key}`);
      }
      assert.equal(view.actionLabel, ASSIGN_LABEL_REST);
      assert.equal(view.actionDisabled, false);
      assert.equal(view.holdMs, null, "no hold");
      assert.equal(view.messageTone, "destructive");

      // A decay timer can never blank it: only `sent` decays.
      assert.deepEqual(assignAckExpired(timedOut), timedOut, "a timed-out refusal stands until the next attempt");
    },
  },
];

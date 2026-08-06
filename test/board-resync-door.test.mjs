// Traceability wiring for milestone 43 / story 04 / task 05 —
// tasks/05_resync-requests-fresh-push.feature (@executable).
//
// ONE door per item, on the detail panel's provenance line, present only while
// there is something to repair; it reports the CALL while the provenance line
// reports the DATA; there is NO SUCCESS TOAST, because the badge clearing and the
// age resetting are the only honest proof a push actually landed; and the
// in-flight state is BOUNDED on BOTH legs.
//
// DRIVEN END TO END, PRODUCER-FED. The REAL <Board/> is mounted headlessly
// against the REAL board face on a controllable clock; a real click goes through
// the real api client to the REAL `POST /api/work/resync`, which invokes the REAL
// `work:resync` command against the REAL store — and the REAL control-daemon
// drain (`runResyncDispatchTick`) settles the request row. The ONLY thing stood
// in for is the FABRIC: which node holds a connected admitted socket, and whether
// a dispatch onto it completes. That is a thing a single-process fixture cannot
// BE. Everything downstream of it — the request row, the coded outcomes, the
// route, the command — is production.
//
// WHY "NO SUCCESS TOAST" IS AN ASSERTION AND NOT A STYLE NOTE. `Requested` means
// the request went out; only the age resetting and the badge clearing prove a
// fresh copy arrived. A success toast would confirm the CLICK and let the
// operator believe the DATA is fresh — the exact lie class this board has already
// paid for twice. It is the m38 F22 rule verbatim: "it reports the CALL; region 5
// reports the ASSIGNMENT."
//
// WHY THE DOOR IS COUNTED RATHER THAN INSPECTED. The lane card and the overview
// milestone card are themselves `<button data-card>` elements, and an HTML
// `<button>` may never nest another interactive element (m38/ADR-012). So "no
// Resync on the cards" is a CORRECTNESS constraint, not a preference a future
// designer could revisit — and it is asserted by counting the controls across the
// WHOLE rendered tree rather than by inspecting one component.
//
// ── THE ONE TIMING FACT THIS FILE DEPENDS ON, STATED HONESTLY ───────────────
// `work:resync` writes its request row and reads it back SYNCHRONOUSLY, so the
// first read always sees `requested` and the command always sleeps at least once
// on the board's controllable clock. `face.awaitDispatch(ref)` gates on the REAL
// daemon having drained the queue before the lane advances that clock, so the
// command's first wake is also its last. That is the fixture reproducing the
// real ordering (an always-on daemon, draining on the machine's own clock), not
// a test working around one.
import assert from "node:assert/strict";
import {
  RESYNC_LABEL_ACCEPTED,
  RESYNC_LABEL_IDLE,
  RESYNC_LABEL_SENDING,
  RESYNC_LABEL_WIDTH_CH,
  RESYNC_REQUEST_INTERVALS,
  RESYNC_WATCH_INTERVALS,
} from "../ui/src/board/resync.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp, BOARD_EPOCH, findAll, visibleTextOf } from "./support/board-app-harness.mjs";

const NODE = "umairs-mac-mini";
const at = (secondsFromNow) => new Date(BOARD_EPOCH + secondsFromNow * 1000).toISOString();

// The board's OWN list-poll cadence, MEASURED at its consumption site rather
// than restated as a literal here (the m38 QA-c correction). The board's
// pre-existing run-status probe rides exactly that cadence, so the gaps between
// its polling rounds ARE the interval — read off the app's own traffic.
async function measurePollInterval(app) {
  const mark = app.requests().length;
  await app.advance(60_000);
  const rounds = [...new Set(app.requests().slice(mark).map((entry) => entry.at))].sort((a, b) => a - b);
  const gaps = [...new Set(rounds.slice(1).map((value, index) => value - rounds[index]))];
  assert.equal(gaps.length, 1, `the board polls on ONE cadence (saw gaps ${JSON.stringify(gaps)})`);
  return gaps[0];
}

// Let the REAL server finish answering a HELD request. The request is genuinely
// issued and genuinely processed — only its DELIVERY to the app stays pending,
// exactly as a slow round trip leaves it — but the command's own poll loop rides
// the board's controllable clock, so it needs an advance to wake. `advanceHeld`
// is what makes that possible: plain `flush()` waits for every in-flight request
// to land, and a deliberately-held one never will.
async function serverAnswers(app, face, held, ref = "43/04") {
  await face.awaitDispatch(ref);
  await app.advanceHeld(1000);
  await held.answered();
}

// Click Resync and settle the episode, returning the app-clock instant the
// acknowledgement actually landed at — so every hold and window below is
// measured from where it is CONSUMED.
async function clickResync(app, face, ref = "43/04") {
  const pending = app.detail().resync.clickDetached();
  await app.renderOnly();
  await face.awaitDispatch(ref);
  let landedAt = null;
  for (let step = 0; step < 40 && landedAt == null; step += 1) {
    await app.advance(100);
    if (app.detail().resync?.label !== RESYNC_LABEL_SENDING) landedAt = app.nowMs();
  }
  await pending.settle();
  assert.ok(landedAt != null, "the resync episode answered");
  return landedAt;
}

export const boardResyncDoorTests = [
  // ══ Scenario: exactly ONE Resync control exists for the item, and it is the
  //    last control on the provenance line ══
  {
    name: "board-resync/05 exactly ONE Resync control exists across the lanes, the overview, the panel and the fleet — inside the provenance box, following the provenance text, carrying `⟳` and never `↻`",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        // The OVERVIEW grid first — every surface the item appears on.
        await withBoardApp({ url: face.url }, async (app) => {
          assert.ok(app.overviewCard("43").badge, "the overview card carries the badge (non-vacuous)");
          assert.equal(app.resyncControls().length, 0, "the overview grid holds NO Resync — its milestone card is itself a <button>");
          assert.equal(app.overviewCard("43").buttons.length, 0, "…and nests no button at all");

          await app.openMilestone("43");
          await app.selectCard("43/04");

          // …the lanes view, the overview grid, the detail panel and the fleet
          // card are all rendered for the stale item.
          assert.ok(app.laneCard("43/04").badge, "the lane card carries the badge (non-vacuous)");
          const controls = app.resyncControls();
          assert.equal(controls.length, 1, "exactly ONE Resync control exists across all of them");

          const detail = app.detail();
          assert.ok(detail.resync, "…and it is inside the detail panel's provenance box, on line 2");
          assert.equal(controls[0].node, detail.resync.node, "…the same one element");

          // DOM ORDER on the line: the provenance text, then the control, then
          // the message slot.
          const order = detail.provenanceRowChildren;
          assert.equal(order.length, 3, "line 2 holds exactly the label, the control and the message slot");
          assert.equal(order[0], detail.provenanceLabel, "the provenance label is FIRST");
          assert.equal(order[1], detail.resync.node, "…the Resync control FOLLOWS the provenance text in DOM order");
          assert.equal(order[2], detail.messageSlot.node, "…and the message slot follows it");

          // Not on the cards, not on a gate bar, not in the actions strip.
          assert.equal(app.laneCard("43/04").buttons.length, 0, "there is no Resync on the lane card — it nests no interactive element at all");
          assert.equal(app.actionsStrip().resyncControls.length, 0, "there is no Resync in the footer actions strip…");
          assert.deepEqual(
            app.actionsStrip().buttons,
            ["+ Add feedback", "✓ Validate", "→ Next"],
            "…which still holds only the work-stream verbs it holds today",
          );

          // The glyph: `⟳` fetches the data again; `↻` re-runs the work.
          assert.ok(detail.resync.label.startsWith("⟳"), "it carries the `⟳` glyph — the product's \"fetch the data again\" mark");
          assert.ok(!detail.resync.label.includes("↻"), "…never `↻`, which means \"re-run the work\"");
        });

        // …and no `uat` gate bar carries one either.
        await withBoardApp({ url: face.url }, async (app) => {
          const gate = app.gateBar("44");
          assert.ok(gate, "the acceptance gate bar renders (non-vacuous)");
          assert.equal(gate.buttons.length, 0, "a `uat` gate bar nests no Resync");
        });
      });
    },
  },

  // ══ Scenario Outline: Resync is rendered only while the row is stale —
  //    absent, not disabled, in every other state ══
  {
    name: "board-resync/05 Resync is rendered ONLY while the row is stale — ABSENT (not disabled, not hidden) for a fresh row, an unknown instant and a non-mesh workspace, while the provenance line itself is present regardless",
    run: async () => {
      // stale — present and enabled
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.ok(detail.resync, "stale: the Resync control is present");
          assert.equal(detail.resync.disabled, false, "…and enabled");
          assert.ok(detail.provenanceLabel, "…and the provenance line itself is present");
        });
      });

      // fresh — no control in the DOM at all
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-60));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const detail = app.detail();
          assert.equal(detail.resync, null, "fresh: there is NO Resync control in the DOM — not a disabled one, not a hidden one");
          assert.equal(app.resyncControls().length, 0, "…anywhere in the tree");
          assert.equal(detail.provenanceLine, `synced 1m ago · from ${NODE}`, "…while the provenance line itself is present regardless");
        });
      });

      // unknown instant — never asserted as stale, so nothing to repair
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.forget("43/04", ["syncedAt"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.detail().resync, null, "unknown instant: there is NO Resync control in the DOM");
          assert.equal(app.detail().provenanceLine, `synced time unknown · from ${NODE}`, "…and the line states the unknown in words");
        });
      });

      // non-mesh workspace — no box at all, and so no Resync
      await withBoardFace(async (face) => {
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.detail().provenanceBox, null, "non-mesh: there is no provenance box at all");
          assert.equal(app.resyncControls().length, 0, "…and so no Resync");
        });
      });
    },
  },

  // ══ Scenario: Resync appears at the crossing tick and is removed when a
  //    fresher copy lands ══
  {
    name: "board-resync/05 Resync appears at the CROSSING TICK with no network, and is removed the moment a fresher copy lands — it comes and goes with the claim it repairs",
    run: async () => {
      await withBoardFace(async (face) => {
        // One second under the window, and SETTLED — the board schedules no list
        // poll at all, which is exactly why the crossing must be clock-driven.
        await face.reportedBy(NODE, at(-299));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(app.detail().badge, null, "one second under the window: no badge…");
          assert.equal(app.detail().resync, null, "…and no Resync");

          const before = app.requests().length;
          await app.advance(2000);

          const crossed = app.detail();
          assert.ok(crossed.badge, "the badge appeared in that tick");
          assert.ok(crossed.resync, "…and the Resync control appeared in the SAME tick");
          assert.equal(app.requests().length, before, "no network request was made to produce either");

          // …and a list response carrying a fresher `syncedAt` removes both.
          await face.reportedBy(NODE, at(0));
          await app.sync();
          const landed = app.detail();
          assert.equal(landed.badge, null, "the badge is gone");
          assert.equal(landed.provenanceLine, `synced just now · from ${NODE}`, "the line reads the reset age");
          assert.equal(landed.resync, null, "…and the Resync control is removed from the DOM");
          assert.equal(app.resyncControls().length, 0, "…everywhere");
        });
      });
    },
  },

  // ══ Scenario: while the request is in flight the button says so and NOTHING
  //    about the data changes ══
  {
    name: "board-resync/05 while the request is IN FLIGHT the button says so and NOTHING about the data changes — same box, tint dropped, badge and line untouched, slot empty, no element re-sized",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const rest = app.detail().resync;
          const restGeometry = { width: rest.labelWidth, padding: rest.className.match(/px-[\d.]+ py-[\d.]+/)?.[0], type: rest.className.match(/text-\[[\d.]+px\]/)?.[0] };

          // The answer is HELD at the network layer, so the in-flight frame is a
          // deterministic read rather than a race with a millisecond-fast POST.
          const held = app.holdNext("/api/work/resync");
          const pending = app.detail().resync.clickDetached();
          await app.renderOnly();
          assert.ok(held.claimed(), "the resync POST really is in flight — the request is issued, only its answer is held");

          const flight = app.detail();
          assert.equal(flight.resync.label, RESYNC_LABEL_SENDING, "the button reads \"Resyncing…\"");
          assert.equal(flight.resync.disabled, true, "…is disabled");
          assert.equal(flight.resync.ariaBusy, "true", "…and carries `aria-busy=\"true\"`");
          assert.equal(flight.resync.tone, "muted", "it is the SAME box with the `primary` tint DROPPED");
          assert.deepEqual(
            { width: flight.resync.labelWidth, padding: flight.resync.className.match(/px-[\d.]+ py-[\d.]+/)?.[0], type: flight.resync.className.match(/text-\[[\d.]+px\]/)?.[0] },
            restGeometry,
            "…same padding, same height, same type — only the label and the tint changed",
          );

          assert.equal(flight.badge.text, "◌ stale · 12m ago", "the badge is unchanged");
          assert.equal(flight.provenanceLine, `stale · synced 12m ago · from ${NODE}`, "the provenance line is unchanged — still `stale ·`, still the 12-minute-old copy");
          assert.equal(flight.messageSlot.text, "", "the message slot is empty");
          assert.equal(
            flight.resync.labelWidth,
            `${RESYNC_LABEL_WIDTH_CH}ch`,
            "no element in the row changed width — the label span reserves a constant width sized to the longest label it ever reads",
          );

          await serverAnswers(app, face, held);
          held.release();
          await app.advance(1000);
          await pending.settle();
        });
      });
    },
  },

  // ══ Scenario: an accepted request acknowledges the CALL, and only the arriving
  //    copy is allowed to claim the DATA is fresh ══
  {
    name: "board-resync/05 an ACCEPTED request acknowledges the CALL and nothing else — no toast, banner, snackbar, dialog, checkmark or \"resynced!\" anywhere — and only the ARRIVING COPY clears the badge",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          // THE SETTLED BASELINE, measured before anything is clicked — and it is
          // the instrument the whole second half of this lane rests on: a board
          // with nothing executing fetches the list ZERO times of its own accord,
          // across a full minute of its own clock. Measured at the same moment as
          // the cadence, off the same minute, because a list request during the
          // watch window is only attributable to the watch poll if this number is
          // zero.
          const settledLists = app.requestsMatching("/api/work/list").length;
          const pollMs = await measurePollInterval(app);
          assert.equal(
            app.requestsMatching("/api/work/list").length,
            settledLists,
            "a SETTLED board fetches the list ZERO times on its own — a full minute of clock, and no list traffic at all",
          );
          // Measuring the cadence costs a minute of the app's clock, so the copy's
          // stated age is READ here rather than asserted as a literal: the claim
          // below is that the line is UNCHANGED by an acknowledgement, not that it
          // states any particular number.
          const staleLine = app.detail().provenanceLine;
          assert.ok(staleLine.startsWith("stale · synced "), `the row is stale before the click (${JSON.stringify(staleLine)})`);

          await clickResync(app, face);

          const accepted = app.detail();
          assert.equal(accepted.resync.label, RESYNC_LABEL_ACCEPTED, "the button reads \"Requested\"");
          assert.equal(accepted.resync.tone, "muted", "…muted");
          assert.equal(accepted.resync.disabled, true, "…and disabled");
          assert.equal(accepted.messageSlot.text, `waiting for ${NODE} to push`, "the message slot names who we are waiting on");

          assert.ok(accepted.badge, "the badge is STILL showing");
          assert.equal(accepted.provenanceLine, staleLine, "…and the line STILL names the same old copy, unchanged by the acknowledgement");

          // NO SUCCESS TOAST. Asserted three ways: no role-bearing announcement
          // region anywhere, no success vocabulary in the page's text, and no
          // check mark.
          assert.deepEqual(app.alerts(), [], "no toast, banner, snackbar or dialog appeared anywhere on the surface");
          const page = visibleTextOf(app.tree());
          for (const word of ["resynced", "refreshed!", "success", "✓ resync"]) {
            assert.ok(!page.toLowerCase().includes(word.toLowerCase()), `…and no "${word}" message either`);
          }

          // ── ONLY THE DATA CHANGING IS ALLOWED TO CLAIM THE DATA CHANGED, and
          //    here NOBODY TOUCHES THE BOARD. The owner pushes into the STORE and
          //    the surface is left alone: what finds the copy is the watch
          //    window's own bounded poll (43/ADR-010 R4.3(b)), which is armed by
          //    the acceptance and rides the cadence measured above.
          //
          //    THIS IS THE ASSERTION THE MECHANISM DID NOT HAVE. Landing the copy
          //    through the operator's own `⟳ sync` — how every "a fresher copy
          //    lands" moment in this story used to be driven — proves nothing
          //    about the poll: a build with the effect DELETED serves the operator
          //    the same fresh copy, so the repair path was producing the fast
          //    path's only observable. That is this milestone's own recorded
          //    lesson ("a test of the fast path must name an observable the repair
          //    path CANNOT produce"), and it bit hardest here, because without the
          //    poll "no answer inside the watch window" is structurally guaranteed
          //    rather than measured. MEASURED BY MUTATION, 2026-08-03: with the
          //    effect no-oped, NOTHING in the story went red; with this assertion,
          //    leg 2's "the window spent it looking" and task 06's decay lane, the
          //    same mutant kills three lanes across the two suites.
          const watchMark = app.requestsMatching("/api/work/list").length;
          await face.reportedBy(NODE, app.at(0));
          await app.advance(pollMs);
          assert.ok(
            app.requestsMatching("/api/work/list").length > watchMark,
            `the watch window fetched the list ITSELF — the request a settled board never makes (saw ${app.requestsMatching("/api/work/list").length - watchMark})`,
          );
          const landed = app.detail();
          assert.equal(landed.badge, null, "the badge clears, with NO operator action of any kind");
          // The line resets to the pushed copy's own age, which is at most one
          // poll interval — the poll is what fetched it, exactly one interval
          // after the push. Stated as that bound rather than as one number
          // because the age the LINE reads is quantised by the cosmetic 1-second
          // tick and offset by wherever in that second the acknowledgement
          // landed; pinning a single literal would be pinning the fixture's
          // phase, not the behaviour.
          assert.match(
            landed.provenanceLine,
            new RegExp(`^synced (just now|[1-9]s ago) · from ${NODE}$`),
            `the line resets to a seconds-grain age no older than the one poll interval it waited (${JSON.stringify(landed.provenanceLine)})`,
          );
          assert.ok(!landed.provenanceLine.startsWith("stale"), "…and it no longer claims the copy is stale");
          assert.equal(landed.resync, null, "…and the Resync control is removed");
          assert.deepEqual(app.alerts(), [], "THAT — the badge clearing and the age resetting — is the only confirmation rendered anywhere");
          assert.equal(landed.messageSlot.text, "", "…the acknowledgement's message is gone with it");
        });
      });
    },
  },

  // ══ Scenario: the `Requested` acknowledgement is held for exactly one poll
  //    interval and then decays with nothing left over ══
  {
    name: "board-resync/05 the `Requested` acknowledgement is held for EXACTLY ONE POLL INTERVAL — measured at the board's own cadence, never a fresh literal — and then decays with nothing left over",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          // ONE NUMBER, NOT TWO: the hold IS the board's own list-poll cadence,
          // and it is read off the app's own traffic rather than restated here.
          const pollMs = await measurePollInterval(app);
          // Measuring the cadence costs a minute of the app's clock, so the
          // copy's stated age is read HERE rather than asserted as a literal —
          // the claim is that the line is UNCHANGED across the episode, not that
          // it says any particular number.
          const staleLine = app.detail().provenanceLine;
          assert.ok(staleLine.startsWith("stale · synced "), `the row is stale before the click (${JSON.stringify(staleLine)})`);

          const ackAt = await clickResync(app, face);
          assert.equal(app.detail().resync.label, RESYNC_LABEL_ACCEPTED, "the acknowledgement is showing");

          // one millisecond before the poll interval has elapsed
          await app.advance(pollMs - 1 - (app.nowMs() - ackAt));
          const before = app.detail();
          assert.equal(before.resync.label, RESYNC_LABEL_ACCEPTED, "one millisecond before the interval the button still reads \"Requested\"");
          assert.equal(before.resync.disabled, true, "…and is still disabled");

          // …and once it has
          await app.advance(1);
          const after = app.detail();
          assert.equal(after.resync.label, RESYNC_LABEL_IDLE, "once the poll interval has elapsed the button is back at rest");
          assert.equal(after.resync.disabled, false, "…enabled");
          assert.equal(after.resync.tone, "primary", "…in its `primary`-tint outline");
          assert.equal(after.messageSlot.text, "", "the message slot is empty again");
          assert.equal(after.resync.ariaBusy, null, "nothing of the acknowledgement persists anywhere on the panel");
          assert.ok(!visibleTextOf(after.panel).includes("waiting for"), "…including its message");

          // The row is still stale THROUGHOUT — the decay of an acknowledgement
          // never changes a freshness verdict.
          assert.ok(before.badge, "the row is still stale before the decay");
          assert.ok(after.badge, "…and still stale after it");
          assert.equal(after.provenanceLine, staleLine, "…the freshness verdict is untouched by an acknowledgement decaying");
        });
      });
    },
  },

  // ══ Scenario Outline: the in-flight state is bounded on both legs and always
  //    terminates in a state from the table ══
  {
    name: "board-resync/05 the in-flight state is BOUNDED on both legs — a request that never answers, and an accepted request whose copy never arrives, each terminate in a reported outcome, with exactly ONE resync request on the wire across the whole episode",
    run: async () => {
      // ── leg 1: the request's answer is held at the network layer ──────────
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          // BOTH bounds are read through the board's OWN cadence, measured at
          // its consumption site — never as a millisecond literal. 43/ADR-014
          // removed the fixed 10s precisely because a bound that does not move
          // with the cadence it races reported "no answer" for healthy resyncs.
          const pollMs = await measurePollInterval(app);
          const requestMs = pollMs * RESYNC_REQUEST_INTERVALS;
          assert.ok(
            requestMs < pollMs * RESYNC_WATCH_INTERVALS,
            "the request leg is strictly INSIDE the watch window, so the two bounds stay distinguishable",
          );

          // …and the age the copy states right now, so the terminal message can
          // be checked against the copy actually on screen rather than a literal
          // the cadence measurement above has aged past.
          const ageWord = app.detail().provenanceLine.match(/synced (\d+[smhd]) ago/)[1];
          const clickAt = app.nowMs();
          const held = app.holdNext("/api/work/resync");
          const pending = app.detail().resync.clickDetached();
          await app.renderOnly();
          assert.equal(app.detail().resync.label, RESYNC_LABEL_SENDING, "the affordance is in flight");
          // The REAL server answers here; the app never sees it. That is the
          // honest shape of the failure — the request may well have REACHED the
          // owner, and the affordance simply never learns whether it did.
          await serverAnswers(app, face, held);

          // one millisecond short of the deadline it is still waiting…
          await app.advanceHeld(requestMs - 1 - (app.nowMs() - clickAt));
          assert.equal(app.detail().resync.label, RESYNC_LABEL_SENDING, "…and it is still waiting one millisecond before the deadline");

          // …and at it, it stops.
          await app.advanceHeld(1);
          const out = app.detail();
          assert.equal(out.resync.label, RESYNC_LABEL_IDLE, "the button is back at \"⟳ Resync\"");
          assert.equal(out.resync.disabled, false, "…enabled and retryable");
          assert.ok(out.messageSlot.text.length > 0, "the message slot carries a terminal outcome");
          assert.ok(out.messageSlot.text.includes("no answer"), `…naming the world's silence (${JSON.stringify(out.messageSlot.text)})`);
          assert.ok(out.messageSlot.text.includes(`${ageWord}-old copy`), "…and the copy still on screen, by its age");
          assert.ok(!out.messageSlot.className.includes("destructive"), "…muted: the world did not answer, it did not reject");

          assert.equal(app.requestsMatching("/api/work/resync").length, 1, "exactly ONE resync request left the app across the whole episode — no retry ladder and no second cadence");
          held.release();
          await pending.settle();
        });
      });

      // ── leg 2: accepted, and no fresher copy is ever pushed ───────────────
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          // The SETTLED baseline, off the same minute the cadence is measured in:
          // a board with nothing executing fetches the list zero times of its own
          // accord. It is what makes the fetches counted inside the watch window
          // below attributable to the watch poll and to nothing else.
          const settledLists = app.requestsMatching("/api/work/list").length;
          const pollMs = await measurePollInterval(app);
          assert.equal(
            app.requestsMatching("/api/work/list").length,
            settledLists,
            "a SETTLED board fetches the list ZERO times on its own — a full minute of clock, and no list traffic at all",
          );
          // The age the copy states RIGHT NOW — every failure message must name
          // the copy still on screen, so the expected copy is derived from the
          // line rather than restated as a literal that the measurement above
          // would have aged past.
          const ageWord = app.detail().provenanceLine.match(/synced (\d+[smhd]) ago/)[1];
          const ackAt = await clickResync(app, face);

          // one millisecond short of the watch window it has NOT declared…
          const watchMark = app.requestsMatching("/api/work/list").length;
          await app.advance(pollMs * RESYNC_WATCH_INTERVALS - 1 - (app.nowMs() - ackAt));
          assert.ok(
            !app.detail().messageSlot.text.includes("no answer"),
            "one millisecond before the watch window the surface has not declared a terminal outcome",
          );
          // …and it spent that window genuinely LOOKING. "No fresher copy
          // arrived" is only an honest report if the surface was fetching the
          // list while it waited: a settled board fetches it zero times, so
          // without the watch poll (43/ADR-010 R4.3(b)) this outcome would be
          // structurally guaranteed rather than measured — the affordance would
          // report the world's silence having never listened to it.
          const watched = app.requestsMatching("/api/work/list").length - watchMark;
          assert.ok(watched >= 2, `the watch window polled the list on the board's own cadence while it waited (saw ${watched} automatic list fetches)`);

          await app.advance(1);
          const out = app.detail();
          assert.equal(out.resync.label, RESYNC_LABEL_IDLE, "the button is back at \"⟳ Resync\", enabled and retryable");
          assert.equal(out.resync.disabled, false);
          assert.equal(
            out.messageSlot.text,
            `no answer from ${NODE} — still showing the ${ageWord}-old copy`,
            "the message slot carries a terminal outcome that NAMES the copy still on screen",
          );
          assert.notEqual(out.resync.label, RESYNC_LABEL_SENDING, "the button is never left reading \"Resyncing…\" indefinitely");
          assert.notEqual(out.resync.label, RESYNC_LABEL_ACCEPTED, "…nor \"Requested\"");
          assert.equal(app.requestsMatching("/api/work/resync").length, 1, "exactly ONE resync request left the app across the whole episode");

          // BOUNDED means the LOOKING stops too. The watch poll disarms with the
          // window rather than becoming a second permanent cadence on a board
          // that is, once again, settled: thirty seconds of clock past the
          // terminal outcome, and the board is back to fetching nothing at all.
          const afterMark = app.requestsMatching("/api/work/list").length;
          await app.advance(30_000);
          assert.equal(
            app.requestsMatching("/api/work/list").length,
            afterMark,
            "past the window the board makes no list request at all — the poll disarmed with the leg it served",
          );
        });
      });
    },
  },

  // ══ Scenario: the two bounds are distinct legs ══
  {
    name: "board-resync/05 the two bounds are DISTINCT LEGS — a copy that lands inside the watch window still clears the badge, long after the request leg completed, and no terminal failure is ever rendered",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        face.controlTick({ connected: [NODE], deliver: true });
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const pollMs = await measurePollInterval(app);
          const requestMs = pollMs * RESYNC_REQUEST_INTERVALS;
          const ackAt = await clickResync(app, face);
          assert.ok(
            pollMs * RESYNC_WATCH_INTERVALS > requestMs,
            "the watch window OUTLASTS the request round-trip deadline — the two legs are genuinely different lengths",
          );

          // Past the request deadline, but not past the watch window.
          await app.advance(requestMs + 1000 - (app.nowMs() - ackAt));
          const midway = app.detail();
          assert.ok(
            !midway.messageSlot.text.includes("no answer"),
            "the surface has NOT declared a terminal no-answer outcome — the request leg completed long before, and its deadline is not the copy's",
          );
          assert.ok(midway.badge, "…and the row is still, honestly, stale");

          // A fresher copy lands before the watch window elapses — stamped at the
          // app's OWN current clock, since the cadence measurement above moved it.
          //
          // THROUGH THE OPERATOR'S OWN `⟳ sync`, AND THAT IS FAITHFUL HERE rather
          // than a shortcut. The watch poll (43/ADR-010 R4.3(b)) rides the board's
          // cadence, so inside a three-interval window its ticks fall at ONE and
          // TWO intervals; the third coincides with the window's own expiry and
          // is cleared by it (measured, 2026-08-03). A copy pushed here — past
          // the request deadline, in the window's LAST interval — is therefore
          // genuinely one the poll never sees, and the operator's next sync is
          // what surfaces it. The poll's own observable is asserted where the
          // poll is actually the finder: the accepted-request lane above (the
          // copy landing unaided) and leg 2 of the bounded-legs lane (the window
          // spent looking, then disarming).
          await face.reportedBy(NODE, app.at(0));
          await app.sync();
          const landed = app.detail();
          assert.equal(landed.badge, null, "the badge clears");
          assert.equal(landed.provenanceLine, `synced just now · from ${NODE}`, "the line resets");
          assert.equal(landed.resync, null, "…and the Resync control is removed");
          assert.equal(landed.messageSlot.text, "", "no terminal failure message was ever rendered");

          // …and the watch window's own expiry cannot resurrect one afterwards.
          await app.advance(pollMs * RESYNC_WATCH_INTERVALS);
          assert.equal(app.detail().messageSlot.text, "", "…not even once the window would have elapsed");
          assert.deepEqual(app.alerts(), [], "and no toast ever appeared for the landing either");
        });
      });
    },
  },

  // ══ The m38/ADR-012 correctness constraint, restated as a whole-tree count ══
  {
    name: "board-resync/05 the card `<button>`s nest NO interactive element in any view — the count of controls inside them is zero whether the row is fresh or stale",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await withBoardApp({ url: face.url }, async (app) => {
          const overview = app.overviewCard("43");
          await app.openMilestone("43");
          const lane = app.laneCard("43/04");
          for (const [label, card] of [["the overview milestone card", overview], ["the lane card", lane]]) {
            assert.equal(card.type, "button", `${label} is itself a <button>`);
            assert.ok(card.badge, `${label} carries the badge`);
            assert.equal(card.buttons.length, 0, `${label} nests no <button>`);
            assert.equal(card.links.length, 0, `${label} nests no <a>`);
            assert.equal(
              findAll(card.node, (node) => (node.type === "button" || node.type === "a") && node !== card.node).length,
              0,
              `${label} nests no interactive element at all — a single focus stop and a single activation target`,
            );
          }
        });
      });
    },
  },
];

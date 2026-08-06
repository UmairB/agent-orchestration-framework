// Traceability wiring for milestone 43 / story 04 / task 06 —
// tasks/06_resync-owner-unreachable.feature (@executable).
//
// The offline owner is the INTERESTING case, and it is DESIGNED rather than left
// as an error path: the item is stale precisely BECAUSE its owner stopped
// reporting, so "ask the owner for a fresh push" can very plausibly get no
// answer. DESIGN pinned seven states; this file is that table, plus the four
// rules that decide it.
//
// ── THE STATE → CODE MAPPING, VERIFIED AGAINST THE TRANSPORT ON DISK ────────
// DESIGN names seven UI states; `src/mesh-resync.mjs` + `src/commands/resync.mjs`
// produce SIX coded outcomes, all at HTTP 200. The rest are CLIENT LEGS, and that
// split is the design's own — the button reports the CALL, so only the call's
// outcomes can come from the wire:
//
//   idle              — no call yet.                          (no producer needed)
//   in-flight         — the POST is outstanding.              (client: the awaited call)
//   accepted          — `resync-requested` (ok:true)          → muted acknowledgement
//   landed            — a fresher `syncedAt` on the LIST.     (not a resync outcome at all —
//                       the badge clearing IS the proof, which is the whole design)
//   no answer         — `resync-pending` (the command's own request-leg bound)
//                       OR the CLIENT's watch window elapsing with no fresher copy
//   owner unreachable — `resync-owner-not-connected` / `resync-owner-unreachable`
//   refused           — `resync-no-owner`, the ONLY rejection → the ONLY destructive rung
//
// …plus ONE state DESIGN did not name and 43/ADR-014/E2 added:
//
//   the owner is THIS node — `resync-owner-is-self` → MUTED, its own phase.
//       It used to answer `resync-owner-not-connected`, which was wrong in the
//       exact case DESIGN cares about: a control-authored row goes stale
//       precisely when the control's own publish tick stops, and "not connected"
//       named a connectivity fact that was never tested. No call is made, so no
//       connectivity claim can honestly be reported — and, for the same reason,
//       it writes NO persistent `· owner unreachable` clause to the line.
//
// EVERY DESIGN STATE HAS A PRODUCER, AND EVERY PRODUCER HAS A STATE. Nothing is
// invented and nothing is orphaned. The one substantive shape this file records:
// `no answer` is reachable by TWO distinct routes (a server-side request-leg
// bound and a client-side watch window), and DESIGN is right that they must read
// the same to the operator — both are "the world did not answer", both muted,
// both retryable.
//
// ── THE FOUR RULES, AND WHAT EACH ONE FORBIDS ───────────────────────────────
//  1. MUTED = the world did not answer. DESTRUCTIVE = the request was rejected.
//     An unreachable owner cost us NOTHING — the cached copy is intact and is
//     still the only readable one — so reddening it would over-alarm precisely
//     the condition this milestone exists to normalise.
//  2. ACKNOWLEDGEMENTS DECAY; FACTS PERSIST. `Requested` decays after one poll
//     interval. `owner <node> unreachable` is a statement about the WORLD and
//     stays on the line until a fresher copy lands or a later attempt supersedes it.
//  3. NEVER PRE-DISABLED ON PRESENCE. Attempt, then report.
//  4. THE CACHED COPY IS NEVER HIDDEN BY A FAILURE.
//
// PRODUCER-FED, through the REAL control-daemon drain. The lane supplies only the
// FABRIC — which node holds a connected admitted socket, and whether a dispatch
// onto it completes — and the REAL tick turns that into the REAL coded outcome
// the REAL command reports. `connected: [owner] + deliver:true` → accepted;
// `connected: []` → owner-not-connected; `deliver:false` → owner-unreachable; a
// row with no recorded author → the coded refusal. No response is painted on.
import assert from "node:assert/strict";
import {
  RESYNC_CODE_OWNER_IS_SELF,
  RESYNC_LABEL_ACCEPTED,
  RESYNC_LABEL_IDLE,
  RESYNC_LABEL_SENDING,
  RESYNC_LINE_NOTE_UNREACHABLE,
  RESYNC_WATCH_INTERVALS,
  resyncAnswered,
  resyncView,
} from "../ui/src/board/resync.mjs";
import { withBoardFace } from "./support/board-face-fixture.mjs";
import { withBoardApp, BOARD_EPOCH, visibleTextOf } from "./support/board-app-harness.mjs";

const NODE = "umairs-mac-mini";
const CONTROL = "aof-control";
const POLL_MS = 5000;
const at = (secondsFromNow) => new Date(BOARD_EPOCH + secondsFromNow * 1000).toISOString();

// The stale item every lane starts from, with the fabric aimed as the lane needs.
async function withStaleItem(fabric, fn) {
  return withBoardFace(async (face) => {
    await face.reportedBy(NODE, at(-720));
    if (fabric) face.controlTick(fabric);
    await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
      assert.ok(app.detail().resync, "the panel opens on the stale item, showing the badge, the line and the control");
      return fn(app, face);
    });
  });
}

// Click and settle, returning the app-clock instant the outcome landed at.
async function runEpisode(app, face, { ref = "43/04", drains = true } = {}) {
  const pending = app.detail().resync.clickDetached();
  await app.renderOnly();
  if (drains) await face.awaitDispatch(ref);
  let landedAt = null;
  for (let step = 0; step < 40 && landedAt == null; step += 1) {
    await app.advance(100);
    if (app.detail().resync?.label !== RESYNC_LABEL_SENDING) landedAt = app.nowMs();
  }
  await pending.settle();
  assert.ok(landedAt != null, "the episode reached a terminal state");
  return landedAt;
}

const slotOf = (app) => {
  const detail = app.detail();
  return {
    label: detail.resync?.label ?? "(removed)",
    disabled: detail.resync?.disabled ?? null,
    message: detail.messageSlot?.text ?? null,
    tone: (detail.messageSlot?.className ?? "").includes("text-destructive") ? "destructive" : "muted",
    badge: detail.badge?.text ?? null,
    line: detail.provenanceLine,
  };
};

export const boardResyncOutcomesTests = [
  // ══ Scenario Outline: the seven Resync states each render the same three
  //    regions with the same discipline ══
  {
    name: "board-resync-outcomes/06 DESIGN's SEVEN states each render the same three regions with the same discipline — the button reports the call, the slot reports the outcome, and the line reports the data throughout",
    run: async () => {
      // idle — not yet clicked
      await withStaleItem(null, async (app) => {
        const idle = slotOf(app);
        assert.equal(idle.label, RESYNC_LABEL_IDLE, "idle: the button reads `⟳ Resync`");
        assert.equal(idle.disabled, false, "…and is enabled");
        assert.equal(idle.message, "", "…the message slot is empty");
        assert.ok(idle.badge, "…the badge is shown");
        assert.equal(idle.line, `stale · synced 12m ago · from ${NODE}`, "…and the line names the copy's age and its reporting node");
      });

      // in-flight — held, not yet answered
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        const held = app.holdNext("/api/work/resync");
        const pending = app.detail().resync.clickDetached();
        await app.renderOnly();
        const flight = slotOf(app);
        assert.equal(flight.label, RESYNC_LABEL_SENDING, "in-flight: the button reads `Resyncing…`");
        assert.equal(flight.disabled, true, "…is disabled");
        assert.equal(flight.message, "", "…the message slot is empty");
        assert.ok(flight.badge, "…the badge is UNCHANGED — the row is still stale until a fresher copy lands");
        assert.equal(flight.line, `stale · synced 12m ago · from ${NODE}`, "…and the line still names the copy's age and reporter");
        await face.awaitDispatch("43/04");
        await app.advanceHeld(1000);
        await held.answered();
        held.release();
        await app.advance(1000);
        await pending.settle();
      });

      // accepted — the request reached the owner
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        const accepted = slotOf(app);
        assert.equal(accepted.label, RESYNC_LABEL_ACCEPTED, "accepted: the button reads `Requested`");
        assert.equal(accepted.disabled, true, "…and is disabled");
        assert.equal(accepted.message, `waiting for ${NODE} to push`, "…the slot names who we are waiting on");
        assert.equal(accepted.tone, "muted", "…in the muted token");
        assert.ok(accepted.badge, "…the badge is unchanged");
        assert.equal(accepted.line, `stale · synced 12m ago · from ${NODE}`);
      });

      // landed — a fresher copy arrived. The ONLY row that changes the badge,
      // and it changes it because a fresher copy ACTUALLY ARRIVED.
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        await face.reportedBy(NODE, app.at(0));
        await app.sync();
        const landed = slotOf(app);
        assert.equal(landed.label, "(removed)", "landed: the control is REMOVED");
        assert.equal(landed.message, "", "…the message slot is empty");
        assert.equal(landed.badge, null, "…the badge is CLEARED");
        assert.equal(landed.line, `synced just now · from ${NODE}`, "…and the line reports the fresher data");
      });

      // no answer — accepted, but nothing landed inside the watch window
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        const ackAt = await runEpisode(app, face);
        await app.advance(POLL_MS * RESYNC_WATCH_INTERVALS - (app.nowMs() - ackAt));
        const quiet = slotOf(app);
        assert.equal(quiet.label, RESYNC_LABEL_IDLE, "no answer: the button is back at `⟳ Resync`");
        assert.equal(quiet.disabled, false, "…enabled and retryable");
        assert.equal(quiet.message, `no answer from ${NODE} — still showing the 12m-old copy`);
        assert.equal(quiet.tone, "muted", "…in the muted token");
        assert.ok(quiet.badge, "…the badge is unchanged");
        assert.equal(quiet.line, `stale · synced 12m ago · from ${NODE}`);
      });

      // owner unreachable — the request could not be delivered at all
      await withStaleItem({ connected: [], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        const gone = slotOf(app);
        assert.equal(gone.label, RESYNC_LABEL_IDLE, "owner unreachable: the button is back at `⟳ Resync`");
        assert.equal(gone.disabled, false, "…enabled");
        assert.equal(gone.message, `owner ${NODE} unreachable — showing the 12m-old copy`);
        assert.equal(gone.tone, "muted", "…MUTED: the world did not answer, it did not reject");
        assert.ok(gone.badge, "…the badge is unchanged");
        assert.ok(gone.line.startsWith(`stale · synced 12m ago · from ${NODE}`), "…and the line still names the copy's age and reporter");
      });

      // the owner is THIS node — 43/ADR-014/E2's new code, END TO END.
      //
      // It is the ONE state whose producer was mid-flight when this file was
      // first written, and the note here used to say so. That note went stale:
      // `src/commands/resync.mjs`'s self branch now returns
      // `RESYNC_OWNER_IS_SELF` (src/commands/resync.mjs:146-152, re-read at
      // source 2026-08-03) with the sentence below, and `test/mesh-resync.test.mjs`
      // has its own green lane for the command's half. So the state is driven
      // like every other row in this table — through the REAL door, the REAL
      // route and the REAL command — rather than on the derivation.
      //
      // WHY IT MATTERS THAT THIS ROW IS REAL. This is the state ADR-014/E2 was
      // written FOR: a control-authored row going stale is the COMMON case (the
      // control's own publish tick stopping is a local condition), and it is the
      // only rung whose owner is reachable without any fabric at all. A row
      // asserted on the derivation alone could not have caught the command
      // answering a different code — which is exactly what it did answer when
      // this file was written.
      //
      // No `controlTick` is armed and none is needed: the self branch answers
      // immediately, writing NO request row, so nothing is left for a daemon to
      // drain. `drains: false` is that fact stated in the lane.
      await withBoardFace(async (face) => {
        // Reported by the face's OWN configured nodeId — this node's publication.
        await face.reportedBy(CONTROL, at(-720));
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          assert.equal(
            app.detail().provenanceLine,
            `stale · synced 12m ago · from ${CONTROL} (this node)`,
            "the row is this node's own stale publication, and the line says so",
          );
          await runEpisode(app, face, { drains: false });
          const self = slotOf(app);
          assert.equal(self.label, RESYNC_LABEL_IDLE, "owner-is-self: the button is back at `⟳ Resync`");
          assert.equal(self.disabled, false, "…enabled and retryable");
          assert.equal(
            self.message,
            `no peer to ask — ${CONTROL} is this node, still showing the 12m-old copy`,
            "…outcome-first, and it names the copy still on screen",
          );
          assert.equal(self.tone, "muted", "…MUTED — no call was made, so nothing was refused");
          assert.ok(self.badge, "…the badge is unchanged");
          assert.equal(
            self.line,
            `stale · synced 12m ago · from ${CONTROL} (this node)`,
            "…and the line writes NO `· owner unreachable` clause: no connectivity was tested, so none may be claimed",
          );
          const title = app.detail().messageSlot.title ?? "";
          assert.ok(title.length > self.message.length, "…with the command's FULLER sentence in `title`");
          assert.ok(
            /publish tick/.test(title) && /no peer to ask/.test(title),
            `…verbatim from the command (${JSON.stringify(title)})`,
          );

          // Terminal, and terminal in the way that matters: no watch window was
          // armed, so a fresher copy is not being waited for — one poll interval
          // later the message is STILL the fact the operator is reading (rule 2:
          // this is not an acknowledgement, so it does not decay).
          await app.advance(POLL_MS * RESYNC_WATCH_INTERVALS);
          assert.equal(app.detail().messageSlot.text, self.message, "…and it is terminal — nothing is held, nothing is watched, and no later timer blanks it");
          assert.equal(app.detail().resync.label, RESYNC_LABEL_IDLE, "…with the control still at rest and still retryable");
        });
      });

      // refused — a coded control-side refusal (no owning node recorded)
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.forget("43/04", ["reportedBy"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          await app.detail().resync.click();
          const refused = slotOf(app);
          assert.equal(refused.label, RESYNC_LABEL_IDLE, "refused: the button is back at `⟳ Resync`");
          assert.equal(refused.disabled, false, "…enabled");
          assert.equal(refused.message, "no owning node recorded");
          assert.equal(refused.tone, "destructive", "…in the DESTRUCTIVE token — a fault we own");
          assert.ok(refused.badge, "…the badge is unchanged");
          assert.ok(refused.line.startsWith("stale · synced 12m ago"), "…and the line still names the copy's age");
        });
      });
    },
  },

  // ══ Scenario Outline: muted means the world did not answer; destructive means
  //    the request was rejected — and nothing else is destructive ══
  {
    name: "board-resync-outcomes/06 THE TONE RAIL — muted for every way the world failed to answer, destructive ONLY for a coded rejection, and nothing else on the panel carries the destructive token",
    run: async () => {
      // owner never answered (the watch window elapsed)
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        const ackAt = await runEpisode(app, face);
        await app.advance(POLL_MS * RESYNC_WATCH_INTERVALS - (app.nowMs() - ackAt));
        const detail = app.detail();
        assert.ok(!detail.messageSlot.className.includes("destructive"), "no answer inside the watch window carries the MUTED token");
        assert.deepEqual(
          app.destructiveNodes(detail.panel),
          [],
          "…and nothing on the panel carries the `destructive` token",
        );
      });

      // owner could not be reached
      await withStaleItem({ connected: [], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        const detail = app.detail();
        assert.ok(!detail.messageSlot.className.includes("destructive"), "an undeliverable request carries the MUTED token");
        assert.deepEqual(app.destructiveNodes(detail.panel), [], "…and nothing on the panel carries the `destructive` token");
      });

      // the owner accepted — the quietest state the row ever renders
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        const detail = app.detail();
        assert.ok(!detail.messageSlot.className.includes("destructive"), "an acknowledgement carries the MUTED token");
        assert.equal(detail.resync.tone, "muted", "…and the button DROPS its primary tint rather than adding anything");
        assert.deepEqual(app.destructiveNodes(detail.panel), [], "the acknowledgement is the quietest state the row ever renders");
      });

      // no owning node recorded — a coded control-side refusal
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.forget("43/04", ["reportedBy"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          await app.detail().resync.click();
          const detail = app.detail();
          assert.ok(detail.messageSlot.className.includes("text-destructive"), "a coded refusal carries the DESTRUCTIVE token");
          assert.equal(detail.messageSlot.text, "no owning node recorded", "…outcome-first");
          assert.ok(
            (detail.messageSlot.title ?? "").length > detail.messageSlot.text.length,
            "…and the FULL server text is carried in `title`",
          );
          assert.ok(
            /no owning node recorded/i.test(detail.messageSlot.title ?? ""),
            `…verbatim from the command (${JSON.stringify(detail.messageSlot.title)})`,
          );
        });
      });

      // "some other coded refusal" — a code the UI has no bespoke sentence for
      // still reads outcome-first with the code after it, rather than being
      // re-worded on a guess. Asserted on the pure derivation, because the
      // transport deliberately mints no such code: inventing a producer for one
      // would be inventing a wire contract.
      assert.equal(
        resyncView({ phase: "refused", code: "resync-something-else", node: NODE, ref: "43/04", ageWord: "12m", pollMs: POLL_MS }).message,
        "resync refused — resync-something-else",
        "an unknown coded refusal reads \"resync refused — <code>\", outcome first, code after",
      );
      assert.equal(
        resyncView({ phase: "refused", code: "resync-something-else", node: NODE, ref: "43/04", pollMs: POLL_MS }).messageTone,
        "destructive",
        "…and it is destructive, like every other coded refusal on these surfaces",
      );

      // THE RAIL, STATED AS A CLOSED SET over every code the transport mints:
      // `resync-no-owner` is the ONE rejection, and therefore the ONE destructive
      // rung. Every other coded outcome is the world failing to answer.
      const tones = Object.fromEntries(
        ["resync-requested", "resync-pending", "resync-owner-not-connected", "resync-owner-unreachable", RESYNC_CODE_OWNER_IS_SELF, "resync-no-owner"]
          .map((code) => {
            const state = resyncAnswered({ ok: code === "resync-requested", code, node: NODE });
            return [code, resyncView({ ...state, node: NODE, ref: "43/04", ageWord: "12m", pollMs: POLL_MS }).messageTone];
          }),
      );
      assert.deepEqual(
        tones,
        {
          "resync-requested": "muted",
          "resync-pending": "muted",
          "resync-owner-not-connected": "muted",
          "resync-owner-unreachable": "muted",
          "resync-owner-is-self": "muted",
          "resync-no-owner": "destructive",
        },
        "exactly ONE coded outcome is destructive, and it is the one that REJECTED the request",
      );
    },
  },

  // ══ Scenario Outline: acknowledgements decay after exactly one poll interval;
  //    facts about the world persist until superseded ══
  {
    name: "board-resync-outcomes/06 ACKNOWLEDGEMENTS DECAY, FACTS PERSIST — `Requested` and its message are gone after one poll interval, while `· owner unreachable` and a coded refusal are still there, and only a fresher COPY supersedes them",
    run: async () => {
      // an ACKNOWLEDGEMENT — decays after exactly one interval
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        const ackAt = await runEpisode(app, face);
        assert.equal(app.detail().resync.label, RESYNC_LABEL_ACCEPTED, "the acknowledgement is on the surface");
        await app.advance(POLL_MS - (app.nowMs() - ackAt));
        assert.equal(app.detail().resync.label, RESYNC_LABEL_IDLE, "after one poll interval the button is back at rest");
        assert.equal(app.detail().messageSlot.text, "", "…and the slot is empty");

        // The copy lands with NO OPERATOR ACTION: the decay of an acknowledgement
        // is not the end of the episode, and the watch window is still running
        // underneath — so the owner's push into the STORE is found by the watch
        // poll itself (43/ADR-010 R4.3(b)) on the very next interval. Driving it
        // through the operator's `⟳ sync` would prove the same badge clears
        // against a build with no watch at all, which is exactly what "the button
        // is at rest while the surface is still waiting" needs to distinguish.
        await face.reportedBy(NODE, app.at(0));
        await app.advance(POLL_MS);
        assert.equal(app.detail().badge, null, "…and once a fresher copy lands — fetched by the watch, unaided — the badge is gone");
        assert.equal(app.detail().resync, null, "…with the control");
      });

      // a FACT ABOUT THE WORLD — persists
      await withStaleItem({ connected: [], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        assert.ok(
          app.detail().provenanceLine.endsWith(` · ${RESYNC_LINE_NOTE_UNREACHABLE}`),
          `the line gained its persistent clause (${JSON.stringify(app.detail().provenanceLine)})`,
        );
        await app.advance(POLL_MS);
        assert.ok(
          app.detail().provenanceLine.endsWith(` · ${RESYNC_LINE_NOTE_UNREACHABLE}`),
          "after one poll interval the clause is STILL on the provenance line",
        );

        // Through the operator's own `⟳ sync`, and that is the RIGHT door for
        // this rung: an unreachable owner is a TERMINAL outcome, so no watch
        // window was ever armed (`resyncAnswered` arms it only on an acceptance —
        // "waiting three more intervals for a push nobody promised" is the
        // structurally-guaranteed no-answer the watch exists to avoid). There is
        // nothing polling here, by design, so the operator is what brings the
        // copy in.
        await face.reportedBy(NODE, app.at(0));
        await app.sync();
        assert.equal(app.detail().resync, null, "once a fresher copy lands the control is gone…");
        assert.equal(
          app.detail().provenanceLine,
          `synced just now · from ${NODE}`,
          "…and the clause is gone with it, superseded by the fresher copy",
        );
      });

      // a CODED REFUSAL — persists, then goes with the control
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.forget("43/04", ["reportedBy"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          await app.detail().resync.click();
          assert.equal(app.detail().messageSlot.text, "no owning node recorded");
          await app.advance(POLL_MS);
          assert.equal(
            app.detail().messageSlot.text,
            "no owning node recorded",
            "after one poll interval the destructive refusal is STILL in the slot",
          );

          await face.reportedBy(NODE, app.at(0));
          await app.sync();
          assert.equal(app.detail().resync, null, "once a fresher copy lands the control is gone…");
          assert.equal(app.detail().messageSlot.text, "", "…and the message with it");
        });
      });
    },
  },

  // ══ Scenario Outline: Resync is never pre-disabled on presence ══
  {
    name: "board-resync-outcomes/06 Resync is NEVER PRE-DISABLED ON PRESENCE — the board's wire carries NO presence fact at all, so the control cannot vary with one even in principle, and a live owner, a stale-presence owner and an owner absent from the roster all render the SAME enabled control and all dispatch",
    run: async () => {
      // ── THE ROW THE EXAMPLES COLUMN CANNOT BIND, ASSERTED AS AN ABSENCE ────
      // DESIGN's outline varies the owner's PRESENCE across three rows. The
      // fixture cannot bind that column, and the honest reason is not that the
      // fixture is thin — it is that NO presence fact reaches this surface at
      // all: `/api/work/list` carries the work rows, the window and the serving
      // node's id, and nothing about who is alive. An Examples row whose
      // distinguishing value is dropped silently duplicates the row above it, so
      // the absence is asserted POSITIVELY here rather than left as a comment,
      // and it is the STRONGER claim: a control that cannot see presence cannot
      // be pre-disabled on it in ANY of the three worlds, including ones no
      // fixture thought to build.
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        const response = await fetch(`${face.url}/api/work/list`);
        const body = await response.json();
        assert.ok(
          body.items.some((row) => row.ref === "43/04" && typeof row.syncedAt === "string"),
          "the wire really did carry the stale item under test (non-vacuous)",
        );
        const wire = JSON.stringify(body);
        for (const fact of ["presence", "heartbeat", "online", "lastSeen", "liveness", "connected", "reachable"]) {
          assert.ok(
            !new RegExp(fact, "i").test(wire),
            `the board's list wire carries no ${fact} fact anywhere — key or value`,
          );
        }
        // …and stated as the row shape itself, so a future key added to the row
        // has to be reckoned with here rather than slipping past a word list.
        const row = body.items.find((item) => item.ref === "43/04");
        assert.deepEqual(
          Object.keys(row).filter((key) => /presence|heartbeat|online|seen|live|connect|reach|stale/i.test(key)),
          [],
          `no row carries a liveness or staleness fact of its own (${JSON.stringify(Object.keys(row).sort())})`,
        );
      });

      // The three worlds DESIGN names. Rows 1 and 2 are driven by the same
      // fabric BECAUSE OF the absence just asserted — "the owner is live" and
      // "the owner's presence record is past the window" are the same input to
      // this surface, and the row that distinguishes them is the OUTCOME each
      // one produces, which is what these three assert.
      const cases = [
        ["owner live", { connected: [NODE], deliver: true }, (app) => {
          assert.equal(app.detail().resync.label, RESYNC_LABEL_ACCEPTED, "…and the outcome is whatever the owner answers — here, an acceptance");
        }],
        ["owner's presence is stale", { connected: [NODE], deliver: true }, (app) => {
          // THE POINT of this row: presence lags by design, so a node whose
          // presence record is past the window may answer perfectly well —
          // pre-disabling would have refused a request that WORKED. It is the
          // same fabric as the row above precisely because presence is not a
          // thing this surface can read: the two differ only in a fact that
          // never crosses the wire, and both must therefore attempt and report.
          assert.equal(app.detail().resync.label, RESYNC_LABEL_ACCEPTED, "…a stale-presence owner answered perfectly well");
        }],
        ["owner has no presence at all", { connected: [], deliver: true }, (app) => {
          assert.ok(
            app.detail().messageSlot.text.includes("unreachable"),
            "…and an owner absent from the roster gives an unreachable report AFTER the attempt, never a prediction before it",
          );
        }],
      ];

      for (const [label, fabric, expect] of cases) {
        await withStaleItem(fabric, async (app, face) => {
          const before = app.detail().resync;
          // The board's wire carries NO presence at all — the first of DESIGN's
          // three reasons this rule exists, and now measured above rather than
          // asserted in a comment. The control cannot vary with a fact it never
          // receives, and it does not.
          assert.equal(before.disabled, false, `${label}: the Resync control is enabled`);
          assert.equal(before.tone, "primary", `${label}: …in its at-rest tint`);
          assert.equal(before.label, RESYNC_LABEL_IDLE, `${label}: …with no "owner offline" label`);
          assert.equal(
            (before.className.match(/opacity-\d+/) ?? []).length,
            0,
            `${label}: …carrying no pre-emptive greying`,
          );
          assert.ok(
            !/offline|unreachable|unavailable/i.test(before.ariaLabel),
            `${label}: …and no pre-emptive "owner offline" name`,
          );
          assert.equal(app.detail().messageSlot.text, "", `${label}: …and nothing predicted in the slot`);

          const beforePosts = app.requestsMatching("/api/work/resync").length;
          await runEpisode(app, face);
          assert.equal(
            app.requestsMatching("/api/work/resync").length,
            beforePosts + 1,
            `${label}: a resync request was ACTUALLY dispatched`,
          );
          expect(app);
        });
      }
    },
  },

  // ══ Scenario Outline: a failed Resync never hides the cached facts ══
  {
    name: "board-resync-outcomes/06 A FAILED RESYNC NEVER HIDES THE CACHED FACTS — the age, the node, the doc bodies and the row's own badge all stay on screen, and the message occupies its own reserved slot beside the button",
    run: async () => {
      const outcomes = [
        ["no answer", { connected: [NODE], deliver: true }, true],
        ["unreachable owner", { connected: [], deliver: true }, false],
      ];
      for (const [label, fabric, waitOutWindow] of outcomes) {
        await withBoardFace(async (face) => {
          await face.reportedBy(NODE, at(-720));
          // The subject is the MILESTONE, whose VERIFICATION the cache genuinely
          // serves (this checkout has none — `aof:verify` runs on the worker).
          // A story's own STORY.md is on local disk, and `work:doc` prefers it,
          // so a cached body could not be reached through that ref at all today
          // (the DEV-5 constraint the task file itself names: serving doc bodies
          // out of the cache in preference to disk is story 06's).
          await face.reportedDoc("43", "VERIFICATION", "# Verification\n\nCached body.\n", { node: NODE, at: at(-720) });
          face.controlTick(fabric);
          await withBoardApp({ url: face.url, hash: "43" }, async (app) => {
            const ackAt = await runEpisode(app, face, { ref: "43" });
            if (waitOutWindow) await app.advance(POLL_MS * RESYNC_WATCH_INTERVALS - (app.nowMs() - ackAt));

            const detail = app.detail();
            assert.ok(
              detail.provenanceLine.startsWith(`stale · synced 12m ago · from ${NODE}`),
              `${label}: the provenance line still reads the copy's age and reporter (${JSON.stringify(detail.provenanceLine)})`,
            );
            // The message occupies its OWN reserved slot beside the button — it
            // never replaces the line and never pushes it out of the box.
            const children = detail.provenanceRowChildren;
            assert.equal(children.length, 3, `${label}: line 2 still holds label, control and slot`);
            assert.equal(children[0], detail.provenanceLabel, `${label}: …the label is still first`);
            assert.equal(children[2], detail.messageSlot.node, `${label}: …and the message is in its own slot`);
            assert.ok(
              detail.messageSlot.text.includes("12m"),
              `${label}: the message NAMES the copy still on screen by its age`,
            );

            // The item's cached doc body still renders, still attributed.
            await app.openTab("VERIFICATION");
            const region = app.docRegion();
            assert.ok(region.markdownHtml.includes("Cached body"), `${label}: the item's cached doc body still renders`);
            assert.equal(region.provenanceLine, `stale · synced 12m ago · from ${NODE}`, `${label}: …still attributed to its reporter`);

            // …and the row is still present in the lanes and overview views,
            // still carrying its badge.
            assert.ok(app.badges().length > 1, `${label}: the row still carries its badge on more than one surface`);
          });
        });
      }
    },
  },

  // ══ Scenario: the message slot is the shrinking element ══
  {
    name: "board-resync-outcomes/06 the MESSAGE SLOT is the element that shrinks and truncates, carrying the full text in `title` — the label and the button never yield, and the button's reserved width is the same in every state of the table",
    run: async () => {
      await withBoardFace(async (face) => {
        await face.reportedBy(NODE, at(-720));
        await face.forget("43/04", ["reportedBy"]);
        await withBoardApp({ url: face.url, hash: "43/04" }, async (app) => {
          const rest = app.detail();
          const restWidth = rest.resync.labelWidth;

          await app.detail().resync.click();
          const detail = app.detail();
          const slot = detail.messageSlot;
          assert.ok(slot.className.includes("min-w-0"), "the slot may shrink below its content width…");
          assert.ok(slot.className.includes("shrink"), "…it is the element that YIELDS…");
          assert.ok(slot.className.includes("truncate"), "…it truncates…");
          assert.ok((slot.title ?? "").length > 0, "…and it carries the full text in its `title`");

          assert.ok(!detail.provenanceLabel.props.className.includes("shrink"), "the provenance label does not shrink to accommodate it");
          assert.ok(detail.resync.className.includes("shrink-0"), "…and neither does the Resync button");
          assert.equal(detail.resync.labelWidth, restWidth, "the button's reserved label width is the same in every state, so no outcome reflows the row");
        });
      });

      // …and that width is genuinely phase-independent, across the whole table.
      const widths = new Set(
        ["idle", "sending", "accepted", "no-answer", "unreachable", "refused"].map(
          (phase) => resyncView({ phase, node: NODE, ref: "43/04", ageWord: "12m", pollMs: POLL_MS }).labelWidth,
        ),
      );
      assert.equal(widths.size, 1, `the reserved width is ONE value across every state of the table (saw ${JSON.stringify([...widths])})`);
    },
  },

  // ══ Scenario Outline: a late answer after a terminal outcome is itself
  //    terminal — only a fresher COPY changes what the row says ══
  {
    name: "board-resync-outcomes/06 A LATE ANSWER AFTER A TERMINAL OUTCOME IS ITSELF TERMINAL — a late acceptance resurrects no `Requested` and a late refusal overwrites nothing; only a fresher COPY changes what the row says",
    run: async () => {
      await withStaleItem({ connected: [NODE], deliver: true }, async (app, face) => {
        // Reach the terminal `no answer` outcome by holding the answer past the
        // request round-trip deadline — the operator is now READING that message.
        const clickAt = app.nowMs();
        const held = app.holdNext("/api/work/resync");
        const pending = app.detail().resync.clickDetached();
        await app.renderOnly();
        await face.awaitDispatch("43/04");
        await app.advanceHeld(1000);
        await held.answered();
        await app.advanceHeld(10_000 - (app.nowMs() - clickAt));
        const terminal = app.detail().messageSlot.text;
        assert.ok(terminal.includes("no answer"), `the episode ended in a no-answer outcome (${JSON.stringify(terminal)})`);

        // NOW the owner's ACCEPTANCE finally arrives — the real 200 the server
        // produced long ago, delivered late.
        held.release();
        await pending.settle();
        await app.advance(1000);
        assert.equal(
          app.detail().messageSlot.text,
          terminal,
          "a LATE acceptance leaves the message reading the no-answer text — no `Requested` is resurrected",
        );
        assert.equal(app.detail().resync.label, RESYNC_LABEL_IDLE, "…and the button stays at rest");
        assert.ok(app.detail().badge, "…and the row is still, honestly, stale");

        // Only the third possibility changes anything, and it changes it because
        // the DATA changed. That is "no success toast" seen from the other end.
        await face.reportedBy(NODE, app.at(0));
        await app.sync();
        assert.equal(app.detail().badge, null, "the badge clears when the PUSH ITSELF lands, however late");
        assert.equal(app.detail().provenanceLine, `synced just now · from ${NODE}`, "…the line resets");
        assert.equal(app.detail().resync, null, "…and the control and its message are removed");
      });

      // A late REFUSAL is equally inert — asserted on the orchestration, since a
      // single episode cannot be both refused-late and accepted-late.
      await withStaleItem({ connected: [], deliver: true }, async (app, face) => {
        const clickAt = app.nowMs();
        const held = app.holdNext("/api/work/resync");
        const pending = app.detail().resync.clickDetached();
        await app.renderOnly();
        await face.awaitDispatch("43/04");
        await app.advanceHeld(1000);
        await held.answered();
        await app.advanceHeld(10_000 - (app.nowMs() - clickAt));
        const terminal = app.detail().messageSlot.text;
        assert.ok(terminal.includes("no answer"), "the episode ended in a no-answer outcome");
        held.release();
        await pending.settle();
        await app.advance(1000);
        assert.equal(
          app.detail().messageSlot.text,
          terminal,
          "the late CODED REFUSAL does not overwrite what the operator is reading",
        );
        assert.ok(
          !app.detail().messageSlot.className.includes("text-destructive"),
          "…and in particular it does not redden a message that was honestly muted",
        );
      });
    },
  },

  // ══ Scenario: after any terminal outcome the operator can click again ══
  {
    name: "board-resync-outcomes/06 after a terminal outcome the operator can CLICK AGAIN and the episode starts clean — a second request is dispatched, the previous message is replaced, and the persistent clause is RE-EVALUATED rather than accumulating a second copy",
    run: async () => {
      await withStaleItem({ connected: [], deliver: true }, async (app, face) => {
        await runEpisode(app, face);
        const first = app.detail();
        assert.ok(first.messageSlot.text.includes("unreachable"), "the episode ended in an unreachable-owner report");
        assert.ok(first.provenanceLine.endsWith(` · ${RESYNC_LINE_NOTE_UNREACHABLE}`), "…and the line gained its persistent clause");
        assert.equal(first.resync.disabled, false, "the control was never wedged");

        // The second attempt goes out for real, and the surface goes back through
        // `Resyncing…` rather than jumping straight to a new outcome. The prior
        // row's stamp is captured first so the drain gate waits for THIS attempt
        // to settle rather than reading the previous one's answer.
        const previous = await face.resyncRow("43/04");
        const held = app.holdNext("/api/work/resync");
        const pending = app.detail().resync.clickDetached();
        await app.renderOnly();
        assert.equal(app.detail().resync.label, RESYNC_LABEL_SENDING, "the click is accepted and the button goes to `Resyncing…`");
        assert.equal(
          app.detail().messageSlot.text,
          "",
          "…and the previous episode's message is cleared, to be replaced by this episode's outcome",
        );
        assert.equal(
          app.detail().provenanceLine,
          `stale · synced 12m ago · from ${NODE}`,
          "…while the persistent clause is RE-EVALUATED by this attempt rather than accumulating a second copy",
        );

        await face.awaitDispatch("43/04", { after: previous?.updatedAt });
        await app.advanceHeld(1000);
        await held.answered();
        held.release();
        await app.advance(1000);
        await pending.settle();

        assert.equal(app.requestsMatching("/api/work/resync").length, 2, "a SECOND request really was dispatched");
        const second = app.detail();
        assert.ok(second.messageSlot.text.includes("unreachable"), "…and the new episode's outcome is reported");
        assert.equal(
          (second.provenanceLine.match(new RegExp(RESYNC_LINE_NOTE_UNREACHABLE, "g")) ?? []).length,
          1,
          `the clause appears exactly ONCE, never twice (${JSON.stringify(second.provenanceLine)})`,
        );
      });
    },
  },
];

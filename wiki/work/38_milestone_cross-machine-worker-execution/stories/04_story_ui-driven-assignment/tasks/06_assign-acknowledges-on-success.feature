@executable @ui @board
Feature: The assign affordance ACKNOWLEDGES a successful dispatch — the same button reads `Sent` for one poll interval and then decays, and the surface fires EXACTLY ONE extra silent re-load so the durable chip lands within a round trip
  In order that an operator who clicks "assign" on a passively-refreshing monitor knows the dispatch landed — at the action,
  within the interaction's own time horizon, and without a second vocabulary for the assignment's state — a 2xx puts the SAME
  `Assign →` button into a `muted`, disabled `Sent` with the picker frozen on the chosen node, holds it for exactly one poll
  interval, decays it to the terminal resting state, and fires exactly ONE additional SILENT keep-last-good status re-load so
  region 5's existing m35 `assigned` chip arrives promptly rather than up to a whole poll interval later.

  # F22 — observed LIVE at the 2026-07-24 two-machine soak (VERIFICATION §"Soak 04"): a `200 ok` produced NO transition, NO
  # pending indicator and NO chip; the operator only knew the call had succeeded by reading the raw API response. Part of "no
  # chip" was the sibling BLOCKER F21 (the chip legitimately landed on a DIFFERENT card, and that record then went
  # assigned → failed 1.5s later). What remains regardless is an up-to-one-poll-interval window in which a real, successful
  # mutation is COMPLETELY unacknowledged — on a surface that changes by itself every 5s, so "nothing changed" reads exactly
  # like "nothing happened".
  #
  # DESIGN §Surface 2, "Amendment 2026-07-24 (F22, live soak)" — the designer's decision, both treatments, because they do two
  # different jobs. (a) The DURABLE record arrives promptly: on a 2xx the surface fires exactly ONE additional SILENT,
  # keep-last-good re-load — the same `load(scope, { silent: true })` the ⟳ control fires, handed down as `onAssigned` (A8).
  # (b) The affordance acknowledges the CALL locally and TRANSIENTLY: the SAME button reads `Sent`, `muted`, disabled, picker
  # frozen on the chosen node, held one poll interval, then back to rest (A7). Neither alone is sufficient — (a) alone puts the
  # whole acknowledgment in the region the operator is NOT looking at, in the quietest token on the card, on a surface that
  # changes by itself; (b) alone would teach the operator to read the BUTTON instead of region 5, which is how a second
  # vocabulary takes root.
  #
  # THE WORD IS `Sent`, NOT `Assigned`. `assigned` is the m35 ramp's word for the assignment's STATE and region 5 speaks it
  # alone; `Sent` is a different fact no other region reports — *the route accepted your request*. It therefore cannot duplicate
  # the chip and cannot contradict it: a dispatch can be sent and the assignment can then fail (literally what the soak saw at
  # +1.5s) and both statements stay true on screen. `✓` is likewise not borrowed — it is the ramp's mark for `done`.
  #
  # HOW THIS IS DRIVEN, and why. There is no React harness in this repo, so the house pattern (task 03) puts the render-logic in
  # a pure helper (ui/src/fleet/assign-affordance.mjs, with its .d.mts sibling) exercised headlessly. But STATE.md's F-38.06e is
  # exactly the lesson that a state satisfied by CALLING THE REDUCER proves nothing if production can never drive it, and
  # F-38.06d that producer-fed must mean producer-SEQUENCED. So the lanes below are driven BOTH ways: the pure state machine
  # directly, AND the REAL, unmodified production <Fleet/> component tree mounted headlessly against the REAL fleet face — a
  # real click, through the real api client, to the real route, minting a real record, with a controllable clock.

  Background:
    Given the REAL fleet face stood up on a loopback port over an isolated global-store seam
    And a published worker node "worker-a" that is both VISIBLE in the roster and ELIGIBLE for the workspace
    And the REAL production <Fleet/> mounted against it, its milestone card showing the affordance at rest

  Scenario: a successful assign is acknowledged AT the action — the same button reads `Sent`, muted and disabled, with the picker frozen on the chosen node
    When the operator clicks "Assign →" and the route answers 2xx
    Then the SAME button reads "Sent" — not "Assigned", and not a mark, glyph, toast or badge
    And the button is disabled and carries the `muted` ramp, the low-emphasis `primary` tint DROPPED rather than added to
    And the picker is disabled with the CHOSEN node still selected, so the row reads `Sent` beside the target's name
    And no new element appears in the row (no chip, no icon, no second control) — the row's height and rhythm are unchanged
    # A7/A9/A10: the acknowledgment is the QUIETEST state the row ever renders, and it is a label swap inside existing controls

  Scenario: the acknowledgment is held for exactly one poll interval and then decays to the terminal resting state
    When the operator clicks "Assign →" and the route answers 2xx
    Then one millisecond before the poll interval elapses the button still reads "Sent" and is still disabled
    And once the poll interval has elapsed the row is back at REST: the picker is enabled, the SAME node is still selected, the button reads "Assign →" in its `primary` tint, and the message slot is empty
    And nothing of the acknowledgment persists anywhere on the card
    # the hold is ONE POLL INTERVAL by construction, not a coincidence: the worst case for the next scheduled poll landing after
    # a click is exactly one interval, so the hold guarantees there is never a moment between the click and a confirmation in
    # which the surface says nothing — even if the success re-load fails silently. It doubles as a re-click guard.

  Scenario: `Assigning…` flows INTO `Sent` — the action never passes back through `Assign →` between them
    When the operator clicks "Assign →"
    Then the in-flight state is "Assigning…", disabled
    And the state that follows a 2xx is "Sent" — the action never returns to "Assign →" in between
    # a local POST returns in milliseconds, so `Assigning…` is sub-perceptual and is NOT the acknowledgment (that was the
    # design's own gap: its only click-time signal never rendered long enough to be seen)

  Scenario: a successful assign fires EXACTLY ONE additional SILENT status re-load — so region 5's m35 `assigned` chip lands within a round trip
    Given the number of status reads the app has made so far is recorded
    When the operator clicks "Assign →" and the route answers 2xx
    Then the app has made EXACTLY ONE additional GET /api/mesh/status — no more, no fewer
    And that card's region 5 now renders the m35 `assigned` chip naming the target node, WITHOUT waiting for the next scheduled poll
    And the surface did NOT flip into its full-page loading state (a non-silent load would unmount the populated board — a far worse answer than saying nothing)
    And no second polling cadence was started: over the following poll interval the app makes exactly the ONE scheduled poll it would have made anyway
    # A8: one load, not a new cadence and not a retry ladder; the existing poll remains the steady state

  Scenario: a REFUSED assign gets the inline destructive error and NO acknowledgment — no `Sent`, no hold, no re-load
    Given the item already has an active assignment (the verb's single-runner gate will refuse)
    When the operator clicks "Assign →"
    Then the affordance shows the verb's coded refusal inline in the `destructive` token
    And the button reads "Assign →" and is enabled again at once — there is no "Sent" and no hold
    And NO additional status re-load was fired for the refusal
    # the refusal path is unchanged by this amendment; only the SUCCESS path gains an acknowledgment

  Scenario: the affordance never claims the ASSIGNMENT's state — a dispatch that is sent and then fails leaves both statements true
    Given a successful assign has been acknowledged with "Sent"
    When the assignment's own lifecycle then moves to `failed` and the surface re-reads
    Then region 5's m35 chip speaks the failure alone
    And the affordance's transient never mirrors it, and decays on its own schedule regardless
    # A8's boundary, exactly: the affordance reports the CALL, region 5 reports the ASSIGNMENT — a spent control must not
    # re-report a lifecycle it no longer owns (that is the second vocabulary by another route)

  Scenario: the hold is ONE poll interval by construction — the two are a single number, not two constants that can drift
    Then the acknowledgment hold and the fleet poll cadence are the SAME exported value
    And the production component schedules its decay from that value, never from a literal of its own
    # AMENDED 2026-07-24 (review fixes QA-c + F-D), assertions unchanged. QA-c: both windows are now MEASURED at their
    # CONSUMPTION sites on the mounted app's own clock (the scheduled poll fires at exactly the interval; the acknowledgment
    # decays on exactly that window) — comparing the two exported constants is a tautology, since the hold IS the cadence
    # constant. F-D: the SOURCE-SHAPE half ("…never from a literal of its own" — the component delegates to the helper and keeps
    # one copy of the number) is a STRUCTURAL invariant and now stands as a clause of the milestone fitness
    # acd-fleet-assign-targets-item-workspace, rather than ageing inside this story's acceptance.

  # ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  # DG-14 / F-38.04f — A HUNG POST IS A REFUSAL, NOT A LIMBO.  Added 2026-07-24.
  #
  # Cite: DESIGN §Surface 2 "Amendment 2026-07-24 (b) — F-38.04g / F-38.04f, judged from the REAL-assign render", DG-14 (six
  # clauses); the amended A7; and the NEW States row "timed out (no answer) — a leg of `refused`".
  #
  # OBSERVED: `runAssign` awaited with no deadline and only `sent` scheduled a decay, so a POST that never answered held
  # `Assigning…` FOREVER — picker frozen, action disabled, message slot empty, no error — recoverable only by reloading the
  # page. Reproduced by holding the request at the network layer. The States table had NO row for it, so the surface's most
  # confusing possible state was the one state the design never described; and on a passively-refreshing monitor a frozen
  # control reads as a broken page.
  #
  # THESE SCENARIOS BELONG IN THIS FILE, and not a new one, because the finding IS the affordance's own state axis: the
  # designer resolved it as a LEG OF `refused` reusing the existing presentation verbatim — a new States row, no new
  # vocabulary. (The sibling finding DG-13 is GEOMETRY across every state AND region 5's footer, so it took its own task file,
  # tasks/07_assign-row-geometry-holds.feature.)
  #
  # THE COPY IS THE DELICATE PART. `no answer — timed out`, never "not sent" and never "failed to assign": a timed-out POST
  # MAY HAVE SUCCEEDED SERVER-SIDE. The affordance reports the CALL (A7); region 5 stays the sole authority on whether
  # anything was assigned, and the poll keeps running underneath, so the chip appears on its own if the record landed. Same
  # discipline as the "no chip by the end of the window" row.

  Scenario: a POST that never answers TIMES OUT into the existing refused presentation — verbatim, with no `Sent` and no hold
    Given the route's answer to the assign POST is held at the network layer, exactly as a hung round trip holds it
    When the operator clicks "Assign →" and the affordance's deadline elapses
    Then the row reads the EXISTING `refused` presentation: the picker is re-enabled with the SAME node still selected
    And the action is back to "Assign →" in its `primary` tint, enabled
    And an inline `destructive` message stands in the row — never a frozen `Assigning…`, never an empty message slot
    And no "Sent" was ever rendered and no hold was scheduled
    # DG-14 clauses 2 + 5: `destructive` and `Sent` may never co-exist — the timeout lands in the state the design already has

  Scenario: the copy reports the CALL, never the assignment — `no answer — timed out`, not "not sent" and not "failed to assign"
    Given the route's answer to the assign POST is held at the network layer
    When the operator clicks "Assign →" and the affordance's deadline elapses
    Then the inline message reads exactly "no answer — timed out"
    And it does NOT say "not sent", "failed", or anything else that would claim nothing was assigned
    And the message's full `title` says the outcome is UNKNOWN and names region 5's poll as the authority
    And region 5 remains the sole authority on whether anything was assigned — the poll keeps running underneath and lands the m35 `assigned` chip on its own, because the dispatch DID reach the server
    # DG-14 clause 3 — this is the whole point: the affordance abandoned its WAIT, not the call

  Scenario: the deadline is TWO poll intervals, measured on the mounted app's own clock — one number derived from the one the surface already speaks in
    Given the route's answer to the assign POST is held at the network layer
    When the operator clicks "Assign →"
    Then one millisecond before two poll intervals have elapsed the action still reads "Assigning…" and is still disabled
    And once they have elapsed the row is in the timed-out refusal
    And the deadline is exactly twice the fleet poll cadence — derived from it, not a second literal beside it
    # DG-14 clause 1 — pinned the way the `Sent` hold is pinned: expressed in POLL_MS, and MEASURED at its consumption site

  Scenario: the timeout abandons the WAIT, not the CALL — no retry, no second cadence, no cancel
    Given the route's answer to the assign POST is held at the network layer
    When the operator clicks "Assign →" and the affordance's deadline elapses
    Then EXACTLY ONE assign POST has left the app across the whole episode
    And no second dispatch, no retry ladder and no second cadence was started
    And the request was never cancelled — a cancel would make a possibly-successful server-side mint ambiguous, which is precisely the ambiguity the copy exists to report honestly
    # DG-14 clause 6

  Scenario: a LATE 2xx is TERMINAL for the affordance — it fires A8's one silent re-load and nothing else
    Given a click has already timed out and the row carries the `destructive` "no answer — timed out"
    When the held 2xx is finally delivered
    Then the action does NOT resurrect "Sent" and the message is NOT cleared — the refusal stands
    And EXACTLY ONE additional silent, keep-last-good status re-load is fired, so region 5 gets its chip
    And the board did not unmount — it is the SILENT load, the same one the ⟳ control fires
    # DG-14 clause 5

  Scenario: a LATE non-2xx changes nothing at all
    Given the item already has an active assignment, so the verb's gate will refuse this dispatch
    And the refusal's delivery is held past the deadline, so the row is already in the timed-out refusal
    When the held non-2xx is finally delivered
    Then the message still reads "no answer — timed out" — the late refusal does not overwrite the one the operator is already reading
    And NO status re-load was fired for it
    # DG-14 clause 5, second half

  Scenario: the timed-out message STANDS until the next attempt, and a re-click is permitted
    Given a click has timed out and the dispatch did in fact land on the server
    When the operator clicks "Assign →" again
    Then the click is accepted — the row was never wedged
    And the ordinary refusal comes back, naming the holder WHOLE: "refused · worker-a" (DG-21's corrected ladder — see task 07)
    And that is a CORRECT answer to a correct question, not a new failure mode
    # DG-14 clause 4

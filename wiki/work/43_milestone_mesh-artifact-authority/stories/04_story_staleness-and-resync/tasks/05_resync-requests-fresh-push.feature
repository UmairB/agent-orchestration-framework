<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — Resync: ONE door per item, on the detail panel's provenance line, present
# only while there is something to repair; it reports the CALL while the provenance line
# reports the DATA; there is NO success toast, because the badge clearing and the age
# resetting are the only honest proof a push actually landed; and the in-flight state is
# BOUNDED.
# LITMUS: every Then is confirmable from the rendered element tree of the real production
# board mounted headlessly against a real board face on a CONTROLLABLE clock (the task 03
# harness idiom), plus the requests the app actually made — labels, `disabled`, tokens,
# element counts, and the request log. No source read.
#
# WHY "NO SUCCESS TOAST" IS AN ASSERTION AND NOT A STYLE NOTE. `Requested` means the request
# went out; only the age resetting and the badge clearing prove a fresh copy arrived. A
# success toast would confirm the CLICK and let the operator believe the DATA is fresh —
# which is the exact lie class this board has already paid for twice (`not-started` over a
# live remote run; "No runs yet" over a worker's real run history). It is the m38 F22 rule
# verbatim: "it reports the CALL; region 5 reports the ASSIGNMENT."
#
# WHY THE DOOR IS SINGULAR AND STRUCTURAL. The lane card and the overview milestone card are
# themselves `<button data-card>` elements, and an HTML `<button>` may never nest another
# interactive element (m38/ADR-012, recorded verbatim at `Fleet.tsx:512-518`). So "no Resync
# on the cards" is not a preference that could be revisited by a future designer — it is a
# correctness constraint, and it is asserted by COUNTING the controls across the whole
# rendered tree rather than by inspecting one component.
#
# THE OFFLINE-OWNER OUTCOMES — no answer, unreachable, refused, and the acknowledgement's
# decay — are task 06. This file owns the door, the happy path and the bound.

@executable @ui @work @distribution
Feature: Resync has one door — on the detail panel's provenance line, only while stale — and it reports the call, never the data: no success toast, and the badge clearing is the only confirmation a fresh copy landed
  In order that an operator looking at an old copy can ask the owning node for a fresh push without being told the data is
  fresh when only the request succeeded
  a single `⟳ Resync` control sits as the last element of the provenance line while the row is stale, goes to a bounded
  in-flight state that leaves the badge and the line untouched, and disappears when a genuinely fresher copy lands

  Background:
    Given the REAL production board mounted headlessly against a REAL board face over an isolated global store, on a controllable clock
    And a mesh-enabled workspace whose item "43/04" was reported by "umairs-mac-mini" 12 minutes ago, past the 300-second window
    And the detail panel is open on that item

  # HEADLINE (AC 9) — ONE door, counted across the whole tree. This is the scenario a future
  # "helpful" second Resync would fail.
  Scenario: exactly one Resync control exists for the item, and it is the last control on the provenance line
    When the lanes view, the overview grid, the detail panel and the fleet card are all rendered for the stale item
    Then exactly ONE Resync control exists across all of them
    And it is inside the detail panel's provenance box, on line 2, following the provenance text in DOM order
    And there is no Resync on the lane card, on the overview milestone card, on any `uat` gate bar, or anywhere on the fleet
    And there is no Resync in the footer actions strip, which still holds only the work-stream verbs it holds today
    And it carries the `⟳` glyph — the product's "fetch the data again" mark — not `↻`, which means "re-run the work"

  # AC 9 — "only while there is something to repair". An always-present pull button would
  # contradict the architecture on screen: Resync is the milestone's ONE sanctioned pull and
  # it is operator-initiated.
  Scenario Outline: Resync is rendered only while the row is stale — absent, not disabled, in every other state
    Given the row's freshness state is <state>
    When the detail panel is rendered
    Then <resync>
    And the provenance line itself is present regardless

    Examples:
      | case              | state   | resync                                                                    |
      | stale             | stale   | the Resync control is present and enabled                                 |
      | fresh             | fresh   | there is NO Resync control in the DOM — not a disabled one, not a hidden one |
      | unknown instant   | unknown | there is NO Resync control in the DOM                                     |
      | non-mesh workspace| (none)  | there is no provenance box at all, and so no Resync                       |

  # AC 8 + AC 9 together — the control appears and disappears WITH the claim it repairs, on
  # the same cosmetic tick that grows the badge.
  Scenario: Resync appears at the crossing tick and is removed when a fresher copy lands
    Given the row is one second under the window, so no badge and no Resync are rendered
    When the clock advances past the threshold and one cosmetic tick elapses
    Then the badge and the Resync control both appear in that tick
    And no network request was made to produce either
    When a list response then arrives carrying a `syncedAt` of just now for that row
    Then the badge is gone, the line reads "synced just now · from umairs-mac-mini", and the Resync control is removed from the DOM

  # HEADLINE (AC 10, first rule) — in flight, the row is STILL STALE. Claiming otherwise is
  # the same lie class the board has already paid for.
  Scenario: while the request is in flight the button says so and NOTHING about the data changes
    When the operator clicks Resync and the request has not yet answered
    Then the button reads "Resyncing…", is disabled, and carries `aria-busy="true"`
    And it is the SAME box as at rest with the `primary` tint DROPPED — same padding, same height, same type, only the label and tint changed
    And the badge is unchanged, still reading "◌ stale · 12m ago"
    And the provenance line is unchanged, still carrying its `stale ·` prefix and still naming the 12-minute-old copy
    And the message slot is empty
    And no element in the row changed width — the label span reserves a constant width sized to the longest label it ever reads

  # AC 10 — the accepted → landed path, and the sentence that defines the whole design:
  # THERE IS NO SUCCESS TOAST.
  Scenario: an accepted request acknowledges the CALL, and only the arriving copy is allowed to claim the DATA is fresh
    When the operator clicks Resync and the owning node accepts the request
    Then the button reads "Requested", muted and disabled
    And the message slot reads "waiting for umairs-mac-mini to push"
    And the badge is STILL showing and the line STILL reads "stale · synced 12m ago · from umairs-mac-mini"
    And no toast, banner, snackbar, dialog, checkmark or "resynced!" message appeared anywhere on the surface
    When a fresher copy for that row then lands
    Then the badge clears, the line resets to "synced just now · from umairs-mac-mini", and the Resync control is removed
    And THAT — the badge clearing and the age resetting — is the only confirmation rendered anywhere
    # m38 F22 verbatim: the button reports the CALL, the provenance line reports the DATA.
    # A toast would confirm the click and let the operator believe the copy is fresh.

  # AC 10 — the acknowledgement's hold, pinned to the surface's own cadence rather than to a
  # second literal beside it. Measured at the CONSUMPTION site on the mounted app's clock,
  # the m38 QA-c correction.
  Scenario: the `Requested` acknowledgement is held for exactly one poll interval and then decays with nothing left over
    Given the operator has clicked Resync and the request was accepted
    Then one millisecond before the poll interval has elapsed the button still reads "Requested" and is still disabled
    And once the poll interval has elapsed the button is back at rest — "⟳ Resync", enabled, in its `primary`-tint outline
    And the message slot is empty again
    And nothing of the acknowledgement persists anywhere on the panel
    And the row is still stale throughout — the decay of an acknowledgement never changes a freshness verdict
    # "A hold of exactly one poll interval is what guarantees there is never a moment between
    # the click and a confirmation in which the surface says nothing" (Fleet.tsx:64-71). One
    # number, not two: the hold IS the board's own list-poll cadence, measured where it is
    # consumed, never a fresh literal.

  # AC 10 — BOUNDED. "No indefinite spinner" is the requirement; DESIGN's defaults are 10s
  # for the request round trip and a watch window of 3 poll intervals for the pushed copy.
  # ARCHITECTURE may set the exact numbers; it may not leave them unbounded.
  Scenario Outline: the in-flight state is bounded on both legs and always terminates in a state from the table — never an indefinite spinner
    Given the operator has clicked Resync
    And <situation>
    When the clock advances past <bound>
    Then the button is back at "⟳ Resync", enabled and retryable
    And the message slot carries a terminal outcome
    And the button is never left reading "Resyncing…" or "Requested" indefinitely
    And exactly ONE resync request left the app across the whole episode — no retry ladder and no second cadence

    Examples:
      | case                          | situation                                                          | bound                                   |
      | the request never answers     | the request's answer is held at the network layer                  | the request round-trip deadline         |
      | accepted, but nothing arrives | the owner accepted, and no fresher copy is ever pushed             | the watch window for the pushed copy    |

  # The bound must be measurable, and the two legs must be distinguishable — otherwise a
  # single 10s timeout would silently swallow a slow-but-successful push.
  Scenario: the two bounds are distinct legs — a copy that lands inside the watch window still clears the badge, even after the request leg completed long before
    Given the operator has clicked Resync and the owner accepted immediately
    When the clock advances past the request round-trip deadline but not past the watch window
    Then the surface has NOT declared a terminal no-answer outcome
    When a fresher copy lands before the watch window elapses
    Then the badge clears, the line resets, and the Resync control is removed
    And no terminal failure message was ever rendered

<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the offline owner is the INTERESTING case, and it is DESIGNED rather than
# left as an error path: the item is stale precisely BECAUSE its owner stopped reporting, so
# "ask the owner for a fresh push" can very plausibly get no answer. DESIGN pinned seven
# states; this file is that table, plus the four rules that decide it.
# LITMUS: every Then is confirmable from the rendered element tree of the real production
# board mounted headlessly against a real board face on a controllable clock, with the
# owner's answer controlled at the network/route layer — labels, `disabled`, the message
# slot's text and token, the provenance line's text, and the badge's presence. No source
# read; the fidelity of "muted reads as calm, destructive reads as a fault" is task 09's.
#
# THE FOUR RULES THIS TABLE ENCODES, each of which a naive implementation gets wrong:
#   1. MUTED = the world did not answer.  DESTRUCTIVE = the request was rejected.
#      An unreachable owner cost us NOTHING — the cached copy is intact and is still the
#      only readable one — so painting it red would over-alarm precisely the condition this
#      milestone exists to normalise. A coded refusal is a fault we own, and reads red like
#      every other coded refusal on these surfaces.
#   2. ACKNOWLEDGEMENTS DECAY; FACTS PERSIST. `Requested` decays after one poll interval.
#      "owner <node> unreachable" is a fact about the world and stays on the line until a
#      fresher copy lands or a later Resync succeeds.
#   3. NEVER PRE-DISABLED ON PRESENCE. Greying the button out when the owner looks offline
#      needs a presence feed the board's wire does not carry, and presence lags by design so
#      "stale presence" is not "unreachable". Attempt, then report — one rule for both
#      surfaces.
#   4. THE CACHED COPY IS NEVER HIDDEN BY A FAILURE. Every outcome message names the age of
#      the copy still on screen; none of them replaces the provenance facts.

@executable @ui @work @distribution
Feature: Resync against an offline, unreachable or unknown owner reports the condition honestly and keeps the cached copy on screen — muted when the world did not answer, destructive only when the request was rejected
  In order that the failure most likely to happen — asking for a push from the very node whose silence made the row stale —
  is a designed state rather than an error path, and never over-alarms an operator whose data is intact
  each Resync outcome renders in the same reserved slot beside the same button, acknowledgements decay while facts persist,
  the button is never pre-disabled on presence, and the row keeps saying how old the copy is and who reported it throughout

  Background:
    Given the REAL production board mounted headlessly against a REAL board face over an isolated global store, on a controllable clock
    And a mesh-enabled workspace whose item "43/04" was reported by "umairs-mac-mini" 12 minutes ago, past the 300-second window
    And the detail panel is open on that item, showing the badge, the provenance line and the Resync control

  # HEADLINE (AC 10) — DESIGN's seven states, as a table. Every row states what the BUTTON
  # says, what the MESSAGE says and in which token, and what the BADGE and LINE do — because
  # the whole design is that those three answer three different questions.
  Scenario Outline: the seven Resync states each render the same three regions with the same discipline — the button reports the call, the line reports the data
    Given the owner's answer to the resync request is <owner answer>
    When the operator clicks Resync and the episode reaches its <state> state
    Then the button reads <button> and is <enabled>
    And the message slot reads <message> in the <tone> token
    And the badge is <badge>
    And the provenance line still names the copy's age and its reporting node

    Examples:
      | state             | owner answer                                              | button      | enabled  | message                                                    | tone        | badge     |
      | idle              | (not yet clicked)                                         | ⟳ Resync    | enabled  | (empty)                                                    | (none)      | shown     |
      | in-flight         | held, not yet answered                                    | Resyncing…  | disabled | (empty)                                                    | (none)      | unchanged |
      | accepted          | the request reached the owner                             | Requested   | disabled | waiting for umairs-mac-mini to push                        | muted       | unchanged |
      | landed            | a fresher copy arrived                                    | (removed)   | (n/a)    | (empty)                                                    | (none)      | CLEARED   |
      | no answer         | accepted, but nothing landed inside the watch window      | ⟳ Resync    | enabled  | no answer from umairs-mac-mini — still showing the 12m-old copy | muted   | unchanged |
      | owner unreachable | the request could not be delivered at all                 | ⟳ Resync    | enabled  | owner umairs-mac-mini unreachable — showing the 12m-old copy | muted     | unchanged |
      | refused           | a coded control-side refusal (no owning node recorded)    | ⟳ Resync    | enabled  | no owning node recorded                                    | destructive | unchanged |
    # `landed` is the ONLY row that changes the badge, and it changes it because a fresher
    # copy actually arrived — never because a button succeeded. Every other row leaves the
    # data exactly as it was, which is the honest answer.

  # RULE 1 — the tone rail, isolated so a regression that reddens an unreachable owner is
  # caught by the assertion whose whole subject is tone.
  Scenario Outline: muted means the world did not answer; destructive means the request was rejected — and nothing else is destructive
    Given the resync episode's outcome is <outcome>
    When the message slot is rendered
    Then it carries the <tone> token
    And <extra>

    Examples:
      | case                        | outcome                                    | tone        | extra                                                                       |
      | owner never answered        | no answer inside the watch window          | muted       | nothing on the panel carries the `destructive` token                        |
      | owner could not be reached  | the request could not be delivered         | muted       | nothing on the panel carries the `destructive` token                        |
      | no owning node recorded     | a coded control-side refusal               | destructive | the message is outcome-first and the full server text is carried in `title` |
      | some other coded refusal    | a coded control-side refusal with a code   | destructive | the message reads "resync refused — <code>", outcome first, code after      |
      | the owner accepted          | the request reached the owner              | muted       | the acknowledgement is the quietest state the row ever renders              |
    # "An unreachable owner cost us NOTHING — the cached copy is intact and still the only
    # readable one — so painting it red would over-alarm precisely the condition this
    # milestone exists to normalise. A refusal, by contrast, is a fault we own."

  # RULE 2 — the decay/persist split. This is the pair of scenarios that stops "everything
  # decays" and "nothing decays" from both looking plausible.
  Scenario Outline: acknowledgements decay after exactly one poll interval; facts about the world persist until superseded
    Given the resync episode left <artefact> on the surface
    When exactly one poll interval elapses with nothing else happening
    Then <after one interval>
    When a fresher copy for the row then lands
    Then <after a fresh copy>

    Examples:
      | case                    | artefact                                        | after one interval                                    | after a fresh copy                                  |
      | an acknowledgement      | the `Requested` button state and its message    | the button is back at rest and the slot is empty      | the badge and the control are gone                  |
      | a fact about the world  | the line's persistent `· owner unreachable` clause | the clause is STILL on the provenance line         | the clause is gone, superseded by the fresher copy  |
      | a coded refusal         | the destructive refusal message                 | the message is STILL in the slot                      | the message is gone with the control                |
    # `Requested` is a statement about a call we made; `owner unreachable` is a statement
    # about the world, and it remains true until the world changes.

  # RULE 3 — attempt, then report. The tempting alternative fails for three separate reasons
  # (no presence on this wire, presence lags by design, and one rule beats a rule that forks
  # by surface), so the assertion is that a click is always accepted and always dispatches.
  Scenario Outline: Resync is never pre-disabled on presence — a click is always accepted and always attempts
    Given the owning node "umairs-mac-mini" is <presence>
    When the detail panel is rendered for the stale item
    Then the Resync control is enabled
    And it carries no "owner offline" pre-emptive disabling, tooltip or greying
    When the operator clicks it
    Then a resync request was actually dispatched
    And the outcome that follows is <outcome> — reported after the attempt, never predicted before it

    Examples:
      | case                          | presence                                 | outcome                                     |
      | owner live                    | reporting presence normally              | whatever the owner answers                  |
      | owner's presence is stale     | its presence record is past the window   | whatever the owner answers — possibly success |
      | owner has no presence at all  | absent from the roster entirely          | an unreachable report after the attempt     |
    # Row 2 is the point: presence lags by design, so a node with stale presence may answer
    # perfectly well. Pre-disabling would have refused a request that would have worked.

  # RULE 4 — the failure never hides the data. The cached copy is the only readable one; a
  # message about a failed request must not displace it.
  Scenario Outline: a failed Resync never hides the cached facts — the age, the node and the body all stay on screen
    Given the resync episode ended in <outcome>
    When the panel is rendered
    Then the provenance line still reads "stale · synced 12m ago · from umairs-mac-mini"
    And the message occupies its own reserved slot beside the button — it never replaces the line and never pushes it out of the box
    And the message names the copy still on screen by its age, so the operator knows what they are looking at
    And the item's cached doc bodies still render, still attributed to "umairs-mac-mini"
    And the row is still present in the lanes and overview views, still carrying its badge

    Examples:
      | case                 | outcome                              |
      | no answer            | no answer inside the watch window    |
      | unreachable owner    | the request could not be delivered   |
      | coded refusal        | a coded control-side refusal         |

  # The message slot's geometry discipline, inherited verbatim from the assign row: it is the
  # element that shrinks and truncates, and it carries the full text in `title`. Structure
  # only — the pixel verdict is task 09.
  Scenario: the message slot is the shrinking element and never truncates the facts around it
    Given a resync episode whose message is longer than the row can show
    When the provenance line is rendered
    Then the message slot is the element that shrinks and truncates, carrying the full text in its `title`
    And the provenance label and the Resync button do not shrink to accommodate it
    And no two elements on the line occupy the same pixels — the yield is a discrete drop, never an overprint
    And the button's reserved label width is the same in every state of the table, so no outcome reflows the row

  # A late answer must not resurrect a spent state — the m38 DG-14 lesson, relocated to this
  # axis. The operator is already reading a terminal outcome; overwriting it silently is how
  # a surface stops being trustworthy.
  Scenario Outline: a late answer after a terminal outcome is itself terminal — only a fresher COPY changes what the row says
    Given the episode already ended in <terminal outcome> and the operator is reading its message
    When <late event> is finally delivered
    Then <result>

    Examples:
      | case                          | terminal outcome | late event                                         | result                                                                    |
      | a late acceptance             | no answer        | the owner's acceptance, arriving after the window  | the message still reads the no-answer text — no `Requested` is resurrected |
      | a late refusal                | no answer        | a coded refusal, arriving after the window         | the message still reads the no-answer text — the late refusal does not overwrite what the operator is reading |
      | the push itself, late         | no answer        | a fresher copy for the row                         | the badge clears, the line resets, the control and its message are removed |
    # Only the third row changes anything, and it changes it because the DATA changed. That
    # is the same rule as "no success toast", seen from the other end.

  # Retry must be permitted and must be a clean attempt — the row was never wedged.
  Scenario: after any terminal outcome the operator can click again, and the episode starts clean
    Given the episode ended in an unreachable-owner report
    When the operator clicks Resync again
    Then the click is accepted and a second request is dispatched — the control was never wedged
    And the button goes to "Resyncing…" and the previous message is replaced by the new episode's outcome
    And the persistent `· owner unreachable` clause on the provenance line is re-evaluated by this attempt rather than accumulating a second copy

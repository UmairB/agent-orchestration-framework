@cli @work @work-stream @executable
Feature: work:feedback appends one attributed bullet, resolving the target by EXACT ref only
  In order that the one write operation can never land a note on the wrong item, whichever face calls it
  the work:feedback command resolves its target with EXACT-ref resolution (no slug fallback), targets only a milestone or story, and appends exactly one attributed bullet under the verbatim `## Feedback (for retro)` heading,
  so that the read/write resolver distinction lives IN the command (both faces inherit it and neither can weaken it), and feedback is the command core's sole filesystem mutation.

  # ADR-002/003: handleFeedback + appendFeedbackBullet move OUT of board-ui.mjs INTO
  # src/commands/feedback.mjs. The load-bearing distinction (ADR-003): reads resolve
  # with resolveItem (slug-fallback tolerated), but this WRITE resolves with
  # resolveItemExact — a typo'd / partial ref returns null (-> the caller's 404 /
  # CLI failure), NEVER the first free-text slug match (the wrong item). The bullet
  # is the canonical form (templates/uat/STATE.md): "- <note> — Raised by: <actor>"
  # with an optional "   Refs: <refs>" (three spaces). The heading is created
  # verbatim if absent; prior bullets are never disturbed. This is the command
  # core's ONLY write. The result is { ok:true, bullet }.
  Background:
    Given a work-stream fixture with a milestone "08", a story "08/00", and a top-level uat session "09"
    And the command registry loaded in-process
    And the actor is "qa"

  # The happy path: one bullet, in the documented format, under the heading, with a
  # success result carrying the rendered bullet.
  Scenario: work:feedback appends one attributed bullet and returns it
    Given the story "08/00" STATE.md has a "## Feedback (for retro)" heading
    When I invoke "work:feedback" with ref "08/00", note "spec was ambiguous on the empty state", and actor "qa"
    Then exactly one new bullet is appended under "## Feedback (for retro)"
    And the bullet reads "- spec was ambiguous on the empty state — Raised by: qa"
    And the result is { ok: true } carrying that bullet

  # A supplied refs pointer is captured verbatim as the optional Refs segment.
  Scenario: a supplied refs pointer is recorded verbatim on the bullet
    Given the story "08/00" STATE.md has a "## Feedback (for retro)" heading
    When I invoke "work:feedback" with ref "08/00", note "revisit the chip ramp", actor "qa", and refs "ADR-002"
    Then the appended bullet ends with "Refs: ADR-002"

  # The heading is created verbatim when absent; the command never fabricates a
  # different heading.
  Scenario: the append creates the verbatim heading when it is absent
    Given the story "08/00" STATE.md has no "## Feedback (for retro)" heading
    When I invoke "work:feedback" with ref "08/00", note "the loading copy reads oddly", and actor "qa"
    Then a "## Feedback (for retro)" heading is created verbatim
    And exactly one bullet is appended under it

  # THE write-isolation guard: the WRITE resolves EXACT-only. A partial / typo'd ref
  # that a read would slug-match must fail here — never append to the wrong item.
  Scenario: a non-exact ref fails rather than writing to a slug-matched item
    Given a milestone "08" whose slug "cli-command-core" a read would match on free text
    When I invoke "work:feedback" with ref "cli-command", note "should not land", and actor "qa"
    Then the command raises a "ref-not-found" error
    And no bullet is appended to any item

  # Feedback targets a milestone or a story only; any other target type is rejected
  # before a write (unsupported-target), so the sole write stays on the two kinds
  # that carry a STATE feedback log.
  Scenario Outline: feedback targets a milestone or story, and rejects other kinds
    When I invoke "work:feedback" with ref "<ref>", note "a note", and actor "qa"
    Then the write "<outcome>"

    Examples:
      | ref   | outcome                                             |
      | 08    | appends one bullet to that milestone STATE.md       |
      | 08/00 | appends one bullet to that story STATE.md           |
      | 09    | is rejected as unsupported-target, appending nothing|

  # The input contract is enforced before any write: a missing note or a missing
  # ref is rejected (the command-level origin of the board's 400 missing-note /
  # missing-ref), and nothing is appended.
  Scenario Outline: a missing required field is rejected before any write
    When I invoke "work:feedback" with <missing>
    Then the command raises a "<code>" error
    And no bullet is appended to any item

    Examples:
      | missing                       | code         |
      | ref "08/00" and no note       | missing-note |
      | note "a note" and no ref      | missing-ref  |

  # work:feedback is the command core's SOLE mutation: a successful append changes
  # only the target STATE.md, never the item's status or frontmatter.
  Scenario: the append writes only the target STATE.md and nothing else
    Given a snapshot of the story "08/00" directory before the append
    When I invoke "work:feedback" with ref "08/00", note "only-write check", and actor "qa"
    Then the only file changed is the story's "STATE.md"
    And the item's record-doc frontmatter and status are unchanged

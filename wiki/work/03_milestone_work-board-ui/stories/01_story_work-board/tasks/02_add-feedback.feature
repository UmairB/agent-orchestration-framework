@ui @work @board
Feature: Add feedback appends one attributed bullet to the selected item's STATE feedback log
  In order to capture a process note against an item the instant it is noticed, without dropping to the terminal
  Add feedback appends exactly one attributed bullet under the selected milestone or story's STATE `## Feedback (for retro)` log — creating the heading if absent — and this is the board's only filesystem write; on success the composer collapses and confirms.

  # The feedback append is the board's SOLE mutation (ADR-004). It locates
  # path.join(dir,'STATE.md') for the selected milestone/story, ensures the
  # verbatim `## Feedback (for retro)` heading exists, and appends ONE bullet in
  # the documented format — mirroring src/bundle/commands/feedback.md so the
  # board and the slash-command stay byte-consistent. The bullet format is the
  # canonical form from templates/uat/STATE.md:30:
  #   - <note> — Raised by: <actor>   Refs: <ADR / scenario / commit>
  # (That this is the ONLY write site, with no status/frontmatter write, is the
  # acd-board-write-isolation fitness function — here we assert the observable:
  # the bullet appears, correctly formatted, and nothing else changes.) The
  # append endpoint is @executable; the rendered composer is @manual.
  Background:
    Given a selected story "03/01" whose item directory contains a "STATE.md"
    And the actor is "qa"

  # --- the feedback-append endpoint (server-side) ---------------------------

  # The endpoint appends exactly ONE bullet, in the documented format, under the
  # `## Feedback (for retro)` heading.
  @executable
  Scenario: the feedback endpoint appends one attributed bullet in the documented format
    Given the STATE.md already has a "## Feedback (for retro)" heading with no entries
    When the board posts feedback "spec was ambiguous on the empty state" for "03/01"
    Then exactly one new bullet is appended under "## Feedback (for retro)"
    And the bullet reads "- spec was ambiguous on the empty state — Raised by: qa"
    And the bullet is attributed to the "qa" actor

  # The heading is created verbatim if the STATE.md does not yet have it — the
  # board never fabricates a different heading.
  @executable
  Scenario: the feedback append creates the heading verbatim when it is absent
    Given the STATE.md has no "## Feedback (for retro)" heading
    When the board posts feedback "the loading copy reads oddly" for "03/01"
    Then a "## Feedback (for retro)" heading is created verbatim
    And exactly one bullet is appended under it

  # When a Refs pointer is supplied it is captured verbatim on the bullet, as the
  # documented format's optional `Refs:` segment — referenced, never restated.
  @executable
  Scenario: a supplied Refs pointer is recorded verbatim on the bullet
    Given the STATE.md has a "## Feedback (for retro)" heading
    When the board posts feedback "revisit the chip ramp" for "03/01" with refs "DESIGN §1"
    Then the appended bullet ends with "Refs: DESIGN §1"

  # The board appends — it never rewrites prior entries. A second note adds a
  # second bullet beneath the first.
  @executable
  Scenario: a second note appends beneath the first without disturbing it
    Given the STATE.md has a "## Feedback (for retro)" heading with one existing bullet
    When the board posts feedback "second note" for "03/01"
    Then the existing bullet is unchanged
    And the new bullet "second note" appears beneath it
    And there are now two bullets under the heading

  # This is the board's ONLY write: posting feedback changes nothing but the one
  # STATE.md, and never the item's status or frontmatter (the structural guard
  # is acd-board-write-isolation; this asserts the observable side of it).
  @executable
  Scenario: posting feedback writes only the STATE.md and never the item status
    Given a snapshot of the selected item's directory before posting
    When the board posts feedback "only-write check" for "03/01"
    Then the only file changed is "STATE.md"
    And the item's record-doc frontmatter and status are unchanged

  # Feedback targets a milestone or a story; the board's actions target
  # milestone/story items per ADR-004.
  @executable
  Scenario Outline: feedback routes to a milestone or story STATE log
    Given a selected "<type>" item "<ref>"
    When the board posts feedback "a note" for "<ref>"
    Then the note lands under "## Feedback (for retro)" in that item's STATE.md

    Examples:
      | type      | ref   |
      | milestone | 03    |
      | story     | 03/01 |

  # --- the rendered composer (browser) --------------------------------------

  # Add feedback reveals an inline composer in the result region, not a separate
  # page or a modal.
  @manual
  Scenario: Add feedback reveals an inline composer
    Given story "03/01" is selected
    When the operator presses "Add feedback"
    Then an inline composer with a text field and a submit affordance appears in the result region

  # On a successful submit the composer collapses and a positive confirmation
  # shows; the freshly-added note may render in a short list.
  @manual
  Scenario: a successful submit collapses the composer and confirms
    Given the feedback composer is open with note "the empty state is unclear"
    When the operator submits the note and the append succeeds
    Then the composer collapses
    And a "Feedback added" confirmation is shown

  # While the append is in flight the submit affordance shows a busy state, and a
  # failed append surfaces an error rather than a silent or false success.
  @manual
  Scenario: a failed append surfaces an error and keeps the note
    Given the feedback composer is open with a note
    When the operator submits and the append fails
    Then an error line is shown
    And the composer stays open with the note intact

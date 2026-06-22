@cli @work @work-stream @executable
Feature: aof work feedback appends one attributed bullet from the terminal, resolving the target exact-only
  In order to capture a process note against an item from the terminal with the same write-safety the board has
  the CLI gains `aof work feedback <ref> --note "…" [--actor …] [--refs …]`, a thin argv -> command -> result that invokes work:feedback,
  so that the terminal write inherits the command's EXACT-ref resolution — a partial or typo'd ref fails rather than writing the note to the wrong item.

  # ADR-003: a NEW thin write subcommand over the work:feedback command. Because the
  # resolver lives in the command (resolveItemExact, ADR-002/003), the CLI write
  # CANNOT weaken it: a non-exact ref fails here exactly as it does on the board.
  # The bullet is the canonical "- <note> — Raised by: <actor>" (+ optional Refs),
  # the same byte form both faces produce. This is the only CLI work subcommand
  # that writes.
  Background:
    Given a work-stream fixture with a milestone "08" and a story "08/00"
    And I am positioned to run the aof CLI against that fixture

  # The happy path: one attributed bullet under the verbatim heading, exit 0.
  Scenario: aof work feedback appends one attributed bullet
    Given the story "08/00" STATE.md has a "## Feedback (for retro)" heading
    When I run "aof work feedback 08/00 --note \"spec was thin on the empty state\" --actor qa"
    Then the command exits 0
    And exactly one new bullet is appended under "## Feedback (for retro)"
    And the bullet reads "- spec was thin on the empty state — Raised by: qa"

  # A supplied --refs is captured verbatim as the optional Refs segment.
  Scenario: --refs is recorded verbatim on the bullet
    Given the story "08/00" STATE.md has a "## Feedback (for retro)" heading
    When I run "aof work feedback 08/00 --note \"revisit the ramp\" --actor qa --refs \"ADR-002\""
    Then the command exits 0
    And the appended bullet ends with "Refs: ADR-002"

  # THE write-safety guard inherited from the command: a non-exact ref fails — the
  # CLI write never lands on a slug-matched wrong item.
  Scenario: a non-exact ref fails rather than writing to a slug-matched item
    When I run "aof work feedback cli-command --note \"should not land\" --actor qa"
    Then the command exits non-zero
    And stderr reports that no item resolves to the ref
    And no bullet is appended to any item

  # A missing note is rejected before any write — the command's input contract.
  Scenario: a missing note is rejected before any write
    When I run "aof work feedback 08/00 --actor qa"
    Then the command exits non-zero
    And stderr reports that a note is required
    And no file is changed

  # --actor is optional: when omitted the bullet is still attributed, to the
  # default actor "you" — the same default the board face applies, kept consistent
  # across faces (documented default decision, STATE).
  Scenario: an omitted --actor attributes the bullet to the default actor
    Given the story "08/00" STATE.md has a "## Feedback (for retro)" heading
    When I run "aof work feedback 08/00 --note \"no actor given\""
    Then the command exits 0
    And the appended bullet is attributed to the default actor "you"

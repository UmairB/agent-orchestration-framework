@ui @work @board
Feature: The current / in-flight run is highlighted in the Current-run strip and on the lane card
  In order to see what the agent is doing on an item right now — at a glance from the board, and in detail in the panel
  the pinned Current-run strip shows the latest or in-flight run's state as a dot+label chip, and an item with a
  live running run carries a small teal pulse dot on its lane card, so an active run is visible before the panel is even opened.

  # The "current run" is NOT a second fetch (ARCHITECTURE ADR-001): it is the latest
  # / in-flight element of the SAME runs[] the RUNS view already read — the single
  # `running` record, else the most recent by createdAt. The run-state ramp is a
  # dot+label chip, deliberately a DIFFERENT visual primitive from the item-status
  # glyph-ring (DESIGN surface 2 / documented-default 1); the two ramps are shown
  # together but never merged, and the run state is never folded into item
  # frontmatter (that no-fold invariant is ADR-002, enforced structurally, not here).
  # The selection + the ramp mapping are pure (the status.tsx / dock-state
  # describeState convention) -> @executable; the rendered strip + lane dot are @manual.
  Background:
    Given story "21/00" whose runs include one run currently "running" (#3) and two terminal runs (#1, #2)

  # --- the pure selection + ramp (headless) ---------------------------------

  # One read serves history AND current-state: the UI selects the in-flight run as
  # the current one.
  @executable
  Scenario: the current run is the single in-flight running run
    Given an item whose runs include exactly one "running" run among terminal runs
    Then the current run selected for the strip is that "running" run

  # With nothing in flight, the current run is simply the most recent — there is no
  # second command and no work:run-current verb.
  @executable
  Scenario: with no in-flight run the current run is the most recent by createdAt
    Given an item whose runs are all terminal
    Then the current run selected for the strip is the most recently created run

  # The run-state ramp is fixed (DESIGN surface 2): colour AND label always travel
  # together, with a pulse for `running` and a ✓ for `done`. One source emits this
  # chip for both the current strip and the history rows.
  @executable
  Scenario Outline: each run state maps to its designed dot+label chip
    Given a run in state "<state>"
    Then its chip shows the label "<label>" in the "<token>" colour
    And the chip's distinguishing mark is "<mark>"

    Examples:
      | state     | label     | token       | mark          |
      | queued    | queued    | muted       | none          |
      | running   | running   | primary     | a pulsing dot |
      | done      | done      | primary     | a ✓           |
      | failed    | failed    | destructive | none          |
      | cancelled | cancelled | secondary   | none          |

  # --- the rendered strip + lane dot (browser) ------------------------------

  # The strip pins the current run's state at the top of the RUNS body, above the
  # History section.
  @manual
  Scenario: the Current-run strip pins the latest run's state at the top of the RUNS body
    When the operator opens story "21/00" and views its RUNS tab
    Then a teal-bordered "Current run" strip sits above the History section
    And it shows the running run's pulsing teal chip, its attempt "#3", and its truncated "sess·…" id

  # The lane-card pulse dot makes active runs visible from the board itself — a
  # different position and primitive from the item-status glyph-ring, so the two
  # never confuse; shown for `running` only.
  @manual
  Scenario: a running item shows the in-flight pulse dot on its lane card
    Given story "21/00" has a "running" run
    When the operator views the board lanes
    Then story "21/00"'s lane card carries a small teal pulse dot, distinct from its item-status glyph-ring
    And an item with no running run carries no such dot

  # When nothing is in flight, the strip still shows the most recent terminal run
  # (the strip is present whenever runs exist).
  @manual
  Scenario: with no in-flight run the strip shows the most recent terminal run
    Given story "21/00"'s runs are all terminal
    When the operator views the RUNS tab
    Then the Current-run strip shows the most recent terminal run with its terminal chip

  # With no runs at all, the strip degrades to surface 1's dashed empty-state card.
  @manual
  Scenario: an item with no runs at all degrades the strip to the empty-state card
    Given story "21/01" has never been run
    When the operator views the RUNS tab
    Then there is no Current-run strip
    And the body shows the dashed "No runs yet" card

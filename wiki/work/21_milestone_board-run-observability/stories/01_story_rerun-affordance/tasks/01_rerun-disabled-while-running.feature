@ui @work @board
Feature: ↻ Rerun is disabled while a run is in flight, so a second run is never stacked
  In order to keep one run in flight at a time on an item
  the ↻ Rerun affordance is disabled with a hint while the item has an in-flight run, and re-enables once
  that run reaches a terminal state — staying visible (not hidden) throughout, and subordinate to the
  header's primary ▸ Run agent action.

  # "One run at a time" is the run-store's own dedup guard (a second non-terminal
  # mint is rejected duplicate-run); the disabled affordance is the UI making that
  # rule visible from the read-model (DESIGN surface 3). An item is "in flight" when
  # it has a queued|running run — queued is reserved for m20 but the predicate covers
  # it forward-stably. The disabled PREDICATE is pure -> @executable; the rendered
  # disabled/enabled button + hint + subordinate weight are @manual. The button is
  # the single SLOT for m20's later fresh|resume choice (same position/weight) — a
  # design forward-stability property, not a behaviour asserted here.
  Background:
    Given story "21/00" is selected on its RUNS tab

  # The predicate: the rerun is disabled exactly when a non-terminal run exists.
  @executable
  Scenario Outline: the rerun is disabled exactly when a run is in flight
    Given an item whose runs are "<runs>"
    Then the rerun affordance is "<state>"

    Examples:
      | runs                       | state    |
      | one running                | disabled |
      | one queued                 | disabled |
      | all terminal (done/failed) | enabled  |
      | no runs at all             | enabled  |

  # While running, the button is greyed (not-allowed cursor) with the hint — and
  # stays VISIBLE, not hidden, so the strip layout never jumps.
  @manual
  Scenario: while a run is running the rerun is greyed with the in-progress hint
    Given story "21/00" has a "running" run
    When the operator views the Current-run strip
    Then "↻ Rerun" is shown disabled with a not-allowed cursor
    And a muted "a run is in progress" hint sits beside it
    And the button stays visible, not hidden

  # Once the run is terminal, the affordance re-enables on the next refresh.
  @manual
  Scenario: the rerun re-enables once the run reaches a terminal state
    Given story "21/00"'s run was running and has now finished
    When the RUNS view next refreshes
    Then "↻ Rerun" is enabled again

  # Rerun is a quiet re-do of the same launch — subordinate to the header's primary
  # ▸ Run agent, never a second equally-loud launch button.
  @manual
  Scenario: the rerun is visually subordinate to the header's primary Run agent
    Given story "21/00" has a terminal run
    When the operator views the Current-run strip
    Then "↻ Rerun" renders as a quiet outline/secondary button
    And it is visually subordinate to the detail header's primary "▸ Run agent"

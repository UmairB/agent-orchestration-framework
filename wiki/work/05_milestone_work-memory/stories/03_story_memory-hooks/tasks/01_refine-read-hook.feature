@cli @work @memory @manual
Feature: refine recalls prior lessons before the agent decides
  In order to stop an agent repeating a lesson a past milestone already learned
  aof:refine must recall the relevant prior lessons at the decision point and surface them BEFORE the
  architect writes ADRs or the PO breaks down stories.

  # Agent-run observation (the agent's own behaviour can't be asserted by a unit test). Procedure +
  # result recorded in the milestone VERIFICATION.md with `verifies →` this scenario. The mechanical
  # render it relies on is @executable (task 00); the no-op-when-off path is @executable (task 04).

  Scenario: the architect is shown prior architecture lessons before authoring ADRs
    Given memory.backend is "local" and the index holds prior lessons
    When an agent runs "aof:refine" to author a milestone's ARCHITECTURE.md
    Then refine runs a scoped recall ("--area architecture") before any ADR is written
    And the compact prior-lessons block is surfaced in the architect's context

  Scenario: a surfaced near-miss is acknowledged in the decision record
    Given recall surfaces a near-miss lesson relevant to a decision being made
    When the architect commits the ADR
    Then the ADR (or STATE) records how it honours — or consciously departs from — that lesson
    And the agent records the procedure and result in VERIFICATION.md

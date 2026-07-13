<!-- aof-generated: bundle -->

# Task feature — what is observably true when aof:verify closes a SPIKE?
# LITMUS: every line below is confirmable by an agent running `aof:verify <spike-ref>` and observing the
#   skill's report + the spike's resulting status — WITHOUT reading src/work.mjs or the skill internals.
# The per-type verify path is skill-orchestrated (ADR-003) and cannot yet be driven by the @executable
#   suite, so these scenarios are @manual: an agent runs the skill and observes the outcome.

@cli @work @validate @manual
Feature: aof:verify accepts a spike on its recorded finding, not on green tests
  In order to close a de-risking spike on its own terms
  the system must accept it when its `## Finding` records the resolved unknown — with no scenario/test run,
  because the spike's deliverable is the finding and its prototype code is throwaway (ADR-003).

  Background:
    Given a well-formed spike item whose SPIKE.md carries a `## Question` and a `## Finding` section
    And the spike folder has no `tasks/` and no `.feature` (it carries no behavioural contract)

  # Headline: the finding IS the close criterion — a filled finding accepts, with no tests-green step.
  Scenario: aof:verify accepts a spike whose ## Finding is filled
    Given the spike's `## Finding` section records the resolved unknown (a real finding, not a placeholder)
    When an agent runs `aof:verify <spike-ref>`
    Then the skill's report cites the recorded finding as the close criterion
    And it runs no scenario suite and reports no "tests green" step for the spike
    And the spike's record doc status becomes `done`

  # Headline: an empty finding is NOT acceptable — the deliverable is missing.
  Scenario: aof:verify does not accept a spike whose ## Finding is empty or absent
    Given the spike's `## Finding` section is empty or absent
    When an agent runs `aof:verify <spike-ref>`
    Then the skill reports the finding as unresolved and declines to accept
    And the spike's record doc status is left unchanged (not `done`)

  # The finding-state matrix: what a black-box observer sees for each shape of `## Finding`.
  Scenario Outline: aof:verify maps a spike's finding state to an accept decision
    Given the spike's `## Finding` section is <finding-state>
    When an agent runs `aof:verify <spike-ref>`
    Then the accept decision is <decision>
    And the resulting status is <status>

    Examples:
      | finding-state                                    | decision     | status       |
      | filled with a resolved finding                   | accepted     | done         |
      | empty (heading present, no body)                 | not accepted | unchanged    |
      | absent (no ## Finding heading at all)            | not accepted | unchanged    |
      | placeholder-only (e.g. "TODO" / template stub)   | not accepted | unchanged    |

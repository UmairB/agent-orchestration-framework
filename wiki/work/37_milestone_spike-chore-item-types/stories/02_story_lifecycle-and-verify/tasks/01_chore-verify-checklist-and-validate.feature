<!-- aof-generated: bundle -->

# Task feature — what is observably true when aof:verify closes a CHORE?
# LITMUS: every line is confirmable by an agent running `aof:verify <chore-ref>` and observing the skill's
#   report + the chore's resulting status + the `aof work validate` result — WITHOUT reading internals.
# Skill-orchestrated per-type path (ADR-003): not yet suite-drivable, so @manual.

@cli @work @validate @manual
Feature: aof:verify accepts a chore on a ticked checklist and a green validate
  In order to close non-functional housekeeping without behavioural ceremony
  the system must accept a chore only when every `## Definition of Done` box is ticked AND
  `aof work validate` is green — with no `.feature` and no behavioural verify anywhere in the path (ADR-003).

  Background:
    Given a well-formed chore item whose CHORE.md carries an `## Intent` and a `## Definition of Done` checklist
    And the chore folder has no `tasks/` and no `.feature` (it carries no behavioural contract)

  # Headline: both preconditions met — checklist fully ticked AND validate green — accepts.
  Scenario: aof:verify accepts a chore with every DoD box ticked and validate green
    Given every box in the chore's `## Definition of Done` checklist is ticked
    And `aof work validate` reports green (no regression) for the chore
    When an agent runs `aof:verify <chore-ref>`
    Then the skill's report cites the ticked checklist and the green validate as the close criteria
    And it runs no `.feature` scenario and reports no behavioural-verify step for the chore
    And the chore's record doc status becomes `done`

  # Headline: acceptance is blocked when any precondition fails — the two-gate matrix.
  Scenario Outline: aof:verify blocks a chore unless every box is ticked and validate is green
    Given the chore's `## Definition of Done` boxes are <checklist-state>
    And `aof work validate` for the chore reports <validate-result>
    When an agent runs `aof:verify <chore-ref>`
    Then the accept decision is <decision>
    And the resulting status is <status>

    Examples:
      | checklist-state          | validate-result | decision     | status       |
      | all ticked               | green           | accepted     | done         |
      | one box unticked         | green           | not accepted | unchanged    |
      | all ticked               | red             | not accepted | unchanged    |
      | one box unticked         | red             | not accepted | unchanged    |

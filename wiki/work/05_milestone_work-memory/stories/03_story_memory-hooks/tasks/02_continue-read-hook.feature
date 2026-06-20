@cli @work @memory @manual
Feature: continue recalls the relevant gotchas before build
  In order to stop a developer re-hitting a known near-miss while implementing
  aof:continue must recall the milestone's domain lessons — biased to near-misses — and surface them
  before the build starts.

  # Agent-run observation; recorded in VERIFICATION.md with `verifies →` this scenario.

  Scenario: the developer is shown domain near-misses before building
    Given memory.backend is "local" and the index holds prior lessons
    When an agent runs "aof:continue" to build a story's tasks
    Then continue runs a recall scoped to the milestone's domain plus "--kind near-miss" before build
    And the compact prior-lessons block is surfaced in the developer's context
    And the agent records the procedure and result in VERIFICATION.md

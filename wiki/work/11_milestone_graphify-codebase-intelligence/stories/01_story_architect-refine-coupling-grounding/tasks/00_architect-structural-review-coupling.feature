@cli @work @work-stream @manual
Feature: structural review judges actual coupling, not grep-and-infer
  In order for the aof-architect's structural verdict to rest on the codebase's real call/dependency
  structure instead of inference from reading
  the architect, during structural review, builds the codebase graph fresh and queries actual
  coupling, then cites graph-derived coupling in its verdict — inherited by both aof:continue step 3
  and aof:code-review step 3 through the one aof-architect agent prompt.

  # ADR-001/002 — prompt wiring in src/bundle/agents/aof-architect.md; no render, the graph:query answer
  # IS the context. The architect agent has Bash (aof-architect.md:4), so it can run `aof graph …` (or
  # call the aof MCP graph_query tool, graph-mcp-server.mjs). Agent-observed @manual (live graphify + an
  # agent): procedure + result in VERIFICATION.md with `verifies →` these scenarios. The prompt-content
  # PRESENCE of the step is pinned by story 03's arch-tests, not by a scenario here; the advisory
  # NO-GATE structural fact is story 03's acd-codebase-grounding-advisory, not restated below.

  Background:
    Given the aof-architect agent prompt carries the structural coupling-grounding step
    And graphify is available

  Scenario: the architect cites graph-derived coupling in its structural verdict
    When the architect runs a structural review
    Then it builds the codebase graph fresh ("aof graph build <repo source root>")
    And it queries actual coupling ("aof graph query <coupling question>")
    And its verdict cites graph-derived coupling — who-calls/imports-whom and god-nodes — as actual, not inferred

  Scenario Outline: the same agent-prompt grounding is inherited by both review entry points
    Given <entry-point> spawns aof-architect for structural review at <step>
    When the architect reviews
    Then it runs the graph build-then-query coupling step from the shared agent prompt
    And it cites graph-derived coupling in the verdict it returns to <entry-point>

    Examples: the two entry points that inherit the one agent-prompt edit
      | entry-point     | step   |
      | aof:continue    | step 3 |
      | aof:code-review | step 3 |

  Scenario: coupling informs the verdict but never auto-fails the review
    Given the graph reports tight coupling on a changed module
    When the architect writes its verdict
    Then the verdict is the architect's judgment, citing the coupling as evidence
    And tight coupling alone does not auto-fail the review

  Scenario: graphify absent — structural review falls back to grep-and-infer
    Given graphify is not installed
    When the architect runs a structural review
    Then "aof graph build" returns the graphify-missing miss
    And the architect reviews on grep-and-infer exactly as before this milestone
    And no block or crash occurs

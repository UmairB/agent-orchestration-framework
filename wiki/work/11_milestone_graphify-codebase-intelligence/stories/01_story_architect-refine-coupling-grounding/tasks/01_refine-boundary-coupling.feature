@cli @work @work-stream @manual
Feature: refine draws story boundaries that follow real coupling
  In order for an ACD story to be genuinely independent — its boundary cutting along real call and
  dependency lines rather than inferred ones
  aof:refine step 2 "Break down" consults the codebase graph for real coupling before drawing story
  boundaries, and the partition follows those dependencies with the rationale citing graph coupling.

  # ADR-001/002 — prompt wiring in src/bundle/commands/refine.md step 2, mirroring the SHAPE of step 1
  # "Decide"'s existing memory-recall hook (run-then-consider, no-op when off — refine.md:45-56). refine
  # allows Bash (refine.md:4), so the agent can run `aof graph …`. No render. Agent-observed @manual:
  # procedure + result in VERIFICATION.md with `verifies →` these scenarios. The advisory "graph never
  # auto-rewrites the partition" is the OBSERVABLE below; the structural no-gate fact is story 03's
  # arch-test.

  Background:
    Given refine.md step 2 "Break down" carries the boundary coupling-grounding step
    And graphify is available

  Scenario: the graph is consulted for coupling before boundaries are drawn
    When refine runs step 2 "Break down"
    Then it builds the codebase graph fresh and queries coupling BEFORE drawing any story boundary
    And the order is build-then-query-then-partition, not partition-then-rationalise

  Scenario: the partition follows real dependencies and the rationale cites the coupling
    Given the graph reports the actual coupling between candidate story areas
    When refine draws the story boundaries
    Then each boundary follows the real call/dependency lines the graph reported
    And the breakdown rationale (or ARCHITECTURE.md) cites the graph-derived coupling

  Scenario: refine draws the partition — the graph informs it, never auto-rewrites it
    Given the graph reports coupling that cuts across a candidate boundary
    When refine settles the partition
    Then the agent draws the partition using its own judgment, citing the coupling
    And no boundary is auto-rewritten from graph output

  Scenario: graphify absent — boundaries are drawn from reading, as before
    Given graphify is not installed
    When refine runs step 2 "Break down"
    Then "aof graph build" returns the graphify-missing miss
    And refine draws boundaries from reading the source exactly as before this milestone
    And no block or crash occurs

@cli @work @work-stream @manual
Feature: the grounding convention — build-fresh, read the legible output, cite it as advisory
  In order for the two seam stories to paste ONE discipline into their prompts without renegotiating
  freshness, advisory-only, or the absent-binary fallback
  an agent following the grounding convention builds the codebase graph fresh before querying,
  reads the legible command output (never parsing it), cites it as advisory context that informs but
  does not dictate its judgment, and treats an absent graphify binary as a silent no-op.

  # ADR-001 (agent reads legible output, never parsed) / ADR-002 (no render — the command output IS the
  # context) / ADR-003 (build-fresh, freshness visible via the 09 BuildResult) / ADR-004 (advisory) /
  # the existing 09/ADR-004 graphify-missing miss. Agent-observed: the agent's own behaviour can't be
  # asserted by a unit test — procedure + result recorded in VERIFICATION.md with `verifies →` these
  # scenarios. This is the 05/03 read-hook split. NOTE: unlike 05/03 task-04, the no-op-when-absent here
  # is @manual NOT @executable — 11 has NO render to mechanically no-op (ADR-002); the no-op is the AGENT
  # proceeding on grep-and-infer, an observed behaviour. The structural facts behind this convention
  # (no-parse, advisory-no-gate) are story 03's arch-tests, NOT scenarios here.

  Scenario: the graph is built fresh before it is queried, and freshness is visible
    Given an agent at a grounding decision point with graphify available
    When the agent runs the grounding step
    Then the agent runs "aof graph build <repo source root, e.g. src>" before any query or triage
    And the agent reads back the builtAt timestamp, egress, and node/edge counts from the BuildResult
    And the queried graph reflects the source as of that builtAt

  Scenario: the agent reads the legible command output and reasons over it as text
    Given a freshly built codebase graph
    When the agent runs "aof graph query" for coupling and reads the answer
    Then the agent consumes the markdown answer as natural-language context
    And the agent's reasoning cites what the answer says (who-calls/imports-whom, god-nodes)

  Scenario: the grounding is advisory — the agent's judgment decides, the graph informs
    Given the graph answer reports a coupling fact relevant to the decision
    When the agent writes its decision (verdict / boundary / ranking)
    Then the decision is the agent's own judgment, citing the graph as one input among others
    And the decision is not auto-derived from the graph output

  Scenario: a reused graph is permitted only with its age surfaced
    Given an existing graphify-out/graph.json from an earlier build
    When the agent chooses to reuse it instead of building fresh
    Then the agent surfaces its age (builtAt / file mtime) before reasoning over it
    And a graph old enough to mislead is rebuilt rather than served silently

  Scenario: graphify absent — the grounding step is a silent no-op
    Given graphify is not installed (resolveGraphifyBinary reports found:false with an install hint)
    When the agent runs the grounding step
    Then "aof graph build" returns the structured graphify-missing miss
    And the agent notes the graph is unavailable and proceeds on grep-and-infer
    And the step produces no block, no crash, and no prompt noise
    And the agent's behaviour is identical to ACD before this milestone

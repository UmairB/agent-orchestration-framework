@cli @work @work-stream @manual
Feature: code-review surfaces a PR-impact triage queue as advisory review context
  In order for structural review of a PR to be ranked by real blast-radius instead of reviewing the
  diff blind to which changed modules are highest-impact
  aof:code-review step 3 runs "aof graph triage" and surfaces the ranked impact queue as context when
  handing the diff to aof-architect — without touching the existing merge gate.

  # ADR-001/004 — prompt wiring in src/bundle/commands/code-review.md step 3; graph:triage is CLI-only
  # (09/ADR-001: no MCP triage tool), the agent reads the opaque ranked-queue markdown, never parsed.
  # No render. Agent-observed @manual (live graphify + a real PR + an agent): procedure + result in
  # VERIFICATION.md with `verifies →` these scenarios. The advisory "triage never auto-blocks the merge
  # gate" is the OBSERVABLE below (step 6 unchanged); the structural no-gate fact (no graph:triage output
  # wired into work.codeReview.autoComplete) is story 03's acd-codebase-grounding-advisory arch-test.
  #
  # COMMAND BEHAVIOUR (verified at refine — src/graphify.mjs:180-187 — carry into the build): the triage
  # verbs are MUTUALLY EXCLUSIVE at the spawn. `aof graph triage` (no pr) → `graphify prs --triage` =
  # the RANKED PR-impact queue (this IS the ranking the reviewer surfaces). `aof graph triage --pr N` →
  # `graphify prs N` = a SINGLE-PR impact view (a drill-down), NOT a ranked queue. So the step's primary
  # surface is the plain `aof graph triage` ranked queue; `--pr N` is an optional single-PR drill-down.
  # The Examples below state this honestly — do not assume `--pr N` returns a ranked queue.

  Background:
    Given code-review.md step 3 carries the graph:triage PR-impact grounding step
    And graphify is available

  Scenario: the ranked impact queue is surfaced when handing the diff to aof-architect
    When code-review runs step 3 "Review" over a PR
    Then it builds the codebase graph fresh and runs "aof graph triage" (the ranked queue, prs --triage)
    And the ranked impact queue is surfaced as context to aof-architect alongside the diff
    And aof-architect reasons over the ranking, reviewing highest-impact changed modules first

  Scenario Outline: the triage verbs are distinct — the ranked queue vs a single-PR drill-down
    Given <invocation>
    When code-review step 3 runs the triage grounding
    Then it invokes "aof graph triage <args>" which spawns "graphify <verb>"
    And the agent reads <result> as advisory context

    Examples: plain triage is the ranked queue; --pr N is a single-PR view (mutually exclusive verbs)
      | invocation                        | args   | verb        | result                              |
      | the default ranked-queue surface  |        | prs --triage | the ranked PR-impact queue          |
      | an optional drill-down on PR N    | --pr N | prs N        | a single-PR impact view (not ranked) |

  Scenario: the triage queue is advisory — the merge gate is unchanged
    Given the triage ranks a changed module as highest-impact
    When code-review reaches step 6 (the merge gate)
    Then the gate is exactly CI-green + no-blocking-finding, as before this milestone
    And the triage rank is never an auto-block input to the merge
    And any concern the rank raises flows through the normal human/agent-judged finding path

  Scenario: graphify absent — code-review proceeds unranked
    Given graphify is not installed
    When code-review runs step 3 "Review"
    Then "aof graph triage" returns the graphify-missing miss
    And the review proceeds unranked exactly as before this milestone
    And no block or crash occurs

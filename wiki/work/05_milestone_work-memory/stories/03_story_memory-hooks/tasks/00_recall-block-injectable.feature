@cli @work @memory @executable
Feature: a read hook injects recall output as a compact, bounded prior-lessons block
  In order for a command to paste prior lessons into an agent's context without flooding it
  recall must render a compact block: scope-filtered, highest-relevance first, capped at the hook
  limit, one line per record carrying the fields an agent needs to act — id, kind, area, title, and
  the source it can open.

  # The read hook is prompt wiring (verified @manual in 01/02); the ONE new mechanical surface is this
  # injection render. It consumes the frozen RecallResult (ADR-004) — no new backend method. Tests run
  # over a hand-authored fixture index so the block is deterministic.
  Background:
    Given a fixture index with more lessons and ADRs than the hook limit

  Scenario: the block is bounded to the hook limit
    When the refine read hook recalls with limit 3
    Then the injected block has at most 3 records

  Scenario: the block is scope-filtered before it is rendered
    When the read hook recalls with "--area architecture"
    Then every line in the injected block is an architecture-area record
    And no off-scope record appears

  Scenario: the block is ordered highest-relevance first
    When the read hook recalls a query the fixture matches at varying strengths
    Then the block lines are in non-increasing score order

  Scenario: each line carries the fields an agent needs to act on it
    When the read hook renders a record
    Then the line shows its id, kind, area, title, and source
    And the source is a "path:line" that opens the live heading

  Scenario: an empty recall renders an empty block, not a placeholder
    Given a scope that matches no record
    When the read hook recalls
    Then the injected block is empty
    And it is omitted from the agent context rather than shown as "none"

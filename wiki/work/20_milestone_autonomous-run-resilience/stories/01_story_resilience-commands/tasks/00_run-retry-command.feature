@cli @work @work-stream @executable
Feature: work:run-retry registers into the core as a write that resumes a retryable failed run's lineage
  In order that resume-vs-fresh is reachable through the one command door every face couples through, rather than improvised
  the work:run-retry command registers into the same command core as a thin write wrapper over story 00's retryRun — resolving the item exact, resuming the prior session on an incremented, linked lineage, and surfacing the store's coded rejections,
  so that the CLI drives it today and the board (m21) and the autonomous skill (story 02) inherit the verb for free, and a typo'd ref can never retry a run on the wrong item.

  # ARCHITECTURE ADR-003 (command path): src/commands/run-retry.mjs is a thin WRITE
  # wrapper (resolveItemExact, the 08/ADR-003 write-isolation) over story 00's retryRun,
  # registered into command-core.mjs (one import + one COMMANDS entry — the additive
  # door). It carries the frozen 08/ADR-002 { id, input, run, cli } shape. The lineage
  # SHAPE is the shared acd-run-retry-resumes-lineage arch-test; the registry GATES are
  # the acd-work-command-cli-bijection / command-core-contract / route-coverage
  # extensions (this story owns them). This feature invokes the command in-process
  # through the registry; the CLI face is task 01.
  # LITMUS: registry shape, returned record fields, and coded errors are observable
  # in-process through the registry → @executable.
  Background:
    Given a work-stream fixture with a milestone "20" and a story "20/00"
    And the command registry loaded in-process from src/command-core.mjs

  # The verb is registered into the SAME core (additive, ADR-003), carrying the frozen
  # shape the bijection arch-test asserts structurally — alongside the three 19 run verbs.
  Scenario: the registry exposes work:run-retry with the frozen command shape
    When I list the registered command ids
    Then the ids include "work:run-retry"
    And "work:run-retry" carries an "input" schema, an async "run", and a "cli" adapter with argv + render

  # work:run-retry resumes the lineage (ADR-003): given a retryable failed run, it returns
  # a NEW running run carrying the prior sessionId, attempt + 1, and retryOf linking the
  # prior — the command-path face of story 00's retryRun.
  Scenario: work:run-retry resumes the prior session on an incremented, linked lineage
    Given item "20" has a failed run with sessionId "sess-3", attempt 1, and failureReason "timeout"
    When I invoke "work:run-retry" with ref "20"
    Then the result is a run record with "state" running and "outcome" null
    And the result run record "sessionId" is "sess-3"
    And the result run record "attempt" is 2
    And the result run record "retryOf" is the prior run's runId

  # work:run-retry is a WRITE — it resolves EXACT (08/ADR-003): a typo'd / partial /
  # unresolvable ref returns ref-not-found and retries NO run, leaving the failed run
  # still failed. The matrix mirrors run-start/run-complete's write-isolation set.
  Scenario Outline: work:run-retry resolves exact — a typo retries no run on the wrong item
    Given item "20" has a retryable failed run
    When I invoke "work:run-retry" with ref "<ref>"
    Then the outcome is "<outcome>"

    Examples:
      | ref                       | outcome                              |
      | 20                        | resumes the run                      |
      | 20/00                     | ref-not-found error, no run retried  |
      | 99                        | ref-not-found error, no run retried  |
      | 20/99                     | ref-not-found error, no run retried  |
      | autonomous-run-resilience | ref-not-found error, no run retried  |
      | 2                         | ref-not-found error, no run retried  |
      | (empty)                   | ref-not-found error, no run retried  |

  # work:run-retry surfaces the store's coded rejections (ADR-002/003) unchanged: a
  # non-retryable prior (agent_error), a ceiling-exhausted prior, and an item with no
  # retryable run each raise their DISTINCT coded error and mint no run. The command is a
  # thin pass-through of the store's authority — it never re-derives the verdict.
  Scenario Outline: work:run-retry surfaces the store's coded rejection and mints no run
    Given item "20" is in state "<situation>"
    When I invoke "work:run-retry" with ref "20" and maxAttempts 3
    Then invoke raises a "<error>" error
    And no new run record is minted for item "20"

    Examples:
      | situation                                  | error              |
      | a failed agent_error run at attempt 1      | not-retryable      |
      | a failed timeout run at attempt 3          | attempts-exhausted |
      | no failed run at all                       | no-retryable-run   |

  # The prior run is selected like run-complete's single-target mirror (ADR-003): an
  # explicit runId targets that run; with none, the item's most-recent terminal failed
  # run is resumed.
  Scenario Outline: work:run-retry targets the runId when given, else the most-recent failed run
    Given item "20" has two failed timeout runs
    When I invoke "work:run-retry" with ref "20" and <runId>
    Then the outcome is "<result>"

    Examples:
      | runId             | result                                |
      | no runId          | resumes the most-recent failed run    |
      | the older runId   | resumes the older run                 |

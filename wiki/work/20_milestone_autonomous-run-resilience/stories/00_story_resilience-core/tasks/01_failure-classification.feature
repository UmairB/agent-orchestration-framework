@cli @work @work-stream @executable
Feature: A closed table classifies a failure as retryable or not, and shouldRetry caps it at the attempt ceiling
  In order that an infra failure auto-retries while an agent rejection does not, and a genuinely-failing item halts instead of looping
  the run store classifies failureReason against one closed table via the pure isRetryable, and shouldRetry pairs that verdict with the attempt ceiling so the store and the retry command share one authority,
  so that no face improvises which failures retry, and the ceiling makes "halt a genuinely-failing item instead of looping" (SPEC §Objective) a deterministic mechanic.

  # ARCHITECTURE ADR-002: a CLOSED classification table evaluated by PURE functions in
  # src/run-store.mjs, the isLegalTransition sibling (the 06/ADR-003 single-pure-resolver
  # precedent). This feature exercises the OBSERVABLE verdicts; the STRUCTURAL claim "the
  # table is closed AND the functions are pure (no clock/fs/config)" is the
  # acd-run-retry-classification arch-test (fitness function), NOT restated here.
  # LITMUS: every line is the boolean a pure function returns for a given input — fully
  # deterministic in-process → @executable.
  Background:
    Given the run store loaded in-process from src/run-store.mjs

  # The closed table, in FULL (ADR-002): runtime_offline / timeout are infra → retryable;
  # agent_error is a real bad output → non-retryable; anything unknown or null fails
  # closed → non-retryable (an unknown reason never auto-retries). Enumerated so the
  # retryable set and the fail-closed set are both pinned with no gap.
  # QA: the table IS the frozen classification, one row per reason plus the unknown/null
  # fail-closed rows — every documented input appears exactly once.
  Scenario Outline: isRetryable returns the closed-table verdict for each failureReason
    When I evaluate isRetryable for failureReason "<failureReason>"
    Then the verdict is "<retryable>"

    Examples: infra failures — retryable
      | failureReason   | retryable |
      | runtime_offline | true      |
      | timeout         | true      |

    Examples: agent rejection + unknown/null — fail closed, non-retryable
      | failureReason   | retryable |
      | agent_error     | false     |
      | some_other_kind | false     |
      | null            | false     |

  # shouldRetry(record, maxAttempts) (ADR-002) is true IFF the reason is retryable AND
  # the record's attempt is still below the ceiling — it ANDs the classification with the
  # attempt count. The store never reads config; the resolved ceiling is passed in
  # (08/ADR-002 basis-neutral). This matrix pins both gates: a retryable reason under the
  # ceiling retries; the same reason AT the ceiling fails closed; a non-retryable reason
  # never retries regardless of attempt.
  Scenario Outline: shouldRetry ANDs the classification with the attempt ceiling, failing closed at the ceiling
    Given a failed run record with failureReason "<failureReason>" and attempt <attempt>
    When I evaluate shouldRetry for that record with maxAttempts <maxAttempts>
    Then the verdict is "<shouldRetry>"

    Examples: a retryable reason retries below the ceiling, halts at it
      | failureReason   | attempt | maxAttempts | shouldRetry |
      | timeout         | 1       | 3           | true        |
      | timeout         | 2       | 3           | true        |
      | timeout         | 3       | 3           | false       |
      | runtime_offline | 1       | 3           | true        |
      | runtime_offline | 4       | 3           | false       |
      | timeout         | 1       | 1           | false       |

    Examples: a non-retryable reason never retries, ceiling or not
      | failureReason   | attempt | maxAttempts | shouldRetry |
      | agent_error     | 1       | 3           | false       |
      | some_other_kind | 1       | 3           | false       |
      | null            | 1       | 3           | false       |

  # The ceiling is the configured value, not a hard-coded constant (ADR-002 rejected
  # Multica's fixed 2): the same record yields a different verdict under a different
  # maxAttempts, proving the ceiling is the passed-in argument the operator's
  # work.autonomous.maxAttempts controls.
  Scenario: the ceiling is the supplied maxAttempts, not a fixed constant
    Given a failed run record with failureReason "timeout" and attempt 2
    When I evaluate shouldRetry for that record with maxAttempts 2
    Then the verdict is "false"
    When I evaluate shouldRetry for that record with maxAttempts 3
    Then the verdict is "true"

  # The functions are pure as an OBSERVABLE (the STRUCTURAL purity grep is the arch-test):
  # the same inputs always yield the same verdict, and no argument is mutated. This is the
  # behavioural shadow of the no-clock/no-fs/no-config invariant.
  Scenario: classification is referentially transparent — same inputs, same verdict, no mutation
    Given a failed run record with failureReason "timeout" and attempt 1
    When I evaluate shouldRetry for that record with maxAttempts 3 twice
    Then both verdicts are "true"
    And the record passed in is left unmutated by the call

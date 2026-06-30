@cli @work @work-stream @executable
Feature: retryRun mints a lineage-linked run that resumes the prior session, gated by shouldRetry
  In order that an auto-retry on an infra failure continues the prior session (the runtime, not the work, was the problem) while preserving a per-run audit trail
  the store's retryRun resolves the prior failed run, consults shouldRetry, and on a yes mints a NEW run carrying the prior sessionId with attempt incremented and retryOf linking the lineage — rejecting a non-retryable or ceiling-exhausted prior with a coded error and no new run,
  so that resume-vs-fresh is the verb's job (run-retry resumes; run-start stays fresh, 19/ADR-003) and a retried run is a new, sortable, audited record rather than a mutated prior one.

  # ARCHITECTURE ADR-003 (store side): retryRun(item, { runId, maxAttempts, brief })
  # reuses startRun's mint path (so the atomic-persist + dedup guards apply uniformly),
  # carries the prior sessionId, sets attempt = prior.attempt + 1 and retryOf =
  # prior.runId. The STRUCTURAL shape (a retry record carries the lineage; a start record
  # carries neither) is the acd-run-retry-resumes-lineage arch-test, shared with the
  # story-01 command path. This feature is the OBSERVABLE store behaviour.
  # LITMUS: lineage field values + a coded rejection + a byte-unchanged prior record, all
  # observable in-process over runs/ → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # The happy path (ADR-003): a retryable failed prior is resumed — the new run carries
  # the prior sessionId forward, increments attempt, and links retryOf to the prior runId.
  # It is a NEW run record (new runId), not a mutation of the prior (ADR-003 rejected
  # in-place mutation — every trigger is a new run, the PRD "Issue ≠ Task" audit).
  Scenario: retrying a retryable failed run resumes its session on an incremented, linked lineage
    Given item "20" has a failed run with sessionId "sess-7", attempt 1, and failureReason "timeout"
    When I retry that run for item "20"
    Then a new run record is minted with its own distinct runId
    And the new run record "sessionId" is "sess-7"
    And the new run record "attempt" is 2
    And the new run record "retryOf" is the prior run's runId
    And the new run record "state" is "running"
    And the prior run record is left byte-unchanged

  # A fresh start carries NEITHER lineage field (ADR-003): startRun is untouched from
  # 19/ADR-003 — retryOf null, and it never carries a prior session. This is the
  # contrast the resume policy turns on, pinned alongside the retry record.
  Scenario: a fresh start carries retryOf null and no prior session
    When I start a run for item "20" with no prior run
    Then the run record "retryOf" is null
    And the run record "attempt" is 1

  # The prior run is resolved like 19's completeRun's single-running-run mirror (ADR-003):
  # an explicit runId targets that run; with no runId the store picks the item's
  # most-recent terminal failed run; with no retryable run at all it is the coded
  # no-retryable-run, minting nothing.
  Scenario Outline: retryRun resolves the prior run by runId, else the most-recent failed run
    Given item "20" is in state "<situation>"
    When I retry for item "20" with <runId>
    Then the outcome is "<result>"

    Examples:
      | situation                                            | runId               | result                              |
      | one failed timeout run                               | no runId            | resumes that run                    |
      | two failed timeout runs                              | the older runId     | resumes the older run               |
      | two failed timeout runs                              | no runId            | resumes the most-recent failed run  |
      | no run at all                                        | no runId            | no-retryable-run error, nothing minted |
      | only a done run, no failed run                       | no runId            | no-retryable-run error, nothing minted |

  # The gate (ADR-002 → ADR-003): retryRun consults shouldRetry before minting. A
  # non-retryable prior (agent_error — "you judged the output bad") and a ceiling-
  # exhausted prior each surface a DISTINCT coded error and mint NO new run; the prior
  # record is byte-unchanged (the 19/R4 unaffected-sibling pin).
  Scenario Outline: a non-retryable or ceiling-exhausted prior is rejected with a coded error and no new run
    Given item "20" has a failed run with failureReason "<failureReason>" and attempt <attempt>
    When I retry that run for item "20" with maxAttempts <maxAttempts>
    Then the store raises a "<error>" error
    And no new run record is minted for item "20"
    And the prior run record is byte-unchanged

    Examples: a non-retryable reason (agent_error + the fail-closed unknown/null) → not-retryable
      | failureReason   | attempt | maxAttempts | error               |
      | agent_error     | 1       | 3           | not-retryable       |
      | some_other_kind | 1       | 3           | not-retryable       |
      | null            | 1       | 3           | not-retryable       |

    Examples: a retryable reason at/over the ceiling → attempts-exhausted (the two codes stay distinct)
      | failureReason   | attempt | maxAttempts | error               |
      | timeout         | 3       | 3           | attempts-exhausted  |
      | runtime_offline | 4       | 3           | attempts-exhausted  |

  # The retried run is itself completable and re-retryable on the SAME lineage (ADR-003):
  # resuming again carries the session forward and increments attempt a second time, so
  # the lineage chains attempt 1 → 2 → 3 toward the ceiling. This is how the ceiling
  # eventually halts (ADR-002), proven over the real chain.
  Scenario: resuming a retried run again chains the lineage and marches attempt toward the ceiling
    Given item "20" has a failed run with sessionId "sess-9", attempt 1, and failureReason "timeout"
    When I retry that run, then fail the retry with "timeout", then retry again
    Then the second retry record "attempt" is 3
    And the second retry record "sessionId" is "sess-9"
    And each retry record's "retryOf" links to the run it resumed

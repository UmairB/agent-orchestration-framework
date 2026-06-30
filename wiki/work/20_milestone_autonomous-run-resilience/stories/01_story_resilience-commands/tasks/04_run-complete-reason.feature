@cli @work @work-stream @executable
Feature: work:run-complete accepts a --reason that records the failureReason on a failed run
  In order that an operator/agent-reported failure carries a classifiable reason the retry decision can read
  the existing work:run-complete command gains an optional reason that, on an --outcome failed, is written onto the run record's failureReason (via story 00's store write) — null on a clean done or a cancellation,
  so that the classification table (ADR-002) and the retry gate (ADR-003) have a real failureReason produced by the operator/agent path, the command-layer half of the producer seam whose store half is story 00.

  # DEFAULT DECISION (refine 2026-06-30, recorded in STATE §Notes): the failureReason
  # PRODUCER for an operator/agent-reported failure (timeout / agent_error) is split — the
  # STORE write lands in story 00 (completeRun/applyTransition writes failureReason on a
  # →failed transition) and the COMMAND-LAYER --reason flag lands HERE (story 01). No ADR
  # named this producer (ADR-004 names only the reclaim path's runtime_offline); the
  # contract names it now because five features depend on a failed run carrying a reason.
  # This extends the EXISTING work:run-complete (m19) — it registers no new command, so it
  # arms none of the 19/R1 registry gates. The store-side write is asserted in story 00's
  # 00_resilience-record-keys; this feature is the COMMAND/CLI face.
  # LITMUS: the recorded failureReason and the single --json envelope are observable
  # through the real command/CLI → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # --reason maps argv -> input -> the persisted failureReason on a failed completion
  # (ADR-001's key). The reclaim path sets runtime_offline itself (ADR-004); this is the
  # OPERATOR/AGENT-reported path for timeout / agent_error.
  Scenario Outline: run-complete --outcome failed --reason records the failureReason on the run
    Given item "20" has a single running run
    When I run "aof work run-complete 20 --outcome failed --reason <reason> --json"
    Then the JSON run record "state" is "failed"
    And the JSON run record "failureReason" is "<reason>"

    Examples:
      | reason          |
      | timeout         |
      | agent_error     |
      | runtime_offline |

  # An unrecognised reason is recorded verbatim, NOT rejected (ADR-002 fails closed at
  # classification — isRetryable false — so it never auto-retries). The command does not
  # police the reason vocabulary; the pure classifier does. This pins that --reason is a
  # pass-through, leaving the safety to the closed table.
  Scenario: run-complete records an unrecognised reason verbatim, leaving the classifier to fail closed
    Given item "20" has a single running run
    When I run "aof work run-complete 20 --outcome failed --reason some_other_kind --json"
    Then the JSON run record "failureReason" is "some_other_kind"
    And the process exits zero

  # --reason is meaningful only with --outcome failed (ADR-001: failureReason is null on a
  # clean done / cancellation). A reason supplied alongside done or cancelled is ignored —
  # failureReason stays null — so the key's "null on a non-failure" invariant holds.
  Scenario Outline: a reason is ignored on a non-failed outcome, leaving failureReason null
    Given item "20" has a single running run
    When I run "aof work run-complete 20 --outcome <outcome> --reason timeout --json"
    Then the JSON run record "state" is "<outcome>"
    And the JSON run record "failureReason" is null

    Examples:
      | outcome   |
      | done      |
      | cancelled |

  # Omitting --reason on a failed completion leaves failureReason null (backward-compatible
  # with the m19 run-complete): the rollback path (02_status-rollback) still fires on the
  # failed outcome, and the classifier fails closed on the null reason (non-retryable).
  Scenario: run-complete failed with no --reason leaves failureReason null and stays backward-compatible
    Given item "20" has a single running run
    When I run "aof work run-complete 20 --outcome failed --json"
    Then the JSON run record "state" is "failed"
    And the JSON run record "failureReason" is null

  # The single-envelope discipline holds for the extended command (08/ADR-003): --json
  # prints exactly one parseable document, success or error alike.
  Scenario: run-complete --reason preserves the single --json envelope discipline
    Given item "20" has a single running run
    When I run "aof work run-complete 20 --outcome failed --reason timeout --json"
    Then stdout parses as exactly one JSON document
    And no human-rendered line precedes or follows it

@cli @work @work-stream @executable
Feature: The run record carries the four additive resilience keys, defaulting null and forward-compatible with a milestone-19 record
  In order that the store can classify, resume, and reclaim a run from first-class typed fields rather than an opaque object it contractually never reads
  the run record is extended with failureReason / heartbeatAt / retryOf / reclaimedAt — scalar keys that default null at start, round-trip byte-equivalent, and read forward-compatibly over a nine-key milestone-19 record,
  so that the resilience control fields (ADR-002/003/004) ride on the run record itself, the single authority, with zero churn to the frozen-nine and zero impact on item frontmatter.

  # ARCHITECTURE ADR-001: the resilience metadata lands as ADDITIVE top-level keys on
  # the run record (SUPERSEDES 19/ADR-003's "exactly nine keys" freeze with a thirteen-
  # key set). This feature asserts the OBSERVABLE schema behaviour — the four new keys
  # exist, default null, round-trip, and a missing key reads as null (19/ADR-002 "absence
  # is benign"). The structural teeth (record stays derived / partition-ready) ride on
  # 19's still-green acd-run-record-derived + acd-run-partition-ready arch-tests, NOT a
  # new fitness function — so the BEHAVIOUR lives here as @executable.
  # LITMUS: every line is a field value / key presence on a persisted JSON record read
  # back from runs/ — statically confirmable in-process → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # A newly-started run carries all FOUR new keys, each present and null (ADR-001: "all
  # four new keys default null so a milestone-19 record reads forward-compatibly"). The
  # keys are scalar — no nested control object.
  Scenario: a freshly started run carries the four resilience keys, each present and null
    When I start a run for item "20"
    Then the run record has a "failureReason" key whose value is null
    And the run record has a "heartbeatAt" key whose value is null
    And the run record has a "retryOf" key whose value is null
    And the run record has a "reclaimedAt" key whose value is null
    And none of the four resilience keys is a nested object

  # The full thirteen-key set is frozen (ADR-001): the original nine (19/ADR-003,
  # unchanged in name/order/meaning) followed by the four resilience keys, and NOTHING
  # else. This pins the extended schema so no field can drift in or out unnoticed.
  # QA: the table enumerates every one of the thirteen keys and asserts the record
  # carries exactly these — the frozen set, named cell-by-cell.
  Scenario Outline: a started run carries exactly the thirteen frozen keys and no others
    When I start a run for item "20"
    Then the run record has a "<key>" key

    Examples: the original nine (19/ADR-003, unchanged)
      | key       |
      | runId     |
      | itemRef   |
      | state     |
      | attempt   |
      | outcome   |
      | sessionId |
      | brief     |
      | createdAt |
      | updatedAt |

    Examples: the four new resilience keys (ADR-001, additive)
      | key           |
      | failureReason |
      | heartbeatAt   |
      | retryOf       |
      | reclaimedAt   |

  Scenario: a started run carries no key outside the thirteen frozen keys
    When I start a run for item "20"
    Then the run record carries no field outside the thirteen frozen keys

  # Forward-compatibility (ADR-001 + 19/ADR-002 "absence is benign"): a record written
  # by milestone 19 has only the nine keys; reading it through the milestone-20 store
  # treats each missing resilience key as null, never throwing on the absence.
  Scenario Outline: a legacy nine-key record reads each missing resilience key as null
    Given a persisted run record for item "20" carrying only the nine milestone-19 keys
    When I read that run back from runs/
    Then the run record "<missing-key>" reads as null
    And reading it raises no error

    Examples:
      | missing-key   |
      | failureReason |
      | heartbeatAt   |
      | retryOf       |
      | reclaimedAt   |

  # The new keys round-trip byte-equivalent once set (ADR-001): a record whose resilience
  # keys carry real values persists and reloads unchanged across a fresh store load — the
  # durability the classify/resume/reclaim decisions rest on.
  Scenario: a record with populated resilience keys round-trips byte-equivalent across a fresh load
    Given item "20" has a persisted run whose "failureReason" is "timeout", "heartbeatAt" and "reclaimedAt" are ISO-8601 instants, and "retryOf" is a prior runId
    When I load the run store fresh and read the runs for item "20"
    Then the reloaded record's "failureReason" is "timeout"
    And the reloaded record's "retryOf" equals the prior runId, byte-equivalent
    And the reloaded record's "heartbeatAt" and "reclaimedAt" equal the persisted instants
    And the reloaded record carries all thirteen frozen keys

  # The keys are populated only by their owning mechanic, never spuriously (ADR-001
  # "applyTransition preserves them unless the transition sets them"): a clean
  # done/cancelled never invents a failureReason or reclaimedAt; a non-reclaim failure
  # leaves reclaimedAt null. This pins WHO writes each key, so a stray write is caught.
  # The operator-reported timeout row is the audit distinction ADR-001 names: an infra
  # failure REPORTED through completion (failureReason set, reclaimedAt NULL) vs a
  # RECLAIMED one (runtime_offline + reclaimedAt set) — same retryable class, different
  # provenance.
  Scenario Outline: each resilience key is set only by its owning mechanic, null otherwise
    Given a run for item "20" driven to "<situation>"
    Then the run record "failureReason" is <failureReason>
    And the run record "reclaimedAt" is <reclaimedAt>

    Examples:
      | situation                                    | failureReason     | reclaimedAt |
      | a clean completion to done                   | null              | null        |
      | an operator cancellation                     | null              | null        |
      | an operator-reported infra failure (timeout) | "timeout"         | null        |
      | an agent-reported failure (agent_error)      | "agent_error"     | null        |
      | a reclaim of a stale running run             | "runtime_offline" | an instant  |

  # The failureReason PRODUCER for an operator/agent-reported failure (the store side of
  # the split seam — DEFAULT DECISION recorded in STATE §Notes): completing a running run
  # as failed with a supplied reason WRITES that reason onto failureReason; a clean
  # done / a cancellation records null. This is the store write that gives the
  # classification (ADR-002) and the retry gate (ADR-003) a real failureReason to read —
  # the command-layer --reason flag that drives it is story 01. (The reclaim path's
  # runtime_offline producer is ADR-004, covered in 03_heartbeat-and-reclaim.)
  Scenario Outline: completing a run as failed records the supplied reason; done/cancelled record null
    Given a running run for item "20"
    When I complete that run to "<outcome>" with reason "<reason>"
    Then the run record "state" is "<outcome>"
    And the run record "failureReason" is <failureReason>

    Examples:
      | outcome   | reason      | failureReason |
      | failed    | timeout     | "timeout"     |
      | failed    | agent_error | "agent_error" |
      | done      | (none)      | null          |
      | cancelled | (none)      | null          |

  # An UNRECOGNISED reason is stored as-is, NOT rejected (ADR-002 fails closed on it at
  # classification time — isRetryable returns false — so an unknown reason never
  # auto-retries but is still recorded for audit). The store does not police the reason
  # vocabulary; the pure classifier does, by failing closed.
  Scenario: an unrecognised failure reason is recorded verbatim and left for the classifier to fail closed
    Given a running run for item "20"
    When I complete that run to "failed" with reason "some_other_kind"
    Then the run record "failureReason" is "some_other_kind"
    And the run record is not rejected for the unknown reason

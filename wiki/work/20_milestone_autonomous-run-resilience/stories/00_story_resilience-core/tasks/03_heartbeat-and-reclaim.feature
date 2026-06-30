@cli @work @work-stream @executable
Feature: A heartbeat stamps liveness on the run, and a restart-time path-walking scan reclaims only stale running runs
  In order that a run orphaned by a crash is detectable and recovered (not left wedged) without a daemon, poll, or server sweep
  the store's heartbeat bumps heartbeatAt on a running run, and reclaimStaleRuns walks the supplied items' run records by path and force-fails ONLY the stale running ones via the legal running → failed edge — leaving every live, queued, and terminal run byte-unchanged,
  so that liveness is a stamp on the one record file (not a sidecar) and the scan generalises to milestone 26's fleet orphan scan by passing a wider item set, with no rewrite (the 26 → 20 seam).

  # ARCHITECTURE ADR-004: liveness is the heartbeatAt stamp ON the record (sidecar
  # rejected); reclaimStaleRuns(items, { now, stalenessThreshold }) takes the ITEM LIST
  # as an argument (no single-node assumption) and transitions a stale running run via
  # the existing applyTransition (a legal 19/ADR-001 edge), setting failureReason =
  # runtime_offline (infra → retryable) + reclaimedAt. The STRUCTURAL guard (stale-only,
  # legal-edge-only, takes an item list) is the acd-run-reclaim-stale-only arch-test;
  # this is the OBSERVABLE behaviour.
  # LITMUS: stamp values, the transitioned/byte-unchanged records, and the by-path walk
  # are all observable in-process over a controlled runs/ fixture → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # heartbeat (ADR-004) bumps heartbeatAt to the supplied now on a running run — a
  # no-state-change persist (state stays running, outcome stays null). It passes a UTC-Z
  # now (ADR-007 — never a non-UTC clock), so heartbeatAt is an ISO-8601 UTC instant.
  Scenario: heartbeat stamps the running run's liveness without changing its state
    Given item "20" has a running run with heartbeatAt null
    When I heartbeat that run at "2026-06-30T09:00:00.000Z"
    Then the run record "heartbeatAt" is "2026-06-30T09:00:00.000Z"
    And the run record "state" is still "running"
    And the run record "outcome" is still null

  # Staleness (ADR-004): a running run is stale when now - heartbeatAt exceeds the
  # threshold; a run that NEVER beat (heartbeatAt null) is stale when now - updatedAt
  # exceeds it (the updatedAt fallback). A fresh-heartbeat run is NOT stale even if old.
  # This matrix pins the staleness predicate at and around the threshold boundary.
  Scenario Outline: a running run is stale per heartbeatAt, falling back to updatedAt when it never beat
    Given a running run whose "<liveness-field>" is <age> ms before now
    When the reclaim scan evaluates staleness with a threshold of 60000 ms
    Then the run is judged "<staleness>"

    Examples: heartbeatAt drives staleness when present
      | liveness-field | age    | staleness  |
      | heartbeatAt    | 30000  | live       |
      | heartbeatAt    | 60000  | live       |
      | heartbeatAt    | 90000  | stale      |

    Examples: updatedAt is the fallback for a run that never beat (heartbeatAt null)
      | liveness-field | age    | staleness  |
      | updatedAt      | 30000  | live       |
      | updatedAt      | 60000  | live       |
      | updatedAt      | 90000  | stale      |

  # The reclaim core (ADR-004): a stale running run is force-failed via the legal
  # running → failed edge with failureReason = runtime_offline (a crashed host is infra,
  # so the reclaimed run stays RETRYABLE per ADR-002) and reclaimedAt = now
  # (distinguishing a reclaimed failure from an operator-reported one).
  Scenario: reclaiming a stale running run force-fails it as a retryable, audited reclaim
    Given item "20" has a stale running run with sessionId "sess-c"
    When I run reclaimStaleRuns over [item "20"] at a now past the threshold
    Then that run record "state" is "failed"
    And that run record "failureReason" is "runtime_offline"
    And that run record "reclaimedAt" is the now I passed
    And that run record "sessionId" is still "sess-c"

  # The fallback drives a real reclaim WRITE, not just a staleness verdict (ADR-004): a
  # run that NEVER beat (heartbeatAt null) but whose updatedAt is past the threshold is
  # force-failed exactly like a stale-heartbeat run — runtime_offline + reclaimedAt — so
  # the decision→write wiring is pinned for the fallback path specifically, not only the
  # heartbeatAt path.
  Scenario: a never-beat running run past its updatedAt threshold is reclaimed via the fallback
    Given item "20" has a running run with heartbeatAt null whose updatedAt is past the threshold
    When I run reclaimStaleRuns over [item "20"] at the current now
    Then that run record "state" is "failed"
    And that run record "failureReason" is "runtime_offline"
    And that run record "reclaimedAt" is set

  # The scan touches ONLY stale running runs (ADR-004 + 19/R4 "pin the unaffected
  # sibling"): a fresh-heartbeat running run, a queued run, and a terminal run in the
  # same scan are each left BYTE-UNCHANGED. The matrix enumerates every non-target class.
  Scenario Outline: reclaim leaves every non-stale and every terminal run byte-unchanged
    Given item "20" has a "<run-kind>" run alongside a stale running run
    When I run reclaimStaleRuns over [item "20"] at a now past the threshold
    Then the stale running run became "failed"
    And the "<run-kind>" run is byte-unchanged

    Examples:
      | run-kind                       |
      | fresh-heartbeat running        |
      | queued                         |
      | done                           |
      | failed                         |
      | cancelled                      |

  # The by-path walk (ADR-004, the 26 → 20 seam): reclaimStaleRuns takes the LIST of
  # items to scan as an argument and iterates each item's runs/ by path — it bakes in no
  # single directory. Passing two items scans both; passing one scans only that one.
  # This is exactly what lets milestone 26 pass a wider fleet set with no rewrite.
  Scenario: the scan walks the supplied item list by path, scanning each item's runs/ and no others
    Given item "20" and item "21" each have a stale running run, and item "19" also has one
    When I run reclaimStaleRuns over [item "20", item "21"]
    Then item "20" stale run became "failed" and item "21" stale run became "failed"
    And item "19" stale run is byte-unchanged because it was not in the scanned list

  # An empty or all-healthy scan is a clean no-op (ADR-004): reclaim over a list with no
  # stale running run writes nothing and raises nothing — the backstop is silent when
  # there is nothing to reclaim.
  Scenario: a scan with no stale running run writes nothing and raises nothing
    Given item "20" has only a fresh-heartbeat running run and a done run
    When I run reclaimStaleRuns over [item "20"] at a now past the threshold
    Then no run record under item "20" is changed
    And the scan raises no error

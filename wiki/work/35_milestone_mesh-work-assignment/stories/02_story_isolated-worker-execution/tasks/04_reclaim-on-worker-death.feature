@executable @cli @work @distribution
Feature: a non-terminal assignment is reclaimed only under DUAL staleness — worker presence stale AND run heartbeat stale, both strict — and reclaim force-fails the run runtime_offline, retryable, so the item is re-assignable
  In order that a crashed worker's assignment is recovered automatically without ever reclaiming a
  live-but-quiet worker, an assignment in a non-terminal state is reclaimed to `reclaimed` (with a
  `reclaimedAt` stamp, force-failing the linked run `runtime_offline`, retryable) ONLY when BOTH clocks agree
  the worker is gone — the target's presence is stale (`isNodeStale`, 90s) AND the run's heartbeat is stale
  (`isStale`, 15m), each strict `>`; fresh presence, stale-presence-but-fresh-heartbeat, exactly-at-threshold,
  and no-presence-record are all hands-off; after reclaim the item is re-assignable.

  # ARCHITECTURE ADR-005 (reclaim ONLY under DUAL staleness — presence stale AND run-heartbeat stale, both
  # strict >; presence precedence — fresh presence is hands-off even with a stale heartbeat; no-presence-record
  # is UNKNOWN liveness, NOT staleness ⇒ hands-off, the m23/KR2 guard; exactly-AT the threshold is still LIVE).
  # The two staleness predicates are IMPORTED and SHARED, never re-derived: isNodeStale from mesh-presence
  # (default 90s, mesh-presence.mjs:42) delegates to isStale (strict >, run-store.mjs:202-204/508-512), and
  # isStale over the run heartbeat is the m20 work.autonomous.heartbeatStaleMs 15m default. Reclaim reuses the
  # existing reclaimStaleRuns machinery: state→reclaimed + reclaimedAt=now, run force-failed runtime_offline
  # (retryable — a crashed host is infra, 20/ADR-002). "The reclaim guard ANDs both IMPORTED predicates" is
  # STRUCTURAL → the fitness acd-assignment-reclaim-dual-staleness, not a step; THIS feature asserts the
  # observable decision table + the reclaim action. Mined from reference/retired-dispatch-tests/
  # fleet-orphan-reclaim.mjs (the SEMANTICS — the git/lease mechanism is discarded per ADR-005).
  #
  # RESOLVED (developer-amigo): tested over a TEMP fixture repo with a FIXTURE presence record (the target's
  # heartbeatAt stamp the test controls) + a node-partitioned run record (its heartbeatAt the test controls) +
  # a store assignment row in a non-terminal state, driving the reclaim decision at an INJECTED `now` that
  # feeds BOTH predicates (the fleet-orphan-reclaim inject-the-clock discipline). Thresholds are the documented
  # defaults spelled in fixture config (presence 90s, run heartbeat 15m), so the exactly-at-threshold row is
  # byte-stable (strict > — AT the threshold is still LIVE). No real network, no real agent runtime.

  Background:
    Given a temp fixture repo with an item assigned to worker "node-b" in a non-terminal "running" state
    And the target's run heartbeat and presence stamps are controlled by the test at a fixed "now"

  # THE DECISION TABLE (fleet-orphan-reclaim.mjs, the 6 rows): reclaim fires ONLY on stale presence AND stale
  # heartbeat; presence precedence keeps a fresh-presence worker's assignment hands-off; no presence record is
  # UNKNOWN, not stale (never reclaim a possibly-live peer); exactly AT the presence threshold is still LIVE.
  Scenario Outline: an assignment is reclaimed only under dual staleness — presence precedence, no-presence hands-off, and AT-threshold still live
    Given the target's presence is <presence>
    And the run's heartbeat is <heartbeat>
    When the reclaim decision runs at "now"
    Then the assignment is <decision>

    Examples:
      | presence                        | heartbeat  | decision                                      |
      | stale (age > 90s)               | stale (> 15m) | reclaimed                                  |
      | fresh (age <= 90s)              | stale (> 15m) | hands-off (presence precedence — worker alive) |
      | stale (age > 90s)               | fresh (<= 15m) | hands-off (wait — conservative)           |
      | fresh (age <= 90s)              | fresh (<= 15m) | hands-off                                 |
      | exactly at threshold (age == 90s) | stale (> 15m) | hands-off (AT the threshold is still LIVE — strict >) |
      | no presence record (never beat) | stale (> 15m) | hands-off (unknown liveness, not staleness) |

  # THE RECLAIM ACTION (fleet-orphan-reclaim.mjs): on dual staleness the assignment goes reclaimed with a
  # reclaimedAt stamp and the linked run is force-failed runtime_offline — a RETRYABLE failure (crashed host
  # is infra), not an operator-reported one.
  Scenario: dual staleness sets the assignment reclaimed with a reclaimedAt stamp and force-fails the run runtime_offline retryable
    Given the target's presence is stale and the run's heartbeat is stale
    When the reclaim decision runs at "now"
    Then the assignment's state is "reclaimed"
    And the assignment carries a "reclaimedAt" stamp of "now"
    And the linked run is force-failed with failureReason "runtime_offline"
    And that failure reason is retryable

  # RE-ASSIGNABLE AFTER RECLAIM (ADR-003): a reclaimed assignment is terminal, so the store uniqueness check
  # passes and the item can be assigned to another node.
  Scenario: after a reclaim the item is assignable again
    Given the assignment has been reclaimed (terminal)
    When the operator assigns the same item to another worker
    Then the store uniqueness check passes (no active assignment remains on the item)
    And a new assignment for the item is minted

  # THE RECLAIM DISTINGUISHES FROM AN OPERATOR FAILURE: reclaimedAt separates a reclaimed run from a run that
  # merely failed — only the reclaim path stamps reclaimedAt (fleet-orphan-reclaim.mjs).
  Scenario Outline: only the reclaim path stamps reclaimedAt on the run
    Given a run that reached "<how>"
    Then the run's reclaimedAt is <stamp>

    Examples:
      | how                              | stamp        |
      | failed via an operator-reported outcome | null   |
      | failed via a dual-staleness reclaim | the "now" stamp |

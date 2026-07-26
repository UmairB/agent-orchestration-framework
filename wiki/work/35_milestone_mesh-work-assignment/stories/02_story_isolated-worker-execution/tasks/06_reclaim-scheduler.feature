@executable @cli @work @distribution
Feature: the control-node launcher runs the dual-staleness reclaim scan on its tick — a dead worker's assignment converges to reclaimed without a manual call
  In order that "a dead worker's assignment is reclaimed" is a live guarantee and not just a tested pure
  function, the control node's launcher runs `reclaimStaleAssignments` on its periodic control tick, so an
  assignment whose worker has gone dual-stale converges to `reclaimed` on its own — the same tick that
  dispatches assigned rows (task 01/03) also drives reclaim.

  # ARCHITECTURE 35/ADR-008 (the control-side dispatch/reclaim driver — the ONE periodic control tick in
  # startLauncher runs reclaimStaleAssignments each tick, alongside the dispatch scan) reusing 35/ADR-005's
  # dual-staleness decision VERBATIM (presence stale AND run-heartbeat stale, both strict >; the reclaim action
  # sets state→reclaimed + reclaimedAt, force-fails the run runtime_offline retryable). This feature is the
  # PRODUCTION-WIRING half of the reclaim path: task 02/04 proved the decision + action in isolation; THIS task
  # asserts the launcher actually CALLS it on a tick so live convergence happens. "startLauncher wires a tick
  # that calls reclaimStaleAssignments" is STRUCTURAL → the fitness acd-control-dispatch-reclaim-driver-wired
  # (shared with task 01/03), not a step; THIS feature asserts the observable convergence via the tick and the
  # hands-off of a fresh assignment.
  #
  # RESOLVED (developer-amigo): tested over the startLauncher injected-ticker seam (the mesh-coordination-
  # launcher idiom) + a v3 store fixture with a non-terminal assignment + FIXTURE presence + run-heartbeat
  # stamps the test controls + an injected `now` feeding BOTH staleness predicates (the task-04 inject-the-clock
  # discipline). No wall-clock, no tailnet — the real kill-mid-run convergence is the milestone's @manual soak (05).

  Background:
    Given a control-node launcher started with an injected ticker and an injected clock
    And a v3 store fixture with a non-terminal "running" assignment "asg-1" targeting worker "node-b"
    And the target's presence and run-heartbeat stamps are controlled by the test at a fixed "now"

  # LIVE CONVERGENCE VIA THE TICK: a dual-stale assignment is reclaimed BY the launcher's tick — no manual
  # reclaim call. This is the guarantee task 04's pure decision could not deliver on its own.
  Scenario: a dual-stale assignment converges to reclaimed on the control tick
    Given the target's presence is stale and the run's heartbeat is stale at "now"
    When the launcher's control tick fires at "now"
    Then the assignment "asg-1" reads state "reclaimed"
    And it carries a "reclaimedAt" stamp of "now"
    And the linked run is force-failed with failureReason "runtime_offline"

  # HANDS-OFF WHEN LIVE: the tick reuses ADR-005's decision verbatim — a fresh worker's assignment is left
  # untouched by the tick (the tick never reclaims a live-but-quiet worker).
  Scenario: the control tick leaves a fresh assignment untouched
    Given the target's presence is fresh at "now"
    When the launcher's control tick fires at "now"
    Then the assignment "asg-1" still reads state "running"
    And no "reclaimedAt" stamp is written

  # ONE DRIVER, BOTH DUTIES (ADR-008): the same tick that reclaims also dispatches — a single control tick
  # both dispatches an assigned row and reclaims a dual-stale one, proving they share the one driver.
  Scenario: one control tick both reclaims a dual-stale assignment and dispatches an assigned one
    Given a second "assigned" assignment "asg-2" targeting a connected peer "node-a"
    And the first assignment "asg-1" is dual-stale at "now"
    When the launcher's control tick fires at "now"
    Then "asg-1" reads state "reclaimed"
    And a directive is dispatched for "asg-2" to "node-a"

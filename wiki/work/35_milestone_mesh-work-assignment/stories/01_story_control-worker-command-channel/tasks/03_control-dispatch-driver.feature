@executable @cli @adapter @distribution
Feature: the control-node launcher dispatches each assigned row to its connected target — the missing call site that turns a minted assignment into a live directive
  In order that `aof mesh assign` actually reaches the worker — not just a store row that sits `assigned`
  forever — the control node's launcher runs a periodic control tick that scans `global_assignments` for
  `assigned` rows whose target is a currently-connected admitted peer and dispatches each one, exactly once,
  down the existing directive channel; the one-shot assign verb itself only mints, the driver dispatches.

  # ARCHITECTURE 35/ADR-008 (the control-side dispatch/reclaim driver — startLauncher gains ONE periodic
  # control tick, a sibling of propagationTicker/peerPollTicker over the same injected-ticker seam, that each
  # tick (a) scans global_assignments for state="assigned" rows whose targetNodeId is a connected peer in the
  # stream server's directiveTargets map and dispatchDirective(buildDirectiveFrame(row)) them over the ADR-002
  # channel, and (b) runs reclaimStaleAssignments — task 02/06). "Live via poll" (34/ADR-007 + this
  # milestone's UI): an assign converges within one control tick, not instantly. DISPATCH-ONCE: a row stays
  # `assigned` until the worker's `accepted` uplink advances it, so a naive re-scan would re-dispatch every
  # tick — an in-memory already-dispatched set on the driver dispatches each assignmentId at most once per
  # launcher lifetime (the ADR-008 authoritative guard); the worker's onDirective additionally ignores a
  # duplicate directive for an assignment it already holds. "The launcher wires a tick calling dispatchDirective
  # for assigned connected-peer rows (and the assign verb does NOT itself dispatch)" is STRUCTURAL → the fitness
  # acd-control-dispatch-reclaim-driver-wired, not a step; THIS feature asserts the observable dispatch, the
  # skip of a disconnected/non-assigned target, dispatch-once, and that the verb alone mints without dispatching.
  #
  # RESOLVED (developer-amigo): tested over an INJECTED store (a v3 fixture with planted assignment rows) + an
  # INJECTED stream-server exposing a dispatch recorder + a connected-peer set (the directiveTargets shape) +
  # an INJECTED ticker (the mesh-coordination-launcher startLauncher test idiom — no wall-clock, no tailnet) +
  # an injected clock. No live network; the real two-machine dispatch is the milestone's @manual soak (02/05).

  Background:
    Given a control-node launcher started with an injected ticker and an injected stream server recording dispatched directives
    And the stream server reports "worker-a" connected as an admitted peer
    And a v3 store fixture the launcher's control tick reads

  # THE MISSING CALL SITE: an assigned row targeting a connected peer is dispatched on the control tick — a
  # directive frame carrying that assignment reaches that peer. This is the pipe from a minted row to the channel.
  Scenario: the control tick dispatches an assigned row whose target is a connected peer
    Given an "assigned" assignment "asg-1" for item "35/01" on workspace "ws-1" targeting "worker-a"
    When the launcher's control tick fires
    Then a directive is dispatched for assignment "asg-1" to "worker-a"
    And the dispatched directive carries assignmentId "asg-1", itemRef "35/01", and workspaceId "ws-1"

  # THE VERB ONLY MINTS (ADR-008): `aof mesh assign` writes the row and returns; it does NOT itself send a
  # directive. Nothing is dispatched until the driver's next tick — locking the decision behaviourally.
  Scenario: the assign verb mints without dispatching; the driver dispatches on the next tick
    Given no control tick has yet fired
    When the operator runs `aof mesh assign 35/01 --to worker-a`
    Then an "assigned" row is minted for that item
    And no directive has been dispatched
    When the launcher's control tick fires
    Then a directive is dispatched for that assignment to "worker-a"

  # DISPATCH-ONCE (ADR-008): a row stays `assigned` until the worker accepts, so the tick must not re-dispatch
  # it. A second tick over the same still-`assigned` row dispatches nothing new.
  Scenario: an already-dispatched assigned row is not re-dispatched on the next tick
    Given an "assigned" assignment "asg-1" targeting "worker-a" already dispatched on a prior tick
    And "asg-1" is still in state "assigned" (the worker has not yet reported accepted)
    When the launcher's control tick fires again
    Then no further directive is dispatched for "asg-1"

  # SKIP THE UN-DISPATCHABLE: the tick dispatches ONLY assigned rows targeting a connected peer. A row for a
  # disconnected target is left assigned (no dispatch, no crash — the loud target-not-connected miss is task 01);
  # a row in any non-assigned state is never dispatched.
  Scenario Outline: the tick dispatches only assigned rows targeting a connected peer
    Given an assignment "asg-x" for item "35/01" in state "<state>" targeting "<target>"
    And the stream server reports "<connected>"
    When the launcher's control tick fires
    Then the assignment "asg-x" is <dispatch>

    Examples:
      | state    | target   | connected                 | dispatch                    |
      | assigned | worker-a | worker-a connected        | dispatched to "worker-a"    |
      | assigned | worker-b | only worker-a connected   | not dispatched (left assigned) |
      | accepted | worker-a | worker-a connected        | not dispatched (not assigned)  |
      | running  | worker-a | worker-a connected        | not dispatched (not assigned)  |
      | done     | worker-a | worker-a connected        | not dispatched (terminal)      |
      | withdrawn| worker-a | worker-a connected        | not dispatched (terminal)      |

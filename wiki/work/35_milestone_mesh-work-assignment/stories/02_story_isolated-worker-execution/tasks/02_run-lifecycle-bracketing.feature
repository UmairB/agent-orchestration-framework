@executable @cli @work @distribution
Feature: accepting a directive brackets execution in a node-partitioned run and streams accepted → running → done|failed, with the run-store staying mesh-blind
  In order that a dispatched assignment's execution is a first-class, recoverable, partitioned run and each
  lifecycle edge is visible up the channel, accepting a directive mints a node-partitioned run through the
  EXISTING run-store (`startRun(item, { node })`, landing under `runs/<node>/`) and emits `accepted`;
  materializing the worktree and beginning execution sets the assignment's `runId` and emits `running`; the
  run reaching a terminal state emits `done` or `failed` — each an `assignment-status` frame — while the
  run-store imports no mesh module and takes the node id only as DATA.

  # ARCHITECTURE ADR-004 (execution REUSES the run-store verbatim — startRun/heartbeat/completeRun; the run
  # lands node-partitioned under runs/<node>/<runId>.json per 26/ADR-001; the assignment's runId is that run's
  # id; the bracketing is assigned→accepted→running→done|failed, each an assignment-status frame per ADR-002).
  # The run-store STAYS MESH-BLIND (graph: run-store → fs only) — the node id arrives as an option, the store
  # imports no mesh/assignment module. "run-store imports no mesh module + the worker calls startRun(item,
  # {node})" is STRUCTURAL → the fitness acd-assignment-run-store-mesh-blind (re-arms acd-fleet-reclaim-
  # guarded), not a step; THIS feature asserts the observable frame sequence, the runId set on running, the
  # partition placement, and the done⇒done / failed⇒failed mapping.
  #
  # RESOLVED (developer-amigo): tested over the worker execution handler in a TEMP fixture repo, exercising the
  # REGISTERED run-store (startRun/heartbeat/completeRun via loadWorkspace + invoke, the fleet-orphan-reclaim
  # idiom) with the node id passed as an option, an INJECTED runtime spawn scripted to a terminal outcome
  # (done or failed — no real agent runtime), an INJECTED status emitter recording every assignment-status
  # frame, and an INJECTED clock driving the stamps. No real network.

  Background:
    Given a temp fixture repo with a resolvable work item and the repo published for the worker
    And an accepted directive for that item on this node "node-a"
    And an injected status emitter recording every assignment-status frame

  # ACCEPT MINTS THE RUN, PARTITIONED: accepting mints a running run under THIS node's partition and emits
  # accepted — the run-store's own node key decides the placement (record → path).
  Scenario: accepting mints a node-partitioned run and emits accepted
    When the worker accepts the directive
    Then a run is minted through the run-store with this node's id as its node key
    And the run record lands under "runs/node-a/" (this node's partition)
    And an "accepted" assignment-status frame is emitted for the assignment

  # RUNNING SETS THE RUNID: materializing the worktree and beginning execution ties the assignment to its run
  # and emits running — the assignment's runId is the minted run's id (the ADR-001 link).
  Scenario: beginning execution sets the assignment runId and emits running
    Given the worker has accepted the directive and minted its run
    When the worktree is materialized and execution begins
    Then the assignment's runId is set to the minted run's id
    And a "running" assignment-status frame is emitted carrying that runId

  # TERMINAL MAPS THROUGH: the run reaching a terminal state completes the run and emits the matching
  # assignment status — a done run ⇒ done, a failed run ⇒ failed, each an assignment-status frame.
  Scenario Outline: a run reaching a terminal state emits the matching assignment status
    Given an accepted, running assignment whose run is executing
    When the run reaches "<run-outcome>"
    Then the run is completed through the run-store with outcome "<run-outcome>"
    And a "<assignment-state>" assignment-status frame is emitted for the assignment

    Examples:
      | run-outcome | assignment-state |
      | done        | done             |
      | failed      | failed           |

  # THE FULL BRACKET, ORDERED: one assignment driven end-to-end emits exactly accepted → running → done|failed
  # in order — the outsider-verifiable "assigned → running → done live in an isolated worktree" promise.
  Scenario: one assignment emits accepted then running then its terminal frame in order
    When the worker drives the assignment from acceptance to a terminal run
    Then the emitted assignment-status frames are, in order, "accepted" then "running" then a terminal frame
    And the terminal frame is "done" or "failed"

  # MESH-BLIND: the node id is DATA — the worker calls startRun with { node } and the run-store never learns
  # it is running a mesh assignment (no mesh module crosses the run-store seam).
  Scenario: the run is minted by passing the node id as data to the mesh-blind run-store
    When the worker mints the run for the assignment
    Then the worker calls startRun with the node id supplied as an option
    And the minted run carries this node's id without the run-store importing any mesh module

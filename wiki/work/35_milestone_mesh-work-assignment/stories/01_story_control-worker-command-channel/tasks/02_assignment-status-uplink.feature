@executable @cli @adapter @distribution
Feature: the worker's assignment-status frame write-throughs the lifecycle transition into the store, authored by the connection that holds it
  In order that each lifecycle transition a worker reports lands in the store the moment it is reported — and
  that a node can advance ONLY its own assignment, never forge state for one it does not hold — the control
  server ingests an assignment-status up-frame, writes the transition through the dedicated assignment writer,
  authors it from the connection's authenticated nodeId, and treats an unrecognised frame kind as a no-op.

  # ARCHITECTURE ADR-002 (the up-frame {kind:"assignment-status", nodeId, assignmentId, state, runId?, at};
  # control ingests it and writes the lifecycle transition through ADR-001's dedicated writer; an unrecognised
  # kind stays a no-op, the never-crash discipline applyStreamFrame already keeps) + ADR-001 (the worker is the
  # SOLE SOURCE of accepted/running/done/failed; control is a faithful write-through, not a second authority;
  # the running transition sets the assignment's runId — the ADR-004 run link).
  # SECURITY T6 (acd-assignment-status-authored-by-holder): the transition is authored from the CONNECTION's
  # authenticated nodeId, bound from the admitted origin at connection time and threaded into the apply path —
  # never a self-reported frame.nodeId (the ownerNode ?? frameNode precedence, control-stream-server.mjs:120-124
  # is the shape to follow: the connection nodeId wins). A node advances only ITS OWN assignment.
  # "The apply seam derives its owner from the connection nodeId, never frame.nodeId alone" is STRUCTURAL →
  # the security fitness, not a step; THIS feature asserts the observable landed state, the frozen-node
  # authorship, and the no-op on an unknown kind.
  #
  # RESOLVED (developer-amigo): tested over the INJECTED transport (frames handed to the server's apply path
  # with an injected connection identity, the 34/story-04 injected-admission precedent) + an injected clock.
  # The store is a real v3 store fixture (ADR-001's dedicated writer); no live ws. Depends on story 00 — the
  # ingest advances the record story 00 minted.

  # THE WRITE-THROUGH: an assignment-status frame on ingest advances the record through ADR-001's dedicated
  # writer — each reported state lands as the record's new state; the running transition also records the runId.
  Scenario Outline: each reported state lands as the assignment record's new state
    Given an assignment "asg-1" held by the connected worker "worker-a"
    When "worker-a" streams an assignment-status frame for "asg-1" reporting state "<state>"<carries-run>
    Then the assignment record for "asg-1" reads state "<state>"
    And the record's runId is "<runId>"

    Examples:
      | state    | carries-run             | runId  |
      | accepted |                         | null   |
      | running  | with runId "run-9"      | run-9  |
      | done     |                         | null   |
      | failed   |                         | null   |

  # AUTHORED BY THE HOLDER (SECURITY T6): the transition is keyed to the CONNECTION's authenticated nodeId —
  # a frame whose self-reported nodeId differs from the connection identity cannot advance another node's
  # assignment; frame.nodeId never overrides the connection identity.
  Scenario: a frame cannot advance an assignment held by another node
    Given an assignment "asg-b" held by "worker-b"
    And "worker-a" is connected on its own authenticated connection
    When a frame arrives on worker-a's connection reporting a self-declared nodeId "worker-b" advancing "asg-b" to state "done"
    Then the assignment "asg-b" is not advanced
    And its recorded state is unchanged

  # AUTHORED BY THE HOLDER (SECURITY T6): the same frame, authored from the connection that actually holds the
  # assignment, DOES advance it — proving the boundary is the connection identity, not the frame's own claim.
  Scenario: the holding node's own connection advances its assignment
    Given an assignment "asg-a" held by "worker-a"
    And "worker-a" is connected on its own authenticated connection
    When a frame arrives on worker-a's connection advancing "asg-a" to state "running" with runId "run-3"
    Then the assignment "asg-a" reads state "running"
    And its runId is "run-3"

  # NEVER-CRASH (ADR-002): an unrecognised frame kind is a no-op — it advances nothing and does not throw.
  Scenario: an unrecognised frame kind is a no-op
    Given an assignment "asg-1" held by the connected worker "worker-a"
    When "worker-a" streams a frame of an unrecognised kind
    Then no assignment record is changed
    And the server does not crash

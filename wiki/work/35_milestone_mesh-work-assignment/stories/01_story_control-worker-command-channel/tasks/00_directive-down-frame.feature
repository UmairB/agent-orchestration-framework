@executable @cli @adapter @distribution
Feature: the control node sends a directive down the ONE worker's WebSocket — targeted to exactly that node, never broadcast
  In order to dispatch an assignment to exactly the worker an operator named — over the same persistent
  connection that worker already holds, never a second socket and never the retired git-bus — the control
  server keeps a nodeId→ws targeting map, writes a directive frame to the single matching socket, and
  surfaces a loud coded refusal when the named node has no live connection.

  # ARCHITECTURE ADR-002 (the control→worker directive channel is the ONE persistent m34 WS; the server gains
  # a nodeId→ws targeting map populated in wss.on("connection") and cleared on close/error; sendDirective(nodeId,
  # directive) resolves EXACTLY one socket and writes to it — there is NO fan-out API, no "send to all workers"
  # branch; the down-frame is {kind:"directive", to, assignmentId, itemRef, workspaceId, at}). The "target not
  # connected" miss is LOUD (ADR-002 / 34-ADR-008): a --to <nodeId> with no live socket surfaces a coded,
  # operator-visible assignment-target-not-connected refusal, never a silent drop. "One socket, no fan-out"
  # and "the code literal is emitted at the miss branch" are STRUCTURAL → the fitnesses
  # acd-directive-targets-one-peer / acd-assignment-target-not-connected-loud, not steps; THIS feature asserts
  # the observable single-target delivery, the non-delivery to every other socket, and the coded miss.
  #
  # RESOLVED (developer-amigo): tested over the INJECTED transport (the 34/story-04 paired fake channel — an
  # ordered frame recorder per socket, so "which socket received a frame" is directly observable) + an injected
  # peer-identity signal + an injected clock for `at`. No live ws; the real two-machine directive path is the
  # milestone's @manual soak (story 02). This task is the DOWN half; admission is task 01, the up-frame is task 02.

  # THE FRAME SHAPE: a directive carries exactly its five keys — the target nodeId plus the assignment it dispatches.
  Scenario: a directive frame carries the assignment it dispatches, addressed to one node
    Given a control server with worker "worker-a" connected
    When the control sends a directive to "worker-a" for assignment "asg-1" of item "35/01" in workspace "ws-1"
    Then the frame worker-a receives is a "directive" carrying to "worker-a", assignmentId "asg-1", itemRef "35/01", workspaceId "ws-1", and a timestamp

  # THE TARGETING LIFECYCLE: a directive reaches a node only while its connection is live — once that connection
  # closes or errors, the same target is no longer reachable (never a stale route a directive would write into the void).
  Scenario Outline: a directive reaches a node only while its connection is live
    Given a control server
    When "worker-a" <transition>
    Then sending a directive to "worker-a" <delivery>

    Examples:
      | transition                         | delivery                                                  |
      | connects                           | writes the directive to worker-a's socket                 |
      | connects then its socket closes    | is refused with code "assignment-target-not-connected"    |
      | connects then its socket errors    | is refused with code "assignment-target-not-connected"    |

  # SINGLE-TARGET DELIVERY (no fan-out): with more than one worker connected, sending to a node reaches ONLY the
  # matching socket — every other worker's socket receives nothing. This is the whole point of --to <nodeId>.
  Scenario Outline: a directive reaches exactly the addressed worker and no other
    Given a control server with workers "worker-a" and "worker-b" both connected
    When the control sends a directive to "<target>"
    Then the "<target>" socket receives exactly one directive frame
    And the "<other>" socket receives no frame

    Examples:
      | target   | other    |
      | worker-a | worker-b |
      | worker-b | worker-a |

  # THE LOUD MISS (ADR-002 / 34-ADR-008): a directive to a node with NO live connection does not silently drop —
  # it surfaces a coded refusal and sends no frame at all. Silence is the defect.
  Scenario: a directive to a node with no live connection is a coded refusal and sends nothing
    Given a control server with worker "worker-a" connected but no connection for "worker-b"
    When the control sends a directive to "worker-b"
    Then the send is refused with code "assignment-target-not-connected"
    And no directive frame is written to any socket

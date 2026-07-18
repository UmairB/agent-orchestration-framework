@executable @ui @work @distribution
Feature: The fleet face's ONE write route — POST /api/mesh/assign {ref,nodeId} wraps the existing assignWork verb VERBATIM and mints the real global_assignments `assigned` record
  In order that an operator dispatches work from the fleet UI without a new arbitration path (closing the m35/ADR-007-deferred
  UI-assign affordance on the m27/ADR-006 bounded-write posture), the read-only fleet face gains its FIRST and ONLY mutation
  route — POST /api/mesh/assign {ref,nodeId} — which resolves the current workspace and calls assignWork(workspace, ref, nodeId,
  ctx) VERBATIM, adding no second uniqueness rule and no bespoke repo check, minting the `assigned` record through the verb's own
  gates and through NO other path.

  # ARCHITECTURE 38/ADR-012 — the read-only fleet face gains its FIRST live write route: ONE POST /api/mesh/assign wrapping
  # assignWork verbatim, minting through no other path; structural invariants #1 (EXACTLY one mutation route, and it is
  # POST /api/mesh/assign) + #2 (the route mints through assignWork; no insertAssignment/global_assignments write reachable
  # except through the gated verb). SECURITY T13 (the first, single, explicit exception to the read-only invariant). Fitness
  # acd-fleet-face-single-mutation-route (SPEC, armed at BUILD against the real handler).
  #
  # ADR-012 producer-fed conformance (ADR-008): "the affordance is proven by the RECORD it mints" — a REAL POST from the REAL
  # route producing a REAL global_assignments record read back through the REAL store. A test that agrees with a hand-built
  # request body, or that inspects a well-formed "assign" URL string, proves nothing (STATE.md F1/F4 — wiring is not a contract).
  #
  # @executable over an INJECTED STORE seam only — the REAL serveMeshUi stood up on a loopback port over an isolated
  # global-store seam (a temp AOF_GLOBAL_HOME v3 projection) + a real same-origin fetch. Every mint is read back from the REAL
  # store (readAssignmentRows), NEVER asserted from the response body alone. No CLI is spawned (that is task 04's @manual soak).

  Background:
    Given the REAL fleet face (serveMeshUi) stood up on a loopback port over an isolated global-store seam
    And a resolvable work item "38/04" in that store's projection
    And a known worker node "worker-a" that holds the workspace's published repo (global_nodes row + membership + last_published_at)
    And no prior active assignment exists for "38/04"

  Scenario: a same-origin POST /api/mesh/assign wraps assignWork and mints the real assigned record
    When a same-origin application/json POST /api/mesh/assign with body { ref: "38/04", nodeId: "worker-a" } is sent
    Then the response status is 200
    And a global_assignments row for ("38/04", this workspace) EXISTS when read back through the REAL store
    And that row's state is "assigned" and its target_node_id is "worker-a"
    And EXACTLY ONE active assignment row exists for the item (the verb minted it, not a route-built record)
    # the minted record — read back from the real store — is the proof (ADR-012 producer-fed), never the 200 nor the body

  Scenario: the mint carries the verb's assembled shape, not the request body — assignWork is wrapped, not re-implemented
    When a same-origin POST /api/mesh/assign is sent with body { ref: "38/04", nodeId: "worker-a", state: "done", assignmentId: "forged-1", issuer: "attacker" }
    Then the response status is 200
    And the minted row's state is "assigned" (the verb's assembled state, NOT the body's "done")
    And the minted row's assignment_id is the verb's own minted id (NOT the body's "forged-1")
    And the minted row's issuer is the control node's own nodeId (NOT the body's "attacker")
    # the route passes only { ref, nodeId } into assignWork; a client cannot inject record fields around the verb (ADR-012 #2)

  Scenario Outline: the posted nodeId is the verb's assign target — it rides through, never a default or an override
    Given a second known worker node "worker-b" that also holds the workspace's published repo
    When a same-origin POST /api/mesh/assign with body { ref: "38/04", nodeId: <nodeId> } is sent
    Then the response status is 200
    And the minted global_assignments row's target_node_id is <nodeId> when read back through the REAL store

    Examples:
      | nodeId    |
      | worker-a  |
      | worker-b  |

  Scenario Outline: POST /api/mesh/assign is the ONLY mutation route — every other path/method stays a clean 405/404
    When a <method> request to <path> is sent same-origin
    Then the response status is <status> and the body code is <code>
    And where <status> is 405 the Allow header is <allow>
    And NO global_assignments row is minted for any item (the store row-count is unchanged) and the face does not crash

    Examples:
      | method | path                | status | code               | allow      |
      | POST   | /api/mesh/status    | 405    | method-not-allowed | GET, HEAD  |
      | POST   | /api/mesh/board-url | 405    | method-not-allowed | GET, HEAD  |
      | PUT    | /api/mesh/assign    | 405    | method-not-allowed | POST       |
      | DELETE | /api/mesh/assign    | 405    | method-not-allowed | POST       |
      | GET    | /api/mesh/assign    | 405    | method-not-allowed | POST       |
      | POST   | /api/mesh/revoke    | 404    | not-found          | n/a        |
      | POST   | /api/mesh/issue     | 404    | not-found          | n/a        |

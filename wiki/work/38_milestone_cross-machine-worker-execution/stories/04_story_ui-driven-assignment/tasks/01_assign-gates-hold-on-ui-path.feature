@executable @ui @work @distribution
Feature: The UI assign path re-runs the verb's OWN gates — an unknown / ineligible / duplicate target is refused on the route IDENTICALLY to the CLI, a coded non-200 that mints nothing
  In order that a hostile or ill-formed POST to the mutation carve-out can mint nothing the CLI could not (closing SECURITY T13's
  AuthZ+Tampering surface), the POST /api/mesh/assign route — because it wraps assignWork verbatim — surfaces the verb's own
  { ok:false, code } as a CODED non-200 (never a 200, never a second success path around the gates): an unknown node hits
  assignment-target-unknown, an ineligible node hits assignment-repo-unavailable, a duplicate hits assignment-already-active, a
  typo'd ref hits ref-not-found — each minting NOTHING.

  # ARCHITECTURE 38/ADR-012 decision — "the UI path re-runs the verb's OWN gates … the route MUST surface the verb's structured
  # { ok:false, code } as a coded HTTP error, never a 200, never a second success path around the gates"; invariant #3 (a gate
  # miss is surfaced, never swallowed — never a 200 for a refusal). SECURITY T13 control (a) — "refused IDENTICALLY to the CLI;
  # the UI path reimplements no arbitration and can mint nothing the CLI could not." The verb's gate ORDER
  # (mesh-assign.mjs: ref-not-found → assignment-already-active → repo-availability) means each Outline row must hold every OTHER
  # gate VALID and flip exactly ONE trigger to failing — else the first miss short-circuits and the row asserts the wrong code.
  #
  # @executable over the REAL route + an INJECTED STORE seam (an isolated AOF_GLOBAL_HOME v3 projection seeded via seedTargetNode
  # /seedAssignment). Every refused row asserts the store's assignment row-count is UNCHANGED (the gate ran BEFORE any mint) AND
  # asserts the route's code EQUALS the code assignWork(ref, nodeId) returns for the SAME input called directly — producer-fed
  # PARITY, not a re-implemented refusal (STATE.md F1/F4 — a string-inspected refusal proves nothing).

  Background:
    Given the REAL fleet face (serveMeshUi) over an isolated global-store seam and a resolvable work item "38/04"
    And a baseline where EVERY gate would pass (a known + eligible node "worker-a", no prior active assignment)
    # each Outline row flips exactly ONE gate to failing and holds all the others valid

  Scenario Outline: a gate miss on the UI path is a coded non-200 that mints nothing — identically to the CLI
    Given the store is seeded as <seed>
    When a same-origin application/json POST /api/mesh/assign with body { ref: <ref>, nodeId: <nodeId> } is sent
    Then the response status is a coded non-200 (a 4xx, never a 200)
    And the response body code is <code>
    And NO global_assignments row was minted for the item (the store's assignment row-count is unchanged)
    And <code> EQUALS the code assignWork(<ref>, <nodeId>) returns when called directly against the same store (refused identically to the CLI)

    Examples:
      | case                     | ref    | nodeId   | seed                                              | code                        |
      | unknown / unregistered   | 38/04  | ghost    | "ghost" is NOT a row in global_nodes              | assignment-target-unknown   |
      | known node, not a member | 38/04  | worker-a | worker-a known but NOT linked in global_node_workspaces | assignment-repo-unavailable |
      | workspace never published| 38/04  | worker-a | worker-a known + member, workspaces.last_published_at NULL | assignment-repo-unavailable |
      | typo'd / unresolvable ref| 38/99  | worker-a | worker-a fully eligible; ref 38/99 resolves to nothing | ref-not-found               |
    # ref-not-found is a 404-class refusal (the mesh:issue-route precedent); the exact 4xx number for the gate-miss rows is the
    # route's { ok:false, code } → status MAPPING, pinned at BUILD — the load-bearing, falsifiable value here is the CODE (the
    # verb's own, surfaced verbatim) + "non-200, never 200" + "nothing minted".

  Scenario: the single-runner uniqueness invariant holds on the UI path — a second assign is refused, minting no second row
    Given a first same-origin POST /api/mesh/assign { ref: "38/04", nodeId: "worker-a" } has minted the active assignment (200)
    When a SECOND same-origin POST /api/mesh/assign { ref: "38/04", nodeId: "worker-a" } is sent
    Then the response status is a coded non-200 with code "assignment-already-active"
    And still EXACTLY ONE active assignment row exists for "38/04" (no second row was minted)
    And the refusal names the current holder "worker-a" (the verb's own holder field, surfaced faithfully)

  Scenario: the uniqueness invariant is the ITEM's, not the node's — a second assign to a DIFFERENT eligible node is refused too
    Given a first same-origin POST /api/mesh/assign { ref: "38/04", nodeId: "worker-a" } has minted the active assignment (200)
    And a second known worker node "worker-b" that also holds the workspace's published repo
    When a same-origin POST /api/mesh/assign { ref: "38/04", nodeId: "worker-b" } is sent
    Then the response status is a coded non-200 with code "assignment-already-active"
    And still EXACTLY ONE active assignment row exists for "38/04", held by "worker-a" (the item already has a runner)
    # findActiveAssignment keys on (workspaceId, itemRef) — the UI path cannot double-assign an item around the CLI's arbitration

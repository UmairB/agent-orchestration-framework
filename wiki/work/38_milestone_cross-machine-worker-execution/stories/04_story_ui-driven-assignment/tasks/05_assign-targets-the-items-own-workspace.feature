@executable @ui @work @distribution
Feature: POST /api/mesh/assign targets the ITEM's OWN workspace — workspaceId is REQUIRED on the wire, resolved through the sanctioned query seam, and the mint's target is ASSERTED before it is minted
  In order that clicking "assign" on a card dispatches THAT card's milestone — and never, silently, a colliding ref in a
  completely different workspace — the fleet face's ONE mutation route requires a `workspaceId` on the wire, resolves it to a
  project root through queryGlobalMeshStatus → status.workspaces[], refuses (coded, minting nothing) when it cannot, and asserts
  the loaded workspace's OWN derived id equals the requested one BEFORE calling assignWork.

  # ⛔ BLOCKER F21 — measured LIVE at the 2026-07-24 two-machine soak (VERIFICATION §"Soak 04"). The operator clicked
  # "Homedata Live Property Data" (ref 18, let-shield-portal, workspace 1f164bd03ea535da) with NO CLI touched. The route
  # returned `200 ok` and minted an assignment for ref 18 in the CONTROL's OWN aof workspace (9db1fd84f5895e38) — an entirely
  # different milestone ("Per-folder integration descriptor"). The fleet face is GLOBAL (it lists items from every workspace on
  # the machine, 102 milestones across 5 on the operator's control node) but the POST carried only { ref, nodeId } and the route
  # called loadWorkspace(resolvedProjectDir, …) — the DAEMON's own launch dir — so it was STRUCTURALLY incapable of targeting
  # the workspace the card belongs to. Where the ref collides it silently dispatches the WRONG WORK off a correct-looking 200;
  # where it does not, it fails. This is the ADR-010 "Gap A" class for the THIRD time in this milestone (cloneUrl → App identity
  # → the assign target).
  #
  # ARCHITECTURE 38/ADR-012 AMENDMENT (2026-07-24): ruling 1 — the wire is `{ ref, nodeId, workspaceId }`, ALL THREE REQUIRED,
  # and a blank/absent workspaceId is a CODED refusal, NEVER a fallback to the daemon's own workspace (the "intuitive" fallback
  # IS the defect — the milestone's F-38.06b lesson: remove the wrong degree of freedom by CONSTRUCTION). Ruling 2 — resolution
  # goes through queryGlobalMeshStatus → status.workspaces[] → projectRoot, the EXACT seam GET /api/mesh/board-url already uses,
  # so the resolution domain EQUALS the render domain. Ruling 3 — the route MUST assert the resolved workspace's own derived id
  # (`config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(projectRoot)`, the verb's OWN expression) equals the requested one
  # BEFORE the mint. Structural invariants 5 and 6; fitness acd-fleet-assign-targets-item-workspace (armed RED-until-fixed).
  #
  # WHY A TWO-WORKSPACE FIXTURE IS PART OF THE CONTRACT, not an implementation detail. Tasks 00–03 are honest producer-fed
  # lanes — the REAL route, the REAL verb, every mint read back from the REAL store — and they could not see F21, because a
  # SINGLE-workspace fixture STRUCTURALLY cannot express it: the server's own workspace is the only workspace there is, so the
  # wrong answer and the right answer are the SAME value. "Producer-fed constrains the DATA, not the CONFIGURATION" (STATE.md).
  # So every scenario below runs against TWO published workspaces on one machine — the daemon's own A and a foreign B — with the
  # SAME ref "18" in BOTH and an eligible worker for BOTH, which is exactly what turned the live failure from loud into silent.

  Background:
    Given the REAL fleet face (serveMeshUi) stood up on workspace A ("control"), the DAEMON's own launch dir
    And a SECOND workspace B ("portal") — a different repo on the same machine — published into the SAME global projection
    And BOTH workspaces carry a milestone at the SAME ref "18": A's is "Per-folder integration descriptor", B's is "Homedata Live Property Data"
    And a worker node "worker-a" that holds the published repo of BOTH workspaces (so a mis-target is NOT caught incidentally by the repo gate — it succeeds)
    And a THIRD workspace whose snapshot is in the projection but whose checkout has been DELETED from this machine
    And no prior active assignment exists for "18" in either workspace

  Scenario: assigning a card that belongs to a NON-daemon workspace mints in THAT workspace, against THAT workspace's item
    When a same-origin POST /api/mesh/assign with body { ref: "18", nodeId: "worker-a", workspaceId: <B> } is sent
    Then the response status is 200
    And EXACTLY ONE global_assignments row exists for ("18", B) when read back through the REAL store
    And that row's state is "assigned" and its target_node_id is "worker-a"
    And the response body's workspaceId is <B> — the id the operator clicked, which is the id the verb STAMPED
    # the shape no existing story-04 test covers: the item assigned belongs to a workspace that is NOT the server's own

  Scenario: the ref COLLISION reproduced verbatim from the soak — the mint lands on the clicked card, and the daemon's own identically-refed item is untouched
    When a same-origin POST /api/mesh/assign with body { ref: "18", nodeId: "worker-a", workspaceId: <B> } is sent
    Then the response status is 200
    And EXACTLY ONE global_assignments row exists for ("18", B)
    And ZERO global_assignments rows exist for ("18", A) — the daemon's own colliding ref is a COMPLETELY DIFFERENT milestone and must never be dispatched
    And the assigned item's title, resolved through the REAL projection, is "Homedata Live Property Data" — not "Per-folder integration descriptor"
    # this IS the live defect: the operator clicked one milestone and the mesh dispatched another, off a `200 ok`

  Scenario: assigning the daemon's OWN workspace still works — the fix targets the ITEM's workspace, it does not forbid the local one
    When a same-origin POST /api/mesh/assign with body { ref: "18", nodeId: "worker-a", workspaceId: <A> } is sent
    Then the response status is 200
    And EXACTLY ONE global_assignments row exists for ("18", A)
    And ZERO global_assignments rows exist for ("18", B)

  Scenario Outline: every refusal is CODED, names its own cause, and mints NOTHING anywhere — there is no fallback on any leg
    When a same-origin POST /api/mesh/assign is sent with <case>
    Then the response status is <status> and the body code is <code>
    And the response is never a 200 and never carries ok:true
    And ZERO global_assignments rows exist for ("18", A) — no fallback to the daemon's own workspace
    And ZERO global_assignments rows exist for ("18", B)
    And the total global_assignments row count across the whole store is UNCHANGED

    Examples:
      | case                                                          | status | code                  |
      | no workspaceId field at all (the stale, pre-amendment client) | 400    | invalid-workspace     |
      | workspaceId: "" (blank)                                       | 400    | invalid-workspace     |
      | workspaceId: "0000000000000000" (not in the projection)       | 404    | workspace-not-found   |
      | workspaceId of the workspace whose checkout was DELETED       | 409    | workspace-not-local   |

  # ADDED 2026-07-24 (`aof:continue 38/04` review fix QA-e) — nothing pinned the KEY of the single-runner gate. On a GLOBAL face
  # two cards legitimately carry ref "18", and a future "fix" that globalised `findActiveAssignment` to key on item_ref alone
  # would make the second card silently un-assignable ("already active, held by worker-a") with every F21 lane above still green,
  # because they only ever assign ONE of the two colliding cards.
  Scenario: the item's uniqueness gate is PER WORKSPACE — both colliding "18" cards assign, and only a repeat of the SAME (workspace, ref) is refused
    When a same-origin POST /api/mesh/assign names ref "18" in workspace <B> and it succeeds
    And a same-origin POST /api/mesh/assign then names ref "18" in workspace <A>
    Then the second response is 200 — a colliding ref in ANOTHER workspace is a DIFFERENT item, never "already active"
    And EXACTLY ONE active assignment row exists for ("18", B) and EXACTLY ONE for ("18", A)
    And a REPEAT of ("18", B) is refused "assignment-already-active", minting no second row
    # findActiveAssignment keys on (workspace_id, item_ref) — the gate the fleet face inherits must stay the ITEM's, and on this
    # face "the item" is (workspace, ref), never the ref alone

  Scenario: a project root that is not on THIS machine names its OWN cause — never a misleading `ref-not-found`
    When a same-origin POST /api/mesh/assign names the workspace whose checkout was deleted
    Then the body code is "workspace-not-local", NOT "ref-not-found"
    # loadWorkspace degrades a missing config to an empty one and findWork then resolves nothing, so an unchecked route would
    # report a typo'd ref for "that repo is not on this machine" — a refusal that names the WRONG cause (ADR-012 AMENDMENT, the
    # reachability caveat). Workspace ids are path-derived, so a row published by ANOTHER machine has exactly this shape.

  Scenario: the mint's target is asserted PRE-mint — a workspace whose own config claims a DIFFERENT id refuses, minting nothing
    Given the resolved workspace's config declares mesh.workspaceId of some OTHER value than the requested id
    When a same-origin POST /api/mesh/assign names the requested id
    Then the response status is 409 and the body code is "workspace-id-mismatch"
    And NO global_assignments row is minted for the item in EITHER id
    # assignWork does not take a workspaceId — it DERIVES the id it stamps from the workspace OBJECT it is handed (resolveItem,
    # commands/mesh-assign.mjs). "We resolved the row carefully" is therefore NOT the same guarantee as "the minted record carries
    # the id the operator clicked": that is F21's exact shape, one level down. The assertion converts careful resolution into an
    # impossibility, and it must run BEFORE the verb — a post-mint check is a mis-dispatch already committed.

  Scenario: the REAL built UI puts the item's own workspaceId on the wire — the affordance is one prop away from correct, and it is that prop
    Given the REAL production <Fleet/> mounted against the REAL fleet face, showing cards from BOTH workspaces
    When the operator clicks "Assign →" on the card whose title is "Homedata Live Property Data"
    Then the POST the app actually sent carries workspaceId <B> — the same datum the drill-in beside it passes to boardUrl
    And EXACTLY ONE global_assignments row exists for ("18", B), and ZERO for ("18", A)
    # ADR-012 producer-fed conformance, at the CONFIGURATION the defect needed: the real client, the real route, the real store,
    # and more than one candidate target on screen (the operator's own experience, reproduced).

@executable @ui @work @distribution
Feature: GET /api/mesh/status carries assignment rows per work item and per node — a read-only additive shape
  In order for the read-only fleet view to render dispatch lifecycle without a second read or a write route
  the `/api/mesh/status` aggregate, shaped through the `global-mesh-query` composition seam, attaches the
  `global_assignments` rows onto the work items and the nodes it already carries
  so that the SPA reflects who was assigned what — and how far it got — from the ONE status command it already polls.

  # ADR-007 (this milestone) — the fleet UI stays READ-ONLY; story 03 extends the READ shape, never the write
  # posture. ADR-001 — the assignment record is the frozen key set
  # `{ assignmentId, itemRef, workspaceId, targetNodeId, issuer, state, runId, assignedAt, updatedAt, reclaimedAt }`
  # living in the NEW `global_assignments` table (never swept by the snapshot cycle). This task freezes only what
  # the READ shape carries, not the writers (those are Story 00's `insertAssignment`/`updateAssignmentState`).
  #
  # THE SEAM (feasibility-confirmed): `queryGlobalMeshStatus` (src/global-mesh-query.mjs:32) opens the store,
  # runs `queryGlobalWorkProjection` (items) + `queryGlobalRegistry` (nodes), and hands both to the PURE
  # `shapeGlobalStatus({ paths, workProjection, registry, now })` (src/global-mesh-query.mjs:71), which returns
  # `{ scope, workspaceId, workspaces, items, nodes, diagnostics }`. Story 00's backend adds a
  # `global_assignments` read to the projection query and a per-item / per-node join in `shapeGlobalStatus`.
  # Because `shapeGlobalStatus` is pure (no I/O, every `now` passed in), the shape is asserted HEADLESSLY over
  # planted projection+assignment inputs — no live SQLite, no browser — matching the m34 shape-test convention.
  #
  # DESIGN "Data note": the UI reads assignments from the SAME single `/api/mesh/status` aggregate (one command,
  # no second read). The exact wire field names on the item/node rows are the backend stories' to freeze; THIS
  # task fixes that the rows travel and that nothing is fabricated where no assignment exists.
  #
  # SEAM SPLIT — this task judges the READ SHAPE only. The assignment WRITERS + the frozen-key freeze itself are
  # `acd-assignment-record-frozen` / `acd-assignment-state-has-producer` (Story 00). The render of these rows is
  # task 01 (the pure chip helpers) + task 03 (the @uat visual). The no-write-branch posture is task 02. The
  # a11y lane is OFF for this story (no "a11y" in work.tags.domains — no axe-core run, no a11y finding).

  Background:
    Given the global projection query surface is injected so the status shape can be observed without a live store
    And the assignment assembler yields ADR-001 rows keyed by assignmentId

  # A work item that carries an active assignment surfaces its assignment on the item row — the PRIMARY
  # attachment point (DESIGN §2a: the GlobalMilestoneCard attention row). The shape carries the fields the chip
  # anatomy renders (state, targetNodeId, the lifecycle timestamps, reclaimedAt for the degraded note).
  Scenario: a work item carrying an assignment surfaces the assignment on its item row
    Given the global projection returns work item "35/00" in workspace "alpha"
    And the store holds an assignment for "35/00" in "alpha" targeting node "worker-b" in state "running"
    When the status shape is composed through shapeGlobalStatus
    And the browser requests `GET /api/mesh/status`
    Then the response status is 200
    And the item row for "35/00" carries an assignment
    And that assignment reports state "running", targetNodeId "worker-b", and a runId
    And that assignment carries assignedAt, updatedAt, and a null reclaimedAt

  # The SECONDARY attachment point (DESIGN §2b: the NodeCard "what it's running" row). A node that HOLDS
  # assignments (by state) surfaces them keyed to that node, so a worker card can read "what has been dispatched
  # TO me." Per-node the shape carries the rows targeting that nodeId — the UI summarises the counts.
  Scenario: a node holding assignments surfaces them keyed to that node
    Given the global registry returns worker node "worker-b"
    And the store holds two assignments targeting "worker-b" — one "running" and one "accepted"
    When the status shape is composed through shapeGlobalStatus
    And the browser requests `GET /api/mesh/status`
    Then the response status is 200
    And the node row for "worker-b" carries its held assignments
    And those assignments report states "running" and "accepted" targeting "worker-b"

  # "Absent, not false" — nothing fabricated. An item or a node with NO assignment carries an empty/absent
  # assignment field, never a synthesized default row. DESIGN §3 empty-state: absence reads as "not dispatched,"
  # never a zero-count or an error. This is the "absent, not false" idiom the local tag / never-beat presence use.
  Scenario: an item and a node with no assignment carry nothing fabricated
    Given the global projection returns work item "34" in workspace "alpha" with no assignment in the store
    And the global registry returns node "worker-c" with no assignment targeting it
    When the status shape is composed through shapeGlobalStatus
    And the browser requests `GET /api/mesh/status`
    Then the response status is 200
    And the item row for "34" carries an empty or absent assignment field
    And the node row for "worker-c" carries an empty or absent assignment field
    And no placeholder or zero-count assignment row is synthesized for either

  # The shape is read-only ADDITIVE (ADR-007): every field the m34 status shape already carried keeps its
  # meaning byte-for-byte. Adding assignment rows changed `items`/`nodes` only by attaching a field; `scope`,
  # `workspaces`, and `diagnostics` are untouched. A reader that ignores the new field is unaffected.
  Scenario: the assignment rows are additive — no existing status field changes meaning
    Given the global projection returns the same workspaces, items, and nodes as before this story
    When the status shape is composed through shapeGlobalStatus
    Then the response body still carries scope, workspaces, items, nodes, and diagnostics
    And every pre-existing field on those rows keeps its m34 meaning unchanged
    And the assignment rows appear ONLY as an added field on the item and node rows
    And a reader that ignores the assignment field reads the same shape it read before

  # The shape carries the row VERBATIM per lifecycle state — the read layer does not collapse or re-label
  # states (that mapping is task 01's pure chip helpers). Each ADR-001 state travels through the shape as-is so
  # the render layer is the single place the ramp is applied. A `reclaimed` row travels with its `reclaimedAt`
  # stamp set, so the degraded note (task 01) has the provenance it renders.
  Scenario Outline: each lifecycle state travels through the read shape verbatim, with reclaim provenance intact
    Given the store holds an assignment for "35/00" in "alpha" in state "<state>"
    And its reclaimedAt is "<reclaimedAt>"
    When the status shape is composed through shapeGlobalStatus
    Then the item row for "35/00" carries an assignment reporting state "<state>"
    And the assignment's reclaimedAt is "<reclaimedAt>"
    And the read layer applies no chip label or colour to the row (that is the render layer's job)

    Examples: the active states travel verbatim, reclaimedAt null
      | state    | reclaimedAt |
      | assigned | null        |
      | accepted | null        |
      | running  | null        |

    Examples: the terminal states travel verbatim; only the reclaim path carries a reclaimedAt stamp
      | state     | reclaimedAt              |
      | done      | null                     |
      | failed    | null                     |
      | withdrawn | null                     |
      | reclaimed | 2026-07-08T10:05:00.000Z |

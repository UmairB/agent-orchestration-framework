@cli @work @distribution @executable
Feature: mesh:status aggregates the whole fleet — the boards projection joins the group registry with each board's owner and its owner's active runs
  In order to answer "what is the whole fleet doing right now" through ONE registered command,
  mesh:status is extended additively with a boards projection: the group registry's registered
  boards (m24), each joined with the node that works it (the roster join) and that owner's synced
  running runs (the owner's presence.activeRuns — the fleet-durable run signal),
  so that both faces — the aof mesh status CLI mirror and the aof mesh ui web surface — consume
  one { nodes, boards } aggregate, existing { nodes } consumers see their shape unchanged, and
  the whole read still mutates nothing.

  # ARCHITECTURE ADR-002: EXTEND mesh:status in place (src/commands/mesh-identity.mjs), never
  # a second fleet-data command. The boards come from readRegistry(workspace) (m24 — registry
  # boards[] + roster[{ nodeId, admittedAt, boards[] }]). ADR-005 (finding F1) pins the run
  # source: a board's activeRuns is its OWNER node's synced presence.activeRuns — the ONLY
  # fleet-durable run signal (each board keeps its own git; a peer board's run records never
  # sync here, and there is no board-slug→workspace map — so the local-work-stream read the
  # shipped build used was dead-[] in production). mesh:status re-reads nothing: it reuses the
  # SAME merged presence the nodes half already computed. That NO second module co-reads the
  # fleet aggregate is the acd-mesh-ui-single-data-command arch-test (phase 1), a structural
  # invariant NOT re-asserted here. This feature asserts the OBSERVABLE aggregate: the extended
  # --json shape, the joins, the additive compatibility, and the pure read. Staleness itself is
  # m23's contract (23/00 task 01) — not re-asserted here; the human render is task 01,
  # degradation task 02.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh:status accepts an injected "now" and reads the records I plant (white-box over the inputs)

  # The headline: each registered board appears once, joined with its roster owner and that
  # owner's running run ids (the owner's synced presence.activeRuns).
  # DEV FEASIBILITY VERDICT (boards-entry KEY SHAPE + shared-board cardinality): LOCKED.
  # A boards[] entry is exactly { ref, owner, activeRuns } (+ an additive `local` marker on a
  # board owned by THIS node — task 03 / design-gap B):
  #   - `ref`      = the board slug string (the m24 registry board — an opaque slug; the
  #                  registry's boards are plain strings, src/mesh-registry.mjs registerBoard).
  #   - `owner`    = the nodeId string of the roster entry carrying the board (DESIGN §2 board
  #                  tile: a SINGLE "on <nodeId>" owner label — one owner, never a list).
  #   - `activeRuns` = the string[] of the OWNER's running run ids, read from that owner's
  #                  presence.activeRuns (ADR-005). The heartbeat already filtered to
  #                  state === "running" when it published the presence record (m23), so
  #                  mesh:status surfaces the owner's set verbatim — it does not re-scan runs.
  # SHARED-BOARD CARDINALITY: FIRST-WINS a single `owner`, NOT an owners list. When TWO roster
  # entries carry the SAME board slug, the owner is the FIRST roster entry (registry.roster[]
  # insertion order — admitNode appends order-preserving, src/mesh-registry.mjs).
  Scenario: mesh:status carries every registered board with its owner and its owner's active runs
    Given a group registry whose roster admits "node-a" with board "let-shield" and "node-b" with board "voice-vox-web"
    And "node-a" has a presence record whose activeRuns carries one running run id and "node-b" has a presence record with no active runs
    When I invoke mesh:status with an injected now
    Then the --json result carries a boards list with exactly "let-shield" and "voice-vox-web" (each entry's board slug is its `ref`)
    And "let-shield" carries its `owner` "node-a" and exactly its owner's one running run id in `activeRuns`
    And "voice-vox-web" carries its `owner` "node-b" and an empty `activeRuns` list (not dropped, not an error)

  # One node can work many boards: the roster join fans out, each board appearing once, each
  # carrying the same owner — and (the ADR-005 reduced-signal consequence) the same owner's
  # active runs, since the fleet signal is per-node, not per-board.
  Scenario: a roster entry carrying two boards yields two board entries with the one owner
    Given a group registry whose roster admits "node-a" carrying boards "let-shield" and "voice-vox-web"
    And "node-a" has a presence record whose activeRuns carries one running run id
    When I invoke mesh:status with an injected now
    Then the boards list carries "let-shield" and "voice-vox-web", each exactly once
    And both entries carry the `owner` "node-a"
    And both entries carry that owner's active run id (the fleet signal is per-owner, not per-board)

  # A node that works no board still belongs to the fleet: it stays in the nodes half and
  # simply contributes nothing to the boards projection — zero boards is a state, not an
  # exclusion.
  Scenario: a roster node with an empty boards list stays in the nodes half and adds no board entry
    Given a group registry whose roster admits "node-c" with an empty boards list
    And a node record and a fresh presence heartbeat for "node-c"
    When I invoke mesh:status with an injected now
    Then "node-c" appears in the nodes half as usual
    And the boards list carries no entry owned by "node-c"
    And no error is raised

  # The run source is the owner's presence: a board carries exactly the run ids its owner's
  # presence.activeRuns carries. Several running runs → several ids (a list, not a boolean).
  # DEV: presence.activeRuns is authored by mesh:heartbeat as the node's running run ids
  # (readActiveRuns over its local work stream, m23) — mesh:status reads it back off the
  # git-synced .mesh/presence record (ADR-005), never a re-scan.
  Scenario: a board carries every one of its owner's active run ids
    Given a group registry whose roster admits "node-a" with board "let-shield"
    And "node-a" has a presence record whose activeRuns carries two running run ids
    When I invoke mesh:status with an injected now
    Then "let-shield" carries exactly those two run ids in `activeRuns`, no duplicates

  # A board whose owner has no presence record yet (or an empty activeRuns) reads an empty
  # activeRuns — the never-blank []-not-error degradation. This is also the peer-board case:
  # a peer's run records never sync here, but its owner's presence does; no presence ⇒ [].
  Scenario: a board whose owner has no presence reads an empty activeRuns
    Given a group registry whose roster admits "node-a" with board "let-shield"
    But "node-a" has no presence record
    When I invoke mesh:status with an injected now
    Then "let-shield" carries its `owner` "node-a" and an empty `activeRuns` list
    And no error is raised

  # DEV FEASIBILITY VERDICT (enumeration source): LOCKED on the UNION reading. readRegistry
  # returns BOTH the top-level boards[] set AND each roster entry's boards[]. The projection
  # enumerates the UNION of registry.boards[] ∪ every roster[].boards[] (de-duped, set
  # semantics). A board present only on a roster entry STILL surfaces; a board present only in
  # top-level boards[] (ownerless) ALSO surfaces (task 02 owns that half, owner OMITTED).
  Scenario: a board carried only on a roster entry still surfaces in the projection
    Given a group registry whose roster admits "node-a" carrying board "let-shield"
    But the registry's top-level boards list does not include "let-shield"
    When I invoke mesh:status with an injected now
    Then "let-shield" appears in the boards list with its owner "node-a"
    And no error is raised

  # Additive over the frozen { nodes } shape: an existing consumer of the nodes half sees
  # exactly what m23 gave it — same entries, same fields — with the boards key alongside.
  Scenario: the nodes half of the aggregate is unchanged for existing consumers
    Given a node "node-a" with a fresh presence heartbeat
    And a group registry that registers one board
    When I invoke mesh:status with an injected now
    Then the --json result still carries the stable { nodes: [ { nodeId, presence?, stale } ] } half unchanged
    And the "node-a" entry carries no boards-derived key (the boards join never reshapes a node entry)
    And the boards projection sits alongside it as a new top-level key

  # The aggregate is a PURE read: joining registry + presence writes nothing.
  Scenario: aggregating the fleet changes no files
    Given a populated registry, node records, and presence records
    And I record the workspace's on-disk state
    When I invoke mesh:status with an injected now
    Then the workspace's on-disk state is byte-unchanged (the aggregate is a pure read)

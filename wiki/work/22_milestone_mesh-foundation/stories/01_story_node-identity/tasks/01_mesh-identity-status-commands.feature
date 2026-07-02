@cli @work @distribution @executable
Feature: The mesh:identity and mesh:status commands publish this node's record and read the synced roster through the one command core
  In order to inherit node identity through milestone 08's one door (the CLI / board / node faces all thin over it)
  the mesh:identity command publishes + reads this node's record via the mesh-store and mesh:status lists the synced node roster,
  so that publishing identity and reading the fleet are registered command-core capabilities with stable --json shapes — not a parallel subsystem.

  # ARCHITECTURE ADR-001/003: two thin commands over story 00's mesh-store + story 01's
  # node-identity mechanic, carrying the frozen { id, input, run, cli } contract (08/ADR-002).
  # This feature asserts the COMMANDS' run-surface (publish/read/list semantics + --json
  # shapes); the CLI face (argv -> render) is task 02; the registry-derived bijection is the
  # acd-mesh-command-cli-bijection ARCH-TEST (story 00, fitness #3). mesh:status reads the
  # roster the sync engine (story 02) populates, but reads whatever records EXIST — so it is
  # testable without sync.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core

  # mesh:identity with no peer ref publishes THIS node's record (assembling the descriptor via
  # node-identity, persisting via the store) and returns it — the publish path.
  Scenario: mesh:identity publishes this node's record and returns it
    When I invoke mesh:identity to publish this node
    Then a node record for this node's id is persisted under the partition root
    And the returned record carries the complete frozen schema in its published shape
    And the persisted record is byte-equivalent to the returned record

  # Republish bumps publishedAt and keeps the id stable — a node updates its own current-state
  # record in place (identity is current-state, not a log).
  # R4: pin BOTH the targeted change (id stable, publishedAt bumped, still one own file) AND the
  # UNAFFECTED side — a peer's record in the tree is byte-unchanged by this node republishing.
  Scenario: republishing through mesh:identity bumps publishedAt, keeps the id stable, and leaves peers untouched
    Given this node has already published its record
    And a peer node record for "umair-mbp" exists in the tree
    And I record the on-disk bytes of the "umair-mbp" record
    When I invoke mesh:identity to publish this node again
    Then the node id is unchanged
    And "publishedAt" is at or after the previous publish
    And there is still exactly one record file for this node's id
    And the "umair-mbp" record on disk is byte-identical to before the republish

  # mesh:identity can READ a node's record back (this node, or a named peer id that has synced
  # into the tree). A read tolerates the slug-style id; an absent id reads as absent, not error,
  # and reading mutates nothing on disk.
  Scenario: mesh:identity reads a node's record back by id
    Given a peer node record for "umair-mbp" exists in the synced tree
    And I record the partition root's on-disk state
    When I invoke mesh:identity to read "umair-mbp"
    Then the result is the peer's node record
    When I invoke mesh:identity to read "never-synced"
    Then the result is absent (not an error)
    And invoke raises no error
    And the partition root's on-disk state is byte-unchanged (a read never writes)

  # mesh:status lists the synced roster — this node + every peer record present in the tree —
  # the fleet-nodes read (no presence yet; presence is milestone 23).
  # R4: pin the UNAFFECTED side — listing the roster is a pure read that mutates no record file.
  Scenario: mesh:status lists every node record in the synced tree
    Given node records for "umair-desktop", "umair-mbp" and "build-server" exist in the tree
    And I record the partition root's on-disk state
    When I invoke mesh:status
    Then the result lists all three nodes with their ids and capabilities
    And the --json result is a stable { nodes:[...] } shape
    And the result lists exactly those three node ids (no extras, none dropped)
    And the partition root's on-disk state is byte-unchanged (status is a pure read)

  # An empty roster reads as empty, not an error — a freshly initialised node that has not yet
  # synced any peer still answers cleanly.
  Scenario: mesh:status on an empty roster returns an empty list, not an error
    Given the partition root has no node records yet
    When I invoke mesh:status
    Then the result is an empty node list
    And the --json result is the stable { nodes: [] } shape
    And no error is raised

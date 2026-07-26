@executable @cli @work @distribution
Feature: Global mesh publishes operator-readable node descriptors
  In order to inspect the control node's machine-wide mesh without opening each workspace
  the global registry materializes one descriptor per known node
  so that node identity, role hints, capability metadata, fabric reachability, and workspace membership are visible from global AOF.

  Background:
    Given a fixture AOF_GLOBAL_HOME with an empty global mesh registry
    And a mesh-enabled workspace fixture has a node record for "node-a"
    And the workspace has a presence record for "node-a"
    And the workspace fabric peer map contains "node-a"

  Scenario: publishing a node descriptor joins node, presence, fabric, and workspace signals
    Given the node record for "node-a" contains host "alpha", os "win32", runtimes ["codex"], skills ["aof-refine"], aofVersion "1.2.3", and publishedAt "2026-07-04T10:00:00.000Z"
    And the presence record for "node-a" contains heartbeatAt "2026-07-04T10:01:00.000Z"
    And the fabric peer for "node-a" has dialAddress "ws://alpha.tailnet:7007", online true, and host "alpha"
    When the workspace publishes global node descriptors at "2026-07-04T10:02:00.000Z"
    Then "<global>/mesh/nodes/node-a.json" exists
    And the descriptor contains nodeId "node-a", host "alpha", os "win32", runtimes ["codex"], skills ["aof-refine"], and aofVersion "1.2.3"
    And the descriptor contains role "worker" unless the local config nominates "node-a" as the relay control node
    And the descriptor contains fabric address "ws://alpha.tailnet:7007" and fabric online true
    And the descriptor contains lastSeenAt "2026-07-04T10:01:00.000Z"
    And the descriptor contains workspace membership for the publishing workspace
    And a node row for "node-a" is upserted in the global projection index

  Scenario: a nominated relay control node is rendered with control role
    Given the workspace config has mesh.nodeId "node-a"
    And the workspace config has mesh.relay.controlNode "node-a"
    When the workspace publishes global node descriptors
    Then the descriptor for "node-a" contains role "control"
    And the descriptor marks controlNode true

  Scenario: a fabric-only peer is represented as an incomplete node instead of disappearing
    Given the workspace has no node record for "node-b"
    And the workspace fabric peer map contains "node-b" with dialAddress "ws://beta.tailnet:7007", online true, and host "beta"
    When the workspace publishes global node descriptors
    Then "<global>/mesh/nodes/node-b.json" exists
    And the descriptor for "node-b" contains nodeId "node-b", host "beta", and fabric address "ws://beta.tailnet:7007"
    And the descriptor marks recordSource "fabric"
    And missing capabilities are represented as empty arrays, not omitted

  Scenario: publishing the same node descriptor twice is idempotent
    Given the descriptor for "node-a" has already been published from the same workspace snapshot
    When the same workspace snapshot publishes global node descriptors again
    Then there is still one node descriptor file for "node-a"
    And there is still one node row for "node-a" in the projection index
    And the descriptor workspace membership for the publishing workspace is not duplicated


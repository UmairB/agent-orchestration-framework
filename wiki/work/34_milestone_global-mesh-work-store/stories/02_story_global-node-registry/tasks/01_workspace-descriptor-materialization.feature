@executable @cli @work @distribution
Feature: Global mesh publishes workspace descriptors with node membership
  In order to understand which repositories belong to the machine-wide mesh
  the global registry materializes one descriptor per mesh-enabled workspace
  so that operators can see workspace identity, path, work directory, membership, and publish freshness from global AOF.

  Background:
    Given a fixture AOF_GLOBAL_HOME with an empty global mesh registry
    And a mesh-enabled workspace fixture has projectRoot "C:\repos\alpha"
    And the workspace config names work.dir "./wiki/work"
    And the workspace has node records for "node-a" and "node-b"

  Scenario: publishing a workspace descriptor records the workspace outline
    When the workspace publishes global registry descriptors at "2026-07-04T10:03:00.000Z"
    Then one descriptor exists under "<global>/mesh/workspaces"
    And the descriptor contains workspaceId, projectRoot "C:\repos\alpha", workDir "./wiki/work", and meshEnabled true
    And the descriptor contains publishedAt "2026-07-04T10:03:00.000Z"
    And the descriptor lists member node ids ["node-a", "node-b"]
    And a workspace row is upserted in the global projection index

  Scenario: the workspace descriptor identity is stable across repeated publishes
    Given the workspace descriptor has already been published
    When the same workspace snapshot publishes global registry descriptors again
    Then the descriptor path is unchanged
    And the descriptor workspaceId is unchanged
    And the descriptor node membership is replaced from the current snapshot instead of appended

  Scenario: removing a node from a workspace updates membership without deleting the node descriptor globally
    Given the global registry already contains workspace membership for "node-a" and "node-b"
    And the current workspace snapshot contains only node record "node-a"
    When the workspace publishes global registry descriptors
    Then the workspace descriptor member node ids are ["node-a"]
    And the node descriptor for "node-b" is not deleted if another workspace still references it
    And the projection index no longer links this workspace to "node-b"

  Scenario: a non-mesh workspace does not produce workspace descriptors
    Given the workspace config has mesh.enabled false
    When the workspace requests global registry descriptor publication
    Then no workspace descriptor is written
    And no node descriptor is written
    And the publish result is skipped with code "mesh-global-disabled"


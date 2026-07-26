@executable @cli @work @distribution
Feature: The mesh launcher periodically republishes the current workspace snapshot
  In order to converge direct record-doc edits and missed command hooks
  the mesh launcher and sync cadence can publish an idempotent workspace snapshot
  so that the global projection eventually reflects mesh-enabled workspaces even without a fresh mutation command.

  Background:
    Given a mesh-enabled workspace with config.mesh.enabled true
    And an injected ticker controls the mesh launcher cadence
    And a fake global publisher records publish attempts

  Scenario: launcher start publishes an initial workspace snapshot
    When the mesh launcher starts successfully
    Then the global publisher is called once with the loaded workspace
    And the publish happens after the launcher preflight succeeds
    And the publish happens without changing the launcher presence record shape

  Scenario: each convergence tick republishes idempotently
    Given the mesh launcher is running
    When the convergence ticker fires three times
    Then the global publisher is called once per tick
    And each publish replaces this workspace's projection rows rather than appending duplicates

  Scenario: disabled workspaces do not publish from the launcher
    Given config.mesh.enabled is false
    When the mesh launcher starts successfully
    And the convergence ticker fires
    Then the global publisher is never called
    And no global mesh store is opened

  Scenario: a publish failure during a launcher tick does not stop presence or sync loops
    Given the mesh launcher is running
    And the global publisher fails with code "projection-write-failed"
    When the convergence ticker fires
    Then the publish failure is captured as a launcher warning
    And the mesh sync loop remains running
    And the peer poll loop remains running
    And the next convergence tick attempts publishing again

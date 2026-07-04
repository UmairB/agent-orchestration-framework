@executable @cli @work @distribution
Feature: Global registry query API exposes node freshness and workspace filters
  In order to power the global mesh UI without re-scanning every workspace
  the global registry query surface returns descriptors from the projection index
  so that callers can filter by workspace, role, and freshness while preserving the existing node staleness semantics.

  Background:
    Given a supported global work projection store is open in a fixture AOF_GLOBAL_HOME
    And the registry contains descriptors for nodes "node-a", "node-b", and "node-c"
    And the node staleness threshold is 60 seconds

  Scenario: query returns live, stale, and unknown freshness using the presence clock
    Given "node-a" has lastSeenAt "2026-07-04T10:00:30.000Z"
    And "node-b" has lastSeenAt "2026-07-04T09:59:00.000Z"
    And "node-c" has no lastSeenAt
    When global registry nodes are queried at "2026-07-04T10:01:00.000Z"
    Then "node-a" has freshness "live"
    And "node-b" has freshness "stale"
    And "node-c" has freshness "unknown"
    And a node with no presence is not marked stale

  Scenario: freshness at the exact threshold is still live
    Given "node-a" has lastSeenAt "2026-07-04T10:00:00.000Z"
    When global registry nodes are queried at "2026-07-04T10:01:00.000Z"
    Then "node-a" has freshness "live"

  Scenario: callers can filter nodes by workspace and role
    Given "node-a" is a control node in workspace "alpha"
    And "node-b" is a worker node in workspace "alpha"
    And "node-c" is a worker node in workspace "beta"
    When global registry nodes are queried with workspace filter "alpha" and role filter "worker"
    Then the result contains only "node-b"
    And the result includes the workspace membership that caused the match

  Scenario: query reads projection rows without opening workspace work streams
    Given the projection index contains node and workspace descriptor rows
    When global registry nodes are queried
    Then the query layer does not call loadWorkspace for each indexed workspace
    And the result is assembled from global descriptor rows and JSON paths only

  Scenario: a corrupt descriptor is reported without hiding healthy nodes
    Given the JSON descriptor for "node-b" cannot be parsed
    When global registry nodes are queried
    Then the result still contains "node-a" and "node-c"
    And the query result includes one descriptor error for "node-b"
    And the corrupt descriptor is not deleted by the read


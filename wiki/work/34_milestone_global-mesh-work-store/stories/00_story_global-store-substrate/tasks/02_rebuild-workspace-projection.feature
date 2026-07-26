@executable @cli @work @distribution
Feature: A workspace snapshot rebuilds its global projection rows idempotently
  In order to make the global store recoverable and at-least-once safe
  publishing a workspace snapshot replaces that workspace's derived rows in the projection
  so that stale rows disappear, canonical record docs remain authoritative, and repeated publishes converge.

  Background:
    Given a supported global work projection store is open in a fixture AOF_GLOBAL_HOME
    And a mesh-enabled workspace fixture has projectRoot "C:\repos\alpha"
    And its workDir contains a milestone "34" and two stories "34/00" and "34/01"

  Scenario: publishing a workspace snapshot inserts workspace and item rows
    When the workspace snapshot is published to the global projection
    Then one workspace row exists for "C:\repos\alpha"
    And item rows exist for "34", "34/00", and "34/01"
    And each item row includes workspace id, ref, type, slug, status, title, parent, and source path
    And no canonical work record doc is modified by the publish

  Scenario: publishing the same snapshot twice is idempotent
    Given the workspace snapshot has already been published
    When the same workspace snapshot is published again
    Then the projected item count for that workspace is unchanged
    And the item rows have the same refs and source paths
    And the projection metadata records the latest publish time for that workspace

  Scenario: rebuilding a changed workspace removes stale rows
    Given the global projection already contains rows for "34", "34/00", and stale story "34/99"
    And the current workspace snapshot contains only "34" and "34/00"
    When the workspace snapshot is published to the global projection
    Then rows for "34" and "34/00" remain
    And the stale row "34/99" is removed
    And rows belonging to other workspaces are not changed

  Scenario: a torn work record is captured as a projection error without blocking healthy rows
    Given the workspace contains one valid milestone "34"
    And it also contains one malformed story record whose frontmatter cannot be parsed
    When the workspace snapshot is published to the global projection
    Then the valid milestone row is present
    And a projection error row records the malformed story path
    And the publish result reports one skipped record

  Scenario: rebuild can recover from a deleted projection database
    Given the projection database was deleted
    When the global work projection store is opened
    And the workspace snapshot is published
    Then the database is recreated with the current schema
    And the workspace and item rows are present again

@executable @cli @work @distribution
Feature: The projection query API returns global and workspace-scoped work views
  In order for later UI and propagation stories to consume the store through one seam
  the global work projection exposes query functions for global and local scopes
  so that serve faces do not read SQLite tables or workspace files directly.

  Background:
    Given a supported global work projection store contains workspace "alpha" with items "34" and "34/00"
    And it contains workspace "beta" with items "12" and "12/00"
    And both workspaces have projection metadata with lastPublishedAt timestamps

  Scenario: the global query returns workspaces and items across all projected workspaces
    When the global work projection is queried without a workspace filter
    Then the result contains workspaces "alpha" and "beta"
    And the result contains items "34", "34/00", "12", and "12/00"
    And every item includes the workspace id it belongs to
    And the result includes projection freshness metadata for each workspace

  Scenario: the workspace query filters to one workspace
    When the global work projection is queried with workspace "alpha"
    Then the result contains only workspace "alpha"
    And the result contains only items "34" and "34/00"
    And no item from workspace "beta" is returned

  Scenario: querying an unknown workspace returns an empty scoped result
    When the global work projection is queried with workspace "missing"
    Then the result contains no workspaces
    And the result contains no items
    And the result is successful, not an error

  Scenario: projection errors are returned beside healthy rows
    Given workspace "alpha" has one projection error for "broken/STORY.md"
    When the global work projection is queried without a workspace filter
    Then workspace "alpha" still appears
    And the healthy items for workspace "alpha" still appear
    And the result includes the projection error path and message

  Scenario: callers cannot mutate the projection through the query result
    When the global work projection is queried
    And the caller mutates the returned in-memory result object
    And the global work projection is queried again
    Then the stored projection rows are unchanged

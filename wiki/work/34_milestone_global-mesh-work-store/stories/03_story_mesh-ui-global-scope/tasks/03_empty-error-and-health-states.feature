@executable @ui @work @distribution
Feature: Mesh UI reports global store health without blocking local diagnosis
  In order to make global projection failures actionable without losing the current-workspace workflow
  the mesh UI distinguishes empty, loading, projection-error, and local-filter states
  so that operators can diagnose store health and still use `--local` when global state is unavailable.

  Background:
    Given a fixture ui/dist is present

  Scenario: global empty state explains that no mesh-enabled workspace has published yet
    Given serveMeshUi was started with scope "global"
    And the global projection query returns no workspaces, no work items, and no nodes
    When the fleet UI loads `/api/mesh/status`
    Then the UI shows an empty global state
    And the empty state says no mesh-enabled workspaces have published yet
    And the empty state does not call the mesh broken or failed

  Scenario: global projection unavailable surfaces a coded error with the global mesh path
    Given serveMeshUi was started with scope "global"
    And the global projection query fails with code "global-store-unavailable" and path "C:\Users\Umair\.aof\mesh"
    When the browser requests `GET /api/mesh/status`
    Then the response status is 503
    And the response body has code "global-store-unavailable"
    And the response body contains path "C:\Users\Umair\.aof\mesh"
    When the fleet UI renders the error response
    Then the error state includes the global mesh path
    And the retry control keeps scope "global"

  Scenario: local mode remains usable when the global projection is unavailable
    Given serveMeshUi was started with scope "local" and projectDir "C:\repos\alpha"
    And the global projection query would fail if called
    And invoke("mesh:status") returns the local workspace aggregate
    When the browser requests `GET /api/mesh/status`
    Then the response status is 200
    And the response body contains scope "local"
    And the global projection failure is not shown above the local result

  Scenario: health diagnostics expose projection freshness and skipped workspace counts
    Given serveMeshUi was started with scope "global"
    And the global projection query returns projectedAt "2026-07-04T10:05:00.000Z"
    And it returns one skipped workspace with reason "mesh-global-disabled"
    And it returns one descriptor error for "node-b"
    When the fleet UI finishes loading
    Then the diagnostics region shows projection freshness "2026-07-04T10:05:00.000Z"
    And it shows one disabled or skipped workspace
    And it shows one descriptor error without hiding healthy workspaces or nodes


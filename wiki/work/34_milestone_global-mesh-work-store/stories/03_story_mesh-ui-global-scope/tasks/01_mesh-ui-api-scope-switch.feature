@executable @cli @work @distribution
Feature: Mesh UI API switches between global projection reads and local workspace reads
  In order to keep the serve face thin while changing the default data scope
  `/api/mesh/status` selects a global projection query by default and the existing local status query when requested
  so that global UI requests do not scan every workspace and local UI requests preserve current behavior.

  Background:
    Given a fixture ui/dist is present
    And the mesh UI data dependencies are injected

  Scenario: global mode reads the global projection query surface
    Given serveMeshUi was started with scope "global"
    And the global projection query returns two workspaces, three work items, and two nodes
    When the browser requests `GET /api/mesh/status`
    Then the response status is 200
    And the response body contains scope "global"
    And the response body contains the two workspaces, three work items, and two nodes from the global projection
    And loadWorkspace is not called for each projected workspace
    And invoke("mesh:status") is not called for the default global read

  Scenario: local mode keeps the existing `mesh:status` aggregate for the current workspace
    Given serveMeshUi was started with scope "local" and projectDir "C:\repos\alpha"
    And invoke("mesh:status") returns one local node and one local board
    When the browser requests `GET /api/mesh/status`
    Then the response status is 200
    And the response body contains scope "local"
    And the response body contains currentWorkspace path "C:\repos\alpha"
    And the response body contains the local node and board aggregate
    And the global projection query is not called

  Scenario: a local filter can be requested through the API query string for deep links
    Given serveMeshUi was started with scope "global"
    And the current workspace id is "alpha"
    When the browser requests `GET /api/mesh/status?scope=local`
    Then the response body contains scope "local"
    And the local data is filtered to workspace "alpha"
    And the response does not include work items from any other workspace

  Scenario: unsupported scope values are clean API errors
    Given serveMeshUi was started with scope "global"
    When the browser requests `GET /api/mesh/status?scope=workspace`
    Then the response status is 400
    And the response body has code "invalid-scope"
    And no projection query or workspace command is invoked

  Scenario: existing namespace and method isolation remains intact
    Given serveMeshUi was started with scope "global"
    When the browser requests `POST /api/mesh/status`
    Then the response status is 405
    And the Allow header is "GET, HEAD"
    When the browser requests `GET /api/work/items`
    Then the response status is 404
    And no board API is proxied


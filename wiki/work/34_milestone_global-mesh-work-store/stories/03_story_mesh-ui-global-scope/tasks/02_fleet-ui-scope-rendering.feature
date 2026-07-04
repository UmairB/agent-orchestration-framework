@executable @ui @work @design
Feature: The fleet UI renders obvious global and local scope states
  In order to prevent operators from confusing machine-wide work with current-workspace work
  the fleet UI renders scope controls, workspace identity, work aggregates, and node details from the status payload
  so that global and local views are visually distinct and reviewable against the design checklist.

  Background:
    Given the fleet UI is rendered with a controllable fleetApi.status response

  Scenario: global populated state shows machine-wide workspaces, work items, and nodes
    Given fleetApi.status returns scope "global"
    And it returns workspaces "alpha" and "beta"
    And it returns work items "34" in "alpha" and "35/00" in "beta"
    And it returns a control node "node-a" and worker node "node-b"
    When the fleet UI finishes loading
    Then the scope control shows "Global" as active
    And the workspace summary lists "alpha" and "beta"
    And the work items table shows each item with its workspace identity
    And the node panel shows roles, last seen values, capabilities, and fabric addresses when provided

  Scenario: local populated state shows the current workspace identity and filtered data
    Given fleetApi.status returns scope "local"
    And it returns currentWorkspace path "C:\repos\alpha"
    And it returns only workspace "alpha"
    And it returns one local work item and one local node
    When the fleet UI finishes loading
    Then the scope control shows "Local" as active
    And the current workspace path "C:\repos\alpha" is visible
    And no workspace or work item from "beta" is rendered
    And the refresh control keeps the local scope on the next poll

  Scenario: switching scope updates the URL and re-queries without a full page remount
    Given the fleet UI is showing scope "global"
    When the operator chooses the local scope control
    Then the browser URL contains "scope=local"
    And fleetApi.status is called with scope "local"
    And the top-level page shell remains mounted

  Scenario: loading state keeps the required regions stable
    Given fleetApi.status is pending
    When the fleet UI renders
    Then the scope control region is visible
    And placeholders reserve space for workspace summary, work items, node panel, and diagnostics
    And no text overlaps at a 360px wide viewport

  Scenario: the UI does not expose credential-like descriptor fields
    Given fleetApi.status returns a node descriptor with safe fields and a redacted credential marker absent
    When the fleet UI finishes loading
    Then no visible text contains "relayAuth", "token", "secret", or "credential"
    And the node details still show node id, role, host, last seen, and fabric address


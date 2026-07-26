@executable @cli @work @distribution
Feature: Global work propagation is gated by explicit mesh enablement
  In order to avoid silently globalizing ordinary workspaces
  the propagation layer uses one explicit mesh-enabled predicate
  so that only workspaces with config.mesh.enabled true publish to the global work store.

  Background:
    Given a fixture workspace whose config and global projection publisher I control
    And the global publisher records every publish attempt

  Scenario: config.mesh.enabled true enables global propagation
    Given the workspace config contains mesh.enabled true
    When the mesh-enabled predicate is evaluated
    Then the workspace is considered mesh-enabled for global propagation
    And a publish request for that workspace is allowed to reach the global publisher

  Scenario Outline: missing, empty, or false mesh config does not enable propagation
    Given the workspace config is <config>
    When the mesh-enabled predicate is evaluated
    Then the workspace is not considered mesh-enabled for global propagation
    And a publish request for that workspace is skipped before opening the global store
    And no global mesh directory is created

    Examples:
      | config                         |
      | {}                             |
      | { mesh: {} }                   |
      | { mesh: { enabled: false } }   |
      | { mesh: { enabled: "true" } }  |
      | { mesh: { nodeId: "node-a" } } |

  Scenario: fabric or node identity without enabled true is migration guidance, not propagation
    Given the workspace config contains mesh.fabric "tailscale"
    And the hydrated workspace config contains mesh.nodeId "node-a"
    But mesh.enabled is absent
    When the mesh-enabled predicate is evaluated
    Then the workspace is not considered mesh-enabled for global propagation
    And the predicate result carries guidance that the workspace appears mesh-configured but global propagation is disabled
    And no global publish occurs

  Scenario: every propagation caller uses the same predicate result
    Given the workspace config contains mesh.enabled false
    When run-start, run-complete, mesh-issue, and launcher convergence each request a publish
    Then each caller observes the same skipped result code "mesh-global-disabled"
    And the global publisher is not called by any caller

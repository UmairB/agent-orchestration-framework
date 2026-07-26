@executable @cli @work @distribution
Feature: Global node and workspace descriptors redact credentials and volatile secrets
  In order to make global AOF inspectable without leaking mesh credentials
  descriptor materialization copies only safe operator metadata
  so that relay tokens, invite material, environment secrets, and raw config secrets never enter global descriptor files or index rows.

  Background:
    Given a mesh-enabled workspace fixture has projectRoot "C:\repos\alpha"
    And the workspace config contains mesh.relay.controlNode "node-a"
    And the workspace config contains mesh.relayAuth "plaintext-token"
    And the registry contains a roster entry with relayAuthHash "hashed-token"
    And the registry contains a pending invite with codeHash "hashed-code"

  Scenario: node descriptors omit raw credentials and hash material
    When the workspace publishes global node descriptors
    Then no descriptor file under "<global>/mesh/nodes" contains "plaintext-token"
    And no descriptor file under "<global>/mesh/nodes" contains "relayAuth"
    And no descriptor file under "<global>/mesh/nodes" contains "relayAuthHash"
    And no descriptor file under "<global>/mesh/nodes" contains "hashed-code"
    And the node index rows do not contain credential, token, auth, invite, or secret columns populated from workspace config

  Scenario: workspace descriptors include safe mesh posture without copying the raw mesh config
    When the workspace publishes global workspace descriptors
    Then the workspace descriptor contains meshEnabled true
    And the workspace descriptor contains controlNode "node-a"
    And the workspace descriptor does not contain a raw "mesh" object copied from config
    And the workspace descriptor does not contain "plaintext-token"

  Scenario Outline: secret-looking additive fields are dropped from descriptors
    Given the node record for "node-a" contains additive field <field> with value "sensitive"
    When the workspace publishes global node descriptors
    Then the descriptor for "node-a" does not contain field <field>
    And the descriptor for "node-a" still contains safe fields nodeId, host, os, runtimes, skills, aofVersion, and publishedAt

    Examples:
      | field          |
      | token          |
      | secret         |
      | credential     |
      | relayAuth      |
      | relayAuthHash  |
      | accessToken    |

  Scenario: redaction happens before both JSON and SQLite persistence
    Given the node record for "node-a" contains additive field "accessToken" with value "sensitive"
    When the workspace publishes global node descriptors
    Then "<global>/mesh/nodes/node-a.json" does not contain "sensitive"
    And the node row for "node-a" in the projection index does not contain "sensitive"


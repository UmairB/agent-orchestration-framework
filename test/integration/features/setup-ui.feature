Feature: AOF setup UI API
  The setup UI editor API should save and validate configuration through real HTTP requests.

  Scenario: Save a command resource through the setup UI API
    Given a running setup UI server
    When I request setup UI capabilities
    Then HTTP response status should be 200
    And HTTP response field `capabilities.rule.codex` should equal `mapped`
    When I save command resource `prime` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And file `.aof/aof.config.json` should contain `"kind": "command"`
    And file `.aof/aof.config.json` should contain `"path": "assets/commands/prime/COMMAND.md"`

  Scenario: Save expanded config sections through the setup UI API
    Given a running setup UI server
    When I save expanded sections through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And file `.aof/aof.config.json` should contain `"mcpServers"`
    And file `.aof/aof.config.json` should contain `"approval_policy": "on-request"`

  Scenario: Reject invalid expanded setup UI sections
    Given a running setup UI server
    When I save invalid expanded sections through the setup UI API
    Then HTTP response status should be 400
    And HTTP response field `ok` should equal `false`
    And HTTP response diagnostics should include path `settings`

  Scenario: Reject malformed JSON and route payload mismatches
    Given a running setup UI server
    When I PUT malformed JSON to `/api/config/resources/command/prime`
    Then HTTP response status should be 400
    And HTTP response field `code` should equal `malformed-json`
    When I save a mismatched resource through the setup UI API
    Then HTTP response status should be 400
    And HTTP response field `code` should equal `route-payload-mismatch`
    When I save an unsupported resource kind through the setup UI API
    Then HTTP response status should be 400
    And HTTP response field `code` should equal `invalid-kind`

  Scenario: Serve adapter warning review payloads
    Given a running setup UI server
    When I save adapter warning sections through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `config.adapterWarnings.0.code` should equal `adapter.skipped-runtime-output`
    When I request setup UI config
    Then HTTP response status should be 200
    And HTTP response field `adapterWarnings.0.runtime` should equal `codex`

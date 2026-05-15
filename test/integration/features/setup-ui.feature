Feature: AOF setup UI API
  The setup UI editor API should save and validate configuration through real HTTP requests.

  Scenario: Save a command resource through the setup UI API
    Given a running setup UI server
    When I request setup UI capabilities
    Then HTTP response status should be 200
    And HTTP response field `capabilities.command.codex` should equal `unsupported-fail`
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

  Scenario: Save workflow-backed resource through the setup UI API
    Given a running setup UI server
    When I save workflow-backed setup UI resource
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And file `.aof/aof.config.json` should contain `"workflow": "audit"`
    And file `.aof/aof.config.json` should contain `"argumentHint": "<milestone>"`
    And file `.aof/aof.config.json` should not contain `"path": "assets/skills/audit/SKILL.md"`

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

  Scenario: Load project and global setup UI scopes
    Given a running setup UI server
    When I request setup UI project config
    Then HTTP response status should be 200
    And HTTP response field `scope` should equal `project`
    When I request setup UI global config
    Then HTTP response status should be 200
    And HTTP response field `scope` should equal `global`

  Scenario: Create global assets through the setup UI API
    Given a running setup UI server
    When I save global skill `research-helper` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And global file `aof.config.json` should contain `"kind": "skill"`
    And global file `assets/skills/research-helper/SKILL.md` should contain `Use the helper script.`
    And file `.aof/assets/skills/research-helper/SKILL.md` should not exist
    When I save global rule `team-standards` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And global file `assets/rules/team-standards/RULE.md` should contain `Follow team standards.`

  Scenario: Edit global skill associated files through the setup UI API
    Given a running setup UI server
    When I save global skill `research-helper` with helper file through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And global file `assets/skills/research-helper/files/search.py` should contain `print('search')`
    And global file `aof.config.json` should contain `"files"`
    When I save global skill `unsafe-helper` with unsafe helper file through the setup UI API
    Then HTTP response status should be 400
    And HTTP response diagnostics should include code `associated-file-escape`

  Scenario: Add and remove project global references through the setup UI API
    Given a running setup UI server
    When I save global skill `shared-review` through the setup UI API
    Then HTTP response status should be 200
    When I add global skill `shared-review` to the project through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `ok` should equal `true`
    And file `.aof/aof.config.json` should contain `"globalRefs"`
    And file `.aof/assets/skills/shared-review/SKILL.md` should not exist
    When I request setup UI project config
    Then HTTP response status should be 200
    And HTTP response field `referencedResources.0.source` should equal `global`
    And HTTP response field `referencedResources.0.readOnly` should equal `true`
    When I request setup UI global config
    Then HTTP response status should be 200
    And HTTP response field `resources.0.referencedByProject` should equal `true`
    When I remove global skill `shared-review` from the project through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `globalRefs.length` should equal `0`

  Scenario: Manage a board task through the setup UI API
    Given a running setup UI server
    When I save agent resource `builder` through the setup UI API
    Then HTTP response status should be 200
    When I create board `delivery` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `board.id` should equal `delivery`
    When I create task `phase-31` on board `delivery` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `task.status` should equal `ready`
    When I edit task `phase-31` on board `delivery` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `task.title` should equal `Phase 31 UI`
    When I assign task `phase-31` on board `delivery` to agent `builder` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `execution.status` should equal `running`
    When I mark task `phase-31` on board `delivery` execution `complete` through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `task.status` should equal `done`
    When I request board validation through the setup UI API
    Then HTTP response status should be 200
    And HTTP response field `valid` should equal `true`
    And HTTP response field `warnings` should equal `1`

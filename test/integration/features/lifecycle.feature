Feature: AOF CLI lifecycle
  User-facing lifecycle commands should stay stable across refactors.

  Scenario: Show command help
    Given an empty project
    When I run `--help`
    Then the command should succeed
    And stdout should contain `aof - Assistant Ops Framework`
    And stdout should contain `aof init [dir] [--claude] [--codex] [--force]`
    And stdout should contain `aof add [kind id]`
    And stdout should contain `aof migrate`
    And text `aof validate [--json] [--strict]` should appear before `aof install [--no-serve]` in stdout

  Scenario: Install AOF without starting the setup UI
    Given an empty project
    When I run `install --no-serve`
    Then the command should succeed
    And stdout should contain `Setup UI not started.`

  Scenario: Initialize an empty AOF project
    Given an empty project
    When I run `init --codex`
    Then the command should succeed
    And file `.aof/aof.config.json` should exist
    And file `.aof/aof.config.json` should contain `"https://aof.local/schemas/aof.schema.json"`
    And file `.aof/aof.config.json` should contain `"resources": []`
    And file `.codex/skills/project-context/SKILL.md` should not exist
    And file `.codex/commands/prime.md` should not exist
    And JSON file `.aof/aof.lock.json` should contain runtime `codex`

  Scenario: Guided init can create an explicit project asset
    Given an empty project
    When I run `init --codex` with input `unused|unused|yes|no|no` and resource input `{"kind":"agent","id":"research-agent","description":"Research agent","runtimes":["codex"],"body":"Research the repository."}`
    Then the command should succeed
    And stdout should contain `Next steps:`
    And stdout should contain `Created`
    And file `.aof/assets/agents/research-agent/AGENT.md` should contain `Research the repository.`
    And file `.aof/aof.config.json` should contain `"id": "research-agent"`
    And file `.aof/aof.config.json` should contain `"kind": "agent"`

  Scenario: Refuse to overwrite an existing project config
    Given a project initialized with AOF config
    When I run `init --codex`
    Then the command should fail
    And stderr should contain `Config already exists`

  Scenario: Add a file-backed skill from the CLI
    Given an empty project
    When I run `add skill code-review --codex --description "Review code changes"`
    Then the command should succeed
    And stdout should contain `Created`
    And file `.aof/aof.config.json` should exist
    And file `.aof/aof.config.json` should contain `"id": "code-review"`
    And file `.aof/aof.config.json` should contain `"path": "assets/skills/code-review/SKILL.md"`
    And file `.aof/assets/skills/code-review/SKILL.md` should exist
    And file `.aof/assets/skills/code-review/SKILL.md` should contain `Review code changes`

  Scenario: Add refuses scaffold collisions unless forced
    Given an empty project
    When I run `add skill code-review --codex`
    Then the command should succeed
    When I run `add skill code-review --codex`
    Then the command should fail
    And stderr should contain `Resource already exists`
    When I run `add skill code-review --codex --force --description "Forced replacement"`
    Then the command should succeed
    And file `.aof/assets/skills/code-review/SKILL.md` should contain `Forced replacement`

  Scenario: Add scaffolds non-skill kinds
    Given an empty project
    When I run `add rule infra-files --runtime codex --description "Infrastructure guidance"`
    Then the command should succeed
    And file `.aof/assets/rules/infra-files/RULE.md` should exist
    And file `.aof/aof.config.json` should contain `"kind": "rule"`
    And file `.aof/aof.config.json` should contain `"codex"`

  Scenario: Interactively add a project asset
    Given an empty project
    When I run `add` with resource input `{"kind":"skill","id":"interactive-skill","description":"Interactive skill","runtimes":["codex"],"body":"Interactive body"}`
    Then the command should succeed
    And stdout should contain `Created`
    And file `.aof/assets/skills/interactive-skill/SKILL.md` should contain `Interactive body`
    And file `.aof/aof.config.json` should contain `"id": "interactive-skill"`
    And file `.aof/aof.config.json` should contain `"codex"`

  Scenario: Add and inspect global assets
    Given an empty project
    When I run `global add skill shared-review --codex --description "Shared reviewer"`
    Then the command should succeed
    And stdout should contain `Created`
    And global file `aof.config.json` should contain `"id": "shared-review"`
    And global file `assets/skills/shared-review/SKILL.md` should exist
    And global file `assets/skills/shared-review/SKILL.md` should contain `Shared reviewer`
    And file `.aof/aof.config.json` should not exist
    When I run `global list`
    Then the command should succeed
    And stdout should contain `skill:shared-review`
    When I run `global show skill shared-review`
    Then the command should succeed
    And stdout should contain `resource: skill:shared-review`
    And stdout should contain `body: present`

  Scenario: Interactively add a global asset
    Given an empty project
    When I run `global add` with resource input `{"kind":"rule","id":"interactive-rule","description":"Interactive rule","runtimes":["codex"],"body":"Interactive global body"}`
    Then the command should succeed
    And stdout should contain `Created`
    And global file `assets/rules/interactive-rule/RULE.md` should contain `Interactive global body`
    And global file `aof.config.json` should contain `"id": "interactive-rule"`
    And global file `aof.config.json` should contain `"codex"`

  Scenario: Validate global assets
    Given an empty project
    When I run `global add rule shared-rule --codex --description "Shared rule"`
    Then the command should succeed
    When I run `global validate`
    Then the command should succeed
    And stdout should contain `valid: global config passed validation`

  Scenario: Report malformed global asset config
    Given a malformed global AOF config
    When I run `global validate`
    Then the command should fail
    And stdout should contain `invalid:`
    And stdout should contain `Invalid JSON`
    When I run `validate`
    Then the command should fail
    And stdout should contain `Cannot read config`

  Scenario: Render referenced global assets
    Given a project with referenced global assets
    When I run `apply --codex`
    Then the command should succeed
    And file `.codex/skills/shared-review/SKILL.md` should exist
    And file `.codex/skills/shared-review/SKILL.md` should contain `Codex global override body`
    And file `.codex/AGENTS.md` should exist
    And file `.codex/AGENTS.md` should contain `Follow team standards`
    And file `.aof/assets/skills/shared-review/SKILL.md` should not exist
    And JSON file `.aof/aof.lock.json` should contain global resource `shared-review`
    When I run `config show`
    Then the command should succeed
    And stdout should contain `globalRefs: 2`
    And stdout should contain `source=global`

  Scenario: Sync referenced global assets
    Given a project with referenced global assets
    When I run `sync --codex --dry-run`
    Then the command should succeed
    And stdout should contain `create:`
    And file `.codex/skills/shared-review/SKILL.md` should not exist
    When I run `sync --codex`
    Then the command should succeed
    And file `.codex/skills/shared-review/SKILL.md` should exist
    And JSON file `.aof/aof.lock.json` should contain global resource `shared-review`

  Scenario: Render referenced global skill helper files
    Given a project with referenced global skill helper files
    When I run `apply --codex`
    Then the command should succeed
    And file `.codex/skills/research-helper/scripts/search.py` should exist
    And file `.codex/skills/research-helper/scripts/search.py` should contain `print('search')`
    And file `.aof/assets/skills/research-helper/scripts/search.py` should not exist
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/skills/research-helper/scripts/search.py`
    And JSON file `.aof/aof.lock.json` should contain global resource `research-helper`

  Scenario: Preview referenced global skill helper files
    Given a project with referenced global skill helper files
    When I run `sync --codex --dry-run`
    Then the command should succeed
    And stdout should contain `.codex`
    And stdout should contain `scripts`
    And file `.codex/skills/research-helper/scripts/search.py` should not exist

  Scenario: Report unsafe global skill helper files
    Given a project with unsafe global skill helper files
    When I run `validate`
    Then the command should fail
    And stdout should contain `Associated file path must stay inside the asset directory`

  Scenario: Report invalid global references
    Given a project with a missing global reference
    When I run `validate`
    Then the command should fail
    And stdout should contain `Missing global resource: skill:missing-shared`
    Given a project with a local and global asset conflict
    When I run `validate`
    Then the command should fail
    And stdout should contain `Global reference conflicts with local resource skill:shared-review`

  Scenario: Refuse to silently migrate a legacy root config during init
    Given a project initialized with legacy AOF config
    When I run `init --codex`
    Then the command should fail
    And stderr should contain `aof migrate`

  Scenario: Explicitly migrate a legacy root config into .aof
    Given a project initialized with legacy AOF config
    When I run `migrate`
    Then the command should succeed
    And stdout should contain `.aof`
    And stdout should contain `is now authoritative`
    And file `aof.config.json` should exist
    And file `.aof/aof.config.json` should exist
    And file `.aof/assets/skills/project-context/SKILL.md` should exist
    And file `.aof/assets/commands/prime/COMMAND.md` should exist
    And JSON file `.aof/aof.lock.json` should contain item `project-context`
    And JSON file `.aof/aof.lock.json` should contain item `prime`

  Scenario: Preview apply without writing runtime files or lock state
    Given a project with .aof file-backed config
    When I run `apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `create:`
    And stdout should contain `lock-preview:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Protect drifted generated files unless forced
    Given a project with .aof file-backed config
    When I run `apply --codex`
    Then the command should succeed
    When I replace file `.codex/skills/file-backed/SKILL.md` with `Manual edit`
    And I run `apply --codex`
    Then the command should succeed
    And stdout should contain `drift-warning`
    And file `.codex/skills/file-backed/SKILL.md` should contain `Manual edit`
    When I run `apply --codex --force`
    Then the command should succeed
    And file `.codex/skills/file-backed/SKILL.md` should contain `File-backed body`

  Scenario: Prune stale owned generated files
    Given a project with .aof file-backed config
    When I run `apply --codex`
    Then the command should succeed
    When the .aof config has no resources
    And I run `apply --codex`
    Then the command should succeed
    And stdout should contain `delete:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist

  Scenario: Show config inspection in human and JSON formats
    Given a project with .aof package config
    When I run `config show`
    Then the command should succeed
    And stdout should contain `config:`
    And stdout should contain `skill:file-backed`
    And stdout should contain `packages: 1`
    When I run `config show --json`
    Then the command should succeed
    And stdout should contain `"packages"`
    And stdout should contain `"gsd"`

  Scenario: Validate invalid config for automation
    Given a project with invalid .aof config
    When I run `validate`
    Then the command should fail
    And stdout should contain `invalid:`
    When I run `config validate --json`
    Then the command should fail
    And stdout should contain `"valid": false`
    And stdout should contain `Unsupported runtime`
    When I run `validate --json`
    Then the command should fail
    And stdout should contain `"valid": false`
    And stdout should contain `"errors"`

  Scenario: Doctor reports package intent and stale legacy config
    Given a project with .aof package config and stale legacy config
    When I run `doctor`
    Then the command should succeed
    And stdout should contain `package-intent`
    And stdout should contain `legacy-config`
    When I run `config doctor`
    Then the command should succeed
    And stdout should contain `package-intent`
    And stdout should contain `legacy-config`
    And stdout should contain `aof install gsd --dry-run`
    When I run `doctor --strict`
    Then the command should fail
    And stdout should contain `warning: legacy-config`

  Scenario: Clean previews and removes matching lock-owned outputs
    Given a project with .aof file-backed config
    When I run `apply --codex`
    Then the command should succeed
    When I run `clean --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no generated files`
    And stdout should contain `delete:`
    And file `.codex/skills/file-backed/SKILL.md` should exist
    When I run `clean`
    Then the command should succeed
    And stdout should contain `delete:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And JSON file `.aof/aof.lock.json` should not contain generated file `.codex/skills/file-backed/SKILL.md`

  Scenario: Clean preserves drifted lock-owned outputs
    Given a project with .aof file-backed config
    When I run `apply --codex`
    Then the command should succeed
    When I replace file `.codex/skills/file-backed/SKILL.md` with `Manual edit`
    And I run `clean`
    Then the command should succeed
    And stdout should contain `drift-warning`
    And file `.codex/skills/file-backed/SKILL.md` should contain `Manual edit`
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/skills/file-backed/SKILL.md`

  Scenario: Catalog storage is disabled
    Given an empty project
    When I run `catalog list`
    Then the command should fail
    And stderr should contain `Catalog storage is currently disabled`

  Scenario: Reject catalog-backed init items
    Given an empty project
    When I run `init --items project-context,prime --codex`
    Then the command should fail
    And stderr should contain `Catalog-backed init items are not available yet`

  Scenario: Interactive install is pending redesign
    Given an empty project
    When I run `install --interactive` with input `project-context,gsd|codex|yes|no|no`
    Then the command should fail
    And stderr should contain `Interactive project setup is being redesigned`

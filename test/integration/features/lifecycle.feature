Feature: AOF CLI lifecycle
  User-facing lifecycle commands should stay stable across refactors.

  Scenario: Show command help
    Given an empty project
    When I run `--help`
    Then the command should succeed
    And stdout should contain `aof - Assistant Ops Framework`
    And stdout should contain `aof init [dir] [--items id,id] [--defaults]`
    And stdout should contain `aof add <kind> <id>`
    And stdout should contain `aof migrate`
    And text `aof validate [--json] [--strict]` should appear before `aof install [--no-serve]` in stdout

  Scenario: Install AOF and create the catalog database
    Given an empty project
    When I run `install --no-serve`
    Then the command should succeed
    And stdout should contain `AOF catalog ready at`
    And stdout should contain `Setup UI not started.`
    And data file `aof.sqlite` should exist

  Scenario: Initialize a repository from selected catalog items
    Given an empty project
    When I run `init --items project-context,prime --codex`
    Then the command should succeed
    And file `.aof/aof.config.json` should exist
    And file `.aof/aof.config.json` should contain `"items"`
    And file `.aof/aof.config.json` should contain `"project-context"`
    And file `.aof/assets/skills/project-context/SKILL.md` should exist
    And file `.aof/assets/commands/prime/COMMAND.md` should exist
    And file `.codex/skills/project-context/SKILL.md` should exist
    And file `.codex/commands/prime.md` should exist
    And file `.claude/commands/prime.md` should not exist
    And JSON file `.aof/aof.lock.json` should contain item `project-context`
    And JSON file `.aof/aof.lock.json` should contain item `prime`
    And JSON file `.aof/aof.lock.json` should contain runtime `codex`

  Scenario: Refuse to overwrite an existing project config
    Given a project initialized with AOF config
    When I run `init --items project-context --codex`
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

  Scenario: Refuse to silently migrate a legacy root config during init
    Given a project initialized with legacy AOF config
    When I run `init --items project-context --codex`
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

  Scenario: List the catalog database
    Given an empty project
    When I run `catalog init`
    Then the command should succeed
    And stdout should contain `Initialized catalog at`
    And data file `aof.sqlite` should exist
    When I run `catalog list`
    Then the command should succeed
    And stdout should contain `project-context`
    And stdout should contain `prime`
    And stdout should contain `gsd`

  Scenario: Initialize default catalog items
    Given an empty project
    When I run `init --defaults --codex`
    Then the command should succeed
    And data file `aof.sqlite` should exist
    And file `.codex/skills/project-context/SKILL.md` should exist
    And file `.codex/commands/prime.md` should exist
    And file `.codex/agents/code-reviewer.md` should not exist
    And JSON file `.aof/aof.lock.json` should contain item `project-context`
    And JSON file `.aof/aof.lock.json` should contain item `prime`
    And JSON file `.aof/aof.lock.json` should not contain item `code-reviewer`
    And JSON file `.aof/aof.lock.json` should contain runtime `codex`

  Scenario: Initialize selected catalog items into Codex
    Given an empty project
    When I run `init --items project-context,prime --codex`
    Then the command should succeed
    And file `.codex/skills/project-context/SKILL.md` should exist
    And file `.codex/commands/prime.md` should exist
    And file `.claude/commands/prime.md` should not exist
    And JSON file `.aof/aof.lock.json` should contain item `project-context`
    And JSON file `.aof/aof.lock.json` should contain item `prime`

  Scenario: Preview selected catalog installs without writing files
    Given an empty project
    When I run `init --items project-context,prime --codex --dry-run`
    Then the command should succeed
    And stdout should contain `.codex`
    And file `.aof/aof.config.json` should not exist
    And file `.codex/skills/project-context/SKILL.md` should not exist
    And file `.codex/commands/prime.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Interactively select catalog items
    Given an empty project
    When I run `init --select --codex` with input `project-context, code-reviewer`
    Then the command should succeed
    And stdout should contain `Install which items?`
    And file `.codex/skills/project-context/SKILL.md` should exist
    And file `.codex/agents/code-reviewer.md` should exist
    And file `.codex/commands/prime.md` should not exist

  Scenario: Guided interactive install asks before side effects
    Given an empty project
    When I run `install --interactive` with input `project-context,gsd|codex|yes|no|no`
    Then the command should succeed
    And stdout should contain `interactive: proposed .aof config follows`
    And file `.aof/aof.config.json` should exist
    And file `.codex/skills/project-context/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

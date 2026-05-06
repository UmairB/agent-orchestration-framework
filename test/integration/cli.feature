Feature: AOF CLI
  The CLI should behave consistently from the outside so the implementation can
  be changed without changing user-facing behavior.

  Scenario: Show command help
    Given an empty project
    When I run `--help`
    Then the command should succeed
    And stdout should contain `aof - Assistant Ops Framework`
    And stdout should contain `aof install [--no-serve]`
    And stdout should contain `aof init [dir] [--items id,id] [--defaults]`
    And stdout should contain `aof migrate`

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

  Scenario: Apply the project config to Codex only
    Given a project initialized with legacy AOF config
    When I run `apply --codex`
    Then the command should succeed
    And file `.codex/skills/project-context/SKILL.md` should exist
    And file `.codex/commands/prime.md` should exist
    And file `.codex/agents/code-reviewer.md` should exist
    And file `.claude/commands/prime.md` should not exist

  Scenario: Apply file-backed .aof assets
    Given a project with .aof file-backed config
    When I run `apply --codex`
    Then the command should succeed
    And file `.codex/skills/file-backed/SKILL.md` should exist
    And file `.codex/skills/file-backed/SKILL.md` should contain `File-backed body`

  Scenario: Apply runtime override for a file-backed asset
    Given a project with .aof runtime override config
    When I run `apply --codex`
    Then the command should succeed
    And file `.codex/skills/overridden/SKILL.md` should exist
    And file `.codex/skills/overridden/SKILL.md` should contain `Codex override body`

  Scenario: Reject runtime override identity changes
    Given a project with .aof invalid identity override config
    When I run `apply --codex`
    Then the command should fail
    And stderr should contain `cannot change identity field`

  Scenario: Render natural-language rule guidance per runtime
    Given a project with .aof rule config
    When I run `apply`
    Then the command should succeed
    And file `.claude/rules/project-rule.md` should exist
    And file `.claude/rules/project-rule.md` should contain `paths: src`
    And file `.codex/src/AGENTS.md` should exist
    And file `.codex/src/AGENTS.md` should contain `Use scoped guidance`
    And file `.codex/rules/project-rule.rules` should not exist

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

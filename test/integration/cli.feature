Feature: AOF CLI
  The CLI should behave consistently from the outside so the implementation can
  be changed without changing user-facing behavior.

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
    And stdout should contain `create:`
    And file `.codex/skills/file-backed/SKILL.md` should exist
    And file `.codex/skills/file-backed/SKILL.md` should contain `File-backed body`
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/skills/file-backed/SKILL.md`

  Scenario: Preview apply without writing runtime files or lock state
    Given a project with .aof file-backed config
    When I run `apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `create:`
    And stdout should contain `lock-preview:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

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

  Scenario: Merge multiple Codex rules into one AGENTS file
    Given a project with .aof multiple codex rules config
    When I run `apply --codex`
    Then the command should succeed
    And file `.codex/AGENTS.md` should exist
    And file `.codex/AGENTS.md` should contain `## alpha`
    And file `.codex/AGENTS.md` should contain `## zeta`
    And text `## alpha` should appear before `## zeta` in file `.codex/AGENTS.md`

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

  Scenario: Record managed framework intent in apply lock state
    Given a project with .aof package config
    When I run `apply --codex`
    Then the command should succeed
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain framework `gsd`
    And stdout should not contain `npx get-shit-done-cc`

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

  Scenario: Preview config-declared GSD installer commands
    Given a project with .aof package config
    When I run `install gsd --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no network`
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`
    And file `.aof/aof.lock.json` should not exist

  Scenario: Record successful GSD install attempts without real npm in tests
    Given a project with .aof package config
    When I run `install gsd` with framework statuses `codex=0`
    Then the command should succeed
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `codex` with status `success`
    When I run `install gsd --dry-run`
    Then the command should succeed
    And stdout should contain `skip:`

  Scenario: Record partial GSD install failure and retry commands
    Given a project with multi-runtime .aof package config
    When I run `install gsd` with framework statuses `claude=0,codex=1`
    Then the command should fail
    And stdout should contain `retry: npx get-shit-done-cc@latest --codex --local`
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `claude` with status `success`
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `codex` with status `failed`

  Scenario: Preview framework install replay from lock
    Given a project with .aof package config
    When I run `apply --codex`
    Then the command should succeed
    When I run `install --from-lock --dry-run`
    Then the command should succeed
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`

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

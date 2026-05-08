Feature: AOF package semantics
  Package declarations, lock metadata, and installers should be explicit and safe.

  Scenario: Record managed framework intent in apply lock state
    Given a project with .aof package config
    When I run `apply --codex`
    Then the command should succeed
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain framework `gsd`
    And JSON file `.aof/aof.lock.json` should contain package `gsd`
    And stdout should not contain `npx get-shit-done-cc`

  Scenario: Refuse package resource output conflicts before writes
    Given a project with package resource collision
    When I run `apply --codex`
    Then the command should fail
    And stderr should contain `Generated output conflict`
    And file `.codex/skills/vendor-context/SKILL.md` should not exist

  Scenario: Validate npm git and file package descriptors
    Given a project with npm git and file package descriptors
    When I run `validate`
    Then the command should succeed
    And stdout should contain `valid: config passed validation`

  Scenario: Record package dependency and resolution metadata in lock
    Given a project with npm git and file package descriptors
    When I run `apply --codex`
    Then the command should succeed
    And JSON file `.aof/aof.lock.json` should contain package `npm-pack`
    And JSON file `.aof/aof.lock.json` should contain package `git-pack`
    And JSON file `.aof/aof.lock.json` should contain package `file-pack`
    And JSON file `.aof/aof.lock.json` package `file-pack` should record dependency `git-pack`
    And JSON file `.aof/aof.lock.json` package `npm-pack` should have resolution status `requested`
    And JSON file `.aof/aof.lock.json` package `git-pack` should have resolution status `requested`
    And JSON file `.aof/aof.lock.json` package `file-pack` should have resolution status `local`

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

  Scenario: Sync previews packages and generated outputs without writes
    Given a project with .aof package config
    When I run `sync --codex --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no files`
    And stdout should contain `create:`
    And stdout should contain `lock-preview:`
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Sync applies outputs without running installers by default
    Given a project with .aof package config
    When I run `sync --codex`
    Then the command should succeed
    And stdout should contain `network: disabled`
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`
    And stdout should not contain `network-boundary`
    And file `.codex/skills/file-backed/SKILL.md` should exist
    And JSON file `.aof/aof.lock.json` should contain framework `gsd`

  Scenario: Sync can explicitly run package installers
    Given a project with .aof package config
    When I run `sync --codex --install` with framework statuses `codex=0`
    Then the command should succeed
    And stdout should contain `network-boundary: running`
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `codex` with status `success`

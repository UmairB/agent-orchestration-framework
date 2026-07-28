Feature: AOF package semantics
  Package declarations, lock metadata, and installers should be explicit and safe.

  Scenario: Packages add GSD records intent only
    Given a project initialized with AOF config
    When I run `packages add gsd --codex`
    Then the command should succeed
    And stdout should contain `Updated`
    And stdout should contain `aof packages install gsd --dry-run`
    And stdout should not contain `network-boundary`
    And stdout should not contain `npx`
    And file `.aof/aof.config.json` should contain `"id": "gsd"`
    And file `.aof/aof.config.json` should contain `"npm:get-shit-done-cc@latest"`
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should not contain framework install attempt `codex`

  Scenario: Packages add dry-run does not write package intent
    Given a project initialized with AOF config
    When I run `packages add gsd --codex --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no config changes`
    And stdout should not contain `network-boundary`
    And file `.aof/aof.config.json` should not contain `npm:get-shit-done-cc`

  Scenario: Packages list show validate and remove GSD intent
    Given a project initialized with AOF config
    When I run `packages add gsd --codex`
    Then the command should succeed
    When I run `packages list`
    Then the command should succeed
    And stdout should contain `packages: 1`
    And stdout should contain `gsd`
    When I run `packages show gsd`
    Then the command should succeed
    And stdout should contain `package: gsd`
    And stdout should contain `source: npm:get-shit-done-cc@latest`
    When I run `packages validate`
    Then the command should succeed
    And stdout should contain `valid: packages passed validation`
    When I run `packages remove gsd --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run`
    And file `.aof/aof.config.json` should contain `"id": "gsd"`
    When I run `packages remove gsd`
    Then the command should succeed
    And stdout should contain `Removed package intent gsd`
    And file `.aof/aof.config.json` should not contain `"id": "gsd"`

  Scenario: Packages validate reports malformed package descriptors
    Given a project with invalid .aof config
    When I run `packages validate`
    Then the command should fail
    And stdout should contain `invalid:`
    And stdout should contain `packages`

  Scenario: Record managed framework intent in apply lock state
    Given a project with .aof package config
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain framework `gsd`
    And JSON file `.aof/aof.lock.json` should contain package `gsd`
    And stdout should not contain `npx get-shit-done-cc`

  Scenario: Refuse package resource output conflicts before writes
    Given a project with package resource collision
    When I run `assets apply --codex`
    Then the command should fail
    And stderr should contain `Generated output conflict`
    And file `.codex/skills/vendor-context/SKILL.md` should not exist

  Scenario: Validate npm git and file package descriptors
    Given a project with npm git and file package descriptors
    When I run `project validate`
    Then the command should succeed
    And stdout should contain `valid: config passed validation`

  Scenario: Record package dependency and resolution metadata in lock
    Given a project with npm git and file package descriptors
    When I run `assets apply --codex`
    Then the command should succeed
    And JSON file `.aof/aof.lock.json` should contain package `npm-pack`
    And JSON file `.aof/aof.lock.json` should contain package `git-pack`
    And JSON file `.aof/aof.lock.json` should contain package `file-pack`
    And JSON file `.aof/aof.lock.json` package `file-pack` should record dependency `git-pack`
    And JSON file `.aof/aof.lock.json` package `npm-pack` should have resolution status `requested`
    And JSON file `.aof/aof.lock.json` package `git-pack` should have resolution status `requested`
    And JSON file `.aof/aof.lock.json` package `file-pack` should have resolution status `local`

  Scenario: Packages install GSD dry-run previews without network
    Given a project with .aof package config
    When I run `packages install gsd --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no network`
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`
    And file `.aof/aof.lock.json` should not exist

  Scenario: Packages install all configured installable packages
    Given a project with .aof package config
    When I run `packages install --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no network`
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`
    And file `.aof/aof.lock.json` should not exist

  Scenario: Packages install records successful GSD install attempts
    Given a project with .aof package config
    When I run `packages install gsd` with framework statuses `codex=0`
    Then the command should succeed
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `codex` with status `success`
    When I run `packages install gsd --dry-run`
    Then the command should succeed
    And stdout should contain `skip:`

  Scenario: Packages install records partial GSD failure and retry commands
    Given a project with multi-runtime .aof package config
    When I run `packages install gsd` with framework statuses `claude=0,codex=1`
    Then the command should fail
    And stdout should contain `network-boundary: running`
    And stdout should contain `retry: npx get-shit-done-cc@latest --codex --local`
    And stdout should contain `Framework install failed for codex.`
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `claude` with status `success`
    And JSON file `.aof/aof.lock.json` should contain framework install attempt `codex` with status `failed`

  Scenario: Packages install refuses unknown packages with a structured JSON error
    Given a project with .aof package config
    When I run `packages install nope --json`
    Then the command should fail
    And stdout should contain `"ok": false`
    And stdout should contain `does not have installer support yet`

  Scenario: Packages install from lock requires a lock file
    Given a project with .aof package config
    When I run `packages install --from-lock --dry-run`
    Then the command should fail
    And stderr should contain `No lock file found`

  Scenario: Packages install replays framework install intent from lock
    Given a project with .aof package config
    When I run `assets apply --codex`
    Then the command should succeed
    When I run `packages install --from-lock --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no network`
    And stdout should contain `npx get-shit-done-cc@latest --codex --local`

  Scenario: Removed top-level package install command points to packages namespace
    Given a project with .aof package config
    When I run `install gsd --dry-run`
    Then the command should fail
    And stderr should contain `Removed command "install"`
    And stderr should contain `aof packages install gsd`
    And file `.aof/aof.lock.json` should not exist

  Scenario: Removed top-level package replay command points to packages namespace
    Given a project with .aof package config
    When I run `assets apply --codex`
    Then the command should succeed
    When I run `install --from-lock --dry-run`
    Then the command should fail
    And stderr should contain `Removed command "install"`
    And stderr should contain `aof packages install gsd`

  Scenario: Assets apply previews package intent and generated outputs without writes
    Given a project with .aof package config
    When I run `assets apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no files`
    And stdout should contain `Would create`
    And stdout should contain `Would update .aof/aof.lock.json`
    And stdout should not contain `npx get-shit-done-cc@latest --codex --local`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Assets apply writes outputs and package lock metadata without running installers
    Given a project with .aof package config
    When I run `assets apply --codex`
    Then the command should succeed
    And stdout should not contain `network: disabled`
    And stdout should not contain `npx get-shit-done-cc@latest --codex --local`
    And stdout should not contain `network-boundary`
    And file `.codex/skills/file-backed/SKILL.md` should exist
    And JSON file `.aof/aof.lock.json` should contain framework `gsd`

  Scenario: Removed sync installer command fails without executing installers
    Given a project with .aof package config
    When I run `sync --codex --install` with framework statuses `codex=0`
    Then the command should fail
    And stderr should contain `Removed command "sync"`
    And stderr should contain `aof packages install`
    And file `.aof/aof.lock.json` should not exist

  Scenario: Assets apply rejects package installer execution
    Given a project with .aof package config
    When I run `assets apply --codex --install` with framework statuses `codex=0`
    Then the command should fail
    And stderr should contain `aof assets apply does not run package installers`
    And stderr should contain `aof packages install`
    And file `.aof/aof.lock.json` should not exist

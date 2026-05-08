Feature: AOF adapter policy
  Degradation warnings and strict mode should be explicit before side effects.

  Scenario: Adapter warnings appear in diagnostics and render previews
    Given a project with adapter warning .aof config
    When I run `validate --json`
    Then the command should succeed
    And stdout should contain `"adapterWarnings"`
    And stdout should contain `adapter.skipped-runtime-output`
    When I run `apply --dry-run`
    Then the command should succeed
    And stdout should contain `adapter-warnings:`
    And text `adapter-warnings:` should appear before `create:` in stdout
    When I run `sync --dry-run`
    Then the command should succeed
    And stdout should contain `adapter-warnings:`
    And text `adapter-warnings:` should appear before `create:` in stdout
    When I run `apply --dry-run --json`
    Then the command should succeed
    And stdout should contain `"adapterWarnings"`
    And stdout should contain `"actions"`

  Scenario: Strict adapter warnings fail before side effects
    Given a project with adapter warning .aof config
    When I run `doctor --strict`
    Then the command should fail
    And stdout should contain `adapter-degradation`
    When I run `apply --strict`
    Then the command should fail
    And stdout should contain `strict:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist
    When I run `sync --strict --force`
    Then the command should fail
    And stdout should contain `strict:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Adapter warnings stay out of lock manifests
    Given a project with adapter warning .aof config
    When I run `apply --codex`
    Then the command should succeed
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should not contain adapter warning `adapter.skipped-runtime-output`

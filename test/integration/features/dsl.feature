Feature: AOF DSL rendering
  Config primitives should render consistently across Claude Code and Codex targets.

  Scenario: Apply the project config to Codex only
    Given a project initialized with legacy AOF config
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.codex/skills/project-context/SKILL.md` should exist
    And file `.codex/commands/prime.md` should not exist
    And file `.codex/agents/code-reviewer.md` should exist
    And file `.claude/commands/prime.md` should not exist

  Scenario: Apply file-backed .aof assets
    Given a project with .aof file-backed config
    When I run `assets apply --codex`
    Then the command should succeed
    And stdout should contain `Created`
    And file `.codex/skills/file-backed/SKILL.md` should exist
    And file `.codex/skills/file-backed/SKILL.md` should contain `File-backed body`
    And file `.codex/.gitignore` should contain `!.gitignore`
    And file `.aof/aof.lock.json` should exist
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/skills/file-backed/SKILL.md`

  Scenario: Apply expanded DSL primitives
    Given a project with expanded .aof DSL config
    When I run `assets apply`
    Then the command should succeed
    And file `.mcp.json` should exist
    And file `.codex/config.toml` should contain `[mcp_servers.docs]`
    And file `.codex/config.toml` should contain `[[hooks.PostToolUse]]`
    And file `.claude/settings.json` should contain `"hooks"`
    And file `AGENTS.md` should contain `Included guidance`
    And file `CLAUDE.md` should contain `Included guidance`
    And JSON file `.aof/aof.lock.json` should contain generated file `AGENTS.md`

  Scenario: Preview expanded DSL primitives before applying
    Given a project with expanded .aof DSL config
    When I run `assets apply --dry-run`
    Then the command should succeed
    And stdout should contain `Would create`
    And stdout should contain `Would update .aof/aof.lock.json`
    And file `AGENTS.md` should not exist
    And file `.codex/config.toml` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Apply runtime override for a file-backed asset
    Given a project with .aof runtime override config
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.codex/skills/overridden/SKILL.md` should exist
    And file `.codex/skills/overridden/SKILL.md` should contain `Codex override body`

  Scenario: Reject runtime override identity changes
    Given a project with .aof invalid identity override config
    When I run `assets apply --codex`
    Then the command should fail
    And stdout should contain `Runtime override cannot change resource id`

  Scenario: Render natural-language rule guidance per runtime
    Given a project with .aof rule config
    When I run `assets apply`
    Then the command should succeed
    And file `.claude/rules/project-rule.md` should exist
    And file `.claude/rules/project-rule.md` should contain `paths: src`
    And file `.codex/src/AGENTS.md` should exist
    And file `.codex/src/AGENTS.md` should contain `Use scoped guidance`
    And file `.codex/rules/project-rule.rules` should not exist

  Scenario: Merge multiple Codex rules into one AGENTS file
    Given a project with .aof multiple codex rules config
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.codex/AGENTS.md` should exist
    And file `.codex/AGENTS.md` should contain `## alpha`
    And file `.codex/AGENTS.md` should contain `## zeta`
    And text `## alpha` should appear before `## zeta` in file `.codex/AGENTS.md`

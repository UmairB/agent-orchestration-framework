Feature: AOF CLI lifecycle
  User-facing lifecycle commands should stay stable across refactors.

  Scenario: Show command help
    Given an empty project
    When I run `--help`
    Then the command should succeed
    And stdout should contain `aof - Agent Orchestration Framework`
    And stdout should contain `aof init [dir] [--claude] [--codex] [--runtime claude,codex]`
    And stdout should contain `aof project show`
    And stdout should contain `aof project validate`
    And stdout should contain `aof assets add skill|command|rule|agent [id]`
    And stdout should contain `aof assets apply`
    And stdout should contain `aof boards ui [--port 4187]`
    And stdout should contain `aof project migrate`
    And stdout should not contain `aof add [kind id]`
    And stdout should not contain `aof migrate [dir]`
    And stdout should not contain `aof config show`
    And stdout should not contain `aof install [--no-serve]`

  Scenario: Removed install command does not start the setup UI
    Given an empty project
    When I run `install --no-serve`
    Then the command should fail
    And stderr should contain `Removed command "install"`
    And stderr should contain `aof assets ui`

  Scenario: Board UI has a dedicated launcher
    Given an empty project
    When I run `boards ui --no-serve`
    Then the command should succeed
    And stdout should contain `aof boards ui`
    And stdout should contain `board/task management UI`
    And stdout should not contain `aof assets ui`

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

  Scenario: Init only creates project workspace and guidance
    Given an empty project
    When I run `init --codex` with input `unused|unused|yes|no` and resource input `{"kind":"agent","id":"research-agent","description":"Research agent","runtimes":["codex"],"body":"Research the repository."}`
    Then the command should succeed
    And stdout should contain `Next steps:`
    And stdout should contain `aof project validate`
    And stdout should contain `aof packages add gsd`
    And stdout should contain `aof assets ui`
    And stdout should not contain `Create a project asset now?`
    And stdout should not contain `Create a reusable global asset now?`
    And stdout should not contain `Starter agent instructions`
    And file `.aof/aof.config.json` should contain `"resources": []`
    And file `.aof/assets/agents/research-agent/AGENT.md` should not exist

  Scenario: Refuse to overwrite an existing project config
    Given a project initialized with AOF config
    When I run `init --codex`
    Then the command should fail
    And stderr should contain `Config already exists`

  Scenario: Add a file-backed skill from the CLI
    Given an empty project
    When I run `assets add skill code-review --codex --description "Review code changes"`
    Then the command should succeed
    And stdout should contain `Created`
    And file `.aof/aof.config.json` should exist
    And file `.aof/aof.config.json` should contain `"id": "code-review"`
    And file `.aof/aof.config.json` should contain `"path": "assets/skills/code-review/SKILL.md"`
    And file `.aof/assets/skills/code-review/SKILL.md` should exist
    And file `.aof/assets/skills/code-review/SKILL.md` should contain `Review code changes`

  Scenario: Add refuses scaffold collisions unless forced
    Given an empty project
    When I run `assets add skill code-review --codex`
    Then the command should succeed
    When I run `assets add skill code-review --codex`
    Then the command should fail
    And stderr should contain `Resource already exists`
    When I run `assets add skill code-review --codex --force --description "Forced replacement"`
    Then the command should succeed
    And file `.aof/assets/skills/code-review/SKILL.md` should contain `Forced replacement`

  Scenario: Add scaffolds non-skill kinds
    Given an empty project
    When I run `assets add rule infra-files --runtime codex --description "Infrastructure guidance"`
    Then the command should succeed
    And file `.aof/assets/rules/infra-files/RULE.md` should exist
    And file `.aof/aof.config.json` should contain `"kind": "rule"`
    And file `.aof/aof.config.json` should contain `"codex"`

  Scenario: Interactively add a project asset
    Given an empty project
    When I run `assets add` with resource input `{"kind":"skill","id":"interactive-skill","description":"Interactive skill","runtimes":["codex"],"body":"Interactive body"}`
    Then the command should succeed
    And stdout should contain `Created`
    And stdout should not contain `Starter skill instructions`
    And file `.aof/assets/skills/interactive-skill/SKILL.md` should contain `Describe the reusable workflow`
    And file `.aof/aof.config.json` should contain `"id": "interactive-skill"`
    And file `.aof/aof.config.json` should contain `"codex"`

  Scenario: Add and inspect global assets
    Given an empty project
    When I run `assets add --global skill shared-review --codex --description "Shared reviewer"`
    Then the command should succeed
    And stdout should contain `Created`
    And global file `aof.config.json` should contain `"id": "shared-review"`
    And global file `assets/skills/shared-review/SKILL.md` should exist
    And global file `assets/skills/shared-review/SKILL.md` should contain `Shared reviewer`
    And file `.aof/aof.config.json` should not exist
    When I run `assets list --global`
    Then the command should succeed
    And stdout should contain `skill:shared-review`
    When I run `assets show --global skill shared-review`
    Then the command should succeed
    And stdout should contain `resource: skill:shared-review`
    And stdout should contain `body: present`

  Scenario: List and remove project assets
    Given an empty project
    When I run `assets add skill remove-me --codex --description "Remove me"`
    Then the command should succeed
    When I run `assets list`
    Then the command should succeed
    And stdout should contain `skill:remove-me`
    When I run `assets remove skill remove-me --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run`
    And file `.aof/assets/skills/remove-me/SKILL.md` should exist
    When I run `assets remove skill remove-me`
    Then the command should succeed
    And file `.aof/assets/skills/remove-me/SKILL.md` should not exist

  Scenario: Use and unuse global asset references
    Given an empty project
    When I run `init --codex`
    Then the command should succeed
    When I run `assets add --global skill shared-use --codex --description "Shared use"`
    Then the command should succeed
    When I run `assets use --global skill shared-use`
    Then the command should succeed
    And file `.aof/aof.config.json` should contain `"globalRefs"`
    And file `.aof/aof.config.json` should contain `"shared-use"`
    When I run `assets unuse --global skill shared-use`
    Then the command should succeed
    And file `.aof/aof.config.json` should contain `"globalRefs": []`

  Scenario: Interactively add a global asset
    Given an empty project
    When I run `assets add --global` with resource input `{"kind":"rule","id":"interactive-rule","description":"Interactive rule","runtimes":["codex"],"body":"Interactive global body"}`
    Then the command should succeed
    And stdout should contain `Created`
    And stdout should not contain `Starter rule text`
    And global file `assets/rules/interactive-rule/RULE.md` should contain `Add project guidance here`
    And global file `aof.config.json` should contain `"id": "interactive-rule"`
    And global file `aof.config.json` should contain `"codex"`

  Scenario: Validate global assets
    Given an empty project
    When I run `assets add --global rule shared-rule --codex --description "Shared rule"`
    Then the command should succeed
    When I run `assets validate --global`
    Then the command should succeed
    And stdout should contain `valid: global config passed validation`

  Scenario: Report malformed global asset config
    Given a malformed global AOF config
    When I run `assets validate --global`
    Then the command should fail
    And stdout should contain `invalid:`
    And stdout should contain `Invalid JSON`
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Cannot read config`

  Scenario: Render referenced global assets
    Given a project with referenced global assets
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.codex/skills/shared-review/SKILL.md` should exist
    And file `.codex/skills/shared-review/SKILL.md` should contain `Codex global override body`
    And file `.codex/AGENTS.md` should exist
    And file `.codex/AGENTS.md` should contain `Follow team standards`
    And file `.aof/assets/skills/shared-review/SKILL.md` should not exist
    And JSON file `.aof/aof.lock.json` should contain global resource `shared-review`
    When I run `project show`
    Then the command should succeed
    And stdout should contain `globalRefs: 2`
    And stdout should contain `source=global`

  Scenario: Assets apply rejects global runtime output scope
    Given a project with referenced global assets
    When I run `assets apply --codex --global`
    Then the command should fail
    And stderr should contain `aof assets apply does not support global runtime output`
    And stderr should contain `aof assets use --global`

  Scenario: Sync referenced global assets
    Given a project with referenced global assets
    When I run `assets apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `Would create`
    And file `.codex/skills/shared-review/SKILL.md` should not exist
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.codex/skills/shared-review/SKILL.md` should exist
    And JSON file `.aof/aof.lock.json` should contain global resource `shared-review`

  Scenario: Render referenced global skill helper files
    Given a project with referenced global skill helper files
    When I run `assets apply --codex`
    Then the command should succeed
    And file `.codex/skills/research-helper/search.py` should exist
    And file `.codex/skills/research-helper/search.py` should contain `print('search')`
    And file `.aof/assets/skills/research-helper/search.py` should not exist
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/skills/research-helper/search.py`
    And JSON file `.aof/aof.lock.json` should contain global resource `research-helper`

  Scenario: Preview referenced global skill helper files
    Given a project with referenced global skill helper files
    When I run `assets apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `.codex`
    And stdout should contain `search.py`
    And file `.codex/skills/research-helper/search.py` should not exist

  Scenario: Render referenced global skill helper file placeholders
    Given a project with referenced global skill helper file placeholders
    When I run `assets apply`
    Then the command should succeed
    And file `.codex/skills/research-helper/SKILL.md` should contain `Codex helper .codex/skills/research-helper/search.py`
    And file `.claude/skills/research-helper/SKILL.md` should contain `Base helper .claude/skills/research-helper/search.py`
    And file `.codex/skills/research-helper/SKILL.md` should not contain `{{`
    And file `.claude/skills/research-helper/SKILL.md` should not contain `{{`
    And file `.codex/skills/research-helper/search.py` should exist
    And file `.claude/skills/research-helper/search.py` should exist
    And JSON file `.aof/aof.lock.json` should contain global resource `research-helper`

  Scenario: Preview referenced global skill helper file placeholders
    Given a project with referenced global skill helper file placeholders
    When I run `assets apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `.codex/skills/research-helper/SKILL.md`
    And stdout should contain `.codex/skills/research-helper/search.py`
    And file `.codex/skills/research-helper/SKILL.md` should not exist
    And file `.codex/skills/research-helper/search.py` should not exist

  Scenario: Render command helper files beside command markdown
    Given a project with command helper file placeholders
    When I run `assets apply --claude`
    Then the command should succeed
    And file `.claude/commands/prime.md` should contain `.claude/commands/helper.py`
    And file `.claude/commands/prime.md` should not contain `{{`
    And file `.claude/commands/helper.py` should exist
    And file `.claude/commands/helper.py` should contain `print('prime')`
    And file `.claude/scripts/prime/helper.py` should not exist
    And JSON file `.aof/aof.lock.json` should contain generated file `.claude/commands/helper.py`

  Scenario: Reject Codex command assets during validation
    Given a project with a codex command asset
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Command assets are not supported for Codex`
    And stdout should contain `create a Codex skill explicitly`

  Scenario: Reject Codex command assets before apply writes
    Given a project with a codex command asset
    When I run `assets apply --codex`
    Then the command should fail
    And stdout should contain `Command assets are not supported for Codex`
    And file `.codex/commands/ci.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Render Claude command assets without Codex command output
    Given a project with a claude command asset
    When I run `assets apply --claude`
    Then the command should succeed
    And file `.claude/commands/ci.md` should exist
    And file `.claude/commands/ci.md` should contain `Run CI`
    And file `.codex/commands/ci.md` should not exist

  Scenario: Reject argument markers in simple assets
    Given a project with a simple argument asset
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Simple asset content appears to depend on arguments`
    And stdout should contain `workflow-backed assets`

  Scenario: Render workflow-backed Claude commands and Codex skills
    Given a project with workflow-backed assets
    When I run `assets apply`
    Then the command should succeed
    And file `.claude/aof/workflows/audit.md` should contain `Audit the milestone`
    And file `.codex/aof/workflows/audit.md` should contain `Audit the milestone`
    And file `.claude/commands/audit.md` should contain `.claude/aof/workflows/audit.md`
    And file `.claude/commands/audit.md` should contain `Argument hint`
    And file `.codex/skills/audit/SKILL.md` should contain `.codex/aof/workflows/audit.md`
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/aof/workflows/audit.md`

  Scenario: Render asset reference placeholders
    Given a project with asset reference placeholders
    When I run `assets apply`
    Then the command should succeed
    And file `.codex/aof/workflows/audit.md` should contain `.codex/skills/ci/SKILL.md`
    And file `.claude/commands/review.md` should contain `.claude/skills/ci/SKILL.md`
    And file `.claude/commands/review.md` should contain `.claude/aof/workflows/audit.md`
    And file `.codex/skills/review/SKILL.md` should contain `.codex/skills/ci/SKILL.md`
    And file `.codex/skills/review/SKILL.md` should contain `.codex/aof/workflows/audit.md`
    And file `.codex/skills/shared-ref/SKILL.md` should contain `.codex/skills/ci/SKILL.md`
    And file `.codex/skills/review/SKILL.md` should not contain `{{`

  Scenario: Reject invalid workflow references and argument overrides
    Given a project with invalid workflow-backed assets
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Missing workflow: missing`
    And stdout should contain `Argument override references undeclared workflow argument "phase"`

  Scenario: Reject invalid asset reference placeholders
    Given a project with invalid asset reference placeholders
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Unsupported asset reference namespace "commands"`
    And stdout should contain `Missing asset reference: {{skills.missing}}`
    And stdout should contain `does not target runtime "codex"`

  Scenario: Report invalid global skill helper file placeholders
    Given a project with invalid global skill helper file placeholders
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Referenced associated file placeholder is not declared for skill:research-helper: {{files.missing.py}}`

  Scenario: Report unsafe global skill helper files
    Given a project with unsafe global skill helper files
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Associated file path must stay inside the asset directory`

  Scenario: Report invalid global references
    Given a project with a missing global reference
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Missing global resource: skill:missing-shared`
    Given a project with a local and global asset conflict
    When I run `project validate`
    Then the command should fail
    And stdout should contain `Global reference conflicts with local resource skill:shared-review`

  Scenario: Refuse to silently migrate a legacy root config during init
    Given a project initialized with legacy AOF config
    When I run `init --codex`
    Then the command should fail
    And stderr should contain `aof project migrate`

  Scenario: Explicitly migrate a legacy root config into .aof
    Given a project initialized with legacy AOF config
    When I run `project migrate`
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
    When I run `assets apply --codex --dry-run`
    Then the command should succeed
    And stdout should contain `Would create`
    And stdout should contain `Would update .aof/aof.lock.json`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And file `.aof/aof.lock.json` should not exist

  Scenario: Protect drifted generated files unless forced
    Given a project with .aof file-backed config
    When I run `assets apply --codex`
    Then the command should succeed
    When I replace file `.codex/skills/file-backed/SKILL.md` with `Manual edit`
    And I run `assets apply --codex`
    Then the command should succeed
    And stdout should contain `drift-warning`
    And file `.codex/skills/file-backed/SKILL.md` should contain `Manual edit`
    When I run `assets apply --codex --force`
    Then the command should succeed
    And file `.codex/skills/file-backed/SKILL.md` should contain `File-backed body`

  Scenario: Prune stale owned generated files
    Given a project with .aof file-backed config
    When I run `assets apply --codex`
    Then the command should succeed
    When the .aof config has no resources
    And I run `assets apply --codex`
    Then the command should succeed
    And stdout should contain `Removed`
    And file `.codex/skills/file-backed/SKILL.md` should not exist

  Scenario: Show project inspection in human and JSON formats
    Given a project with .aof package config
    When I run `project show`
    Then the command should succeed
    And stdout should contain `config:`
    And stdout should contain `skill:file-backed`
    And stdout should contain `packages: 1`
    When I run `project show --json`
    Then the command should succeed
    And stdout should contain `"packages"`
    And stdout should contain `"gsd"`

  Scenario: Validate invalid config for automation
    Given a project with invalid .aof config
    When I run `project validate`
    Then the command should fail
    And stdout should contain `invalid:`
    When I run `project validate --json`
    Then the command should fail
    And stdout should contain `"valid": false`
    And stdout should contain `Unsupported runtime`
    When I run `project validate --json`
    Then the command should fail
    And stdout should contain `"valid": false`
    And stdout should contain `"errors"`

  Scenario: Doctor reports package intent and stale legacy config
    Given a project with .aof package config and stale legacy config
    When I run `project doctor`
    Then the command should succeed
    And stdout should contain `package-intent`
    And stdout should contain `legacy-config`
    When I run `project doctor`
    Then the command should succeed
    And stdout should contain `package-intent`
    And stdout should contain `legacy-config`
    And stdout should contain `aof packages install gsd --dry-run`
    When I run `project doctor --strict`
    Then the command should fail
    And stdout should contain `warning: legacy-config`

  Scenario: Clean previews and removes matching lock-owned outputs
    Given a project with .aof file-backed config
    When I run `assets apply --codex`
    Then the command should succeed
    And stdout should contain `Created .codex/skills/file-backed/SKILL.md`
    And stdout should not contain `reason=file does not exist`
    And file `.codex/.gitignore` should contain `!.gitignore`
    When I run `assets clean --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no generated files`
    And stdout should contain `delete:`
    And file `.codex/skills/file-backed/SKILL.md` should exist
    When I run `assets clean`
    Then the command should succeed
    And stdout should contain `delete:`
    And file `.codex/skills/file-backed/SKILL.md` should not exist
    And JSON file `.aof/aof.lock.json` should not contain generated file `.codex/skills/file-backed/SKILL.md`

  Scenario: Clean preserves drifted lock-owned outputs
    Given a project with .aof file-backed config
    When I run `assets apply --codex`
    Then the command should succeed
    When I replace file `.codex/skills/file-backed/SKILL.md` with `Manual edit`
    And I run `assets clean`
    Then the command should succeed
    And stdout should contain `drift-warning`
    And file `.codex/skills/file-backed/SKILL.md` should contain `Manual edit`
    And JSON file `.aof/aof.lock.json` should contain generated file `.codex/skills/file-backed/SKILL.md`

  Scenario: Catalog storage is disabled
    Given an empty project
    When I run `catalog list`
    Then the command should fail
    And stderr should contain `Removed command "catalog"`
    And stderr should contain `Catalog is not currently supported`
    And data file `aof.sqlite` should not exist

  Scenario: Reject catalog-backed init items
    Given an empty project
    When I run `init --items project-context,prime --codex`
    Then the command should fail
    And stderr should contain `Catalog-backed init items are not available yet`

  Scenario: Removed legacy asset commands fail without executing
    Given an empty project
    When I run `add`
    Then the command should fail
    And stderr should contain `Removed command "add"`
    And file `.aof/aof.config.json` should not exist
    When I run `global list`
    Then the command should fail
    And stderr should contain `Removed command "global"`
    When I run `apply --dry-run`
    Then the command should fail
    And stderr should contain `Removed command "apply"`
    When I run `sync --dry-run`
    Then the command should fail
    And stderr should contain `Removed command "sync"`
    When I run `clean --dry-run`
    Then the command should fail
    And stderr should contain `Removed command "clean"`
    When I run `validate`
    Then the command should fail
    And stderr should contain `Removed command "validate"`
    And stderr should contain `aof project validate`
    When I run `doctor`
    Then the command should fail
    And stderr should contain `Removed command "doctor"`
    And stderr should contain `aof project doctor`
    When I run `migrate`
    Then the command should fail
    And stderr should contain `Removed command "migrate"`
    And stderr should contain `aof project migrate`
    When I run `config show`
    Then the command should fail
    And stderr should contain `Removed command "config"`
    And stderr should contain `aof project show`

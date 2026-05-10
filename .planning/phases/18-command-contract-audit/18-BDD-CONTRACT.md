# Phase 18 BDD Contract

**Created:** 2026-05-10
**Purpose:** Scenario contract for implementing and verifying the v1.4 namespaced CLI rewrite.

## General Rules

- User-facing command behavior must be covered by BDD scenarios.
- Node and PowerShell integration runners should cover the same command contract where practical.
- Removed commands must be tested as non-executing failures, not aliases.
- Catalog/SQLite side effects must be explicitly absent.
- Dry-run scenarios must prove no writes or no network execution as applicable.

## Help And Unknown Commands

### Scenario: Help groups commands by product area

Given an empty project
When I run `--help`
Then the command should succeed
And stdout should contain `Project setup:`
And stdout should contain `Assets:`
And stdout should contain `Packages:`
And stdout should contain `Project diagnostics:`
And stdout should contain `aof assets add skill [id]`
And stdout should contain `aof packages add gsd`
And stdout should not contain `aof add [kind id]`
And stdout should not contain `aof install [--no-serve]`

### Scenario: Removed top-level commands do not execute

For each removed command:

- `add`
- `apply`
- `sync`
- `clean`
- `validate`
- `doctor`
- `global`
- `install`
- `catalog`
- `config`

When I run the command
Then the command should fail
And stderr should contain the removed command name
And stderr should contain a namespaced replacement hint
And no `.aof` files should be created
And no SQLite/catalog data file should be created

## Init

### Scenario: Init creates only project workspace state

Given an empty project
When I run `init --codex`
Then the command should succeed
And file `.aof/aof.config.json` should exist
And file `.aof/aof.lock.json` should exist
And file `.codex/skills/project-context/SKILL.md` should not exist
And file `.codex/commands/prime.md` should not exist
And stdout should contain `aof assets add`
And stdout should contain `aof assets ui`
And stdout should contain `aof assets apply`
And stdout should not contain `aof install`
And no SQLite/catalog data file should be created

### Scenario: Init dry-run does not write files

Given an empty project
When I run `init --codex --dry-run`
Then the command should succeed
And stdout should contain `dry-run`
And stdout should contain `.aof/aof.config.json`
And file `.aof/aof.config.json` should not exist

## Project Namespace

### Scenario: Project show replaces config show

Given a project initialized with AOF config
When I run `project show`
Then the command should succeed
And stdout should contain `config:`
And stdout should contain `resources:`
And stdout should contain `packages:`

### Scenario: Project validate replaces top-level validate

Given a project initialized with AOF config
When I run `project validate`
Then the command should succeed
And stdout should contain `valid:`

### Scenario: Project doctor replaces top-level doctor

Given a project initialized with AOF config
When I run `project doctor`
Then the command should succeed
And stdout should contain `doctor:`

### Scenario: Project migrate replaces top-level migrate

Given a project initialized with legacy AOF config
When I run `project migrate`
Then the command should succeed
And file `.aof/aof.config.json` should exist
And file `aof.config.json` should exist
And stdout should contain `left untouched`

## Assets Namespace

### Scenario: Add project skill with full command

Given an empty project
When I run `init --codex`
And I run `assets add skill code-review --codex --description "Review code"`
Then the command should succeed
And file `.aof/assets/skills/code-review/SKILL.md` should exist
And file `.aof/aof.config.json` should contain `"id": "code-review"`

### Scenario: Add project skill with partial interactive command

Given an empty project
When I run `init --codex`
And I run `assets add skill` with resource input `{"id":"interactive-skill","description":"Interactive skill","runtimes":["codex"],"body":"Body"}`
Then the command should succeed
And file `.aof/assets/skills/interactive-skill/SKILL.md` should exist

### Scenario: Add global skill with scope flag

Given an empty project
When I run `assets add --global skill shared-review --codex --description "Shared review"`
Then the command should succeed
And global file `assets/skills/shared-review/SKILL.md` should exist
And file `.aof/aof.config.json` should not exist

### Scenario: List and show project and global assets

Given a project initialized with AOF config
And a project skill `code-review`
And a global skill `shared-review`
When I run `assets list`
Then stdout should contain `skill:code-review`
When I run `assets list --global`
Then stdout should contain `skill:shared-review`
When I run `assets show skill code-review`
Then stdout should contain `resource: skill:code-review`
When I run `assets show --global skill shared-review`
Then stdout should contain `resource: skill:shared-review`

### Scenario: Use and unuse global asset reference

Given a project initialized with AOF config
And a global skill `shared-review`
When I run `assets use --global skill shared-review`
Then the command should succeed
And file `.aof/aof.config.json` should contain `"globalRefs"`
When I run `assets unuse --global skill shared-review`
Then the command should succeed
And file `.aof/aof.config.json` should not contain `"shared-review"`

### Scenario: Assets apply targets configured runtimes by default

Given a project initialized with Codex and Claude runtimes
And a project skill `code-review`
When I run `assets apply --dry-run`
Then the command should succeed
And stdout should contain `runtime=codex`
And stdout should contain `runtime=claude`

### Scenario: Assets apply runtime flags narrow one run

Given a project initialized with Codex and Claude runtimes
And a project skill `code-review`
When I run `assets apply --codex --dry-run`
Then the command should succeed
And stdout should contain `runtime=codex`
And stdout should not contain `runtime=claude`

### Scenario: Assets validate validates global scope

Given a global skill `shared-review`
When I run `assets validate --global`
Then the command should succeed
And stdout should contain `valid:`

### Scenario: Assets clean preserves dry-run behavior

Given a project with generated lock-owned outputs
When I run `assets clean --dry-run`
Then the command should succeed
And stdout should contain `dry-run`
And generated files should still exist

### Scenario: Assets UI starts editor

Given a project initialized with AOF config
When I run `assets ui --port 4177`
Then stdout should contain `AOF setup UI is running locally`
And stdout should contain `http://127.0.0.1:4177/`
And stdout should contain `Press Ctrl+C`

## Packages Namespace

### Scenario: Packages add GSD records intent only

Given a project initialized with AOF config
When I run `packages add gsd --codex`
Then the command should succeed
And file `.aof/aof.config.json` should contain `"packages"`
And stdout should not contain `network-boundary`
And stdout should not contain `npx`

### Scenario: Packages install GSD dry-run does not run network commands

Given a project with GSD package intent
When I run `packages install gsd --dry-run`
Then the command should succeed
And stdout should contain `dry-run`
And stdout should contain `no network`
And stdout should contain `get-shit-done`

### Scenario: Packages install GSD prints network boundary

Given a project with GSD package intent
When I run `packages install gsd`
Then stdout should contain `network-boundary`
And stdout should contain `warning: this command may access the network`

### Scenario: Packages install from lock replaces install replay

Given a project with package install intent in lock state
When I run `packages install --from-lock --dry-run`
Then the command should succeed
And stdout should contain `from-lock`
And stdout should contain `no network`

### Scenario: Packages list, show, validate

Given a project with GSD package intent
When I run `packages list`
Then stdout should contain `gsd`
When I run `packages show gsd`
Then stdout should contain `package: gsd`
When I run `packages validate`
Then stdout should contain `valid:`

## Removed Catalog/SQLite Behavior

### Scenario: Removed catalog command has no SQLite side effects

Given an empty project
When I run `catalog`
Then the command should fail
And stderr should contain `aof assets`
And data file `aof.sqlite` should not exist

## PowerShell Parity

PowerShell integration should cover the same externally visible command contracts for:

- `init`
- removed command failures
- `assets add`
- `assets add --global`
- `assets apply --dry-run`
- `project validate`
- `packages add gsd`
- `packages install gsd --dry-run`

## Coverage Matrix

| Requirement | Scenario coverage |
|---|---|
| CLI-01 | Help, inventory-backed accepted command scenarios |
| CLI-02 | Removed overloaded commands, separated assets/packages/project scenarios |
| CLI-03 | Removed command failure scenarios |
| CLI-04 | Help grouped by product area |
| ASSET-01 | `assets add` full and partial scenarios |
| ASSET-02 | `assets add/list/show/use/unuse --global` scenarios |
| ASSET-03 | `assets apply` default and narrowed runtime scenarios |
| ASSET-04 | `assets validate --global` scenario |
| ASSET-05 | `assets ui` scenario |
| ASSET-06 | `assets clean --dry-run` scenario |
| PKG-01 | `packages add gsd` scenario |
| PKG-02 | `packages install gsd` scenarios |
| PKG-03 | `packages list/show/validate` scenario |
| PKG-04 | `packages install --from-lock` scenario |
| PROJ-01 | `init` scenario |
| PROJ-02 | `project show/validate/doctor` scenarios |
| PROJ-03 | `project migrate` scenario |
| PROJ-04 | removed catalog no-SQLite scenario |

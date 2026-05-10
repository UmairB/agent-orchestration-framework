# Phase 18 CLI Contract

**Created:** 2026-05-10
**Milestone:** v1.4 Namespaced CLI Contract
**Status:** Accepted contract for implementation planning

## Core Rules

1. `aof init` is the only top-level product command retained from the old surface.
2. Asset work belongs under `aof assets ...`.
3. Managed package work belongs under `aof packages ...`.
4. Project inspection, diagnostics, and migration belong under `aof project ...`.
5. Removed commands do not execute and are not aliases.
6. `--global` is an asset scope flag, not a top-level namespace.
7. `sync` is removed. Users run explicit asset and package commands instead.
8. No install command launches the editor.

## Top Level

### `aof init [dir]`

**Purpose:** Create the project-local AOF workspace.

**Arguments:**
- `dir` optional target directory. Defaults to current working directory.

**Flags:**
- `--codex`, `--claude`, `--runtime <list>` narrow or set initial project runtimes.
- `--force` replaces existing `.aof/aof.config.json`.
- `--dry-run` previews files that would be written.
- `--name <name>` may be added if implementation chooses to support explicit project naming.

**Writes:**
- `.aof/aof.config.json`
- `.aof/aof.lock.json`

**Must not:**
- Create default skills, commands, rules, or agents.
- Launch the UI.
- Render `.codex` or `.claude` outputs.
- Run package installers.
- Initialize catalog or SQLite storage.

**Missing arguments:** No required positional argument. In interactive terminals, runtime selection may prompt when runtime flags are missing. In automation, callers should pass runtime flags.

**Success output:** State the config path created and show next steps using namespaced commands.

**Dry-run output:** List `.aof/aof.config.json` and `.aof/aof.lock.json` as planned writes and state that no files were written.

**Errors:**
- Existing `.aof/aof.config.json` without `--force`.
- Legacy root config requiring `aof project migrate`.

## Project Namespace

### `aof project show`

**Purpose:** Inspect the current project AOF configuration.

**Arguments:** None.

**Flags:**
- `--json`
- `--target <dir>`
- `--config <path>`

**Writes:** None.

**Output:** Project config path, project name, configured runtimes, local resources, global references, managed packages, and stale legacy-config warnings.

**Errors:** Missing or invalid project config.

### `aof project validate`

**Purpose:** Validate whole-project AOF configuration.

**Arguments:** None.

**Flags:**
- `--json`
- `--strict`
- runtime narrowing flags where adapter warnings are runtime-specific.
- `--target <dir>`
- `--config <path>`

**Writes:** None.

**Output:** Human summary or JSON diagnostics. Strict mode promotes warnings to command failure.

**Errors:** Invalid config shape, missing referenced files, malformed package intent, malformed referenced globals, or strict warning failures.

### `aof project doctor`

**Purpose:** Diagnose project health and suggest next commands.

**Arguments:** None.

**Flags:**
- `--json`
- `--strict`
- runtime narrowing flags where relevant.
- `--target <dir>`

**Writes:** None.

**Output:** Health status, checks, adapter warnings, drift/legacy warnings, and suggested next commands.

**Errors:** Health errors or strict warning failures set a failing exit code.

### `aof project migrate [dir]`

**Purpose:** Convert legacy root `aof.config.json` into authoritative `.aof/aof.config.json`.

**Arguments:**
- `dir` optional target directory. Defaults to current working directory.

**Flags:**
- `--dry-run`
- `--force`

**Writes:**
- `.aof/aof.config.json`
- `.aof/aof.lock.json`

**Must not:** Delete or mutate the legacy root config.

**Output:** State source config, destination config, lock path, and that the root config was left untouched.

**Errors:** No legacy config, existing `.aof` config without `--force`, invalid legacy config.

## Assets Namespace

### `aof assets add <kind> [id]`

**Purpose:** Create a project-local asset.

**Kinds:** `skill`, `command`, `rule`, `agent`.

**Arguments:**
- `kind` optional in interactive terminals. Required in non-interactive automation.
- `id` optional in interactive terminals. Required in non-interactive automation unless prompt input is explicitly provided.

**Flags:**
- `--description <text>`
- `--name <name>`
- `--codex`, `--claude`, `--runtime <list>`
- `--force`
- `--dry-run`

**Writes:**
- `.aof/assets/<kind-plural>/<id>/...`
- `.aof/aof.config.json`

**Missing arguments:**
- `aof assets add` prompts for kind, id, description, runtimes, and starter content.
- `aof assets add skill` keeps kind fixed and prompts for id/details.
- Non-interactive terminals fail with an actionable message and examples.

**Output:** Created asset path and updated config path. Mention `aof assets ui` or direct file edit as the next edit path.

### `aof assets add --global <kind> [id]`

**Purpose:** Create a reusable global asset in `~/.aof`.

**Kinds:** `skill`, `rule`, `agent`.

**Arguments and flags:** Same as project asset add, with global source paths.

**Writes:**
- `~/.aof/assets/<kind-plural>/<id>/...`
- `~/.aof/aof.config.json`

**Missing arguments:** Same as project asset add, with prompts labelled as reusable global assets.

### `aof assets list [--global]`

**Purpose:** List project-local or global assets.

**Flags:**
- `--global`
- `--json`
- `--target <dir>` for project scope.

**Writes:** None.

**Output:** Asset kind, id, runtime targets, source scope, and reference status where relevant.

### `aof assets show [--global] <kind> <id>`

**Purpose:** Show one asset's source metadata and file status.

**Flags:**
- `--global`
- `--json`
- `--target <dir>` for project scope.

**Writes:** None.

**Missing arguments:** Fail with usage and examples.

### `aof assets remove [--global] <kind> <id>`

**Purpose:** Remove a project-local or global source asset.

**Flags:**
- `--global`
- `--force`
- `--dry-run`

**Writes:**
- Removes source files for the asset.
- Updates project or global `aof.config.json`.

**Safety:** Must not remove generated runtime outputs. Users run `aof assets clean` for lock-owned generated outputs.

### `aof assets use --global <kind> <id>`

**Purpose:** Add a reference from the current project to a global asset.

**Writes:**
- Project `.aof/aof.config.json` `globalRefs`.

**Validation:** Fails for missing global asset, duplicate reference, or local/global conflicts.

### `aof assets unuse --global <kind> <id>`

**Purpose:** Remove a project reference to a global asset.

**Writes:**
- Project `.aof/aof.config.json` `globalRefs`.

**Safety:** Must not delete global source files.

### `aof assets apply`

**Purpose:** Render configured project and referenced global assets into assistant runtime outputs.

**Default runtime behavior:** Applies to all runtimes configured in the project.

**Runtime flags:** `--codex`, `--claude`, or `--runtime codex,claude` narrow the current run.

**Flags:**
- `--dry-run`
- `--json`
- `--strict`
- `--force`
- `--target <dir>`
- `--config <path>`

**Writes:**
- Runtime output folders such as `.codex` and `.claude`.
- `.aof/aof.lock.json`.

**Dry-run output:** List planned file actions and lock preview. No files or lock entries are written.

### `aof assets validate`

**Purpose:** Validate asset source configuration and referenced global assets.

**Flags:**
- `--global` validates the global asset library.
- `--json`
- `--strict`
- runtime narrowing flags for adapter warning checks.

**Writes:** None.

**Output:** Diagnostics for asset shape, missing files, invalid references, local/global conflicts, associated files, and adapter warnings.

### `aof assets clean`

**Purpose:** Remove lock-owned generated asset outputs.

**Flags:**
- `--dry-run`
- `--force` only where existing drift-protection semantics allow it.

**Writes:**
- Deletes generated runtime files whose content still matches lock ownership.
- Updates `.aof/aof.lock.json`.

**Safety:** Drifted files are preserved unless an explicit future force contract says otherwise.

### `aof assets ui`

**Purpose:** Start the local source asset editor.

**Flags:**
- `--port <port>`

**Writes:** None by command start. The UI may write source configuration through its API after user action.

**Output:** Local URL, project path, explanation that the terminal must stay open, and stop instruction.

**Must not:** Be reachable through `aof install`.

## Packages Namespace

### `aof packages add gsd`

**Purpose:** Declare managed GSD package intent.

**Flags:**
- `--source <source>`
- `--package <package>`
- `--codex`, `--claude`, `--runtime <list>`
- `--global` only if it means runtime-home install scope, not global asset source scope.
- `--dry-run`

**Writes:**
- `.aof/aof.config.json` package intent.

**Must not:** Run npm, npx, or installer code.

### `aof packages list`

**Purpose:** List configured managed package intent.

**Flags:** `--json`.

**Writes:** None.

### `aof packages show gsd`

**Purpose:** Inspect configured GSD package intent and last lock attempts.

**Flags:** `--json`.

**Writes:** None.

### `aof packages remove gsd`

**Purpose:** Remove managed GSD package intent.

**Flags:**
- `--dry-run`
- `--force`

**Writes:**
- `.aof/aof.config.json`

**Must not:** Delete generated assets or uninstall runtime files unless a future uninstall contract is added.

### `aof packages validate`

**Purpose:** Validate managed package intent.

**Flags:**
- `--json`
- `--strict`

**Writes:** None.

### `aof packages install [gsd]`

**Purpose:** Execute installer commands for one package or all configured packages.

**Flags:**
- `--dry-run`
- `--json`
- `--force`
- `--from-lock`
- runtime narrowing flags where supported.

**Writes:**
- `.aof/aof.lock.json` install attempt metadata.

**Network boundary:** Non-dry-run execution must print the exact command, package source, runtime, scope, and warning that package code may run.

**Dry-run output:** Must state that no network or installer commands will run.

## Removed Commands

Removed commands do not execute and are not aliases:

- `aof add`
- `aof apply`
- `aof sync`
- `aof clean`
- `aof validate`
- `aof doctor`
- `aof global`
- `aof install`
- `aof catalog`
- `aof config`

Allowed behavior: fail with a helpful message pointing to the namespaced replacement.

Example:

```text
Unknown command "add".

AOF now uses namespaced commands:
  aof assets add skill
  aof packages add gsd
  aof project doctor
```

## Help Contract

Help must be grouped by product area:

```text
aof - Assistant Ops Framework

Project setup:
  aof init [dir] [--codex] [--claude] [--runtime codex,claude]

Assets:
  aof assets add skill [id]
  aof assets add --global skill [id]
  aof assets list [--global]
  aof assets show [--global] <kind> <id>
  aof assets use --global <kind> <id>
  aof assets apply [--codex|--claude|--runtime list] [--dry-run]
  aof assets validate [--global] [--strict]
  aof assets clean [--dry-run]
  aof assets ui [--port 4177]

Packages:
  aof packages add gsd
  aof packages list
  aof packages show gsd
  aof packages validate
  aof packages install [gsd] [--dry-run]
  aof packages install --from-lock [--dry-run]

Project diagnostics:
  aof project show
  aof project validate [--strict]
  aof project doctor [--strict]
  aof project migrate [dir] [--dry-run] [--force]
```

Help examples must show workflows:

```text
New project:
  aof init --codex
  aof assets add skill code-review
  aof assets apply --dry-run
  aof assets apply

Reusable global asset:
  aof assets add --global skill shared-review
  aof assets use --global skill shared-review
  aof assets apply

GSD package:
  aof packages add gsd
  aof packages install gsd --dry-run
  aof packages install gsd
```

## Output Contract

- Success output says exactly what changed.
- Write commands print source/config paths changed.
- Apply commands print targeted runtimes and lock path.
- Package install commands print network/package-code boundary before execution.
- UI launch prints local URL, project path, terminal lifetime, and stop instruction.
- Dry-run output says no writes and/or no network execution.
- Errors name the invalid command or argument and show a concrete valid example.

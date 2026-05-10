# Phase 18 Command Inventory

**Created:** 2026-05-10
**Purpose:** Current command surface inventory for the v1.4 namespaced CLI rewrite.

## Classification Key

- **keep:** command remains in place.
- **move:** behavior moves to a new namespace with the same core purpose.
- **replace:** behavior is split or renamed because the old command mixed concerns.
- **remove:** command disappears and must not execute as a legacy alias.

## Current Command Surface

| Current command | Current purpose | Current side effects | Classification | Target command | Notes |
|---|---|---|---|---|---|
| `aof init [dir]` | Creates project `.aof/aof.config.json` and `.aof/aof.lock.json`. | Writes `.aof` config and lock. May prompt for runtimes and guided project asset creation. No runtime output writes. | keep | `aof init [dir]` | Keep top-level, but later implementation must remove asset creation prompt and update next-step guidance. |
| `aof add` | Interactive project asset creation. | Writes `.aof/assets/...` and updates `.aof/aof.config.json`. | move | `aof assets add` | New namespace owns asset creation. |
| `aof add <kind> <id>` | Direct project asset creation. | Writes `.aof/assets/...` and updates `.aof/aof.config.json`; supports `--dry-run`. | move | `aof assets add <kind> <id>` | Partial form `aof assets add <kind>` should prompt for missing id/details. |
| `aof apply` | Renders project/global assets into runtime folders and writes lock state. | Writes `.claude`, `.codex`, and `.aof/aof.lock.json` unless `--dry-run`; supports adapter warnings and strict mode. | move | `aof assets apply` | Applies to configured runtimes by default; runtime flags narrow one run. |
| `aof sync` | Combines asset rendering/lock update with managed package installer planning and optional installer execution. | Writes runtime outputs and lock; with `--install` can execute networked package installer commands. | remove | none | Removed because it blurs assets and packages. Use `aof assets apply` and `aof packages install`. |
| `aof clean` | Removes lock-owned generated files while preserving drifted files. | Deletes generated runtime files and updates lock unless `--dry-run`. | move | `aof assets clean` | Asset-output cleanup belongs under assets. |
| `aof migrate [dir]` | Migrates legacy root `aof.config.json` into `.aof/aof.config.json` and lock. | Writes `.aof/aof.config.json` and `.aof/aof.lock.json`; leaves root config untouched. | move | `aof project migrate` | Project-level migration. |
| `aof validate` | Validates project `.aof` config and adapter warnings. | Read-only; sets exit code on failure; supports `--json` and `--strict`. | move | `aof project validate` and `aof assets validate` | Project validation is under project. Asset-focused validation is under assets. |
| `aof doctor` | Runs project health diagnostics and suggestions. | Read-only; sets exit code on failure; supports `--json` and `--strict`. | move | `aof project doctor` | Diagnostics are project-level. |
| `aof install` | Starts local setup UI. | Opens catalog abstraction, starts API server and Vite UI; keeps terminal alive. | replace | `aof assets ui` | Editor launch is not install behavior. |
| `aof install --no-serve` | Does not start UI and prints guidance. | Opens/closes catalog abstraction. | replace | `aof assets ui --no-serve` if retained | Later implementation should decide whether `--no-serve` is useful for `assets ui`; no install command may launch UI. |
| `aof install gsd` | Executes GSD framework installer commands. | May execute networked `npx` package code; writes install attempts to lock. | move | `aof packages install gsd` | Package install belongs under packages. |
| `aof install gsd --dry-run` | Previews GSD installer commands. | Read-only; no network; supports `--json`. | move | `aof packages install gsd --dry-run` | Must keep explicit no-network dry-run message. |
| `aof install --from-lock` | Replays framework install intent from lock state. | May execute networked package code; writes attempts to lock. | move | `aof packages install --from-lock` | Lock replay belongs under packages. |
| `aof install --interactive` | Placeholder error for redesigned interactive setup. | None; throws an error. | remove | none | No legacy interactive install command. |
| `aof global add` | Interactive reusable global asset creation. | Writes `~/.aof/assets/...` and `~/.aof/aof.config.json`. | move | `aof assets add --global` | Global is an assets scope flag. |
| `aof global add <kind> <id>` | Direct reusable global asset creation. | Writes global asset source and global config; supports `--dry-run`. | move | `aof assets add --global <kind> <id>` | Preserve global source model, not top-level command. |
| `aof global list` | Lists reusable global assets. | Read-only; supports `--json`. | move | `aof assets list --global` | Global list becomes scoped asset list. |
| `aof global show <kind> <id>` | Shows global asset metadata and source status. | Read-only; supports `--json`. | move | `aof assets show --global <kind> <id>` | Preserve body/source existence reporting. |
| `aof global validate` | Validates entire global library. | Read-only; supports `--json` and `--strict`; sets exit code on failure. | move | `aof assets validate --global` | Global library validation belongs under assets. |
| `aof catalog path` | Disabled catalog path command. | Throws disabled-catalog error; no SQLite side effects. | remove | none | Catalog product path remains deferred. |
| `aof catalog init` | Disabled catalog init command. | Throws disabled-catalog error; no SQLite side effects. | remove | none | Must remain no-side-effect unless catalog is redesigned. |
| `aof catalog list` | Disabled catalog list command. | Throws disabled-catalog error; no SQLite side effects. | remove | none | Must not initialize SQLite. |
| `aof config show` | Shows project config inspection summary. | Read-only; supports `--json`. | move | `aof project show` | Config is implementation detail; user-facing namespace is project. |
| `aof config validate` | Delegates to project validation. | Read-only; supports validate flags. | move | `aof project validate` | Remove config namespace. |
| `aof config doctor` | Delegates to project doctor. | Read-only; supports doctor flags. | move | `aof project doctor` | Remove config namespace. |
| `aof --help` | Shows current command help. | Read-only. | replace | `aof --help` | Keep help flag, but content must be rewritten around product namespaces. |
| unknown top-level command | Throws unknown command and current help text. | Read-only. | replace | helpful unknown command error | Should point to namespaces and nearest examples. |

## Target Commands With No Exact Current Equivalent

| Target command | Purpose | Source behavior |
|---|---|---|
| `aof assets remove [--global] <kind> <id>` | Remove project/global asset source and config entry. | New contract; implementation will need deletion semantics and safety checks. |
| `aof assets use --global <kind> <id>` | Add a project `globalRefs` entry. | Exists in setup UI API, not current CLI. |
| `aof assets unuse --global <kind> <id>` | Remove a project `globalRefs` entry. | Exists in setup UI API, not current CLI. |
| `aof packages add gsd` | Declare managed package intent without installer execution. | Package model exists; current direct CLI path is installer-first. |
| `aof packages list` | List managed package intent. | Current `config show` exposes packages in a mixed project summary. |
| `aof packages show gsd` | Inspect managed package intent. | New focused package inspection. |
| `aof packages remove gsd` | Remove managed package intent. | New contract. |
| `aof packages validate` | Validate managed package intent. | Current project validation covers package shape indirectly. |

## Commands That Must Not Execute In Rewrite

These commands may produce helpful errors, but they must not act as aliases and must not run the old behavior:

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

## Verification Notes

- The inventory covers all dispatch branches in `src/cli.mjs`.
- The inventory covers all commands shown by current `helpText()`.
- `sync` is explicitly removed rather than moved.
- Catalog commands remain removed/deferred and must not initialize SQLite.

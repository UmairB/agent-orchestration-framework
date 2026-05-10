# Phase 18 Plan 18-01 Summary: Current Command Inventory

**Status:** Complete
**Completed:** 2026-05-10

## Result

Created `.planning/phases/18-command-contract-audit/18-COMMAND-INVENTORY.md`.

## Inventory Count

- Current command/subcommand entries inventoried: 27
- Target commands with no exact current equivalent: 8
- Removed top-level command families: 10

## Removed Command Families

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

## Ambiguity Found

- `aof validate` has both project-level and asset-level implications. The rewrite should use `aof project validate` for whole-project config health and `aof assets validate` for asset/global-reference validation behavior.
- `aof install` currently mixes editor launch and package installation. The rewrite fully separates these as `aof assets ui` and `aof packages install`.
- `aof sync` intentionally has no replacement because it mixes assets and packages.

## Verification

- Cross-checked against `src/cli.mjs` dispatch branches.
- Cross-checked against current `helpText()` command list.

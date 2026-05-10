# Phase 18 Plan 18-02 Summary: Replacement CLI Contract

**Status:** Complete
**Completed:** 2026-05-10

## Result

Created `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md`.

## Final Command Groups

- Top level: `aof init`
- Project: `aof project show|validate|doctor|migrate`
- Assets: `aof assets add|list|show|remove|use|unuse|apply|validate|clean|ui`
- Packages: `aof packages add|list|show|remove|validate|install`

## Locked Contract Points

- `--global` is an assets scope flag.
- `aof assets apply` targets configured runtimes by default.
- `aof packages add gsd` declares package intent only.
- `aof packages install gsd` executes installer commands.
- `aof assets ui` launches the editor.
- No `install` command launches the editor.
- `sync` is removed.
- Removed commands are not aliases.

## Open Questions

None.

## Verification

- Cross-checked against `18-CONTEXT.md` decisions D-01 through D-37.
- Cross-checked against `18-COMMAND-INVENTORY.md`.

---
phase: 28
name: "Board And Task State Foundation"
type: research
status: completed
autonomous: true
---

# Phase 28 Research: Board And Task State Foundation

## Existing Patterns

- CLI commands are routed in `src/cli.mjs` by top-level namespace, with `parseOptions()` shared across commands and JSON output gated by `--json`.
- Project-local AOF state is rooted through `workspacePaths()` in `src/workspace.mjs`; `.aof/` is already the authoritative source area for configuration, assets, locks, and generated cache-like state.
- JSON file IO uses `readJson()` and `writeText()` from `src/fs.mjs`, with parent directory creation handled by `writeText()`.
- Setup UI APIs are implemented in `src/setup-ui.mjs` with direct HTTP route matching and shared JSON error helpers.
- Integration BDD is split by feature in `test/integration/features/` and routed through `test/integration/cli.mjs`; PowerShell parity uses the same feature suite where step coverage exists.

## Design Findings

1. Board/task state should be a separate module instead of adding board logic directly to `src/cli.mjs` or `src/setup-ui.mjs`.
   - This keeps CLI, setup UI API, tests, and later GSD integration using the same canonical operations.
2. Canonical state should live under `.aof/boards/<board-id>/` with one board descriptor and one task file per task.
   - This gives stable, inspectable project-local files and avoids touching `.planning/`.
3. The generated index should live under `.aof/cache/boards/index.json`.
   - The index is rebuildable from canonical board/task files and can be used by UI/API callers for fast reads.
4. Stale index validation should be warning-only in this phase.
   - Phase 28 explicitly preserves file correctness over cache correctness.
5. Task history should be stored in each task file.
   - This satisfies task inspection and prepares Phase 30 execution history without requiring a database.

## Proposed File Shape

```text
.aof/
  boards/
    <board-id>/
      BOARD.json
      tasks/
        <task-id>.json
  cache/
    boards/
      index.json
```

## Proposed Commands

- `aof boards list [--json]`
- `aof boards create <id> --title <title> --objective <objective> [--json]`
- `aof boards show <id> [--json]`
- `aof boards archive <id> [--json]`
- `aof boards validate [--json] [--strict]`
- `aof boards index [--json]`
- `aof boards task add <board-id> <task-id> --title <title> [--description ...] [--status ...] [--priority ...] [--deliverable ...] [--json]`
- `aof boards task move <board-id> <task-id> <status> [--json]`

## Risks

- Adding a board command namespace touches CLI routing and help text; BDD coverage should pin the contract.
- Setup UI API routes should remain backend-only in Phase 28 to avoid pulling forward Phase 31 UI work.
- Duplicate IDs are mainly file-layout conflicts in the proposed one-directory-per-board and one-file-per-task shape; validation still needs explicit duplicate checks to protect malformed or copied canonical files.

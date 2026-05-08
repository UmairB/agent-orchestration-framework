---
last_mapped: 2026-05-08
focus: arch
---

# Architecture

## Summary

AOF is structured as a thin CLI orchestrator over focused modules: DSL loading, catalog persistence, runtime adapters, framework installation, lifecycle scaffold/sync/clean planning, setup UI serving, prompting, and path resolution. The architecture favors small synchronous command flows and explicit file writes over long-running background services.

## Entry Points

- `bin/aof.mjs` is the executable entry point.
- `src/cli.mjs` exports `run(argv)` and dispatches commands.
- `src/setup-ui.mjs` exposes `serveSetupUi()` for the optional local setup interface.
- `ui/src/main.tsx` is the React application entry point for the setup UI.

## Command Dispatch

`src/cli.mjs` parses the first CLI argument and routes to:

- `initCommand()` for `aof init`
- `addCommand()` for `aof add`
- `applyCommand()` for `aof apply`
- `syncCommand()` for `aof sync`
- `cleanCommand()` for `aof clean`
- `validateCommand()` and `doctorCommand()` for top-level diagnostics
- `installCommand()` for `aof install`
- `catalogCommand()` for `aof catalog`

Option parsing is local to `src/cli.mjs` through `parseOptions()`. Runtime selection is normalized by `parseRuntimes()`.

## Core Flow: init

1. `src/cli.mjs` resolves the target directory and config path.
2. It refuses to overwrite `aof.config.json` unless `--force` is passed.
3. It opens and seeds the SQLite catalog through `src/catalog.mjs`.
4. It resolves selected catalog items through CLI options or `src/prompt.mjs`.
5. It selects runtimes from CLI flags or interactive prompt.
6. It writes a compact `aof.config.json` with selected item IDs and runtimes.
7. It renders selected resources through `src/adapters.mjs`.
8. It emits framework install commands through `src/frameworks.mjs`.
9. It writes `aof.lock.json` to record selected items, runtimes, and catalog path.

## Core Flow: apply

1. `src/cli.mjs` loads a config with `loadConfig()` from `src/dsl.mjs`.
2. `src/dsl.mjs` resolves inline bodies or file-backed bodies.
3. `src/adapter-warnings.mjs` computes command-time adapter warnings for the selected runtimes.
4. `src/adapters.mjs` renders each portable resource to each selected runtime.
5. `src/render-plan.mjs` plans create/update/delete/skip/drift actions and lock manifest entries.
6. `src/cli.mjs` prints adapter warnings before actions; `--strict` exits before writes when warnings exist.
7. `src/fs.mjs` writes output files, unless dry-run mode is active.

## Core Flow: add

1. `src/cli.mjs` routes `aof add <kind> <id>` to `src/scaffold.mjs`.
2. `src/scaffold.mjs` resolves `.aof/aof.config.json` and source asset paths.
3. It writes a minimal file-backed asset under `.aof/assets/`.
4. It updates `.aof/aof.config.json` with resource metadata and runtime selections.
5. It refuses config or file collisions unless `--force` is supplied.

## Core Flow: sync

1. `src/sync.mjs` loads `.aof/` config and previous lock state.
2. It computes adapter warnings through `src/adapter-warnings.mjs`.
3. It builds generated output actions through render-plan primitives.
4. It builds framework installer intent through `src/frameworks.mjs`.
5. `aof sync --dry-run` prints adapter warnings, output actions, installer commands, and lock preview without writing.
6. `aof sync --strict` exits before file actions, lock writes, or installers when adapter warnings exist.
7. `aof sync` writes generated outputs and lock state while leaving installers disabled.
8. `aof sync --install` executes the explicit network-boundary installer path and records attempts.

## Core Flow: adapter warnings

1. `src/adapter-warnings.mjs` receives a normalized config plus selected runtimes.
2. It emits stable warning objects with code, severity, config path, primitive kind/id, runtime, generated path, reason, and remediation.
3. `src/config-inspect.mjs` exposes warning arrays in validation/doctor inspection payloads.
4. `src/cli.mjs` formats warnings for human output and JSON output.
5. `src/config-editor.mjs` exposes the same warning objects to the setup UI Review tab.
6. Warnings are computed at command time and are not persisted in `.aof/aof.lock.json`.

## Core Flow: clean

1. `src/clean.mjs` reads generated file entries from `.aof/aof.lock.json`.
2. It hashes current files and plans delete, skip, or drift-warning actions.
3. Matching lock-owned generated files are deleted.
4. Drifted generated files are preserved.
5. Lock file entries are removed only for deleted or already-absent generated outputs, while framework intent is preserved.

## Core Flow: catalog

- `aof catalog init` seeds built-in items.
- `aof catalog list` prints catalog rows.
- `aof catalog path` prints the effective database path.

## Core Flow: install

- `aof install --no-serve` initializes the catalog and exits.
- `aof install` initializes the catalog and starts the setup UI server.
- `aof install gsd` delegates to `src/frameworks.mjs` and does not start the setup UI.

## Module Boundaries

- `src/cli.mjs`: orchestration, option parsing, command output.
- `src/catalog.mjs`: SQLite migration, built-in catalog item seed data, catalog CRUD methods, selected item conversion.
- `src/scaffold.mjs`: file-backed `.aof/` asset scaffolding and config updates.
- `src/sync.mjs`: combined render/package reconciliation planning and execution.
- `src/clean.mjs`: lock-owned generated output cleanup planning and execution.
- `src/dsl.mjs`: AOF config validation and body resolution.
- `src/adapter-warnings.mjs`: command-time degradation warning policy for runtime fidelity and skipped outputs.
- `src/adapters.mjs`: runtime-specific render targets and frontmatter rendering.
- `src/frameworks.mjs`: framework package install command construction and execution.
- `src/fs.mjs`: low-level JSON/text filesystem helpers.
- `src/paths.mjs`: OS-specific data directory and catalog database path resolution.
- `src/prompt.mjs`: interactive and test-driven selection helpers.
- `src/setup-ui.mjs`: local HTTP API and static file serving.

## Data Flow

- User input enters through CLI arguments, stdin prompts, or setup UI HTTP requests.
- Catalog state is persisted in SQLite.
- Project install state is persisted in `aof.config.json` and `aof.lock.json`.
- Rendered assistant assets are written under `.claude/`, `.codex/`, or global assistant directories.
- Framework integrations are represented as shell commands or executed through `spawnSync()`.

## UI Architecture

- `ui/src/main.tsx` owns all current UI state in a single `App` component.
- The UI fetches catalog items from `/api/items`.
- New setup items are posted back to `/api/items`.
- Reusable shadcn-style primitives live in `ui/src/components/ui/`.
- Styling is centralized through Tailwind classes and theme tokens in `ui/src/index.css`.

## Error Handling

- CLI commands throw `Error` instances, caught once in `bin/aof.mjs`.
- `bin/aof.mjs` prints `error.message` and sets `process.exitCode = 1`.
- Catalog seeding wraps multiple SQLite writes in an explicit transaction.
- Setup UI request errors are returned as JSON for `POST /api/items`; static file misses return 404.

## Extensibility Points

- Add new portable resource kinds by updating `src/dsl.mjs`, `src/adapters.mjs`, `src/adapter-warnings.mjs`, and `schemas/aof.schema.json`.
- Add new assistant runtimes by extending `RUNTIMES` in `src/adapters.mjs` and runtime validation in `src/dsl.mjs` and `src/prompt.mjs`.
- Add framework integrations by extending `FRAMEWORKS` in `src/frameworks.mjs`.
- Add catalog UI capabilities by extending `src/setup-ui.mjs` API routes and `ui/src/main.tsx`.

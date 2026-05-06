---
last_mapped: 2026-05-06
focus: arch
---

# Architecture

## Summary

AOF is structured as a thin CLI orchestrator over focused modules: DSL loading, catalog persistence, runtime adapters, framework installation, setup UI serving, prompting, and path resolution. The architecture favors small synchronous command flows and explicit file writes over long-running background services.

## Entry Points

- `bin/aof.mjs` is the executable entry point.
- `src/cli.mjs` exports `run(argv)` and dispatches commands.
- `src/setup-ui.mjs` exposes `serveSetupUi()` for the optional local setup interface.
- `ui/src/main.tsx` is the React application entry point for the setup UI.

## Command Dispatch

`src/cli.mjs` parses the first CLI argument and routes to:

- `initCommand()` for `aof init`
- `applyCommand()` for `aof apply`
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
3. `src/adapters.mjs` renders each portable resource to each selected runtime.
4. `src/fs.mjs` writes output files, unless dry-run mode is active.

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
- `src/dsl.mjs`: AOF config validation and body resolution.
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

- Add new portable resource kinds by updating `src/dsl.mjs`, `src/adapters.mjs`, and `schemas/aof.schema.json`.
- Add new assistant runtimes by extending `RUNTIMES` in `src/adapters.mjs` and runtime validation in `src/dsl.mjs` and `src/prompt.mjs`.
- Add framework integrations by extending `FRAMEWORKS` in `src/frameworks.mjs`.
- Add catalog UI capabilities by extending `src/setup-ui.mjs` API routes and `ui/src/main.tsx`.

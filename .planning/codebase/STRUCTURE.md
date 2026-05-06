---
last_mapped: 2026-05-06
focus: arch
---

# Structure

## Repository Layout

- `package.json` defines the root CLI package, npm scripts, Node engine, binary entry, and workspace.
- `package-lock.json` pins installed package versions.
- `README.md` documents CLI usage, DSL shape, and tests.
- `aof.config.json` is a sample/current local AOF project configuration.
- `schemas/aof.schema.json` defines the JSON schema for AOF config files.
- `bin/aof.mjs` is the CLI executable.
- `src/` contains CLI, DSL, catalog, adapter, framework, filesystem, path, prompt, and setup UI server modules.
- `test/` contains unit tests and integration tests.
- `scripts/` contains test runners.
- `ui/` contains the React/Vite setup UI workspace.

## Source Files

- `src/cli.mjs`: top-level command orchestration and option parsing.
- `src/catalog.mjs`: built-in catalog items, SQLite migration, catalog persistence, and catalog-to-config conversion.
- `src/adapters.mjs`: renders skills, commands, and agents into Claude/Codex filesystem layouts.
- `src/dsl.mjs`: loads and normalizes `aof.config.json` style configuration.
- `src/frameworks.mjs`: handles framework installer command generation and execution.
- `src/fs.mjs`: shared JSON, text write, and ID normalization helpers.
- `src/paths.mjs`: OS-aware data directory and database path helpers.
- `src/prompt.mjs`: interactive item/runtime selection helpers.
- `src/setup-ui.mjs`: local HTTP server and setup UI API.

## Test Files

- `test/adapters.test.mjs`: verifies resource rendering into `.claude` and `.codex`.
- `test/catalog.test.mjs`: verifies SQLite catalog seeding and item-to-config conversion.
- `test/paths.test.mjs`: verifies OS-specific data path selection.
- `test/prompt.test.mjs`: verifies item and runtime selection parsing.
- `test/integration/cli.feature`: BDD scenarios for user-facing CLI behavior.
- `test/integration/cli.mjs`: Node integration test runner.
- `test/integration/cli.ps1`: PowerShell integration test runner for Windows environments.

## Scripts

- `scripts/test-unit.mjs` runs unit test arrays exported from test modules.
- `scripts/test.mjs` runs unit tests, then imports the integration runner with `AOF_IN_PROCESS_INTEGRATION=1`.

## UI Workspace

- `ui/package.json`: private workspace metadata and UI dependencies.
- `ui/index.html`: Vite HTML entry.
- `ui/vite.config.ts`: Vite plugins, alias, and dev proxy.
- `ui/src/main.tsx`: entire current React setup UI.
- `ui/src/index.css`: Tailwind import, theme tokens, and global typography.
- `ui/src/lib/utils.ts`: class name utility for UI components.
- `ui/src/components/ui/`: reusable UI primitives such as button, badge, card, input, label, and textarea.
- `ui/components.json`: shadcn-style component configuration.

## Generated Or External Directories

- `node_modules/` contains installed dependencies and should not be treated as source.
- `.codex/` is present because GSD skills are installed locally; it is tooling output and not part of AOF product source.
- `.planning/` contains GSD planning artifacts.
- `.git/` was initialized for GSD workflow tracking.

## Naming Conventions

- CLI modules use lower-case filenames with `.mjs`.
- UI components use lower-case `.tsx` filenames in `ui/src/components/ui/`.
- Tests use `*.test.mjs` for unit-style modules.
- Integration features use `.feature` plus runtime-specific runner files.
- Resource IDs are normalized by `src/fs.mjs` and allow letters, numbers, dots, underscores, and hyphens.

## Important Paths For Future Work

- CLI behavior changes usually start in `src/cli.mjs`.
- Config format changes require touching `src/dsl.mjs`, `schemas/aof.schema.json`, tests, and README examples.
- Runtime rendering changes belong in `src/adapters.mjs`.
- Catalog persistence changes belong in `src/catalog.mjs`.
- Setup UI API changes belong in `src/setup-ui.mjs`; client changes belong in `ui/src/main.tsx`.
- End-to-end behavior should be captured in `test/integration/cli.feature`.

## Current File Count Snapshot

Source-scale files excluding dependencies are small enough for direct review:

- Root CLI source: 9 files under `src/` plus `bin/aof.mjs`.
- Unit tests: 4 files under `test/`.
- Integration tests: 3 files under `test/integration/`.
- UI source/config: Vite config, TypeScript configs, CSS, React entry, and UI primitives.

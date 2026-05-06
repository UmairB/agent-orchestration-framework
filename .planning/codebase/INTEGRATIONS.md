---
last_mapped: 2026-05-06
focus: tech
---

# Integrations

## Summary

AOF is primarily a local developer tool. Its integrations are local filesystem writes, a SQLite catalog database, npm framework installer commands, and an optional local HTTP setup UI.

## Local Filesystem

- `src/adapters.mjs` writes rendered assistant resources into runtime-specific folders.
- Claude local output root is `.claude`; global output root is `%USERPROFILE%\.claude` or equivalent home path.
- Codex local output root is `.codex`; global output root is `%USERPROFILE%\.codex` or equivalent home path.
- `src/fs.mjs` centralizes JSON reads, text writes, directory creation, and ID validation.
- `src/cli.mjs` writes `aof.config.json` and `aof.lock.json` during `aof init`.

## SQLite Catalog

- `src/catalog.mjs` uses `DatabaseSync` from `node:sqlite`.
- The default database path comes from `src/paths.mjs`.
- Windows default: `%APPDATA%\aof\aof.sqlite`.
- macOS default: `~/Library/Application Support/aof/aof.sqlite`.
- Linux default: `$XDG_DATA_HOME/aof/aof.sqlite` or `~/.local/share/aof/aof.sqlite`.
- `AOF_DATA_DIR` overrides the default data directory.
- `--db <path>` overrides the final catalog database file path.

## Catalog Schema

- `catalog_items` stores portable items with `id`, `kind`, `name`, `description`, `body`, `source`, `runtimes_json`, and `default_enabled`.
- `profiles` and `profile_items` are created in migrations but are not yet surfaced by the CLI.
- Built-in catalog items are seeded by `catalog.seedBuiltins()` in `src/catalog.mjs`.

## Framework Installer

- `src/frameworks.mjs` defines known framework integrations.
- The current framework integration is `gsd`.
- `aof install gsd` maps to `npx get-shit-done-cc@latest` with runtime flags.
- Runtime flags are `--claude` and `--codex`.
- Scope flags are `--global` and `--local`.
- Non-dry-run installs use `spawnSync()` and inherit stdio.

## Setup UI HTTP Server

- `src/setup-ui.mjs` creates a local `http` server.
- `GET /api/items` returns `catalog.listItems()` JSON.
- `POST /api/items` accepts new catalog items but only supports `skill` and `agent` kinds.
- Static files are served from the `ui` workspace directory.
- The server listens on `127.0.0.1` and defaults to port `4177`.

## External Network

- Normal CLI commands do not call external APIs directly.
- `aof install gsd` can trigger network access indirectly through `npx get-shit-done-cc@latest`.
- Vite dev dependencies may require npm registry access when dependencies are installed, but that is outside runtime behavior.

## Authentication

- There is no application authentication in the current codebase.
- The setup UI is local-only by binding to `127.0.0.1`.
- The catalog database is a local file with operating-system-level access controls only.

## Webhooks And Cloud Services

- No webhooks are implemented.
- No hosted database, cloud API, payment provider, email provider, or analytics service is integrated.

## Integration Risks

- `src/setup-ui.mjs` serves static paths derived from `request.url`; path traversal should be reviewed before exposing beyond localhost.
- `src/frameworks.mjs` shells out to `npx`, so failures depend on local npm configuration, network availability, and package manager behavior.
- `node:sqlite` availability depends on Node version and build; the declared engine range should be validated against the actual minimum version that includes the API used.

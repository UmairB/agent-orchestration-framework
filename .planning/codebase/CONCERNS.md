---
last_mapped: 2026-05-06
focus: concerns
---

# Concerns

## Summary

The codebase is compact and understandable, but several areas need attention before the tool is hardened: setup UI path handling, duplicated runtime validation, sparse tests around framework installs and the HTTP API, and drift between config shapes.

## Security Concerns

- `src/setup-ui.mjs` builds static file paths with `path.join(uiRoot, request.url ?? "")`. Review for path traversal before any non-local exposure.
- `src/setup-ui.mjs` parses POST bodies with `JSON.parse(body)` and trusts fields beyond a basic kind check; catalog item validation should reuse DSL or schema constraints.
- `src/frameworks.mjs` executes `npx get-shit-done-cc@latest`; this is expected behavior, but it is a networked supply-chain boundary and should remain explicit in docs and dry-run output.
- Global writes in `src/adapters.mjs` can write under the user's assistant directories. That is intended, but commands should make target paths clear before writing when interactive flows are added.

## Reliability Concerns

- `src/cli.mjs` has an unused `DEFAULT_CONFIG` constant that does not match the current compact `initCommand()` output shape.
- `src/cli.mjs` writes `aof.config.json` with `items` and `runtimes`, while `src/dsl.mjs` primarily resolves `resources` and `packages`; this split is intentional for init but can confuse future config evolution.
- `src/setup-ui.mjs` does not guard malformed JSON separately from other POST errors.
- `src/setup-ui.mjs` starts a server and `installCommand()` waits forever with `await new Promise(() => {})`; this is fine for an interactive server command but should be documented as intentional.
- `src/catalog.mjs` parses `runtimes_json` without fallback; corrupted catalog rows will throw during listing.

## Compatibility Concerns

- `node:sqlite` is relatively new. The declared `node >=20` may be too broad depending on the exact Node version that first supports `DatabaseSync`.
- `src/frameworks.mjs` uses `spawnSync(..., { shell: process.platform === "win32" })`; Windows behavior is covered only indirectly.
- Integration tests provide a PowerShell runner, but default `npm test` uses in-process Node integration mode, which can miss child-process behavior differences.

## Product Gaps

- Setup UI supports creating only skills and agents, not commands or frameworks.
- The setup UI can list items and save items but does not initialize a project from selected UI items.
- Profiles are present in the SQLite schema but not exposed in CLI or UI.
- `aof.config.json` supports packages in schema and README, but `src/dsl.mjs` only validates resources and passes packages through.

## Test Gaps

- No direct tests for `src/setup-ui.mjs`.
- No direct tests for `src/frameworks.mjs`.
- No tests for schema conformance.
- No tests for malformed CLI options, unknown runtime values in all paths, or invalid catalog data.
- UI build is not part of `npm test`; it must be run separately through `npm run ui:build`.

## Maintainability Concerns

- Runtime definitions are duplicated across `src/adapters.mjs`, `src/dsl.mjs`, `src/prompt.mjs`, and `src/frameworks.mjs`.
- Resource kind definitions are duplicated across `src/dsl.mjs`, `src/adapters.mjs`, `src/catalog.mjs`, and `schemas/aof.schema.json`.
- `src/cli.mjs` is already the largest module and may become difficult to maintain if more commands are added without splitting command handlers.

## Operational Notes

- The repository was not a git repository before this GSD workflow; `.git/` was initialized during project setup.
- The failed first `git init` left a stale `.git/config.lock`, which was removed before completing initialization.
- `node_modules/` exists locally and can make broad file searches noisy; use `rg --files -g '!node_modules' -g '!ui/node_modules'`.

## Recommended Near-Term Fixes

- Add setup UI API tests, then tighten path handling and request validation.
- Add framework dry-run unit tests before expanding framework integrations.
- Centralize runtime and resource-kind constants.
- Decide whether compact `items` config and expanded `resources` config are both first-class, then document and test that boundary.
- Include `npm run ui:build` in a broader verification script if UI regressions matter for normal changes.

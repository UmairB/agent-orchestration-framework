---
last_mapped: 2026-05-06
focus: tech
---

# Stack

## Summary

AOF is a Node.js 20+ ESM command-line tool with a small React/Vite setup UI packaged as an npm workspace. The root package exposes the `aof` binary through `bin/aof.mjs`, and most product behavior lives in `src/*.mjs`.

## Runtime

- Node.js `>=20`, declared in `package.json`.
- ECMAScript modules are used throughout via `"type": "module"` in `package.json` and `ui/package.json`.
- The CLI entry point is `bin/aof.mjs`, which imports `run()` from `src/cli.mjs`.
- The catalog uses Node's built-in `node:sqlite` `DatabaseSync` API in `src/catalog.mjs`, so the effective Node runtime must include that module.

## Root Package

- `package.json` defines the public package name `aof`, version `0.1.0`, and binary mapping `"aof": "./bin/aof.mjs"`.
- Workspaces include `ui`, making the setup UI a first-class npm workspace.
- Main scripts:
  - `npm test` / `npm run test:all` run `node ./scripts/test.mjs`.
  - `npm run test:unit` runs `node ./scripts/test-unit.mjs`.
  - `npm run test:integration` runs `node ./test/integration/cli.mjs`.
  - `npm run test:integration:ps` runs `test/integration/cli.ps1`.
  - `npm run ui:dev` and `npm run ui:build` delegate into the `@aof/ui` workspace.

## CLI Dependencies

- The CLI currently relies only on Node built-ins:
  - `node:path`, `node:fs/promises`, `node:os`, `node:readline/promises`, `node:process`
  - `node:sqlite` in `src/catalog.mjs`
  - `node:child_process` in `src/frameworks.mjs`
  - `node:http`, `node:url` in `src/setup-ui.mjs`
- No third-party runtime packages are imported by the CLI modules.

## UI Stack

- `ui/package.json` defines `@aof/ui` as a private workspace package.
- Framework: React 19 with `react-dom`.
- Build tool: Vite 6 with `@vitejs/plugin-react`.
- Styling: Tailwind CSS 4 via `@tailwindcss/vite`, plus utility merging through `clsx` and `tailwind-merge`.
- Component helpers: Radix Slot and `class-variance-authority`.
- Icons: `lucide-react`.
- TypeScript 5.7 is used for UI source and build checks.

## UI Configuration

- `ui/vite.config.ts` registers React and Tailwind plugins.
- `ui/vite.config.ts` aliases `@` to `ui/src`.
- The Vite dev server proxies `/api` to `http://127.0.0.1:4178`, while the Node setup server in `src/setup-ui.mjs` defaults to port `4177`.
- `ui/src/index.css` defines Tailwind theme tokens and global typography.

## Configuration Files

- `aof.config.json` is the repository's local AOF config and references `schemas/aof.schema.json`.
- `schemas/aof.schema.json` validates portable resources and package declarations.
- TypeScript configuration is split across `ui/tsconfig.json`, `ui/tsconfig.app.json`, and `ui/tsconfig.node.json`.

## Package Lock

- `package-lock.json` is present and should be treated as the source of exact installed dependency versions.
- `node_modules/` is present in the workspace but is generated dependency output, not source.

## Build Outputs

- No generated build output is tracked in the source file list.
- Assistant output directories such as `.codex/` exist in this workspace because GSD is installed, but project source of truth remains `aof.config.json`, `src/`, `ui/src/`, `schemas/`, and tests.

# AGENTS.md

## Project Context

This repository is AOF, a Node.js CLI and UI for defining coding-assistant assets once and rendering them into runtime-specific folders such as Claude Code and Codex.

Current project planning lives in `.planning/`:

- `.planning/PROJECT.md` - product context and decisions
- `.planning/REQUIREMENTS.md` - v1 requirements
- `.planning/ROADMAP.md` - phase roadmap
- `.planning/STATE.md` - current phase state
- `.planning/codebase/` - brownfield codebase map

## Working Rules

- Treat `.aof/` as the intended source of truth for configuration, assets, runtime overrides, and lock state.
- Treat `.claude/` and `.codex/` as generated output from AOF configuration.
- Preserve current CLI behavior unless the active phase explicitly changes it.
- Keep Claude Code and Codex as the concrete v1 runtimes.
- Keep UI v1 focused on valid configuration editing; CLI executes init/apply/install.
- Update tests with behavior changes, especially CLI integration scenarios and `.aof/` config parsing/rendering paths.

## Supply-Chain Safety

- Treat `package-lock.json` as the dependency source of truth and prefer frozen installs.
- Do not add, update, or run package installs unless the user explicitly asks or the active phase requires it.
- Keep npm lifecycle scripts disabled by default; allow install scripts only through reviewed, explicit exceptions.
- Run `node scripts/supply-chain-audit.mjs` after dependency changes and before broader verification.
- Do not read or expose secrets while investigating packages, install failures, or dependency scripts.
- Treat downloaded packages and `node_modules/` contents as untrusted input.

## Verification

Prefer focused checks first:

- `node scripts/supply-chain-audit.mjs` when dependencies or install behavior change
- `npm run test:unit`
- `npm test`
- `npm run ui:build` when UI files change

Use `.planning/ROADMAP.md` and the active phase plan to decide broader verification.

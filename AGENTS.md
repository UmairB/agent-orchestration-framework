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

## Verification

Prefer focused checks first:

- `npm run test:unit`
- `npm test`
- `npm run ui:build` when UI files change

Use `.planning/ROADMAP.md` and the active phase plan to decide broader verification.

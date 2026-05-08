# Stack Research: Global Asset Library

## Scope

Milestone v1.2 adds reusable global AOF assets stored under `~/.aof`, referenced by project `.aof` configs, and rendered into Claude Code and Codex outputs.

## Current Stack Fit

- AOF already has a local `.aof/` workspace abstraction in `src/workspace.mjs` and file-backed asset editing in `src/config-editor.mjs`.
- `src/paths.mjs` currently exposes an OS-specific app data path, but the user selected an explicit user-home library location: `~/.aof`.
- Render adapters already distinguish local and global runtime output roots for Claude and Codex, but that is runtime-global output, not AOF-global source assets.
- The setup UI already edits project assets and can reuse the same asset editor model if the backend exposes a global workspace payload.

## Recommended Stack Additions

- Add a small global workspace path helper, preferably `globalAofDir()` or similar, resolving to `path.join(os.homedir(), ".aof")`.
- Extend the existing config/editor/workspace modules instead of adding a new persistence layer.
- Keep global assets file-backed on disk with the same kind/body conventions as project assets.
- Add resolver logic that merges project-local resources with referenced global resources before validation, warning analysis, rendering, and lock creation.

## What Not To Add

- Do not introduce a database or hosted registry for v1.2.
- Do not store global source assets under `~/.codex` or `~/.claude`; those are runtime output homes, not AOF source-of-truth storage.
- Do not copy global assets into project `.aof/` as the default consumption model.


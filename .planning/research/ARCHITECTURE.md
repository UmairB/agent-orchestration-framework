# Architecture Research: Global Asset Library

## Existing Integration Points

- `src/workspace.mjs`: project `.aof` path conventions.
- `src/config-editor.mjs`: creates file-backed assets and writes config metadata.
- `src/dsl.mjs`: loads and normalizes AOF config resources.
- `src/config-inspect.mjs`: validation, diagnostics, and file-backed asset checks.
- `src/adapters.mjs`: converts normalized resources into runtime output paths.
- `src/render-plan.mjs`: output conflict detection, write actions, and lock manifest.
- `src/setup-ui.mjs` and `ui/src/main.tsx`: API and editor surface for project config.

## Proposed Data Flow

1. Global library lives at `~/.aof`.
2. Global assets live under `~/.aof/assets/<kind>/<id>/...` with the same body-file model as project assets.
3. Project config declares references to global assets, for example through a dedicated `globalRefs` or `resources[].source` shape.
4. Config loading resolves references by reading global asset metadata and body files.
5. Validation reports unresolved references, duplicate IDs, incompatible runtimes, and invalid files before rendering.
6. Render planning treats resolved global assets like normal resources but records source scope in lock metadata.
7. Setup UI exposes both project and global workspaces while keeping ownership explicit.

## Build Order

1. Define global workspace path and on-disk schema.
2. Add CLI creation/list/reference commands and config resolution.
3. Integrate resolved global assets into validation, render planning, lock state, and sync/apply.
4. Add setup UI global/project mode and API endpoints for global asset editing.
5. Add associated-file rendering and validation for code-bearing assets.

## Open Design Choice

The exact project reference syntax should be chosen during implementation. It should be explicit enough to avoid confusing local asset IDs with global asset IDs, and should leave room for future pinning or vendoring without a breaking config migration.

